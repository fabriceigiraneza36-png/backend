const router = require("express").Router();
const ctrl = require("../controllers/pagesController");
const { authenticate, authorize } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { cacheMiddleware } = require("../middleware/cache");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Get page by slug
router.get("/:slug", cacheMiddleware(600), asyncHandler(ctrl.getBySlug));

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Get all pages
router.get("/", authenticate, authorize("admin"), asyncHandler(ctrl.getAll));

// Create page
router.post("/", authenticate, authorize("admin"), asyncHandler(ctrl.create));

// Update page
router.put("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.update));

// Delete page
router.delete("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.remove));

module.exports = router;