// backend/src/routes/message.js
// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGES ROUTES v3.2 — Fixed: uses optionalAuth from auth middleware
// ═══════════════════════════════════════════════════════════════════════════════

"use strict";

const router = require("express").Router();
const {
  protect,
  adminProtect,
  optionalAuth,
} = require("../middleware/auth");
const { query }  = require("../config/db");
const logger     = require("../utils/logger");
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
    version: "3.2",
    ts:      new Date().toISOString(),
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET /stats
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
        query(`SELECT COALESCE(SUM(unread_admin), 0)::INT AS cnt
                FROM conversations
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
    logger.error(`[Messages] GET /stats: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET /users-list
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
        u.full_name ILIKE $${p} OR
        u.email     ILIKE $${p} OR
        u.username  ILIKE $${p} OR
        u.phone     ILIKE $${p}
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
    logger.error(`[Messages] GET /users-list: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to fetch users list" });
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
      data:    rows.map((r) => reshapeConversation(r)),
      pagination: {
        page:    parseInt(page),
        limit:   parseInt(limit),
        total,
        pages:   Math.ceil(total / parseInt(limit)),
        hasMore: parseInt(page) * parseInt(limit) < total,
      },
    });
  } catch (err) {
    logger.error(`[Messages] GET /conversations: ${err.message}`, { stack: err.stack });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch conversations",
      error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   POST /admin/conversations
   Admin explicitly starts a conversation with a specific user.
   Uses adminProtect — req.user is guaranteed to be an admin.
═══════════════════════════════════════════════════════════════════════════ */
router.post("/admin/conversations", adminProtect, async (req, res) => {
  try {
    const {
      targetUserId,
      userId,
      subject,
      bookingId,
      bookingNumber,
      firstMessage,
      priority = "normal",
      channel  = "live_chat",
    } = req.body;

    const uid = parseInt(targetUserId || userId, 10);
    if (!uid || isNaN(uid)) {
      return res.status(400).json({
        success: false,
        message: "targetUserId is required to start a chat with a user",
      });
    }

    /* Verify target user exists */
    const userCheck = await query(
      `SELECT id, email, full_name, avatar_url
         FROM users
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
      sessionId:     null,
      guestName:     targetUser.full_name,
      guestEmail:    targetUser.email,
      bookingId:     bookingId   || null,
      bookingNumber: bookingNumber || null,
      subject:       subject || `Conversation with ${targetUser.full_name || targetUser.email}`,
      channel,
      source:        "admin",
      priority,
    });

    if (firstMessage && String(firstMessage).trim()) {
      const msg = await insertMessage({
        conversationId: conv.id,
        senderType:     "admin",
        senderId:       req.user.id,
        senderName:     req.user.full_name || req.user.username || "Admin",
        senderEmail:    req.user.email,
        senderAvatar:   req.user.avatar_url || null,
        body:           String(firstMessage).trim(),
      });

      try {
        const io = req.app.get("io");
        if (io) {
          io.to(`conversation-${conv.id}`).emit("msg:message", reshapeMessage(msg));
          io.to(`user-${uid}`).emit("msg:new-from-admin", {
            conversationId: conv.id,
            message:        reshapeMessage(msg),
          });
        }
      } catch (_) { /* silent — socket errors never break REST response */ }
    }

    return res.json({ success: true, data: reshapeConversation(conv) });
  } catch (err) {
    logger.error(`[Messages] POST /admin/conversations: ${err.message}`, { stack: err.stack });
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to create conversation",
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   POST /conversations
   ─────────────────────────────────────────────────────────────────────────
   Works for THREE caller types:
     1. Authenticated admin  → req.user.role is admin, may pass targetUserId
     2. Authenticated user   → req.user.id is the userId
     3. Guest / widget       → no token, must pass sessionId in body

   Uses optionalAuth (imported from middleware/auth) so:
     • Valid token  → req.user populated, never blocked
     • No/bad token → req.user = null, continues as guest
═══════════════════════════════════════════════════════════════════════════ */
router.post("/conversations", optionalAuth, async (req, res) => {
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
      targetUserId,   // admin fallback when using this endpoint
    } = req.body;

    const ipAddress = req.ip;
    const userAgent = req.get("user-agent") || null;

    /* ── Resolve effective userId ─────────────────────────────────────────── */
    let userId = null;

    if (req.user) {
      const ADMIN_ROLES_SET = new Set([
        "admin", "superadmin", "super_admin", "moderator", "editor",
      ]);

      const callerIsAdmin =
        req.userType === "admin" ||
        ADMIN_ROLES_SET.has(req.user.role || "") ||
        req.user.type === "admin";

      if (callerIsAdmin && targetUserId) {
        // Admin is starting a conversation on behalf of a user
        userId = parseInt(targetUserId, 10) || null;
      } else {
        // Normal authenticated user (or admin messaging themselves)
        userId = req.user.id;
      }
    }

    /* ── Guard ────────────────────────────────────────────────────────────── */
    // Must have at least one identifier
    if (!userId && !sessionId) {
      return res.status(400).json({
        success: false,
        message: "Either userId (auth) or sessionId is required",
      });
    }

    /* ── Create / resume conversation ────────────────────────────────────── */
    const conv = await getOrCreateConversation({
      userId:        userId   || null,
      sessionId:     userId   ? null : (sessionId || null), // prefer userId
      guestName:     guestName  || req.user?.full_name  || null,
      guestEmail:    guestEmail || req.user?.email      || null,
      bookingId:     bookingId    || null,
      bookingNumber: bookingNumber || null,
      subject:       subject   || null,
      channel:       channel   || "live_chat",
      source:        source    || (req.user ? "authenticated" : "guest"),
      priority:      priority  || "normal",
      ipAddress,
      userAgent,
    });

    /* ── Optional first message ──────────────────────────────────────────── */
    if (firstMessage && String(firstMessage).trim()) {
      const ADMIN_ROLES_SET = new Set([
        "admin", "superadmin", "super_admin", "moderator", "editor",
      ]);
      const callerIsAdmin =
        req.user &&
        (req.userType === "admin" ||
          ADMIN_ROLES_SET.has(req.user.role || "") ||
          req.user.type === "admin");

      await insertMessage({
        conversationId: conv.id,
        senderType:     callerIsAdmin ? "admin" : "user",
        senderId:       req.user?.id    || null,
        senderName:     guestName       || req.user?.full_name  || null,
        senderEmail:    guestEmail      || req.user?.email      || null,
        senderAvatar:   req.user?.avatar_url || null,
        body:           String(firstMessage).trim(),
      });
    }

    return res.json({ success: true, data: reshapeConversation(conv) });
  } catch (err) {
    logger.error(`[Messages] POST /conversations: ${err.message}`, { stack: err.stack });
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to create conversation",
      error:   process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET /conversations/:id
═══════════════════════════════════════════════════════════════════════════ */
router.get("/conversations/:id", adminProtect, async (req, res) => {
  try {
    const data = await getConversationWithMessages(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }
    return res.json({ success: true, data: reshapeConversation(data, true) });
  } catch (err) {
    logger.error(`[Messages] GET /conversations/:id: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to fetch conversation" });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   POST /conversations/:id/messages
═══════════════════════════════════════════════════════════════════════════ */
router.post("/conversations/:id/messages", adminProtect, async (req, res) => {
  try {
    const { id }              = req.params;
    const { body, replyToId } = req.body;

    if (!body || !String(body).trim()) {
      return res.status(400).json({ success: false, message: "Message body is required" });
    }

    const convCheck = await query(
      `SELECT id, user_id FROM conversations
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!convCheck.rows[0]) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    const msg = await insertMessage({
      conversationId: id,
      senderType:     "admin",
      senderId:       req.user.id,
      senderName:     req.user.full_name || req.user.username || "Admin",
      senderEmail:    req.user.email,
      senderAvatar:   req.user.avatar_url || null,
      body:           String(body).trim(),
      replyToId:      replyToId || null,
    });

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`conversation-${id}`).emit("msg:message", reshapeMessage(msg));
        if (convCheck.rows[0].user_id) {
          io.to(`user-${convCheck.rows[0].user_id}`).emit("msg:new-from-admin", {
            conversationId: id,
            message:        reshapeMessage(msg),
          });
        }
      }
    } catch (_) { /* silent */ }

    return res.json({ success: true, data: reshapeMessage(msg) });
  } catch (err) {
    logger.error(`[Messages] POST /conversations/:id/messages: ${err.message}`, { stack: err.stack });
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to send message",
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
          id:          req.params.id,
          unreadAdmin: 0,
        });
      }
    } catch (_) { /* silent */ }

    return res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    logger.error(`[Messages] PATCH /conversations/:id/read: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to mark as read" });
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
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`conversation-${req.params.id}`).emit(
          "msg:conversation-updated",
          reshapeConversation(conv)
        );
      }
    } catch (_) { /* silent */ }

    return res.json({ success: true, data: reshapeConversation(conv) });
  } catch (err) {
    logger.error(`[Messages] PATCH /conversations/:id/status: ${err.message}`, { stack: err.stack });
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to update status",
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
      const { cid, mid }   = req.params;
      const { emoji, add } = req.body;

      if (!emoji) {
        return res.status(400).json({ success: false, message: "Emoji is required" });
      }

      const reactions = await toggleReaction({
        messageId: mid,
        userId:    req.user.id,
        emoji,
        add:       Boolean(add),
      });

      try {
        const io = req.app.get("io");
        if (io) {
          io.to(`conversation-${cid}`).emit("msg:reaction", {
            messageId: mid,
            reactions,
            emoji,
            reactedBy: req.user.id,
          });
        }
      } catch (_) { /* silent */ }

      return res.json({ success: true, data: { messageId: mid, reactions } });
    } catch (err) {
      logger.error(`[Messages] PATCH /react: ${err.message}`, { stack: err.stack });
      return res.status(err.status || 500).json({
        success: false,
        message: err.message || "Failed to update reaction",
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
    logger.error(`[Messages] DELETE /conversations/:id: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to delete conversation" });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   RESHAPERS
═══════════════════════════════════════════════════════════════════════════ */

function reshapeConversation(row, includeMessages = false) {
  if (!row) return null;

  const base = {
    id:            row.id,
    sessionId:     row.session_id,
    userId:        row.user_id,
    guestName:     row.guest_name,
    guestEmail:    row.guest_email,
    channel:       row.channel,
    subject:       row.subject,
    status:        row.status,
    priority:      row.priority,
    assignedAdmin: row.assigned_admin,
    firstMessage:  row.first_message,
    lastMessage:   row.last_message,
    lastMessageAt: row.last_message_at,
    unreadUser:    row.unread_user   || 0,
    unreadAdmin:   row.unread_admin  || 0,
    tags:          row.tags          || [],
    metadata:      row.metadata      || {},
    source:        row.source,
    bookingId:     row.booking_id     || null,
    bookingNumber: row.booking_number || row.metadata?.bookingNumber || null,
    ipAddress:     row.ip_address,
    userAgent:     row.user_agent,
    closedAt:      row.closed_at,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
    messageCount:  row.message_count || 0,
    user:          row.user          || null,
  };

  if (includeMessages && Array.isArray(row.messages)) {
    base.messages = row.messages.map(reshapeMessage);
  }

  return base;
}

function reshapeMessage(m) {
  if (!m) return null;
  return {
    id:             m.id,
    conversationId: m.conversation_id,
    senderType:     m.sender_type,
    senderId:       m.sender_id,
    senderName:     m.sender_name,
    senderEmail:    m.sender_email,
    senderAvatar:   m.sender_avatar,
    body:           m.body,
    msgType:        m.msg_type,
    attachmentUrl:  m.attachment_url,
    attachmentName: m.attachment_name,
    attachmentType: m.attachment_type,
    isRead:         m.is_read,
    readAt:         m.read_at,
    edited:         m.edited,
    editedAt:       m.edited_at,
    replyToId:      m.reply_to_id,
    metadata:       m.metadata   || {},
    reactions:      m.reactions  || {},
    createdAt:      m.created_at,
  };
}

module.exports = router;