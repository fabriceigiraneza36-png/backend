// utils/messaging.js
"use strict";

/**
 * Shared messaging / conversation service.
 *
 * Provides the persistence + serialization helpers used by BOTH:
 *   • backend/routes/message.js     (REST HTTP API for admin panel & user app)
 *   • backend/server.js             (Socket.io live-chat handlers)
 *
 * Tables (created by server.js ensureMessagingSchema):
 *   conversations(id, session_id UNIQUE, user_id, guest_name, guest_email,
 *     subject, status, priority, assigned_admin, first_message, last_message,
 *     last_message_at, unread_user, unread_admin, tags, metadata, ip_address,
 *     source, closed_at, deleted_at, deleted_by, created_at, updated_at)
 *   messages(id, conversation_id, sender_type, sender_id, sender_name,
 *     sender_email, sender_avatar, body, msg_type, attachment_url, is_read,
 *     read_at, edited, deleted, reply_to_id, metadata, created_at)
 */

const { query } = require("../config/db");
const logger    = require("./logger");
const crypto    = require("crypto");

/* ── Socket.io (optional — only available after server boot) ────────────────── */
const getIO = () => {
  try {
    const socketBus = require("./socketBus");
    return socketBus?.getIO?.() || null;
  } catch {
    return null;
  }
};

/* ── Safe email sender (optional) ───────────────────────────────────────────── */
let _sendEmail = null;
for (const p of ["../utils/email", "../services/emailService", "../utils/emailService"]) {
  try {
    const m = require(p);
    if (typeof m.sendEmail === "function") { _sendEmail = m.sendEmail; break; }
  } catch { /* try next */ }
}

/* ════════════════════════════════════════════════════════════════════════════
   SESSION HELPERS
   ══════════════════════════════════════════════════════════════════════════ */
const makeSessionId = (prefix = "conv") =>
  `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;

/* ════════════════════════════════════════════════════════════════════════════
   CONVERSATION HELPERS
   ══════════════════════════════════════════════════════════════════════════ */
const getOrCreateConversation = async ({
  sessionId,
  userId       = null,
  guestName    = null,
  guestEmail   = null,
  subject      = null,
  status       = "open",
  priority     = "normal",
  source       = "website",
  ipAddress    = null,
  bookingId    = null,
  bookingNumber = null,
  metadata     = {},
} = {}) => {
  let sid = String(sessionId || "").trim();
  if (!sid) sid = makeSessionId("booking");

  const existing = await query(
    `SELECT c.*, u.full_name AS user_full_name, u.email AS user_email,
            u.avatar_url AS user_avatar
       FROM conversations c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.session_id = $1 AND c.deleted_at IS NULL
      LIMIT 1`,
    [sid],
  );

  if (existing.rows[0]) {
    const conv = existing.rows[0];
    // Enrich with any newly provided identity / booking linkage
    if (userId || guestName || guestEmail || bookingId) {
      await query(
        `UPDATE conversations SET
           user_id          = COALESCE($1, user_id),
           guest_name       = COALESCE(NULLIF($2,''), guest_name),
           guest_email      = COALESCE(NULLIF($3,''), guest_email),
           booking_id       = COALESCE($4, booking_id),
           updated_at       = NOW()
         WHERE session_id = $5`,
        [userId || null, guestName || null, guestEmail || null, bookingId || null, sid],
      ).catch(() => {});
    }
    return conv;
  }

  const inserted = await query(
    `INSERT INTO conversations
       (session_id, user_id, guest_name, guest_email, subject,
        status, priority, source, ip_address, booking_id, booking_number, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      sid,
      userId          || null,
      guestName       || null,
      guestEmail      || null,
      subject         || null,
      status,
      priority,
      source          || "website",
      ipAddress       || null,
      bookingId       || null,
      bookingNumber   || null,
      JSON.stringify(metadata || {}),
    ],
  );
  return inserted.rows[0];
};

const findConversationById = async (id) => {
  const { rows } = await query(
    `SELECT c.*, u.full_name AS user_full_name, u.email AS user_email,
            u.avatar_url AS user_avatar
       FROM conversations c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id = $1 AND c.deleted_at IS NULL
      LIMIT 1`,
    [id],
  );
  return rows[0] || null;
};

