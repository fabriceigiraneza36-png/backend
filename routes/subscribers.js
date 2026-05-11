const router      = require('express').Router();
const ctrl        = require('../controllers/subscribersController');
const { protect, adminOnly } = require('../middleware/auth');
const { contactLimiter }     = require('../middleware/rateLimiter');
const asyncHandler           = require('../middleware/asyncHandler');

// ── Public ────────────────────────────────────────────────────────────────────

router.post('/',
  contactLimiter,
  asyncHandler(ctrl.subscribe),
);

router.delete('/unsubscribe/:email', asyncHandler(ctrl.unsubscribe));
router.get('/unsubscribe/:email',    asyncHandler(ctrl.unsubscribe));

// ── Admin ─────────────────────────────────────────────────────────────────────

router.get('/',
  protect, adminOnly,
  asyncHandler(ctrl.getAll),
);

router.get('/stats',
  protect, adminOnly,
  asyncHandler(ctrl.getStats),
);

router.post('/resend-welcome/:id',
  protect, adminOnly,
  asyncHandler(ctrl.resendWelcome),
);

router.delete('/:id',
  protect, adminOnly,
  asyncHandler(ctrl.remove),
);

module.exports = router;