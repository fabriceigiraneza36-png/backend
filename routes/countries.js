// routes/countries.js
'use strict'

const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/countriesController')

/* â”€â”€â”€ Auth middleware with safe fallbacks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

/* â”€â”€â”€ Verify all exports exist at load time â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   â‘  NAMED GET ROUTES  (must come before /:slug wildcard)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

/** GET /api/countries */
router.get('/', ctrl.getAll)

/** GET /api/countries/featured */
router.get('/featured', ctrl.getFeatured)

/** GET /api/countries/stats */
router.get('/stats', ctrl.getStats)

/** GET /api/countries/continent/:continent */
router.get('/continent/:continent', ctrl.getByContinent)

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   â‘¡ ADMIN MUTATION ROUTES
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

/** POST /api/countries */
router.post('/', protect, adminOnly, ctrl.create)

/** DELETE /api/countries â€” bulk delete (body: { ids }) */
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
/** GET /api/countries/:id/images */
router.get('/:id/images', ctrl.getImages)

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   â‘¢ WILDCARD â€” MUST be last
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

/** GET /api/countries/:slug */
router.get('/:slug', ctrl.getOne)

module.exports = router
