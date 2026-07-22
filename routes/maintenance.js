// routes/maintenance.js
// ═══════════════════════════════════════════════════════════════════════════════
// Maintenance Routes
// ═══════════════════════════════════════════════════════════════════════════════

const router = require("express").Router();
const ctrl = require("../controllers/maintenanceController");
const { protect, adminOnly } = require("../middleware/auth");

/**
 * GET /api/maintenance/categories
 * Returns record counts per table for every maintenance category.
 */
router.get("/categories", protect, adminOnly, ctrl.listCategories);

/**
 * POST /api/maintenance/purge/:category
 * Deletes ALL records in every table associated with the given category.
 *
 * Body: { confirm: "DELETE_ALL" }
 */
router.post("/purge/:category", protect, adminOnly, ctrl.purgeCategory);

module.exports = router;
