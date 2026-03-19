/**
 * Destination Ratings Routes
 */
const express = require("express");
const router = express.Router();
const destinationRatingsController = require("../controllers/destinationRatingsController");
const { protect, admin } = require("../middleware/auth");

// Public routes
router.get("/:destinationId/ratings", destinationRatingsController.getRatings);
router.get("/:destinationId/ratings/stats", destinationRatingsController.getRatingStats);
router.get("/:destinationId/ratings/:ratingId", destinationRatingsController.getRating);
router.get("/:destinationId/ratings/user", destinationRatingsController.getUserRating);

// Protected routes
router.post("/:destinationId/ratings", protect, destinationRatingsController.createOrUpdateRating);
router.delete("/:destinationId/ratings/:ratingId", protect, destinationRatingsController.deleteRating);

// Admin routes
router.patch("/:destinationId/ratings/:ratingId/approve", admin, destinationRatingsController.approveRating);

module.exports = router;
