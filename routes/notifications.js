/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * NOTIFICATION ROUTES v1.0
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/notificationsController');
const { protect, adminOnly } = require('../middleware/auth');

/* ── USER routes (authenticated) ─────────────────────────────────────────── */
router.get   ('/my',               protect, ctrl.getMyNotifications);
router.get   ('/my/unread-count',  protect, ctrl.getUnreadCount);
router.patch ('/mark-all-read',    protect, ctrl.markAllRead);
router.delete('/clear-all',        protect, ctrl.clearAll);
router.patch ('/:id/read',         protect, ctrl.markRead);
router.patch ('/:id/react',        protect, ctrl.react);
router.post  ('/:id/reply',        protect, ctrl.reply);
router.delete('/:id',              protect, ctrl.deleteOne);

/* ── ADMIN routes ─────────────────────────────────────────────────────────── */
router.get   ('/admin',            adminOnly, ctrl.adminGetAll);
router.get   ('/admin/stats',      adminOnly, ctrl.adminStats);
router.post  ('/',                 adminOnly, ctrl.create);
router.post  ('/:id/admin-reply',  adminOnly, ctrl.adminReply);
router.delete('/:id/admin',        adminOnly, ctrl.adminDelete);

module.exports = router;