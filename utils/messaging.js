// backend/src/utils/messaging.js
// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGING UTILITIES v3.1 — Complete
// ═══════════════════════════════════════════════════════════════════════════════

"use strict";

const { query } = require("../config/db");
const logger    = require("./logger");

/* ─────────────────────────────────────────────────────────────────────────────
   getOrCreateConversation
   ───────────────────────────────────────────────────────────────────────────── */
async function getOrCreateConversation({
  userId      = null,
  sessionId   = null,
  guestName   = null,
  guestEmail  = null,
  bookingId   = null,
  bookingNumber = null,
  subject     = null,
  channel     = "live_chat",
  source      = "direct",
  priority    = "normal",
  ipAddress   = null,
  userAgent   = null,
  metadata    = {},
} = {}) {

  /* ── 1. Try to find an existing open/pending conversation ── */
  let existing = null;

  if (userId) {
    const res = await query(
      `SELECT * FROM conversations
        WHERE user_id = $1
          AND deleted_at IS NULL
          AND status IN ('open','pending')
        ORDER BY last_message_at DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [userId]
    );
    existing = res.rows[0] || null;
  } else if (sessionId) {
    const res = await query(
      `SELECT * FROM conversations
        WHERE session_id = $1
          AND deleted_at IS NULL
          AND status IN ('open','pending')
        ORDER BY last_message_at DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [sessionId]
    );
    existing = res.rows[0] || null;
  }

  if (existing) return existing;

  /* ── 2. Validate bookingId if provided ── */
  let resolvedBookingId     = null;
  let resolvedBookingNumber = bookingNumber || null;

  if (bookingId) {
    const bRes = await query(
      `SELECT id, booking_number FROM bookings WHERE id = $1 LIMIT 1`,
      [bookingId]
    );
    if (bRes.rows[0]) {
      resolvedBookingId     = bRes.rows[0].id;
      resolvedBookingNumber = bRes.rows[0].booking_number || resolvedBookingNumber;
    }
  }

  /* ── 3. Build metadata ── */
  const finalMeta = {
    ...metadata,
    ...(resolvedBookingNumber ? { bookingNumber: resolvedBookingNumber } : {}),
  };

  /* ── 4. Insert new conversation ── */
  const ins = await query(
    `INSERT INTO conversations (
       user_id, session_id, guest_name, guest_email,
       booking_id, subject, channel, source, priority,
       ip_address, user_agent, metadata,
       status, unread_user, unread_admin,
       created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,
       $5,$6,$7,$8,$9,
       $10,$11,$12,
       'open', 0, 0,
       NOW(), NOW()
     )
     RETURNING *`,
    [
      userId,
      sessionId,
      guestName,
      guestEmail,
      resolvedBookingId,
      subject   || "New Conversation",
      channel   || "live_chat",
      source    || "direct",
      priority  || "normal",
      ipAddress,
      userAgent,
      JSON.stringify(finalMeta),
    ]
  );

  return ins.rows[0];
}

/* ─────────────────────────────────────────────────────────────────────────────
   insertMessage
   ───────────────────────────────────────────────────────────────────────────── */
async function insertMessage({
  conversationId,
  senderType,          // 'user' | 'admin' | 'bot'
  senderId     = null,
  senderName   = null,
  senderEmail  = null,
  senderAvatar = null,
  body,
  msgType      = "text",
  attachmentUrl  = null,
  attachmentName = null,
  attachmentType = null,
  replyToId    = null,
  metadata     = {},
} = {}) {

  if (!conversationId) throw Object.assign(new Error("conversationId is required"), { status: 400 });
  if (!body || !String(body).trim()) throw Object.assign(new Error("Message body is required"), { status: 400 });
  if (!senderType) throw Object.assign(new Error("senderType is required"), { status: 400 });

  /* ── Insert the message ── */
  const msgRes = await query(
    `INSERT INTO messages (
       conversation_id, sender_type, sender_id,
       sender_name, sender_email, sender_avatar,
       body, msg_type,
       attachment_url, attachment_name, attachment_type,
       reply_to_id, metadata, reactions,
       is_read, edited,
       created_at, updated_at
     ) VALUES (
       $1,$2,$3,
       $4,$5,$6,
       $7,$8,
       $9,$10,$11,
       $12,$13,'{}',
       FALSE, FALSE,
       NOW(), NOW()
     )
     RETURNING *`,
    [
      conversationId,
      senderType,
      senderId,
      senderName,
      senderEmail,
      senderAvatar,
      String(body).trim(),
      msgType,
      attachmentUrl,
      attachmentName,
      attachmentType,
      replyToId,
      JSON.stringify(metadata),
    ]
  );

  const msg = msgRes.rows[0];

  /* ── Update conversation snapshot ── */
  const snippet = String(body).trim().substring(0, 255);

  if (senderType === "admin") {
    /* Admin sent → increment user's unread counter */
    await query(
      `UPDATE conversations
          SET last_message    = $1,
              last_message_at = NOW(),
              unread_user     = unread_user + 1,
              first_message   = COALESCE(first_message, $1),
              updated_at      = NOW()
        WHERE id = $2`,
      [snippet, conversationId]
    );
  } else {
    /* User/bot sent → increment admin's unread counter */
    await query(
      `UPDATE conversations
          SET last_message    = $1,
              last_message_at = NOW(),
              unread_admin    = unread_admin + 1,
              first_message   = COALESCE(first_message, $1),
              status          = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
              updated_at      = NOW()
        WHERE id = $2`,
      [snippet, conversationId]
    );
  }

  return msg;
}