const findConversationBySession = async (sessionId) => {
  const sid = String(sessionId || "").trim();
  if (!sid) return null;
  const { rows } = await query(
    `SELECT c.*, u.full_name AS user_full_name, u.email AS user_email,
            u.avatar_url AS user_avatar
       FROM conversations c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.session_id = $1 AND c.deleted_at IS NULL
      LIMIT 1`,
    [sid],
  );
  return rows[0] || null;
};

/* ════════════════════════════════════════════════════════════════════════════
   MESSAGE HELPERS
   ══════════════════════════════════════════════════════════════════════════ */
const saveMessage = async ({
  conversationId,
  senderType,
  senderId     = null,
  senderName   = null,
  senderEmail  = null,
  senderAvatar = null,
  body,
  msgType      = "text",
  metadata     = {},
}) => {
  const text = String(body || "").trim();
  if (!text) throw new Error("Message body is required");

  const { rows } = await query(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_id, sender_name,
        sender_email, sender_avatar, body, msg_type, metadata, is_read)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
     RETURNING *`,
    [
      conversationId,
      senderType,
      senderId     || null,
      senderName   || null,
      senderEmail  || null,
      senderAvatar || null,
      text,
      msgType,
      JSON.stringify(metadata || {}),
    ],
  );

  const msg    = rows[0];
  const isUser = senderType !== "admin";

  await query(
    `UPDATE conversations SET
       last_message    = $1,
       last_message_at = NOW(),
       first_message   = COALESCE(first_message, $1),
       unread_admin    = CASE WHEN $2 THEN unread_admin + 1 ELSE unread_admin END,
       unread_user     = CASE WHEN $3 THEN unread_user  + 1 ELSE unread_user  END,
       updated_at      = NOW()
     WHERE id = $4`,
    [text, isUser, !isUser, conversationId],
  ).catch(() => {});

  return msg;
};

const getMessages = async (conversationId, limit = 200) => {
  const { rows } = await query(
    `SELECT * FROM messages
      WHERE conversation_id = $1 AND deleted = false
      ORDER BY created_at ASC
      LIMIT $2`,
    [conversationId, limit],
  );
  return rows;
};

const countUnreadAdmin = async (conversationId) => {
  const { rows } = await query(
    `SELECT COUNT(*) AS n FROM messages
      WHERE conversation_id = $1 AND sender_type != 'admin' AND is_read = false`,
    [conversationId],
  );
  return parseInt(rows[0]?.n || 0, 10);
};

const countUnreadUser = async (conversationId) => {
  const { rows } = await query(
    `SELECT COUNT(*) AS n FROM messages
      WHERE conversation_id = $1 AND sender_type = 'admin' AND is_read = false`,
    [conversationId],
  );
  return parseInt(rows[0]?.n || 0, 10);
};

const markReadForRecipient = async (conversationId, recipientType) => {
  // recipientType: 'admin' reads user messages, 'user' reads admin messages
  const senderToRead = recipientType === "admin" ? "user" : "admin";
  await query(
    `UPDATE messages
        SET is_read = true, read_at = NOW()
      WHERE conversation_id = $1 AND sender_type = $2 AND is_read = false`,
    [conversationId, senderToRead],
  ).catch(() => {});

  const col = recipientType === "admin" ? "unread_admin" : "unread_user";
  await query(
    `UPDATE conversations SET ${col} = 0, updated_at = NOW() WHERE id = $1`,
    [conversationId],
  ).catch(() => {});
};

/* ════════════════════════════════════════════════════════════════════════════
   SERIALISERS
   ══════════════════════════════════════════════════════════════════════════ */
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
  attachmentUrl:  row.attachment_url,
  isRead:         row.is_read,
  replyToId:      row.reply_to_id,
  metadata:       row.metadata || {},
  createdAt:      row.created_at,
});

const serializeConversation = (row) => ({
  id:             row.id,
  sessionId:      row.session_id,
  userId:         row.user_id,
  guestName:      row.guest_name,
  guestEmail:     row.guest_email,
  userFullName:   row.user_full_name || row.guest_name || null,
  userEmail:      row.user_email,
  userAvatar:     row.user_avatar,
  subject:        row.subject,
  status:         row.status,
  priority:       row.priority,
  assignedAdmin:  row.assigned_admin,
  bookingId:      row.booking_id,
  bookingNumber:  row.booking_number,
  firstMessage:   row.first_message,
  lastMessage:    row.last_message,
  lastMessageAt:  row.last_message_at,
  unreadUser:     row.unread_user || 0,
  unreadAdmin:    row.unread_admin || 0,
  tags:           row.tags || [],
  metadata:       row.metadata || {},
  createdAt:      row.created_at,
  updatedAt:      row.updated_at,
});

/* ════════════════════════════════════════════════════════════════════════════
   REAL-TIME BROADCAST
   ══════════════════════════════════════════════════════════════════════════ */
const broadcastMessage = ({
  conversationId,
  sessionId,
  userId,
  payload,
  adminPayload = null,
}) => {
  const io = getIO();
  if (!io) return;
  if (conversationId) io.to(`conv:${conversationId}`).emit("msg:message", payload);
  if (sessionId)       io.to(`session:${sessionId}`).emit("msg:message", payload);
  if (userId)          io.to(`user-${userId}`).emit("msg:message", payload);
  if (adminPayload)    io.to("admins").emit("msg:new-from-user", adminPayload);
};

const broadcastConversationUpdate = (conversation) => {
  const io = getIO();
  if (!io) return;
  const payload = serializeConversation(conversation);
  io.to(`conv:${conversation.id}`).emit("msg:conversation-updated", payload);
  io.to("admins").emit("msg:conversation-updated", payload);
};

/**
 * High-level helper used by the booking flow:
 *   create (or reuse) a conversation for a booking and post the first message
 *   from the customer, notifying the admin in real time.
 */
const startBookingConversation = async (booking, { ipAddress = null } = {}) => {
  const dest = booking.destination_name || booking.service_name ||
    booking.package_name || booking.country_name || "your trip";

  const subject = `New booking request — ${booking.booking_number || ""}`.trim();
  const firstBody =
    `Hi Altuvera team! I've just submitted a new booking request ` +
    `(${booking.booking_number || "n/a"}) for ${dest}. ` +
    (booking.special_requests
      ? `Special requests: ${booking.special_requests}`
      : "I'd love to discuss the details with you.");

  const conv = await getOrCreateConversation({
    sessionId:     `booking-${booking.booking_number || booking.id}`,
    userId:        booking.user_id || null,
    guestName:     booking.full_name || null,
    guestEmail:    booking.email || null,
    subject,
    status:        "open",
    priority:      "normal",
    source:        booking.source || "website",
    ipAddress,
    bookingId:      booking.id || null,
    bookingNumber: booking.booking_number || null,
    metadata:      { kind: "booking_request", bookingNumber: booking.booking_number || null },
  });

  // Only seed the first message if the conversation is brand new
  const { rows: existingMsgs } = await query(
    `SELECT id FROM messages WHERE conversation_id = $1 LIMIT 1`,
    [conv.id],
  );

  let message = null;
  if (existingMsgs.length === 0) {
    message = await saveMessage({
      conversationId: conv.id,
      senderType:     "user",
      senderId:       booking.user_id || null,
      senderName:     booking.full_name || (booking.email || "Guest"),
      senderEmail:    booking.email || null,
      body:           firstBody,
      metadata:       { kind: "booking_request", bookingNumber: booking.booking_number || null },
    });
  }

  // Real-time ping to admins
  const io = getIO();
  if (io) {
    io.to("admins").emit("msg:user-registered", {
      conversationId: conv.id,
      sessionId:      conv.session_id,
      guestName:      conv.guest_name || booking.full_name || "Guest",
      guestEmail:     conv.guest_email || booking.email || null,
      status:         conv.status,
      lastMessage:    conv.last_message,
      subject,
      bookingNumber:  booking.booking_number || null,
    });
  }

  return { conversation: conv, message };
};

module.exports = {
  getIO,
  makeSessionId,
  getOrCreateConversation,
  findConversationById,
  findConversationBySession,
  saveMessage,
  getMessages,
  countUnreadAdmin,
  countUnreadUser,
  markReadForRecipient,
  serializeMessage,
  serializeConversation,
  broadcastMessage,
  broadcastConversationUpdate,
  startBookingConversation,
};
