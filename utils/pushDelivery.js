"use strict";

const crypto = require("crypto");
const { query } = require("../config/db");
const pushUtility = require("./push");
const { getUserBrowserPushEnabled } = require("./pushSettings");

const ADMIN_ROLES = ["admin", "manager"];
const PUSH_TTL_SECONDS = 300;
const STALE_NOTIFICATION_MS = 10 * 60 * 1000;
const DELIVERY_CLAIM_MS = 5 * 60 * 1000;
const LOCAL_DEDUPE_MS = 6 * 60 * 60 * 1000;

let receiptSchemaPromise = null;
const localDeliveryClaims = new Map();

const normalizeActionUrl = (path, base) => {
  const value = String(path || "/notifications");
  try {
    const parsed = new URL(value, base);
    const bookingMatch = parsed.pathname.match(/^\/bookings\/([^/]+)\/?$/i);
    if (bookingMatch) {
      parsed.pathname = "/bookings";
      parsed.searchParams.set("bookingId", decodeURIComponent(bookingMatch[1]));
    }
    if (/^\/dashboard\/?$/i.test(parsed.pathname)) {
      parsed.pathname = "/notifications";
      parsed.search = "";
    }
    return /^https?:\/\//i.test(value)
      ? parsed.toString()
      : parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/notifications";
  }
};

