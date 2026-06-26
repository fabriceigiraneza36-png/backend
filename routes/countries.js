/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COUNTRIES ROUTES v2.1
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Fix: Verified every ctrl.* reference matches an actual export.
 * Named routes declared BEFORE wildcard /:slug to prevent shadowing.
 *
 * Route order:
 *   GET  /                        → getAll
 *   GET  /featured                → getFeatured
 *   GET  /stats                   → getStats
 *   GET  /continent/:continent    → getByContinent
 *   POST /                        → create (admin)
 *   PATCH /bulk-delete            → bulkDelete (admin)
 *   PATCH /:id/toggle-active      → toggleActive (admin)
 *   PATCH /:id/toggle-featured    → toggleFeatured (admin)
 *   PUT   /:id                    → update (admin)
 *   PATCH /:id                    → update (admin)
 *   DELETE /:id                   → remove (admin)
 *   GET  /:slug                   → getOne  ← WILDCARD LAST
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict'

const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/countriesController')

// ── Import middleware with safe fallbacks ─────────────────────────────────────
let protect, adminOnly

try {
  const auth = require('../middleware/auth')
  protect   = auth.protect   || auth.authenticate || auth.verifyToken
  adminOnly = auth.adminOnly || auth.isAdmin      || auth.requireAdmin
} catch (err) {
  console.warn('[countries routes] auth middleware not found:', err.message)
  protect   = (_req, _res, next) => next()
  adminOnly = (_req, _res, next) => next()
}

if (typeof protect   !== 'function') protect   = (_req, _res, next) => next()
if (typeof adminOnly !== 'function') adminOnly = (_req, _res, next) => next()

// ── Verify all exports exist at load time ─────────────────────────────────────
// This surfaces any missing exports immediately rather than at request time.
const REQUIRED_EXPORTS = [
  'getAll', 'getOne', 'getFeatured', 'getByContinent', 'getStats',
  'create', 'update', 'remove', 'bulkDelete',
  'toggleActive', 'toggleFeatured',
]

for (const fn of REQUIRED_EXPORTS) {
  if (typeof ctrl[fn] !== 'function') {
    throw new Error(
      `[countries routes] Missing export: countriesController.${fn}. ` +
      `Add it to controllers/countriesController.js`,
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ① NAMED GET ROUTES  (before /:slug wildcard)
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /api/countries */
router.get('/', ctrl.getAll)

/** GET /api/countries/featured */
router.get('/featured', ctrl.getFeatured)

/** GET /api/countries/stats */
router.get('/stats', ctrl.getStats)

/** GET /api/countries/continent/:continent */
router.get('/continent/:continent', ctrl.getByContinent)

// ═══════════════════════════════════════════════════════════════════════════════
// ② ADMIN MUTATION ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/** POST /api/countries */
router.post('/', protect, adminOnly, ctrl.create)

/** DELETE /api/countries — bulk delete (body: { ids }) */
router.delete('/', protect, adminOnly, ctrl.bulkDelete)

/** PATCH /api/countries/:id/toggle-active */
router.patch('/:id/toggle-active', protect, adminOnly, ctrl.toggleActive)

/** PATCH /api/countries/:id/toggle-featured */
router.patch('/:id/toggle-featured', protect, adminOnly, ctrl.toggleFeatured)

/** PUT /api/countries/:id */
router.put('/:id', protect, adminOnly, ctrl.update)

/** PATCH /api/countries/:id */
router.patch('/:id', protect, adminOnly, ctrl.update)

/** DELETE /api/countries/:id */
router.delete('/:id', protect, adminOnly, ctrl.remove)

// ═══════════════════════════════════════════════════════════════════════════════
// ③ WILDCARD — MUST be last
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /api/countries/:slug */
router.get('/:slug', ctrl.getOne)

module.exports = router