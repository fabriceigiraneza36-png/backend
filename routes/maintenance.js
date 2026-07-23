// routes/maintenance.js
// ═══════════════════════════════════════════════════════════════════════════════
// Maintenance Routes — admin only
// ═══════════════════════════════════════════════════════════════════════════════

'use strict'

const router       = require('express').Router()
const ctrl         = require('../controllers/maintenanceController')
const { protect, adminOnly } = require('../middleware/auth')
const asyncHandler = require('../middleware/asyncHandler')

/**
 * GET /api/maintenance/categories
 *
 * Returns per-table record counts grouped by maintenance category.
 * Used by the Settings page → Data Management section.
 *
 * Response shape:
 * {
 *   success: true,
 *   data: [
 *     {
 *       category:     string,
 *       tables:       Array<{ table: string, count: number }>,
 *       totalRecords: number,
 *     }
 *   ]
 * }
 */
router.get(
  '/categories',
  protect,
  adminOnly,
  asyncHandler(ctrl.listCategories),
)

/**
 * POST /api/maintenance/purge/:category
 *
 * Deletes ALL records in every table belonging to the named category.
 * Requires { confirm: "DELETE_ALL" } in the request body.
 *
 * Response shape:
 * {
 *   success:      true,
 *   message:      string,
 *   category:     string,
 *   results:      Record<table, { before, deleted, after }>,
 * }
 */
router.post(
  '/purge/:category',
  protect,
  adminOnly,
  asyncHandler(ctrl.purgeCategory),
)

module.exports = router