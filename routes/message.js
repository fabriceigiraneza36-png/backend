// backend/src/routes/message.js
// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGES ROUTES v3.3
// ═══════════════════════════════════════════════════════════════════════════════
// Fixes:
//   • Defensive import of every util function — if messaging.js doesn't export
//     a function, an inline fallback is used so the server never crashes on boot.
//   • listConversations inline fallback with full pagination support.
//   • getConversationWithMessages inline fallback.
//   • All other utils have safe fallbacks too.
//   • optionalAuth falls back gracefully if not exported from auth middleware.
// ═══════════════════════════════════════════════════════════════════════════════

"use strict";

const router = require("express").Router();
const { query }  = require("../config/db");
const logger     = require("../utils/logger");

/* ═══════════════════════════════════════════════════════════════════════════
   SAFE MIDDLEWARE IMPORTS
═══════════════════════════════════════════════════════════════════════════ */

let protect, adminProtect, optionalAuth;

try {
  const auth = require("../middleware/auth");

  protect      = auth.protect      || auth.authenticate  || auth.verifyToken  || null;
  adminProtect = auth.adminProtect || auth.adminOnly      || auth.requireAdmin || null;
  optionalAuth = auth.optionalAuth || auth.optAuth        || null;
} catch (err) {
  logger.warn("[Messages] Could not load auth middleware:", err.message);
}

// Ultimate fallbacks — never let a missing middleware crash a route definition
const _pass        = (_req, _res, next) => next();
const _requireAuth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
  next();
};

if (typeof protect      !== "function") protect      = _requireAuth;
if (typeof adminProtect !== "function") adminProtect = _requireAuth;
if (typeof optionalAuth !== "function") optionalAuth = _pass;

/* ═══════════════════════════════════════════════════════════════════════════
   SAFE UTIL IMPORTS — every function has an inline fallback
═══════════════════════════════════════════════════════════════════════════ */

let _getOrCreateConversation,
    _insertMessage,
    _markConversationRead,
    _listConversations,
    _getConversationWithMessages,
    _toggleReaction,
    _changeConversationStatus;

try {
  const messaging = require("../utils/messaging");

  _getOrCreateConversation   = messaging.getOrCreateConversation;
  _insertMessage             = messaging.insertMessage;
  _markConversationRead      = messaging.markConversationRead;
  _listConversations         = messaging.listConversations;
  _getConversationWithMessages = messaging.getConversationWithMessages;
  _getConversationByBookingId = messaging.getConversationByBookingId;
  _toggleReaction            = messaging.toggleReaction;
  _changeConversationStatus  = messaging.changeConversationStatus;

  // Log which ones are missing so it is easy to spot in logs
  const names = [
    "getOrCreateConversation", "insertMessage", "markConversationRead",
    "listConversations", "getConversationWithMessages", "getConversationByBookingId",
    "toggleReaction", "changeConversationStatus",
  ];
  for (const name of names) {
    if (typeof messaging[name] !== "function") {
      logger.warn(`[Messages] utils/messaging.js is missing export: ${name} — using inline fallback`);
    }
  }
} catch (err) {
  logger.warn("[Messages] Could not load utils/messaging:", err.message, "— all inline fallbacks active");
}

