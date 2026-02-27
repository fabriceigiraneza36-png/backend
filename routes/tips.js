const router = require("express").Router();
const ctrl = require("../controllers/tipsController");
const { authenticate, authorize } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { cacheMiddleware } = require("../middleware/cache");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Get all tips
router.get("/", cacheMiddleware(600), asyncHandler(ctrl.getAll));

// Get tip categories
router.get("/categories", cacheMiddleware(600), asyncHandler(ctrl.getCategories));

// Get single tip
router.get("/:id", cacheMiddleware(600), asyncHandler(ctrl.getOne));

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Create tip
router.post("/", authenticate, authorize("admin"), asyncHandler(ctrl.create));

// Update tip
router.put("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.update));

// Delete tip
router.delete("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.remove));

module.exports = router;