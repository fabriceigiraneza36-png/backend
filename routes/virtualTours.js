// routes/virtualTours.js

const router       = require("express").Router();
const ctrl         = require("../controllers/virtualToursController");
const { authenticate, authorize } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { cacheMiddleware }         = require("../middleware/cache");
const upload = require("../middleware/upload");

const virtualTourUpload = upload.fields([
  { name: "video", maxCount: 1 },
  { name: "thumbnail", maxCount: 1 },
  { name: "panorama", maxCount: 1 },
]);

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES (cached)
// ═══════════════════════════════════════════════════
router.get(
  "/",
  cacheMiddleware(300),
  asyncHandler(ctrl.getAll)
);

router.get(
  "/featured",
  cacheMiddleware(300),
  asyncHandler(ctrl.getFeatured)
);

router.get(
  "/stats",
  authenticate,
  authorize("admin"),
  asyncHandler(ctrl.getStats)
);

router.get(
  "/:idOrSlug",
  cacheMiddleware(120),
  asyncHandler(ctrl.getOne)
);

// ═══════════════════════════════════════════════════
// ADMIN ROUTES (authenticated + authorized)
// ═══════════════════════════════════════════════════
router.post(
  "/",
  authenticate,
  authorize("admin"),
  virtualTourUpload,
  asyncHandler(ctrl.create)
);

router.put(
  "/reorder",
  authenticate,
  authorize("admin"),
  asyncHandler(ctrl.reorder)
);

router.put(
  "/:id",
  authenticate,
  authorize("admin"),
  virtualTourUpload,
  asyncHandler(ctrl.update)
);

router.patch(
  "/:id/toggle",
  authenticate,
  authorize("admin"),
  asyncHandler(ctrl.toggleStatus)
);

router.delete(
  "/:id",
  authenticate,
  authorize("admin"),
  asyncHandler(ctrl.remove)
);

module.exports = router;
