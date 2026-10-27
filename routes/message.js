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
const { query, pool } = require("../config/db");
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

if (typeof protect !== "function") protect = _requireAuth;
// Fail closed if the dedicated admin middleware is missing. Falling back to
// ordinary authentication would let any signed-in traveller call admin APIs.
if (typeof adminProtect !== "function") {
  adminProtect = (_req, res) => res.status(503).json({
    success: false,
    message: "Admin authorization is unavailable. Please contact support.",
  });
}
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
  : async ({ status, limit = 100, page = 1, search, bookingId, adminView = false } = {}) => {
      const conditions = ["c.deleted_at IS NULL"];
      const params     = [];
      let   p          = 1;

      if (adminView) {
        conditions.push("(c.user_id IS NOT NULL OR c.group_id IS NOT NULL)");
      }

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
             lm.sender_type AS last_message_sender_type,
             lm.sender_id AS last_message_sender_id,
             COALESCE(NULLIF(lm.sender_full_name, ''), NULLIF(lm.sender_username, ''), NULLIF(lm.sender_name, '')) AS last_message_sender_name,
             lm.sender_username AS last_message_sender_username,
             lm.sender_avatar AS last_message_sender_avatar,
             (
               SELECT COUNT(*)::INT FROM messages m
                WHERE m.conversation_id = c.id
             ) AS message_count
           FROM conversations c
           LEFT JOIN users u ON u.id = c.user_id
           LEFT JOIN LATERAL (
             SELECT m.sender_type, m.sender_id, m.sender_name, m.sender_avatar,
                    u_sender.full_name AS sender_full_name, u_sender.username AS sender_username
               FROM messages m
               LEFT JOIN users u_sender
                 ON m.sender_type IN ('user', 'traveler') AND u_sender.id = m.sender_id
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC
              LIMIT 1
           ) lm ON TRUE
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
  : async (conversationId, options = {}) => {
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
         WHERE c.id = $1 AND ($2::boolean OR c.deleted_at IS NULL)`,
        [conversationId, Boolean(options.includeDeleted)],
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

      const requestedLimit = Number.parseInt(options.limit, 10);
      if (Number.isInteger(requestedLimit) && requestedLimit > 0) {
        const limit = Math.min(requestedLimit, 50);
        const params = [conversationId];
        let cursorClause = "";
        if (options.beforeId != null) {
          params.push(Number.parseInt(options.beforeId, 10));
          cursorClause = ` AND id < $2`;
        }
        params.push(limit + 1);
        const msgsRes = await query(
          `SELECT m.*,
                  sender_user.full_name AS sender_user_full_name,
                  sender_user.username AS sender_user_username,
                  sender_user.avatar_url AS sender_user_avatar,
                  (sender_user.deleted_at IS NOT NULL) AS sender_unavailable
             FROM messages m
             LEFT JOIN users sender_user
               ON sender_user.id = m.sender_id AND m.sender_type = 'user'
            WHERE m.conversation_id = $1${cursorClause}
            ORDER BY m.id DESC
            LIMIT ${params.length}`,
          params,
        );
        conv.hasMoreMessages = msgsRes.rows.length > limit;
        conv.messages = msgsRes.rows.slice(0, limit).reverse();
      } else {
        const msgsRes = await query(
          `SELECT m.*,
                  sender_user.full_name AS sender_user_full_name,
                  sender_user.username AS sender_user_username,
                  sender_user.avatar_url AS sender_user_avatar,
                  (sender_user.deleted_at IS NOT NULL) AS sender_unavailable
             FROM messages m
             LEFT JOIN users sender_user
               ON sender_user.id = m.sender_id AND m.sender_type = 'user'
            WHERE m.conversation_id = $1
            ORDER BY m.created_at ASC, m.id ASC`,
          [conversationId],
        );
        conv.messages = msgsRes.rows;
      }
      conv.message_count = conv.messages.length;
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
      const VALID = new Set(["open", "closed", "pending", "resolved", "archived"]);
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
    guestName:     row.guest_name || row.user?.fullName || row.user_full_name || row.u_full_name || null,
    guestEmail:    row.guest_email || row.user?.email || row.user_email || row.u_email || null,
    guestAvatar:   row.user?.avatarUrl || row.user_avatar || row.u_avatar_url || row.guest_avatar || null,
    channel:       row.channel,
    subject:       row.subject,
    status:        row.status,
    priority:      row.priority,
    assignedAdmin: row.assigned_admin,
    firstMessage:  row.first_message,
    lastMessage:   row.last_message,
    lastMessageAt: row.last_message_at,
    lastMessageSenderType: row.last_message_sender_type || null,
    lastMessageSenderId: row.last_message_sender_id ?? null,
    lastMessageSenderName: row.last_message_sender_name || row.last_message_sender_username || null,
    lastMessageSenderUsername: row.last_message_sender_username || null,
    lastMessageSenderAvatar: row.last_message_sender_avatar || null,
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
    groupId:       row.group_id      || null,
    groupName:     row.group_name    || null,
    groupDescription: row.group_description || null,
    conversationType: row.conversation_type || (row.group_id ? "group" : "direct"),
    createdByAdminId: row.created_by_admin_id ?? row.createdByAdminId ?? null,
    groupCreatedBy: row.group_created_by ?? row.groupCreatedBy ?? null,
    recycleDeadline: row.recycle_deadline ?? row.recycleDeadline ?? null,
  };

  if (includeMessages && Array.isArray(row.messages)) {
    base.messages = row.messages.map(reshapeMessage);
  }

  return base;
}

function reshapeMessage(m) {
  if (!m) return null;
  const metadata = m.metadata && typeof m.metadata === "object" ? m.metadata : {};
  const senderUnavailable = Boolean(
    m.sender_unavailable || metadata.senderUnavailable || metadata.senderDeleted
  );
  const storedSenderName = String(m.sender_name || "").trim();
  const senderUsername = senderUnavailable ? null : (
    String(m.sender_user_username || metadata.senderUsername || metadata.sender_username || metadata.username || metadata.user?.username || "").trim() || null
  );
  const senderFullName = senderUnavailable ? "" : String(m.sender_user_full_name || "").trim();
  const genericUserName = /^(?:end\s*user|guest(?:\s*user)?|visitor|travell?er|user)$/i.test(storedSenderName);
  const resolvedSenderName = senderUnavailable
    ? "Deleted user"
    : (senderFullName || (m.sender_type === "user" && genericUserName ? (senderUsername || "Unknown member") : storedSenderName) || senderUsername || "Unknown member");
  return {
    id:             m.id,
    conversationId:  m.conversation_id,
    senderType:      m.sender_type,
    senderId:        senderUnavailable ? null : m.sender_id,
    senderName:      resolvedSenderName,
    senderUsername,
    senderEmail:     senderUnavailable ? null : m.sender_email,
    senderAvatar:    senderUnavailable ? null : (m.sender_user_avatar || m.sender_avatar || null),
    body:           m.body,
    msgType:        m.msg_type,
    attachmentUrl:  m.attachment_url,
    attachmentName: m.attachment_name,
    attachmentType: m.attachment_type,
    isRead:         m.is_read,
    readAt:         m.read_at,
    edited:         m.edited,
    editedAt:       m.edited_at,
    deleted:        m.deleted ?? false,
    deletedAt:      m.deleted_at || null,
    isPinned:       m.is_pinned ?? false,
    isHighlighted:  m.is_highlighted ?? false,
    replyToId:      m.reply_to_id,
    metadata:       senderUnavailable
      ? { ...metadata, senderDeleted: true, senderUnavailable: true }
      : metadata,
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

async function getActiveRegisteredUser(userId) {
  if (userId == null || userId === "") return null;
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ");
  const result = await query(
    "SELECT id, full_name, email, avatar_url FROM users " +
    "WHERE id::text = $1::text AND is_active = TRUE AND deleted_at IS NULL LIMIT 1",
    [userId],
  );
  return result.rows[0] || null;
}

async function ensureTravelerChannels(userId) {
  const profile = await getActiveRegisteredUser(userId);
  if (!profile) throw Object.assign(new Error("This account is no longer available."), { status: 403 });
  const defaults = [
    { type: "personal", channel: "personal_support", subject: "Personal chat with Altuvera", source: "system" },
    { type: "resource_support", channel: "booking_support", subject: "Bookings & travel help", source: "system" },
  ];
  for (const item of defaults) {
    await query(
      `INSERT INTO conversations
         (user_id, guest_name, guest_email, channel, subject, status, priority, source,
          conversation_type, metadata, unread_admin, unread_user, created_at, updated_at)
       SELECT $1,$2,$3,$4,$5,'open','normal',$6,CAST($7 AS VARCHAR),'{}'::jsonb,0,0,NOW(),NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM conversations
           WHERE user_id=$1 AND conversation_type=CAST($7 AS VARCHAR) AND deleted_at IS NULL
        )`,
      [profile.id, profile.full_name || null, profile.email || null, item.channel, item.subject, item.source, item.type],
    );
  }
  const { rows } = await query(
    `SELECT id, conversation_type FROM conversations
      WHERE user_id=$1 AND conversation_type IN ('personal','resource_support')
        AND deleted_at IS NULL`,
    [profile.id],
  );
  const personalId = rows.find(row => row.conversation_type === "personal")?.id;
  const supportId = rows.find(row => row.conversation_type === "resource_support")?.id;

  // Preserve old private-chat history while consolidating each account to the
  // two canonical private channels. Legacy booking-related messages move to
  // booking support; all other old private chats merge into personal support.
  if (personalId && supportId) {
    const { rows: legacyRows } = await query(
      `SELECT id, booking_id, booking_number, channel, subject
         FROM conversations
        WHERE user_id=$1 AND group_id IS NULL AND deleted_at IS NULL
          AND conversation_type NOT IN ('personal','resource_support')`,
      [profile.id],
    );
    for (const legacy of legacyRows) {
      const isBookingThread = legacy.booking_id != null ||
        /booking|package|destination|itinerary|travel|safari/i.test(String(legacy.channel || "") + " " + String(legacy.subject || ""));
      const targetId = isBookingThread ? supportId : personalId;
      await query(
        `UPDATE messages
            SET metadata = CASE WHEN $3::boolean
              THEN COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
                'kind','booking_question',
                'bookingId',$4::text,
                'bookingNumber',$5::text
              )
              ELSE COALESCE(metadata,'{}'::jsonb) END,
                conversation_id=$2
          WHERE conversation_id=$1`,
        [legacy.id, targetId, Boolean(legacy.booking_id), legacy.booking_id || null, legacy.booking_number || null],
      );
    }
    if (legacyRows.length) {
      await query(
        `UPDATE conversations
            SET deleted_at=NOW(), status='archived', updated_at=NOW()
          WHERE id = ANY($2::bigint[]) AND user_id=$1`,
        [profile.id, legacyRows.map(row => Number(row.id)).filter(Number.isFinite)],
      );
      for (const targetId of [personalId, supportId]) {
        await query(
          `UPDATE conversations c
              SET last_message=(SELECT m.body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1),
                  last_message_at=(SELECT m.created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1),
                  updated_at=NOW()
            WHERE c.id=$1`,
          [targetId],
        );
      }
    }
  }
  return { profile, channels: rows };
}

const ensureItineraryEmailColumns = async () => {
  await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS itinerary_status VARCHAR(40) DEFAULT 'not_started'");
  await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS itinerary JSONB DEFAULT '{}'::JSONB");
  await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS itinerary_version INTEGER DEFAULT 0");
  await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS itinerary_published_at TIMESTAMPTZ");
  await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS itinerary_approved_at TIMESTAMPTZ");
  await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS itinerary_change_request TEXT");
  await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS itinerary_author_id INTEGER");
  await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS itinerary_email_status VARCHAR(20) DEFAULT 'not_sent'");
  await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS itinerary_email_error TEXT");
  await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS itinerary_email_attempted_at TIMESTAMPTZ");
  await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS itinerary_email_sent_at TIMESTAMPTZ");
};

async function canAccessConversation(req, conversationId) {
  const result = await query(
    `SELECT id, user_id, group_id FROM conversations
      WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [conversationId],
  );
  const conv = result.rows[0];
  if (!conv) return { allowed: false, conv: null };

  if (isAdminUser(req)) return { allowed: true, conv };

  if (conv.user_id && String(conv.user_id) === String(req.user.id)) {
    return { allowed: true, conv };
  }

  if (conv.group_id) {
    const member = await query(
      `SELECT 1 FROM message_group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
      [conv.group_id, req.user.id],
    );
    if (member.rows[0]) return { allowed: true, conv };
  }

  return { allowed: false, conv };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROUTES
═══════════════════════════════════════════════════════════════════════════ */

/* ── Per-account chat appearance preferences ────────────────────────────── */
router.get("/preferences", protect, async (req, res) => {
  try {
    const result = await query(
      "SELECT settings FROM message_preferences WHERE user_id = $1 LIMIT 1",
      [req.user.id],
    );
    return res.json({ success: true, data: result.rows[0]?.settings || {} });
  } catch (err) {
    logger.error(`[Messages] GET /preferences: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to load chat preferences" });
  }
});

