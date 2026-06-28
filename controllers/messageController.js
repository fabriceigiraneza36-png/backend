/**
 * messageController.js v2.0
 *
 * Changes vs v1:
 *   - v_conversations view replaced with direct query + LEFT JOIN
 *   - socketBus.getIO() wrapped in try/catch (non-fatal if no socket)
 *   - All async functions have try/catch + consistent error shape
 *   - emailUserReply checks for sendEmail availability before calling
 *   - getBySession marks user-side messages as read correctly
 *   - getStats uses correct column names
 */

'use strict'

const { query }  = require('../config/db')
const logger     = require('../utils/logger')
const socketBus  = require('../utils/socketBus')

/* ── Optional email import ── */
let _sendEmail = null
try {
  const eu = require('../utils/email')
  _sendEmail = typeof eu.sendEmail === 'function' ? eu.sendEmail : null
} catch { /* email module not available */ }

const APP_NAME     = process.env.APP_NAME     || 'Altuvera'
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://altuvera.com'
const IS_DEV       = process.env.NODE_ENV !== 'production'

/* ═══════════════════════════════════════════════════════════════
   SERIALIZERS
═══════════════════════════════════════════════════════════════ */
const safeJSON = (v, fb = {}) => {
  if (!v) return fb
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return fb }
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
  unreadUser:    row.unread_user    || 0,
  unreadAdmin:   row.unread_admin   || 0,
  tags:          Array.isArray(row.tags) ? row.tags : [],
  source:        row.source,
  /* Joined fields */
  userFullName:  row.user_full_name  || row.guest_name  || null,
  userEmail:     row.user_email      || row.guest_email  || null,
  userAvatar:    row.user_avatar     || null,
  adminFullName: row.admin_full_name || null,
  totalMessages: row.total_messages
    ? parseInt(row.total_messages, 10) : undefined,
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
  msgType:        row.msg_type       || 'text',
  attachmentUrl:  row.attachment_url || null,
  isRead:         row.is_read        || false,
  readAt:         row.read_at        || null,
  edited:         row.edited         || false,
  deleted:        row.deleted        || false,
  replyToId:      row.reply_to_id    || null,
  metadata:       safeJSON(row.metadata),
  createdAt:      row.created_at,
})

/* ═══════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════ */
const handleError = (res, err, msg = 'Operation failed', status = 500) => {
  logger.error(`[MessageController] ${msg}:`, err.message)
  return res.status(status).json({
    success: false,
    message: err.message || msg,
    ...(IS_DEV ? { debug: err.stack?.split('\n')[0] } : {}),
  })
}

const emitViaSocket = (fn) => {
  try {
    const io = socketBus.getIO()
    if (io) fn(io)
  } catch (e) {
    logger.warn('[MessageController] Socket emit non-fatal:', e.message)
  }
}

