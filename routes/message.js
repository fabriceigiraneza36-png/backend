// routes/message.js
'use strict'

const express = require('express')
const { query } = require('../config/db')
const logger    = require('../utils/logger')
const msg       = require('../utils/messaging')

/* ── Auth middleware ────────────────────────────────────────────────────────── */
let protect
try {
  const candidates = [
    '../middleware/authMiddleware',
    '../middleware/auth',
    '../middleware/userAuth',
  ]
  for (const p of candidates) {
    try {
      const m = require(p)
      protect = protect || m.protect || m.authenticate || m.verifyToken || m.auth
      if (protect) break
    } catch { /* try next */ }
  }
} catch { /* fall through */ }

if (!protect) {
  const jwt = require('jsonwebtoken')
  protect = (req, res, next) => {
    const raw =
      (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() ||
      req.cookies?.token
    if (!raw) return res.status(401).json({ success: false, message: 'Unauthorized' })
    try { req.user = jwt.verify(raw, process.env.JWT_SECRET); next() }
    catch { return res.status(401).json({ success: false, message: 'Invalid token' }) }
  }
}

const isAdmin = (req) =>
  ['admin', 'manager'].includes(req.user?.role || req.user?.type || '')

const restrictToAdmin = (req, res, next) =>
  isAdmin(req)
    ? next()
    : res.status(403).json({ success: false, message: 'Admin only' })

/** Extract actor identity from JWT user */
const actor = (req) => ({
  userId:  req.user?.id          || null,
  name:    req.user?.full_name   || req.user?.name  || req.user?.email || 'You',
  email:   req.user?.email       || null,
  avatar:  req.user?.avatar_url  || req.user?.avatar || null,
})

const router = express.Router()

/* ══════════════════════════════════════════════════════════════════════════
   GET /conversations
   Admin → all conversations (filterable by status)
   User  → only their own
══════════════════════════════════════════════════════════════════════════ */
router.get('/conversations', protect, async (req, res) => {
  try {
    const admin     = isAdmin(req)
    const userId    = req.user?.id
    const userEmail = req.user?.email || ''
    const status    = req.query.status || null
    const search    = req.query.search || null
    const limit     = Math.min(parseInt(req.query.limit, 10)  || 50,  200)
    const page      = Math.max(parseInt(req.query.page,  10)  || 1,   1)
    const offset    = (page - 1) * limit

    const params = []
    const conds  = ['c.deleted_at IS NULL']
    let   pi     = 1

    if (admin) {
      if (status && status !== 'all') {
        conds.push(`c.status = $${pi++}`)
        params.push(status)
      }
      if (search) {
        conds.push(
          `(c.subject ILIKE $${pi} OR c.guest_name ILIKE $${pi}` +
          ` OR c.guest_email ILIKE $${pi} OR c.booking_number ILIKE $${pi})`,
        )
        params.push(`%${search}%`)
        pi++
      }
    } else {
      // Users only see their own
      conds.push(`(c.user_id = $${pi} OR c.guest_email = $${pi + 1})`)
      params.push(userId, userEmail)
      pi += 2
    }

    const where = conds.join(' AND ')

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT c.*,
                u.full_name  AS user_full_name,
                u.email      AS user_email,
                u.avatar_url AS user_avatar
           FROM conversations c
           LEFT JOIN users u ON u.id = c.user_id
          WHERE ${where}
          ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
          LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limit, offset],
      ),
      query(
        `SELECT COUNT(*)::INT AS total FROM conversations c WHERE ${where}`,
        params,
      ),
    ])

    const total = countRes.rows[0]?.total ?? 0

    return res.json({
      success:     true,
      data:        dataRes.rows.map(msg.serializeConversation),
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    })
  } catch (err) {
    logger.error('[Messages] GET /conversations:', {
      message: err.message,
      code:    err.code,
      detail:  err.detail,
      stack:   err.stack?.slice(0, 400),
    })
    return res.status(500).json({ success: false, message: err.message || 'Server error' })
  }
})