router.patch("/preferences", protect, async (req, res) => {
  try {
    const input = req.body?.settings;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return res.status(400).json({ success: false, message: "settings must be an object" });
    }
    const allowed = {
      theme: new Set(["emerald", "ocean", "midnight", "rose"]),
      font: new Set(["system", "rounded", "serif", "mono"]),
      density: new Set(["compact", "comfortable", "spacious"]),
    };
    const clean = {};
    for (const [key, values] of Object.entries(allowed)) {
      if (input[key] != null) {
        if (!values.has(String(input[key]))) {
          return res.status(400).json({ success: false, message: `Unsupported chat ${key}` });
        }
        clean[key] = String(input[key]);
      }
    }
    if (!Object.keys(clean).length) {
      return res.status(400).json({ success: false, message: "No valid preference values supplied" });
    }
    const result = await query(
      `INSERT INTO message_preferences (user_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET settings = message_preferences.settings || EXCLUDED.settings,
             updated_at = NOW()
       RETURNING settings`,
      [req.user.id, JSON.stringify(clean)],
    );
    return res.json({ success: true, data: result.rows[0]?.settings || clean });
  } catch (err) {
    logger.error(`[Messages] PATCH /preferences: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to save chat preferences" });
  }
});

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

/* ═══════════════════════════════════════════════════════════════════════════
   GROUP CHAT ADMINISTRATION
═══════════════════════════════════════════════════════════════════════════ */

router.get("/groups", adminProtect, async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT g.*,
              COUNT(DISTINCT gm.user_id)::INT AS member_count,
              c.id AS conversation_id,
              c.last_message,
              c.last_message_at
         FROM message_groups g
         LEFT JOIN message_group_members gm ON gm.group_id = g.id
         LEFT JOIN conversations c ON c.group_id = g.id AND c.deleted_at IS NULL
        WHERE g.is_active = true
        GROUP BY g.id, c.id
        ORDER BY COALESCE(c.last_message_at, g.created_at) DESC`,
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    logger.error(`[Messages] GET /groups: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to fetch message groups" });
  }
});

router.post("/groups", adminProtect, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim() || null;
    const userIds = [...new Set((Array.isArray(req.body.userIds) ? req.body.userIds : [])
      .map(v => parseInt(v, 10)).filter(Number.isInteger))];
    const firstMessage = String(req.body.firstMessage || "").trim();

    if (!name) return res.status(400).json({ success: false, message: "Group name is required" });
    if (!userIds.length) return res.status(400).json({ success: false, message: "Select at least one traveler" });

    const validUsers = await query(
      `SELECT id FROM users WHERE id = ANY($1::int[]) AND is_active = true`,
      [userIds],
    );
    const validIds = validUsers.rows.map(r => r.id);
    if (!validIds.length) return res.status(400).json({ success: false, message: "No active travelers selected" });

    const groupRes = await query(
      `INSERT INTO message_groups (name, description, created_by, is_active)
       VALUES ($1,$2,$3,true) RETURNING *`,
      [name, description, req.user.id],
    );
    const group = groupRes.rows[0];

    await query(
      `INSERT INTO message_group_members (group_id, user_id)
       SELECT $1, UNNEST($2::int[])
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [group.id, validIds],
    );

    const convRes = await query(
      `INSERT INTO conversations
        (session_id, user_id, guest_name, subject, channel, source, priority,
         group_id, conversation_type, status, unread_user, unread_admin, metadata, created_at, updated_at)
       VALUES (NULL,NULL,$1,$1,'group_chat','admin','normal',$2,'group','open',0,0,$3,NOW(),NOW())
       RETURNING *`,
      [name, group.id, JSON.stringify({ groupId: group.id, groupName: name })],
    );
    const conv = convRes.rows[0];
    await query(`UPDATE conversations SET created_by_admin_id = $1 WHERE id = $2 AND created_by_admin_id IS NULL`, [req.user.id, conv.id]);
    conv.created_by_admin_id = req.user.id;

    let message = null;
    if (firstMessage) {
      message = await insertMessage({
        conversationId: conv.id,
        senderType: "admin",
        senderId: req.user.id,
        senderName: req.user.full_name || req.user.username || "Admin",
        senderEmail: req.user.email,
        senderAvatar: req.user.avatar_url || null,
        body: firstMessage,
        metadata: { source: "admin-group" },
      });
      const shaped = reshapeMessage(message);
      const io = req.app.get("io");
      if (io) {
        io.to(`conv:${conv.id}`).emit("msg:message", shaped);
        io.to(`conversation-${conv.id}`).emit("msg:message", shaped);
        io.to(`group-${group.id}`).emit("msg:group-message", {
          conversationId: conv.id, groupId: group.id, groupName: name, message: shaped,
        });
        for (const uid of validIds) {
          io.to(`user-${uid}`).emit("msg:group-message", {
            conversationId: conv.id, groupId: group.id, groupName: name, message: shaped,
          });
        }
      }
    }

    return res.status(201).json({
      success: true,
      data: { ...group, conversationId: conv.id, memberCount: validIds.length, message: message ? reshapeMessage(message) : null },
    });
  } catch (err) {
    logger.error(`[Messages] POST /groups: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to create message group" });
  }
});

router.put("/groups/:id/members", adminProtect, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const userIds = [...new Set((Array.isArray(req.body.userIds) ? req.body.userIds : [])
      .map(v => parseInt(v, 10)).filter(Number.isInteger))];
    if (!groupId) return res.status(400).json({ success: false, message: "Invalid group id" });

    await query(`DELETE FROM message_group_members WHERE group_id = $1`, [groupId]);
    if (userIds.length) {
      await query(
        `INSERT INTO message_group_members (group_id, user_id)
         SELECT $1, UNNEST($2::int[])
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [groupId, userIds],
      );
    }
    const io = req.app.get("io");
    if (io) {
      for (const uid of userIds) io.to(`user-${uid}`).emit("msg:groups-updated", { groupId });
    }
    return res.json({ success: true, memberCount: userIds.length });
  } catch (err) {
    logger.error(`[Messages] PUT /groups/:id/members: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to update group members" });
  }
});

router.patch("/groups/:id", adminProtect, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const name = req.body.name !== undefined ? String(req.body.name).trim() : null;
    const description = req.body.description !== undefined ? String(req.body.description).trim() : null;
    const active = req.body.isActive !== undefined ? Boolean(req.body.isActive) : null;
    const { rows } = await query(
      `UPDATE message_groups
          SET name = COALESCE($1,name),
              description = COALESCE($2,description),
              is_active = COALESCE($3,is_active),
              updated_at = NOW()
        WHERE id=$4 RETURNING *`,
      [name || null, description, active, groupId],
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: "Group not found" });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error(`[Messages] PATCH /groups/:id: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to update message group" });
  }
});

