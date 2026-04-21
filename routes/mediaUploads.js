/**
 * Image Upload Routes
 * Handles all image uploads for destinations, gallery, and countries
 */

const router = require("express").Router();
const upload = require("../middleware/upload");
const { protect, adminOnly } = require("../middleware/auth");
const { uploadLimiter } = require("../middleware/security");
const ctrl = require("../controllers/imageUploadsController");
const asyncHandler = require("../middleware/asyncHandler");

// ==========================================
// DESTINATION IMAGE ROUTES
// ==========================================

/**
 * Upload images for a destination
 * POST /api/media/destinations/:id/images
 */
router.post(
  "/destinations/:id/images",
  protect,
  adminOnly,
  uploadLimiter,
  upload.array("images", 10),
  asyncHandler(ctrl.uploadDestinationImages)
);

/**
 * Delete a destination image
 * DELETE /api/media/destinations/:id/images/:imageId
 */
router.delete(
  "/destinations/:id/images/:imageId",
  protect,
  adminOnly,
  asyncHandler(ctrl.deleteDestinationImage)
);

/**
 * Reorder destination images
 * PUT /api/media/destinations/:id/images/reorder
 */
router.put(
  "/destinations/:id/images/reorder",
  protect,
  adminOnly,
  asyncHandler(ctrl.reorderDestinationImages)
);

// ==========================================
// GALLERY IMAGE ROUTES
// ==========================================

/**
 * Upload images to gallery
 * POST /api/media/gallery/upload
 */
router.post(
  "/gallery/upload",
  protect,
  adminOnly,
  uploadLimiter,
  upload.array("images", 20),
  asyncHandler(ctrl.uploadGalleryImages)
);

/**
 * Delete gallery image
 * DELETE /api/media/gallery/:id
 */
router.delete(
  "/gallery/:id",
  protect,
  adminOnly,
  asyncHandler(ctrl.deleteGalleryImage)
);

// ==========================================
// COUNTRY IMAGE ROUTES
// ==========================================

/**
 * Upload flag for a country (must be first image)
 * POST /api/media/countries/:id/flag
 */
router.post(
  "/countries/:id/flag",
  protect,
  adminOnly,
  uploadLimiter,
  upload.single("flag"),
  asyncHandler(ctrl.uploadCountryFlag)
);

/**
 * Upload additional images for a country
 * POST /api/media/countries/:id/images
 */
router.post(
  "/countries/:id/images",
  protect,
  adminOnly,
  uploadLimiter,
  upload.array("images", 10),
  asyncHandler(ctrl.uploadCountryImages)
);

/**
 * Delete country image
 * DELETE /api/media/countries/:id/images/:imageUrl
 */
router.delete(
  "/countries/:id/images/:imageUrl",
  protect,
  adminOnly,
  asyncHandler(ctrl.deleteCountryImage)
);

module.exports = router;
