// controllers/messageController.js
// ═══════════════════════════════════════════════════════════════════════════
// Real-time Messaging Controller
// Handles REST endpoints; Socket.io events handled in server.js
// ═══════════════════════════════════════════════════════════════════════════

const { query }     = require('../config/db')
const { sendEmail } = require('../utils/email')
const logger        = require('../utils/logger')
const socketBus     = require('../utils/socketBus')

const APP_NAME     = process.env.APP_NAME     || 'Altuvera'
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://altuvera.com'
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@altuvera.com'

// ── helpers ─────────────────────────────────────────────────────────────────

const handleError = (res, err, msg = 'Operation failed', status = 500) => {
  logger.error(`[Message] ${msg}:`, err.message)
  return res.status(status).json({ success: false, message: err.message || msg })
}

const serializeConversation = (row) => ({
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
  unreadUser:    row.unread_user,
  unreadAdmin:   row.unread_admin,
  tags:          row.tags || [],
  source:        row.source,
  // joined fields from view
  userFullName:  row.user_full_name  || row.guest_name,
  userEmail:     row.user_email      || row.guest_email,
  userAvatar:    row.user_avatar,
  adminFullName: row.admin_full_name,
  totalMessages: row.total_messages,
  createdAt:     row.created_at,
  updatedAt:     row.updated_at,
})

const serializeMessage = (row) => ({
  id:             row.id,
  conversationId: row.conversation_id,
  senderType:     row.sender_type,
  senderId:       row.sender_id,
  senderName:     row.sender_name,
  senderEmail:    row.sender_email,
  senderAvatar:   row.sender_avatar,
  body:           row.body,
  msgType:        row.msg_type,
  attachmentUrl:  row.attachment_url,
  isRead:         row.is_read,
  readAt:         row.read_at,
  edited:         row.edited,
  deleted:        row.deleted,
  replyToId:      row.reply_to_id,
  metadata:       row.metadata || {},
  createdAt:      row.created_at,
})

// ── Upsert / get conversation ────────────────────────────────────────────────
const getOrCreateConversation = async ({
  sessionId, userId, guestName, guestEmail,
  subject, channel, source, ipAddress, userAgent,
}) => {
  const sid = String(sessionId || '').trim()
  if (!sid) throw Object.assign(new Error('sessionId is required'), { status: 400 })

  // Try existing
  let res = await query(
    `SELECT * FROM v_conversations WHERE session_id = $1`,
    [sid],
  )
  if (res.rows.length > 0) {
    // Update contact info if provided
    if (userId || guestName || guestEmail) {
      await query(
        `UPDATE conversations SET
           user_id    = COALESCE($1, user_id),
           guest_name = COALESCE(NULLIF($2,''), guest_name),
           guest_email= COALESCE(NULLIF($3,''), guest_email),
           updated_at = NOW()
         WHERE session_id = $4`,
        [userId || null, guestName || null, guestEmail || null, sid],
      )
    }
    return res.rows[0]
  }

  // Create new
  const inserted = await query(
    `INSERT INTO conversations
       (session_id, user_id, guest_name, guest_email,
        subject, channel, source, ip_address, user_agent, status, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open','normal')
     RETURNING *`,
    [
      sid,
      userId     || null,
      guestName  || null,
      guestEmail || null,
      subject    || null,
      channel    || 'live_chat',
      source     || 'website',
      ipAddress  || null,
      userAgent  || null,
    ],
  )
  return inserted.rows[0]
}