/* ── Inline fallback: listConversations ─────────────────────────────────── */
const listConversations = typeof _listConversations === "function"
  ? _listConversations
  : async ({ status, limit = 100, page = 1, search, bookingId } = {}) => {
      const conditions = ["c.deleted_at IS NULL"];
      const params     = [];
      let   p          = 1;

      if (status && status !== "all") {
        conditions.push(`c.status = $${p++}`);
        params.push(status);
      }

      if (bookingId) {
        conditions.push(`c.booking_id = $${p++}`);
        params.push(parseInt(bookingId, 10) || bookingId);
      }

      if (search && String(search).trim()) {
        const s = `%${String(search).trim()}%`;
        conditions.push(`(
          c.guest_name  ILIKE $${p} OR
          c.guest_email ILIKE $${p} OR
          c.subject     ILIKE $${p} OR
          u.full_name   ILIKE $${p} OR
          u.email       ILIKE $${p}
        )`);
        params.push(s);
        p++;
      }

      const where  = conditions.join(" AND ");
      const lim    = Math.min(parseInt(limit)  || 100, 500);
      const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

      const [countRes, dataRes] = await Promise.all([
        query(
          `SELECT COUNT(*)::INT AS total
             FROM conversations c
             LEFT JOIN users u ON u.id = c.user_id
            WHERE ${where}`,
          params,
        ),
        query(
          `SELECT
             c.*,
             u.id          AS u_id,
             u.full_name   AS u_full_name,
             u.email       AS u_email,
             u.avatar_url  AS u_avatar_url,
             u.phone       AS u_phone,
             u.is_verified AS u_is_verified,
             (
               SELECT COUNT(*)::INT FROM messages m
                WHERE m.conversation_id = c.id
             ) AS message_count
           FROM conversations c
           LEFT JOIN users u ON u.id = c.user_id
           WHERE ${where}
           ORDER BY
             c.unread_admin DESC NULLS LAST,
             COALESCE(c.last_message_at, c.created_at) DESC NULLS LAST
           LIMIT $${p} OFFSET $${p + 1}`,
          [...params, lim, offset],
        ),
      ]);

      const total = countRes.rows[0]?.total || 0;

      const rows = dataRes.rows.map((r) => ({
        ...r,
        user: r.u_id
          ? {
              id:         r.u_id,
              fullName:   r.u_full_name,
              email:      r.u_email,
              avatarUrl:  r.u_avatar_url,
              phone:      r.u_phone,
              isVerified: r.u_is_verified,
            }
          : null,
      }));

      return { rows, total };
    };

/* ── Inline fallback: getConversationByBookingId ─────────────────────────── */
const getConversationByBookingId = typeof _getConversationByBookingId === "function"
  ? _getConversationByBookingId
  : async (bookingId) => {
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
        `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
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
    };

/* ── Inline fallback: getOrCreateConversation ───────────────────────────── */
const getOrCreateConversation = typeof _getOrCreateConversation === "function"
  ? _getOrCreateConversation
  : async ({
      userId, sessionId, guestName, guestEmail,
      bookingId, bookingNumber, subject,
      channel = "live_chat", source = "guest",
      priority = "normal", ipAddress, userAgent,
    } = {}) => {
      // Try to find existing open conversation
      if (userId) {
        const existing = await query(
          `SELECT * FROM conversations
            WHERE user_id = $1 AND status != 'closed' AND deleted_at IS NULL
            ORDER BY last_message_at DESC NULLS LAST, created_at DESC
            LIMIT 1`,
          [userId],
        );
        if (existing.rows[0]) return existing.rows[0];
      } else if (sessionId) {
        const existing = await query(
          `SELECT * FROM conversations
            WHERE session_id = $1 AND status != 'closed' AND deleted_at IS NULL
            ORDER BY last_message_at DESC NULLS LAST, created_at DESC
            LIMIT 1`,
          [sessionId],
        );
        if (existing.rows[0]) return existing.rows[0];
      }

      // Create new
      const { rows } = await query(
        `INSERT INTO conversations
           (user_id, session_id, guest_name, guest_email,
            booking_id, subject, channel, source, priority,
            ip_address, user_agent, status,
            unread_admin, unread_user, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            'open', 0, 0, NOW(), NOW())
         RETURNING *`,
        [
          userId       || null,
          sessionId    || null,
          guestName    || null,
          guestEmail   || null,
          bookingId    || null,
          subject      || null,
          channel,
          source,
          priority,
          ipAddress    || null,
          userAgent    || null,
        ],
      );
      return rows[0];
    };

/* ── Inline fallback: insertMessage ─────────────────────────────────────── */
const insertMessage = typeof _insertMessage === "function"
  ? _insertMessage
  : async ({
      conversationId, senderType, senderId,
      senderName, senderEmail, senderAvatar,
      body, replyToId, msgType = "text",
    } = {}) => {
      const { rows } = await query(
        `INSERT INTO messages
           (conversation_id, sender_type, sender_id,
            sender_name, sender_email, sender_avatar,
            body, reply_to_id, msg_type,
            is_read, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, FALSE, NOW(), NOW())
         RETURNING *`,
        [
          conversationId, senderType, senderId || null,
          senderName || null, senderEmail || null, senderAvatar || null,
          body, replyToId || null, msgType,
        ],
      );

      const msg = rows[0];

      // Update conversation last_message + unread counter
      const unreadCol = senderType === "admin" ? "unread_user" : "unread_admin";
      await query(
        `UPDATE conversations
            SET last_message    = $1,
                last_message_at = NOW(),
                updated_at      = NOW(),
                ${unreadCol}    = COALESCE(${unreadCol}, 0) + 1
          WHERE id = $2`,
        [String(body).slice(0, 255), conversationId],
      ).catch(() => {});

      return msg;
    };

/* ── Inline fallback: markConversationRead ──────────────────────────────── */
const markConversationRead = typeof _markConversationRead === "function"
  ? _markConversationRead
  : async ({ conversationId, readerType } = {}) => {
      const col = readerType === "admin" ? "unread_admin" : "unread_user";
      await query(
        `UPDATE conversations
            SET ${col} = 0, updated_at = NOW()
          WHERE id = $1`,
        [conversationId],
      );
    };

/* ── Inline fallback: getConversationWithMessages ───────────────────────── */
const getConversationWithMessages = typeof _getConversationWithMessages === "function"
  ? _getConversationWithMessages
  : async (conversationId) => {
      const convRes = await query(
        `SELECT
           c.*,
           u.id          AS u_id,
           u.full_name   AS u_full_name,
           u.email       AS u_email,
           u.avatar_url  AS u_avatar_url,
           u.phone       AS u_phone,
           u.is_verified AS u_is_verified
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
         WHERE c.id = $1 AND c.deleted_at IS NULL`,
        [conversationId],
      );
      if (!convRes.rows[0]) return null;

      const conv = {
        ...convRes.rows[0],
        user: convRes.rows[0].u_id
          ? {
              id:         convRes.rows[0].u_id,
              fullName:   convRes.rows[0].u_full_name,
              email:      convRes.rows[0].u_email,
              avatarUrl:  convRes.rows[0].u_avatar_url,
              phone:      convRes.rows[0].u_phone,
              isVerified: convRes.rows[0].u_is_verified,
            }
          : null,
      };

      const msgsRes = await query(
        `SELECT * FROM messages
          WHERE conversation_id = $1
          ORDER BY created_at ASC`,
        [conversationId],
      );

      conv.messages      = msgsRes.rows;
      conv.message_count = msgsRes.rows.length;
      return conv;
    };

/* ── Inline fallback: toggleReaction ────────────────────────────────────── */
const toggleReaction = typeof _toggleReaction === "function"
  ? _toggleReaction
  : async ({ messageId, userId, emoji, add } = {}) => {
      const res = await query(
        `SELECT reactions FROM messages WHERE id = $1`,
        [messageId],
      );
      const current = res.rows[0]?.reactions || {};

      if (!current[emoji]) current[emoji] = [];
      if (add) {
        if (!current[emoji].includes(userId)) current[emoji].push(userId);
      } else {
        current[emoji] = current[emoji].filter((id) => id !== userId);
        if (!current[emoji].length) delete current[emoji];
      }

      await query(
        `UPDATE messages SET reactions = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(current), messageId],
      );

      return current;
    };

