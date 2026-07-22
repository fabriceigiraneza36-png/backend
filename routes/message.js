// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGES ROUTES v2.0 — Admin & User Messaging
// ═══════════════════════════════════════════════════════════════════════════════

const router  = require("express").Router();
const { protect, adminProtect } = require("../middleware/auth");
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
      data: rows.map(reshapeConversation),
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
      stack: err.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch conversations",
      error:   process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   POST /conversations — create/resume conversation (user-facing)
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
      firstMessage,
    } = req.body;

    const userId    = req.user?.id || null;
    const ipAddress = req.ip;
    const userAgent = req.get("user-agent");

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
      ipAddress,
      userAgent,
    });

    /* If a first message was provided, insert it */
    if (firstMessage && String(firstMessage).trim()) {
      await insertMessage({
        conversationId: conv.id,
        senderType:     userId ? "user" : "user",
        senderId:       userId,
        senderName:     guestName,
        senderEmail:    guestEmail,
        body:           firstMessage,
      });
    }

    return res.json({
      success: true,
      data:    reshapeConversation(conv),
    });
  } catch (err) {
    logger.error(`[Messages] POST /conversations: ${err.message}`, {
      code:  err.code,
      stack: err.stack,
    });
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to create conversation",
      error:   process.env.NODE_ENV === "development" ? err.message : undefined,
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
    logger.error(`[Messages] GET /conversations/:id: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch conversation",
      error:   process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   POST /conversations/:id/messages — send message (admin)
═══════════════════════════════════════════════════════════════════════════ */
router.post("/conversations/:id/messages", adminProtect, async (req, res) => {
  try {
    const { id }              = req.params;
    const { body, replyToId } = req.body;

    const msg = await insertMessage({
      conversationId: id,
      senderType:     "admin",
      senderId:       req.user?.id,
      senderName:     req.user?.full_name || req.user?.username || "Admin",
      body,
      replyToId,
    });

    return res.json({ success: true, data: reshapeMessage(msg) });
  } catch (err) {
    logger.error(`[Messages] POST /conversations/:id/messages: ${err.message}`);
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to send message",
      error:   process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   PATCH /conversations/:id/read — mark as read
═══════════════════════════════════════════════════════════════════════════ */
router.patch("/conversations/:id/read", adminProtect, async (req, res) => {
  try {
    await markConversationRead({
      conversationId: req.params.id,
      readerType:     "admin",
    });
    return res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    logger.error(`[Messages] PATCH /read: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: "Failed to mark as read",
      error:   process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   PATCH /conversations/:id/status — change status
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
    return res.json({ success: true, data: reshapeConversation(conv) });
  } catch (err) {
    logger.error(`[Messages] PATCH /status: ${err.message}`);
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to update status",
      error:   process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   PATCH /conversations/:cid/messages/:mid/react — toggle reaction
═══════════════════════════════════════════════════════════════════════════ */
router.patch(
  "/conversations/:cid/messages/:mid/react",
  adminProtect,
  async (req, res) => {
    try {
      const { mid }        = req.params;
      const { emoji, add } = req.body;

      const reactions = await toggleReaction({
        messageId: mid,
        userId:    req.user?.id,
        emoji,
        add,
      });

      return res.json({
        success: true,
        data: { messageId: mid, reactions },
      });
    } catch (err) {
      logger.error(`[Messages] PATCH /react: ${err.message}`);
      return res.status(err.status || 500).json({
        success: false,
        message: err.message || "Failed to update reaction",
        error:   process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  }
);

/* ─── Reshapers ───────────────────────────────────────────────────────────── */

function reshapeConversation(row, includeMessages = false) {
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