/** Get or create a conversation for a session */
const getOrCreateConversation = async ({
  sessionId, userId, guestName, guestEmail,
  subject, channel, source, ipAddress,
}) => {
  const sid = String(sessionId || '').trim()
  if (!sid) {
    throw Object.assign(new Error('sessionId is required'), { status: 400 })
  }

  /* Try existing */
  const existing = await query(
    `SELECT c.*,
            u.full_name  AS user_full_name,
            u.email      AS user_email,
            u.avatar_url AS user_avatar
       FROM conversations c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.session_id = $1 LIMIT 1`,
    [sid]
  )

  if (existing.rows[0]) {
    /* Update contact info if provided */
    if (userId || guestName || guestEmail) {
      await query(
        `UPDATE conversations SET
            user_id     = COALESCE($1, user_id),
            guest_name  = COALESCE(NULLIF($2,''), guest_name),
            guest_email = COALESCE(NULLIF($3,''), guest_email),
            updated_at  = NOW()
          WHERE session_id = $4`,
        [userId || null, guestName || null, guestEmail || null, sid]
      ).catch(() => {})
    }
    return existing.rows[0]
  }

  /* Create new */
  const inserted = await query(
    `INSERT INTO conversations
        (session_id, user_id, guest_name, guest_email,
         subject, channel, source, ip_address, status, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open','normal')
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
    ]
  )
  return inserted.rows[0]
}

/** Insert a message and update conversation summary */
const saveMessage = async ({
  conversationId, senderType, senderId, senderName,
  senderEmail, senderAvatar, body, msgType, metadata, replyToId,
}) => {
  const text = String(body || '').trim()
  if (!text) {
    throw Object.assign(new Error('Message body required'), { status: 400 })
  }

  const res = await query(
    `INSERT INTO messages
        (conversation_id, sender_type, sender_id, sender_name,
         sender_email, sender_avatar, body, msg_type, metadata,
         reply_to_id, is_read)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)
       RETURNING *`,
    [
      conversationId,
      senderType,
      senderId    || null,
      senderName  || null,
      senderEmail || null,
      senderAvatar|| null,
      text,
      msgType     || 'text',
      JSON.stringify(metadata || {}),
      replyToId   || null,
    ]
  )

  const msg        = res.rows[0]
  const isFromUser = senderType !== 'admin'

  await query(
    `UPDATE conversations SET
        last_message    = $1,
        last_message_at = NOW(),
        first_message   = COALESCE(first_message, $1),
        unread_admin    = CASE WHEN $2 THEN unread_admin + 1 ELSE unread_admin END,
        unread_user     = CASE WHEN $3 THEN unread_user  + 1 ELSE unread_user  END,
        updated_at      = NOW()
      WHERE id = $4`,
    [text, isFromUser, !isFromUser, conversationId]
  ).catch(() => {})

  return msg
}

/** Email user when admin replies (non-fatal) */
const emailUserReply = async (conversation, message) => {
  if (!_sendEmail) return
  const email = conversation.user_email || conversation.guest_email
  if (!email) return

  try {
    /* Check opt-out preference */
    if (conversation.user_id) {
      const pref = await query(
        `SELECT email_on_reply FROM notification_preferences WHERE user_id = $1`,
        [conversation.user_id]
      ).catch(() => ({ rows: [] }))

      if (pref.rows[0]?.email_on_reply === false) return
    }

    await _sendEmail({
      to:      email,
      subject: `New message from ${APP_NAME} Support`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <body style="font-family:Arial,sans-serif;background:#f4f4f5;margin:0;padding:20px;">
          <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;">
            <img
              src="${FRONTEND_URL}/logo.png"
              alt="${APP_NAME}"
              style="height:36px;margin-bottom:20px;"
              onerror="this.style.display='none'"
            />
            <h2 style="color:#059669;margin-top:0;font-family:Georgia,serif;">
              ${APP_NAME} Support
            </h2>
            <p style="color:#374151;">
              Hello ${conversation.user_full_name || conversation.guest_name || 'there'},
            </p>
            <p style="color:#374151;">
              You have a new reply from our support team:
            </p>
            <div style="
              background:#f0fdf4;
              border-left:4px solid #16a34a;
              padding:16px 20px;
              border-radius:8px;
              margin:16px 0;
            ">
              <p style="margin:0;color:#1a1a1a;line-height:1.6;">
                ${message.body}
              </p>
            </div>
            <a
              href="${FRONTEND_URL}/support?session=${conversation.session_id}"
              style="
                display:inline-block;
                background:#16a34a;color:#fff;
                padding:12px 28px;border-radius:40px;
                text-decoration:none;font-weight:600;
                margin-top:8px;
              "
            >
              View Conversation →
            </a>
            <p style="margin-top:32px;font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px;">
              &copy; ${new Date().getFullYear()} ${APP_NAME}.
              You're receiving this because you contacted our support team.
            </p>
          </div>
        </body>
        </html>
      `,
    })
  } catch (err) {
    logger.warn('[MessageController] Email notify failed:', err.message)
  }
}

/* ═══════════════════════════════════════════════════════════════
   CONTROLLERS
═══════════════════════════════════════════════════════════════ */

/**
 * GET /api/messages/conversations (admin)
 */
