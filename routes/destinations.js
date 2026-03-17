// routes/destinationsRoutes.js
const express = require("express");
const router = express.Router();
const destinationsController = require("../controllers/destinationsController");

// Optional middlewares
// const { protect, adminOnly } = require("../middlewares/auth");
// const upload = require("../middlewares/upload");

/* ============================================================================
   PUBLIC ROUTES
   ============================================================================ */

router.get("/", destinationsController.getAll);
router.get("/featured", destinationsController.getFeatured);
router.get("/popular", destinationsController.getPopular);
router.get("/new", destinationsController.getNew);
router.get("/categories", destinationsController.getCategories);
router.get("/difficulties", destinationsController.getDifficulties);
router.get("/map", destinationsController.getMapData);
router.get("/suggestions", destinationsController.getSuggestions);
router.get("/tags", destinationsController.getTags);
router.get("/stats", destinationsController.getStats);

router.get("/:idOrSlug", destinationsController.getOne);
router.get("/:idOrSlug/related", destinationsController.getRelated);

router.get("/:id/reviews", destinationsController.getReviews);
router.post("/:id/reviews", destinationsController.addReview);
router.post("/:id/reviews/:reviewId/helpful", destinationsController.markReviewHelpful);

router.get("/:id/images", destinationsController.getImages);
router.get("/:id/itinerary", destinationsController.getItinerary);
router.get("/:id/pricing", destinationsController.getPricing);
router.get("/:id/faqs", destinationsController.getFaqs);
router.get("/:id/tags", destinationsController.getDestinationTags);
router.get("/:id/inclusions", destinationsController.getInclusions);
router.get("/:id/exclusions", destinationsController.getExclusions);
router.get("/:id/seasons", destinationsController.getSeasons);

router.post("/:id/view", destinationsController.incrementView);
router.post("/:id/wishlist", destinationsController.incrementWishlist);
router.post("/:id/share", destinationsController.incrementShare);
router.post("/:id/book", destinationsController.incrementBooking);

/* ============================================================================
   ADMIN / CMS ROUTES
   ============================================================================ */

// router.post("/", protect, adminOnly, upload.single("image"), destinationsController.create);
router.post("/", destinationsController.create);

// router.put("/:id", protect, adminOnly, upload.single("image"), destinationsController.update);
router.put("/:id", destinationsController.update);

router.delete("/:id", destinationsController.remove);
router.post("/:id/restore", destinationsController.restore);
router.patch("/bulk", destinationsController.bulkUpdate);

// Images
// router.post("/:id/images", protect, adminOnly, upload.array("images", 20), destinationsController.addImages);
router.post("/:id/images", destinationsController.addImages);
router.put("/:id/images/:imageId", destinationsController.updateImage);
router.delete("/:id/images/:imageId", destinationsController.removeImage);
router.put("/:id/images/reorder", destinationsController.reorderImages);

// Itinerary
router.post("/:id/itinerary", destinationsController.addItineraryDay);
router.put("/:id/itinerary/:dayId", destinationsController.updateItineraryDay);
router.delete("/:id/itinerary/:dayId", destinationsController.removeItineraryDay);

// Pricing
router.post("/:id/pricing", destinationsController.addPricing);

// FAQs
router.post("/:id/faqs", destinationsController.addFaq);

// Tags
router.post("/:id/tags", destinationsController.addDestinationTag);
router.delete("/:id/tags/:tagId", destinationsController.removeDestinationTag);

// Inclusions / Exclusions
router.post("/:id/inclusions", destinationsController.addInclusion);
router.delete("/:id/inclusions/:inclusionId", destinationsController.removeInclusion);
router.post("/:id/exclusions", destinationsController.addExclusion);
router.delete("/:id/exclusions/:exclusionId", destinationsController.removeExclusion);

// Seasons
router.post("/:id/seasons", destinationsController.addSeason);
router.delete("/:id/seasons/:seasonId", destinationsController.removeSeason);

module.exports = router;