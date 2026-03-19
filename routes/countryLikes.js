/**
 * Country Likes Routes
 */
const express = require("express");
const router = express.Router();
const countryLikesController = require("../controllers/countryLikesController");
const { protect, admin } = require("../middleware/auth");

// Public routes
router.get("/:countryId/likes", countryLikesController.getLikes);
router.get("/:countryId/likes/check", countryLikesController.checkLike);
router.post("/likes/stats", countryLikesController.getLikeStats);

// Protected routes
router.post("/:countryId/likes", protect, countryLikesController.toggleLike);

module.exports = router;
