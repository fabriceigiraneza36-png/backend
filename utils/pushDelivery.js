"use strict";

const { query } = require("../config/db");
const pushUtility = require("./push");
const { getUserBrowserPushEnabled } = require("./pushSettings");

const ADMIN_ROLES = ["admin", "manager"];

const normalizeActionUrl = (path) => {
  const value = String(path || "/notifications");
  try {
    const parsed = new URL(value, "https://altuverapanel.vercel.app");
    const bookingMatch = parsed.pathname.match(/^\/bookings\/([^/]+)\/?$/i);
    if (bookingMatch) {
      parsed.pathname = "/bookings";
      parsed.searchParams.set("bookingId", decodeURIComponent(bookingMatch[1]));
      return /^https?:\/\//i.test(value) ? parsed.toString() : parsed.pathname + parsed.search;
    }
    if (/^\/dashboard\/?$/i.test(parsed.pathname)) return "/notifications";
  } catch { /* keep the supplied safe path */ }
  return value;
};

const absoluteUrl = (base, path) => {
  const value = normalizeActionUrl(path);
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
  title = notification?.title || "Altuvera",
  message = notification?.message || "",
  priority = notification?.priority || "normal",
} = {}) {
  if (!pushUtility.getVapidPublicKey()) return { sent: 0, skipped: "vapid_unavailable" };

  const scope = String(targetScope || "individual").toLowerCase();
  const userPushEnabled = await getUserBrowserPushEnabled();
  const params = [];
  let where = "u.id = ps.admin_id";

  if (scope === "individual") {
    if (userId != null) {
      params.push(userId);
      where += ` AND u.id::text = $1::text`;
    } else if (userEmail) {
      params.push(String(userEmail).toLowerCase());
      where += ` AND LOWER(u.email) = $1`;
    } else {
      return { sent: 0, skipped: "missing_recipient" };
    }
    if (!userPushEnabled) {
      params.push(ADMIN_ROLES);
      where += ` AND u.role = ANY($${params.length}::text[])`;
    }
  } else if (scope === "admin") {
    params.push(ADMIN_ROLES);
    where += ` AND u.role = ANY($1::text[])`;
  } else if (scope === "role") {
    const role = String(targetRole || "").toLowerCase();
    if (!role) return { sent: 0, skipped: "missing_role" };
    if (ADMIN_ROLES.includes(role)) {
      params.push(role === "admin" ? ADMIN_ROLES : [role]);
      where += ` AND u.role = ANY($1::text[])`;
    } else {
      if (!userPushEnabled) return { sent: 0, skipped: "user_delivery_disabled" };
      params.push(role);
      where += ` AND u.role = $1`;
    }
  } else if (scope === "all") {
    if (!userPushEnabled) {
      params.push(ADMIN_ROLES);
      where += ` AND u.role = ANY($1::text[])`;
    }
  } else {
    return { sent: 0, skipped: "unsupported_scope" };
  }

  const { rows } = await query(
    `SELECT DISTINCT ps.endpoint, ps.p256dh, ps.auth, u.role
       FROM push_subscriptions ps
       JOIN users u ON u.id = ps.admin_id
      WHERE ${where}`,
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
      title: title || "Altuvera",
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
