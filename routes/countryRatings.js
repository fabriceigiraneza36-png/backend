/**
 * Country Ratings Routes
 */
const express = require("express");
const router = express.Router();
const countryRatingsController = require("../controllers/countryRatingsController");
const { protect, optionalAuth, adminOnly } = require("../middleware/auth");

// Public routes
router.get("/:countryId/ratings", countryRatingsController.getRatings);
router.get("/:countryId/ratings/stats", countryRatingsController.getRatingStats);
router.get("/:countryId/ratings/:ratingId", countryRatingsController.getRating);
router.get("/:countryId/ratings/user", optionalAuth, countryRatingsController.getUserRating);

// Protected routes
router.post("/:countryId/ratings", protect, countryRatingsController.createOrUpdateRating);
router.delete("/:countryId/ratings/:ratingId", protect, countryRatingsController.deleteRating);

// Admin routes
router.patch("/:countryId/ratings/:ratingId/approve", adminOnly, countryRatingsController.approveRating);

module.exports = router;
