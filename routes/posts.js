const router = require("express").Router();
const ctrl = require("../controllers/postsController");
const { authenticate, authorize } = require("../middleware/auth");
const upload = require("../middleware/upload");
const asyncHandler = require("../middleware/asyncHandler");
const { cacheMiddleware } = require("../middleware/cache");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Get all posts (with filters, search, pagination)
router.get("/", cacheMiddleware(300), asyncHandler(ctrl.getAll));

// Get featured posts
router.get("/featured", cacheMiddleware(300), asyncHandler(ctrl.getFeatured));

// Get post categories
router.get("/categories", cacheMiddleware(600), asyncHandler(ctrl.getCategories));

// Get single post by slug
router.get("/:slug", cacheMiddleware(300), asyncHandler(ctrl.getBySlug));

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Create post
router.post(
  "/",
  authenticate,
  authorize("admin"),
  upload.single("image"),
  asyncHandler(ctrl.create)
);

// Update post
router.put(
  "/:id",
  authenticate,
  authorize("admin"),
  upload.single("image"),
  asyncHandler(ctrl.update)
);

// Delete post
router.delete("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.remove));

module.exports = router;