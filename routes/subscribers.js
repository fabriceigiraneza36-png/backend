const router = require("express").Router();
const ctrl = require("../controllers/subscribersController");
const { authenticate, authorize } = require("../middleware/auth");
const { contactLimiter } = require("../middleware/rateLimiter");
const asyncHandler = require("../middleware/asyncHandler");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Subscribe to newsletter
router.post("/", contactLimiter, asyncHandler(ctrl.subscribe));

// Unsubscribe from newsletter (DELETE for API, GET for email links)
router.delete("/unsubscribe/:email", asyncHandler(ctrl.unsubscribe));
router.get("/unsubscribe/:email", asyncHandler(ctrl.unsubscribe));

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Get all subscribers
router.get("/", authenticate, authorize("admin"), asyncHandler(ctrl.getAll));

// Delete subscriber
router.delete(
  "/:id",
  authenticate,
  authorize("admin"),
  asyncHandler(ctrl.remove)
);

module.exports = router;