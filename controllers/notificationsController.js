// backend/controllers/notificationsController.js
"use strict";

/*
 * Central notifications engine.
 *
 * Responsibilities:
 *   1. createNotificationInternal(...)  — used by bookingsController & server.js
 *      socket broadcast. Inserts an in-app notification for a user (or a
 *      broadcast/role audience), emits a realtime socket event and (for
 *      individual user notifications) sends an email.
 *   2. Admin activity aggregation — many users doing the SAME activity
 *      (e.g. 10+ bookings, 10+ reviews) are collapsed into ONE compiled
 *      admin notification that lists the participants instead of spamming
 *      the admin dashboard with one row per user.
 *   3. Admin email digests — the compiled admin notification is also emailed
 *      to every admin so it lands in their inbox.
 *
 * Every function is safe to fire-and-forget:  fn({...}).catch(() => {})
 */

const { query }  = require("../config/db");
const logger     = require("../utils/logger");

/* ── Push (optional) ──────────────────────────────────────────────────────── */
let pushUtility = null
try {
  pushUtility = require("../utils/push")
} catch { /* web-push not installed */ }

/* ── Email (optional) ──────────────────────────────────────────────────────── */
let sendEmail = null;
try {
  const eu = require("../utils/email");
  sendEmail = (eu && typeof eu.sendEmail === "function") ? eu.sendEmail : null;
} catch { /* email not configured */ }

/* ── Socket.io (optional) ───────────────────────────────────────────────────── */
const getIO = () => {
  try {
    const socketBus = require("../utils/socketBus");
    const io = socketBus?.getIO?.() || null;
    if (io) return io;
  } catch { /* no socketBus */ }
  // Fallback handled by callers passing req.app.get('io')
  return null;
};

/* ── Helpers ────────────────────────────────────────────────────────────────── */
const toInt = (v, fb = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fb;
};

const ADMIN_ROLES = ["admin", "manager"];

const getAdminRecipients = async () => {
  try {
    const res = await query(
      `SELECT id, email, full_name
         FROM users
        WHERE role = ANY($1)
          AND email IS NOT NULL AND email <> ''
          AND (preferences->>'emailNotifications' IS DISTINCT FROM 'false'
               OR preferences IS NULL)
        ORDER BY id`,
      [ADMIN_ROLES],
    );
    return res.rows.filter((r) => r.email);
  } catch (err) {
    logger.warn("[Notifications] getAdminRecipients:", err.message);
    return [];
  }
};

