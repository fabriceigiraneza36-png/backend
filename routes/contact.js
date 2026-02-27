const router = require("express").Router();
const ctrl = require("../controllers/contactController");
const { authenticate, authorize } = require("../middleware/auth");
const { contactLimiter } = require("../middleware/rateLimiter");
const asyncHandler = require("../middleware/asyncHandler");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Submit contact form
router.post("/", contactLimiter, asyncHandler(ctrl.create));

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Get all contact messages
router.get("/", authenticate, authorize("admin"), asyncHandler(ctrl.getAll));

// Get single message
router.get("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.getOne));

// Mark as read
router.patch("/:id/read", authenticate, authorize("admin"), asyncHandler(ctrl.markRead));

// Delete message
router.delete("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.remove));

module.exports = router;