/* ── Inline fallback: changeConversationStatus ──────────────────────────── */
const changeConversationStatus = typeof _changeConversationStatus === "function"
  ? _changeConversationStatus
  : async ({ conversationId, status } = {}) => {
      const VALID = new Set(["open", "closed", "pending", "resolved"]);
      if (!VALID.has(status)) {
        const err = new Error(`Invalid status: ${status}. Must be one of: ${[...VALID].join(", ")}`);
        err.status = 400;
        throw err;
      }

      const extra  = status === "closed" ? ", closed_at = NOW()" : "";
      const { rows } = await query(
        `UPDATE conversations
            SET status     = $1,
                updated_at = NOW()
                ${extra}
          WHERE id = $2 AND deleted_at IS NULL
          RETURNING *`,
        [status, conversationId],
      );
      return rows[0] || null;
    };

/* ═══════════════════════════════════════════════════════════════════════════
   RESHAPERS  (defined early — used by all route handlers)
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
    unreadUser:    row.unread_user    || 0,
    unreadAdmin:   row.unread_admin   || 0,
    tags:          row.tags           || [],
    metadata:      row.metadata       || {},
    source:        row.source,
    bookingId:     row.booking_id     || null,
    bookingNumber: row.booking_number || row.metadata?.bookingNumber || null,
    ipAddress:     row.ip_address,
    userAgent:     row.user_agent,
    closedAt:      row.closed_at,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
    messageCount:  row.message_count  || 0,
    user:          row.user           || null,
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

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN ROLE CHECK HELPER
═══════════════════════════════════════════════════════════════════════════ */

const ADMIN_ROLES = new Set([
  "admin", "superadmin", "super_admin", "moderator", "editor",
]);

