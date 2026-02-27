const router = require("express").Router();
const ctrl = require("../controllers/countriesController");
const { authenticate, authorize } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const upload = require("../middleware/upload");
const { cacheMiddleware } = require("../middleware/cache");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Get all countries (cached)
router.get("/", cacheMiddleware(300), asyncHandler(ctrl.getAll));

// Get featured countries
router.get("/featured", cacheMiddleware(300), asyncHandler(ctrl.getFeatured));

// Get single country
router.get("/:id", cacheMiddleware(300), asyncHandler(ctrl.getOne));

// Get destinations by country
router.get("/:id/destinations", cacheMiddleware(300), asyncHandler(ctrl.getDestinations));

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Create country
router.post(
  "/",
  authenticate,
  authorize("admin"),
  upload.single("image"),
  asyncHandler(ctrl.create)
);

// Update country
router.put(
  "/:id",
  authenticate,
  authorize("admin"),
  upload.single("image"),
  asyncHandler(ctrl.update)
);

// Delete country
router.delete("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.remove));

module.exports = router;