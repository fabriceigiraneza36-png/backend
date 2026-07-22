// backend/src/routes/message.js
// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGES ROUTES v3.1 — Admin & User Messaging (Complete)
// ═══════════════════════════════════════════════════════════════════════════════

"use strict";

const router  = require("express").Router();
const { protect, adminProtect } = require("../middleware/auth");
const { query } = require("../config/db");
const logger  = require("../utils/logger");
const {
  getOrCreateConversation,
  insertMessage,
  markConversationRead,
  listConversations,
  getConversationWithMessages,
  toggleReaction,
  changeConversationStatus,
} = require("../utils/messaging");

/* ═══════════════════════════════════════════════════════════════════════════
   HEALTH CHECK
═══════════════════════════════════════════════════════════════════════════ */
router.get("/health", (req, res) => {
  return res.json({
    success: true,
    service: "messages",
    version: "3.1",
    ts:      new Date().toISOString(),
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET /stats — dashboard counts
═══════════════════════════════════════════════════════════════════════════ */
router.get("/stats", adminProtect, async (req, res) => {
  try {
    const [openRes, closedRes, pendingRes, unreadRes, todayRes] =
      await Promise.all([
        query(`SELECT COUNT(*)::INT AS cnt FROM conversations
                WHERE status = 'open' AND deleted_at IS NULL`),
        query(`SELECT COUNT(*)::INT AS cnt FROM conversations
                WHERE status = 'closed' AND deleted_at IS NULL`),
        query(`SELECT COUNT(*)::INT AS cnt FROM conversations
                WHERE status = 'pending' AND deleted_at IS NULL`),
        query(`SELECT COALESCE(SUM(unread_admin), 0)::INT AS cnt FROM conversations
                WHERE deleted_at IS NULL AND status != 'closed'`),
        query(`SELECT COUNT(*)::INT AS cnt FROM conversations
                WHERE created_at >= CURRENT_DATE AND deleted_at IS NULL`),
      ]);

    return res.json({
      success: true,
      data: {
        open:     openRes.rows[0]?.cnt    || 0,
        closed:   closedRes.rows[0]?.cnt  || 0,
        pending:  pendingRes.rows[0]?.cnt || 0,
        unread:   unreadRes.rows[0]?.cnt  || 0,
        newToday: todayRes.rows[0]?.cnt   || 0,
      },
    });
  } catch (err) {
    logger.error(`[Messages] GET /stats: ${err.message}`, {
      code:  err.code,
      hint:  err.hint,
      table: err.table,
      column: err.column,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch stats",
      error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET /users-list — pick a user to start a conversation with
═══════════════════════════════════════════════════════════════════════════ */
router.get("/users-list", adminProtect, async (req, res) => {
  try {
    const { search = "", limit = 30 } = req.query;
    const trimmedSearch = String(search).trim();

    const conditions = ["u.is_active = TRUE"];
    const params     = [];
    let   p          = 1;

    if (trimmedSearch) {
      conditions.push(`(
        u.full_name  ILIKE $${p} OR
        u.email      ILIKE $${p} OR
        u.username   ILIKE $${p} OR
        u.phone      ILIKE $${p}
      )`);
      params.push(`%${trimmedSearch}%`);
      p++;
    }

    const where = conditions.join(" AND ");

    const result = await query(
      `SELECT
         u.id,
         u.email,
         u.username,
         u.full_name,
         u.avatar_url,
         u.phone,
         u.nationality,
         u.is_verified,
         u.last_login,
         u.created_at,
         COALESCE((
           SELECT COUNT(*)::INT FROM bookings b WHERE b.user_id = u.id
         ), 0) AS booking_count,
         (
           SELECT conv.id FROM conversations conv
            WHERE conv.user_id = u.id AND conv.deleted_at IS NULL
            ORDER BY conv.last_message_at DESC NULLS LAST, conv.created_at DESC
            LIMIT 1
         ) AS last_conversation_id,
         (
           SELECT conv.last_message_at FROM conversations conv
            WHERE conv.user_id = u.id AND conv.deleted_at IS NULL
            ORDER BY conv.last_message_at DESC NULLS LAST, conv.created_at DESC
            LIMIT 1
         ) AS last_message_at,
         (
           SELECT COALESCE(SUM(conv.unread_admin), 0)::INT FROM conversations conv
            WHERE conv.user_id = u.id AND conv.deleted_at IS NULL
              AND conv.status != 'closed'
         ) AS unread_admin
       FROM users u
       WHERE ${where}
       ORDER BY
         COALESCE((
           SELECT conv.last_message_at FROM conversations conv
            WHERE conv.user_id = u.id AND conv.deleted_at IS NULL
            ORDER BY conv.last_message_at DESC NULLS LAST LIMIT 1
         ), u.last_login, u.created_at) DESC NULLS LAST
       LIMIT $${p}`,
      [...params, parseInt(limit)]
    );

    const users = result.rows.map((u) => ({
      id:                  u.id,
      email:               u.email,
      username:            u.username,
      fullName:            u.full_name,
      avatarUrl:           u.avatar_url,
      phone:               u.phone,
      nationality:         u.nationality,
      isVerified:          u.is_verified,
      lastLogin:           u.last_login,
      createdAt:           u.created_at,
      bookingCount:        u.booking_count        || 0,
      lastConversationId:  u.last_conversation_id || null,
      lastMessageAt:       u.last_message_at      || null,
      unreadAdmin:         u.unread_admin         || 0,
    }));

    return res.json({ success: true, data: users, count: users.length });
  } catch (err) {
    logger.error(`[Messages] GET /users-list: ${err.message}`, {
      code: err.code, hint: err.hint, table: err.table, column: err.column,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch users list",
      error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET /conversations — admin list
═══════════════════════════════════════════════════════════════════════════ */
router.get("/conversations", adminProtect, async (req, res) => {
  try {
    const {
      status = "open",
      limit  = 100,
      page   = 1,
      search,
    } = req.query;

    const { rows, total } = await listConversations({
      status,
      limit:  parseInt(limit),
      page:   parseInt(page),
      search,
    });

    return res.json({
      success: true,
      data:    rows.map(reshapeConversation),
      pagination: {
        page:    parseInt(page),
        limit:   parseInt(limit),
        total,
        pages:   Math.ceil(total / parseInt(limit)),
        hasMore: parseInt(page) * parseInt(limit) < total,
      },
    });
  } catch (err) {
    logger.error(`[Messages] GET /conversations: ${err.message}`, {
      code:  err.code,
      hint:  err.hint,
      table: err.table,
      column: err.column,
      stack: err.stack?.split("\n").slice(0, 3).join("\n"),
    });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch conversations",
      error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   POST /admin/conversations — ADMIN CREATES A CHAT FOR A USER
   ─────────────────────────────────────────────────────────────────────────
   Body: {
     targetUserId: required,
     subject:      optional,
     bookingId:    optional,
     firstMessage: optional
   }
═══════════════════════════════════════════════════════════════════════════ */
router.post("/admin/conversations", adminProtect, async (req, res) => {
  try {
    const {
      targetUserId,
      userId,               // accept both names
      subject,
      bookingId,
      bookingNumber,
      firstMessage,
      priority = "normal",
      channel  = "live_chat",
    } = req.body;

    const uid = targetUserId || userId;
    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "targetUserId is required to start a chat with a user",
      });
    }

    /* Verify target user exists */
    const userCheck = await query(
      `SELECT id, email, full_name, avatar_url FROM users
        WHERE id = $1 AND is_active = TRUE`,
      [uid]
    );
    if (!userCheck.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "Target user not found or inactive",
      });
    }

    const targetUser = userCheck.rows[0];

    const conv = await getOrCreateConversation({
      userId:        uid,
      guestName:     targetUser.full_name,
      guestEmail:    targetUser.email,
      bookingId,
      bookingNumber,
      subject:       subject || `Conversation with ${targetUser.full_name || targetUser.email}`,
      channel,
      source:        "admin",
      priority,
    });

    /* If admin included an opening message, insert it */
    if (firstMessage && String(firstMessage).trim()) {
      const msg = await insertMessage({
        conversationId: conv.id,
        senderType:     "admin",
        senderId:       req.user?.id,
        senderName:     req.user?.full_name || "Admin",
        senderEmail:    req.user?.email,
        body:           firstMessage,
      });

      /* Emit real-time */
      try {
        const io = req.app.get("io");
        if (io) {
          io.to(`conversation-${conv.id}`).emit("msg:message", reshapeMessage(msg));
          io.to(`user-${uid}`).emit("msg:new-from-admin", {
            conversationId: conv.id,
            message:        reshapeMessage(msg),
          });
        }
      } catch (e) { /* silent */ }
    }

    return res.json({
      success: true,
      data:    reshapeConversation(conv),
    });
  } catch (err) {
    logger.error(`[Messages] POST /admin/conversations: ${err.message}`, {
      code: err.code, hint: err.hint, column: err.column,
    });
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to create conversation",
      error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   POST /conversations — user-facing create/resume
═══════════════════════════════════════════════════════════════════════════ */
router.post("/conversations", async (req, res) => {
  try {
    const {
      sessionId,
      guestName,
      guestEmail,
      bookingId,
      bookingNumber,
      subject,
      channel,
      source,
      priority,
      firstMessage,
      /* When admin uses this endpoint (fallback) */
      targetUserId,
    } = req.body;

    /* Determine effective userId:
       - If authed user      → their id
       - If admin + targetId → target user id
       - Otherwise           → null (guest, requires sessionId)   */
    let userId = req.user?.id || null;
    if (!userId && targetUserId && req.user?.role === "admin") {
      userId = targetUserId;
    } else if (req.user?.role === "admin" && targetUserId) {
      userId = targetUserId;
    }

    const ipAddress = req.ip;
    const userAgent = req.get("user-agent");

    if (!userId && !sessionId) {
      return res.status(400).json({
        success: false,
        message: "Either userId (auth) or sessionId is required",
      });
    }

    const conv = await getOrCreateConversation({
      userId,
      sessionId,
      guestName,
      guestEmail,
      bookingId,
      bookingNumber,
      subject,
      channel,
      source,
      priority,
      ipAddress,
      userAgent,
    });

    if (firstMessage && String(firstMessage).trim()) {
      await insertMessage({
        conversationId: conv.id,
        senderType:     req.user?.role === "admin" ? "admin" : "user",
        senderId:       req.user?.id || null,
        senderName:     guestName || req.user?.full_name,
        senderEmail:    guestEmail || req.user?.email,
        body:           firstMessage,
      });
    }

    return res.json({
      success: true,
      data:    reshapeConversation(conv),
    });
  } catch (err) {
    logger.error(`[Messages] POST /conversations: ${err.message}`, {
      code: err.code, hint: err.hint, column: err.column,
    });
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to create conversation",
      error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET /conversations/:id — single conversation with messages
═══════════════════════════════════════════════════════════════════════════ */
router.get("/conversations/:id", adminProtect, async (req, res) => {
  try {
    const data = await getConversationWithMessages(req.params.id);
    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }
    return res.json({ success: true, data: reshapeConversation(data, true) });
  } catch (err) {
    logger.error(`[Messages] GET /conversations/:id: ${err.message}`, {
      code: err.code, hint: err.hint,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch conversation",
      error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   POST /conversations/:id/messages — send message (REST fallback)
═══════════════════════════════════════════════════════════════════════════ */
router.post("/conversations/:id/messages", adminProtect, async (req, res) => {
  try {
    const { id }              = req.params;
    const { body, replyToId } = req.body;

    if (!body || !String(body).trim()) {
      return res.status(400).json({
        success: false,
        message: "Message body is required",
      });
    }

    const convCheck = await query(
      `SELECT id, user_id FROM conversations
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!convCheck.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    const msg = await insertMessage({
      conversationId: id,
      senderType:     "admin",
      senderId:       req.user?.id,
      senderName:     req.user?.full_name || req.user?.username || "Admin",
      senderEmail:    req.user?.email,
      senderAvatar:   req.user?.avatar_url,
      body,
      replyToId,
    });

    /* Real-time */
    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`conversation-${id}`).emit("msg:message", reshapeMessage(msg));
        if (convCheck.rows[0].user_id) {
          io.to(`user-${convCheck.rows[0].user_id}`).emit(
            "msg:new-from-admin",
            { conversationId: id, message: reshapeMessage(msg) }
          );
        }
      }
    } catch (e) { /* silent */ }

    return res.json({ success: true, data: reshapeMessage(msg) });
  } catch (err) {
    logger.error(`[Messages] POST /messages: ${err.message}`, {
      code: err.code, hint: err.hint,
    });
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to send message",
      error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   PATCH /conversations/:id/read
═══════════════════════════════════════════════════════════════════════════ */
router.patch("/conversations/:id/read", adminProtect, async (req, res) => {
  try {
    await markConversationRead({
      conversationId: req.params.id,
      readerType:     "admin",
    });

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`conversation-${req.params.id}`).emit("msg:conversation-updated", {
          id: req.params.id, unread_admin: 0,
        });
      }
    } catch (e) { /* silent */ }

    return res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    logger.error(`[Messages] PATCH /read: ${err.message}`, {
      code: err.code, hint: err.hint,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to mark as read",
      error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   PATCH /conversations/:id/status
═══════════════════════════════════════════════════════════════════════════ */
router.patch("/conversations/:id/status", adminProtect, async (req, res) => {
  try {
    const conv = await changeConversationStatus({
      conversationId: req.params.id,
      status:         req.body.status,
    });

    if (!conv) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`conversation-${req.params.id}`).emit(
          "msg:conversation-updated",
          reshapeConversation(conv)
        );
      }
    } catch (e) { /* silent */ }

    return res.json({ success: true, data: reshapeConversation(conv) });
  } catch (err) {
    logger.error(`[Messages] PATCH /status: ${err.message}`, {
      code: err.code, hint: err.hint,
    });
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to update status",
      error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   PATCH /conversations/:cid/messages/:mid/react
═══════════════════════════════════════════════════════════════════════════ */
router.patch(
  "/conversations/:cid/messages/:mid/react",
  adminProtect,
  async (req, res) => {
    try {
      const { cid, mid }    = req.params;
      const { emoji, add }  = req.body;

      if (!emoji) {
        return res.status(400).json({
          success: false,
          message: "Emoji is required",
        });
      }

      const reactions = await toggleReaction({
        messageId: mid,
        userId:    req.user?.id,
        emoji,
        add:       Boolean(add),
      });

      try {
        const io = req.app.get("io");
        if (io) {
          io.to(`conversation-${cid}`).emit("msg:reaction", {
            messageId: mid, reactions, emoji, reactedBy: req.user?.id,
          });
        }
      } catch (e) { /* silent */ }

      return res.json({
        success: true,
        data: { messageId: mid, reactions },
      });
    } catch (err) {
      logger.error(`[Messages] PATCH /react: ${err.message}`, {
        code: err.code, hint: err.hint,
      });
      return res.status(err.status || 500).json({
        success: false,
        message: err.message || "Failed to update reaction",
        error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
      });
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════════════
   DELETE /conversations/:id — soft delete
═══════════════════════════════════════════════════════════════════════════ */
router.delete("/conversations/:id", adminProtect, async (req, res) => {
  try {
    const result = await query(
      `UPDATE conversations
          SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id`,
      [req.params.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found or already deleted",
      });
    }

    return res.json({ success: true, message: "Conversation deleted" });
  } catch (err) {
    logger.error(`[Messages] DELETE /conversations/:id: ${err.message}`, {
      code: err.code, hint: err.hint,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to delete conversation",
      error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   RESHAPERS
═══════════════════════════════════════════════════════════════════════════ */

function reshapeConversation(row, includeMessages = false) {
  if (!row) return null;
  const base = {
    id:              row.id,
    sessionId:       row.session_id,
    userId:          row.user_id,
    guestName:       row.guest_name,
    guestEmail:      row.guest_email,
    channel:         row.channel,
    subject:         row.subject,
    status:          row.status,
    priority:        row.priority,
    assignedAdmin:   row.assigned_admin,
    firstMessage:    row.first_message,
    lastMessage:     row.last_message,
    lastMessageAt:   row.last_message_at,
    unreadUser:      row.unread_user  || 0,
    unreadAdmin:     row.unread_admin || 0,
    tags:            row.tags         || [],
    metadata:        row.metadata     || {},
    source:          row.source,
    bookingId:       row.booking_id     || null,
    bookingNumber:   row.booking_number || row.metadata?.bookingNumber || null,
    ipAddress:       row.ip_address,
    userAgent:       row.user_agent,
    closedAt:        row.closed_at,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
  if (includeMessages && Array.isArray(row.messages)) {
    base.messages = row.messages.map(reshapeMessage);
  }
  return base;
}

function reshapeMessage(m) {
  if (!m) return null;
  return {
    id:              m.id,
    conversationId:  m.conversation_id,
    senderType:      m.sender_type,
    senderId:        m.sender_id,
    senderName:      m.sender_name,
    senderEmail:     m.sender_email,
    senderAvatar:    m.sender_avatar,
    body:            m.body,
    msgType:         m.msg_type,
    attachmentUrl:   m.attachment_url,
    attachmentName:  m.attachment_name,
    attachmentType:  m.attachment_type,
    isRead:          m.is_read,
    readAt:          m.read_at,
    edited:          m.edited,
    editedAt:        m.edited_at,
    replyToId:       m.reply_to_id,
    metadata:        m.metadata  || {},
    reactions:       m.reactions || {},
    createdAt:       m.created_at,
  };
}

module.exports = router;