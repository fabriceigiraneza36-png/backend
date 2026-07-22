// routes/message.js
"use strict";

/**
 * REST API for the Admin ⇄ User messaging system.
 *
 * Mounted at:  /api/messages  and  /api/message  (alias)
 *
 * Auth middleware is resolved the same way as notifications.js (protect +
 * restrictTo). The live (socket) side of this system lives in server.js.
 *
 * Endpoints:
 *   GET  /conversations               — list (admin: all | open; user: own)
 *   GET  /conversations/unread-count  — { admin, user } counts
 *   GET  /conversations/:id           — conversation + messages
 *   GET  /conversations/by-booking/:bookingNumber — find/return booking convo
 *   POST /conversations               — create a conversation (or attach to booking)
 *   POST /conversations/:id/messages  — send a message into a conversation
 *   PATCH /conversations/:id/read     — mark messages read for current recipient
 *   PATCH /conversations/:id/status   — admin: change status / priority
 */

const express = require("express");
const { query } = require("../config/db");
const logger  = require("../utils/logger");
const msg     = require("../utils/messaging");

/* ── Auth middleware resolution (mirrors notifications.js) ─────────────────── */
let protect;
try {
  const candidates = [
    "../middleware/authMiddleware",
    "../middleware/auth",
    "../middleware/userAuth",
  ];
  for (const p of candidates) {
    try {
      const m = require(p);
      protect = protect || m.protect || m.authenticate || m.verifyToken || m.auth;
      if (protect) break;
    } catch { /* try next */ }
  }
} catch { /* fall through */ }

