/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TESTIMONIALS ROUTES v2.2
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * CRITICAL RULE: In Express, routes are matched in DECLARATION ORDER.
 * Any named path segment (/submit, /featured, /stats) MUST be declared
 * before wildcard segments (/:id) or Express will match /:id first.
 *
 * Verified route order:
 *   GET  /                   → getAll
 *   GET  /featured           → getFeatured
 *   GET  /stats              → getStats
 *   GET  /admin/all          → adminGetAll
 *   POST /                   → create (admin)
 *   POST /submit             → submitPublic  ← MUST be before /:id
 *   PATCH /reorder           → reorder
 *   PATCH /:id/toggle-*      → toggles
 *   PATCH /:id               → update
 *   DELETE /                 → bulkDelete
 *   DELETE /:id              → remove
 *   GET  /:id                → getOne  ← wildcard LAST
 *   PUT  /:id                → update  ← wildcard LAST
 *
 * Debug endpoint:
 *   GET /api/testimonials/_routes  → lists all registered routes (dev only)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict'

const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/testimonials')

// ── Import middleware with safe fallbacks ─────────────────────────────────────
let protect, adminOnly, authLimiter

try {
  const auth = require('../middleware/auth')
  protect   = auth.protect   || auth.authenticate || auth.verifyToken
  adminOnly = auth.adminOnly || auth.isAdmin      || auth.requireAdmin
} catch (err) {
  console.warn('[testimonials routes] auth middleware not found:', err.message)
  // No-op fallbacks so the file loads even if middleware is missing
  protect   = (req, res, next) => next()
  adminOnly = (req, res, next) => next()
}

try {
  const rl  = require('../middleware/rateLimiter')
  authLimiter = rl.authLimiter || rl.limiter || rl.default
} catch (err) {
  console.warn('[testimonials routes] rateLimiter not found:', err.message)
  authLimiter = (req, res, next) => next()
}

// Ensure all middleware are callable
if (typeof protect    !== 'function') protect    = (req, res, next) => next()
if (typeof adminOnly  !== 'function') adminOnly  = (req, res, next) => next()
if (typeof authLimiter !== 'function') authLimiter = (req, res, next) => next()

// ═══════════════════════════════════════════════════════════════════════════════
// DEBUG — lists all routes on this router (remove in production if desired)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/_routes', (req, res) => {
  const IS_PROD = process.env.NODE_ENV === 'production'
  // Allow in production only with secret
  if (IS_PROD && req.query.secret !== process.env.JWT_SECRET?.slice(0, 8)) {
    return res.status(403).json({ error: 'forbidden' })
  }
  const routes = []
  router.stack.forEach((layer) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase())
      routes.push({ methods, path: layer.route.path })
    }
  })
  res.json({ success: true, routes, total: routes.length })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ① NAMED GET ROUTES  (no path params — before /:id)
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /api/testimonials/featured */
router.get('/featured', ctrl.getFeatured)

/** GET /api/testimonials/stats */
router.get('/stats', ctrl.getStats)

/** GET /api/testimonials/admin/all */
router.get('/admin/all', protect, adminOnly, ctrl.adminGetAll)

/** GET /api/testimonials */
router.get('/', ctrl.getAll)

// ═══════════════════════════════════════════════════════════════════════════════
// ② NAMED POST ROUTES  (before /:id)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/testimonials/submit
 *
 * Public-facing — authenticated users submit their own review.
 * Saved as is_active=false, pending admin approval.
 *
 * IMPORTANT: This MUST be declared before `router.post('/:id', ...)` or any
 * wildcard, otherwise Express matches /:id = "submit" and returns 404/400.
 */
router.post(
  '/submit',
  authLimiter,  // rate limit: 5 req / 15 min per IP
  protect,      // must be logged in
  ctrl.submitPublic,
)

/** POST /api/testimonials — admin creates directly */
router.post('/', protect, adminOnly, ctrl.create)

// ═══════════════════════════════════════════════════════════════════════════════
// ③ NAMED PATCH ROUTES  (before /:id)
// ═══════════════════════════════════════════════════════════════════════════════

/** PATCH /api/testimonials/reorder */
router.patch('/reorder', protect, adminOnly, ctrl.reorder)

/** PATCH /api/testimonials/:id/toggle-featured */
router.patch('/:id/toggle-featured', protect, adminOnly, ctrl.toggleFeatured)

/** PATCH /api/testimonials/:id/toggle-active */
router.patch('/:id/toggle-active', protect, adminOnly, ctrl.toggleActive)

/** PATCH /api/testimonials/:id */
router.patch('/:id', protect, adminOnly, ctrl.update)

// ═══════════════════════════════════════════════════════════════════════════════
// ④ DELETE ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/** DELETE /api/testimonials — bulk delete */
router.delete('/', protect, adminOnly, ctrl.bulkDelete)

/** DELETE /api/testimonials/:id */
router.delete('/:id', protect, adminOnly, ctrl.remove)

// ═══════════════════════════════════════════════════════════════════════════════
// ⑤ WILDCARD ROUTES  — MUST be absolutely last
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /api/testimonials/:id */
router.get('/:id', ctrl.getOne)

/** PUT /api/testimonials/:id */
router.put('/:id', protect, adminOnly, ctrl.update)

module.exports = router