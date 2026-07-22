// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGES ROUTES v2.0 — Admin Conversations & Messaging
// ═══════════════════════════════════════════════════════════════════════════════
// Uses your exact schema — verified column names, no missing references.
// ═══════════════════════════════════════════════════════════════════════════════

const router = require("express").Router();
const { query } = require("../config/db");
const { adminProtect, protect } = require("../middleware/auth");

/* ═══════════════════════════════════════════════════════════════════════════
   GET /api/messages/conversations
   List all conversations (admin view)
═══════════════════════════════════════════════════════════════════════════ */
router.get("/conversations", adminProtect, async (req, res) => {
  try {
    const {
      status = "open",     // "open" | "closed" | "pending" | "all"
      limit  = 100,
      page   = 1,
      search,
    } = req.query;

    const offset     = (parseInt(page) - 1) * parseInt(limit);
    const conditions = ["conv.deleted_at IS NULL"];
    const params     = [];
    let   p          = 1;

    if (status && status !== "all") {
      conditions.push(`conv.status = $${p}`);
      params.push(status);
      p++;
    }

    if (search) {
      conditions.push(`(
        conv.guest_name    ILIKE $${p} OR
        conv.guest_email   ILIKE $${p} OR
        conv.subject       ILIKE $${p} OR
        conv.first_message ILIKE $${p} OR
        conv.last_message  ILIKE $${p}
      )`);
      params.push(`%${search}%`);
      p++;
    }

    const where = conditions.join(" AND ");

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT
           conv.id,
           conv.session_id,
           conv.user_id,
           conv.guest_name,
           conv.guest_email,
           conv.channel,
           conv.subject,
           conv.status,
           conv.priority,
           conv.assigned_admin,
           conv.first_message,
           conv.last_message,
           conv.last_message_at,
           conv.unread_user,
           conv.unread_admin,
           conv.tags,
           conv.metadata,
           conv.source,
           conv.closed_at,
           conv.created_at,
           conv.updated_at,
           /* Extract useful bits from metadata */
           conv.metadata->>'bookingNumber' AS "bookingNumber"
         FROM conversations conv
         WHERE ${where}
         ORDER BY
           (conv.unread_admin > 0) DESC,
           conv.last_message_at   DESC NULLS LAST,
           conv.created_at        DESC
         LIMIT  $${p}
         OFFSET $${p + 1}`,
        [...params, parseInt(limit), offset]
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM conversations conv
         WHERE ${where}`,
        params
      ),
    ]);

    const total = parseInt(countRes.rows[0]?.total || 0);

    /* Reshape rows for frontend */
    const conversations = dataRes.rows.map((row) => ({
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
      unreadUser:      row.unread_user      || 0,
      unreadAdmin:     row.unread_admin     || 0,
      tags:            row.tags             || [],
      metadata:        row.metadata         || {},
      source:          row.source,
      bookingNumber:   row.bookingNumber    || null,
      closedAt:        row.closed_at,
      createdAt:       row.created_at,
      updatedAt:       row.updated_at,
    }));

    return res.json({
      success: true,
      data:    conversations,
      pagination: {
        page:    parseInt(page),
        limit:   parseInt(limit),
        total,
        pages:   Math.ceil(total / parseInt(limit)),
        hasMore: parseInt(page) * parseInt(limit) < total,
      },
    });
  } catch (err) {
    console.error("[messages/conversations] Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch conversations",
      error:   process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET /api/messages/conversations/:id
   Get single conversation with all messages
═══════════════════════════════════════════════════════════════════════════ */
router.get("/conversations/:id", adminProtect, async (req, res) => {
  try {
    const { id } = req.params;

    const [convRes, msgsRes] = await Promise.all([
      query(
        `SELECT
           conv.*,
           conv.metadata->>'bookingNumber' AS "bookingNumber"
         FROM conversations conv
         WHERE conv.id = $1 AND conv.deleted_at IS NULL`,
        [id]
      ),
      query(
        `SELECT
           m.id,
           m.conversation_id,
           m.sender_type,
           m.sender_id,
           m.sender_name,
           m.sender_email,
           m.sender_avatar,
           m.body,
           m.msg_type,
           m.attachment_url,
           m.attachment_name,
           m.attachment_type,
           m.is_read,
           m.read_at,
           m.edited,
           m.edited_at,
           m.reply_to_id,
           m.metadata,
           m.reactions,
           m.created_at
         FROM messages m
         WHERE m.conversation_id = $1
           AND (m.deleted IS NULL OR m.deleted = FALSE)
           AND m.deleted_at IS NULL
         ORDER BY m.created_at ASC`,
        [id]
      ),
    ]);

    if (!convRes.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    const conv = convRes.rows[0];

    return res.json({
      success:  true,
      data: {
        id:              conv.id,
        sessionId:       conv.session_id,
        userId:          conv.user_id,
        guestName:       conv.guest_name,
        guestEmail:      conv.guest_email,
        channel:         conv.channel,
        subject:         conv.subject,
        status:          conv.status,
        priority:        conv.priority,
        assignedAdmin:   conv.assigned_admin,
        firstMessage:    conv.first_message,
        lastMessage:     conv.last_message,
        lastMessageAt:   conv.last_message_at,
        unreadUser:      conv.unread_user  || 0,
        unreadAdmin:     conv.unread_admin || 0,
        tags:            conv.tags         || [],
        metadata:        conv.metadata     || {},
        source:          conv.source,
        bookingNumber:   conv.bookingNumber || null,
        closedAt:        conv.closed_at,
        createdAt:       conv.created_at,
        updatedAt:       conv.updated_at,
        messages: msgsRes.rows.map((m) => ({
          id:               m.id,
          conversationId:   m.conversation_id,
          senderType:       m.sender_type,
          senderId:         m.sender_id,
          senderName:       m.sender_name,
          senderEmail:      m.sender_email,
          senderAvatar:     m.sender_avatar,
          body:             m.body,
          msgType:          m.msg_type,
          attachmentUrl:    m.attachment_url,
          attachmentName:   m.attachment_name,
          attachmentType:   m.attachment_type,
          isRead:           m.is_read,
          readAt:           m.read_at,
          edited:           m.edited,
          editedAt:         m.edited_at,
          replyToId:        m.reply_to_id,
          metadata:         m.metadata   || {},
          reactions:        m.reactions  || {},
          createdAt:        m.created_at,
        })),
      },
    });
  } catch (err) {
    console.error("[messages/conversations/:id] Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch conversation",
      error:   process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   PATCH /api/messages/conversations/:id/read
   Mark all admin-unread messages as read
═══════════════════════════════════════════════════════════════════════════ */
router.patch("/conversations/:id/read", adminProtect, async (req, res) => {
  try {
    const { id } = req.params;

    await query(
      `UPDATE messages
         SET is_read = TRUE,
             read_at = NOW()
       WHERE conversation_id = $1
         AND sender_type = 'user'
         AND (is_read IS NULL OR is_read = FALSE)`,
      [id]
    );

    await query(
      `UPDATE conversations
         SET unread_admin = 0,
             updated_at   = NOW()
       WHERE id = $1`,
      [id]
    );

    return res.json({ success: true, message: "Messages marked as read" });
  } catch (err) {
    console.error("[messages/read] Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to mark as read",
      error:   process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   POST /api/messages/conversations/:id/messages
   Send admin message (fallback if socket unavailable)
═══════════════════════════════════════════════════════════════════════════ */
router.post("/conversations/:id/messages", adminProtect, async (req, res) => {
  try {
    const { id }              = req.params;
    const { body, replyToId } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message body is required",
      });
    }

    const adminId   = req.user?.id;
    const adminName = req.user?.full_name || req.user?.username || "Admin";

    const result = await query(
      `INSERT INTO messages (
         conversation_id, sender_type, sender_id, sender_name,
         body, msg_type, reply_to_id, is_read, reactions, created_at
       ) VALUES ($1, 'admin', $2, $3, $4, 'text', $5, FALSE, '{}'::jsonb, NOW())
       RETURNING *`,
      [id, adminId, adminName, body.trim(), replyToId || null]
    );

    const msg = result.rows[0];

    /* Update conversation last-message + bump unread_user */
    await query(
      `UPDATE conversations
         SET last_message    = $1,
             last_message_at = NOW(),
             unread_user     = COALESCE(unread_user, 0) + 1,
             updated_at      = NOW()
       WHERE id = $2`,
      [body.trim().slice(0, 500), id]
    );

    return res.json({
      success: true,
      data: {
        id:              msg.id,
        conversationId:  msg.conversation_id,
        senderType:      msg.sender_type,
        senderId:        msg.sender_id,
        senderName:      msg.sender_name,
        body:            msg.body,
        msgType:         msg.msg_type,
        replyToId:       msg.reply_to_id,
        isRead:          msg.is_read,
        reactions:       msg.reactions || {},
        createdAt:       msg.created_at,
      },
    });
  } catch (err) {
    console.error("[messages/send] Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send message",
      error:   process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   PATCH /api/messages/conversations/:id/status
   Change conversation status (open/closed/pending)
═══════════════════════════════════════════════════════════════════════════ */
router.patch("/conversations/:id/status", adminProtect, async (req, res) => {
  try {
    const { id }     = req.params;
    const { status } = req.body;

    const allowed = ["open", "closed", "pending"];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${allowed.join(", ")}`,
      });
    }

    const closedAtClause = status === "closed"
      ? ", closed_at = NOW()"
      : status === "open"
        ? ", closed_at = NULL"
        : "";

    const result = await query(
      `UPDATE conversations
         SET status = $1,
             updated_at = NOW()
             ${closedAtClause}
       WHERE id = $2
       RETURNING id, status, closed_at, updated_at`,
      [status, id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("[messages/status] Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update status",
      error:   process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   PATCH /api/messages/conversations/:cid/messages/:mid/react
   Toggle reaction on a message
═══════════════════════════════════════════════════════════════════════════ */
router.patch(
  "/conversations/:cid/messages/:mid/react",
  adminProtect,
  async (req, res) => {
    try {
      const { cid, mid }      = req.params;
      const { emoji, add }    = req.body;
      const userId            = String(req.user?.id || "0");

      if (!emoji) {
        return res.status(400).json({
          success: false,
          message: "Emoji is required",
        });
      }

      /* Load current reactions */
      const cur = await query(
        `SELECT reactions FROM messages WHERE id = $1 AND conversation_id = $2`,
        [mid, cid]
      );

      if (!cur.rows[0]) {
        return res.status(404).json({
          success: false,
          message: "Message not found",
        });
      }

      const reactions = cur.rows[0].reactions || {};
      const list      = reactions[emoji] || [];

      const updated = add
        ? [...new Set([...list, userId])]
        : list.filter((uid) => uid !== userId);

      if (updated.length === 0) delete reactions[emoji];
      else                      reactions[emoji] = updated;

      await query(
        `UPDATE messages SET reactions = $1::jsonb WHERE id = $2`,
        [JSON.stringify(reactions), mid]
      );

      return res.json({
        success: true,
        data: { messageId: mid, reactions },
      });
    } catch (err) {
      console.error("[messages/react] Error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to update reaction",
        error:   process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  }
);

module.exports = router;