// ── Save a message row ───────────────────────────────────────────────────────
const saveMessage = async ({
  conversationId, senderType, senderId, senderName,
  senderEmail, senderAvatar, body, msgType, metadata,
  replyToId,
}) => {
  if (!body || !body.trim()) {
    throw Object.assign(new Error('Message body required'), { status: 400 })
  }

  const res = await query(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_id, sender_name,
        sender_email, sender_avatar, body, msg_type, metadata, reply_to_id, is_read)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)
     RETURNING *`,
    [
      conversationId,
      senderType,
      senderId   || null,
      senderName || null,
      senderEmail|| null,
      senderAvatar|| null,
      body.trim(),
      msgType    || 'text',
      JSON.stringify(metadata || {}),
      replyToId  || null,
    ],
  )
  const msg = res.rows[0]

  // Update conversation last_message
  const isFromUser = senderType !== 'admin'
  await query(
    `UPDATE conversations SET
       last_message    = $1,
       last_message_at = NOW(),
       unread_admin    = CASE WHEN $2 THEN unread_admin + 1 ELSE unread_admin END,
       unread_user     = CASE WHEN $3 THEN unread_user  + 1 ELSE unread_user  END,
       first_message   = COALESCE(first_message, $1),
       updated_at      = NOW()
     WHERE id = $4`,
    [body.trim(), isFromUser, !isFromUser, conversationId],
  )

  return msg
}

// ── Notify user via email when admin replies ─────────────────────────────────
const emailUserReply = async (conversation, message) => {
  const email = conversation.user_email || conversation.guest_email
  if (!email) return
  try {
    // Check preference
    if (conversation.user_id) {
      const pref = await query(
        `SELECT email_on_reply FROM notification_preferences WHERE user_id = $1`,
        [conversation.user_id],
      )
      if (pref.rows[0]?.email_on_reply === false) return
    }

    await sendEmail({
      to:      email,
      subject: `New message from ${APP_NAME} Support`,
      html:    `
        <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f5;margin:0;padding:20px;">
        <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;">
          <h2 style="color:#059669;margin-top:0;">${APP_NAME} Support</h2>
          <p>Hello ${conversation.user_full_name || conversation.guest_name || 'there'},</p>
          <p>You have a new reply from our support team:</p>
          <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:16px;border-radius:8px;margin:16px 0;">
            <p style="margin:0;color:#1a1a1a;">${message.body}</p>
          </div>
          <a href="${FRONTEND_URL}/support?session=${conversation.session_id}"
             style="display:inline-block;background:#16a34a;color:#fff;padding:12px 28px;border-radius:40px;text-decoration:none;font-weight:600;">
            View Conversation
          </a>
          <p style="margin-top:24px;font-size:12px;color:#9ca3af;">
            &copy; ${new Date().getFullYear()} ${APP_NAME}
          </p>
        </div></body></html>
      `,
    })
  } catch (err) {
    logger.warn('[Message] Email notify failed:', err.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REST CONTROLLERS
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/messages/conversations (admin) ──────────────────────────────────
exports.getConversations = async (req, res) => {
  try {
    const {
      page = 1, limit = 20, status, priority,
      search, assigned, sortBy = 'updated_at', order = 'desc',
    } = req.query

    const offset    = (Number(page) - 1) * Number(limit)
    const conditions = ['1=1']
    const params     = []
    let   p          = 1

    if (status) { conditions.push(`c.status = $${p++}`); params.push(status) }
    if (priority){ conditions.push(`c.priority = $${p++}`); params.push(priority) }
    if (assigned === 'true')  { conditions.push(`c.assigned_admin IS NOT NULL`) }
    if (assigned === 'false') { conditions.push(`c.assigned_admin IS NULL`) }
    if (search) {
      conditions.push(`(
        c.guest_name  ILIKE $${p}   OR
        c.guest_email ILIKE $${p}   OR
        u.full_name   ILIKE $${p}   OR
        u.email       ILIKE $${p}   OR
        c.subject     ILIKE $${p}   OR
        c.last_message ILIKE $${p}
      )`)
      params.push(`%${search}%`)
      p++
    }

    const where  = conditions.join(' AND ')
    const col    = ['updated_at','created_at','last_message_at','unread_admin'].includes(sortBy) ? sortBy : 'updated_at'
    const dir    = order === 'asc' ? 'ASC' : 'DESC'

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT c.*,
                u.full_name   AS user_full_name,
                u.email       AS user_email,
                u.avatar_url  AS user_avatar,
                a.full_name   AS admin_full_name,
                (SELECT COUNT(*) FROM messages m
                 WHERE m.conversation_id = c.id AND m.deleted = false) AS total_messages
           FROM conversations c
           LEFT JOIN users       u ON u.id = c.user_id
           LEFT JOIN admin_users a ON a.id = c.assigned_admin
          WHERE ${where}
          ORDER BY c.${col} ${dir}
          LIMIT $${p} OFFSET $${p+1}`,
        [...params, Number(limit), offset],
      ),
      query(
        `SELECT COUNT(*) AS total
           FROM conversations c
           LEFT JOIN users u ON u.id = c.user_id
          WHERE ${where}`,
        params,
      ),
    ])

    const total = parseInt(countRes.rows[0]?.total || 0)
    return res.json({
      success: true,
      data: dataRes.rows.map(serializeConversation),
      pagination: {
        page:  Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    })
  } catch (err) {
    handleError(res, err, 'Fetch conversations failed')
  }
}

