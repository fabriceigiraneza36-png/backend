const router = require("express").Router();
const ctrl = require("../controllers/faqsController");
const { authenticate, authorize } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { cacheMiddleware } = require("../middleware/cache");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Get all FAQs
router.get("/", cacheMiddleware(600), asyncHandler(ctrl.getAll));

// Get FAQ categories
router.get("/categories", cacheMiddleware(600), asyncHandler(ctrl.getCategories));

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Create FAQ
router.post("/", authenticate, authorize("admin"), asyncHandler(ctrl.create));

// Update FAQ
router.put("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.update));

// Delete FAQ
router.delete("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.remove));

module.exports = router;