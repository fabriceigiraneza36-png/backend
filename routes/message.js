/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MESSAGE ROUTER v2.1
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * KEY CHANGE:
 *   /users and /conversations now use adminOnly instead of adminProtect.
 *   adminProtect is now a pure alias of adminOnly (same flexible token check).
 *   Both middleware names still work — import is explicit here for clarity.
 *
 * Routes:
 *   GET    /api/messages/ping                            — health (no auth)
 *   GET    /api/messages/users                           — conversations (admin)
 *   GET    /api/messages/conversations                   — full list (admin)
 *   GET    /api/messages/conversation/:id/messages       — message history
 *   GET    /api/messages/user/:userId/conversation       — get/create conv
 *   POST   /api/messages/start-with-user                 — start conversation
 *   POST   /api/messages/send                            — HTTP fallback
 *   PATCH  /api/messages/conversation/:id               — update conversation
 *   DELETE /api/messages/:messageId                      — soft-delete message
 */

"use strict";

const router = require("express").Router();
const { query } = require("../config/db");
const {
  protect,
  adminOnly,
  adminProtect,   // alias — same as adminOnly
} = require("../middleware/auth");
const logger = require("../utils/logger");

// ─── Boot-time confirmation (visible in Render.com logs) ─────────────────────
logger.info("[Messages] Router loading…");

// ─── Constants ────────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV !== "production";

const ALLOWED_SORT = new Set([
  "updated_at",
  "created_at",
  "last_message_at",
  "unread_admin",
  "priority",
]);

// ─── Serializers ─────────────────────────────────────────────────────────────

const safeJSON = (v, fb = {}) => {
  if (v === null || v === undefined) return fb;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return fb; }
};

const serializeMessage = (row) => ({
  id:             row.id,
  conversationId: row.conversation_id,
  senderType:     row.sender_type,
  senderId:       row.sender_id,
  senderName:     row.sender_name,
  senderEmail:    row.sender_email,
  senderAvatar:   row.sender_avatar,
  body:           row.body,
  msgType:        row.msg_type || "text",
  isRead:         row.is_read,
  replyToId:      row.reply_to_id,
  metadata:       safeJSON(row.metadata),
  createdAt:      row.created_at,
  updatedAt:      row.updated_at || null,
});