router.post("/groups/:id/messages", adminProtect, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const body = String(req.body.body || "").trim();
    if (!groupId || !body) return res.status(400).json({ success: false, message: "Group and message are required" });

    const groupRes = await query(
      `SELECT g.*, c.id AS conversation_id
         FROM message_groups g
         LEFT JOIN conversations c ON c.group_id = g.id AND c.deleted_at IS NULL
        WHERE g.id = $1 AND g.is_active = true
        LIMIT 1`,
      [groupId],
    );
    const group = groupRes.rows[0];
    if (!group?.conversation_id) return res.status(404).json({ success: false, message: "Group not found" });

    const msg = await insertMessage({
      conversationId: group.conversation_id,
      senderType: "admin",
      senderId: req.user.id,
      senderName: req.user.full_name || req.user.username || "Admin",
      senderEmail: req.user.email,
      senderAvatar: req.user.avatar_url || null,
      body,
      replyToId: req.body.replyToId ? parseInt(req.body.replyToId, 10) : null,
      metadata: { source: "admin-group" },
    });
    const shaped = reshapeMessage(msg);
    const io = req.app.get("io");
    if (io) {
      io.to(`conv:${group.conversation_id}`).emit("msg:message", shaped);
      io.to(`conversation-${group.conversation_id}`).emit("msg:message", shaped);
      const payload = { conversationId: group.conversation_id, groupId, groupName: group.name, message: shaped };
      io.to(`group-${groupId}`).emit("msg:group-message", payload);
      const { rows: members } = await query(`SELECT user_id FROM message_group_members WHERE group_id = $1`, [groupId]);
      for (const member of members) io.to(`user-${member.user_id}`).emit("msg:group-message", payload);
    }
    return res.json({ success: true, data: shaped });
  } catch (err) {
    logger.error(`[Messages] POST /groups/:id/messages: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to send group message" });
  }
});

/* ── GET /conversations — list conversations (admin: all, user: own) ─────── */
router.get("/conversations", protect, async (req, res) => {
  try {
    const {
      status: requestedStatus,
      active,
      limit  = 100,
      page   = 1,
      search,
      bookingId,
    } = req.query;
    // The admin inbox requests active=all so it can open existing threads
    // regardless of status (including pending, closed, resolved, and archived).
    // Preserve explicit status filters; otherwise honor that all-status request.
    const status = requestedStatus || (String(active || "").toLowerCase() === "all" ? "all" : "open");

    const adminView = isAdminUser(req);
    if (!adminView) await ensureTravelerChannels(req.user.id);
    const userFilter = adminView ? {} : { user_id: req.user.id };

    const { rows, total } = await listConversations({
      status,
      limit:  parseInt(limit,  10),
      page:   parseInt(page,   10),
      search,
      userFilter,
      bookingId: bookingId || null,
      adminView,
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
          io.to(`conv:${conv.id}`).emit("msg:message", reshapeMessage(msg));
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
router.post("/conversations", protect, async (req, res) => {
  try {
    const {
      sessionId, guestName, guestEmail, bookingId, bookingNumber, subject,
      channel, source, priority, firstMessage, body, targetUserId,
      destinationName, metadata,
    } = req.body || {};

    if (!req.user) {
      return res.status(401).json({ success: false, message: "Sign in to start a private support conversation." });
    }

    const callerIsAdmin = isAdminUser(req);
    if (!callerIsAdmin && targetUserId != null) {
      return res.status(403).json({ success: false, message: "You can only start a conversation for your own account." });
    }

    const ipAddress = req.ip;
    const userAgent = req.get("user-agent") || null;
    const userId = callerIsAdmin && targetUserId
      ? (parseInt(targetUserId, 10) || null)
      : req.user.id;

    // Every direct conversation belongs to a real, active account. Admins
    // must select a registered traveller; legacy guest sessions cannot start
    // new conversations in this portal.
    if (!userId) {
      return res.status(400).json({ success: false, message: "Select an active registered user to start a conversation." });
    }
    const accountProfile = await getActiveRegisteredUser(userId);
    if (!accountProfile) {
      return res.status(404).json({ success: false, message: "This account is no longer available." });
    }

    const destination = String(destinationName || metadata?.destinationName || metadata?.destination_name || "").trim();
    if (destination) {
      const destinationCheck = await query(
        `SELECT id, name FROM destinations WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
        [destination],
      );
      if (!destinationCheck.rows[0]) {
        return res.status(400).json({ success: false, message: "Choose a valid destination from the suggestions, or clear the destination field." });
      }
    }
    const conversationMetadata = {
      ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}),
      ...(destination ? { destinationName: destination } : {}),
    };
    const conversationSubject = String(subject || "").trim() || (destination ? `Question about ${destination}` : null);

    // An explicit subject means the user/admin intentionally requested a new thread.
    // Keep separate threads possible; getOrCreate remains the fallback for legacy guest sessions.
    let conv;
    if (userId && conversationSubject) {
      const created = await query(
        `INSERT INTO conversations
          (session_id, user_id, guest_name, guest_email, channel, subject, status, priority,
           source, booking_id, booking_number, metadata, unread_admin, unread_user, created_at, updated_at)
         VALUES (NULL, $1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10::jsonb, 0, 0, NOW(), NOW())
         RETURNING *`,
        [
          userId,
          accountProfile.full_name || null,
          accountProfile.email || null,
          channel || "live_chat",
          conversationSubject,
          priority || "normal",
          source || (callerIsAdmin ? "admin" : "messages-portal"),
          bookingId || null,
          bookingNumber || null,
          JSON.stringify(conversationMetadata),
        ],
      );
      conv = created.rows[0];
      if (callerIsAdmin) {
        await query(`UPDATE conversations SET created_by_admin_id = $1 WHERE id = $2 AND created_by_admin_id IS NULL`, [req.user.id, conv.id]);
        conv.created_by_admin_id = req.user.id;
      }
    } else {
      conv = await getOrCreateConversation({
        userId: userId || null,
        sessionId: userId ? null : (sessionId || null),
        guestName: accountProfile.full_name || null,
        guestEmail: accountProfile.email || null,
        bookingId: bookingId || null,
        bookingNumber: bookingNumber || null,
        subject: conversationSubject,
        channel: channel || "live_chat",
        source: source || (callerIsAdmin ? "admin" : "messages-portal"),
        priority: priority || "normal",
        ipAddress,
        userAgent,
        metadata: conversationMetadata,
      });
    }

    const initialMessage = String(firstMessage || body || "").trim();
    let savedMessage = null;
    if (initialMessage) {
      savedMessage = await insertMessage({
        conversationId: conv.id,
        senderType: callerIsAdmin ? "admin" : "user",
        senderId: req.user.id,
        senderName: callerIsAdmin
          ? (req.user.full_name || req.user.name || "Altuvera Support")
          : (accountProfile.full_name || "Registered traveler"),
        senderEmail: callerIsAdmin ? (req.user.email || null) : accountProfile.email,
        senderAvatar: callerIsAdmin ? (req.user.avatar_url || null) : accountProfile.avatar_url,
        body: initialMessage,
        metadata: { source: "messages-portal", ...conversationMetadata },
      });
    }

    // The admin inbox needs both a durable notification and a live conversation event.
    if (!callerIsAdmin && savedMessage) {
      const io = req.app.get("io");
      const shapedMessage = reshapeMessage(savedMessage);
      const senderName = savedMessage.sender_name || req.user.full_name || req.user.name || "Traveler";
      const senderEmail = req.user.email || "";
      if (io) {
        io.to("admins").to("admin-room").emit("msg:new-from-user", {
          senderType: "user",
          conversationId: conv.id,
          sessionId: conv.session_id || null,
          message: shapedMessage,
          senderName,
          senderEmail,
          senderAvatar: savedMessage.sender_avatar || req.user.avatar_url || null,
          guestName: senderName,
          guestAvatar: savedMessage.sender_avatar || req.user.avatar_url || null,
          unreadCount: 1,
        });
        io.to("admins").to("admin-room").emit("msg:conversation-updated", reshapeConversation({
          ...conv,
          guest_name: conv.guest_name || senderName,
          guest_email: conv.guest_email || senderEmail,
          user: { fullName: senderName, email: senderEmail, avatarUrl: savedMessage.sender_avatar || req.user.avatar_url || null },
        }));
      }
      try {
        const { createNotificationInternal } = require("../controllers/notificationsController");
        await createNotificationInternal({
          userId: null,
          senderType: "user",
          senderId: req.user.id,
          senderName,
          type: "message_received",
          category: "message",
          title: `New message from ${senderName}`,
          message: initialMessage.slice(0, 500),
          actionUrl: `/messages?conversationId=${encodeURIComponent(conv.id)}`,
          actionLabel: "Open conversation",
          priority: "high",
          targetScope: "role",
          targetRole: "admin",
          metadata: { conversationId: conv.id, messageId: savedMessage.id, senderName, senderEmail, destinationName: destination || null },
        });
      } catch (notifyError) {
        logger.warn("[Messages] Admin message notification failed:", notifyError.message);
      }
    }

    return res.status(201).json({
      success: true,
      data: { ...reshapeConversation(conv), ...(savedMessage ? { messages: [reshapeMessage(savedMessage)] } : {}) },
    });
  } catch (err) {
    logger.error(`[Messages] POST /conversations: ${err.message}`, { stack: err.stack });
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to create conversation",
      error: process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

/* ── DELETE /conversations/:id — admin-only soft delete ─────────────────── */
/* Recycle Bin: deleted threads remain private to admins until restored or purged. */
router.get("/conversations/recycle-bin", adminProtect, async (req, res) => {
  try {
    await query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ");
    const { rows } = await query(
      `SELECT c.*, g.name AS group_name, g.created_by AS group_created_by, u.full_name AS user_full_name,
              u.email AS user_email, u.avatar_url AS user_avatar,
              (SELECT COUNT(*)::INT FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
         LEFT JOIN message_groups g ON g.id = c.group_id
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.deleted_at IS NOT NULL
        ORDER BY c.deleted_at DESC, c.updated_at DESC`
    );
    return res.json({ success: true, data: rows.map(r => reshapeConversation({
      ...r, guest_name: r.group_name || r.guest_name || r.user_full_name,
      guest_email: r.guest_email || r.user_email, guest_avatar: r.guest_avatar || r.user_avatar,
    })) });
  } catch (err) {
    logger.error(`[Messages] GET recycle-bin: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to load Recycle Bin" });
  }
});

router.post("/conversations/:id/restore", adminProtect, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, user_id, group_id, conversation_type, subject, guest_name, metadata
         FROM conversations WHERE id = $1 AND deleted_at IS NOT NULL`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: "Deleted conversation not found" });
    const target = rows[0];
    let activeConversation = null;
    if (target.user_id && !target.group_id && ['personal', 'resource_support', 'direct'].includes(String(target.conversation_type || '').toLowerCase())) {
      const { rows: active } = await query(
        `SELECT id FROM conversations
          WHERE user_id = $1 AND id <> $2 AND group_id IS NULL AND deleted_at IS NULL
            AND conversation_type IN ('personal', 'resource_support', 'direct')
          ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
        [target.user_id, target.id]
      );
      activeConversation = active[0] || null;
    }
    if (activeConversation && !req.body?.confirmSendToUser) {
      return res.status(409).json({
        success: false, conflict: true, requiresAdminConfirmation: true,
        activeConversationId: activeConversation.id,
        message: "This traveler already has a personal conversation. Confirm sending the restored thread to the traveler so they can choose which personal conversation to keep."
      });
    }

    const restored = activeConversation
      ? await query(
          `UPDATE conversations
              SET deleted_at = NULL,
                  status = 'pending',
                  metadata = COALESCE(metadata, '{}'::jsonb) ||
                    jsonb_build_object('restoreChoicePending', true, 'restoreChoiceExistingConversationId', $2::int),
                  updated_at = NOW()
            WHERE id = $1 AND deleted_at IS NOT NULL
            RETURNING *`,
          [target.id, activeConversation.id]
        )
      : await query(
          `UPDATE conversations SET deleted_at = NULL, updated_at = NOW()
            WHERE id = $1 AND deleted_at IS NOT NULL RETURNING *`,
          [target.id]
        );
    if (!restored.rows[0]) return res.status(409).json({ success: false, message: "Conversation could not be restored." });
    const row = restored.rows[0];
    const io = req.app.get("io");
    if (io && activeConversation && target.user_id) {
      io.to(`user-${target.user_id}`).emit("msg:conversation-restore-choice", {
        restoredConversationId: row.id,
        existingConversationId: activeConversation.id,
        title: target.subject || "Restored personal conversation",
      });
    } else if (io && target.group_id) {
      const { rows: members } = await query("SELECT user_id FROM message_group_members WHERE group_id = $1", [target.group_id]);
      for (const member of members) io.to(`user-${member.user_id}`).emit("msg:conversation-restored", { conversationId: row.id, groupId: target.group_id });
    } else if (io && target.user_id) {
      io.to(`user-${target.user_id}`).emit("msg:conversation-restored", { conversationId: row.id });
    }
    return res.json({
      success: true, data: reshapeConversation(row),
      requiresUserChoice: Boolean(activeConversation),
      message: activeConversation
        ? "The traveler has been asked to choose whether to keep the restored conversation or reject it."
        : "Conversation restored."
    });
  } catch (err) {
    logger.error(`[Messages] POST restore: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to restore conversation" });
  }
});

router.post("/conversations/:id/restore-choice", protect, async (req, res) => {
  try {
    const choice = String(req.body?.choice || "");
    if (!["keep_restored", "reject_restored"].includes(choice)) {
      return res.status(400).json({ success: false, message: "Choose whether to keep the restored conversation or reject it." });
    }
    const { rows } = await query(
      `SELECT id, user_id, group_id, metadata FROM conversations
        WHERE id = $1 AND user_id = $2 AND group_id IS NULL AND deleted_at IS NULL`,
      [req.params.id, req.user.id]
    );
    const target = rows[0];
    const metadata = target?.metadata && typeof target.metadata === "object" ? target.metadata : {};
    if (!target || !metadata.restoreChoicePending) {
      return res.status(404).json({ success: false, message: "There is no pending restored-conversation choice for this account." });
    }
    const existingId = Number(metadata.restoreChoiceExistingConversationId);
    let removedConversationId = null;
    if (choice === "keep_restored" && Number.isInteger(existingId) && existingId > 0) {
      const { rows: retired } = await query(
        `UPDATE conversations
            SET deleted_at = NOW(), recycle_deadline = NULL,
                recycle_requested_by = NULL, updated_at = NOW()
          WHERE id = $1 AND user_id = $2 AND id <> $4 AND group_id IS NULL AND deleted_at IS NULL
            AND conversation_type IN ('personal', 'resource_support', 'direct')
          RETURNING id, group_id`,
        [existingId, req.user.id, req.user.id, target.id]
      );
      removedConversationId = retired[0]?.id || null;
    }
    const rejectRestored = choice === "reject_restored";
    const { rows: resolved } = await query(
      `UPDATE conversations
          SET deleted_at = CASE WHEN $3::boolean THEN NOW() ELSE NULL END,
              status = CASE WHEN $3::boolean THEN status ELSE 'open' END,
              metadata = COALESCE(metadata, '{}'::jsonb) - 'restoreChoicePending' - 'restoreChoiceExistingConversationId',
              updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        RETURNING id, group_id`,
      [target.id, req.user.id, rejectRestored]
    );
    if (!resolved[0]) return res.status(409).json({ success: false, message: "The restored conversation changed. Refresh your inbox and try again." });

    const io = req.app.get("io");
    const resultPayload = {
      conversationId: target.id,
      userId: req.user.id,
      choice,
      removedConversationId,
    };
    if (io) {
      io.to("admins").to("admin-room").emit("msg:restore-choice-resolved", resultPayload);
      if (rejectRestored) {
        io.to("admins").to("admin-room").emit("msg:conversation-recycled", {
          conversationId: target.id, conversationType: "personal",
          title: "Restored conversation rejected by traveler",
        });
      }
      if (removedConversationId) {
        const recycledPayload = {
          conversationId: removedConversationId, conversationType: "personal",
          title: "Previous personal conversation replaced at traveler request",
        };
        io.to(`user-${req.user.id}`).emit("msg:conversation-recycled", recycledPayload);
        io.to("admins").to("admin-room").emit("msg:conversation-recycled", recycledPayload);
      }
    }
    return res.json({
      success: true, choice, removedConversationId,
      message: rejectRestored
        ? "The restored conversation was rejected. Your current personal conversation remains unchanged."
        : "The restored conversation is now your active personal chat.",
    });
  } catch (err) {
    logger.error(`[Messages] POST restore choice: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Could not save your conversation choice." });
  }
});

router.delete("/conversations/recycle-bin", adminProtect, async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const { rows: doomed } = await client.query(
      `SELECT id, group_id FROM conversations WHERE deleted_at IS NOT NULL FOR UPDATE`,
    );
    const ids = doomed.map((row) => Number(row.id)).filter(Number.isInteger);
    const groupIds = [...new Set(doomed.map((row) => row.group_id == null ? null : Number(row.group_id)).filter(Number.isInteger))];

    if (ids.length) {
      await client.query(`DELETE FROM messages WHERE conversation_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM conversations WHERE id = ANY($1::int[])`, [ids]);
    }
    if (groupIds.length) {
      await client.query(
        `DELETE FROM message_group_members m
          WHERE m.group_id = ANY($1::int[])
            AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.group_id = m.group_id)`,
        [groupIds],
      );
      await client.query(
        `DELETE FROM message_groups g
          WHERE g.id = ANY($1::int[])
            AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.group_id = g.id)`,
        [groupIds],
      );
    }
    await client.query("COMMIT");
    return res.json({
      success: true,
      deletedCount: ids.length,
      message: ids.length ? "Recycle Bin and its message history have been permanently emptied." : "Recycle Bin is already empty.",
    });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    logger.error(`[Messages] DELETE recycle-bin: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to empty Recycle Bin" });
  } finally {
    client?.release();
  }
});

router.delete("/conversations/:id/permanent", adminProtect, async (req, res) => {
  let client;
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: "Invalid conversation ID." });
    client = await pool.connect();
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, group_id FROM conversations WHERE id = $1 AND deleted_at IS NOT NULL FOR UPDATE`,
      [id],
    );
    if (!rows[0]) {
      await client.query("COMMIT");
      return res.status(404).json({ success: false, message: "Deleted conversation not found in Recycle Bin" });
    }
    const groupId = rows[0].group_id == null ? null : Number(rows[0].group_id);
    await client.query(`DELETE FROM messages WHERE conversation_id = $1`, [id]);
    await client.query(`DELETE FROM conversations WHERE id = $1 AND deleted_at IS NOT NULL`, [id]);
    if (Number.isInteger(groupId)) {
      await client.query(
        `DELETE FROM message_group_members
          WHERE group_id = $1 AND NOT EXISTS (SELECT 1 FROM conversations WHERE group_id = $1)`,
        [groupId],
      );
      await client.query(
        `DELETE FROM message_groups
          WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM conversations WHERE group_id = $1)`,
        [groupId],
      );
    }
    await client.query("COMMIT");
    return res.json({ success: true, message: "Conversation and its message history were permanently deleted." });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    logger.error(`[Messages] DELETE permanent: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to permanently delete conversation" });
  } finally {
    client?.release();
  }
});

