/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TESTIMONIALS ROUTES v2.1
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * CRITICAL FIX: /submit and /admin/all MUST be registered BEFORE /:id
 * because Express matches routes in declaration order.
 * Previously /:id was swallowing GET/POST /submit → 404.
 *
 * Route order (strict):
 *   1. Named GET routes  (no params)
 *   2. Named POST routes (no params) ← /submit here
 *   3. Named PATCH routes
 *   4. Wildcard /:id routes LAST
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict'

const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/testimonials')

const { protect, adminOnly }   = require('../middleware/auth')
const { authLimiter }          = require('../middleware/rateLimiter')

// ── 1. Named GET routes (no path params) — MUST be before /:id ───────────────

router.get('/featured',   ctrl.getFeatured)   // GET /api/testimonials/featured
router.get('/stats',      ctrl.getStats)      // GET /api/testimonials/stats
router.get('/admin/all',  protect, adminOnly, ctrl.adminGetAll) // GET /api/testimonials/admin/all
router.get('/',           ctrl.getAll)        // GET /api/testimonials

// ── 2. Named POST routes — MUST be before /:id ───────────────────────────────

/**
 * POST /api/testimonials/submit
 * Public-facing review form — authenticated users only, pending approval.
 * authLimiter: max 5 requests per 15 min per IP.
 */
router.post('/submit', authLimiter, protect, ctrl.submitPublic)

/**
 * POST /api/testimonials
 * Admin direct-create (active immediately).
 */
router.post('/', protect, adminOnly, ctrl.create)

// ── 3. Named PATCH routes — MUST be before /:id ──────────────────────────────

router.patch('/reorder',             protect, adminOnly, ctrl.reorder)
router.patch('/:id/toggle-featured', protect, adminOnly, ctrl.toggleFeatured)
router.patch('/:id/toggle-active',   protect, adminOnly, ctrl.toggleActive)
router.patch('/:id',                 protect, adminOnly, ctrl.update)

// ── 4. Named DELETE routes ────────────────────────────────────────────────────

router.delete('/',    protect, adminOnly, ctrl.bulkDelete)
router.delete('/:id', protect, adminOnly, ctrl.remove)

// ── 5. Wildcard /:id — MUST be absolutely last ────────────────────────────────

router.get('/:id',  ctrl.getOne)
router.put('/:id',  protect, adminOnly, ctrl.update)

module.exports = router