const serializeConversation = (row) => ({
  id:             row.id,
  sessionId:      row.session_id,
  userId:         row.user_id,
  guestName:      row.guest_name,
  guestEmail:     row.guest_email,
  userFullName:   row.user_full_name  || null,
  userEmail:      row.user_email      || null,
  userAvatar:     row.user_avatar     || null,
  channel:        row.channel,
  subject:        row.subject,
  status:         row.status,
  priority:       row.priority,
  assignedAdmin:  row.assigned_admin,
  firstMessage:   row.first_message,
  lastMessage:    row.last_message,
  lastMessageAt:  row.last_message_at,
  unreadUser:     row.unread_user    || 0,
  unreadAdmin:    row.unread_admin   || 0,
  messageCount:   row.message_count !== undefined
    ? parseInt(row.message_count, 10) : undefined,
  tags:           Array.isArray(row.tags) ? row.tags : [],
  metadata:       safeJSON(row.metadata),
  source:         row.source,
  ipAddress:      row.ip_address  || null,
  closedAt:       row.closed_at   || null,
  createdAt:      row.created_at,
  updatedAt:      row.updated_at,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const safeInt = (v, def, min = 1, max = 500) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

/**
 * Determine sender type from req.user.
 * Handles all token shapes (role, type, userType, isAdmin).
 */
const resolveSenderType = (req) => {
  const u = req?.user;
  if (!u) return "user";
  if (
    req.userType    === "admin" ||
    u.type          === "admin" ||
    u.role          === "admin" ||
    u.role          === "superadmin" ||
    u.role          === "super_admin" ||
    u.isAdmin       === true
  ) return "admin";
  return "user";
};

/** Mark all user messages in a conversation as read by admin. Non-fatal. */
const markAdminRead = async (conversationId) => {
  try {
    await query(
      `UPDATE messages
          SET is_read = true, read_at = NOW()
        WHERE conversation_id = $1
          AND sender_type != 'admin'
          AND is_read = false`,
      [conversationId],
    );
    await query(
      `UPDATE conversations SET unread_admin = 0 WHERE id = $1`,
      [conversationId],
    );
  } catch (err) {
    logger.warn("[Messages] markAdminRead non-fatal:", err.message);
  }
};

/** Update conversation last_message summary after a message is sent. */
const updateConvSummary = async (conversationId, body, senderType) => {
  const isUser  = senderType !== "admin";
  const isAdmin = !isUser;
  await query(
    `UPDATE conversations SET
        last_message    = $1,
        last_message_at = NOW(),
        first_message   = COALESCE(first_message, $1),
        unread_admin    = CASE WHEN $2 THEN unread_admin + 1 ELSE unread_admin END,
        unread_user     = CASE WHEN $3 THEN unread_user  + 1 ELSE unread_user  END,
        updated_at      = NOW()
      WHERE id = $4`,
    [body, isUser, isAdmin, conversationId],
  );
};

// ─── PING (public — confirm router is mounted) ────────────────────────────────

router.get("/ping", (_req, res) =>
  res.json({
    success:   true,
    message:   "Messages router is alive ✓",
    timestamp: new Date().toISOString(),
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/messages/users
// Conversation list for the admin sidebar
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/users", adminOnly, async (req, res) => {
  logger.info(
    `[Messages] GET /users | adminId=${req.user?.id} role=${req.user?.role}`,
  );

  try {
    const limit  = safeInt(req.query.limit, 100, 1, 500);
    const page   = safeInt(req.query.page,  1,   1, 9999);
    const offset = (page - 1) * limit;
    const { search, status } = req.query;

    const params = [];
    let pi    = 1;
    let where = "";

    if (search) {
      where +=
        ` AND (u.full_name ILIKE $${pi}` +
        ` OR u.email ILIKE $${pi}` +
        ` OR c.guest_name ILIKE $${pi}` +
        ` OR c.guest_email ILIKE $${pi}` +
        ` OR c.last_message ILIKE $${pi})`;
      params.push(`%${search.trim()}%`);
      pi++;
    }

    if (status && status !== "all") {
      where += ` AND c.status = $${pi}`;
      params.push(status);
      pi++;
    }

    const [data, count] = await Promise.all([
      query(
        `SELECT
            c.id, c.session_id, c.user_id,
            c.guest_name, c.guest_email,
            c.status, c.priority,
            c.last_message, c.last_message_at,
            c.unread_admin, c.unread_user,
            c.source, c.channel, c.subject,
            c.tags, c.metadata,
            c.assigned_admin, c.first_message,
            c.ip_address, c.closed_at,
            c.created_at, c.updated_at,
            u.full_name  AS user_full_name,
            u.email      AS user_email,
            u.avatar_url AS user_avatar
          FROM conversations c
          LEFT JOIN users u ON u.id = c.user_id
          WHERE 1=1 ${where}
          ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
          LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limit, offset],
      ),
      query(
        `SELECT COUNT(*) AS total
           FROM conversations c
           LEFT JOIN users u ON u.id = c.user_id
          WHERE 1=1 ${where}`,
        params,
      ),
    ]);

    const total = parseInt(count.rows[0]?.total || 0, 10);

    return res.json({
      success: true,
      data:    data.rows.map(serializeConversation),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error("[Messages] GET /users error:", err.message, err.detail || "");
    return res.status(500).json({
      success: false,
      message: "Failed to fetch conversations",
      ...(IS_DEV && { error: err.message }),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/messages/conversations
// Full conversation list with richer filters (admin)
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/conversations", adminOnly, async (req, res) => {
  try {
    const limit  = safeInt(req.query.limit, 50, 1, 200);
    const page   = safeInt(req.query.page,  1,  1, 9999);
    const offset = (page - 1) * limit;
    const {
      search, status, priority,
      sortBy = "updated_at", order = "desc",
    } = req.query;

    const params = [];
    let pi    = 1;
    let where = "";

    if (status && status !== "all") {
      where += ` AND c.status = $${pi}`; params.push(status); pi++;
    }
    if (priority && priority !== "all") {
      where += ` AND c.priority = $${pi}`; params.push(priority); pi++;
    }
    if (search) {
      where +=
        ` AND (u.full_name ILIKE $${pi}` +
        ` OR u.email ILIKE $${pi}` +
        ` OR c.guest_name ILIKE $${pi}` +
        ` OR c.last_message ILIKE $${pi})`;
      params.push(`%${search.trim()}%`);
      pi++;
    }

    const sortCol   = ALLOWED_SORT.has(sortBy) ? `c.${sortBy}` : "c.updated_at";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    const [data, count] = await Promise.all([
      query(
        `SELECT c.*,
            u.full_name  AS user_full_name,
            u.email      AS user_email,
            u.avatar_url AS user_avatar,
            (SELECT COUNT(*) FROM messages m
               WHERE m.conversation_id = c.id AND m.deleted = false
            ) AS message_count
          FROM conversations c
          LEFT JOIN users u ON u.id = c.user_id
          WHERE 1=1 ${where}
          ORDER BY ${sortCol} ${sortOrder}, c.updated_at DESC
          LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limit, offset],
      ),
      query(
        `SELECT COUNT(*) AS total
           FROM conversations c
           LEFT JOIN users u ON u.id = c.user_id
          WHERE 1=1 ${where}`,
        params,
      ),
    ]);

    const total = parseInt(count.rows[0]?.total || 0, 10);

    return res.json({
      success: true,
      data:    data.rows.map(serializeConversation),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error("[Messages] GET /conversations error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch conversations",
      ...(IS_DEV && { error: err.message }),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/messages/conversation/:conversationId/messages
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/conversation/:conversationId/messages",
  protect,
  async (req, res) => {
    try {
      const conversationId = parseInt(req.params.conversationId, 10);
      if (!conversationId || conversationId < 1) {
        return res.status(400).json({
          success: false, message: "Invalid conversationId",
        });
      }

      const limit  = safeInt(req.query.limit, 100, 1, 500);
      const { before, after } = req.query;

      const params   = [conversationId];
      let pi         = 2;
      let extraWhere = "";

      if (before) {
        extraWhere += ` AND m.created_at < $${pi}`;
        params.push(before); pi++;
      }
      if (after) {
        extraWhere += ` AND m.created_at > $${pi}`;
        params.push(after); pi++;
      }

      const result = await query(
        `SELECT m.*
           FROM messages m
          WHERE m.conversation_id = $1
            AND m.deleted = false
            ${extraWhere}
          ORDER BY m.created_at ASC
          LIMIT $${pi}`,
        [...params, limit],
      );

      if (resolveSenderType(req) === "admin") {
        await markAdminRead(conversationId);
      }

      return res.json({ success: true, data: result.rows.map(serializeMessage) });
    } catch (err) {
      logger.error(
        "[Messages] GET /conversation/:id/messages error:", err.message,
      );
      return res.status(500).json({
        success: false,
        message: "Failed to fetch messages",
        ...(IS_DEV && { error: err.message }),
      });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/messages/user/:userId/conversation
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/user/:userId/conversation", protect, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!userId || userId < 1) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const includeMessages = req.query.includeMessages !== "false";
    const messageLimit    = safeInt(req.query.messageLimit, 100, 1, 500);

    let convResult = await query(
      `SELECT c.*,
              u.full_name  AS user_full_name,
              u.email      AS user_email,
              u.avatar_url AS user_avatar
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.user_id = $1
        ORDER BY c.updated_at DESC
        LIMIT 1`,
      [userId],
    );

    let conversation;
    let isNew = false;

    if (convResult.rows.length > 0) {
      conversation = convResult.rows[0];
    } else {
      const userResult = await query(
        "SELECT id, full_name, email, avatar_url FROM users WHERE id = $1",
        [userId],
      );
      if (!userResult.rows[0]) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const u = userResult.rows[0];
      const sessionId = `usr_${userId}_${Date.now()}`;

      const inserted = await query(
        `INSERT INTO conversations
            (session_id, user_id, guest_name, guest_email,
             channel, source, status, priority)
           VALUES ($1,$2,$3,$4,'live_chat','admin_panel','open','normal')
           RETURNING *`,
        [sessionId, userId, u.full_name, u.email],
      );

      conversation = {
        ...inserted.rows[0],
        user_full_name: u.full_name,
        user_email:     u.email,
        user_avatar:    u.avatar_url,
      };
      isNew = true;
      logger.info(
        `[Messages] Created conversation ${conversation.id} for user ${userId}`,
      );
    }

    if (resolveSenderType(req) === "admin") {
      await markAdminRead(conversation.id);
    }

    let messages = [];
    if (includeMessages) {
      const msgResult = await query(
        `SELECT * FROM messages
           WHERE conversation_id = $1 AND deleted = false
           ORDER BY created_at ASC LIMIT $2`,
        [conversation.id, messageLimit],
      );
      messages = msgResult.rows.map(serializeMessage);
    }

    return res.json({
      success: true,
      data: { ...serializeConversation(conversation), messages, isNew },
    });
  } catch (err) {
    logger.error(
      "[Messages] GET /user/:userId/conversation error:", err.message,
    );
    return res.status(500).json({
      success: false,
      message: "Failed to get or create conversation",
      ...(IS_DEV && { error: err.message }),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/messages/start-with-user
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/start-with-user", protect, async (req, res) => {
  try {
    const { userId, message, subject, channel = "live_chat" } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const uid = parseInt(userId, 10);
    if (!uid || uid < 1) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const userResult = await query(
      "SELECT id, full_name, email, avatar_url FROM users WHERE id = $1",
      [uid],
    );
    if (!userResult.rows[0]) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const u = userResult.rows[0];

    let convResult = await query(
      `SELECT * FROM conversations
        WHERE user_id = $1 AND status = 'open'
        ORDER BY updated_at DESC LIMIT 1`,
      [uid],
    );

    let conversation;
    let isNew = false;

    if (convResult.rows.length > 0) {
      conversation = convResult.rows[0];
    } else {
      const sessionId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const inserted  = await query(
        `INSERT INTO conversations
            (session_id, user_id, guest_name, guest_email,
             channel, source, status, priority, subject)
           VALUES ($1,$2,$3,$4,$5,'admin_panel','open','normal',$6)
           RETURNING *`,
        [sessionId, uid, u.full_name, u.email, channel, subject || null],
      );
      conversation = inserted.rows[0];
      isNew = true;
      logger.info(
        `[Messages] Started conversation ${conversation.id} for user ${uid}`,
      );
    }

    let sentMessage   = null;
    const trimmedBody = (message || "").trim();

    if (trimmedBody) {
      const senderType = resolveSenderType(req);
      const senderName =
        req.user?.full_name ||
        req.user?.name ||
        (senderType === "admin" ? "Support" : u.full_name);

      const msgResult = await query(
        `INSERT INTO messages
            (conversation_id, sender_type, sender_id,
             sender_name, sender_email, body, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          conversation.id,
          senderType,
          req.user?.id || null,
          senderName,
          req.user?.email || u.email,
          trimmedBody,
          JSON.stringify({ source: "http", channel }),
        ],
      );

      sentMessage = serializeMessage(msgResult.rows[0]);
      await updateConvSummary(conversation.id, trimmedBody, senderType);
    }

    const msgHistory = await query(
      `SELECT * FROM messages
         WHERE conversation_id = $1 AND deleted = false
         ORDER BY created_at ASC`,
      [conversation.id],
    );

    return res.status(isNew ? 201 : 200).json({
      success: true,
      data: {
        ...serializeConversation({
          ...conversation,
          user_full_name: u.full_name,
          user_email:     u.email,
          user_avatar:    u.avatar_url,
        }),
        messages:    msgHistory.rows.map(serializeMessage),
        isNew,
        sentMessage,
      },
    });
  } catch (err) {
    logger.error("[Messages] POST /start-with-user error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to start conversation",
      ...(IS_DEV && { error: err.message }),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/messages/send  (HTTP fallback)
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/send", protect, async (req, res) => {
  try {
    const { conversationId, body, metadata } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        success: false, message: "conversationId is required",
      });
    }

    const trimmedBody = (body || "").trim();
    if (!trimmedBody) {
      return res.status(400).json({
        success: false, message: "Message body is required",
      });
    }

    const convId = parseInt(conversationId, 10);
    if (!convId || convId < 1) {
      return res.status(400).json({
        success: false, message: "Invalid conversationId",
      });
    }

    const convResult = await query(
      "SELECT * FROM conversations WHERE id = $1", [convId],
    );
    if (!convResult.rows[0]) {
      return res.status(404).json({
        success: false, message: "Conversation not found",
      });
    }

    const conversation = convResult.rows[0];
    const senderType   = resolveSenderType(req);
    const senderName   =
      req.user?.full_name ||
      req.user?.name ||
      (senderType === "admin" ? "Support" : conversation.guest_name || "Guest");

    const result = await query(
      `INSERT INTO messages
          (conversation_id, sender_type, sender_id,
           sender_name, sender_email, body, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        convId,
        senderType,
        req.user?.id || null,
        senderName,
        req.user?.email || conversation.guest_email || null,
        trimmedBody,
        JSON.stringify(metadata || { source: "http" }),
      ],
    );

    await updateConvSummary(convId, trimmedBody, senderType);

    return res.status(201).json({
      success: true,
      data:    serializeMessage(result.rows[0]),
    });
  } catch (err) {
    logger.error("[Messages] POST /send error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to send message",
      ...(IS_DEV && { error: err.message }),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/messages/conversation/:id
// ═══════════════════════════════════════════════════════════════════════════════

router.patch("/conversation/:id", adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1) {
      return res.status(400).json({
        success: false, message: "Invalid conversation id",
      });
    }

    const { status, priority, assignedAdmin, tags, subject } = req.body;

    const sets   = [];
    const params = [];
    let pi = 1;

    const addField = (expr, value) => {
      sets.push(expr.replace("?", `$${pi}`));
      params.push(value);
      pi++;
    };

    if (status !== undefined) {
      addField("status = ?", status);
      if (status === "closed") sets.push("closed_at = NOW()");
      if (status === "open")   sets.push("closed_at = NULL");
    }
    if (priority      !== undefined) addField("priority = ?",       priority);
    if (assignedAdmin !== undefined) addField("assigned_admin = ?", assignedAdmin);
    if (tags          !== undefined) addField("tags = ?",           tags);
    if (subject       !== undefined) addField("subject = ?",        subject);

    if (!sets.length) {
      return res.status(400).json({
        success: false, message: "No fields to update",
      });
    }

    sets.push("updated_at = NOW()");
    params.push(id);

    const result = await query(
      `UPDATE conversations SET ${sets.join(", ")} WHERE id = $${pi} RETURNING *`,
      params,
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false, message: "Conversation not found",
      });
    }

    return res.json({
      success: true,
      data:    serializeConversation(result.rows[0]),
    });
  } catch (err) {
    logger.error("[Messages] PATCH /conversation/:id error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to update conversation",
      ...(IS_DEV && { error: err.message }),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/messages/:messageId
// ═══════════════════════════════════════════════════════════════════════════════

router.delete("/:messageId", protect, async (req, res) => {
  try {
    const messageId = parseInt(req.params.messageId, 10);
    if (!messageId || messageId < 1) {
      return res.status(400).json({
        success: false, message: "Invalid messageId",
      });
    }

    const isAdmin = resolveSenderType(req) === "admin";
    let result;

    if (isAdmin) {
      result = await query(
        `UPDATE messages
            SET deleted = true, body = '[Message deleted by admin]'
          WHERE id = $1 RETURNING *`,
        [messageId],
      );
    } else {
      result = await query(
        `UPDATE messages
            SET deleted = true, body = '[Message deleted]'
          WHERE id = $1 AND sender_id = $2 RETURNING *`,
        [messageId, req.user?.id],
      );
    }

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "Message not found or insufficient permission",
      });
    }

    return res.json({
      success: true,
      message: "Message deleted",
      data:    serializeMessage(result.rows[0]),
    });
  } catch (err) {
    logger.error("[Messages] DELETE /:messageId error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to delete message",
      ...(IS_DEV && { error: err.message }),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/messages/conversations/:id (admin only)
// ═══════════════════════════════════════════════════════════════════════════════

router.delete("/conversations/:id", adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation id",
      });
    }

    const result = await query(
      `DELETE FROM conversations WHERE id = $1 RETURNING *`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    return res.json({
      success: true,
      message: "Conversation deleted permanently",
    });
  } catch (err) {
    logger.error("[Messages] DELETE /conversations/:id error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to delete conversation",
      ...(IS_DEV && { error: err.message }),
    });
  }
});

logger.info("[Messages] Router registered ✓");

module.exports = router;