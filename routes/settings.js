const router = require("express").Router();
const ctrl = require("../controllers/settingsController");
const { authenticate, authorize } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { cacheMiddleware } = require("../middleware/cache");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Get all settings
router.get("/", cacheMiddleware(600), asyncHandler(ctrl.getAll));

// Get single setting by key
router.get("/:key", cacheMiddleware(600), asyncHandler(ctrl.getOne));

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Update all settings
router.put("/", authenticate, authorize("admin"), asyncHandler(ctrl.updateAll));

// Update single setting
router.put("/:key", authenticate, authorize("admin"), asyncHandler(ctrl.updateOne));

module.exports = router;