// ── GET /api/messages/conversations/:id (admin) ──────────────────────────────
exports.getConversation = async (req, res) => {
  try {
    const res1 = await query(
      `SELECT c.*,
              u.full_name  AS user_full_name,
              u.email      AS user_email,
              u.avatar_url AS user_avatar,
              a.full_name  AS admin_full_name
         FROM conversations c
         LEFT JOIN users       u ON u.id = c.user_id
         LEFT JOIN admin_users a ON a.id = c.assigned_admin
        WHERE c.id = $1`,
      [req.params.id],
    )
    if (!res1.rows[0])
      return res.status(404).json({ success: false, message: 'Conversation not found' })

    return res.json({ success: true, data: serializeConversation(res1.rows[0]) })
  } catch (err) {
    handleError(res, err, 'Fetch conversation failed')
  }
}

// ── GET /api/messages/conversations/:id/messages (admin + user) ──────────────
exports.getMessages = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    const convId  = req.params.id

    const [msgs, count] = await Promise.all([
      query(
        `SELECT * FROM messages
          WHERE conversation_id = $1 AND deleted = false
          ORDER BY created_at ASC
          LIMIT $2 OFFSET $3`,
        [convId, Number(limit), offset],
      ),
      query(
        `SELECT COUNT(*) AS total FROM messages
          WHERE conversation_id = $1 AND deleted = false`,
        [convId],
      ),
    ])

    // Mark admin-side as read if admin is requesting
    if (req.adminUser) {
      await query(
        `UPDATE messages SET is_read = true, read_at = NOW()
          WHERE conversation_id = $1
            AND sender_type != 'admin'
            AND is_read = false`,
        [convId],
      )
      await query(
        `UPDATE conversations SET unread_admin = 0 WHERE id = $1`,
        [convId],
      )
    }

    return res.json({
      success: true,
      data: msgs.rows.map(serializeMessage),
      pagination: {
        page:  Number(page),
        limit: Number(limit),
        total: parseInt(count.rows[0]?.total || 0),
      },
    })
  } catch (err) {
    handleError(res, err, 'Fetch messages failed')
  }
}

// ── POST /api/messages/conversations (user — start conversation) ──────────────
exports.startConversation = async (req, res) => {
  try {
    const {
      sessionId, message, subject, channel,
      guestName, guestEmail, metadata,
    } = req.body

    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' })
    }

    const userId = req.user?.id || null
    const name   = guestName  || req.user?.full_name || null
    const email  = guestEmail || req.user?.email     || null

    const conv = await getOrCreateConversation({
      sessionId:  sessionId || `user-${userId || 'guest'}-${Date.now()}`,
      userId,
      guestName:  name,
      guestEmail: email,
      subject:    subject   || null,
      channel:    channel   || 'live_chat',
      source:     'website',
      ipAddress:  req.ip,
      userAgent:  req.headers['user-agent'],
    })

    const msg = await saveMessage({
      conversationId: conv.id,
      senderType:     'user',
      senderId:       userId,
      senderName:     name,
      senderEmail:    email,
      senderAvatar:   req.user?.avatar_url || null,
      body:           message,
      metadata:       metadata || {},
    })

    const serialized = serializeMessage(msg)

    // Emit to admin room via socketBus
    const io = socketBus.getIO()
    if (io) {
      io.to('admins').emit('new-conversation-message', {
        conversation: serializeConversation(conv),
        message:      serialized,
        unreadAdmin:  conv.unread_admin + 1,
      })
    }

    return res.status(201).json({
      success: true,
      data: {
        conversationId: conv.id,
        sessionId:      conv.session_id,
        message:        serialized,
      },
    })
  } catch (err) {
    handleError(res, err, 'Start conversation failed')
  }
}

