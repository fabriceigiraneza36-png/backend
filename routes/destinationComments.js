// routes/destinationComments.js
// ═══════════════════════════════════════════════════════════════════════════════
// DESTINATION COMMENTS ROUTES v2.0
// ═══════════════════════════════════════════════════════════════════════════════
// Fixes:
//   • Defensive middleware imports (protect, adminOnly, optionalAuth) with
//     safe fallbacks so a missing export never crashes the router at load time
//   • Load-time verification of every controller method — surfaces missing
//     exports immediately with a clear error message
//   • Admin routes declared BEFORE dynamic /:destinationId routes (critical
//     for Express route matching)
//   • optionalAuth on public GET routes so admins see unapproved comments too
//   • Health-check endpoint for quick diagnostics
// ═══════════════════════════════════════════════════════════════════════════════

'use strict'

const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/destinationCommentsController')

/* ─── Safe middleware imports with fallbacks ──────────────────────────────── */
let protect, adminOnly, optionalAuth

try {
  const auth = require('../middleware/auth')
  protect      = auth.protect      || auth.authenticate  || auth.verifyToken
  adminOnly    = auth.adminOnly    || auth.adminProtect  || auth.requireAdmin || auth.isAdmin
  optionalAuth = auth.optionalAuth || auth.optAuth
} catch (err) {
  console.warn('[destinationComments routes] auth middleware not found:', err.message)
}

// Ultimate fallbacks — never let missing middleware crash route definition
const _pass        = (_req, _res, next) => next()
const _requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ status: 'error', message: 'Authentication required' })
  }
  next()
}

if (typeof protect      !== 'function') protect      = _requireAuth
if (typeof adminOnly    !== 'function') adminOnly    = _requireAuth
if (typeof optionalAuth !== 'function') optionalAuth = _pass

/* ─── Verify all controller exports exist at load time ────────────────────── */
const REQUIRED = [
  'getComments', 'getComment', 'createComment', 'updateComment', 'deleteComment',
  'approveComment', 'getCommentCount',
  'adminGetAllComments', 'adminDeleteComment', 'adminApproveComment',
]

for (const fn of REQUIRED) {
  if (typeof ctrl[fn] !== 'function') {
    throw new Error(
      `[destinationComments routes] Missing export: destinationCommentsController.${fn}. ` +
      `Add it to controllers/destinationCommentsController.js`
    )
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   HEALTH CHECK — helpful for quick diagnostics
═══════════════════════════════════════════════════════════════════════════ */
router.get('/health', (_req, res) =>
  res.json({
    success: true,
    service: 'destination-comments',
    version: '2.0',
    ts:      new Date().toISOString(),
  })
)

/* ═══════════════════════════════════════════════════════════════════════════
   ① ADMIN ROUTES — MUST be declared BEFORE /:destinationId wildcard
   Otherwise Express would try to match "admin" as a destinationId.
═══════════════════════════════════════════════════════════════════════════ */

/** GET /api/destination-comments/admin/all — all comments across all destinations */
router.get('/admin/all', adminOnly, ctrl.adminGetAllComments)

/** DELETE /api/destination-comments/admin/:commentId */
router.delete('/admin/:commentId', adminOnly, ctrl.adminDeleteComment)

/** PATCH /api/destination-comments/admin/:commentId/approve */
router.patch('/admin/:commentId/approve', adminOnly, ctrl.adminApproveComment)

/* ═══════════════════════════════════════════════════════════════════════════
   ② PUBLIC READ ROUTES (optionalAuth so admin can see unapproved too)
═══════════════════════════════════════════════════════════════════════════ */

/** GET /api/destination-comments/:destinationId/comments */
router.get('/:destinationId/comments', optionalAuth, ctrl.getComments)

/** GET /api/destination-comments/:destinationId/comments/count */
router.get('/:destinationId/comments/count', ctrl.getCommentCount)

/** GET /api/destination-comments/:destinationId/comments/:commentId */
router.get('/:destinationId/comments/:commentId', optionalAuth, ctrl.getComment)

/* ═══════════════════════════════════════════════════════════════════════════
   ③ AUTHENTICATED USER MUTATIONS
═══════════════════════════════════════════════════════════════════════════ */

/** POST /api/destination-comments/:destinationId/comments — new comment or reply */
router.post('/:destinationId/comments', protect, ctrl.createComment)

/** PUT /api/destination-comments/:destinationId/comments/:commentId */
router.put('/:destinationId/comments/:commentId', protect, ctrl.updateComment)

/** PATCH /api/destination-comments/:destinationId/comments/:commentId — alias */
router.patch('/:destinationId/comments/:commentId', protect, ctrl.updateComment)

/** DELETE /api/destination-comments/:destinationId/comments/:commentId */
router.delete('/:destinationId/comments/:commentId', protect, ctrl.deleteComment)

/* ═══════════════════════════════════════════════════════════════════════════
   ④ ADMIN SCOPED ROUTE — approve within a specific destination
═══════════════════════════════════════════════════════════════════════════ */

/** PATCH /api/destination-comments/:destinationId/comments/:commentId/approve */
router.patch(
  '/:destinationId/comments/:commentId/approve',
  adminOnly,
  ctrl.approveComment
)

module.exports = router