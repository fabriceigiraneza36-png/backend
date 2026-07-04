// routes/heroSlides.js
// ============================================================
'use strict';

const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/heroSlidesController');
const { protect, adminOnly } = require('../middleware/auth');

/* Public */
router.get('/', ctrl.getAll);

/* Admin */
router.post('/',          protect, adminOnly, ctrl.create);
router.put('/:id',        protect, adminOnly, ctrl.update);
router.delete('/:id',     protect, adminOnly, ctrl.remove);
router.patch('/reorder',  protect, adminOnly, ctrl.reorder);

module.exports = router;