// ── POST /api/messages/conversations/:id/reply (user) ────────────────────────
exports.userReply = async (req, res) => {
  try {
    const { body: msgBody, metadata, replyToId } = req.body
    const convId = parseInt(req.params.id)

    if (!msgBody?.trim()) {
      return res.status(400).json({ success: false, message: 'Message body required' })
    }

    // Verify conversation belongs to this user / session
    const convRes = await query(
      `SELECT * FROM conversations WHERE id = $1`,
      [convId],
    )
    if (!convRes.rows[0]) {
      return res.status(404).json({ success: false, message: 'Conversation not found' })
    }
    const conv = convRes.rows[0]

    const userId = req.user?.id || null
    if (conv.user_id && userId && conv.user_id !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    const msg = await saveMessage({
      conversationId: convId,
      senderType:     'user',
      senderId:       userId,
      senderName:     req.user?.full_name || conv.guest_name,
      senderEmail:    req.user?.email     || conv.guest_email,
      senderAvatar:   req.user?.avatar_url|| null,
      body:           msgBody,
      metadata,
      replyToId,
    })

    const serialized = serializeMessage(msg)

    // Broadcast to admins
    const io = socketBus.getIO()
    if (io) {
      io.to('admins').emit('new-conversation-message', {
        conversationId: convId,
        sessionId:      conv.session_id,
        message:        serialized,
        senderName:     msg.sender_name,
        unreadAdmin:    conv.unread_admin + 1,
      })
      io.to(`conv:${convId}`).emit('message', serialized)
    }

    return res.status(201).json({ success: true, data: serialized })
  } catch (err) {
    handleError(res, err, 'User reply failed')
  }
}

// ── POST /api/messages/conversations/:id/admin-reply (admin) ─────────────────
exports.adminReply = async (req, res) => {
  try {
    const { body: msgBody, metadata, replyToId } = req.body
    const convId   = parseInt(req.params.id)
    const adminUser = req.adminUser

    if (!msgBody?.trim()) {
      return res.status(400).json({ success: false, message: 'Message body required' })
    }

    const convRes = await query(
      `SELECT c.*,
              u.full_name  AS user_full_name,
              u.email      AS user_email,
              u.avatar_url AS user_avatar
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.id = $1`,
      [convId],
    )
    if (!convRes.rows[0]) {
      return res.status(404).json({ success: false, message: 'Conversation not found' })
    }
    const conv = convRes.rows[0]

    const msg = await saveMessage({
      conversationId: convId,
      senderType:     'admin',
      senderId:       adminUser.id,
      senderName:     adminUser.full_name || adminUser.username || 'Support',
      senderEmail:    adminUser.email,
      senderAvatar:   adminUser.avatar_url || null,
      body:           msgBody,
      metadata,
      replyToId,
    })

    const serialized = serializeMessage(msg)

    // Broadcast to user's room
    const io = socketBus.getIO()
    if (io) {
      io.to(`conv:${convId}`).emit('message', serialized)
      if (conv.session_id) {
        io.to(`session:${conv.session_id}`).emit('message', serialized)
      }
    }

    // Email user
    emailUserReply(conv, msg).catch(() => {})

    return res.status(201).json({ success: true, data: serialized })
  } catch (err) {
    handleError(res, err, 'Admin reply failed')
  }
}

// ── PATCH /api/messages/conversations/:id/status (admin) ─────────────────────
exports.updateConversationStatus = async (req, res) => {
  try {
    const { status, priority, assignedAdmin, tags } = req.body
    const convId = req.params.id

    const fields = []
    const params = []
    let p = 1

    if (status)        { fields.push(`status = $${p++}`);         params.push(status) }
    if (priority)      { fields.push(`priority = $${p++}`);       params.push(priority) }
    if (assignedAdmin !== undefined) {
      fields.push(`assigned_admin = $${p++}`)
      params.push(assignedAdmin || null)
    }
    if (tags)          { fields.push(`tags = $${p++}`);           params.push(tags) }
    if (status === 'closed') {
      fields.push(`closed_at = NOW()`)
    }

    if (!fields.length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' })
    }

    fields.push('updated_at = NOW()')
    params.push(convId)

    const res2 = await query(
      `UPDATE conversations SET ${fields.join(', ')} WHERE id = $${p} RETURNING *`,
      params,
    )

    if (!res2.rows[0]) {
      return res.status(404).json({ success: false, message: 'Conversation not found' })
    }

    const io = socketBus.getIO()
    if (io) {
      io.to('admins').emit('conversation-updated', serializeConversation(res2.rows[0]))
      io.to(`conv:${convId}`).emit('conversation-status', { status: res2.rows[0].status })
    }

    return res.json({ success: true, data: serializeConversation(res2.rows[0]) })
  } catch (err) {
    handleError(res, err, 'Update status failed')
  }
}

// ── POST /api/messages/conversations/:id/read (admin marks as read) ───────────
exports.markRead = async (req, res) => {
  try {
    const convId    = req.params.id
    const isAdmin   = !!req.adminUser

    if (isAdmin) {
      await query(
        `UPDATE messages SET is_read = true, read_at = NOW()
          WHERE conversation_id = $1 AND sender_type != 'admin' AND is_read = false`,
        [convId],
      )
      await query(
        `UPDATE conversations SET unread_admin = 0 WHERE id = $1`,
        [convId],
      )
    } else {
      await query(
        `UPDATE messages SET is_read = true, read_at = NOW()
          WHERE conversation_id = $1 AND sender_type = 'admin' AND is_read = false`,
        [convId],
      )
      await query(
        `UPDATE conversations SET unread_user = 0 WHERE id = $1`,
        [convId],
      )
    }

    const io = socketBus.getIO()
    if (io) {
      io.to(`conv:${convId}`).emit('messages-read', {
        conversationId: convId,
        readBy: isAdmin ? 'admin' : 'user',
      })
    }

    return res.json({ success: true, message: 'Marked as read' })
  } catch (err) {
    handleError(res, err, 'Mark read failed')
  }
}

// ── GET /api/messages/conversations/session/:sessionId (user by session) ──────
exports.getBySession = async (req, res) => {
  try {
    const { sessionId } = req.params
    const { page = 1, limit = 50 } = req.query

    const convRes = await query(
      `SELECT * FROM conversations WHERE session_id = $1`,
      [sessionId],
    )
    if (!convRes.rows[0]) {
      return res.json({ success: true, data: { conversation: null, messages: [] } })
    }
    const conv   = convRes.rows[0]
    const offset = (Number(page) - 1) * Number(limit)

    const msgs = await query(
      `SELECT * FROM messages
        WHERE conversation_id = $1 AND deleted = false
        ORDER BY created_at ASC
        LIMIT $2 OFFSET $3`,
      [conv.id, Number(limit), offset],
    )

    // Mark user-facing messages as read
    await query(
      `UPDATE messages SET is_read = true, read_at = NOW()
        WHERE conversation_id = $1 AND sender_type = 'admin' AND is_read = false`,
      [conv.id],
    )
    await query(
      `UPDATE conversations SET unread_user = 0 WHERE id = $1`,
      [conv.id],
    )

    return res.json({
      success: true,
      data: {
        conversation: serializeConversation(conv),
        messages:     msgs.rows.map(serializeMessage),
      },
    })
  } catch (err) {
    handleError(res, err, 'Get by session failed')
  }
}

// ── DELETE /api/messages/conversations/:id (admin) ────────────────────────────
exports.deleteConversation = async (req, res) => {
  try {
    await query(`DELETE FROM conversations WHERE id = $1`, [req.params.id])
    return res.json({ success: true, message: 'Conversation deleted' })
  } catch (err) {
    handleError(res, err, 'Delete failed')
  }
}

// ── GET /api/messages/stats (admin) ───────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const [total, open, unread, today] = await Promise.all([
      query(`SELECT COUNT(*) AS n FROM conversations`),
      query(`SELECT COUNT(*) AS n FROM conversations WHERE status = 'open'`),
      query(`SELECT SUM(unread_admin) AS n FROM conversations`),
      query(`SELECT COUNT(*) AS n FROM conversations WHERE created_at >= CURRENT_DATE`),
    ])

    return res.json({
      success: true,
      data: {
        total:       parseInt(total.rows[0]?.n    || 0),
        open:        parseInt(open.rows[0]?.n     || 0),
        unreadAdmin: parseInt(unread.rows[0]?.n   || 0),
        today:       parseInt(today.rows[0]?.n    || 0),
      },
    })
  } catch (err) {
    handleError(res, err, 'Stats failed')
  }
}