// controllers/maintenanceController.js
// ═══════════════════════════════════════════════════════════════════════════════
// Maintenance / Data Cleanup Utility v2.0
// -----------------------------------------------------------------------------
// Admin-only endpoints to:
//   GET  /api/maintenance/categories  — record counts per table per category
//   POST /api/maintenance/purge/:cat  — delete all records (requires confirm)
//
// Every table count is wrapped in its own try/catch so a missing table
// never crashes the whole endpoint.
// ═══════════════════════════════════════════════════════════════════════════════

'use strict'

const { query } = require('../config/db')
const logger    = require('../utils/logger')

/* ─────────────────────────────────────────────────────────────────────────────
   CATEGORY → TABLES MAP
   Delete order within each category: children before parents (FK safety).
───────────────────────────────────────────────────────────────────────────── */
const CATEGORY_TABLES = {
  destinations: [
    'destination_tips',
    'destination_practical_info',
    'destination_tags',
    'destination_reviews',
    'destination_itineraries',
    'destination_images',
    'destinations',
  ],
  countries: [
    'destination_tips',
    'destination_practical_info',
    'destination_tags',
    'destination_reviews',
    'destination_itineraries',
    'destination_images',
    'destinations',
    'bookings',
    'countries',
  ],
  bookings: [
    'package_bookings',
    'admin_info_requests',
    'bookings',
  ],
  packages: [
    'package_chat_preferences',
    'package_messages',
    'package_bookings',
    'admin_info_requests',
    'packages',
  ],
  messaging: [
    'typing_indicators',
    'messages',
    'conversations',
  ],
  comments: [
    'destination_comments',
    'country_comments',
  ],
  posts: [
    'post_comments',
    'posts',
  ],
  contact: [
    'contact_replies',
    'contact_messages',
  ],
  users:         ['users'],
  reviews:       ['reviews'],
  gallery:       ['gallery'],
  team:          ['team'],
  testimonials:  ['testimonials'],
  faqs:          ['faqs'],
  services:      ['services'],
  tips:          ['tips'],
  pages:         ['pages'],
  subscribers:   ['subscribers'],
  notifications: ['notifications'],
}

const ALL_CATEGORIES = Object.keys(CATEGORY_TABLES)

/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────────────────── */

/**
 * Returns the row count for a single table.
 * Returns 0 (never throws) if the table does not exist.
 */
const countTable = async (table) => {
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::INT AS cnt FROM "${table}"`,
    )
    return rows[0]?.cnt ?? 0
  } catch {
    return 0
  }
}

/**
 * Deletes every row from a table and returns how many were removed.
 * Returns 0 (never throws) if the table does not exist.
 */
const deleteFromTable = async (table) => {
  try {
    const { rowCount } = await query(`DELETE FROM "${table}"`)
    return rowCount ?? 0
  } catch (err) {
    logger.warn(`[Maintenance] deleteFromTable skipped "${table}": ${err.message}`)
    return 0
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/maintenance/categories
   Returns:
   {
     success: true,
     data: [
       {
         category:     "posts",
         tables:       [{ table: "post_comments", count: 3 }, { table: "posts", count: 7 }],
         totalRecords: 10,
       },
       …
     ]
   }
───────────────────────────────────────────────────────────────────────────── */
exports.listCategories = async (req, res) => {
  try {
    const data = await Promise.all(
      ALL_CATEGORIES.map(async (category) => {
        const tableList = CATEGORY_TABLES[category]

        // Fetch counts for all tables in this category in parallel
        const tables = await Promise.all(
          tableList.map(async (table) => ({
            table,
            count: await countTable(table),
          })),
        )

        // De-duplicate table names that appear more than once
        // (e.g. "countries" category re-lists destination tables)
        const seen        = new Set()
        const uniqueTables = tables.filter(({ table }) => {
          if (seen.has(table)) return false
          seen.add(table)
          return true
        })

        const totalRecords = uniqueTables.reduce((sum, t) => sum + t.count, 0)

        return { category, tables: uniqueTables, totalRecords }
      }),
    )

    return res.json({ success: true, data })
  } catch (err) {
    logger.error('[Maintenance] listCategories failed:', err.message)
    return res.status(500).json({
      success: false,
      message: 'Failed to load maintenance categories.',
    })
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/maintenance/purge/:category
   Body: { confirm: "DELETE_ALL" }
   Returns:
   {
     success: true,
     message: "Purged 42 records across 2 tables.",
     category: "posts",
     results: {
       post_comments: { before: 35, deleted: 35, after: 0 },
       posts:         { before:  7, deleted:  7, after: 0 },
     }
   }
───────────────────────────────────────────────────────────────────────────── */
exports.purgeCategory = async (req, res) => {
  try {
    const { category }   = req.params
    const { confirm }    = req.body || {}
    const adminId        = req.user?.id
    const adminEmail     = req.user?.email || 'unknown'

    // ── Validate category ────────────────────────────────────────────────
    if (!CATEGORY_TABLES[category]) {
      return res.status(400).json({
        success: false,
        message: `Unknown category "${category}". Allowed: ${ALL_CATEGORIES.join(', ')}.`,
      })
    }

    // ── Require explicit confirmation token ──────────────────────────────
    if (confirm !== 'DELETE_ALL') {
      return res.status(400).json({
        success: false,
        message: 'Confirmation required. Send { confirm: "DELETE_ALL" } in the request body.',
      })
    }

    const tableList = CATEGORY_TABLES[category]
    const results   = {}
    let   totalDeleted = 0

    // De-duplicate (same reason as listCategories)
    const seen        = new Set()
    const uniqueTables = tableList.filter((t) => {
      if (seen.has(t)) return false
      seen.add(t)
      return true
    })

    // Delete in defined order (children first)
    for (const table of uniqueTables) {
      const before  = await countTable(table)
      const deleted = await deleteFromTable(table)
      const after   = await countTable(table)

      results[table] = { before, deleted, after }
      totalDeleted  += deleted

      logger.info(
        `[Maintenance] admin=${adminEmail} purged ${deleted} rows from "${table}" ` +
        `(category=${category})`,
      )
    }

    logger.warn(
      `[Maintenance] PURGE COMPLETE — category="${category}" ` +
      `totalDeleted=${totalDeleted} by admin id=${adminId} email=${adminEmail}`,
    )

    return res.json({
      success: true,
      message: `Purged ${totalDeleted} records across ${uniqueTables.length} table(s) in "${category}".`,
      category,
      results,
    })
  } catch (err) {
    logger.error(
      `[Maintenance] purgeCategory "${req.params?.category}" failed:`,
      err.message,
    )
    return res.status(500).json({
      success: false,
      message: 'Purge failed. See server logs for details.',
    })
  }
}