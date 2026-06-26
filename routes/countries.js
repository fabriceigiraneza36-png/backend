// routes/countries.js
const router    = require("express").Router();
const countries = require("../controllers/countriesController");
const { protect, adminOnly } = require("../middleware/auth");

// ============================================================
// PUBLIC ROUTES
// ============================================================

// Collection routes (must be before :idOrSlug)
router.get("/",                    countries.getAll);
router.get("/featured",            countries.getFeatured);
router.get("/search",              countries.search);
router.get("/stats",               countries.getStats);
router.get("/continents",          countries.getContinents);
router.get("/continent/:continent",countries.getByContinent);

// Single country routes
router.get("/:idOrSlug",           countries.getOne);
router.get("/:idOrSlug/destinations", countries.getDestinations);

// ============================================================
// PROTECTED ADMIN ROUTES
// ============================================================

// Country CRUD
router.post(  "/",    protect, adminOnly, countries.create);
router.put(   "/:id", protect, adminOnly, countries.update);
router.delete("/:id", protect, adminOnly, countries.remove);

// UNESCO sites management (only remaining sub-resource)
router.post(  "/:id/unesco-sites/:siteId", protect, adminOnly, countries.addUnescoSite);
router.delete("/:id/unesco-sites/:siteId", protect, adminOnly, countries.removeUnescoSite);

module.exports = router;