exports.getConversations = async (req, res) => {
  try {
    const {
      page = 1, limit = 20,
      status, priority, search,
      assigned, sortBy = 'updated_at', order = 'desc',
    } = req.query

    const offset     = (Number(page) - 1) * Number(limit)
    const conditions = ['1=1']
    const params     = []
    let   p          = 1

    if (status)   { conditions.push(`c.status = $${p++}`);   params.push(status)   }
    if (priority) { conditions.push(`c.priority = $${p++}`); params.push(priority) }
    if (assigned === 'true')  conditions.push('c.assigned_admin IS NOT NULL')
    if (assigned === 'false') conditions.push('c.assigned_admin IS NULL')
    if (search) {
      conditions.push(
        `(c.guest_name ILIKE $${p} OR c.guest_email ILIKE $${p}` +
        ` OR u.full_name ILIKE $${p} OR u.email ILIKE $${p}` +
        ` OR c.subject ILIKE $${p} OR c.last_message ILIKE $${p})`
      )
      params.push(`%${search}%`)
      p++
    }

    const where = conditions.join(' AND ')
    const validSort = ['updated_at','created_at','last_message_at','unread_admin']
    const col   = validSort.includes(sortBy) ? sortBy : 'updated_at'
    const dir   = order === 'asc' ? 'ASC' : 'DESC'

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT c.*,
                u.full_name   AS user_full_name,
                u.email       AS user_email,
                u.avatar_url  AS user_avatar,
                (SELECT COUNT(*) FROM messages m
                   WHERE m.conversation_id = c.id
                     AND m.deleted = false
                ) AS total_messages
           FROM conversations c
           LEFT JOIN users u ON u.id = c.user_id
          WHERE ${where}
          ORDER BY c.${col} ${dir}
          LIMIT $${p} OFFSET $${p + 1}`,
        [...params, Number(limit), offset]
      ),
      query(
        `SELECT COUNT(*) AS total
           FROM conversations c
           LEFT JOIN users u ON u.id = c.user_id
          WHERE ${where}`,
        params
      ),
    ])

    const total = parseInt(countRes.rows[0]?.total || 0, 10)

    return res.json({
      success: true,
      data:    dataRes.rows.map(serializeConversation),
      pagination: {
        page:  Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    })
  } catch (err) {
    return handleError(res, err, 'Fetch conversations failed')
  }
}

/**
 * GET /api/messages/conversations/:id (admin)
 */
exports.getConversation = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT c.*,
              u.full_name  AS user_full_name,
              u.email      AS user_email,
              u.avatar_url AS user_avatar
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.id = $1`,
      [req.params.id]
    )

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Conversation not found' })
    }

    return res.json({ success: true, data: serializeConversation(rows[0]) })
  } catch (err) {
    return handleError(res, err, 'Fetch conversation failed')
  }
}

/**
 * GET /api/messages/conversations/:id/messages (admin + user)
 */
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
        [convId, Number(limit), offset]
      ),
      query(
        `SELECT COUNT(*) AS total FROM messages
          WHERE conversation_id = $1 AND deleted = false`,
        [convId]
      ),
    ])

    /* Mark as read if admin is requesting */
    if (req.adminUser) {
      await Promise.all([
        query(
          `UPDATE messages SET is_read = true, read_at = NOW()
            WHERE conversation_id = $1
              AND sender_type != 'admin'
              AND is_read = false`,
          [convId]
        ),
        query(
          `UPDATE conversations SET unread_admin = 0 WHERE id = $1`,
          [convId]
        ),
      ]).catch(() => {})
    }

    return res.json({
      success: true,
      data:    msgs.rows.map(serializeMessage),
      pagination: {
        page:  Number(page),
        limit: Number(limit),
        total: parseInt(count.rows[0]?.total || 0, 10),
      },
    })
  } catch (err) {
    return handleError(res, err, 'Fetch messages failed')
  }
}

/**
 * POST /api/messages/conversations (user — start conversation)
 */
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
      subject:    subject || null,
      channel:    channel || 'live_chat',
      source:     'website',
      ipAddress:  req.ip,
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

    emitViaSocket((io) => {
      io.to('admins').emit('new-conversation-message', {
        conversation: serializeConversation(conv),
        message:      serialized,
        unreadAdmin:  (conv.unread_admin || 0) + 1,
      })
    })

    return res.status(201).json({
      success: true,
      data: {
        conversationId: conv.id,
        sessionId:      conv.session_id,
        message:        serialized,
      },
    })
  } catch (err) {
    return handleError(res, err, 'Start conversation failed')
  }
}

/**
 * POST /api/messages/conversations/:id/reply (user)
 */
