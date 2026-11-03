"use strict";

const { query } = require("../config/db");
const pushUtility = require("./push");
const { getUserBrowserPushEnabled } = require("./pushSettings");

const ADMIN_ROLES = ["admin", "manager", "superadmin", "super_admin", "moderator", "editor"];

const absoluteUrl = (base, path) => {
  const value = String(path || "/notifications");
  if (/^https?:\/\//i.test(value)) return value;
  const normalizedBase = String(base || "").replace(/\/$/, "");
  return normalizedBase + (value.startsWith("/") ? value : "/" + value);
};

async function deliverNotificationPush(notification, {
  targetScope = notification?.target_scope || notification?.targetScope || "individual",
  targetRole = notification?.target_role || notification?.targetRole || null,
  userId = notification?.user_id || notification?.userId || null,
  userEmail = notification?.user_email || notification?.userEmail || null,
  actionUrl = notification?.action_url || notification?.actionUrl || "/notifications",
  title = notification?.title || "Altuvera Safaris",
  message = notification?.message || "",
  priority = notification?.priority || "normal",
} = {}) {
  if (!pushUtility.getVapidPublicKey()) return { sent: 0, skipped: "vapid_unavailable" };

  const scope = String(targetScope || "individual").toLowerCase();
  const userPushEnabled = await getUserBrowserPushEnabled();
  // admin_users and users are separate identity tables. A numeric ID may
  // exist in both, so match the account email as well as the ID before sending.
  const params = [ADMIN_ROLES];
  const roleSql = "$1::text[]";
  const where = [];
  if (scope === "individual") {
    if (userId != null) {
      params.push(userId);
      where.push(`account_type = 'user' AND account_id::text = $2::text`);
    } else if (userEmail) {
      params.push(String(userEmail).toLowerCase());
      where.push(`account_type = 'user' AND LOWER(account_email) = $2`);
    } else {
      return { sent: 0, skipped: "missing_recipient" };
    }
    if (!userPushEnabled) {
      // This guard remains defensive for a malformed individual notification.
      where.push(`account_type = 'user' AND role NOT IN (SELECT unnest(${roleSql}))`);
    }
  } else if (scope === "admin") {
    where.push(`account_type = 'admin' AND role = ANY(${roleSql})`);
  } else if (scope === "role") {
    const role = String(targetRole || "").toLowerCase();
    if (!role) return { sent: 0, skipped: "missing_role" };
    params.push(role);
    if (ADMIN_ROLES.includes(role)) {
      where.push(`account_type = 'admin' AND LOWER(role) = $2`);
    } else {
      if (!userPushEnabled) return { sent: 0, skipped: "user_delivery_disabled" };
      where.push(`account_type = 'user' AND LOWER(role) = $2`);
    }
  } else if (scope === "all") {
    if (!userPushEnabled) where.push(`account_type = 'admin' AND role = ANY(${roleSql})`);
    else where.push("(account_type = 'admin' OR account_type = 'user')");
  } else {
    return { sent: 0, skipped: "unsupported_scope" };
  }

  const { rows } = await query(
    `WITH account_subscriptions AS (
       SELECT DISTINCT
              ps.endpoint, ps.p256dh, ps.auth,
              COALESCE(au.id, u.id) AS account_id,
              COALESCE(au.email, u.email) AS account_email,
              LOWER(COALESCE(au.role, u.role, 'user')) AS role,
              CASE
                WHEN au.id IS NOT NULL
                  OR LOWER(COALESCE(u.role, '')) = ANY($1::text[])
                THEN 'admin'
                ELSE 'user'
              END AS account_type
         FROM push_subscriptions ps
         LEFT JOIN admin_users au
           ON au.id = ps.admin_id
          AND LOWER(au.email) = LOWER(COALESCE(ps.admin_email, ''))
         LEFT JOIN users u
           ON u.id = ps.admin_id
          AND LOWER(u.email) = LOWER(COALESCE(ps.admin_email, ''))
        WHERE (au.id IS NOT NULL OR u.id IS NOT NULL)
      )
      SELECT endpoint, p256dh, auth, role
        FROM account_subscriptions
       WHERE ${where.join(" AND ")}`,
    params,
  );
  if (!rows.length) return { sent: 0, skipped: "no_subscriptions" };

  const frontendBase = process.env.FRONTEND_URL || "https://www.altuverasafaris.com";
  const adminBase = process.env.ADMIN_PANEL_URL || process.env.ADMIN_URL || "https://altuverapanel.vercel.app";
  const groups = new Map();
  for (const row of rows) {
    const isAdmin = ADMIN_ROLES.includes(String(row.role || "").toLowerCase());
    const base = isAdmin ? adminBase : frontendBase;
    const key = base;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let sent = 0;
  for (const [base, subscriptions] of groups.entries()) {
    const isAdminAudience = base === adminBase;
    const payload = {
      title: title || "Altuvera Safaris",
      body: message || "You have a new update from Altuvera.",
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: notification?.id ? `altuvera-notification-${notification.id}` : undefined,
      data: {
        url: absoluteUrl(base, actionUrl),
        id: notification?.id || null,
      },
      requireInteraction: priority === "high",
    };
    const results = await pushUtility.sendPushToSubscriptions(subscriptions, payload);
    const accepted = results.filter((item) => item.success).length;
    sent += accepted;
    if (accepted !== subscriptions.length) {
      console.warn(
        `[Push] Partial delivery for ${isAdminAudience ? "admin" : "user"} audience: ${accepted}/${subscriptions.length}`,
      );
    }
  }
  return { sent, total: rows.length };
}

module.exports = { deliverNotificationPush };
