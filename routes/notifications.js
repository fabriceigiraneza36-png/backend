// backend/routes/notificationRoutes.js
"use strict";

const express = require("express");
const { query } = require("../config/db");
const logger  = require("../utils/logger");

let sendEmail = null;
try {
  const eu = require("../utils/email");
  sendEmail = typeof eu.sendEmail === "function" ? eu.sendEmail : null;
} catch { /* email not configured */ }

/* ─────────────────────────────────────────────────────────────
   AUTH MIDDLEWARE — resolve from whatever your project uses
───────────────────────────────────────────────────────────────*/
let protect;

try {
  // Try the most common paths in your project.
  // NOTE: only pick a `protect` handler here — never pick `adminOnly`
  // (it is async and takes no role args, so using it as restrictTo(...)
  // returns a Promise and crashes Express route registration).
  const candidates = [
    "../middleware/authMiddleware",
    "../middleware/auth",
    "../middleware/userAuth",
  ];
  for (const p of candidates) {
    try {
      const m = require(p);
      protect    = protect || m.protect || m.authenticate || m.verifyToken || m.auth;
      if (protect) break;
    } catch { /* try next */ }
  }
} catch { /* fall through to minimal fallback */ }

// Minimal JWT fallback so server always boots
if (!protect) {
  const jwt = require("jsonwebtoken");
  protect = (req, res, next) => {
    const raw =
      (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim() ||
      req.cookies?.token;
    if (!raw)
      return res.status(401).json({ success: false, message: "Unauthorized" });
    try {
      req.user = jwt.verify(raw, process.env.JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }
  };
}

/* Role guard factory.
   Accepts role via req.user.role OR req.user.type (admin users may carry
   either). Always synchronous so it can be used directly as Express
   middleware: router.get('/admin', protect, restrictTo('admin','manager'), ...) */
const restrictTo = (...roles) => {
  const allowed = new Set(roles);
  return (req, res, next) => {
    const role = req.user?.role || req.user?.type || "";
    if (!allowed.has(role))
      return res.status(403).json({ success: false, message: "Forbidden" });
    next();
  };
};

/* ─────────────────────────────────────────────────────────────
   SMALL HELPERS
───────────────────────────────────────────────────────────────*/
const toInt = (v, fb = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fb;
};
const clamp = (v, mn, mx) => Math.min(Math.max(toInt(v, mn), mn), mx);

/* ── Email helper ────────────────────────────────────────────────────────────── */
const sendNotificationEmail = async (notif, recipientEmail, recipientName) => {
  if (!sendEmail || !recipientEmail) return;

  try {
    const subject = notif.title || "New notification from Altuvera";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #0f172a;">
        <h2 style="color: #059669; margin-bottom: 12px;">${notif.title}</h2>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">${notif.message}</p>
        ${notif.action_url ? `<a href="${notif.action_url}" style="display: inline-block; padding: 10px 20px; background: #059669; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 700;">${notif.action_label || 'View Details'}</a>` : ''}
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">You received this email because you have email notifications enabled in your Altuvera account settings.</p>
      </div>
    `;

    await sendEmail({
      to: recipientEmail,
      subject,
      html,
    });

    // Mark email as sent
    await query(
      `UPDATE notifications SET email_sent = true, email_sent_at = NOW() WHERE id = $1`,
      [notif.id],
    ).catch(() => {});
  } catch (err) {
    logger.warn("[Notifications] sendNotificationEmail:", err.message);
  }
};

const getUserEmailsForScope = async (targetScope, targetRole, excludeUserId) => {
  const conditions = ["u.email IS NOT NULL", "u.email != ''"];
  const params = [];

  if (targetScope === "role" && targetRole) {
    conditions.push(`u.role = $${params.length + 1}`);
    params.push(targetRole);
  }

  // Exclude the creator if needed
  if (excludeUserId) {
    conditions.push(`u.id != $${params.length + 1}`);
    params.push(excludeUserId);
  }

  const where = conditions.join(" AND ");

  const result = await query(
    `SELECT u.id, u.email, u.full_name, u.preferences
       FROM users u
      WHERE ${where}
        AND u.preferences->>'emailNotifications' IS DISTINCT FROM 'false'`,
    params,
  );

  return result.rows.filter((row) => {
    try {
      const prefs = row.preferences && typeof row.preferences === "object" ? row.preferences : {};
      return prefs.emailNotifications !== false;
    } catch {
      return true;
    }
  });
};

/**
 * WHERE clause that returns rows a user is entitled to see:
 *   • their own individual notifications
 *   • broadcast-to-all
 *   • role broadcasts matching their role
 *   • not soft-deleted / not expired
 */
const userScopeSQL = (userId, userEmail, userRole) => ({
  sql: `
    deleted_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (
      user_id       = $1
      OR user_email = $2
      OR target_scope = 'all'
      OR (target_scope = 'role' AND target_role = $3)
    )
  `,
  params: [userId, userEmail || "", userRole || "user"],
});

/* ─────────────────────────────────────────────────────────────
   SOCKET EMIT HELPER
───────────────────────────────────────────────────────────────*/
const emitNotification = (req, notif) => {
  try {
    const io = req.app?.get?.("io");
    if (!io) return;
    const { target_scope, target_role, user_id } = notif;
    if (target_scope === "all") {
      io.to("all-users").emit("notification:new", notif);
      io.to("admins").emit("notification:new", notif);
    } else if (target_scope === "role" && target_role) {
      io.to(`role-${target_role}`).emit("notification:new", notif);
    } else if (user_id) {
      io.to(`user-${user_id}`).emit("notification:new", notif);
    }
  } catch (err) {
    logger.warn("[Notifications] emitNotification:", err.message);
  }
};

/* ─────────────────────────────────────────────────────────────
   INTERNAL CREATE UTILITY
   Exported so server.js socket handler can use it directly.
───────────────────────────────────────────────────────────────*/
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

/* Export so server.js socket handler can import it */
module.exports.createNotificationInternal = createNotificationInternal;

/* ═══════════════════════════════════════════════════════════════
   ROUTER

   Mounted in server.js as:
     app.use('/api/notifications',       notificationsRouter)
     app.use('/api/admin/notifications', notificationsRouter)  ← alias

   URL map (all relative to mount point):
   ┌──────────────────────────────────────┬────────────────────────────┐
   │ Full URL                             │ Who calls it               │
   ├──────────────────────────────────────┼────────────────────────────┤
   │ GET  /api/notifications/my           │ useNotifications.js (user) │
   │ GET  /api/notifications/my/unread-.. │ useNotifications.js (user) │
   │ GET  /api/notifications/admin        │ NotificationContext (admin) │
   │ GET  /api/notifications/admin/unr..  │ NotificationContext (admin) │
   │ GET  /api/admin/notifications        │ Sidebar (admin panel)      │
   │ GET  /api/admin/notifications/unr..  │ Sidebar (admin panel)      │
   │ POST /api/notifications              │ NotificationContext (admin) │
   │ PATCH /api/notifications/mark-all-.. │ both                       │
   │ PATCH /api/notifications/:id/read   │ both                       │
   │ PATCH /api/notifications/:id/react  │ user app                   │
   │ POST  /api/notifications/:id/reply  │ both                       │
   │ DELETE /api/notifications/clear-all │ both                       │
   │ DELETE /api/notifications/:id       │ both                       │
   └──────────────────────────────────────┴────────────────────────────┘
═══════════════════════════════════════════════════════════════*/
const router = express.Router();

/* ══════════════════════════════════════════════════════════════
   USER — GET /my
   Called as: GET /api/notifications/my?page=1&limit=20&tab=all
══════════════════════════════════════════════════════════════*/
router.get("/my", protect, async (req, res) => {
  try {
    const userId    = req.user.id;
    const userEmail = req.user.email || "";
    const userRole  = req.user.role  || "user";
    const limit     = clamp(req.query.limit,  1, 100);
    const page      = clamp(req.query.page,   1, 9999);
    const offset    = (page - 1) * limit;
    const tab       = req.query.tab || "all";

    let tabFilter = "";
    if (tab === "unread")  tabFilter = "AND is_read = false";
    if (tab === "booking") tabFilter = "AND category = 'booking'";
    if (tab === "system")  tabFilter = "AND category = 'system'";

    const { sql: sw, params: sp } = userScopeSQL(userId, userEmail, userRole);
    const lIdx = sp.length + 1;
    const oIdx = sp.length + 2;

    const [dataRes, countRes, unreadRes] = await Promise.all([
      query(
        `SELECT id, user_id, type, category, title, message,
                action_url, action_label, image_url, metadata,
                priority, is_read, read_at, reaction, reacted_at,
                reply_text, replied_at, admin_reply, admin_replied_at,
                target_scope, created_at, updated_at
           FROM notifications
          WHERE ${sw} ${tabFilter}
          ORDER BY created_at DESC
          LIMIT $${lIdx} OFFSET $${oIdx}`,
        [...sp, limit, offset],
      ),
      query(
        `SELECT COUNT(*)::INT AS total FROM notifications
          WHERE ${sw} ${tabFilter}`,
        sp,
      ),
      query(
        `SELECT COUNT(*)::INT AS cnt FROM notifications
          WHERE ${sw} AND is_read = false`,
        sp,
      ),
    ]);

    const total       = countRes.rows[0]?.total ?? 0;
    const unreadCount = unreadRes.rows[0]?.cnt   ?? 0;

    /* Trip alerts — confirmed bookings in next 14 days */
    const tripRes = await query(
      `SELECT b.id, b.travel_date, b.booking_number,
              COALESCE(d.name, b.destination_name, 'Your Adventure') AS destination_name
         FROM bookings b
         LEFT JOIN destinations d ON d.id = b.destination_id
        WHERE b.user_id     = $1
          AND b.status      = 'confirmed'
          AND b.travel_date >= CURRENT_DATE
          AND b.travel_date <= CURRENT_DATE + INTERVAL '14 days'
        ORDER BY b.travel_date ASC
        LIMIT 10`,
      [userId],
    ).catch(() => ({ rows: [] }));

    const tripAlerts = tripRes.rows.map((b) => {
      const days = Math.ceil(
        (new Date(b.travel_date) - Date.now()) / 86_400_000,
      );
      return {
        id:         `trip-${b.id}`,
        bookingId:  b.id,
        travelDate: b.travel_date,
        message:
          days === 0
            ? `✈️ Your trip to ${b.destination_name} is TODAY!`
            : days === 1
              ? `✈️ Your trip to ${b.destination_name} is TOMORROW!`
              : `✈️ ${days} days until your trip to ${b.destination_name}`,
        type: days <= 1 ? "urgent" : days <= 3 ? "warning" : "info",
      };
    });

    return res.json({
      success:      true,
      data:         dataRes.rows,
      tripAlerts,
      unread_count: unreadCount,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
        has_more:    offset + dataRes.rows.length < total,
      },
    });
  } catch (err) {
    logger.error("[Notifications] GET /my:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   USER — GET /my/unread-count
══════════════════════════════════════════════════════════════*/
router.get("/my/unread-count", protect, async (req, res) => {
  try {
    const { sql: sw, params: sp } = userScopeSQL(
      req.user.id, req.user.email, req.user.role,
    );
    const result = await query(
      `SELECT COUNT(*)::INT AS count FROM notifications
        WHERE ${sw} AND is_read = false`,
      sp,
    );
    return res.json({ success: true, count: result.rows[0]?.count ?? 0 });
  } catch (err) {
    logger.error("[Notifications] GET /my/unread-count:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   ADMIN — GET /admin
   ⚠️  Must be BEFORE /:id routes so 'admin' is not parsed as an id
   Called as:
     GET /api/notifications/admin          (NotificationContext)
     GET /api/admin/notifications          (Sidebar — via alias mount)
══════════════════════════════════════════════════════════════*/
router.get(
  "/admin",
  protect,
  restrictTo("admin", "manager"),
  async (req, res) => {
    try {
      const limit  = clamp(req.query.limit, 1, 200);
      const page   = clamp(req.query.page,  1, 9999);
      const offset = (page - 1) * limit;

      const conds  = ["deleted_at IS NULL"];
      const params = [];

      if (req.query.type) {
        params.push(req.query.type);
        conds.push(`type = $${params.length}`);
      }
      if (req.query.scope) {
        params.push(req.query.scope);
        conds.push(`target_scope = $${params.length}`);
      }
      if (req.query.unread === "true") conds.push("is_read = false");
      if (req.query.search) {
        params.push(`%${req.query.search}%`);
        const i = params.length;
        conds.push(
          `(title ILIKE $${i} OR message ILIKE $${i} OR user_email ILIKE $${i})`,
        );
      }

      const where = conds.join(" AND ");
      const lIdx  = params.length + 1;
      const oIdx  = params.length + 2;

      const [dataRes, countRes, unreadRes] = await Promise.all([
        query(
          `SELECT id, user_id, user_email, sender_type, sender_name,
                  type, category, title, message,
                  action_url, action_label, priority,
                  is_read, read_at, reaction, reply_text, admin_reply,
                  target_scope, target_role, email_sent, created_at, updated_at
             FROM notifications
            WHERE ${where}
            ORDER BY created_at DESC
            LIMIT $${lIdx} OFFSET $${oIdx}`,
          [...params, limit, offset],
        ),
        query(
          `SELECT COUNT(*)::INT AS total FROM notifications WHERE ${where}`,
          params,
        ),
        query(
          `SELECT COUNT(*)::INT AS cnt FROM notifications
            WHERE deleted_at IS NULL AND is_read = false`,
          [],
        ),
      ]);

      const total = countRes.rows[0]?.total ?? 0;

      return res.json({
        success:      true,
        data:         dataRes.rows,
        unread_count: unreadRes.rows[0]?.cnt ?? 0,
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.ceil(total / limit),
          has_more:    offset + dataRes.rows.length < total,
        },
      });
    } catch (err) {
      logger.error("[Notifications] GET /admin:", err.message);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

/* ══════════════════════════════════════════════════════════════
   ADMIN — GET /admin/unread-count
   ⚠️  Must be BEFORE /:id routes
   Called as:
     GET /api/notifications/admin/unread-count   (NotificationContext)
     GET /api/admin/notifications/unread-count   (Sidebar — via alias)
══════════════════════════════════════════════════════════════*/
router.get(
  "/admin/unread-count",
  protect,
  restrictTo("admin", "manager"),
  async (req, res) => {
    try {
      const result = await query(
        `SELECT COUNT(*)::INT AS count FROM notifications
          WHERE deleted_at IS NULL AND is_read = false`,
        [],
      );
      return res.json({ success: true, count: result.rows[0]?.count ?? 0 });
    } catch (err) {
      logger.error("[Notifications] GET /admin/unread-count:", err.message);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

/* ══════════════════════════════════════════════════════════════
   SHARED BULK — PATCH /mark-all-read
   ⚠️  Must be BEFORE /:id routes
══════════════════════════════════════════════════════════════*/
router.patch("/mark-all-read", protect, async (req, res) => {
  try {
    const userId    = req.user.id;
    const userEmail = req.user.email || "";
    const userRole  = req.user.role  || "user";
    const isAdmin   = ["admin", "manager"].includes(userRole);

    let result;
    if (isAdmin) {
      result = await query(
        `UPDATE notifications
            SET is_read = true, read_at = NOW(), updated_at = NOW()
          WHERE is_read = false AND deleted_at IS NULL`,
        [],
      );
    } else {
      const { sql: sw, params: sp } = userScopeSQL(userId, userEmail, userRole);
      result = await query(
        `UPDATE notifications
            SET is_read = true, read_at = NOW(), updated_at = NOW()
          WHERE ${sw} AND is_read = false`,
        sp,
      );
    }

    return res.json({
      success: true,
      updated: result.rowCount,
      message: `${result.rowCount} notification(s) marked as read`,
    });
  } catch (err) {
    logger.error("[Notifications] PATCH /mark-all-read:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   SHARED BULK — DELETE /clear-all
   ⚠️  Must be BEFORE /:id routes
══════════════════════════════════════════════════════════════*/
router.delete("/clear-all", protect, async (req, res) => {
  try {
    const userId    = req.user.id;
    const userEmail = req.user.email || "";
    const userRole  = req.user.role  || "user";
    const isAdmin   = ["admin", "manager"].includes(userRole);

    let result;
    if (isAdmin) {
      result = await query(
        `UPDATE notifications
            SET deleted_at = NOW(), updated_at = NOW()
          WHERE deleted_at IS NULL`,
        [],
      );
    } else {
      result = await query(
        `UPDATE notifications
            SET deleted_at = NOW(), updated_at = NOW()
          WHERE (user_id = $1 OR user_email = $2)
            AND deleted_at IS NULL`,
        [userId, userEmail],
      );
    }

    return res.json({
      success: true,
      deleted: result.rowCount,
      message: `${result.rowCount} notification(s) cleared`,
    });
  } catch (err) {
    logger.error("[Notifications] DELETE /clear-all:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   ADMIN CREATE — POST /
   Called as: POST /api/notifications  (NotificationContext.sendNotification)
══════════════════════════════════════════════════════════════*/
router.post(
  "/",
  protect,
  restrictTo("admin", "manager"),
  async (req, res) => {
    try {
      const {
        title,
        message,
        type          = "general",
        category      = "general",
        priority      = "normal",
        target_scope  = "individual",
        target_role,
        target_segment,
        user_id,
        user_email,
        action_url,
        action_label,
        image_url,
        expires_at,
        metadata      = {},
      } = req.body;

      if (!title?.trim())
        return res.status(400).json({ success: false, message: "title required" });
      if (!message?.trim())
        return res.status(400).json({ success: false, message: "message required" });
      if (
        target_scope === "individual" &&
        !user_id &&
        !user_email
      ) {
        return res.status(400).json({
          success: false,
          message: "user_id or user_email required for individual scope",
        });
      }

      const notif = await createNotificationInternal({
        userId:        user_id        || null,
        userEmail:     user_email     || null,
        senderType:    "admin",
        senderId:      req.user.id,
        senderName:
          req.user.full_name ||
          req.user.name      ||
          req.user.email     ||
          "Admin",
        type,
        category,
        title,
        message,
        actionUrl:     action_url     || null,
        actionLabel:   action_label   || null,
        imageUrl:      image_url      || null,
        priority,
        targetScope:   target_scope,
        targetRole:    target_role    || null,
        targetSegment: target_segment || null,
        metadata,
        expiresAt:     expires_at     || null,
      });

      emitNotification(req, notif);

      // ── Send email notification respecting user preferences ──────────────
      if (sendEmail) {
        try {
          if (target_scope === "individual") {
            const recipientEmail = notif.user_email || user_email;
            const recipientId = user_id;

            if (recipientEmail) {
              let shouldSend = true;
              if (recipientId) {
                const userPrefs = await query(
                  `SELECT preferences FROM users WHERE id = $1`,
                  [recipientId],
                ).catch(() => ({ rows: [] }));
                const prefs = userPrefs.rows[0]?.preferences || {};
                shouldSend = prefs.emailNotifications !== false;
              }

              if (shouldSend) {
                const userRow = recipientId
                  ? await query(`SELECT full_name FROM users WHERE id = $1`, [recipientId]).catch(() => ({ rows: [] }))
                  : { rows: [] };
                const name = userRow.rows[0]?.full_name || "";
                sendNotificationEmail(notif, recipientEmail, name).catch(() => {});
              }
            }
          } else if (target_scope === "role" && target_role) {
            const users = await getUserEmailsForScope("role", target_role, req.user.id);
            for (const u of users) {
              sendNotificationEmail(notif, u.email, u.full_name || "").catch(() => {});
            }
          } else if (target_scope === "all") {
            const users = await getUserEmailsForScope("all", null, req.user.id);
            for (const u of users) {
              sendNotificationEmail(notif, u.email, u.full_name || "").catch(() => {});
            }
          }
        } catch (emailErr) {
          logger.warn("[Notifications] email dispatch failed:", emailErr.message);
        }
      }

      return res.status(201).json({ success: true, data: notif });
    } catch (err) {
      logger.error("[Notifications] POST /:", err.message);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

/* ══════════════════════════════════════════════════════════════
   PER-ID ROUTES  ← must come AFTER all named-segment routes
══════════════════════════════════════════════════════════════*/

/* PATCH /:id/read */
router.patch("/:id/read", protect, async (req, res) => {
  try {
    const id      = toInt(req.params.id);
    const userId  = req.user.id;
    const isAdmin = ["admin", "manager"].includes(req.user.role);

    const result = await query(
      isAdmin
        ? `UPDATE notifications
              SET is_read = true, read_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING id, is_read, read_at`
        : `UPDATE notifications
              SET is_read = true, read_at = NOW(), updated_at = NOW()
            WHERE id = $1
              AND (user_id = $2 OR user_email = $3
                   OR target_scope IN ('all','role'))
              AND deleted_at IS NULL
            RETURNING id, is_read, read_at`,
      isAdmin ? [id] : [id, userId, req.user.email || ""],
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Not found" });

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error("[Notifications] PATCH /:id/read:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* PATCH /:id/react  body: { reaction } */
router.patch("/:id/react", protect, async (req, res) => {
  try {
    const id       = toInt(req.params.id);
    const { reaction } = req.body;
    const allowed  = [null, "like", "love", "laugh", "sad", "angry"];

    if (!allowed.includes(reaction))
      return res.status(400).json({ success: false, message: "Invalid reaction" });

    const result = await query(
      `UPDATE notifications
          SET reaction   = $1,
              reacted_at = CASE WHEN $1 IS NOT NULL THEN NOW() ELSE NULL END,
              updated_at = NOW()
        WHERE id = $2
          AND (user_id = $3 OR user_email = $4)
          AND deleted_at IS NULL
        RETURNING id, reaction, reacted_at`,
      [reaction, id, req.user.id, req.user.email || ""],
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Not found" });

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error("[Notifications] PATCH /:id/react:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* POST /:id/reply  (user sends reply; admin sends admin_reply) */
router.post("/:id/reply", protect, async (req, res) => {
  try {
    const id      = toInt(req.params.id);
    const userId  = req.user.id;
    const isAdmin = ["admin", "manager"].includes(req.user.role);

    if (isAdmin) {
      /* Admin reply */
      const text = (
        req.body.reply     ||
        req.body.replyText ||
        req.body.text      ||
        ""
      ).trim();
      if (!text)
        return res.status(400).json({ success: false, message: "reply required" });

      const result = await query(
        `UPDATE notifications
            SET admin_reply      = $1,
                admin_replied_at = NOW(),
                admin_replied_by = $2,
                updated_at       = NOW()
          WHERE id = $3 AND deleted_at IS NULL
          RETURNING id, admin_reply, admin_replied_at`,
        [text, userId, id],
      );
      if (!result.rows.length)
        return res.status(404).json({ success: false, message: "Not found" });

      /* Notify the original user via socket */
      try {
        const io = req.app?.get?.("io");
        const nr = await query(
          `SELECT user_id FROM notifications WHERE id = $1`,
          [id],
        ).catch(() => ({ rows: [] }));
        if (io && nr.rows[0]?.user_id) {
          io.to(`user-${nr.rows[0].user_id}`).emit(
            "notification:admin-replied",
            { notificationId: id, adminReply: text },
          );
        }
      } catch { /* non-fatal */ }

      return res.json({ success: true, data: result.rows[0] });
    }

    /* User reply */
    const text = (
      req.body.replyText ||
      req.body.reply     ||
      req.body.text      ||
      ""
    ).trim();
    if (!text)
      return res.status(400).json({ success: false, message: "replyText required" });
    if (text.length > 2000)
      return res.status(400).json({ success: false, message: "Reply too long (max 2000)" });

    const result = await query(
      `UPDATE notifications
          SET reply_text  = $1,
              replied_at  = NOW(),
              updated_at  = NOW()
        WHERE id = $2
          AND (user_id = $3 OR user_email = $4)
          AND deleted_at IS NULL
          AND reply_text IS NULL
        RETURNING id, reply_text, replied_at`,
      [text, id, userId, req.user.email || ""],
    );
    if (!result.rows.length)
      return res.status(404).json({
        success: false,
        message: "Not found or already replied",
      });

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error("[Notifications] POST /:id/reply:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* DELETE /:id  (soft-delete) */
router.delete("/:id", protect, async (req, res) => {
  try {
    const id      = toInt(req.params.id);
    const userId  = req.user.id;
    const isAdmin = ["admin", "manager"].includes(req.user.role);

    const result = await query(
      isAdmin
        ? `UPDATE notifications
              SET deleted_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING id`
        : `UPDATE notifications
              SET deleted_at = NOW(), updated_at = NOW()
            WHERE id = $1
              AND (user_id = $2 OR user_email = $3)
              AND deleted_at IS NULL
            RETURNING id`,
      isAdmin ? [id] : [id, userId, req.user.email || ""],
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Not found" });

    return res.json({ success: true, message: "Notification dismissed" });
  } catch (err) {
    logger.error("[Notifications] DELETE /:id:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ════════════════════════════════════════════════════════════
   ALIAS ROUTER  — /api/admin/notifications/*
   The admin Sidebar/Header bundle calls these exact paths.
   Forward them to the canonical /api/notifications handlers so
   neither client URL shape 404s.
════════════════════════════════════════════════════════════*/
const aliasRouter = express.Router();

aliasRouter.get("/",                (req, res, next) => { req.url = "/admin";        router.handle(req, res, next); });
aliasRouter.get("/unread-count",    (req, res, next) => { req.url = "/admin/unread-count"; router.handle(req, res, next); });
aliasRouter.patch("/read-all",      (req, res, next) => { req.url = "/mark-all-read";  router.handle(req, res, next); });
aliasRouter.patch("/:id/read",      (req, res, next) => { req.url = `/${req.params.id}/read`;    router.handle(req, res, next); });
aliasRouter.delete("/:id",          (req, res, next) => { req.url = `/${req.params.id}`;          router.handle(req, res, next); });
/* also accept the /admin* shape under this alias */
aliasRouter.get("/admin",           (req, res, next) => { req.url = "/admin";        router.handle(req, res, next); });
aliasRouter.get("/admin/unread-count", (req, res, next) => { req.url = "/admin/unread-count"; router.handle(req, res, next); });

module.exports = router;
module.exports.aliasRouter = aliasRouter;