router.post("/conversations/:id/recycle-cancel", protect, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: "Invalid conversation ID." });
    const { rows: cancelled } = await query(
      `UPDATE conversations SET recycle_deadline = NULL, recycle_requested_by = NULL, updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND group_id IS NULL AND deleted_at IS NULL
          AND recycle_deadline IS NOT NULL AND recycle_deadline > NOW()
          AND conversation_type IN ('personal','resource_support','direct')
        RETURNING id, subject`,
      [id, req.user.id],
    );
    if (!cancelled[0]) return res.status(410).json({ success: false, expired: true,
      message: "The 20-second request window has ended, or this conversation is no longer eligible." });
    const conv = cancelled[0];
    const payload = {
      conversationId: conv.id, userId: req.user.id,
      userName: req.user.full_name || req.user.username || req.user.name || "Traveler",
      conversationTitle: conv.subject || "Personal chat with Altuvera",
      message: "A traveler asked to keep this personal conversation. The recycle request has been cancelled.",
      requestedAt: new Date().toISOString(),
    };
    const io = req.app.get("io");
    if (io) {
      io.to("admins").to("admin-room").emit("msg:delete-cancel-request", payload);
      io.to(`user-${req.user.id}`).emit("msg:recycle-cancelled", { conversationId: conv.id });
      io.to("admins").to("admin-room").emit("msg:recycle-cancelled", { conversationId: conv.id });
    }
    return res.json({ success: true, cancelled: true,
      message: "Your request was sent. This personal conversation will stay available." });
  } catch (err) {
    logger.error(`[Messages] POST recycle-cancel: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Could not send your request. Please try again." });
  }
});

router.delete("/conversations/:id", adminProtect, async (req, res) => {
  try {
    await query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS created_by_admin_id INTEGER");
    await query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS recycle_requested_by INTEGER");
    await query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS recycle_deadline TIMESTAMPTZ");
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: "Invalid conversation ID." });
    const { rows } = await query(
      `SELECT c.id, c.user_id, c.group_id, c.conversation_type, c.subject, c.guest_name,
              c.created_by_admin_id, c.recycle_deadline, g.created_by AS group_created_by
         FROM conversations c LEFT JOIN message_groups g ON g.id = c.group_id
        WHERE c.id = $1 AND c.deleted_at IS NULL LIMIT 1`,
      [id],
    );
    const conv = rows[0];
    if (!conv) return res.status(404).json({ success: false, message: "Conversation not found or already in Recycle Bin." });
    const creatorId = conv.group_id ? conv.group_created_by : conv.created_by_admin_id;
    if (creatorId == null || String(creatorId) !== String(req.user.id)) {
      return res.status(403).json({ success: false,
        message: "Only the admin who created this conversation can move it to the Recycle Bin." });
    }
    if (conv.recycle_deadline && new Date(conv.recycle_deadline).getTime() > Date.now()) {
      return res.status(409).json({ success: false, pending: true, deadlineAt: conv.recycle_deadline,
        message: "This conversation already has an active 20-second recycle warning." });
    }
    const { rows: scheduled } = await query(
      `UPDATE conversations SET recycle_requested_by = $2,
          recycle_deadline = NOW() + INTERVAL '20 seconds', updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
          AND (recycle_deadline IS NULL OR recycle_deadline <= NOW())
        RETURNING id, user_id, group_id, subject, guest_name, conversation_type, recycle_deadline`,
      [id, req.user.id],
    );
    if (!scheduled[0]) return res.status(409).json({ success: false, message: "This conversation changed. Refresh and try again." });
    const due = scheduled[0];
    const isGroup = Boolean(due.group_id);
    const canRequestKeep = !isGroup && Boolean(due.user_id) &&
      ["personal", "resource_support", "direct"].includes(String(due.conversation_type || "").toLowerCase());
    const payload = {
      conversationId: due.id, groupId: due.group_id || null,
      conversationType: isGroup ? "group" : (due.conversation_type || "personal"),
      title: due.subject || due.guest_name || (isGroup ? "Group conversation" : "Personal conversation"),
      requestedByName: req.user.full_name || req.user.username || "Altuvera admin",
      deadlineAt: new Date(due.recycle_deadline).toISOString(), durationSeconds: 20, canRequestKeep,
    };
    const io = req.app.get("io");
    if (io) {
      if (due.user_id) io.to(`user-${due.user_id}`).emit("msg:conversation-recycle-warning", payload);
      if (due.group_id) {
        const { rows: members } = await query(`SELECT user_id FROM message_group_members WHERE group_id = $1`, [due.group_id]);
        for (const member of members) io.to(`user-${member.user_id}`).emit("msg:conversation-recycle-warning", payload);
        io.to(`group-${due.group_id}`).emit("msg:conversation-recycle-warning", payload);
      }
      io.to("admins").to("admin-room").emit("msg:recycle-request-started", payload);
    }
    return res.status(202).json({ success: true, pending: true, deadlineAt: payload.deadlineAt,
      durationSeconds: 20,
      message: "A live 20-second notice has been sent to the conversation members. The conversation will move to Recycle Bin unless a personal-chat keep request arrives in time." });
  } catch (err) {
    logger.error(`[Messages] DELETE /conversations/:id: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Could not start the recycle request." });
  }
});

