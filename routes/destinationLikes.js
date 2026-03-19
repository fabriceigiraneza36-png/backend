/**
 * Destination Likes Routes
 */
const express = require("express");
const router = express.Router();
const destinationLikesController = require("../controllers/destinationLikesController");
const { protect, admin } = require("../middleware/auth");

// Public routes
router.get("/:destinationId/likes", destinationLikesController.getLikes);
router.get("/:destinationId/likes/check", destinationLikesController.checkLike);
router.post("/likes/stats", destinationLikesController.getLikeStats);

// Protected routes
router.post("/:destinationId/likes", protect, destinationLikesController.toggleLike);

module.exports = router;
