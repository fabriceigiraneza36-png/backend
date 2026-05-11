// routes/message.js
// ═══════════════════════════════════════════════════════════════════════════
const router      = require('express').Router()
const ctrl        = require('../controllers/messageController')
const { protect, adminProtect } = require('../middleware/auth')

// ── Middleware to attach adminUser from token ────────────────────────────────
const optionalAdmin = (req, res, next) => {
  // If request has admin auth header, try to verify
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (!token) return next()
  try {
    const jwt     = require('jsonwebtoken')
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (decoded.type === 'admin') {
      req.adminUser = decoded
    }
  } catch { /* non-admin token */ }
  next()
}

// ─── USER-FACING ────────────────────────────────────────────────────────────

// Start a new conversation (public — guest or logged-in user)
// POST /api/messages/start
router.post('/start', protect, ctrl.startConversation)
router.post('/start-guest', ctrl.startConversation) // no auth required for guests

// User sends a follow-up message in existing conversation
// POST /api/messages/conversations/:id/reply
router.post('/conversations/:id/reply', optionalAdmin, ctrl.userReply)

// User fetches their conversation by session
// GET /api/messages/session/:sessionId
router.get('/session/:sessionId', ctrl.getBySession)

// User marks admin messages as read
// POST /api/messages/conversations/:id/read
router.post('/conversations/:id/read', optionalAdmin, ctrl.markRead)

// ─── ADMIN-FACING ────────────────────────────────────────────────────────────

// Get all conversations with filters
// GET /api/messages/conversations
router.get('/conversations', adminProtect, ctrl.getConversations)

// Get single conversation
// GET /api/messages/conversations/:id
router.get('/conversations/:id', adminProtect, ctrl.getConversation)

// Get messages in a conversation
// GET /api/messages/conversations/:id/messages
router.get('/conversations/:id/messages',
  (req, res, next) => {
    // Works for both admin and user — attach adminUser flag
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
    if (token) {
      try {
        const jwt     = require('jsonwebtoken')
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        if (decoded.type === 'admin') req.adminUser = decoded
      } catch {}
    }
    next()
  },
  ctrl.getMessages,
)

// Admin sends reply
// POST /api/messages/conversations/:id/admin-reply
router.post('/conversations/:id/admin-reply', adminProtect, ctrl.adminReply)

// Update status / priority / assignment
// PATCH /api/messages/conversations/:id/status
router.patch('/conversations/:id/status', adminProtect, ctrl.updateConversationStatus)

// Admin marks conversation as read
// POST /api/messages/conversations/:id/admin-read
router.post('/conversations/:id/admin-read',
  adminProtect,
  (req, res, next) => { req.adminUser = req.admin; next() },
  ctrl.markRead,
)

// Delete conversation
// DELETE /api/messages/conversations/:id
router.delete('/conversations/:id', adminProtect, ctrl.deleteConversation)

// Stats
// GET /api/messages/stats
router.get('/stats', adminProtect, ctrl.getStats)

module.exports = router