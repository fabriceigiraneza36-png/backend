const router = require("express").Router();
const destinations = require("../controllers/destinationsController");
const { protect, adminOnly } = require("../middleware/auth");

// Public routes
router.get("/", destinations.getAll);
router.get("/featured", destinations.getFeatured);
router.get("/categories", destinations.getCategories);
router.get("/map", destinations.getMapData);
router.get("/:idOrSlug", destinations.getOne);
router.get("/:id/images", destinations.getImages);

// Protected Admin routes
router.post("/", protect, adminOnly, destinations.create);
router.put("/:id", protect, adminOnly, destinations.update);
router.delete("/:id", protect, adminOnly, destinations.remove);

// Image management
router.post("/:id/images", protect, adminOnly, destinations.addImages);
router.delete("/images/:imageId", protect, adminOnly, destinations.removeImage);

module.exports = router;
