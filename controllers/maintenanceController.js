// controllers/maintenanceController.js
// ═══════════════════════════════════════════════════════════════════════════════
// Maintenance / Data Cleanup Utility
// -----------------------------------------------------------------------------
// Provides admin-only endpoints to purge all records for a given content
// category.  Every destructive action requires an explicit confirmation token
// in the request body to prevent accidental clicks.
// ═══════════════════════════════════════════════════════════════════════════════

const { query } = require("../config/db");
const logger    = require("../utils/logger");

/*
  Category → tables (delete order: children before parents to satisfy FK)
*/
const CATEGORY_TABLES = {
  destinations: [
    "destination_tips",
    "destination_practical_info",
    "destination_tags",
    "destination_reviews",
    "destination_itineraries",
    "destination_images",
    "destinations",
  ],
  countries: [
    "destinations",
    "bookings",
    "countries",
  ],
  bookings: [
    "package_bookings",
    "admin_info_requests",
    "bookings",
  ],
  packages: [
    "package_chat_preferences",
    "package_messages",
    "package_bookings",
    "admin_info_requests",
    "packages",
  ],
  messages: [
    "typing_indicators",
    "messages",
    "conversations",
  ],
  posts: [
    "post_comments",
    "posts",
  ],
  contact: [
    "contact_replies",
    "contact_messages",
  ],
  users:        ["users"],
  reviews:      ["reviews"],
  gallery:      ["gallery"],
  team:         ["team"],
  testimonials: ["testimonials"],
  faqs:         ["faqs"],
  services:     ["services"],
  tips:         ["tips"],
  pages:        ["pages"],
  subscribers:  ["subscribers"],
  notifications: ["notifications"],
};

const ALL_CATEGORIES = Object.keys(CATEGORY_TABLES);

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const countTable = async (table) => {
  const { rows } = await query(`SELECT COUNT(*)::INT AS cnt FROM "${table}"`);
  return rows[0]?.cnt || 0;
};

const deleteFromTable = async (table) => {
  const { rows } = await query(`DELETE FROM "${table}" RETURNING 1`);
  return rows.length;
};

/* ─── Controllers ────────────────────────────────────────────────────────── */

exports.listCategories = async (req, res) => {
  try {
    const cats = await Promise.all(
      ALL_CATEGORIES.map(async (cat) => {
        const tables = CATEGORY_TABLES[cat];
        const tableStats = await Promise.all(
          tables.map(async (t) => ({ table: t, count: await countTable(t) }))
        );
        const total = tableStats.reduce((s, t) => s + t.count, 0);
        return { category: cat, tables: tableStats, totalRecords: total };
      })
    );
    res.json({ success: true, data: cats });
  } catch (err) {
    logger.error("[Maintenance] listCategories failed:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.purgeCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const { confirm } = req.body || {};

    if (!CATEGORY_TABLES[category]) {
      return res.status(400).json({
        success: false,
        message: `Unknown category "${category}". Allowed: ${ALL_CATEGORIES.join(", ")}`,
      });
    }

    if (confirm !== "DELETE_ALL") {
      return res.status(400).json({
        success: false,
        message: 'Confirmation required. Set body.confirm = "DELETE_ALL" to proceed.',
      });
    }

    const tables = CATEGORY_TABLES[category];
    const results = {};

    for (const table of tables) {
      const before = await countTable(table);
      const deleted = await deleteFromTable(table);
      results[table] = { before, deleted, after: before - deleted };
      logger.info(`[Maintenance] Purged ${deleted} rows from ${table} (category=${category})`);
    }

    const totalDeleted = Object.values(results).reduce((s, r) => s + r.deleted, 0);

    res.json({
      success: true,
      message: `Purged ${totalDeleted} records across ${tables.length} tables.`,
      category,
      results,
    });
  } catch (err) {
    logger.error(`[Maintenance] purgeCategory ${req.params.category} failed:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