const absoluteUrl = (base, path) => {
  const fallback = new URL("/notifications", base).toString();
  try {
    const parsed = new URL(normalizeActionUrl(path, base), base);
    if (parsed.origin !== new URL(base).origin) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
};

const isImportantBrowserPush = (notification = {}, overrides = {}) => {
  const type = String(notification.type || "").trim().toLowerCase();
  const category = String(notification.category || "").trim().toLowerCase();
  const priority = String(overrides.priority || notification.priority || "normal").trim().toLowerCase();
  const targetScope = String(
    overrides.targetScope || notification.target_scope || notification.targetScope || "individual"
  ).trim().toLowerCase();
  const title = String(overrides.title || notification.title || "").trim().toLowerCase();
  const message = String(overrides.message || notification.message || "").trim().toLowerCase();

  // Routine successful sign-ins remain in the in-app security history/email.
  // They are not urgent browser alerts and can be triggered by another device.
  if (
    type === "login_success" ||
    /sign[\s-]?in successful|successful secure sign[\s-]?in|signed in successfully/.test(title + " " + message)
  ) {
    return false;
  }

  // These events are inherently time-sensitive for the recipient.
  if (category === "booking" || category === "messages") return true;

  // Incoming contact enquiries are important to the admin team, not a push
  // receipt to the traveller who submitted the enquiry.
  if (category === "contact") {
    return targetScope === "admin" && (type.includes("contact") || priority === "high" || priority === "urgent");
  }

  // Package requests and critical account/travel events warrant a push.
  if (category === "package") {
    return type.includes("request") || priority === "high" || priority === "urgent";
  }
  if (category === "security" || category === "travel_updates") {
    return priority === "high" || priority === "urgent";
  }

  // Explicit urgent events can use another well-defined category. Do not let
  // routine admin activity, reviews, or general broadcasts become push noise.
  if (priority === "urgent") {
    return !["admin_activity", "general", "review", "reviews"].includes(category);
  }

  return false;
};

const ensureReceiptSchema = async () => {
  if (!receiptSchemaPromise) {
    receiptSchemaPromise = query(
      "CREATE TABLE IF NOT EXISTS push_delivery_receipts (" +
        "notification_id TEXT NOT NULL," +
        "endpoint_hash CHAR(64) NOT NULL," +
        "delivery_state VARCHAR(12) NOT NULL DEFAULT 'pending'," +
        "claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()," +
        "sent_at TIMESTAMPTZ," +
        "last_error TEXT," +
        "PRIMARY KEY (notification_id, endpoint_hash)" +
      ")"
    ).then(() => undefined).catch((error) => {
      receiptSchemaPromise = null;
      throw error;
    });
  }
  return receiptSchemaPromise;
};

const hashEndpoint = (endpoint) =>
  crypto.createHash("sha256").update(String(endpoint)).digest("hex");

const claimLocalDelivery = (key) => {
  const now = Date.now();
  for (const [claimKey, expiresAt] of localDeliveryClaims.entries()) {
    if (expiresAt <= now) localDeliveryClaims.delete(claimKey);
  }
  if (localDeliveryClaims.has(key)) return false;
  localDeliveryClaims.set(key, now + LOCAL_DEDUPE_MS);
  return true;
};

const claimDelivery = async (notificationId, endpoint) => {
  const endpointHash = hashEndpoint(endpoint);
  const key = notificationId + ":" + endpointHash;

  try {
    await ensureReceiptSchema();
    const result = await query(
      "INSERT INTO push_delivery_receipts " +
        "(notification_id, endpoint_hash, delivery_state, claimed_at) " +
        "VALUES ($1, $2, 'pending', NOW()) " +
        "ON CONFLICT (notification_id, endpoint_hash) DO UPDATE SET " +
        "delivery_state = 'pending', claimed_at = NOW(), last_error = NULL " +
        "WHERE push_delivery_receipts.delivery_state = 'failed' " +
        "OR (push_delivery_receipts.delivery_state = 'pending' " +
        "AND push_delivery_receipts.claimed_at < NOW() - INTERVAL '5 minutes') " +
        "RETURNING notification_id",
      [notificationId, endpointHash]
    );
    return { claimed: result.rows.length > 0, endpointHash, key, durable: true };
  } catch (error) {
    // Keep notifications flowing if the receipt table cannot be created; the
    // in-process lock still prevents concurrent duplicate sends on this node.
    console.warn("[Push] Durable deduplication unavailable; using local guard:", error.message);
    return { claimed: claimLocalDelivery(key), endpointHash, key, durable: false };
  }
};

const markDeliverySent = async (claim) => {
  if (claim.durable) {
    await query(
      "UPDATE push_delivery_receipts SET delivery_state = 'sent', sent_at = NOW(), last_error = NULL " +
        "WHERE notification_id = $1 AND endpoint_hash = $2",
      [claim.notificationId, claim.endpointHash]
    );
  }
};

const markDeliveryFailed = async (claim, error) => {
  if (claim.durable) {
    await query(
      "UPDATE push_delivery_receipts SET delivery_state = 'failed', claimed_at = NOW(), last_error = $3 " +
        "WHERE notification_id = $1 AND endpoint_hash = $2",
      [claim.notificationId, claim.endpointHash, String(error?.message || error || "Push delivery failed").slice(0, 500)]
    ).catch((markError) => {
      console.warn("[Push] Could not record failed delivery:", markError.message);
    });
  } else {
    localDeliveryClaims.delete(claim.key);
  }
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
  if (!isImportantBrowserPush(notification, { targetScope, title, message, priority })) {
    return { sent: 0, skipped: "not_urgent_or_important" };
  }

  const createdAt = notification?.created_at ? new Date(notification.created_at).getTime() : Date.now();
  if (Number.isFinite(createdAt) && Date.now() - createdAt > STALE_NOTIFICATION_MS) {
    return { sent: 0, skipped: "stale_notification" };
  }

  if (!pushUtility.getVapidPublicKey()) {
    return { sent: 0, skipped: "vapid_unavailable" };
  }

  const notificationId = String(
    notification?.id ||
    notification?.notification_id ||
    notification?.metadata?.notificationId ||
    notification?.metadata?.notification_id ||
    ""
  );
  if (!notificationId) return { sent: 0, skipped: "missing_notification_id" };

  const scope = String(targetScope || "individual").toLowerCase();
  const userPushEnabled = await getUserBrowserPushEnabled();
  const params = [];
  let where = "u.id = ps.admin_id";

  if (scope === "individual") {
    if (userId != null) {
      params.push(userId);
      where += " AND u.id::text = $1::text";
    } else if (userEmail) {
      params.push(String(userEmail).toLowerCase());
      where += " AND LOWER(u.email) = $1";
    } else {
      return { sent: 0, skipped: "missing_recipient" };
    }
    if (!userPushEnabled) {
      params.push(ADMIN_ROLES);
      where += " AND u.role = ANY($" + params.length + "::text[])";
    }
  } else if (scope === "admin") {
    params.push(ADMIN_ROLES);
    where += " AND u.role = ANY($1::text[])";
  } else if (scope === "role") {
    const role = String(targetRole || "").toLowerCase();
    if (!role) return { sent: 0, skipped: "missing_role" };
    if (ADMIN_ROLES.includes(role)) {
      params.push(role === "admin" ? ADMIN_ROLES : [role]);
      where += " AND u.role = ANY($1::text[])";
    } else {
      if (!userPushEnabled) return { sent: 0, skipped: "user_delivery_disabled" };
      params.push(role);
      where += " AND u.role = $1";
    }
  } else if (scope === "all") {
    if (!userPushEnabled) {
      params.push(ADMIN_ROLES);
      where += " AND u.role = ANY($1::text[])";
    }
  } else {
    return { sent: 0, skipped: "unsupported_scope" };
  }

  const { rows } = await query(
    "SELECT DISTINCT ON (ps.endpoint) ps.endpoint, ps.p256dh, ps.auth, u.role " +
      "FROM push_subscriptions ps " +
      "JOIN users u ON u.id = ps.admin_id " +
      "WHERE " + where + " " +
      "ORDER BY ps.endpoint, ps.updated_at DESC NULLS LAST, ps.id DESC",
    params
  );
  if (!rows.length) return { sent: 0, total: 0, skipped: "no_subscriptions" };

  const frontendBase = (process.env.FRONTEND_URL || "https://www.altuverasafaris.com").replace(/\/+$/, "");
  const adminBase = (process.env.ADMIN_PANEL_URL || process.env.ADMIN_URL || "https://altuverapanel.vercel.app").replace(/\/+$/, "");
  const groups = new Map();

  for (const row of rows) {
    const isAdmin = ADMIN_ROLES.includes(String(row.role || "").toLowerCase());
    const base = isAdmin ? adminBase : frontendBase;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(row);
  }

  const createdAtIso = Number.isFinite(createdAt) ? new Date(createdAt).toISOString() : new Date().toISOString();
  const pushPriority = String(priority).toLowerCase();
  const sendOptions = {
    TTL: PUSH_TTL_SECONDS,
    urgency: pushPriority === "high" || pushPriority === "urgent" ? "high" : "normal",
  };

  let sent = 0;
  let duplicateSkips = 0;

  for (const [base, subscriptions] of groups.entries()) {
    const payload = {
      title: title || "Altuvera",
      body: message || "You have a new important update from Altuvera.",
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: "altuvera-notification-" + notificationId,
      priority: pushPriority,
      category: String(notification?.category || ""),
      type: String(notification?.type || ""),
      targetScope: scope,
      requireInteraction: pushPriority === "urgent",
      data: {
        url: absoluteUrl(base, actionUrl),
        id: notificationId,
        notificationId,
        type: String(notification?.type || ""),
        category: String(notification?.category || ""),
        priority: pushPriority,
        createdAt: createdAtIso,
      },
    };

    const deliveries = await Promise.all(subscriptions.map(async (subscription) => {
      const claim = await claimDelivery(notificationId, subscription.endpoint);
      claim.notificationId = notificationId;
      if (!claim.claimed) {
        duplicateSkips += 1;
        return false;
      }

      try {
        await pushUtility.sendPushToSubscription(subscription, payload, sendOptions);
        await markDeliverySent(claim).catch((error) => {
          console.warn("[Push] Could not record successful delivery:", error.message);
        });
        sent += 1;
        return true;
      } catch (error) {
        await markDeliveryFailed(claim, error);
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await query("DELETE FROM push_subscriptions WHERE endpoint = $1", [subscription.endpoint])
            .catch((cleanupError) => console.warn("[Push] Could not remove expired subscription:", cleanupError.message));
        } else {
          console.warn("[Push] Delivery failed:", {
            statusCode: error?.statusCode || null,
            message: error?.message || "Unknown push error",
          });
        }
        return false;
      }
    }));

    void deliveries;
  }

  return { sent, total: rows.length, duplicateSkips };
}

module.exports = {
  deliverNotificationPush,
  isImportantBrowserPush,
  normalizeActionUrl,
};
