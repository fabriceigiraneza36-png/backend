const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/testimonials');
const { protect, adminOnly } = require('../middleware/auth');

router.get('/featured', ctrl.getFeatured);
router.get('/stats', ctrl.getStats);
router.get('/admin/all', protect, adminOnly, ctrl.adminGetAll);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/', protect, adminOnly, ctrl.create);
router.put('/:id', protect, adminOnly, ctrl.update);
router.patch('/reorder', protect, adminOnly, ctrl.reorder);
router.patch('/:id/toggle-featured', protect, adminOnly, ctrl.toggleFeatured);
router.patch('/:id/toggle-active', protect, adminOnly, ctrl.toggleActive);
router.patch('/:id', protect, adminOnly, ctrl.update);
router.delete('/', protect, adminOnly, ctrl.bulkDelete);
router.delete('/:id', protect, adminOnly, ctrl.remove);

module.exports = router;