/* ══════════════════════════════════════════════════════════════════════════
   GET /conversations/unread-count
══════════════════════════════════════════════════════════════════════════ */
router.get('/conversations/unread-count', protect, async (req, res) => {
  try {
    const admin     = isAdmin(req)
    const userId    = req.user?.id
    const userEmail = req.user?.email || ''

    if (admin) {
      const { rows } = await query(
        `SELECT COALESCE(SUM(unread_admin),0)::INT AS n
           FROM conversations
          WHERE deleted_at IS NULL AND status != 'closed'`,
      )
      return res.json({ success: true, admin: rows[0]?.n ?? 0, user: 0 })
    }

    const { rows } = await query(
      `SELECT COALESCE(SUM(unread_user),0)::INT AS n
         FROM conversations
        WHERE deleted_at IS NULL
          AND (user_id = $1 OR guest_email = $2)`,
      [userId, userEmail],
    )
    return res.json({ success: true, admin: 0, user: rows[0]?.n ?? 0 })
  } catch (err) {
    logger.error('[Messages] GET unread-count:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

/* ══════════════════════════════════════════════════════════════════════════
   GET /users-list   (admin only — list of users to start a chat with)
══════════════════════════════════════════════════════════════════════════ */
router.get('/users-list', protect, restrictToAdmin, async (req, res) => {
  try {
    const search = req.query.search || ''
    const limit  = Math.min(parseInt(req.query.limit, 10) || 30, 100)

    const params = []
    const conds  = ['is_active = true']
    let pi = 1

    if (search) {
      conds.push(`(full_name ILIKE $${pi} OR email ILIKE $${pi})`)
      params.push(`%${search}%`)
      pi++
    }

    const { rows } = await query(
      `SELECT id, full_name, email, avatar_url, phone, role, created_at
         FROM users
        WHERE ${conds.join(' AND ')}
        ORDER BY full_name ASC
        LIMIT $${pi}`,
      [...params, limit],
    )

    return res.json({
      success: true,
      data:    rows.map(r => ({
        id:        r.id,
        fullName:  r.full_name,
        email:     r.email,
        avatar:    r.avatar_url,
        phone:     r.phone,
        role:      r.role,
        createdAt: r.created_at,
      })),
      total: rows.length,
    })
  } catch (err) {
    logger.error('[Messages] GET users-list:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

/* ══════════════════════════════════════════════════════════════════════════
   GET /conversations/by-booking/:bookingNumber
══════════════════════════════════════════════════════════════════════════ */
router.get('/conversations/by-booking/:bookingNumber', protect, async (req, res) => {
  try {
    const bn = String(req.params.bookingNumber || '').trim().toUpperCase()
    if (!bn) return res.status(400).json({ success: false, message: 'bookingNumber required' })

    const admin = isAdmin(req)
    const { rows } = await query(
      `SELECT c.*,
              u.full_name  AS user_full_name,
              u.email      AS user_email,
              u.avatar_url AS user_avatar
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.booking_number = $1 AND c.deleted_at IS NULL
        LIMIT 1`,
      [bn],
    )

    if (!rows[0]) return res.json({ success: true, data: null })

    if (!admin) {
      const own = rows[0].user_id === req.user?.id || rows[0].guest_email === req.user?.email
      if (!own) return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    const messages = await msg.getMessages(rows[0].id)
    const conv = msg.serializeConversation(rows[0])
    return res.json({
      success: true,
      data:    { ...conv, messages: messages.map(msg.serializeMessage) },
    })
  } catch (err) {
    logger.error('[Messages] GET by-booking:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

/* ══════════════════════════════════════════════════════════════════════════
   GET /conversations/:id
══════════════════════════════════════════════════════════════════════════ */
router.get('/conversations/:id', protect, async (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10)
    const admin = isAdmin(req)

    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' })

    const conv = await msg.findConversationById(id)
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' })

    if (!admin) {
      const own = conv.user_id === req.user?.id || conv.guest_email === req.user?.email
      if (!own) return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    const messages = await msg.getMessages(id)
    const result   = msg.serializeConversation(conv)
    result.messages = messages.map(msg.serializeMessage)

    return res.json({ success: true, data: result })
  } catch (err) {
    logger.error('[Messages] GET /conversations/:id:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

/* ══════════════════════════════════════════════════════════════════════════
   POST /conversations
   Create a new conversation.

   Admin-initiated: body must include { targetUserId } or { guestEmail, guestName }
   User-initiated:  creates own conversation

   body: {
     targetUserId?,   // admin picks a specific user
     guestName?,
     guestEmail?,
     subject?,
     body?,           // optional first message
     bookingNumber?,
     priority?,
     kind?,
   }
══════════════════════════════════════════════════════════════════════════ */
router.post('/conversations', protect, async (req, res) => {
  try {
    const admin = isAdmin(req)
    const a     = actor(req)

    /* ── Resolve target user when admin initiates ── */
    let targetUserId   = null
    let targetUserName = null
    let targetEmail    = null

    if (admin && req.body.targetUserId) {
      const uid = parseInt(req.body.targetUserId, 10)
      if (!isNaN(uid)) {
        const { rows } = await query(
          'SELECT id, full_name, email FROM users WHERE id=$1 LIMIT 1',
          [uid],
        )
        if (rows[0]) {
          targetUserId   = rows[0].id
          targetUserName = rows[0].full_name
          targetEmail    = rows[0].email
        }
      }
    }

    /* ── Resolve booking ── */
    let bookingId = null, bookingNumber = null
    if (req.body.bookingNumber) {
      const bn = String(req.body.bookingNumber).trim().toUpperCase()
      const { rows } = await query(
        `SELECT id, booking_number, full_name, email, user_id
           FROM bookings WHERE booking_number=$1 LIMIT 1`,
        [bn],
      )
      if (rows[0]) {
        bookingId     = rows[0].id
        bookingNumber = rows[0].booking_number
        if (!targetUserId && rows[0].user_id) targetUserId = rows[0].user_id
        if (!targetUserName && rows[0].full_name) targetUserName = rows[0].full_name
        if (!targetEmail && rows[0].email) targetEmail = rows[0].email
      }
    }

    /* ── Determine conversation owner ── */
    const userId     = admin ? (targetUserId || null) : (a.userId || null)
    const guestName  = req.body.guestName  || targetUserName || (admin ? null : a.name)
    const guestEmail = req.body.guestEmail || targetEmail    || (admin ? null : a.email)

    const subject = req.body.subject ||
      (bookingNumber ? `Booking ${bookingNumber}` : 'New conversation')

    /* ── Unique session key ── */
    const sessionParts = [
      admin ? `admin-${a.userId}` : `user-${userId}`,
      userId || guestEmail || Date.now(),
    ]
    const sessionId = req.body.sessionId || sessionParts.join('-')

    const conv = await msg.getOrCreateConversation({
      sessionId,
      userId,
      guestName,
      guestEmail,
      subject,
      status:        'open',
      priority:      req.body.priority || 'normal',
      source:        admin ? 'admin-panel' : 'frontend-auth',
      bookingId,
      bookingNumber,
      adminId:       admin ? a.userId : null,
      metadata:      { kind: req.body.kind || (bookingNumber ? 'booking_request' : 'general') },
    })

    /* ── Optional first message ── */
    let message = null
    const text  = String(req.body.body || '').trim()
    if (text) {
      message = await msg.saveMessage({
        conversationId: conv.id,
        senderType:     admin ? 'admin' : 'user',
        senderId:       a.userId,
        senderName:     a.name,
        senderEmail:    a.email,
        senderAvatar:   a.avatar,
        body:           text,
        metadata:       { kind: req.body.kind || 'general' },
      })

      // Broadcast the first message
      if (message) {
        msg.broadcastMessage({
          conversationId: conv.id,
          sessionId:      conv.session_id,
          userId:         conv.user_id,
          payload:        { ...msg.serializeMessage(message), conversationId: conv.id },
          adminPayload: {
            conversationId: conv.id,
            message:        msg.serializeMessage(message),
            senderName:     a.name,
            senderEmail:    a.email,
          },
        })
      }
    }

    const result = msg.serializeConversation(conv)
    result.messages = message ? [msg.serializeMessage(message)] : []

    return res.status(201).json({ success: true, data: result })
  } catch (err) {
    logger.error('[Messages] POST /conversations:', {
      message: err.message,
      code:    err.code,
      detail:  err.detail,
      stack:   err.stack?.slice(0, 400),
    })
    return res.status(500).json({ success: false, message: err.message || 'Server error' })
  }
})

/* ══════════════════════════════════════════════════════════════════════════
   POST /conversations/:id/messages
══════════════════════════════════════════════════════════════════════════ */
router.post('/conversations/:id/messages', protect, async (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10)
    const admin = isAdmin(req)
    const a     = actor(req)

    const text = String(req.body.body || '').trim()
    if (!text) return res.status(400).json({ success: false, message: 'Message body required' })

    const conv = await msg.findConversationById(id)
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' })

    if (!admin) {
      const own = conv.user_id === req.user?.id || conv.guest_email === req.user?.email
      if (!own) return res.status(403).json({ success: false, message: 'Forbidden' })
      if (conv.status === 'closed') {
        await query(
          `UPDATE conversations SET status='open', updated_at=NOW() WHERE id=$1`,
          [id],
        ).catch(() => {})
      }
    } else if (!conv.assigned_admin) {
      await query(
        `UPDATE conversations SET assigned_admin=$1 WHERE id=$2`,
        [a.userId, id],
      ).catch(() => {})
    }

    const message    = await msg.saveMessage({
      conversationId: conv.id,
      senderType:     admin ? 'admin' : 'user',
      senderId:       a.userId,
      senderName:     a.name,
      senderEmail:    a.email,
      senderAvatar:   a.avatar,
      body:           text,
      metadata:       req.body.metadata || {},
      replyToId:      req.body.replyToId ? parseInt(req.body.replyToId, 10) : null,
    })

    const serialized  = msg.serializeMessage(message)
    const unreadAdmin = await msg.countUnreadAdmin(conv.id)

    msg.broadcastMessage({
      conversationId: conv.id,
      sessionId:      conv.session_id,
      userId:         conv.user_id,
      payload:        { ...serialized, conversationId: conv.id },
      adminPayload: {
        conversationId: conv.id,
        sessionId:      conv.session_id,
        message:        serialized,
        senderName:     a.name,
        senderEmail:    a.email,
        unreadCount:    unreadAdmin,
      },
    })

    // In-app notification for admin when user sends
    if (!admin) {
      try {
        const notifCtrl = require('../controllers/notificationsController')
        notifCtrl.createNotificationInternal?.({
          targetScope: 'admin',
          type:        'message',
          category:    'message',
          title:       '💬 New message from a traveller',
          message:     `${a.name || 'A traveller'}: ${text.slice(0, 120)}`,
          actionUrl:   `/messages?conversation=${conv.id}`,
          actionLabel: 'Open Chat',
          priority:    'normal',
          metadata:    { conversationId: conv.id, bookingNumber: conv.booking_number },
        }).catch(() => {})
      } catch { /* optional */ }
    }

    return res.status(201).json({ success: true, data: serialized })
  } catch (err) {
    logger.error('[Messages] POST message:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

/* ══════════════════════════════════════════════════════════════════════════
   PATCH /conversations/:id/read
══════════════════════════════════════════════════════════════════════════ */
router.patch('/conversations/:id/read', protect, async (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10)
    const admin = isAdmin(req)

    const conv = await msg.findConversationById(id)
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' })

    if (!admin) {
      const own = conv.user_id === req.user?.id || conv.guest_email === req.user?.email
      if (!own) return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    await msg.markReadForRecipient(id, admin ? 'admin' : 'user')

    const io = msg.getIO()
    if (io) {
      io.to(`conv:${id}`).emit('msg:read', {
        conversationId: id,
        readBy:         admin ? 'admin' : 'user',
      })
    }

    return res.json({ success: true, message: 'Marked as read' })
  } catch (err) {
    logger.error('[Messages] PATCH read:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

/* ══════════════════════════════════════════════════════════════════════════
   PATCH /conversations/:id/status   (admin only)
══════════════════════════════════════════════════════════════════════════ */
router.patch('/conversations/:id/status', protect, restrictToAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status, priority, assignedAdmin } = req.body

    const fields = []
    const params = []
    let p = 1

    if (status)        { fields.push(`status = $${p++}`);   params.push(status) }
    if (priority)      { fields.push(`priority = $${p++}`); params.push(priority) }
    if (assignedAdmin !== undefined) {
      fields.push(`assigned_admin = $${p++}`)
      params.push(assignedAdmin === null ? null : parseInt(assignedAdmin, 10))
    }
    if (status === 'closed') fields.push('closed_at = NOW()')
    fields.push('updated_at = NOW()')
    params.push(id)

    const { rows } = await query(
      `UPDATE conversations SET ${fields.join(', ')} WHERE id = $${p} RETURNING *`,
      params,
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Conversation not found' })

    msg.broadcastConversationUpdate(rows[0])

    return res.json({ success: true, data: msg.serializeConversation(rows[0]) })
  } catch (err) {
    logger.error('[Messages] PATCH status:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

/* ══════════════════════════════════════════════════════════════════════════
   PATCH /conversations/:id/messages/:msgId/react
══════════════════════════════════════════════════════════════════════════ */
router.patch('/conversations/:id/messages/:msgId/react', protect, async (req, res) => {
  try {
    const convId  = parseInt(req.params.id, 10)
    const msgId   = parseInt(req.params.msgId, 10)
    const admin   = isAdmin(req)
    const emoji   = String(req.body.emoji || '').trim()
    if (!emoji) return res.status(400).json({ success: false, message: 'emoji required' })

    const conv = await msg.findConversationById(convId)
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' })
    if (!admin) {
      const own = conv.user_id === req.user?.id || conv.guest_email === req.user?.email
      if (!own) return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    const message = await msg.addReaction(convId, msgId, emoji, req.user?.id || 0)
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' })

    const serialized = msg.serializeMessage(message)
    const io = msg.getIO()
    if (io) {
      io.to(`conv:${convId}`).emit('msg:reaction', {
        conversationId: convId,
        messageId:      msgId,
        reactions:      serialized.reactions,
        reactedBy:      admin ? 'admin' : 'user',
        emoji,
      })
    }

    return res.json({ success: true, data: serialized })
  } catch (err) {
    logger.error('[Messages] PATCH react:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

/* ══════════════════════════════════════════════════════════════════════════
   DELETE /conversations/:id   (soft delete, admin only)
══════════════════════════════════════════════════════════════════════════ */
router.delete('/conversations/:id', protect, restrictToAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    await query(
      `UPDATE conversations
         SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW()
       WHERE id = $2`,
      [req.user?.id, id],
    )
    return res.json({ success: true, message: 'Conversation removed' })
  } catch (err) {
    logger.error('[Messages] DELETE:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router