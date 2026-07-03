/**
 * controllers/chatController.js
 * Fixed: socket room naming, message delivery to users
 */

const { query } = require('../config/db');

// ═══════════════════════════════════════════════════════════════════════════════
// SERIALIZERS
// ═══════════════════════════════════════════════════════════════════════════════

const serializeSession = (row) => ({
  sessionId:      row.session_id,
  userId:         row.user_id      ?? null,
  email:          row.email        ?? null,
  fullName:       row.full_name    ?? null,
  userEmail:      row.email        ?? null,
  userFullName:   row.full_name    ?? null,
  userAvatar:     row.avatar_url   ?? null,
  source:         row.source       ?? null,
  status:         row.status       ?? 'open',
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

const getOrCreateSession = async ({
  sessionId,
  userId,
  email,
  fullName,
  source,
}) => {
  const normalizedId = String(sessionId || '').trim();
  if (!normalizedId) throw new Error('sessionId is required');

  const result = await query(
    `INSERT INTO chat_sessions
       (session_id, user_id, email, full_name, source, last_active)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (session_id) DO UPDATE SET
       user_id     = COALESCE(EXCLUDED.user_id,                  chat_sessions.user_id),
       email       = COALESCE(NULLIF(EXCLUDED.email,     ''),    chat_sessions.email),
       full_name   = COALESCE(NULLIF(EXCLUDED.full_name, ''),    chat_sessions.full_name),
       source      = COALESCE(NULLIF(EXCLUDED.source,    ''),    chat_sessions.source),
       last_active = NOW(),
       updated_at  = NOW()
     RETURNING *`,
    [
      normalizedId,
      userId   || null,
      email    || null,
      fullName || null,
      source   || 'frontend',
    ],
  );

  return result.rows[0];
};

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

  // Keep session timestamp fresh
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
 * Emit to a socket room safely.
 *
 * ✅ KEY FIX: We emit to BOTH room naming conventions:
 *   - `session:${sessionId}`  — what MessagingContext.jsx listens on
 *   - `${sessionId}`          — direct session room
 *   - `admin-room`            — for admin panel sidebar updates
 */
const emit = (req, event, room, payload) => {
  try {
    const io = req.app.get('io');
    if (io) {
      io.to(room).emit(event, payload);
      // ── Debug log in development ──────────────────────────────────────────
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Socket] emit "${event}" → room "${room}"`);
      }
    }
  } catch {
    /* Socket.IO not configured — HTTP-only mode */
  }
};

/**
 * Emit a message to ALL rooms the user session might be in.
 * This guarantees delivery regardless of which room the client joined.
 */
const emitToSession = (req, sessionId, event, payload) => {
  const io = req.app.get('io');
  if (!io) return;

  try {
    // Room 1: MessagingContext joins "session:${sessionId}"
    io.to(`session:${sessionId}`).emit(event, payload);

    // Room 2: Direct session ID (some socket setups)
    io.to(sessionId).emit(event, payload);

    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[Socket] emitToSession "${event}" → "session:${sessionId}" + "${sessionId}"`,
      );
    }
  } catch (err) {
    console.error('[Socket] emitToSession error:', err.message);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/chat/sessions — Admin: list all sessions
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
// POST /api/chat/sessions — Admin: create or reopen session with user
// ═══════════════════════════════════════════════════════════════════════════════

exports.createSession = async (req, res, next) => {
  try {
    const { userId, message } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required',
      });
    }

    // ── Verify user ───────────────────────────────────────────────────────────
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
        message: 'User not found',
      });
    }

    const user      = userResult.rows[0];
    const sessionId = `user_${user.id}`;

    // ── Upsert session ────────────────────────────────────────────────────────
    const session = await getOrCreateSession({
      sessionId,
      userId:   user.id,
      email:    user.email,
      fullName: user.full_name,
      source:   'admin-panel',
    });

    // Re-open if closed
    if (session.status === 'closed') {
      await query(
        `UPDATE chat_sessions
            SET status     = 'open',
                updated_at = NOW()
          WHERE session_id = $1`,
        [sessionId],
      );
      session.status = 'open';
    }

    // ── Optional first admin message ──────────────────────────────────────────
    let messages = [];
    const admin  = req.user || {};

    if (message?.trim()) {
      const msg = await createChatMessage({
        sessionId,
        senderType:  'admin',
        senderId:    admin.id       || null,
        senderName:  admin.full_name || admin.name || 'Admin',
        senderEmail: admin.email    || null,
        body:        message.trim(),
        metadata:    { source: 'admin-panel' },
      });

      messages = [serializeMessage(msg)];

      const serialized = serializeMessage(msg);

      // ✅ FIXED: Emit to all session rooms so user widget receives it
      emitToSession(req, sessionId, 'msg:message', {
        ...serialized,
        sessionId,
      });

      // Also emit legacy event names for compatibility
      emitToSession(req, sessionId, 'message', {
        ...serialized,
        sessionId,
      });

    } else {
      const existing = await query(
        `SELECT * FROM chat_messages
          WHERE session_id = $1
          ORDER BY created_at ASC
          LIMIT 100`,
        [sessionId],
      );
      messages = existing.rows.map(serializeMessage);
    }

    // Notify admin sidebar
    emit(req, 'msg:session-updated', 'admin-room', {
      sessionId,
      status: 'open',
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
// GET /api/chat/sessions/:sessionId/messages — Get session messages
// ═══════════════════════════════════════════════════════════════════════════════

exports.getMessages = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId is required',
      });
    }

    // Auto-mark as read when admin opens the session
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
// POST /api/chat/sessions/:sessionId/messages — Admin sends message
// ═══════════════════════════════════════════════════════════════════════════════

