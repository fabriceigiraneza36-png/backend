const router = require("express").Router();
const ctrl = require("../controllers/galleryController");
const { authenticate, authorize } = require("../middleware/auth");
const upload = require("../middleware/upload");
const asyncHandler = require("../middleware/asyncHandler");
const { cacheMiddleware } = require("../middleware/cache");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Get all gallery items
router.get("/", cacheMiddleware(300), asyncHandler(ctrl.getAll));

// Get gallery categories
router.get("/categories", cacheMiddleware(600), asyncHandler(ctrl.getCategories));

// Get single gallery item
router.get("/:id", cacheMiddleware(300), asyncHandler(ctrl.getOne));

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Create gallery item
router.post(
  "/",
  authenticate,
  authorize("admin"),
  upload.single("image"),
  asyncHandler(ctrl.create)
);

// Bulk create gallery items
router.post(
  "/bulk",
  authenticate,
  authorize("admin"),
  upload.array("images", 20),
  asyncHandler(ctrl.bulkCreate)
);

// Update gallery item
router.put("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.update));

// Delete gallery item
router.delete("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.remove));

module.exports = router;