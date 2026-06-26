// routes/testimonials.js
"use strict";

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/testimonials');
const { protect, adminOnly } = require('../middleware/auth');
const { authLimiter }        = require('../middleware/rateLimiter');

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/featured',   ctrl.getFeatured);
router.get('/stats',      ctrl.getStats);

// ── Admin ─────────────────────────────────────────────────────────────────────
router.get('/admin/all',  protect, adminOnly, ctrl.adminGetAll);

// ── Public paginated list ─────────────────────────────────────────────────────
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);

// ── Authenticated user submit (public-facing form) ────────────────────────────
// Rate-limited + requires login
router.post('/submit', authLimiter, protect, ctrl.submitPublic);

// ── Admin CRUD ────────────────────────────────────────────────────────────────
router.post('/',   protect, adminOnly, ctrl.create);
router.put('/:id', protect, adminOnly, ctrl.update);

router.patch('/reorder',              protect, adminOnly, ctrl.reorder);
router.patch('/:id/toggle-featured',  protect, adminOnly, ctrl.toggleFeatured);
router.patch('/:id/toggle-active',    protect, adminOnly, ctrl.toggleActive);
router.patch('/:id',                  protect, adminOnly, ctrl.update);

router.delete('/',    protect, adminOnly, ctrl.bulkDelete);
router.delete('/:id', protect, adminOnly, ctrl.remove);

module.exports = router;