exports.sendAdminMessage = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { body }      = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId is required',
      });
    }
    if (!body?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message body is required',
      });
    }

    const session = await getOrCreateSession({
      sessionId,
      source: 'admin',
    });

    const admin   = req.user || {};

    const message = await createChatMessage({
      sessionId:   session.session_id,
      senderType:  'admin',
      senderId:    admin.id         || null,
      senderName:  admin.full_name  || admin.name || 'Admin',
      senderEmail: admin.email      || null,
      body:        body.trim(),
      metadata:    { source: 'admin-panel' },
    });

    const serialized = serializeMessage(message);

    // ✅ FIXED: Emit to all rooms the user widget might be listening on
    emitToSession(req, sessionId, 'msg:message', {
      ...serialized,
      sessionId,
    });

    // Legacy event name fallback
    emitToSession(req, sessionId, 'message', {
      ...serialized,
      sessionId,
    });

    // Notify admin sidebar too
    emit(req, 'msg:session-updated', 'admin-room', {
      sessionId,
      lastMessage:   serialized.body,
      lastMessageAt: serialized.createdAt,
      lastSenderType: 'admin',
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
// PATCH /api/chat/sessions/:sessionId/read — Mark messages as read
// ═══════════════════════════════════════════════════════════════════════════════

exports.markSessionRead = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId is required',
      });
    }

    await query(
      `UPDATE chat_messages
          SET is_read = true
        WHERE session_id  = $1
          AND sender_type != 'admin'
          AND is_read     = false`,
      [sessionId],
    );

    // ✅ FIXED: Notify user widget that messages were read
    emitToSession(req, sessionId, 'msg:read', { sessionId });

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/chat/sessions/:sessionId/status — Update session status
// ═══════════════════════════════════════════════════════════════════════════════

exports.updateSessionStatus = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { status }    = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId is required',
      });
    }
    if (!['open', 'closed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'status must be "open" or "closed"',
      });
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
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    // ✅ FIXED: Notify both user and admin
    emitToSession(req, sessionId, 'msg:session-updated', {
      sessionId,
      status,
    });
    emit(req, 'msg:session-updated', 'admin-room', {
      sessionId,
      status,
    });

    return res.json({
      success: true,
      data:    serializeSession(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/chat/history/:sessionId — Public: chat widget history
// ═══════════════════════════════════════════════════════════════════════════════

exports.getHistory = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId is required',
      });
    }

    const sessionResult = await query(
      `SELECT * FROM chat_sessions WHERE session_id = $1 LIMIT 1`,
      [sessionId],
    );

    if (!sessionResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Chat session not found',
      });
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