/* ── GET /conversations/:id ─────────────────────────────────────────────── */
router.get("/conversations/:id", protect, async (req, res) => {
  try {
    const requestedLimit = req.query.limit == null ? null : Number.parseInt(req.query.limit, 10);
    const pageOptions = {
      ...(Number.isInteger(requestedLimit) && requestedLimit > 0
        ? {
            limit: Math.min(requestedLimit, 50),
            beforeCreatedAt: req.query.beforeCreatedAt || null,
            beforeId: req.query.beforeId || null,
          }
        : {}),
      // Recycled messages are reviewable only through an explicit admin request.
      // End-user requests always continue filtering deleted conversations.
      includeDeleted: isAdminUser(req) && req.query.includeDeleted === "true",
    };
    const data = await getConversationWithMessages(req.params.id, pageOptions);
    if (!data) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    // Legacy guest/contact-form threads are not part of the authenticated
    // messaging portal. Admins can open registered-user threads and groups.
    if (isAdminUser(req) && (
      (!data.user_id && !data.group_id) ||
      (data.user_deleted_at && !data.group_id)
    )) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    /* Users may only see their own conversation */
    if (!isAdminUser(req)) {
      const ownsConversation = data.user_id != null && String(data.user_id) === String(req.user.id);
      let memberOfGroup = false;
      if (data.group_id) {
        const member = await query(
          `SELECT 1 FROM message_group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
          [data.group_id, req.user.id],
        );
        memberOfGroup = Boolean(member.rows[0]);
      }
      if (!ownsConversation && !memberOfGroup) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const shaped = reshapeConversation(data, true);
    if (typeof data.hasMoreMessages === "boolean") shaped.hasMoreMessages = data.hasMoreMessages;
    return res.json({ success: true, data: shaped });
  } catch (err) {
    logger.error(`[Messages] GET /conversations/:id: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ success: false, message: "Failed to fetch conversation" });
  }
});

/* ── GET /conversations/by-booking/:bookingId — lookup by booking ─────────── */
/* ── GET /conversations/by-booking/:bookingId — verified booking support channel ── */
router.get("/conversations/by-booking/:bookingId", protect, async (req, res) => {
  try {
    if (!isAdminUser(req)) await ensureTravelerChannels(req.user.id);
    const bookingRef = String(req.params.bookingId || "").trim();
    if (!bookingRef) return res.status(400).json({ success: false, message: "Booking reference is required." });
    const { rows: bookingRows } = await query(
      `SELECT id, user_id, email, email_verified, booking_number, status,
              COALESCE(destination_name, '') AS destination_name
         FROM bookings
        WHERE id::text=$1 OR UPPER(booking_number)=UPPER($1)
        ORDER BY created_at DESC LIMIT 1`,
      [bookingRef],
    );
    const booking = bookingRows[0];
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });
    if (!isAdminUser(req)) {
      const userEmail = String(req.user?.email || "").toLowerCase();
      const emailMatch = Boolean(booking.email_verified && userEmail && String(booking.email || "").toLowerCase() === userEmail);
      const ownsById = booking.user_id != null && String(booking.user_id) === String(req.user.id);
      if (!ownsById && !emailMatch) return res.status(403).json({ success: false, message: "That booking does not belong to your account." });
    }
    const targetUserId = isAdminUser(req) ? booking.user_id : req.user.id;
    if (!targetUserId) return res.status(403).json({ success: false, message: "This booking is not linked to a registered account." });
    const { rows: convRows } = await query(
      `SELECT c.*, u.full_name AS user_full_name, u.email AS user_email,
              u.avatar_url AS user_avatar
         FROM conversations c LEFT JOIN users u ON u.id=c.user_id
        WHERE c.user_id=$1 AND c.conversation_type='resource_support'
          AND c.deleted_at IS NULL
        ORDER BY c.created_at ASC LIMIT 1`,
      [targetUserId],
    );
    const conv = convRows[0];
    if (!conv) return res.status(404).json({ success: false, message: "Booking support conversation is not available yet." });
    conv.user = conv.user_id ? { fullName: conv.user_full_name, email: conv.user_email, avatarUrl: conv.user_avatar } : null;
    const withMessages = await getConversationWithMessages(conv.id);
    const result = reshapeConversation(withMessages || conv, true);
    result.verifiedBooking = {
      id: booking.id, bookingNumber: booking.booking_number,
      destinationName: booking.destination_name, status: booking.status,
    };
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`[Messages] GET /conversations/by-booking: ${err.message}`, { stack: err.stack });
    return res.status(err.status || 500).json({ success: false, message: err.message || "Failed to load booking conversation" });
  }
});

/* ── Verified booking lookup for the dedicated support channel ───────────── */
router.get("/booking-context/:reference", protect, async (req, res) => {
  try {
    if (isAdminUser(req)) return res.status(400).json({ success: false, message: "Use a traveler account to verify booking ownership." });
    await ensureTravelerChannels(req.user.id);
    await ensureItineraryEmailColumns();
    const reference = String(req.params.reference || "").trim();
    if (!reference || reference.length > 120) return res.status(400).json({ success: false, message: "Enter a valid booking ID or booking reference." });
    const { rows } = await query(
      `SELECT b.id, b.user_id, b.email, b.email_verified, b.booking_number, b.status,
              b.travel_date, b.return_date, b.number_of_travelers, b.itinerary_status,
              b.itinerary_version, b.itinerary_email_status, b.itinerary_email_error,
              b.itinerary_email_sent_at, b.itinerary_published_at,
              COALESCE(d.name,b.destination_name,'') AS destination_name,
              COALESCE(c.name,to_jsonb(b)->>'country_name',to_jsonb(b)->>'country','') AS country_name
         FROM bookings b
         LEFT JOIN destinations d ON d.id=b.destination_id
         LEFT JOIN countries c ON c.id=d.country_id
        WHERE (b.id::text=$1 OR UPPER(b.booking_number)=UPPER($1))
          AND (
            b.user_id::text=$2::text OR
            (b.user_id IS NULL AND COALESCE(b.email_verified,FALSE)=TRUE AND LOWER(COALESCE(b.email,''))=LOWER($3))
          )
        ORDER BY b.created_at DESC LIMIT 1`,
      [reference, req.user.id, String(req.user?.email || "")],
    );
    const booking = rows[0];
    if (!booking) return res.status(404).json({ success: false, message: "No matching booking was found for your account. Check the reference and sign in to the account used to book." });
    return res.json({ success: true, data: {
      id: booking.id, bookingNumber: booking.booking_number, destinationName: booking.destination_name,
      countryName: booking.country_name, status: booking.status, travelDate: booking.travel_date,
      returnDate: booking.return_date, travelers: booking.number_of_travelers,
      emailVerified: Boolean(booking.email_verified), itineraryStatus: booking.itinerary_status || "not_started",
      itineraryVersion: Number(booking.itinerary_version || 0),
      itineraryEmailStatus: booking.itinerary_email_status || "not_sent",
      itineraryEmailSentAt: booking.itinerary_email_sent_at || null,
      itineraryPublishedAt: booking.itinerary_published_at || null,
      itineraryEmailError: booking.itinerary_email_status === "failed" ? booking.itinerary_email_error : null,
    }});
  } catch (err) {
    logger.error(`[Messages] booking-context lookup failed: ${err.message}`);
    return res.status(500).json({ success: false, message: "Could not verify this booking right now. Please try again." });
  }
});

