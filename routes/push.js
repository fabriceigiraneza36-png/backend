// routes/push.js
// ═══════════════════════════════════════════════════════════════════════════════
// Push Notification Routes
// ═══════════════════════════════════════════════════════════════════════════════

'use strict'

const router = require('express').Router()
const ctrl   = require('../controllers/pushController')
const { protect, adminOnly } = require('../middleware/auth')
const asyncHandler = require('../middleware/asyncHandler')

router.post('/subscribe',       protect, adminOnly, asyncHandler(ctrl.subscribe))
router.post('/unsubscribe',     protect, adminOnly, asyncHandler(ctrl.unsubscribe))
router.get('/vapid-public-key', asyncHandler(ctrl.getVapidPublicKey))
router.get('/my-subscriptions', protect, adminOnly, asyncHandler(ctrl.mySubscriptions))
router.post('/test',            protect, adminOnly, asyncHandler(ctrl.test))

module.exports = router
