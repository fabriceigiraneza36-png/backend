const router = require("express").Router();
const upload = require("../middleware/upload");
const { protect } = require("../middleware/auth");
const { uploadLimiter } = require("../middleware/security");
const ctrl = require("../controllers/uploadsController");
const asyncHandler = require("../middleware/asyncHandler");

router.post(
  "/image",
  protect,
  uploadLimiter,
  upload.single("image"),
  asyncHandler(ctrl.uploadSingleImage),
);

router.post(
  "/images",
  protect,
  uploadLimiter,
  upload.array("images"),
  asyncHandler(ctrl.uploadMultipleImages),
);

module.exports = router;