/* ── Search live destinations, public packages, and the user's itineraries ─ */
router.get("/resources/search", protect, async (req, res) => {
  try {
    const type = String(req.query.type || "destination").toLowerCase();
    const q = String(req.query.q || "").trim();
    if (!["destination","country","package","story","itinerary"].includes(type)) return res.status(400).json({ success: false, message: "Choose a destination, country, package, story, or itinerary." });
    if (q.length < 2) return res.json({ success: true, data: [] });
    const pattern = "%" + q.slice(0, 80) + "%";
    let rows = [];
    if (type === "destination") {
      const result = await query(
        `SELECT d.id, d.name, d.slug, LEFT(COALESCE(d.description,''),240) AS description,
                COALESCE(d.image_url,d.cover_image_url) AS image_url,
                c.name AS country_name
           FROM destinations d LEFT JOIN countries c ON c.id=d.country_id
          WHERE LOWER(COALESCE(to_jsonb(d)->>'is_active','true')) NOT IN ('false','0') AND
                (d.name ILIKE $1 OR COALESCE(d.description,'') ILIKE $1 OR COALESCE(c.name,'') ILIKE $1)
          ORDER BY d.name LIMIT 12`, [pattern]);
      rows = result.rows.map(r=>({type, id:r.id, name:r.name, slug:r.slug, description:r.description, imageUrl:r.image_url, country:r.country_name}));
    } else if (type === "country") {
      const result = await query(
        `SELECT c.id, c.name, c.slug,
                LEFT(COALESCE(to_jsonb(c)->>'description',''),240) AS description,
                COALESCE(to_jsonb(c)->>'image_url',to_jsonb(c)->>'hero_image','') AS image_url
           FROM countries c
          WHERE (c.name ILIKE $1 OR COALESCE(c.description,'') ILIKE $1 OR COALESCE(c.slug,'') ILIKE $1)
          ORDER BY c.name LIMIT 12`, [pattern]);
      rows = result.rows.map(r=>({type, id:r.id, name:r.name, slug:r.slug, description:r.description, imageUrl:r.image_url}));
    } else if (type === "package") {
      const result = await query(
        `SELECT p.id,
                COALESCE(to_jsonb(p)->>'name',to_jsonb(p)->>'title','Safari package') AS name,
                COALESCE(to_jsonb(p)->>'slug','') AS slug,
                LEFT(COALESCE(to_jsonb(p)->>'description',to_jsonb(p)->>'overview',''),240) AS description,
                COALESCE(to_jsonb(p)->>'image_url',to_jsonb(p)->>'cover_image_url','') AS image_url
           FROM packages p
          WHERE LOWER(COALESCE(to_jsonb(p)->>'is_published',to_jsonb(p)->>'is_active','true')) NOT IN ('false','0')
            AND (COALESCE(to_jsonb(p)->>'name',to_jsonb(p)->>'title','') ILIKE $1
              OR COALESCE(to_jsonb(p)->>'description',to_jsonb(p)->>'overview','') ILIKE $1)
          ORDER BY name LIMIT 12`, [pattern]);
      rows = result.rows.map(r=>({type, id:r.id, name:r.name, slug:r.slug, description:r.description, imageUrl:r.image_url}));
    } else if (type === "story") {
      const result = await query(
        `SELECT p.id, p.title AS name, p.slug,
                LEFT(COALESCE(to_jsonb(p)->>'excerpt',to_jsonb(p)->>'content',''),240) AS description,
                COALESCE(to_jsonb(p)->>'cover_image_url',to_jsonb(p)->>'featured_image',to_jsonb(p)->>'image_url','') AS image_url
           FROM posts p
          WHERE LOWER(COALESCE(to_jsonb(p)->>'is_published',to_jsonb(p)->>'published','true')) NOT IN ('false','0')
            AND (p.title ILIKE $1 OR COALESCE(p.excerpt,'') ILIKE $1 OR COALESCE(p.slug,'') ILIKE $1)
          ORDER BY p.created_at DESC LIMIT 12`, [pattern]);
      rows = result.rows.map(r=>({type, id:r.id, name:r.name, slug:r.slug, description:r.description, imageUrl:r.image_url}));
    } else {
      const result = await query(
        `SELECT b.id, b.booking_number,
                COALESCE(b.itinerary->>'title',COALESCE(d.name,b.destination_name,'Personalized itinerary')) AS name,
                COALESCE(d.name,b.destination_name,'') AS destination_name,
                b.itinerary_status
           FROM bookings b LEFT JOIN destinations d ON d.id=b.destination_id
          WHERE b.user_id::text=$1::text
            AND b.itinerary_status IN ('sent','change_requested','approved')
            AND (COALESCE(b.itinerary->>'title','') ILIKE $2 OR COALESCE(d.name,b.destination_name,'') ILIKE $2 OR COALESCE(b.booking_number,'') ILIKE $2)
          ORDER BY b.itinerary_published_at DESC NULLS LAST LIMIT 12`, [req.user.id, pattern]);
      rows = result.rows.map(r=>({type, id:r.id, bookingId:r.id, bookingNumber:r.booking_number, name:r.name, destination:r.destination_name, status:r.itinerary_status}));
    }
    return res.json({ success: true, data: rows });
  } catch (err) {
    logger.error(`[Messages] resource search failed: ${err.message}`);
    return res.status(500).json({ success: false, message: "Search is temporarily unavailable. Please try again." });
  }
});