/* ─────────────────────────────────────────────────────────────────────────────
   markConversationRead
   ───────────────────────────────────────────────────────────────────────────── */
async function markConversationRead({ conversationId, readerType }) {
  if (!conversationId) throw new Error("conversationId is required");
  if (!readerType)     throw new Error("readerType is required");

  const col = readerType === "admin" ? "unread_admin" : "unread_user";

  await query(
    `UPDATE conversations
        SET ${col} = 0, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL`,
    [conversationId]
  );

  /* Mark individual messages as read */
  const senderType = readerType === "admin" ? "user" : "admin";
  await query(
    `UPDATE messages
        SET is_read  = TRUE,
            read_at  = NOW(),
            updated_at = NOW()
      WHERE conversation_id = $1
        AND sender_type     = $2
        AND is_read         = FALSE`,
    [conversationId, senderType]
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   listConversations
   ───────────────────────────────────────────────────────────────────────────── */
async function listConversations({
  status = "open",
  limit  = 100,
  page   = 1,
  search = null,
  userFilter = null,
  bookingId = null,
} = "") {

  const offset     = (Math.max(1, page) - 1) * Math.max(1, limit);
  const conditions = ["c.deleted_at IS NULL"];
  const params     = [];
  let   p          = 1;

  /* Status filter — allow 'all' to skip */
  if (status && status !== "all") {
    conditions.push(`c.status = $${p++}`);
    params.push(status);
  }

  /* User filter — for non-admin users to see only their own conversations */
  if (userFilter && userFilter.user_id) {
    conditions.push(`c.user_id = $${p++}`);
    params.push(userFilter.user_id);
  }

  /* Search filter */
  if (search && String(search).trim()) {
    conditions.push(`(
      c.subject    ILIKE $${p}   OR
      c.guest_name  ILIKE $${p}  OR
      c.guest_email ILIKE $${p}  OR
      u.full_name   ILIKE $${p}  OR
      u.email       ILIKE $${p}  OR
      c.last_message ILIKE $${p}
    )`);
    params.push(`%${String(search).trim()}%`);
    p++;
  }

  /* Booking filter */
  if (bookingId) {
    conditions.push(`c.booking_id = $${p++}`);
    params.push(parseInt(bookingId, 10) || bookingId);
  }

  const where = conditions.join(" AND ");

  /* Total count */
  const countRes = await query(
    `SELECT COUNT(*)::INT AS total
       FROM conversations c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE ${where}`,
    params
  );
  const total = countRes.rows[0]?.total || 0;

  /* Paginated rows */
  const rowsRes = await query(
    `SELECT
       c.*,
       u.full_name   AS user_full_name,
       u.email       AS user_email,
       u.avatar_url  AS user_avatar,
       u.phone       AS user_phone,
       u.nationality AS user_nationality,
       u.username    AS user_username,
       (
         SELECT COUNT(*)::INT FROM messages m
          WHERE m.conversation_id = c.id
       ) AS message_count
     FROM conversations c
     LEFT JOIN users u ON u.id = c.user_id
     WHERE ${where}
     ORDER BY
       CASE c.priority
         WHEN 'urgent' THEN 1
         WHEN 'high'   THEN 2
         WHEN 'normal' THEN 3
         WHEN 'low'    THEN 4
         ELSE 5
       END,
       c.last_message_at DESC NULLS LAST,
       c.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, limit, offset]
  );

  /* Merge user info into each row for convenience */
  const rows = rowsRes.rows.map((row) => ({
    ...row,
    guest_name:  row.guest_name  || row.user_full_name || null,
    guest_email: row.guest_email || row.user_email     || null,
    user: row.user_id
      ? {
          id:          row.user_id,
          fullName:    row.user_full_name,
          email:       row.user_email,
          avatarUrl:   row.user_avatar,
          phone:       row.user_phone,
          nationality: row.user_nationality,
          username:    row.user_username,
        }
      : null,
  }));

  return { rows, total };
}

/* ─────────────────────────────────────────────────────────────────────────────
   getConversationWithMessages
   ───────────────────────────────────────────────────────────────────────────── */
async function getConversationWithMessages(conversationId) {
  if (!conversationId) throw new Error("conversationId is required");

  /* Conversation + user info */
  const convRes = await query(
    `SELECT
       c.*,
       u.full_name   AS user_full_name,
       u.email       AS user_email,
       u.avatar_url  AS user_avatar,
       u.phone       AS user_phone,
       u.nationality AS user_nationality,
       u.username    AS user_username
     FROM conversations c
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [conversationId]
  );

  const conv = convRes.rows[0];
  if (!conv) return null;

  /* Messages */
  const msgRes = await query(
    `SELECT * FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC`,
    [conversationId]
  );

  return {
    ...conv,
    guest_name:  conv.guest_name  || conv.user_full_name || null,
    guest_email: conv.guest_email || conv.user_email     || null,
    user: conv.user_id
      ? {
          id:          conv.user_id,
          fullName:    conv.user_full_name,
          email:       conv.user_email,
          avatarUrl:   conv.user_avatar,
          phone:       conv.user_phone,
          nationality: conv.user_nationality,
          username:    conv.user_username,
        }
      : null,
    messages: msgRes.rows,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   getConversationByBookingId
   ───────────────────────────────────────────────────────────────────────────── */
async function getConversationByBookingId(bookingId) {
  if (!bookingId) return null;

  const convRes = await query(
    `SELECT
       c.*,
       u.full_name   AS user_full_name,
       u.email       AS user_email,
       u.avatar_url  AS user_avatar,
       u.phone       AS user_phone,
       u.nationality AS user_nationality,
       u.username    AS user_username
     FROM conversations c
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.booking_id = $1 AND c.deleted_at IS NULL
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
     LIMIT 1`,
    [bookingId],
  );

  const conv = convRes.rows[0];
  if (!conv) return null;

  const msgRes = await query(
    `SELECT * FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
    [conv.id],
  );

  return {
    ...conv,
    guest_name:  conv.guest_name  || conv.user_full_name || null,
    guest_email: conv.guest_email || conv.user_email     || null,
    user: conv.user_id
      ? {
          id:          conv.user_id,
          fullName:    conv.user_full_name,
          email:       conv.user_email,
          avatarUrl:   conv.user_avatar,
          phone:       conv.user_phone,
          nationality: conv.user_nationality,
          username:    conv.user_username,
        }
      : null,
    messages: msgRes.rows,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   toggleReaction
   ───────────────────────────────────────────────────────────────────────────── */
async function toggleReaction({ messageId, userId, emoji, add = true }) {
  if (!messageId) throw Object.assign(new Error("messageId is required"), { status: 400 });
  if (!userId)    throw Object.assign(new Error("userId is required"),    { status: 400 });
  if (!emoji)     throw Object.assign(new Error("emoji is required"),     { status: 400 });

  /* Fetch current reactions */
  const res = await query(
    `SELECT reactions FROM messages WHERE id = $1`,
    [messageId]
  );

  if (!res.rows[0]) {
    throw Object.assign(new Error("Message not found"), { status: 404 });
  }

  const reactions = res.rows[0].reactions || {};

  if (add) {
    if (!reactions[emoji]) reactions[emoji] = [];
    if (!reactions[emoji].includes(userId)) {
      reactions[emoji].push(userId);
    }
  } else {
    if (reactions[emoji]) {
      reactions[emoji] = reactions[emoji].filter((id) => id !== userId);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    }
  }

  await query(
    `UPDATE messages
        SET reactions  = $1, updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(reactions), messageId]
  );

  return reactions;
}

/* ─────────────────────────────────────────────────────────────────────────────
   changeConversationStatus
   ───────────────────────────────────────────────────────────────────────────── */
async function changeConversationStatus({ conversationId, status }) {
  if (!conversationId) throw Object.assign(new Error("conversationId is required"), { status: 400 });

  const allowed = ["open", "pending", "closed", "resolved"];
  if (!allowed.includes(status)) {
    throw Object.assign(
      new Error(`Invalid status. Allowed: ${allowed.join(", ")}`),
      { status: 400 }
    );
  }

  const res = await query(
    `UPDATE conversations
        SET status     = $1,
            closed_at  = CASE WHEN $1 IN ('closed','resolved') THEN NOW() ELSE NULL END,
            updated_at = NOW()
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING *`,
    [status, conversationId]
  );

  return res.rows[0] || null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   EXPORTS
   ───────────────────────────────────────────────────────────────────────────── */
module.exports = {
  getOrCreateConversation,
  insertMessage,
  markConversationRead,
  listConversations,
  getConversationWithMessages,
  getConversationByBookingId,
  toggleReaction,
  changeConversationStatus,
};