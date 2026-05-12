const { query } = require("../config/db");

// ═══════════════════════════════════════════════════════════════════════════════
// SERIALIZERS
// ═══════════════════════════════════════════════════════════════════════════════

const serializeSession = (row) => ({
  sessionId:      row.session_id,
  userId:         row.user_id      ?? null,
  email:          row.email        ?? null,
  fullName:       row.full_name    ?? null,
  // Aliases expected by Chat.jsx
  userEmail:      row.email        ?? null,
  userFullName:   row.full_name    ?? null,
  userAvatar:     row.avatar_url   ?? null,
  source:         row.source       ?? null,
  status:         row.status       ?? "open",
  lastActive:     row.last_active  ?? null,
  createdAt:      row.created_at   ?? null,
  updatedAt:      row.updated_at   ?? null,
  unreadCount:    parseInt(row.unread_count, 10) || 0,
  lastMessage:    row.last_message     ?? null,
  lastMessageAt:  row.last_message_at  ?? row.last_active ?? null,
  lastSenderType: row.last_sender_type ?? null,
});

const serializeMessage = (row) => ({
  id:          row.id,
  sessionId:   row.session_id,
  senderType:  row.sender_type,
  senderId:    row.sender_id    ?? null,
  senderName:  row.sender_name  ?? null,
  senderEmail: row.sender_email ?? null,
  body:        row.body,
  metadata:    row.metadata     ?? {},
  isRead:      row.is_read      ?? false,
  createdAt:   row.created_at,
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Upsert a chat session row.
 * - If session_id already exists → touch last_active, backfill missing fields
 * - If not → insert a new row
 */
const getOrCreateSession = async ({
  sessionId,
  userId,
  email,
  fullName,
  source,
}) => {
  const normalizedId = String(sessionId || "").trim();
  if (!normalizedId) throw new Error("sessionId is required");

  const result = await query(
    `INSERT INTO chat_sessions
       (session_id, user_id, email, full_name, source, last_active)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (session_id) DO UPDATE SET
       user_id   = COALESCE(EXCLUDED.user_id,   chat_sessions.user_id),
       email     = COALESCE(NULLIF(EXCLUDED.email,     ''), chat_sessions.email),
       full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), chat_sessions.full_name),
       source    = COALESCE(NULLIF(EXCLUDED.source,    ''), chat_sessions.source),
       last_active = NOW(),
       updated_at  = NOW()
     RETURNING *`,
    [
      normalizedId,
      userId   || null,
      email    || null,
      fullName || null,
      source   || "frontend",
    ],
  );

  return result.rows[0];
};

/**
 * Insert a chat message and touch the parent session timestamp.
 */
const createChatMessage = async ({
  sessionId,
  senderType,
  senderId,
  senderName,
  senderEmail,
  body,
  metadata,
}) => {
  const result = await query(
    `INSERT INTO chat_messages
       (session_id, sender_type, sender_id, sender_name,
        sender_email, body, metadata, is_read)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false)
     RETURNING *`,
    [
      sessionId,
      senderType,
      senderId    || null,
      senderName  || null,
      senderEmail || null,
      body,
      metadata    || {},
    ],
  );

  // Keep session fresh
  await query(
    `UPDATE chat_sessions
        SET last_active = NOW(),
            updated_at  = NOW()
      WHERE session_id  = $1`,
    [sessionId],
  );

  return result.rows[0];
};

/**
 * Emit a socket event if Socket.IO is attached to the Express app.
 * Falls back silently if not configured.
 */
const emit = (req, event, room, payload) => {
  try {
    const io = req.app.get("io");
    if (io) io.to(room).emit(event, payload);
  } catch { /* socket not configured */ }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/chat/sessions
// List all sessions with unread counts + last message
// ═══════════════════════════════════════════════════════════════════════════════

exports.getSessions = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        cs.*,
        u.avatar_url,
        COALESCE((
          SELECT COUNT(*)
            FROM chat_messages cm
           WHERE cm.session_id  = cs.session_id
             AND cm.sender_type != 'admin'
             AND cm.is_read     = false
        ), 0) AS unread_count,
        (
          SELECT body
            FROM chat_messages cm
           WHERE cm.session_id = cs.session_id
           ORDER BY cm.created_at DESC
           LIMIT 1
        ) AS last_message,
        (
          SELECT created_at
            FROM chat_messages cm
           WHERE cm.session_id = cs.session_id
           ORDER BY cm.created_at DESC
           LIMIT 1
        ) AS last_message_at,
        (
          SELECT sender_type
            FROM chat_messages cm
           WHERE cm.session_id = cs.session_id
           ORDER BY cm.created_at DESC
           LIMIT 1
        ) AS last_sender_type
      FROM chat_sessions cs
      LEFT JOIN users u ON u.id = cs.user_id
      ORDER BY cs.last_active DESC
    `);

    return res.json({
      success: true,
      data:    result.rows.map(serializeSession),
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/chat/sessions
// Admin creates or reopens a session with a registered user
// Body: { userId, message? }
// ═══════════════════════════════════════════════════════════════════════════════

exports.createSession = async (req, res, next) => {
  try {
    const { userId, message } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    // ── Verify the user exists ───────────────────────────────────────────────
    const userResult = await query(
      `SELECT id, full_name, email, avatar_url
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [userId],
    );

    if (!userResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = userResult.rows[0];

    // ── Use user's id as the sessionId (stable, 1-per-user convention) ───────
    // If you prefer UUID sessions, swap this for a uuid() call.
    const sessionId = `user_${user.id}`;

    // ── Upsert the session ────────────────────────────────────────────────────
    const session = await getOrCreateSession({
      sessionId,
      userId:   user.id,
      email:    user.email,
      fullName: user.full_name,
      source:   "admin-panel",
    });

    // Re-open if it was closed
    if (session.status === "closed") {
      await query(
        `UPDATE chat_sessions
            SET status     = 'open',
                updated_at = NOW()
          WHERE session_id = $1`,
        [sessionId],
      );
      session.status = "open";
    }

    // ── Optional first message ────────────────────────────────────────────────
    let messages = [];
    const admin = req.user || {};

    if (message?.trim()) {
      const msg = await createChatMessage({
        sessionId,
        senderType:  "admin",
        senderId:    admin.id    || null,
        senderName:  admin.full_name || admin.name || "Admin",
        senderEmail: admin.email || null,
        body:        message.trim(),
        metadata:    { source: "admin-panel" },
      });

      messages = [serializeMessage(msg)];

      // Real-time: push the message to the user's widget
      emit(req, "msg:message", `session:${sessionId}`, {
        ...serializeMessage(msg),
        sessionId,
      });
    } else {
      // Load existing messages so the admin sees the thread immediately
      const existing = await query(
        `SELECT * FROM chat_messages
          WHERE session_id = $1
          ORDER BY created_at ASC
          LIMIT 100`,
        [sessionId],
      );
      messages = existing.rows.map(serializeMessage);
    }

    // Real-time: notify admin sidebar
    emit(req, "msg:session-updated", "admin-room", {
      sessionId,
      status: "open",
    });

    return res.status(201).json({
      success: true,
      data: {
        ...serializeSession({ ...session, avatar_url: user.avatar_url }),
        messages,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/chat/sessions/:sessionId/messages
// ═══════════════════════════════════════════════════════════════════════════════

exports.getMessages = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: "sessionId is required" });
    }

    // Auto-mark messages as read when admin opens the session
    await query(
      `UPDATE chat_messages
          SET is_read = true
        WHERE session_id  = $1
          AND sender_type != 'admin'
          AND is_read     = false`,
      [sessionId],
    );

    const result = await query(
      `SELECT * FROM chat_messages
        WHERE session_id = $1
        ORDER BY created_at ASC`,
      [sessionId],
    );

    return res.json({
      success: true,
      data:    result.rows.map(serializeMessage),
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/chat/sessions/:sessionId/messages
// Admin sends a message into an existing session
// ═══════════════════════════════════════════════════════════════════════════════

exports.sendAdminMessage = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { body }      = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: "sessionId is required" });
    }
    if (!body?.trim()) {
      return res.status(400).json({ success: false, message: "Message body is required" });
    }

    const session = await getOrCreateSession({ sessionId, source: "admin" });
    const admin   = req.user || {};

    const message = await createChatMessage({
      sessionId:   session.session_id,
      senderType:  "admin",
      senderId:    admin.id         || null,
      senderName:  admin.full_name  || admin.name || "Admin",
      senderEmail: admin.email      || null,
      body:        body.trim(),
      metadata:    { source: "admin-panel" },
    });

    const serialized = serializeMessage(message);

    // Real-time delivery to widget
    emit(req, "msg:message", `session:${sessionId}`, {
      ...serialized,
      sessionId,
    });

    return res.status(201).json({
      success: true,
      data:    serialized,
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/chat/sessions/:sessionId/read
// Mark all non-admin messages as read
// ═══════════════════════════════════════════════════════════════════════════════

exports.markSessionRead = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: "sessionId is required" });
    }

    await query(
      `UPDATE chat_messages
          SET is_read = true
        WHERE session_id  = $1
          AND sender_type != 'admin'
          AND is_read     = false`,
      [sessionId],
    );

    // Notify the widget that messages were read
    emit(req, "msg:read", `session:${sessionId}`, { sessionId });

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/chat/sessions/:sessionId/status
// Update session status: open | closed
// Body: { status: 'open' | 'closed' }
// ═══════════════════════════════════════════════════════════════════════════════

exports.updateSessionStatus = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { status }    = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: "sessionId is required" });
    }
    if (!["open", "closed"].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be "open" or "closed"' });
    }

    const result = await query(
      `UPDATE chat_sessions
          SET status     = $2,
              updated_at = NOW()
        WHERE session_id = $1
        RETURNING *`,
      [sessionId, status],
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Session not found" });
    }

    // Real-time notification
    emit(req, "msg:session-updated", `session:${sessionId}`, { sessionId, status });
    emit(req, "msg:session-updated", "admin-room",            { sessionId, status });

    return res.json({
      success: true,
      data:    serializeSession(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/chat/history/:sessionId   (PUBLIC — for the chat widget)
// ═══════════════════════════════════════════════════════════════════════════════

exports.getHistory = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: "sessionId is required" });
    }

    const sessionResult = await query(
      `SELECT * FROM chat_sessions WHERE session_id = $1 LIMIT 1`,
      [sessionId],
    );

    if (!sessionResult.rows[0]) {
      return res.status(404).json({ success: false, message: "Chat session not found" });
    }

    const messagesResult = await query(
      `SELECT * FROM chat_messages
        WHERE session_id = $1
        ORDER BY created_at ASC`,
      [sessionId],
    );

    return res.json({
      success: true,
      data: {
        session:  serializeSession(sessionResult.rows[0]),
        messages: messagesResult.rows.map(serializeMessage),
      },
    });
  } catch (err) {
    next(err);
  }
};