/* ── POST /conversations/:id/messages ───────────────────────────────────── */
router.post("/conversations/:id/messages", protect, async (req, res) => {
  try {
    const { id }              = req.params;
    const { body, replyToId, metadata: requestedMetadata } = req.body || {};

    if (!body || !String(body).trim()) {
      return res.status(400).json({ success: false, message: "Message body is required" });
    }

    await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ");
    const convCheck = await query(
      `SELECT c.id, c.user_id, c.group_id, c.session_id, c.guest_name, c.guest_email, c.subject, c.status,
              c.conversation_type, c.channel, c.booking_id, c.booking_number,
              u.deleted_at AS user_deleted_at
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [id],
    );
    if (!convCheck.rows[0]) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }
    if (isAdminUser(req) && (
      (!convCheck.rows[0].user_id && !convCheck.rows[0].group_id) ||
      (convCheck.rows[0].user_deleted_at && !convCheck.rows[0].group_id)
    )) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    /* Only active registered users may send messages, even with an old token. */
    const isAdminReq = isAdminUser(req);
    const senderProfile = isAdminReq ? req.user : await getActiveRegisteredUser(req.user?.id);
    if (!senderProfile) {
      return res.status(403).json({ success: false, message: "Your account is unavailable. Sign in with an active account to send messages." });
    }

    /* Users may message their own conversation or a group they belong to. */
    if (!isAdminReq) {
      const ownsConversation = convCheck.rows[0].user_id && String(convCheck.rows[0].user_id) === String(req.user.id);
      let memberOfGroup = false;
      if (convCheck.rows[0].group_id) {
        const member = await query(
          `SELECT 1 FROM message_group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
          [convCheck.rows[0].group_id, req.user.id],
        );
        memberOfGroup = Boolean(member.rows[0]);
      }
      if (!ownsConversation && !memberOfGroup) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    let messageMetadata = {};
    if (!isAdminReq && requestedMetadata && typeof requestedMetadata === "object" &&
        (requestedMetadata.bookingId != null || requestedMetadata.booking_id != null || requestedMetadata.resource) &&
        convCheck.rows[0].conversation_type !== "resource_support") {
      return res.status(403).json({ success: false, message: "Booking and resource context can only be attached in the bookings & travel support conversation." });
    }
    if (requestedMetadata && typeof requestedMetadata === "object" && !Array.isArray(requestedMetadata)) {
      const requestedBookingId = requestedMetadata.bookingId ?? requestedMetadata.booking_id;
      if (requestedBookingId != null && String(requestedBookingId).trim()) {
        const { rows: linkedBookings } = await query(
          `SELECT id, user_id, email, email_verified, booking_number, status,
                  travel_date, return_date, number_of_travelers, itinerary_status,
                  COALESCE(destination_name,'') AS destination_name
             FROM bookings WHERE id::text=$1::text LIMIT 1`,
          [String(requestedBookingId)],
        );
        const linkedBooking = linkedBookings[0];
        if (!linkedBooking) return res.status(404).json({ success: false, message: "Booking reference could not be verified." });
        if (!isAdminReq) {
          const owns = linkedBooking.user_id != null && String(linkedBooking.user_id) === String(req.user.id);
          const emailMatch = Boolean(linkedBooking.user_id == null && linkedBooking.email_verified && String(linkedBooking.email || "").toLowerCase() === String(req.user.email || "").toLowerCase());
          if (!owns && !emailMatch) return res.status(403).json({ success: false, message: "That booking does not belong to your account." });
        } else if (convCheck.rows[0].user_id && linkedBooking.user_id && String(linkedBooking.user_id) !== String(convCheck.rows[0].user_id)) {
          return res.status(403).json({ success: false, message: "That booking belongs to a different traveler." });
        }
        messageMetadata = {
          kind: "booking_question",
          bookingId: linkedBooking.id,
          bookingNumber: linkedBooking.booking_number || null,
          booking: {
            id: linkedBooking.id, booking_number: linkedBooking.booking_number || null,
            destination_name: linkedBooking.destination_name || null, status: linkedBooking.status,
            travel_date: linkedBooking.travel_date || null, return_date: linkedBooking.return_date || null,
            number_of_travelers: linkedBooking.number_of_travelers || null,
            itinerary_status: linkedBooking.itinerary_status || null,
          },
          resource: requestedMetadata.resource && typeof requestedMetadata.resource === "object" ? {
            type: String(requestedMetadata.resource.type || "").slice(0,40),
            id: requestedMetadata.resource.id ?? null,
            name: String(requestedMetadata.resource.name || "").slice(0,180),
          } : null,
        };
      } else if (requestedMetadata.resource && typeof requestedMetadata.resource === "object") {
        messageMetadata = { kind: "resource_question", resource: {
          type: String(requestedMetadata.resource.type || "").slice(0,40),
          id: requestedMetadata.resource.id ?? null,
          name: String(requestedMetadata.resource.name || "").slice(0,180),
        }};
      }
    }
    const msg = await insertMessage({
      conversationId: id,
      senderType:     isAdminReq ? "admin" : "user",
      senderId:       req.user.id,
      senderName:     isAdminReq
        ? (senderProfile.full_name || senderProfile.username || "Admin")
        : (senderProfile.full_name || "Registered traveler"),
      senderEmail:    senderProfile.email || null,
      senderAvatar:   senderProfile.avatar_url || null,
      body:           String(body).trim(),
      replyToId:      replyToId || null,
      metadata:       messageMetadata,
    });

    const serialized = reshapeMessage(msg);
    const conv = convCheck.rows[0];

    try {
      const io = req.app.get("io");
      if (io) {
        // Socket.IO uses conv:/session: rooms; keep HTTP fallback sends just as live.
        io.to(`conv:${id}`).emit("msg:message", serialized);
        io.to(`conversation-${id}`).emit("msg:message", serialized);
        if (conv.session_id) io.to(`session:${conv.session_id}`).emit("msg:message", serialized);
        if (conv.user_id) {
          io.to(`user-${conv.user_id}`).emit("msg:message", serialized);
        } else if (conv.group_id) {
          const { rows: members } = await query(`SELECT user_id FROM message_group_members WHERE group_id = $1`, [conv.group_id]);
          const payload = { conversationId: Number(id), groupId: conv.group_id, message: serialized };
          io.to(`group-${conv.group_id}`).emit("msg:group-message", payload);
          for (const member of members) io.to(`user-${member.user_id}`).emit("msg:group-message", payload);
        }

        if (!isAdminReq) {
          const senderName = msg.sender_name || req.user.full_name || req.user.name || "Traveler";
          const senderEmail = req.user.email || "";
          io.to("admins").to("admin-room").emit("msg:new-from-user", {
          senderType: "user",
            conversationId: Number(id),
            sessionId: conv.session_id || null,
            message: serialized,
            senderName,
            senderEmail,
            senderAvatar: msg.sender_avatar || req.user.avatar_url || null,
            guestName: senderName,
            guestAvatar: msg.sender_avatar || req.user.avatar_url || null,
          });
          const current = await query(
            `SELECT c.*, u.full_name AS user_full_name, u.email AS user_email, u.avatar_url AS user_avatar
               FROM conversations c LEFT JOIN users u ON u.id = c.user_id
              WHERE c.id = $1 LIMIT 1`,
            [id],
          );
          if (current.rows[0]) {
            const row = current.rows[0];
            io.to("admins").to("admin-room").emit("msg:conversation-updated", reshapeConversation({
              ...row,
              user: row.user_id ? {
                fullName: row.user_full_name, email: row.user_email, avatarUrl: row.user_avatar,
              } : null,
            }));
          }
        } else if (conv.user_id) {
          io.to(`user-${conv.user_id}`).emit("msg:new-from-admin", {
            conversationId: Number(id),
            message: serialized,
          });
        }
      }
    } catch (socketError) {
      logger.warn("[Messages] Live message broadcast failed:", socketError.message);
    }

    // Persist a personalized admin alert only for incoming traveller messages.
    // Replies are delivered inside the conversation and deliberately do not
    // create a second email or notification for either side.
    try {
      if (!isAdminReq) {
        const { createNotificationInternal } = require("../controllers/notificationsController");
        const profileResult = await query(
          `SELECT id, full_name, email, avatar_url FROM users WHERE id::text = $1::text LIMIT 1`,
          [req.user.id],
        );
        const profile = profileResult.rows[0] || {};
        const senderName = profile.full_name || req.user.full_name || req.user.name || msg.sender_name || "Registered traveler";
        const senderEmail = profile.email || req.user.email || "";
        await createNotificationInternal({
          userId: null,
          senderType: "user",
          senderId: req.user.id,
          senderName,
          type: "message_received",
          category: "message",
          title: `New message from ${senderName}`,
          message: String(body).trim().slice(0, 500),
          actionUrl: `/messages?conversationId=${encodeURIComponent(id)}`,
          actionLabel: "Open conversation",
          priority: "high",
          targetScope: "role",
          targetRole: "admin",
          metadata: {
            conversationId: Number(id),
            messageId: msg.id,
            userId: profile.id || req.user.id,
            senderName,
            senderEmail,
            senderAvatar: profile.avatar_url || null,
          },
        });
      }
    } catch (notificationError) {
      logger.warn("[Messages] Incoming-message admin notification failed:", notificationError.message);
    }

    return res.json({ success: true, data: serialized });
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
      `SELECT c.id, c.user_id, c.group_id, u.email AS user_email, u.full_name AS user_full_name FROM conversations c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [req.params.id],
    );
    if (!convCheck.rows[0]) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    /* Users may only mark their own conversation as read */
    if (!isAdminUser(req)) {
      const ownsConversation = convCheck.rows[0].user_id && convCheck.rows[0].user_id === req.user.id;
      let memberOfGroup = false;
      if (convCheck.rows[0].group_id) {
        const member = await query(
          `SELECT 1 FROM message_group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
          [convCheck.rows[0].group_id, req.user.id],
        );
        memberOfGroup = Boolean(member.rows[0]);
      }
      if (!ownsConversation && !memberOfGroup) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const readerType = isAdminUser(req) ? "admin" : "user";
    await markConversationRead({
      conversationId: req.params.id,
      readerType,
    });

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`conv:${req.params.id}`).emit("msg:conversation-updated", {
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
        io.to(`conv:${req.params.id}`).emit(
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
  protect,
  async (req, res) => {
    try {
      const { cid, mid }   = req.params;
      const { emoji, add } = req.body;

      if (!emoji) {
        return res.status(400).json({ success: false, message: "Emoji is required" });
      }

      const access = await canAccessConversation(req, cid);
      if (!access.allowed) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      const messageCheck = await query(
        `SELECT id FROM messages WHERE id=$1 AND conversation_id=$2 AND deleted=false LIMIT 1`,
        [mid, cid],
      );
      if (!messageCheck.rows[0]) {
        return res.status(404).json({ success: false, message: "Message not found" });
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
          io.to(`conv:${cid}`).emit("msg:reaction", {
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

/* ═══════════════════════════════════════════════════════════════════════════
   MESSAGE LIFECYCLE
═══════════════════════════════════════════════════════════════════════════ */

router.patch("/conversations/:cid/messages/:mid", protect, async (req, res) => {
  try {
    const { cid, mid } = req.params;
    const body = String(req.body.body || "").trim();
    if (!body) return res.status(400).json({ success: false, message: "Message body is required" });

    const access = await canAccessConversation(req, cid);
    if (!access.allowed) return res.status(403).json({ success: false, message: "Access denied" });

    const msgRes = await query(
      `SELECT * FROM messages WHERE id=$1 AND conversation_id=$2 AND deleted=false`,
      [mid, cid],
    );
    const msg = msgRes.rows[0];
    if (!msg) return res.status(404).json({ success: false, message: "Message not found" });

    const admin = isAdminUser(req);
    if (admin) {
      const adminMessage = ["admin", "super_admin", "superadmin", "administrator", "moderator", "editor", "support", "staff", "agent"].includes(String(msg.sender_type || "").trim().toLowerCase().replace(/[\\s-]+/g, "_"));
      if (!adminMessage || String(msg.sender_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: "Admins can only edit their own messages" });
      }
      if (msg.is_read) {
        return res.status(403).json({ success: false, message: "This message has already been seen and can no longer be edited. Send a correction instead." });
      }
    } else {
      if (String(msg.sender_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: "You can only edit your own messages" });
      }
      if (Date.now() - new Date(msg.created_at).getTime() > 15 * 60 * 1000) {
        return res.status(403).json({ success: false, message: "Messages can only be edited within 15 minutes" });
      }
    }

    const { rows } = await query(
      `UPDATE messages
          SET body=$1, edited=true, edited_at=NOW(), updated_at=NOW()
        WHERE id=$2 AND conversation_id=$3
        RETURNING *`,
      [body, mid, cid],
    );
    const shaped = reshapeMessage(rows[0]);
    const io = req.app.get("io");
    if (io) {
      io.to(`conv:${cid}`).emit("msg:message-edited", shaped);
      io.to(`conversation-${cid}`).emit("msg:message-edited", shaped);
    }
    return res.json({ success: true, data: shaped });
  } catch (err) {
    logger.error(`[Messages] PATCH message: ${err.message}`);
    return res.status(err.status || 500).json({ success: false, message: err.message || "Failed to edit message" });
  }
});

router.delete("/conversations/:cid/messages/:mid", protect, async (req, res) => {
  try {
    const { cid, mid } = req.params;
    const access = await canAccessConversation(req, cid);
    if (!access.allowed) return res.status(403).json({ success: false, message: "Access denied" });

    const msgRes = await query(
      `SELECT * FROM messages WHERE id=$1 AND conversation_id=$2 AND deleted=false`,
      [mid, cid],
    );
    const msg = msgRes.rows[0];
    if (!msg) return res.status(404).json({ success: false, message: "Message not found" });

    const admin = isAdminUser(req);
    if (admin) {
      const adminMessage = ["admin", "super_admin", "superadmin", "administrator", "moderator", "editor", "support", "staff", "agent"].includes(String(msg.sender_type || "").trim().toLowerCase().replace(/[\\s-]+/g, "_"));
      if (!adminMessage || String(msg.sender_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: "Admins can only unsend their own messages" });
      }
    } else {
      if (String(msg.sender_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: "You can only unsend your own messages" });
      }
      if (Date.now() - new Date(msg.created_at).getTime() > 24 * 60 * 60 * 1000) {
        return res.status(403).json({ success: false, message: "Messages can only be unsent within 24 hours" });
      }
    }

    const { rows } = await query(
      `UPDATE messages
          SET deleted=true, deleted_at=NOW(), deleted_by=$1,
              body='This message was unsent', edited=false, updated_at=NOW()
        WHERE id=$2 AND conversation_id=$3
        RETURNING *`,
      [req.user.id, mid, cid],
    );
    const shaped = reshapeMessage(rows[0]);
    const io = req.app.get("io");
    if (io) {
      io.to(`conv:${cid}`).emit("msg:message-deleted", shaped);
      io.to(`conversation-${cid}`).emit("msg:message-deleted", shaped);
    }
    return res.json({ success: true, data: shaped });
  } catch (err) {
    logger.error(`[Messages] DELETE message: ${err.message}`);
    return res.status(err.status || 500).json({ success: false, message: err.message || "Failed to unsend message" });
  }
});

for (const [pathSuffix, column, eventName] of [
  ["pin", "is_pinned", "msg:message-pinned"],
  ["highlight", "is_highlighted", "msg:message-highlighted"],
]) {
  router.patch(`/conversations/:cid/messages/:mid/${pathSuffix}`, protect, async (req, res) => {
    try {
      const { cid, mid } = req.params;
      const access = await canAccessConversation(req, cid);
      if (!access.allowed) return res.status(403).json({ success: false, message: "Access denied" });

      const msgRes = await query(
        `SELECT * FROM messages WHERE id=$1 AND conversation_id=$2 AND deleted=false`,
        [mid, cid],
      );
      const msg = msgRes.rows[0];
      if (!msg) return res.status(404).json({ success: false, message: "Message not found" });

      const admin = isAdminUser(req);
      if (admin) {
        return res.status(403).json({ success: false, message: "Admin accounts cannot modify existing messages." });
      }
      if (String(msg.sender_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: "You can only manage your own message" });
      }

      const requested = req.body.value === undefined ? !Boolean(msg[column]) : Boolean(req.body.value);
      const { rows } = await query(
        `UPDATE messages SET ${column}=$1, updated_at=NOW()
          WHERE id=$2 AND conversation_id=$3 RETURNING *`,
        [requested, mid, cid],
      );
      const shaped = reshapeMessage(rows[0]);
      const io = req.app.get("io");
      if (io) {
        io.to(`conv:${cid}`).emit(eventName, shaped);
        io.to(`conversation-${cid}`).emit(eventName, shaped);
      }
      return res.json({ success: true, data: shaped });
    } catch (err) {
      logger.error(`[Messages] PATCH ${pathSuffix}: ${err.message}`);
      return res.status(err.status || 500).json({ success: false, message: err.message || "Failed to update message" });
    }
  });
}

/* All conversation recycle requests use the ownership-checked 20-second route above. */

// backend/src/routes/message.js  — ADD these socket handlers after the routes
// Add this at the bottom of message.js, before module.exports

/* ══════════════════════════════════════════════════════════════════════════
   SOCKET.IO REAL-TIME HANDLERS
   Called from server.js:  setupMessageSockets(io)
══════════════════════════════════════════════════════════════════════════ */

function setupMessageSockets(io) {
  io.on("connection", (socket) => {
    const user = socket.handshake.auth?.user || socket.user || null;

    /* ── Join only the authenticated account room ── */
    socket.on("join:user", ({ userId } = {}) => {
      const authenticatedUserId = socket.data?.userId ?? user?.id ?? user?.userId;
      if (!authenticatedUserId || String(userId) !== String(authenticatedUserId)) return;
      socket.join(`user-${authenticatedUserId}`);
      logger.debug(`[Socket] ${socket.id} joined user-${authenticatedUserId}`);
    });

    /* ── Join / leave conversation room ── */
    socket.on("join:conversation", ({ conversationId }) => {
      if (conversationId) {
        socket.join(`conversation-${conversationId}`);
        logger.debug(`[Socket] ${socket.id} joined conversation-${conversationId}`);
      }
    });

    socket.on("leave:conversation", ({ conversationId }) => {
      if (conversationId) {
        socket.leave(`conversation-${conversationId}`);
      }
    });

    /* ── Typing broadcast ── */
    socket.on("msg:typing", (payload) => {
      const { conversationId, isTyping, senderType, senderName } = payload;
      if (!conversationId) return;

      // Broadcast to everyone else in the conversation room
      socket.to(`conversation-${conversationId}`).emit("msg:typing", {
        conversationId,
        isTyping:   Boolean(isTyping),
        senderType: senderType || "user",
        senderName: senderName || null,
      });
    });

    /* ── Admin sends a message via socket ── */
    socket.on("msg:admin-send", async (payload, ack) => {
      const { conversationId, body, replyToId } = payload;
      if (!conversationId || !body?.trim()) {
        return ack?.({ success: false, error: "conversationId and body are required" });
      }

      try {
        // Private threads for deleted accounts and legacy guest-only threads
        // are not actionable in the registered-user messaging portal.
        await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ");
        const convCheck = await query(
          `SELECT c.id, c.user_id, c.group_id, u.deleted_at AS user_deleted_at
             FROM conversations c
             LEFT JOIN users u ON u.id = c.user_id
            WHERE c.id = $1 AND c.deleted_at IS NULL`,
          [conversationId]
        );
        const currentConversation = convCheck.rows[0];
        if (!currentConversation ||
            ((!currentConversation.user_id && !currentConversation.group_id) ||
             (currentConversation.user_deleted_at && !currentConversation.group_id))) {
          return ack?.({ success: false, error: "Conversation not found" });
        }

        const adminUser = socket.handshake.auth?.user || socket.user || {};

        const msg = await insertMessage({
          conversationId,
          senderType:   "admin",
          senderId:     adminUser.id    || null,
          senderName:   adminUser.full_name || adminUser.username || "Admin",
          senderEmail:  adminUser.email  || null,
          senderAvatar: adminUser.avatar_url || null,
          body:         body.trim(),
          replyToId:    replyToId || null,
        });

        const shaped = reshapeMessage(msg);

        // Broadcast to conversation room (admin + user)
        io.to(`conversation-${conversationId}`).emit("msg:message", shaped);

        // Also push to user's personal room (in case they're not in the conv room)
        const userId = convCheck.rows[0].user_id;
        if (userId) {
          io.to(`user-${userId}`).emit("msg:new-from-admin", {
            conversationId,
            message: shaped,
          });

          // The live message event is sufficient here; no separate email or
          // notification is generated for an admin reply.
        }

        // Acknowledge to sender
        ack?.({ success: true, message: shaped });
      } catch (err) {
        logger.error(`[Socket] msg:admin-send error: ${err.message}`);
        ack?.({ success: false, error: err.message });
      }
    });

    /* ── User sends a message via socket ── */
    socket.on("msg:user-send", async (payload, ack) => {
      const { conversationId, body, replyToId } = payload || {};
      if (!conversationId || !String(body || "").trim()) {
        return ack?.({ success: false, error: "conversationId and body are required" });
      }

      try {
        const socketUser = socket.handshake.auth?.user || socket.user || {};
        if (!socketUser.id) {
          return ack?.({ success: false, error: "Sign in to message the Altuvera team." });
        }

        const convCheck = await query(
          "SELECT c.id, c.user_id, c.group_id, c.guest_name, c.guest_email, c.subject, " +
          "u.full_name AS user_full_name, u.email AS user_email " +
          "FROM conversations c LEFT JOIN users u ON u.id = c.user_id " +
          "WHERE c.id = $1 AND c.deleted_at IS NULL",
          [conversationId]
        );
        const conversation = convCheck.rows[0];
        if (!conversation) {
          return ack?.({ success: false, error: "Conversation not found" });
        }

        // Authenticated travellers may message their own support thread or a
        // shared group they belong to. A session id or guest name is never proof.
        let allowed = String(conversation.user_id || "") === String(socketUser.id);
        if (!allowed && conversation.group_id) {
          const member = await query(
            "SELECT 1 FROM message_group_members WHERE group_id = $1 AND user_id::text = $2::text LIMIT 1",
            [conversation.group_id, socketUser.id]
          );
          allowed = Boolean(member.rows[0]);
        }
        if (!allowed) {
          return ack?.({ success: false, error: "You must be a member of this signed-in conversation." });
        }

        await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ");
        const profileResult = await query(
          "SELECT id, full_name, email, avatar_url FROM users " +
          "WHERE id::text = $1::text AND is_active = TRUE AND deleted_at IS NULL LIMIT 1",
          [socketUser.id]
        );
        const profile = profileResult.rows[0];
        if (!profile) {
          return ack?.({ success: false, error: "This account is no longer available. Please sign in again." });
        }
        const senderName = profile.full_name || socketUser.full_name || socketUser.name || "Registered traveler";
        const senderEmail = profile.email || socketUser.email || "";

        const msg = await insertMessage({
          conversationId,
          senderType: "user",
          senderId: profile.id,
          senderName,
          senderEmail,
          senderAvatar: profile.avatar_url || null,
          body: String(body).trim(),
          replyToId: replyToId || null,
        });
        const shaped = reshapeMessage(msg);

        io.to("conversation-" + conversationId).emit("msg:message", shaped);
        io.to("conv:" + conversationId).emit("msg:message", shaped);
        if (conversation.group_id) {
          const groupPayload = {
            conversationId: Number(conversationId),
            groupId: conversation.group_id,
            message: shaped,
          };
          io.to("group-" + conversation.group_id).emit("msg:group-message", groupPayload);
          const members = await query(
            "SELECT user_id FROM message_group_members WHERE group_id = $1",
            [conversation.group_id]
          );
          for (const member of members.rows) {
            io.to("user-" + member.user_id).emit("msg:group-message", groupPayload);
          }
        }

        const incomingPayload = {
          senderType: "user",
          conversationId: Number(conversationId),
          senderName,
          senderEmail,
          senderAvatar: profile.avatar_url || null,
          message: shaped,
        };
        io.to("admins").to("admin-room").emit("msg:new-from-user", incomingPayload);
        io.to("admins").to("admin-room").emit("msg:conversation-updated", {
          id: Number(conversationId),
          userId: conversation.user_id,
          guestName: senderName,
          guestEmail: senderEmail,
          guestAvatar: profile.avatar_url || null,
          subject: conversation.subject,
          lastMessage: String(body).trim().slice(0, 255),
          lastMessageAt: msg.created_at,
          unreadAdmin: 1,
        });

        // Keep an unread in-app admin alert in sync even when the admin inbox
        // is closed. Never email the user or create an admin-side alert for an
        // admin reply; this branch only handles an incoming traveller message.
        try {
          const { createNotificationInternal } = require("../controllers/notificationsController");
          await createNotificationInternal({
            userId: null,
            senderType: "user",
            senderId: profile.id,
            senderName,
            type: "message_received",
            category: "message",
            title: "New message from " + senderName,
            message: String(body).trim().slice(0, 500),
            actionUrl: "/messages?conversationId=" + encodeURIComponent(conversationId),
            actionLabel: "Open conversation",
            priority: "high",
            targetScope: "role",
            targetRole: "admin",
            metadata: {
              conversationId: Number(conversationId),
              messageId: msg.id,
              userId: profile.id,
              senderName,
              senderEmail,
              senderAvatar: profile.avatar_url || null,
            },
          });
        } catch (notificationError) {
          logger.warn("[Messages] Incoming socket-message notification failed:", notificationError.message);
        }

        ack?.({ success: true, message: shaped });
      } catch (err) {
        logger.error("[Socket] msg:user-send error: " + err.message);
        ack?.({ success: false, error: "Message could not be sent. Please try again." });
      }
    });

    /* ── Admin joins admin room ── */
    socket.on("join:admin", () => {
      // This room receives privileged broadcast/notification events. Only
      // accept admin sockets authenticated by the server's JWT middleware.
      if (!socket.data?.isAdmin) {
        logger.warn(`[Socket] Rejected non-admin join:admin request from ${socket.id}`);
        return;
      }
      socket.join("admin-room");
      logger.debug(`[Socket] ${socket.id} joined admin-room`);
    });

    socket.on("disconnect", () => {
      logger.debug(`[Socket] ${socket.id} disconnected`);
    });
  });
}

module.exports = router;
module.exports.setupMessageSockets = setupMessageSockets;

module.exports = router;