const isAdminUser = (req) =>
  req.userType === "admin" ||
  ADMIN_ROLES.has(req.user?.role || "") ||
  req.user?.type === "admin";

/* ═══════════════════════════════════════════════════════════════════════════
   ROUTES
═══════════════════════════════════════════════════════════════════════════ */

/* ── Health check ───────────────────────────────────────────────────────── */
router.get("/health", (_req, res) =>
  res.json({
    success: true,
    service: "messages",
    version: "3.3",
    ts:      new Date().toISOString(),
  }),
);

/* ── GET /stats ─────────────────────────────────────────────────────────── */
router.get("/stats", adminProtect, async (req, res) => {
  try {
    const [openR, closedR, pendingR, unreadR, todayR] = await Promise.all([
      query(`SELECT COUNT(*)::INT AS cnt FROM conversations
              WHERE status = 'open'    AND deleted_at IS NULL`),
      query(`SELECT COUNT(*)::INT AS cnt FROM conversations
              WHERE status = 'closed'  AND deleted_at IS NULL`),
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
        open:     openR.rows[0]?.cnt    || 0,
        closed:   closedR.rows[0]?.cnt  || 0,
        pending:  pendingR.rows[0]?.cnt || 0,
        unread:   unreadR.rows[0]?.cnt  || 0,
        newToday: todayR.rows[0]?.cnt   || 0,
      },
    });
  } catch (err) {
    logger.error(`[Messages] GET /stats: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
});

/* ── GET /users-list ────────────────────────────────────────────────────── */
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
      [...params, parseInt(limit, 10)],
    );

    const users = result.rows.map((u) => ({
      id:                 u.id,
      email:              u.email,
      username:           u.username,
      fullName:           u.full_name,
      avatarUrl:          u.avatar_url,
      phone:              u.phone,
      nationality:        u.nationality,
      isVerified:         u.is_verified,
      lastLogin:          u.last_login,
      createdAt:          u.created_at,
      bookingCount:       u.booking_count        || 0,
      lastConversationId: u.last_conversation_id || null,
      lastMessageAt:      u.last_message_at      || null,
      unreadAdmin:        u.unread_admin         || 0,
    }));

    return res.json({ success: true, data: users, count: users.length });
  } catch (err) {
    logger.error(`[Messages] GET /users-list: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to fetch users list" });
  }
});

