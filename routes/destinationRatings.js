/**
 * Destination Ratings Routes
 *
 * A rating is a one-time vote per authenticated account and destination.
 */
const express = require("express");
const router = express.Router();
const destinationRatingsController = require("../controllers/destinationRatingsController");
const { protect, optionalAuth, adminOnly } = require("../middleware/auth");

// Admin overview must be explicitly authenticated and authorized.
router.get("/admin/all", protect, adminOnly, destinationRatingsController.getAllRatingsAdmin);

// Public reads
router.get("/:destinationId/ratings", destinationRatingsController.getRatings);
router.get("/:destinationId/ratings/stats", destinationRatingsController.getRatingStats);

// Keep this route before /:ratingId so "user" is not parsed as a rating ID.
router.get("/:destinationId/ratings/user", optionalAuth, destinationRatingsController.getUserRating);
router.get("/:destinationId/ratings/:ratingId", destinationRatingsController.getRating);

// Only signed-in users can submit. The API rejects repeat submissions with HTTP 409.
router.post("/:destinationId/ratings", protect, destinationRatingsController.createOrUpdateRating);

// Rating deletion/moderation is restricted to admins by middleware and controller.
router.delete("/:destinationId/ratings/:ratingId", protect, adminOnly, destinationRatingsController.deleteRating);
router.patch("/:destinationId/ratings/:ratingId/approve", protect, adminOnly, destinationRatingsController.approveRating);

module.exports = router;
