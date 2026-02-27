const router = require("express").Router();
const ctrl = require("../controllers/servicesController");
const { authenticate, authorize } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { cacheMiddleware } = require("../middleware/cache");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Get all services
router.get("/", cacheMiddleware(600), asyncHandler(ctrl.getAll));

// Get featured services
router.get("/featured", cacheMiddleware(600), asyncHandler(ctrl.getFeatured));

// Get single service (by ID or slug)
router.get("/:idOrSlug", cacheMiddleware(600), asyncHandler(ctrl.getOne));

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Create service
router.post("/", authenticate, authorize("admin"), asyncHandler(ctrl.create));

// Update service
router.put("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.update));

// Delete service
router.delete("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.remove));

module.exports = router;