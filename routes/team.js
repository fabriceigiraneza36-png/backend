const router = require("express").Router();
const ctrl = require("../controllers/teamController");
const { authenticate, authorize } = require("../middleware/auth");
const upload = require("../middleware/upload");
const asyncHandler = require("../middleware/asyncHandler");
const { cacheMiddleware } = require("../middleware/cache");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Get all team members
router.get("/", cacheMiddleware(600), asyncHandler(ctrl.getAll));

// Get single team member
router.get("/:id", cacheMiddleware(600), asyncHandler(ctrl.getOne));

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Create team member
router.post(
  "/",
  authenticate,
  authorize("admin"),
  upload.single("image"),
  asyncHandler(ctrl.create)
);

// Update team member
router.put(
  "/:id",
  authenticate,
  authorize("admin"),
  upload.single("image"),
  asyncHandler(ctrl.update)
);

// Delete team member
router.delete("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.remove));

module.exports = router;