if (!protect) {
  const jwt = require("jsonwebtoken");
  protect = (req, res, next) => {
    const raw =
      (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim() ||
      req.cookies?.token;
    if (!raw) return res.status(401).json({ success: false, message: "Unauthorized" });
    try { req.user = jwt.verify(raw, process.env.JWT_SECRET); next(); }
    catch { return res.status(401).json({ success: false, message: "Invalid token" }); }
  };
}

const restrictTo = (...roles) => {
  const allowed = new Set(roles);
  return (req, res, next) => {
    const role = req.user?.role || req.user?.type || "";
    if (!allowed.has(role))
      return res.status(403).json({ success: false, message: "Forbidden" });
    next();
  };
};

/* ── Resolve the requester's identity from a JWT/req.user ───────────────────── */
const actor = (req) => ({
  userId:    req.user?.id    || null,
  name:      req.user?.full_name || req.user?.name || req.user?.email || "You",
  email:     req.user?.email || null,
  avatar:    req.user?.avatar_url || null,
});

const router = express.Router();

/* ══════════════════════════════════════════════════════════════════════════
   LIST CONVERSATIONS
   ══════════════════════════════════════════════════════════════════════════*/
router.get("/conversations", protect, async (req, res) => {
  try {
    const isAdmin    = ["admin", "manager"].includes(req.user?.role || req.user?.type);
    const userId     = req.user?.id;
    const userEmail  = req.user?.email || "";
    const status     = req.query.status || null;   // admin filter
    const limit      = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const page       = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset     = (page - 1) * limit;

    let where = "c.deleted_at IS NULL";
    const params = [];

    if (isAdmin) {
      if (status) { params.push(status); where += ` AND c.status = $${params.length}`; }
    } else {
      // A normal user only sees conversations they own (by id or email)
      params.push(userId, userEmail);
      where += ` AND (c.user_id = $${params.length - 1} OR c.guest_email = $${params.length})`;
    }

    const whereSql = where ? `WHERE ${where}` : "";

    const { rows } = await query(
      `SELECT c.*, u.full_name AS user_full_name, u.email AS user_email,
              u.avatar_url AS user_avatar
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
         ${whereSql}
         ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::INT AS total FROM conversations c ${whereSql}`,
      params,
    );

    const total = countRows[0]?.total ?? 0;

    return res.json({
      success:  true,
      data:     rows.map(msg.serializeConversation),
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    });
  } catch (err) {
    logger.error("[Messages] GET /conversations:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   UNREAD COUNTS  (admin vs user)
   ══════════════════════════════════════════════════════════════════════════*/
router.get("/conversations/unread-count", protect, async (req, res) => {
  try {
    const isAdmin   = ["admin", "manager"].includes(req.user?.role || req.user?.type);
    const userId    = req.user?.id;
    const userEmail = req.user?.email || "";

    if (isAdmin) {
      const { rows } = await query(
        `SELECT COALESCE(SUM(unread_admin),0)::INT AS n
           FROM conversations WHERE deleted_at IS NULL AND status != 'closed'`,
      );
      return res.json({ success: true, admin: rows[0]?.n ?? 0, user: 0 });
    }

    if (userId || userEmail) {
      const { rows } = await query(
        `SELECT COALESCE(SUM(unread_user),0)::INT AS n
           FROM conversations
          WHERE deleted_at IS NULL
            AND (user_id = $1 OR guest_email = $2)`,
        [userId, userEmail],
      );
      return res.json({ success: true, admin: 0, user: rows[0]?.n ?? 0 });
    }

    return res.json({ success: true, admin: 0, user: 0 });
  } catch (err) {
    logger.error("[Messages] GET unread-count:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   FIND CONVERSATION BY BOOKING NUMBER
   ══════════════════════════════════════════════════════════════════════════*/
router.get("/conversations/by-booking/:bookingNumber", protect, async (req, res) => {
  try {
    const bn = String(req.params.bookingNumber || "").trim().toUpperCase();
    if (!bn) return res.status(400).json({ success: false, message: "bookingNumber required" });

    const isAdmin = ["admin", "manager"].includes(req.user?.role || req.user?.type);
    const { rows } = await query(
      `SELECT c.*, u.full_name AS user_full_name, u.email AS user_email,
              u.avatar_url AS user_avatar
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.booking_number = $1 AND c.deleted_at IS NULL
        LIMIT 1`,
      [bn],
    );

    if (!rows[0]) return res.json({ success: true, data: null });

    // Users may only fetch their own booking conversation
    if (!isAdmin) {
      const own = rows[0].user_id === req.user?.id || rows[0].guest_email === req.user?.email;
      if (!own) return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const messages = await msg.getMessages(rows[0].id);
    const conv = msg.serializeConversation(rows[0]);
    return res.json({
      success: true,
      data: { ...conv, messages: messages.map(msg.serializeMessage) },
    });
  } catch (err) {
    logger.error("[Messages] GET by-booking:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   GET ONE CONVERSATION + MESSAGES
   ══════════════════════════════════════════════════════════════════════════*/
router.get("/conversations/:id", protect, async (req, res) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const isAdmin = ["admin", "manager"].includes(req.user?.role || req.user?.type);

    const conv = await msg.findConversationById(id);
    if (!conv) return res.status(404).json({ success: false, message: "Conversation not found" });

    if (!isAdmin) {
      const own = conv.user_id === req.user?.id || conv.guest_email === req.user?.email;
      if (!own) return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const messages = await msg.getMessages(id);
    const result = msg.serializeConversation(conv);
    result.messages = messages.map(msg.serializeMessage);

    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error("[Messages] GET /conversations/:id:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   CREATE CONVERSATION  (optionally linked to a booking)
   body: { bookingNumber?, subject?, body?, guestName?, guestEmail? }
   ══════════════════════════════════════════════════════════════════════════*/
router.post("/conversations", protect, async (req, res) => {
  try {
    const isAdmin = ["admin", "manager"].includes(req.user?.role || req.user?.type);
    const a       = actor(req);

    let bookingId = null, bookingNumber = null;
    if (req.body.bookingNumber) {
      const bn = String(req.body.bookingNumber).trim().toUpperCase();
      const { rows } = await query(
        `SELECT id, booking_number, full_name, email, user_id
           FROM bookings WHERE booking_number = $1 LIMIT 1`,
        [bn],
      );
      if (rows[0]) {
        bookingId      = rows[0].id;
        bookingNumber  = rows[0].booking_number;
        // Prefer booking identity when the user hasn't supplied one
        if (!req.body.guestName && rows[0].full_name)  req.body.guestName  = rows[0].full_name;
        if (!req.body.guestEmail && rows[0].email)     req.body.guestEmail = rows[0].email;
      }
    }

    const userId     = isAdmin ? null : (a.userId || null);
    const guestName  = req.body.guestName  || (isAdmin ? null : a.name);
    const guestEmail = req.body.guestEmail || (isAdmin ? null : a.email);

    const conv = await msg.getOrCreateConversation({
      sessionId:     req.body.sessionId || (bookingNumber ? `booking-${bookingNumber}` : null),
      userId,
      guestName,
      guestEmail,
      subject:       req.body.subject || (bookingNumber ? `Booking ${bookingNumber}` : "New conversation"),
      status:        "open",
      priority:      req.body.priority || "normal",
      source:        isAdmin ? "admin-panel" : "frontend-auth",
      bookingId,
      bookingNumber,
      metadata:      { kind: req.body.kind || (bookingNumber ? "booking_request" : "general") },
    });

    let message = null;
    const text = String(req.body.body || "").trim();
    if (text) {
      message = await msg.saveMessage({
        conversationId: conv.id,
        senderType:     isAdmin ? "admin" : "user",
        senderId:       a.userId,
        senderName:     a.name,
        senderEmail:    a.email,
        senderAvatar:   a.avatar,
        body:           text,
        metadata:       { kind: req.body.kind || "general" },
      });
    }

    const result = msg.serializeConversation(conv);
    result.messages = message ? [msg.serializeMessage(message)] : [];

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    logger.error("[Messages] POST /conversations:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   SEND MESSAGE INTO A CONVERSATION
   body: { body }
   ─ Users may post into their own conversations.
   ─ Admins may post into any conversation.
   ══════════════════════════════════════════════════════════════════════════*/
router.post("/conversations/:id/messages", protect, async (req, res) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const isAdmin = ["admin", "manager"].includes(req.user?.role || req.user?.type);
    const a       = actor(req);

    const text = String(req.body.body || "").trim();
    if (!text) return res.status(400).json({ success: false, message: "Message body required" });
    const replyToId = req.body.replyToId ? parseInt(req.body.replyToId, 10) : null;

    const conv = await msg.findConversationById(id);
    if (!conv) return res.status(404).json({ success: false, message: "Conversation not found" });

    if (!isAdmin) {
      const own = conv.user_id === req.user?.id || conv.guest_email === req.user?.email;
      if (!own) return res.status(403).json({ success: false, message: "Forbidden" });
      if (conv.status === "closed") {
        await query(`UPDATE conversations SET status='open', updated_at=NOW() WHERE id=$1`, [id])
          .catch(() => {});
      }
    } else if (!conv.assigned_admin) {
      await query(`UPDATE conversations SET assigned_admin=$1 WHERE id=$2`, [a.userId, id])
        .catch(() => {});
    }

    const message = await msg.saveMessage({
      conversationId: conv.id,
      senderType:     isAdmin ? "admin" : "user",
      senderId:       a.userId,
      senderName:     a.name,
      senderEmail:    a.email,
      senderAvatar:   a.avatar,
      body:           text,
      metadata:       req.body.metadata || {},
      replyToId,
    });

    const serialized = msg.serializeMessage(message);
    const unreadAdmin = await msg.countUnreadAdmin(conv.id);

    // Real-time broadcast
    msg.broadcastMessage({
      conversationId: conv.id,
      sessionId:      conv.session_id,
      userId:         conv.user_id,
      payload:        { ...serialized, conversationId: conv.id },
      adminPayload: {
        conversationId: conv.id,
        sessionId:      conv.session_id,
        message:        serialized,
        senderName:     message.sender_name || (isAdmin ? "Admin" : "Guest"),
        senderEmail:    message.sender_email || "",
        unreadCount:    unreadAdmin,
      },
    });

    // If a user just sent a message, notify the admin in-app too
    if (!isAdmin) {
      try {
        const notifCtrl = require("../controllers/notificationsController");
        notifCtrl.createNotificationInternal({
          targetScope: "admin",
          type:        "message",
          category:    "message",
          title:       "💬 New message from a traveller",
          message:     `${message.sender_name || "A traveller"}: ${text.slice(0, 120)}`,
          actionUrl:   `/messages?conversation=${conv.id}`,
          actionLabel: "Open Chat",
          priority:    "normal",
          metadata:    { conversationId: conv.id, bookingNumber: conv.booking_number },
        }).catch(() => {});
      } catch { /* notifications optional */ }
    }

    return res.status(201).json({ success: true, data: serialized });
  } catch (err) {
    logger.error("[Messages] POST message:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   MARK READ  — marks messages addressed to the current recipient as read
   ══════════════════════════════════════════════════════════════════════════*/
router.patch("/conversations/:id/read", protect, async (req, res) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const isAdmin = ["admin", "manager"].includes(req.user?.role || req.user?.type);

    const conv = await msg.findConversationById(id);
    if (!conv) return res.status(404).json({ success: false, message: "Conversation not found" });

    if (!isAdmin) {
      const own = conv.user_id === req.user?.id || conv.guest_email === req.user?.email;
      if (!own) return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await msg.markReadForRecipient(id, isAdmin ? "admin" : "user");

    const io = msg.getIO();
    if (io) {
      io.to(`conv:${id}`).emit("msg:read", {
        conversationId: id,
        readBy: isAdmin ? "admin" : "user",
      });
    }

    return res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    logger.error("[Messages] PATCH read:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   STATUS UPDATE  (admin only)
   body: { status?, priority?, assignedAdmin? }
   ══════════════════════════════════════════════════════════════════════════*/
router.patch("/conversations/:id/status", protect, restrictTo("admin", "manager"), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, priority, assignedAdmin } = req.body;

    const fields = [];
    const params = [];
    let p = 1;

    if (status)            { fields.push(`status = $${p++}`);     params.push(status); }
    if (priority)          { fields.push(`priority = $${p++}`);   params.push(priority); }
    if (assignedAdmin !== undefined) {
      fields.push(`assigned_admin = $${p++}`);
      params.push(assignedAdmin === null ? null : parseInt(assignedAdmin, 10));
    }
    if (status === "closed") fields.push("closed_at = NOW()");
    fields.push("updated_at = NOW()");
    params.push(id);

    const { rows } = await query(
      `UPDATE conversations SET ${fields.join(", ")} WHERE id = $${p} RETURNING *`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: "Conversation not found" });

    msg.broadcastConversationUpdate(rows[0]);

    return res.json({ success: true, data: msg.serializeConversation(rows[0]) });
  } catch (err) {
    logger.error("[Messages] PATCH status:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   REACT  (toggle reaction on a message)
   body: { emoji }
   ══════════════════════════════════════════════════════════════════════════*/
router.patch("/conversations/:id/messages/:msgId/react", protect, async (req, res) => {
  try {
    const convId = parseInt(req.params.id, 10);
    const msgId  = parseInt(req.params.msgId, 10);
    const isAdmin = ["admin", "manager"].includes(req.user?.role || req.user?.type);
    const emoji  = String(req.body.emoji || "").trim();
    if (!emoji) return res.status(400).json({ success: false, message: "emoji required" });

    const conv = await msg.findConversationById(convId);
    if (!conv) return res.status(404).json({ success: false, message: "Conversation not found" });
    if (!isAdmin) {
      const own = conv.user_id === req.user?.id || conv.guest_email === req.user?.email;
      if (!own) return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const message = await msg.addReaction(convId, msgId, emoji, req.user?.id || 0);
    if (!message) return res.status(404).json({ success: false, message: "Message not found" });

    const serialized = msg.serializeMessage(message);
    const io = msg.getIO();
    if (io) {
      io.to(`conv:${convId}`).emit("msg:reaction", {
        conversationId: convId,
        messageId:      msgId,
        reactions:      serialized.reactions,
        reactedBy:      isAdmin ? "admin" : "user",
        emoji,
      });
    }

    return res.json({ success: true, data: serialized });
  } catch (err) {
    logger.error("[Messages] PATCH react:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   DELETE (soft)  — admin only
   ══════════════════════════════════════════════════════════════════════════*/
router.delete("/conversations/:id", protect, restrictTo("admin", "manager"), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await query(
      `UPDATE conversations SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW()
         WHERE id = $2`,
      [req.user?.id, id],
    );
    return res.json({ success: true, message: "Conversation removed" });
  } catch (err) {
    logger.error("[Messages] DELETE:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
