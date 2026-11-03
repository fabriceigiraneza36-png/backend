// routes/push.js
// ═══════════════════════════════════════════════════════════════════════════════
// Push Notification Routes
// ═══════════════════════════════════════════════════════════════════════════════

'use strict'

const router = require('express').Router()
const ctrl   = require('../controllers/pushController')
const { protect, adminOnly } = require('../middleware/auth')
const asyncHandler = require('../middleware/asyncHandler')

router.post('/subscribe',       protect, asyncHandler(ctrl.subscribe))
router.post('/unsubscribe',     protect, asyncHandler(ctrl.unsubscribe))
router.get('/vapid-public-key', asyncHandler(ctrl.getVapidPublicKey))
router.get('/user-delivery-status', asyncHandler(ctrl.userDeliveryStatus))
router.get('/user-delivery-settings', protect, adminOnly, asyncHandler(ctrl.getUserDeliverySettings))
router.patch('/user-delivery-settings', protect, adminOnly, asyncHandler(ctrl.updateUserDeliverySettings))
router.get('/my-subscriptions', protect, asyncHandler(ctrl.mySubscriptions))
router.post('/test-receipt',   asyncHandler(ctrl.testReceipt))
router.post('/test',            protect, adminOnly, asyncHandler(ctrl.test))
router.get('/test/:testId',      protect, adminOnly, asyncHandler(ctrl.testStatus))

module.exports = router
