// routes/destinations.js
// ============================================================
// Destinations Routes — Clean Implementation
// ============================================================

const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/destinationsController");
const { protect, adminOnly } = require("../middleware/auth");
const upload = require("../middleware/upload");

/* ═══════════════════════════════════════════════════════════════
   PUBLIC ROUTES
   ═══════════════════════════════════════════════════════════════ */

// List & Filter
router.get("/", ctrl.getAll);
router.get("/featured", ctrl.getFeatured);
router.get("/popular", ctrl.getPopular);
router.get("/new", ctrl.getNew);
router.get("/search", ctrl.search);
router.get("/suggestions", ctrl.getSuggestions);

// Metadata
router.get("/categories", ctrl.getCategories);
router.get("/difficulties", ctrl.getDifficulties);
router.get("/tags", ctrl.getTags);
router.get("/stats", ctrl.getStats);
router.get("/map", ctrl.getMapData);

// By Country
router.get("/country/:countrySlug", ctrl.getByCountry);

// Single Destination
router.get("/:idOrSlug", ctrl.getOne);
router.get("/:idOrSlug/related", ctrl.getRelated);

// Reviews (Public Read)
router.get("/:id/reviews", ctrl.getReviews);

// Images (Public Read)
router.get("/:id/images", ctrl.getImages);

// Itinerary (Public Read)
router.get("/:id/itinerary", ctrl.getItinerary);

// FAQs (Public Read)
router.get("/:id/faqs", ctrl.getFaqs);

// Tags (Public Read)
router.get("/:id/tags", ctrl.getDestinationTags);

// Engagement (Public)
router.post("/:id/view", ctrl.incrementView);
router.post("/:id/wishlist", ctrl.incrementWishlist);
router.post("/:id/share", ctrl.incrementShare);

// Reviews (Public Write)
router.post("/:id/reviews", upload.array("images", 5), ctrl.addReview);
router.post("/:id/reviews/:reviewId/helpful", ctrl.markReviewHelpful);

/* ═══════════════════════════════════════════════════════════════
   ADMIN ROUTES
   ═══════════════════════════════════════════════════════════════ */

// CRUD
router.post("/", protect, adminOnly, upload.single("image"), ctrl.create);
router.put("/:id", protect, adminOnly, upload.single("image"), ctrl.update);
router.delete("/:id", protect, adminOnly, ctrl.remove);
router.post("/:id/restore", protect, adminOnly, ctrl.restore);
router.patch("/bulk", protect, adminOnly, ctrl.bulkUpdate);

// Images Management
router.post("/:id/images", protect, adminOnly, upload.array("images", 20), ctrl.addImages);
router.put("/:id/images/:imageId", protect, adminOnly, ctrl.updateImage);
router.delete("/:id/images/:imageId", protect, adminOnly, ctrl.removeImage);
router.put("/:id/images/reorder", protect, adminOnly, ctrl.reorderImages);

// Itinerary Management
router.post("/:id/itinerary", protect, adminOnly, ctrl.addItineraryDay);
router.put("/:id/itinerary/:dayId", protect, adminOnly, ctrl.updateItineraryDay);
router.delete("/:id/itinerary/:dayId", protect, adminOnly, ctrl.removeItineraryDay);

// FAQs Management
router.post("/:id/faqs", protect, adminOnly, ctrl.addFaq);
router.put("/:id/faqs/:faqId", protect, adminOnly, ctrl.updateFaq);
router.delete("/:id/faqs/:faqId", protect, adminOnly, ctrl.removeFaq);

// Tags Management
router.post("/:id/tags", protect, adminOnly, ctrl.addDestinationTag);
router.delete("/:id/tags/:tagId", protect, adminOnly, ctrl.removeDestinationTag);

module.exports = router;
