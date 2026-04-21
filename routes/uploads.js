const router = require("express").Router();
const upload = require("../middleware/upload");
const { protect } = require("../middleware/auth");
const { uploadLimiter } = require("../middleware/security");
const ctrl = require("../controllers/uploadsController");
const asyncHandler = require("../middleware/asyncHandler");

// Single image upload
router.post(
  "/image",
  protect,
  uploadLimiter,
  upload.single("image"),
  asyncHandler(ctrl.uploadSingleImage),
);

// Multiple images upload
router.post(
  "/images",
  protect,
  uploadLimiter,
  upload.array("images"),
  asyncHandler(ctrl.uploadMultipleImages),
);

// Upload with custom folder
router.post(
  "/image/:folder",
  protect,
  uploadLimiter,
  upload.single("image"),
  asyncHandler(ctrl.uploadSingleImage),
);

// Delete uploaded asset
router.delete(
  "/asset/:publicId",
  protect,
  asyncHandler(ctrl.deleteAsset),
);

// Get upload stats
router.get(
  "/stats",
  protect,
  asyncHandler(ctrl.getUploadStats),
);

module.exports = router;
