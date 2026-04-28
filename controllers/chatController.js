const { query } = require("../config/db");

const serializeSession = (row) => ({
  sessionId: row.session_id,
  userId: row.user_id,
  email: row.email,
  fullName: row.full_name,
  source: row.source,
  status: row.status,
  lastActive: row.last_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  unreadCount: parseInt(row.unread_count, 10) || 0,
  lastMessage: row.last_message || null,
  lastSenderType: row.last_sender_type || null,
});

const serializeMessage = (row) => ({
  id: row.id,
  sessionId: row.session_id,
  senderType: row.sender_type,
  senderId: row.sender_id,
  senderName: row.sender_name,
  senderEmail: row.sender_email,
  body: row.body,
  metadata: row.metadata || {},
  isRead: row.is_read,
  createdAt: row.created_at,
});

const getOrCreateSession = async ({ sessionId, userId, email, fullName, source }) => {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    throw new Error('sessionId is required');
  }

  const result = await query(
    `INSERT INTO chat_sessions (session_id, user_id, email, full_name, source, last_active)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (session_id)
     DO UPDATE SET
       user_id = COALESCE(EXCLUDED.user_id, chat_sessions.user_id),
       email = COALESCE(NULLIF(EXCLUDED.email, ''), chat_sessions.email),
       full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), chat_sessions.full_name),
       source = COALESCE(NULLIF(EXCLUDED.source, ''), chat_sessions.source),
       last_active = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [normalizedSessionId, userId || null, email || null, fullName || null, source || 'frontend'],
  );

  return result.rows[0];
};

const createChatMessage = async ({ sessionId, senderType, senderId, senderName, senderEmail, body, metadata }) => {
  const result = await query(
    `INSERT INTO chat_messages (session_id, sender_type, sender_id, sender_name, sender_email, body, metadata, is_read)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [sessionId, senderType, senderId || null, senderName || null, senderEmail || null, body, metadata || {}, false],
  );

  await query(
    `UPDATE chat_sessions SET last_active = NOW(), updated_at = NOW() WHERE session_id = $1`,
    [sessionId],
  );

  return result.rows[0];
};

exports.getSessions = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        cs.*,
        COALESCE(
          (SELECT COUNT(*) FROM chat_messages cm WHERE cm.session_id = cs.session_id AND cm.sender_type != 'admin' AND cm.is_read = false),
          0
        ) AS unread_count,
        (SELECT body FROM chat_messages cm WHERE cm.session_id = cs.session_id ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT sender_type FROM chat_messages cm WHERE cm.session_id = cs.session_id ORDER BY created_at DESC LIMIT 1) AS last_sender_type
      FROM chat_sessions cs
      ORDER BY cs.last_active DESC
    `);

    res.json({ data: result.rows.map(serializeSession) });
  } catch (err) {
    next(err);
  }
};

exports.getMessages = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const result = await query(
      `SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );

    res.json({ data: result.rows.map(serializeMessage) });
  } catch (err) {
    next(err);
  }
};

exports.sendAdminMessage = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { body } = req.body;

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    if (!body || !body.trim()) return res.status(400).json({ error: 'Message body is required' });

    const session = await getOrCreateSession({ sessionId, source: 'admin' });
    const admin = req.user || {};

    const message = await createChatMessage({
      sessionId: session.session_id,
      senderType: 'admin',
      senderId: admin.id,
      senderName: admin.full_name || admin.name || 'Admin',
      senderEmail: admin.email || null,
      body: body.trim(),
      metadata: { source: 'admin-panel' },
    });

    res.status(201).json({ data: serializeMessage(message) });
  } catch (err) {
    next(err);
  }
};

exports.getHistory = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const session = await query(
      `SELECT * FROM chat_sessions WHERE session_id = $1 LIMIT 1`,
      [sessionId],
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    const messages = await query(
      `SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );

    res.json({
      data: {
        session: serializeSession(session.rows[0]),
        messages: messages.rows.map(serializeMessage),
      },
    });
  } catch (err) {
    next(err);
  }
};
