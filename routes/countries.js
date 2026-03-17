// routes/countries.js
const router = require("express").Router();
const countries = require("../controllers/countriesController");
const { protect, adminOnly } = require("../middleware/auth");

// ============================================
// PUBLIC ROUTES
// ============================================

// Main country routes
router.get("/", countries.getAll);
router.get("/featured", countries.getFeatured);
router.get("/search", countries.search);
router.get("/stats", countries.getStats);
router.get("/continents", countries.getContinents);
router.get("/continent/:continent", countries.getByContinent);

// Single country routes (must be after specific routes)
router.get("/:idOrSlug", countries.getOne);
router.get("/:idOrSlug/destinations", countries.getDestinations);

// ============================================
// PROTECTED ADMIN ROUTES
// ============================================

// Country CRUD
router.post("/", protect, adminOnly, countries.create);
router.put("/:id", protect, adminOnly, countries.update);
router.delete("/:id", protect, adminOnly, countries.remove);

// Airports management
router.post("/:id/airports", protect, adminOnly, countries.addAirport);
router.delete("/:id/airports/:airportId", protect, adminOnly, countries.removeAirport);

// Festivals management
router.post("/:id/festivals", protect, adminOnly, countries.addFestival);
router.delete("/:id/festivals/:festivalId", protect, adminOnly, countries.removeFestival);

// UNESCO sites management
router.post("/:id/unesco-sites", protect, adminOnly, countries.addUnescoSite);
router.delete("/:id/unesco-sites/:siteId", protect, adminOnly, countries.removeUnescoSite);

// Historical events management
router.post("/:id/historical-events", protect, adminOnly, countries.addHistoricalEvent);
router.delete("/:id/historical-events/:eventId", protect, adminOnly, countries.removeHistoricalEvent);

module.exports = router;