exports.userReply = async (req, res) => {
  try {
    const { body: msgBody, metadata, replyToId } = req.body
    const convId = parseInt(req.params.id, 10)

    if (!msgBody?.trim()) {
      return res.status(400).json({ success: false, message: 'Message body required' })
    }

    const convRes = await query(
      'SELECT * FROM conversations WHERE id = $1',
      [convId]
    )
    if (!convRes.rows[0]) {
      return res.status(404).json({ success: false, message: 'Conversation not found' })
    }

    const conv   = convRes.rows[0]
    const userId = req.user?.id || null

    /* Auth check: authenticated user must own the conversation */
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

    emitViaSocket((io) => {
      io.to('admins').emit('new-conversation-message', {
        conversationId: convId,
        sessionId:      conv.session_id,
        message:        serialized,
        senderName:     msg.sender_name,
        unreadAdmin:    (conv.unread_admin || 0) + 1,
      })
      io.to(`conv:${convId}`).emit('msg:message', serialized)
      if (conv.session_id) {
        io.to(`session:${conv.session_id}`).emit('msg:message', serialized)
      }
    })

    return res.status(201).json({ success: true, data: serialized })
  } catch (err) {
    return handleError(res, err, 'User reply failed')
  }
}

/**
 * POST /api/messages/conversations/:id/admin-reply (admin)
 */
exports.adminReply = async (req, res) => {
  try {
    const { body: msgBody, metadata, replyToId } = req.body
    const convId    = parseInt(req.params.id, 10)
    const adminUser = req.adminUser

    if (!msgBody?.trim()) {
      return res.status(400).json({ success: false, message: 'Message body required' })
    }

    if (!adminUser) {
      return res.status(403).json({ success: false, message: 'Admin authentication required' })
    }

    const convRes = await query(
      `SELECT c.*,
              u.full_name  AS user_full_name,
              u.email      AS user_email,
              u.avatar_url AS user_avatar
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.id = $1`,
      [convId]
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
      senderEmail:    adminUser.email     || null,
      senderAvatar:   adminUser.avatar_url || null,
      body:           msgBody,
      metadata,
      replyToId,
    })

    const serialized = serializeMessage(msg)

    emitViaSocket((io) => {
      io.to(`conv:${convId}`).emit('msg:message', serialized)
      if (conv.session_id) {
        io.to(`session:${conv.session_id}`).emit('msg:message', serialized)
      }
    })

    /* Email the user asynchronously — non-blocking */
    emailUserReply(conv, msg).catch(() => {})

    return res.status(201).json({ success: true, data: serialized })
  } catch (err) {
    return handleError(res, err, 'Admin reply failed')
  }
}

/**
 * PATCH /api/messages/conversations/:id/status (admin)
 */
exports.updateConversationStatus = async (req, res) => {
  try {
    const { status, priority, assignedAdmin, tags } = req.body
    const convId = req.params.id

    const fields = []
    const params = []
    let   p      = 1

    if (status   !== undefined) { fields.push(`status = $${p++}`);         params.push(status)        }
    if (priority !== undefined) { fields.push(`priority = $${p++}`);       params.push(priority)      }
    if (assignedAdmin !== undefined) {
      fields.push(`assigned_admin = $${p++}`)
      params.push(assignedAdmin || null)
    }
    if (tags !== undefined)     { fields.push(`tags = $${p++}`);           params.push(tags)          }
    if (status === 'closed')      fields.push('closed_at = NOW()')
    if (status === 'open')        fields.push('closed_at = NULL')

    if (!fields.length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' })
    }

    fields.push('updated_at = NOW()')
    params.push(convId)

    const result = await query(
      `UPDATE conversations SET ${fields.join(', ')} WHERE id = $${p} RETURNING *`,
      params
    )

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Conversation not found' })
    }

    const serialized = serializeConversation(result.rows[0])

    emitViaSocket((io) => {
      io.to('admins').emit('msg:conversation-updated', serialized)
      io.to(`conv:${convId}`).emit('msg:conversation-updated', {
        conversationId: Number(convId),
        status:         result.rows[0].status,
        priority:       result.rows[0].priority,
      })
    })

    return res.json({ success: true, data: serialized })
  } catch (err) {
    return handleError(res, err, 'Update status failed')
  }
}

/**
 * POST /api/messages/conversations/:id/read
 */
