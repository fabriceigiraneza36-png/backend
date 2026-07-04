// backend/routes/notifications.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/notificationsController');
const { protect, adminOnly } = require('../middleware/auth');

// ── USER ──────────────────────────────────────────────────────────────────────
router.get   ('/my',                      protect,    ctrl.getMyNotifications);
router.get   ('/my/unread-count',         protect,    ctrl.getUnreadCount);
router.patch ('/mark-all-read',           protect,    ctrl.markAllRead);
router.delete('/clear-all',              protect,    ctrl.clearAll);
router.patch ('/:id/read',               protect,    ctrl.markRead);
router.patch ('/:id/react',              protect,    ctrl.react);
router.post  ('/:id/reply',              protect,    ctrl.reply);
router.delete('/:id',                    protect,    ctrl.deleteOne);

// ── USER ACTION → ADMIN ───────────────────────────────────────────────────────
router.post  ('/checklist-request',      protect,    ctrl.checklistRequest);

// ── ADMIN ─────────────────────────────────────────────────────────────────────
router.get   ('/admin',                  adminOnly,  ctrl.adminGetAll);
router.get   ('/admin/stats',            adminOnly,  ctrl.adminStats);
router.post  ('/',                       adminOnly,  ctrl.create);
router.post  ('/:id/admin-reply',        adminOnly,  ctrl.adminReply);
router.delete('/:id/admin',             adminOnly,  ctrl.adminDelete);

// Admin special actions
router.post  ('/admin/send-checklist',   adminOnly,  ctrl.adminSendChecklist);
router.post  ('/admin/confirm-payment',  adminOnly,  ctrl.adminConfirmPayment);
router.post  ('/admin/request-payment',  adminOnly,  ctrl.adminRequestPayment);

module.exports = router;