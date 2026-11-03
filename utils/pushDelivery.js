"use strict";

const { query } = require("../config/db");
const pushUtility = require("./push");
const { getUserBrowserPushEnabled } = require("./pushSettings");

const ADMIN_ROLES = ["admin", "manager", "superadmin", "super_admin", "moderator", "editor"];
const ACCOUNT_TYPE = "COALESCE(ps.account_type, 'admin')";

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
  const params = [];
  const conditions = [];

  if (scope === "individual") {
    if (!userPushEnabled) return { sent: 0, skipped: "user_delivery_disabled" };
    if (userId != null) {
      params.push(userId);
      conditions.push(`(${ACCOUNT_TYPE} = 'user' AND ps.admin_id::text = $1::text)`);
    } else if (userEmail) {
      params.push(String(userEmail).toLowerCase());
      conditions.push(`(${ACCOUNT_TYPE} = 'user' AND LOWER(ps.admin_email) = $1)`);
    } else {
      return { sent: 0, skipped: "missing_recipient" };
    }
  } else if (scope === "admin") {
    conditions.push(`${ACCOUNT_TYPE} = 'admin'`);
  } else if (scope === "role") {
    const role = String(targetRole || "").toLowerCase();
    if (!role) return { sent: 0, skipped: "missing_role" };
    if (ADMIN_ROLES.includes(role)) {
      conditions.push(`${ACCOUNT_TYPE} = 'admin'`);
    } else {
      if (!userPushEnabled) return { sent: 0, skipped: "user_delivery_disabled" };
      params.push(role);
      conditions.push(`${ACCOUNT_TYPE} = 'user'`);
      conditions.push(`COALESCE(u.role, 'user') = $1`);
    }
  } else if (scope === "all") {
    if (!userPushEnabled) conditions.push(`${ACCOUNT_TYPE} = 'admin'`);
  } else {
    return { sent: 0, skipped: "unsupported_scope" };
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT DISTINCT ps.endpoint, ps.p256dh, ps.auth,
            ${ACCOUNT_TYPE} AS account_type,
            CASE WHEN ${ACCOUNT_TYPE} = 'admin' THEN 'admin'
                 ELSE COALESCE(u.role, 'user') END AS role
       FROM push_subscriptions ps
       LEFT JOIN users u
         ON u.id = ps.admin_id AND ${ACCOUNT_TYPE} = 'user'
       ${where}`,
    params,
  );
  if (!rows.length) return { sent: 0, skipped: "no_subscriptions" };

  const frontendBase = process.env.FRONTEND_URL || "https://www.altuverasafaris.com";
  const adminBase = process.env.ADMIN_PANEL_URL || process.env.ADMIN_URL || "https://altuverapanel.vercel.app";
  const groups = new Map();
  for (const row of rows) {
    const base = row.account_type === "admin" ? adminBase : frontendBase;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(row);
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
