// backend/controllers/notificationController.js
"use strict";

const { query } = require("../config/db");
const logger    = require("../utils/logger");

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

/**
 * Build the WHERE clause for scope-aware notification queries.
 * A user sees:
 *   1. Notifications addressed directly to them (by user_id OR user_email)
 *   2. Broadcast notifications  (target_scope = 'all')
 *   3. Role-broadcast           (target_scope = 'role' AND target_role = user.role)
 * AND the row must not be soft-deleted or expired.
 */
const userScopeWhere = (userId, userEmail, userRole) => ({
  sql: `
    deleted_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (
      user_id    = $1
      OR user_email = $2
      OR target_scope = 'all'
      OR (target_scope = 'role' AND target_role = $3)
    )
  `,
  params: [userId, userEmail, userRole],
});

const toInt = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (v, min, max) => Math.min(Math.max(toInt(v, min), min), max);

/* ═══════════════════════════════════════════════════════════════
   ── USER ENDPOINTS ──────────────────────────────────────────
   ═══════════════════════════════════════════════════════════════ */

/**
 * GET /api/notifications
 * Query: ?page=1&limit=20&tab=all|booking|system|unread
 */
const getUserNotifications = async (req, res) => {
  try {
    const userId    = req.user.id;
    const userEmail = req.user.email || "";
    const userRole  = req.user.role  || "user";

    const limit  = clamp(req.query.limit, 1, 100);
    const page   = clamp(req.query.page,  1, 10_000);
    const offset = (page - 1) * limit;
    const tab    = req.query.tab || "all";

    /* Build extra filter for tabs */
    let tabFilter = "";
    if (tab === "unread")  tabFilter = "AND is_read = false";
    if (tab === "booking") tabFilter = "AND category = 'booking'";
    if (tab === "system")  tabFilter = "AND category = 'system'";

    const { sql: scopeWhere, params: scopeParams } =
      userScopeWhere(userId, userEmail, userRole);

    /* Dynamic param index offset ($4, $5, …) */
    const limitIdx  = scopeParams.length + 1;
    const offsetIdx = scopeParams.length + 2;

    const dataSQL = `
      SELECT
        id, user_id, type, category, title, message,
        action_url, action_label, image_url, metadata,
        priority, is_read, read_at, reaction, reacted_at,
        reply_text, replied_at, admin_reply, admin_replied_at,
        target_scope, created_at, updated_at
      FROM  notifications
      WHERE ${scopeWhere}
        ${tabFilter}
      ORDER BY created_at DESC
      LIMIT  $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const countSQL = `
      SELECT COUNT(*)::INT AS total
      FROM   notifications
      WHERE  ${scopeWhere}
        ${tabFilter}
    `;

    const unreadSQL = `
      SELECT COUNT(*)::INT AS unread
      FROM   notifications
      WHERE  ${scopeWhere}
        AND is_read = false
    `;

    const [dataRes, countRes, unreadRes] = await Promise.all([
      query(dataSQL,   [...scopeParams, limit, offset]),
      query(countSQL,  scopeParams),
      query(unreadSQL, scopeParams),
    ]);

    const total       = countRes.rows[0]?.total   ?? 0;
    const unreadCount = unreadRes.rows[0]?.unread  ?? 0;
    const notifications = dataRes.rows;

    /* ── Grouping for the frontend hook ── */
    const grouped = {
      all:     notifications,
      booking: notifications.filter((n) => n.category === "booking"),
      system:  notifications.filter((n) => n.category === "system"),
      unread:  notifications.filter((n) => !n.is_read),
    };

    /* ── Trip alerts (confirmed bookings in the next 14 days) ── */
    const tripAlertsRes = await query(
      `SELECT
         b.id, b.travel_date, b.destination_id, b.full_name,
         d.name AS destination_name
       FROM   bookings b
       LEFT   JOIN destinations d ON d.id = b.destination_id
       WHERE  b.user_id      = $1
         AND  b.status       = 'confirmed'
         AND  b.travel_date  >= CURRENT_DATE
         AND  b.travel_date  <= CURRENT_DATE + INTERVAL '14 days'
       ORDER  BY b.travel_date ASC
       LIMIT  10`,
      [userId],
    ).catch(() => ({ rows: [] }));

    const tripAlerts = tripAlertsRes.rows.map((b) => {
      const daysUntil = Math.ceil(
        (new Date(b.travel_date) - Date.now()) / 86_400_000,
      );
      return {
        id:         `trip-${b.id}`,
        bookingId:  b.id,
        travelDate: b.travel_date,
        message:    daysUntil === 0
          ? `✈️ Your trip to ${b.destination_name || "your destination"} is TODAY!`
          : daysUntil === 1
            ? `✈️ Your trip to ${b.destination_name || "your destination"} is TOMORROW!`
            : `✈️ ${daysUntil} days until your trip to ${b.destination_name || "your destination"}`,
        type: daysUntil <= 1 ? "urgent" : daysUntil <= 3 ? "warning" : "info",
      };
    });

    return res.json({
      success: true,
      data: {
        notifications,
        grouped,
        tripAlerts,
        unreadCount,
        total,
        page,
        limit,
        hasMore: offset + notifications.length < total,
        pages:   Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error("[Notifications] getUserNotifications error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/notifications/unread-count
 */
const getUnreadCount = async (req, res) => {
  try {
    const userId    = req.user.id;
    const userEmail = req.user.email || "";
    const userRole  = req.user.role  || "user";

    const { sql: scopeWhere, params } =
      userScopeWhere(userId, userEmail, userRole);

    const result = await query(
      `SELECT COUNT(*)::INT AS count
       FROM   notifications
       WHERE  ${scopeWhere}
         AND  is_read = false`,
      params,
    );

    return res.json({ success: true, count: result.rows[0]?.count ?? 0 });
  } catch (err) {
    logger.error("[Notifications] getUnreadCount error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PATCH /api/notifications/:id/read
 */
const markOneRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await query(
      `UPDATE notifications
       SET    is_read = true, read_at = NOW(), updated_at = NOW()
       WHERE  id      = $1
         AND  (user_id = $2 OR user_email = $3 OR target_scope != 'individual')
         AND  deleted_at IS NULL
       RETURNING id, is_read, read_at`,
      [id, userId, req.user.email || ""],
    );

    if (!result.rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found" });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error("[Notifications] markOneRead error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PATCH /api/notifications/mark-all-read
 */
const markAllRead = async (req, res) => {
  try {
    const userId    = req.user.id;
    const userEmail = req.user.email || "";
    const userRole  = req.user.role  || "user";

    const result = await query(
      `UPDATE notifications
       SET    is_read = true, read_at = NOW(), updated_at = NOW()
       WHERE  is_read     = false
         AND  deleted_at  IS NULL
         AND  (
           user_id      = $1
           OR user_email = $2
           OR target_scope = 'all'
           OR (target_scope = 'role' AND target_role = $3)
         )`,
      [userId, userEmail, userRole],
    );

    return res.json({
      success: true,
      updated: result.rowCount,
      message: `${result.rowCount} notification(s) marked as read`,
    });
  } catch (err) {
    logger.error("[Notifications] markAllRead error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PATCH /api/notifications/:id/react
 * body: { reaction: 'like' | null }
 */
const reactToNotification = async (req, res) => {
  try {
    const { id }       = req.params;
    const { reaction } = req.body;
    const userId       = req.user.id;

    const allowed = [null, "like", "love", "laugh", "sad", "angry"];
    if (!allowed.includes(reaction)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid reaction" });
    }

    const result = await query(
      `UPDATE notifications
       SET    reaction    = $1,
              reacted_at  = CASE WHEN $1 IS NOT NULL THEN NOW() ELSE NULL END,
              updated_at  = NOW()
       WHERE  id        = $2
         AND  (user_id  = $3 OR user_email = $4)
         AND  deleted_at IS NULL
       RETURNING id, reaction, reacted_at`,
      [reaction, id, userId, req.user.email || ""],
    );

    if (!result.rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found" });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error("[Notifications] reactToNotification error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/notifications/:id/reply
 * body: { text: string }
 */
const replyToNotification = async (req, res) => {
  try {
    const { id }   = req.params;
    const { text } = req.body;
    const userId   = req.user.id;

    if (!text?.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Reply text is required" });
    }
    if (text.length > 2000) {
      return res
        .status(400)
        .json({ success: false, message: "Reply too long (max 2000 chars)" });
    }

    const result = await query(
      `UPDATE notifications
       SET    reply_text  = $1,
              replied_at  = NOW(),
              updated_at  = NOW()
       WHERE  id        = $2
         AND  (user_id  = $3 OR user_email = $4)
         AND  deleted_at IS NULL
         AND  reply_text IS NULL
       RETURNING id, reply_text, replied_at`,
      [text.trim(), id, userId, req.user.email || ""],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Notification not found or already replied",
      });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error("[Notifications] replyToNotification error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * DELETE /api/notifications/:id   (soft-delete)
 */
const deleteOne = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await query(
      `UPDATE notifications
       SET    deleted_at = NOW(), updated_at = NOW()
       WHERE  id       = $1
         AND  (user_id = $2 OR user_email = $3)
         AND  deleted_at IS NULL
       RETURNING id`,
      [id, userId, req.user.email || ""],
    );

    if (!result.rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found" });
    }

    return res.json({ success: true, message: "Notification dismissed" });
  } catch (err) {
    logger.error("[Notifications] deleteOne error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * DELETE /api/notifications/clear-all  (soft-delete all mine)
 */
const clearAll = async (req, res) => {
  try {
    const userId    = req.user.id;
    const userEmail = req.user.email || "";

    const result = await query(
      `UPDATE notifications
       SET    deleted_at = NOW(), updated_at = NOW()
       WHERE  (user_id = $1 OR user_email = $2)
         AND  deleted_at IS NULL`,
      [userId, userEmail],
    );

    return res.json({
      success: true,
      deleted: result.rowCount,
      message: `${result.rowCount} notification(s) cleared`,
    });
  } catch (err) {
    logger.error("[Notifications] clearAll error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ═══════════════════════════════════════════════════════════════
   ── ADMIN ENDPOINTS ─────────────────────────────────────────
   ═══════════════════════════════════════════════════════════════ */

/**
 * GET /api/admin/notifications?limit=50&page=1&type=&search=
 */
const adminGetNotifications = async (req, res) => {
  try {
    const limit  = clamp(req.query.limit,  1, 200);
    const page   = clamp(req.query.page,   1, 10_000);
    const offset = (page - 1) * limit;

    const conditions = ["deleted_at IS NULL"];
    const params     = [];

    if (req.query.type) {
      params.push(req.query.type);
      conditions.push(`type = $${params.length}`);
    }
    if (req.query.scope) {
      params.push(req.query.scope);
      conditions.push(`target_scope = $${params.length}`);
    }
    if (req.query.unread === "true") {
      conditions.push("is_read = false");
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      const i = params.length;
      conditions.push(
        `(title ILIKE $${i} OR message ILIKE $${i} OR user_email ILIKE $${i})`,
      );
    }

    const where    = conditions.join(" AND ");
    const pLimit   = params.length + 1;
    const pOffset  = params.length + 2;

    const [dataRes, countRes, unreadRes] = await Promise.all([
      query(
        `SELECT
           id, user_id, user_email, sender_type, sender_name,
           type, category, title, message,
           action_url, action_label, priority,
           is_read, read_at, reaction, reply_text, admin_reply,
           target_scope, target_role, target_segment,
           email_sent, push_sent, created_at, updated_at
         FROM  notifications
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT  $${pLimit}
         OFFSET $${pOffset}`,
        [...params, limit, offset],
      ),
      query(
        `SELECT COUNT(*)::INT AS total FROM notifications WHERE ${where}`,
        params,
      ),
      query(
        `SELECT COUNT(*)::INT AS count FROM notifications
         WHERE deleted_at IS NULL AND is_read = false`,
        [],
      ),
    ]);

    return res.json({
      success: true,
      data:    dataRes.rows,
      unreadCount: unreadRes.rows[0]?.count ?? 0,
      pagination: {
        page,
        limit,
        total:   countRes.rows[0]?.total ?? 0,
        pages:   Math.ceil((countRes.rows[0]?.total ?? 0) / limit),
        hasMore: offset + dataRes.rows.length < (countRes.rows[0]?.total ?? 0),
      },
    });
  } catch (err) {
    logger.error("[Admin Notifications] getAll error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/admin/notifications/unread-count
 */
const adminGetUnreadCount = async (req, res) => {
  try {
    const result = await query(
      `SELECT COUNT(*)::INT AS count
       FROM   notifications
       WHERE  deleted_at IS NULL AND is_read = false`,
      [],
    );
    return res.json({ success: true, count: result.rows[0]?.count ?? 0 });
  } catch (err) {
    logger.error("[Admin Notifications] unreadCount error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/admin/notifications   — create / broadcast
 * body: {
 *   title, message, type, category, priority,
 *   target_scope, target_role, target_segment,
 *   user_id?, user_email?,
 *   action_url?, action_label?, image_url?,
 *   expires_at?, metadata?
 * }
 */
const adminCreateNotification = async (req, res) => {
  try {
    const {
      title, message, type = "general", category = "general",
      priority = "normal", target_scope = "individual",
      target_role, target_segment,
      user_id, user_email,
      action_url, action_label, image_url,
      expires_at, metadata = {},
    } = req.body;

    if (!title?.trim())   return res.status(400).json({ success: false, message: "Title required" });
    if (!message?.trim()) return res.status(400).json({ success: false, message: "Message required" });

    if (target_scope === "individual" && !user_id && !user_email) {
      return res.status(400).json({
        success: false,
        message: "user_id or user_email required for individual notifications",
      });
    }

    const result = await query(
      `INSERT INTO notifications (
         user_id, user_email, sender_type, sender_id, sender_name,
         type, category, title, message,
         action_url, action_label, image_url,
         priority, target_scope, target_role, target_segment,
         metadata, expires_at, created_at, updated_at
       ) VALUES (
         $1,$2,'admin',$3,$4,
         $5,$6,$7,$8,
         $9,$10,$11,
         $12,$13,$14,$15,
         $16,$17,NOW(),NOW()
       ) RETURNING *`,
      [
        user_id   || null,
        user_email || null,
        req.user.id,
        req.user.fullName || req.user.full_name || req.user.email,
        type, category,
        title.trim(), message.trim(),
        action_url  || null,
        action_label || null,
        image_url   || null,
        priority, target_scope,
        target_role    || null,
        target_segment || null,
        JSON.stringify(metadata),
        expires_at || null,
      ],
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error("[Admin Notifications] create error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PATCH /api/admin/notifications/:id/read
 */
const adminMarkOneRead = async (req, res) => {
  try {
    const result = await query(
      `UPDATE notifications
       SET    is_read = true, read_at = NOW(), updated_at = NOW()
       WHERE  id = $1 AND deleted_at IS NULL
       RETURNING id, is_read, read_at`,
      [req.params.id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error("[Admin Notifications] markRead error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PATCH /api/admin/notifications/mark-all-read
 */
const adminMarkAllRead = async (req, res) => {
  try {
    const result = await query(
      `UPDATE notifications
       SET    is_read = true, read_at = NOW(), updated_at = NOW()
       WHERE  is_read = false AND deleted_at IS NULL`,
      [],
    );
    return res.json({
      success: true,
      updated: result.rowCount,
      message: `${result.rowCount} marked as read`,
    });
  } catch (err) {
    logger.error("[Admin Notifications] markAllRead error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/admin/notifications/:id/reply
 * body: { reply: string }
 */
const adminReplyToNotification = async (req, res) => {
  try {
    const { id }    = req.params;
    const { reply } = req.body;

    if (!reply?.trim()) {
      return res.status(400).json({ success: false, message: "Reply is required" });
    }

    const result = await query(
      `UPDATE notifications
       SET    admin_reply      = $1,
              admin_replied_at = NOW(),
              admin_replied_by = $2,
              updated_at       = NOW()
       WHERE  id = $3 AND deleted_at IS NULL
       RETURNING id, admin_reply, admin_replied_at`,
      [reply.trim(), req.user.id, id],
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error("[Admin Notifications] reply error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * DELETE /api/admin/notifications/:id  (hard delete — admin only)
 */
const adminDeleteOne = async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM notifications WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    return res.json({ success: true, message: "Deleted" });
  } catch (err) {
    logger.error("[Admin Notifications] delete error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * DELETE /api/admin/notifications/bulk-delete
 * body: { ids: number[] }
 */
const adminBulkDelete = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, message: "ids[] required" });
    }

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
    const result = await query(
      `DELETE FROM notifications WHERE id IN (${placeholders}) RETURNING id`,
      ids,
    );

    return res.json({
      success: true,
      deleted: result.rowCount,
      message: `${result.rowCount} notification(s) deleted`,
    });
  } catch (err) {
    logger.error("[Admin Notifications] bulkDelete error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ═══════════════════════════════════════════════════════════════
   UTILITY — called internally by other controllers
   ═══════════════════════════════════════════════════════════════ */

/**
 * createNotification({ userId?, userEmail?, type, category, title, message, ... })
 * Safe to fire-and-forget:  createNotification({...}).catch(() => {})
 */
const createNotification = async ({
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
  if (!title || !message) throw new Error("title and message are required");

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
     ) RETURNING id`,
    [
      userId, userEmail, senderType, senderId, senderName,
      type, category, title, message,
      actionUrl, actionLabel, imageUrl,
      priority, targetScope, targetRole, targetSegment,
      JSON.stringify(metadata), expiresAt,
    ],
  );

  return result.rows[0];
};

/**
 * broadcastNotification({ type, category, title, message, targetScope, targetRole })
 * Sends to everyone (targetScope='all') or a role group.
 */
const broadcastNotification = async ({
  type        = "system",
  category    = "system",
  title,
  message,
  targetScope = "all",
  targetRole  = null,
  actionUrl   = null,
  actionLabel = null,
  priority    = "normal",
  metadata    = {},
}) => {
  return createNotification({
    senderType:  "system",
    senderName:  "Altuvera",
    type,
    category,
    title,
    message,
    targetScope,
    targetRole,
    actionUrl,
    actionLabel,
    priority,
    metadata,
  });
};

/* ═══════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════ */
module.exports = {
  /* User */
  getUserNotifications,
  getUnreadCount,
  markOneRead,
  markAllRead,
  reactToNotification,
  replyToNotification,
  deleteOne,
  clearAll,

  /* Admin */
  adminGetNotifications,
  adminGetUnreadCount,
  adminCreateNotification,
  adminMarkOneRead,
  adminMarkAllRead,
  adminReplyToNotification,
  adminDeleteOne,
  adminBulkDelete,

  /* Internal utility */
  createNotification,
  broadcastNotification,
};