const sendUserEmail = async (notif, recipientEmail, recipientName) => {
  if (!sendEmail || !recipientEmail) return;
  try {
    await sendEmail({
      to:      recipientEmail,
      subject: notif.title || "New notification from Altuvera",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#0f172a;">
          <h2 style="color:#059669;margin-bottom:12px;">${notif.title || ""}</h2>
          <p style="font-size:16px;line-height:1.6;margin-bottom:20px;">${notif.message || ""}</p>
          ${notif.action_url
            ? `<a href="${notif.action_url}" style="display:inline-block;padding:10px 20px;background:#059669;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">${notif.action_label || "View Details"}</a>`
            : ""}
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>
          <p style="font-size:12px;color:#94a3b8;">You received this email because you have email notifications enabled in your Altuvera account settings.</p>
        </div>`,
    });

    await query(
      `UPDATE notifications SET email_sent = true, email_sent_at = NOW() WHERE id = $1`,
      [notif.id],
    ).catch(() => {});
  } catch (err) {
    logger.warn("[Notifications] sendUserEmail:", err.message);
  }
};

const sendAdminEmail = async (subject, html) => {
  if (!sendEmail) return;
  const admins = await getAdminRecipients();
  await Promise.all(admins.map((a) =>
    sendEmail({
      to:      a.email,
      subject,
      html: html.replace("{{name}}", a.full_name || "Admin"),
    }).catch((e) => logger.warn("[Notifications] admin email failed:", e.message)),
  ));
};

/* ── Realtime emit ───────────────────────────────────────────────────────────── */
const emitNotification = (req, notif) => {
  try {
    const io = req?.app?.get?.("io") || getIO();
    if (!io) return;
    const { target_scope, target_role, user_id } = notif;

    if (target_scope === "all") {
      io.to("all-users").emit("notification:new", notif);
      io.to("admins").emit("notification:new", notif);
      io.to("admin-room").emit("notification:new", notif);
    } else if (target_scope === "admin") {
      io.to("admins").emit("notification:new", notif);
      io.to("admin-room").emit("notification:new", notif);
    } else if (target_scope === "role" && target_role) {
      io.to(`role-${target_role}`).emit("notification:new", notif);
      io.to("admins").emit("notification:new", notif);
    } else if (user_id) {
      io.to(`user-${user_id}`).emit("notification:new", notif);
    }
    if (target_scope !== "admin") {
      io.to("admins").emit("notification:admin-ping", notif);
    }
  } catch (err) {
    logger.warn("[Notifications] emitNotification:", err.message);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   CORE — create one notification row (user / broadcast / admin)
   ═══════════════════════════════════════════════════════════════════════════ */
const insertNotification = async ({
  userId       = null,
  userEmail    = null,
  senderType   = "system",
  senderId     = null,
  senderName   = "Altuvera",
  type         = "general",
  category     = "general",
  title,
  message,
  actionUrl    = null,
  actionLabel  = null,
  imageUrl     = null,
  priority     = "normal",
  targetScope  = "individual",
  targetRole   = null,
  targetSegment = null,
  metadata     = {},
  expiresAt    = null,
}) => {
  if (!title?.trim() || !message?.trim())
    throw new Error("title and message are required");

  const result = await query(
    `INSERT INTO notifications (
        user_id, user_email, sender_type, sender_id, sender_name,
        type, category, title, message,
        action_url, action_label, image_url,
        priority, target_scope, target_role, target_segment,
        metadata, expires_at
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,
        $10,$11,$12,
        $13,$14,$15,$16,
        $17,$18
      ) RETURNING *`,
    [
      userId,        userEmail,    senderType,    senderId,      senderName,
      type,          category,     title.trim(),  message.trim(),
      actionUrl,     actionLabel,  imageUrl,
      priority,      targetScope,  targetRole,    targetSegment,
      JSON.stringify(metadata),    expiresAt,
    ],
  );
  return result.rows[0];
};

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN ACTIVITY BATCH AGGREGATION
   When >= ADMIN_BATCH_THRESHOLD users perform the same activity within
   BATCH_WINDOW_MS, emit ONE compiled admin notification (plus an admin email)
   instead of individual rows.
   ═══════════════════════════════════════════════════════════════════════════ */
const ADMIN_BATCH_THRESHOLD = 10;       // > this many → compile into one
const BATCH_WINDOW_MS       = 5 * 60_000; // 5 minutes

const adminBatch = new Map(); // key -> { type, category, users:[], timer, template }

const listNames = (users, max = 8) => {
  const names = users.slice(0, max).map((u) => u.name || u.email || "Someone");
  if (users.length <= max) return names.join(", ");
  return `${names.join(", ")} and ${users.length - max} more`;
};

const flushAdminBatch = async (key) => {
  const batch = adminBatch.get(key);
  if (!batch) return;
  adminBatch.delete(key);
  if (batch.timer) clearTimeout(batch.timer);

  const { type, category, users, template } = batch;
  if (!users.length) return;

  const count    = users.length;
  const compiled = count > 1;
  const title    = template.title(count);
  const message  = template.message(listNames(users), count);

  try {
    const notif = await insertNotification({
      senderType:  "system",
      senderName:  "Altuvera",
      type,
      category,
      title,
      message,
      targetScope: "admin",
      priority:    "high",
      metadata:    {
        activity:   key,
        count,
        userIds:    users.map((u) => u.id).filter(Boolean),
        compiled:   true,
      },
    });

    emitNotification(null, { ...notif, target_scope: "admin" });

    await sendAdminEmail(
      title,
      `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#0f172a;">
        <h2 style="color:#059669;">{{name}}, ${title}</h2>
        <p style="font-size:16px;line-height:1.6;">${message}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>
        <p style="font-size:12px;color:#94a3b8;">Altuvera Travel — Admin Activity Digest</p>
      </div>`,
    ).catch(() => {});
  } catch (err) {
    logger.warn("[Notifications] flushAdminBatch:", err.message);
  }
};

/**
 * Record a single user's activity for admin visibility.
 * If the same activity reaches the threshold, a single compiled notification
 * is flushed; otherwise a debounced flush runs after BATCH_WINDOW_MS.
 */
const recordAdminActivity = (key, { type, category, user, template }) => {
  if (!key || !template) return;
  let batch = adminBatch.get(key);
  if (!batch) {
    batch = { type, category, users: [], template, timer: null };
    adminBatch.set(key, batch);
  }
  // de-dupe by user id
  const uid = user?.id ?? user?.email;
  if (uid && batch.users.some((u) => (u.id ?? u.email) === uid)) return;
  batch.users.push({
    id:    user?.id    ?? null,
    email: user?.email ?? null,
    name:  user?.name  ?? user?.fullName ?? user?.email ?? "Someone",
  });

  // Spec: notify admin ONCE when MORE THAN the threshold users do the same
  // activity. Compile every participant into a single row.
  if (batch.users.length > ADMIN_BATCH_THRESHOLD) {
    flushAdminBatch(key);
    return;
  }
  if (!batch.timer) {
    batch.timer = setTimeout(() => flushAdminBatch(key), BATCH_WINDOW_MS);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC — createNotificationInternal
   Signature mirrors every call site in the codebase:
   createNotificationInternal({ userId, userEmail, type, category, title,
     message, actionUrl, actionLabel, priority, targetScope, ... ,
     adminActivity?: { key, type, category, template } , actor?: {...} })
   ═══════════════════════════════════════════════════════════════════════════ */
const createNotificationInternal = async ({
  userId        = null,
  userEmail     = null,
  senderType    = "system",
  senderId      = null,
  senderName    = "Altuvera",
  type          = "general",
  category      = "general",
  title,
  message,
  actionUrl     = null,
  actionLabel   = null,
  imageUrl      = null,
  priority      = "normal",
  targetScope   = "individual",
  targetRole    = null,
  targetSegment = null,
  metadata      = {},
  expiresAt     = null,
  req           = null,        // optional — for socket emit via req.app
  actor         = null,        // { id, email, name } of the user who acted
  adminActivity = null,        // { key, type, category, template }
  skipUserEmail = false,
} = {}) => {
  // 1) In-app notification for the user (or audience)
  const notif = await insertNotification({
    userId, userEmail, senderType, senderId, senderName,
    type, category, title, message,
    actionUrl, actionLabel, imageUrl,
    priority, targetScope, targetRole, targetSegment,
    metadata, expiresAt,
  });

  // 2) Realtime
  emitNotification(req, notif);

  // 2b) Push notification (fire-and-forget)
  if (
    pushUtility &&
    (targetScope === "admin" || targetRole === "admin" || targetRole === "manager")
  ) {
    ;(async () => {
      try {
        const { rows } = await query(
          `SELECT endpoint, p256dh, auth FROM push_subscriptions`
        )
        if (rows.length) {
          await pushUtility.sendPushToSubscriptions(rows, {
            title: title || "Altuvera Admin",
            body: message || "",
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            data: {
              url: actionUrl || "/notifications",
              id: notif.id,
            },
            requireInteraction: priority === "high",
          })
        }
      } catch {
        /* non-fatal */
      }
    })()
  }

  // 3) Email the user (only for individual user notifications)
  if (!skipUserEmail && targetScope === "individual" && userEmail) {
    sendUserEmail(notif, userEmail, actor?.name || actor?.fullName).catch(() => {});
  }

  // 4) Admin activity aggregation
  if (adminActivity) {
    recordAdminActivity(adminActivity.key, {
      type:     adminActivity.type     || type,
      category: adminActivity.category || category,
      user:     actor || (userId ? { id: userId, email: userEmail } : null),
      template: adminActivity.template,
    });
  }

  return notif;
};

/* ═══════════════════════════════════════════════════════════════════════════
   CONVENIENCE BUILDERS for common user actions
   ═══════════════════════════════════════════════════════════════════════════ */

/* Booking created — notify the user + aggregate to admins */
const notifyBookingCreated = (booking, user) =>
  createNotificationInternal({
    userId:    user?.id,
    userEmail: user?.email,
    type:      "booking_created",
    category:  "booking",
    title:     "Booking Received! 🎉",
    message:   `Your booking ${booking?.booking_number || ""} is pending review.`,
    actionUrl:    "/my-bookings",
    actionLabel:  "Track Booking",
    priority:  "normal",
    actor:     user,
    adminActivity: {
      key: "booking_created",
      type: "booking_created",
      category: "booking",
      template: {
        title:    (n) => `${n} new booking${n > 1 ? "s" : ""} received`,
        message:  (names, n) =>
          `${n} travellers just requested bookings${n > 1 ? ` (${names})` : ""}.`,
      },
    },
  });

/* Review posted — notify the user + aggregate to admins */
const notifyReviewPosted = (review, user) =>
  createNotificationInternal({
    userId:    user?.id,
    userEmail: user?.email,
    type:      "review_posted",
    category:  "review",
    title:     "Review submitted ✓",
    message:   `Thanks! Your review for "${review?.title || "your experience"}" was posted.`,
    actionUrl:    "/reviews",
    actionLabel:  "View",
    actor:     user,
    adminActivity: {
      key: "review_posted",
      type: "review_posted",
      category: "review",
      template: {
        title:    (n) => `${n} new review${n > 1 ? "s" : ""} posted`,
        message:  (names, n) => `${n} customers left reviews${n > 1 ? ` (${names})` : ""}.`,
      },
    },
  });

/* User registered — welcome the user + notify admins */
const notifyUserRegistered = (user) =>
  createNotificationInternal({
    userId:    user?.id,
    userEmail: user?.email,
    type:      "user_registered",
    category:  "user",
    title:     "Welcome to Altuvera! 🌍",
    message:   "Your account is ready. Start exploring unforgettable adventures.",
    actionUrl:    "/",
    actionLabel:  "Explore",
    actor:     user,
    adminActivity: {
      key: "user_registered",
      type: "user_registered",
      category: "user",
      template: {
        title:    (n) => `${n} new user${n > 1 ? "s" : ""} registered`,
        message:  (names, n) => `${n} new travellers joined${n > 1 ? ` (${names})` : ""}.`,
      },
    },
  });

/* Contact message — notify the user + admins (always single, high priority) */
const notifyContactMessage = (contact, user) =>
  createNotificationInternal({
    userId:    user?.id,
    userEmail: user?.email,
    type:      "contact_message",
    category:  "contact",
    title:     "Message received 💬",
    message:   "We got your message and will reply within 24 hours.",
    actionUrl:    "/contact",
    actionLabel:  "View",
    actor:     user,
    adminActivity: {
      key: "contact_message",
      type: "contact_message",
      category: "contact",
      template: {
        title:    (n) => `${n} new contact message${n > 1 ? "s" : ""}`,
        message:  (names, n) => `${n} new enquiries arrived${n > 1 ? ` (${names})` : ""}.`,
      },
    },
  });

/* Admin broadcast (single, to a scope) */
const broadcastNotification = async ({
  type = "system", category = "system", title, message,
  targetScope = "all", targetRole = null,
  actionUrl = null, actionLabel = null, priority = "normal", metadata = {},
}) => {
  const notif = await insertNotification({
    senderType: "admin", senderName: "Altuvera",
    type, category, title, message,
    targetScope, targetRole, actionUrl, actionLabel, priority, metadata,
  });
  emitNotification(null, notif);

  if (pushUtility && targetScope === "admin") {
    ;(async () => {
      try {
        const { rows } = await query(
          `SELECT endpoint, p256dh, auth FROM push_subscriptions`
        )
        if (rows.length) {
          await pushUtility.sendPushToSubscriptions(rows, {
            title: title || "Altuvera Admin",
            body: message || "",
            icon: "/favicon.ico",
            data: { url: actionUrl || "/notifications", id: notif.id },
          })
        }
      } catch {
        /* non-fatal */
      }
    })()
  }

  return notif;
};

/* ═══════════════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════════════ */
module.exports = {
  createNotificationInternal,
  broadcastNotification,
  notifyBookingCreated,
  notifyReviewPosted,
  notifyUserRegistered,
  notifyContactMessage,
  flushAdminBatch,
  ADMIN_BATCH_THRESHOLD,
};
