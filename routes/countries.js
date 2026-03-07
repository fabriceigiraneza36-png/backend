const router = require("express").Router();
const countries = require("../controllers/countriesController");
const { protect, adminOnly } = require("../middleware/auth");

// Public routes
router.get("/", countries.getAll);
router.get("/featured", countries.getFeatured);
router.get("/:idOrSlug", countries.getOne);
router.get("/:idOrSlug/destinations", countries.getDestinations);

// Protected Admin routes
router.post("/", protect, adminOnly, countries.create);
router.put("/:id", protect, adminOnly, countries.update);
router.delete("/:id", protect, adminOnly, countries.remove);

module.exports = router;