/* ── GET /conversations — list conversations (admin: all, user: own) ─────── */
router.get("/conversations", protect, async (req, res) => {
  try {
    const {
      status = "open",
      limit  = 100,
      page   = 1,
      search,
      bookingId,
    } = req.query;

    const userFilter = isAdminUser(req) ? {} : { user_id: req.user.id };

    const { rows, total } = await listConversations({
      status,
      limit:  parseInt(limit,  10),
      page:   parseInt(page,   10),
      search,
      userFilter,
      bookingId: bookingId || null,
    });

    const lim = parseInt(limit, 10) || 100;
    const pg  = parseInt(page,  10) || 1;

    return res.json({
      success: true,
      data:    rows.map((r) => reshapeConversation(r)),
      pagination: {
        page:    pg,
        limit:   lim,
        total,
        pages:   Math.ceil(total / lim),
        hasMore: pg * lim < total,
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

/* ── POST /admin/conversations — admin starts chat with a user ──────────── */
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

    const userCheck = await query(
      `SELECT id, email, full_name, avatar_url
         FROM users
        WHERE id = $1 AND is_active = TRUE`,
      [uid],
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
      bookingId:     bookingId     || null,
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
      } catch (_) { /* socket errors never break REST */ }
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

/* ── POST /conversations — guest / user / admin starts conversation ──────── */
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
      targetUserId,
    } = req.body;

    const ipAddress = req.ip;
    const userAgent = req.get("user-agent") || null;

    /* ── Resolve effective userId ──────────────────────────────────────── */
    let userId = null;

    if (req.user) {
      if (isAdminUser(req) && targetUserId) {
        userId = parseInt(targetUserId, 10) || null;
      } else {
        userId = req.user.id;
      }
    }

    if (!userId && !sessionId) {
      return res.status(400).json({
        success: false,
        message: "Either userId (auth) or sessionId is required",
      });
    }

    const conv = await getOrCreateConversation({
      userId:        userId    || null,
      sessionId:     userId    ? null : (sessionId || null),
      guestName:     guestName  || req.user?.full_name  || null,
      guestEmail:    guestEmail || req.user?.email      || null,
      bookingId:     bookingId     || null,
      bookingNumber: bookingNumber || null,
      subject:       subject   || null,
      channel:       channel   || "live_chat",
      source:        source    || (req.user ? "authenticated" : "guest"),
      priority:      priority  || "normal",
      ipAddress,
      userAgent,
    });

    if (firstMessage && String(firstMessage).trim()) {
      const callerIsAdmin = req.user && isAdminUser(req);

      await insertMessage({
        conversationId: conv.id,
        senderType:     callerIsAdmin ? "admin" : "user",
        senderId:       req.user?.id      || null,
        senderName:     guestName         || req.user?.full_name || null,
        senderEmail:    guestEmail        || req.user?.email     || null,
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

/* ── GET /conversations/:id ─────────────────────────────────────────────── */
router.get("/conversations/:id", protect, async (req, res) => {
  try {
    const data = await getConversationWithMessages(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    /* Users may only see their own conversation */
    if (!isAdminUser(req) && data.user_id && data.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    return res.json({ success: true, data: reshapeConversation(data, true) });
  } catch (err) {
    logger.error(`[Messages] GET /conversations/:id: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to fetch conversation" });
  }
});

/* ── GET /conversations/by-booking/:bookingId — lookup by booking ─────────── */
router.get("/conversations/by-booking/:bookingId", protect, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const data = await getConversationByBookingId(parseInt(bookingId, 10) || bookingId);

    if (!data) {
      return res.status(404).json({ success: false, message: "No conversation found for this booking" });
    }

    return res.json({ success: true, data: reshapeConversation(data, true) });
  } catch (err) {
    logger.error(`[Messages] GET /conversations/by-booking: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to fetch booking conversation" });
  }
});

/* ── POST /conversations/:id/messages ───────────────────────────────────── */
router.post("/conversations/:id/messages", protect, async (req, res) => {
  try {
    const { id }              = req.params;
    const { body, replyToId } = req.body;

    if (!body || !String(body).trim()) {
      return res.status(400).json({ success: false, message: "Message body is required" });
    }

    const convCheck = await query(
      `SELECT id, user_id FROM conversations
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!convCheck.rows[0]) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    /* Users may only message their own conversation */
    if (!isAdminUser(req) && convCheck.rows[0].user_id && convCheck.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const isAdminReq = isAdminUser(req);
    const msg = await insertMessage({
      conversationId: id,
      senderType:     isAdminReq ? "admin" : "user",
      senderId:       req.user.id,
      senderName:     isAdminReq
        ? (req.user.full_name || req.user.username || "Admin")
        : (req.user.full_name || req.user.name || "User"),
      senderEmail:    req.user.email,
      senderAvatar:   req.user.avatar_url || null,
      body:           String(body).trim(),
      replyToId:      replyToId || null,
    });

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`conversation-${id}`).emit("msg:message", reshapeMessage(msg));
        if (!isAdminReq && convCheck.rows[0].user_id) {
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

/* ── PATCH /conversations/:id/read ─────────────────────────────────────── */
router.patch("/conversations/:id/read", protect, async (req, res) => {
  try {
    const convCheck = await query(
      `SELECT id, user_id FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!convCheck.rows[0]) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    /* Users may only mark their own conversation as read */
    if (!isAdminUser(req) && convCheck.rows[0].user_id && convCheck.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const readerType = isAdminUser(req) ? "admin" : "user";
    await markConversationRead({
      conversationId: req.params.id,
      readerType,
    });

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`conversation-${req.params.id}`).emit("msg:conversation-updated", {
          id:            req.params.id,
          unreadAdmin:   readerType === "admin" ? 0 : undefined,
          unreadUser:    readerType === "user" ? 0 : undefined,
        });
      }
    } catch (_) { /* silent */ }

    return res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    logger.error(`[Messages] PATCH /conversations/:id/read: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to mark as read" });
  }
});

/* ── PATCH /conversations/:id/status ───────────────────────────────────── */
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
          reshapeConversation(conv),
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

/* ── PATCH /conversations/:cid/messages/:mid/react ──────────────────────── */
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
  },
);

/* ── DELETE /conversations/:id — soft delete ────────────────────────────── */
router.delete("/conversations/:id", adminProtect, async (req, res) => {
  try {
    const result = await query(
      `UPDATE conversations
          SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id`,
      [req.params.id],
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

module.exports = router;