exports.markRead = async (req, res) => {
  try {
    const convId  = req.params.id
    const isAdmin = !!req.adminUser

    if (isAdmin) {
      await Promise.all([
        query(
          `UPDATE messages SET is_read = true, read_at = NOW()
            WHERE conversation_id = $1
              AND sender_type != 'admin'
              AND is_read = false`,
          [convId]
        ),
        query(
          `UPDATE conversations SET unread_admin = 0 WHERE id = $1`,
          [convId]
        ),
      ])
    } else {
      await Promise.all([
        query(
          `UPDATE messages SET is_read = true, read_at = NOW()
            WHERE conversation_id = $1
              AND sender_type = 'admin'
              AND is_read = false`,
          [convId]
        ),
        query(
          `UPDATE conversations SET unread_user = 0 WHERE id = $1`,
          [convId]
        ),
      ])
    }

    emitViaSocket((io) => {
      io.to(`conv:${convId}`).emit('msg:read', {
        conversationId: Number(convId),
        readBy: isAdmin ? 'admin' : 'user',
      })
    })

    return res.json({ success: true, message: 'Marked as read' })
  } catch (err) {
    return handleError(res, err, 'Mark read failed')
  }
}

/**
 * GET /api/messages/conversations/session/:sessionId (user by session)
 */
exports.getBySession = async (req, res) => {
  try {
    const { sessionId } = req.params
    const { page = 1, limit = 50 } = req.query

    const convRes = await query(
      'SELECT * FROM conversations WHERE session_id = $1 LIMIT 1',
      [sessionId]
    )

    if (!convRes.rows[0]) {
      return res.json({
        success: true,
        data: { conversation: null, messages: [] },
      })
    }

    const conv   = convRes.rows[0]
    const offset = (Number(page) - 1) * Number(limit)

    const msgs = await query(
      `SELECT * FROM messages
        WHERE conversation_id = $1 AND deleted = false
        ORDER BY created_at ASC
        LIMIT $2 OFFSET $3`,
      [conv.id, Number(limit), offset]
    )

    /* Mark admin messages as read for the user */
    await Promise.all([
      query(
        `UPDATE messages SET is_read = true, read_at = NOW()
          WHERE conversation_id = $1
            AND sender_type = 'admin'
            AND is_read = false`,
        [conv.id]
      ),
      query(
        `UPDATE conversations SET unread_user = 0 WHERE id = $1`,
        [conv.id]
      ),
    ]).catch(() => {})

    return res.json({
      success: true,
      data: {
        conversation: serializeConversation(conv),
        messages:     msgs.rows.map(serializeMessage),
      },
    })
  } catch (err) {
    return handleError(res, err, 'Get by session failed')
  }
}

/**
 * DELETE /api/messages/conversations/:id (admin)
 */
exports.deleteConversation = async (req, res) => {
  try {
    await query(
      'DELETE FROM messages WHERE conversation_id = $1',
      [req.params.id]
    ).catch(() => {})

    const result = await query(
      'DELETE FROM conversations WHERE id = $1 RETURNING id',
      [req.params.id]
    )

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Conversation not found' })
    }

    return res.json({ success: true, message: 'Conversation deleted' })
  } catch (err) {
    return handleError(res, err, 'Delete conversation failed')
  }
}

/**
 * GET /api/messages/stats (admin)
 */
exports.getStats = async (req, res) => {
  try {
    const [total, open, unread, today, urgent] = await Promise.all([
      query('SELECT COUNT(*) AS n FROM conversations'),
      query(`SELECT COUNT(*) AS n FROM conversations WHERE status = 'open'`),
      query('SELECT COALESCE(SUM(unread_admin), 0) AS n FROM conversations'),
      query('SELECT COUNT(*) AS n FROM conversations WHERE created_at >= CURRENT_DATE'),
      query(`SELECT COUNT(*) AS n FROM conversations WHERE priority = 'urgent' AND status = 'open'`),
    ])

    return res.json({
      success: true,
      data: {
        total:       parseInt(total.rows[0]?.n    || 0, 10),
        open:        parseInt(open.rows[0]?.n     || 0, 10),
        unreadAdmin: parseInt(unread.rows[0]?.n   || 0, 10),
        today:       parseInt(today.rows[0]?.n    || 0, 10),
        urgent:      parseInt(urgent.rows[0]?.n   || 0, 10),
      },
    })
  } catch (err) {
    return handleError(res, err, 'Stats failed')
  }
}