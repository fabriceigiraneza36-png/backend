const router = require("express").Router();
const ctrl = require("../controllers/destinationsController");
const { authenticate, authorize } = require("../middleware/auth");
const upload = require("../middleware/upload");
const asyncHandler = require("../middleware/asyncHandler");
const { cacheMiddleware } = require("../middleware/cache");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Get all destinations (with filters, search, pagination)
router.get("/", cacheMiddleware(300), asyncHandler(ctrl.getAll));

// Get featured destinations
router.get("/featured", cacheMiddleware(300), asyncHandler(ctrl.getFeatured));

// Get destination categories
router.get("/categories", cacheMiddleware(600), asyncHandler(ctrl.getCategories));

// Get map data
router.get("/map", cacheMiddleware(300), asyncHandler(ctrl.getMapData));

// Get single destination (by ID or slug)
router.get("/:idOrSlug", cacheMiddleware(300), asyncHandler(ctrl.getOne));

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Create destination
router.post(
  "/",
  authenticate,
  authorize("admin"),
  upload.single("image"),
  asyncHandler(ctrl.create)
);

// Update destination
router.put(
  "/:id",
  authenticate,
  authorize("admin"),
  upload.single("image"),
  asyncHandler(ctrl.update)
);

// Delete destination
router.delete("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.remove));

// ═══════════════════════════════════════════════════
// DESTINATION IMAGES
// ═══════════════════════════════════════════════════

// Get destination images
router.get("/:id/images", asyncHandler(ctrl.getImages));

// Add images to destination
router.post(
  "/:id/images",
  authenticate,
  authorize("admin"),
  upload.array("images", 10),
  asyncHandler(ctrl.addImages)
);

// Remove image
router.delete(
  "/images/:imageId",
  authenticate,
  authorize("admin"),
  asyncHandler(ctrl.removeImage)
);

module.exports = router;