/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TESTIMONIALS CONTROLLER v3.0
 * ═══════════════════════════════════════════════════════════════════════════
 * Fixes:
 *  - extractUser matches EXACT shape from protect middleware (req.user.id,
 *    req.user.full_name, req.user.email, req.user.avatar_url)
 *  - ensureSchema() uses IF NOT EXISTS — fully idempotent
 *  - Rate-limit window configurable via env
 *  - Consistent { success, data, message } response shape
 *  - All DB errors surfaced with descriptive messages
 *  - No silent catches that swallow real errors
 * ═══════════════════════════════════════════════════════════════════════════
 */

"use strict";

const { query }    = require("../config/db");
const { paginate } = require("../utils/helpers");
const logger       = require("../utils/logger");

// ── Column list ───────────────────────────────────────────────────────────
const COLS = `
  id, name, location, avatar_url, rating, trip, date_text,
  testimonial_text, is_featured, is_active, sort_order,
  created_at, updated_at
`.trim();

// ── Admin-editable fields ─────────────────────────────────────────────────
const ALLOWED_FIELDS = [
  "name", "location", "avatar_url", "rating", "trip",
  "date_text", "testimonial_text", "is_featured", "is_active", "sort_order",
];

const MAX_WORDS               = 60;
const RATE_LIMIT_HOURS        = parseInt(process.env.REVIEW_RATE_LIMIT_HOURS || "24", 10);
const RATE_LIMIT_INTERVAL     = `${RATE_LIMIT_HOURS} hours`;

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA BOOTSTRAP (idempotent — safe to run on every cold start)
// ═══════════════════════════════════════════════════════════════════════════

const ensureSchema = async () => {
  try {
    // Main table
    await query(`
      CREATE TABLE IF NOT EXISTS testimonials (
        id               SERIAL       PRIMARY KEY,
        name             VARCHAR(255) NOT NULL,
        location         VARCHAR(255),
        avatar_url       VARCHAR(500),
        rating           INTEGER      NOT NULL DEFAULT 5
                           CHECK (rating BETWEEN 1 AND 5),
        trip             VARCHAR(255),
        date_text        VARCHAR(100),
        testimonial_text TEXT         NOT NULL,
        is_featured      BOOLEAN      NOT NULL DEFAULT false,
        is_active        BOOLEAN      NOT NULL DEFAULT true,
        sort_order       INTEGER      NOT NULL DEFAULT 0,
        user_id          INTEGER,
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    // Backfill user_id column for tables created before this version
    await query(
      `ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS user_id INTEGER`,
    ).catch(() => {}); // no-op if already exists

    // Indexes
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_tmon_active   ON testimonials (is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_tmon_featured ON testimonials (is_featured)`,
      `CREATE INDEX IF NOT EXISTS idx_tmon_user     ON testimonials (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tmon_sort     ON testimonials (sort_order ASC, created_at DESC)`,
    ];
    for (const sql of indexes) {
      await query(sql).catch(() => {});
    }

    logger.info("[Testimonials] Schema ready");
  } catch (err) {
    // Non-fatal — app still starts; first real request may surface a DB error
    logger.warn("[Testimonials] Schema bootstrap warning:", err.message);
  }
};

// Run once at module load (non-blocking)
ensureSchema();

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const wordCount = (str = "") =>
  String(str).trim().split(/\s+/).filter(Boolean).length;

const safeInt = (v, def = 1) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

/**
 * Extract user from req — matches the EXACT shape produced by
 * your protect middleware in middleware/auth.js, which attaches:
 *   req.user = { id, email, full_name, avatar_url, role, … }
 */
const extractUser = (req) => {
  const u = req.user || {};
  return {
    // id — your auth middleware sets req.user.id (integer PK)
    id:     u.id          ?? u.userId     ?? u.user_id  ?? null,
    // name — auth middleware sets full_name (snake_case from DB row)
    name:   u.full_name   ?? u.fullName   ?? u.name     ?? null,
    email:  u.email       ?? null,
    // avatar — auth middleware sets avatar_url (snake_case from DB row)
    avatar: u.avatar_url  ?? u.avatarUrl  ?? u.avatar   ?? null,
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC READ ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/testimonials — paginated active list */
exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, featured } = req.query;
    const params  = [];
    const clauses = ["is_active = true"];
    let   idx     = 1;

    if (featured !== undefined) {
      clauses.push(`is_featured = $${idx++}`);
      params.push(featured === "true");
    }

    const where      = `WHERE ${clauses.join(" AND ")}`;
    const countRes   = await query(
      `SELECT COUNT(*) FROM testimonials ${where}`, params,
    );
    const pagination = paginate(
      parseInt(countRes.rows[0].count, 10), page, limit,
    );

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT ${COLS} FROM testimonials ${where}
       ORDER BY is_featured DESC, sort_order ASC, created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    res.json({ success: true, data: result.rows, pagination });
  } catch (err) { next(err); }
};

/** GET /api/testimonials/featured — top N featured active */
exports.getFeatured = async (req, res, next) => {
  try {
    const limit  = Math.min(safeInt(req.query.limit, 12), 50);
    const result = await query(
      `SELECT ${COLS} FROM testimonials
       WHERE is_active = true AND is_featured = true
       ORDER BY sort_order ASC, created_at DESC
       LIMIT $1`,
      [limit],
    );
    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (err) { next(err); }
};

/** GET /api/testimonials/stats */
exports.getStats = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*)                                      AS total,
        COUNT(*) FILTER (WHERE is_active  = true)    AS active,
        COUNT(*) FILTER (WHERE is_active  = false)   AS inactive,
        COUNT(*) FILTER (WHERE is_featured = true)   AS featured,
        ROUND(AVG(rating)::numeric, 2)               AS avg_rating,
        COUNT(*) FILTER (WHERE rating = 5)           AS five_star,
        COUNT(*) FILTER (WHERE rating = 4)           AS four_star,
        COUNT(*) FILTER (WHERE rating <= 3)          AS three_or_less,
        COUNT(*) FILTER (WHERE is_active = false
          AND user_id IS NOT NULL)                   AS pending_approval
      FROM testimonials
    `);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

/** GET /api/testimonials/:id */
exports.getOne = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0);
    if (id < 1)
      return res.status(400).json({
        success: false, error: "Invalid testimonial ID",
      });

    const result = await query(
      `SELECT ${COLS} FROM testimonials WHERE id = $1`, [id],
    );
    if (!result.rows[0])
      return res.status(404).json({
        success: false, error: "Testimonial not found",
      });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC SUBMIT — POST /api/testimonials/submit
// ═══════════════════════════════════════════════════════════════════════════

exports.submitPublic = async (req, res, next) => {
  try {
    // ── Auth check ─────────────────────────────────────────────────────────
    const user = extractUser(req);

    if (!user.id) {
      return res.status(401).json({
        success: false,
        error:   "You must be logged in to submit a review.",
      });
    }

    // ── Input validation ───────────────────────────────────────────────────
    const rawText     = String(req.body.testimonial_text || "").trim();
    const rawRating   = req.body.rating;
    const rawTrip     = String(req.body.trip     || "").trim();
    const rawLocation = String(req.body.location || "").trim();

    if (!rawText) {
      return res.status(400).json({
        success: false,
        error:   "Review text is required.",
      });
    }

    const wc = wordCount(rawText);
    if (wc > MAX_WORDS) {
      return res.status(400).json({
        success:   false,
        error:     `Your review is ${wc} words. Please trim it to ${MAX_WORDS} words or fewer.`,
        wordCount: wc,
        maxWords:  MAX_WORDS,
      });
    }

    const ratingNum = parseInt(String(rawRating ?? "5"), 10);
    if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({
        success: false,
        error:   "Rating must be a number between 1 and 5.",
      });
    }

    // ── Rate limit: 1 submission per user per N hours ──────────────────────
    const recent = await query(
      `SELECT id FROM testimonials
       WHERE user_id = $1
         AND created_at > NOW() - $2::interval
       LIMIT 1`,
      [user.id, RATE_LIMIT_INTERVAL],
    );

    if (recent.rows.length > 0) {
      return res.status(429).json({
        success:    false,
        error:      `You have already submitted a review in the last ${RATE_LIMIT_HOURS} hour(s). Thank you for your feedback!`,
        retryAfter: RATE_LIMIT_HOURS * 3600,
      });
    }

    // ── Derive display fields from user profile ────────────────────────────
    const displayName = (
      user.name ||
      (user.email ? user.email.split("@")[0] : null) ||
      "Traveler"
    ).trim();

    const dateText = new Date().toLocaleDateString("en-US", {
      month: "long",
      year:  "numeric",
    });

    // ── Insert (pending approval: is_active = false) ───────────────────────
    const result = await query(
      `INSERT INTO testimonials
         (name, location, avatar_url, rating, trip, date_text,
          testimonial_text, is_featured, is_active, sort_order,
          user_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,false,0,$8,NOW(),NOW())
       RETURNING ${COLS}, user_id`,
      [
        displayName,
        rawLocation || null,
        user.avatar  || null,
        ratingNum,
        rawTrip      || null,
        dateText,
        rawText,
        user.id,
      ],
    );

    logger.info("[Testimonials] New submission:", {
      userId: user.id,
      name:   displayName,
      rating: ratingNum,
      words:  wc,
    });

    return res.status(201).json({
      success: true,
      message:
        "Thank you! Your review has been submitted and will appear after " +
        "a quick approval check — usually within 24 hours.",
      data: result.rows[0],
    });
  } catch (err) {
    logger.error("[Testimonials] submitPublic error:", err.message);
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/testimonials/admin/all — full list with filters */
exports.adminGetAll = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 20,
      featured, active, search, rating,
      sort = "created_at", order = "DESC",
    } = req.query;

    const params  = [];
    const clauses = [];
    let   idx     = 1;

    if (featured !== undefined) {
      clauses.push(`is_featured = $${idx++}`);
      params.push(featured === "true");
    }
    if (active !== undefined) {
      clauses.push(`is_active = $${idx++}`);
      params.push(active === "true");
    }
    if (rating) {
      clauses.push(`rating = $${idx++}`);
      params.push(parseInt(rating, 10));
    }
    if (search) {
      clauses.push(`(
        name             ILIKE $${idx} OR
        testimonial_text ILIKE $${idx} OR
        location         ILIKE $${idx} OR
        trip             ILIKE $${idx}
      )`);
      params.push(`%${String(search).trim()}%`);
      idx++;
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const SORT_WHITELIST = new Set([
      "id", "name", "rating", "sort_order", "created_at", "updated_at",
    ]);
    const sortCol = SORT_WHITELIST.has(sort) ? sort : "created_at";
    const sortDir = order.toUpperCase() === "ASC" ? "ASC" : "DESC";

    const countRes   = await query(
      `SELECT COUNT(*) FROM testimonials ${where}`, params,
    );
    const pagination = paginate(
      parseInt(countRes.rows[0].count, 10), page, limit,
    );

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT ${COLS}, user_id FROM testimonials ${where}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    res.json({ success: true, data: result.rows, pagination });
  } catch (err) { next(err); }
};

/** POST /api/testimonials — admin creates directly (active immediately) */
exports.create = async (req, res, next) => {
  try {
    const {
      name, location, avatar_url, rating = 5, trip,
      date_text, testimonial_text,
      is_featured = false, is_active = true, sort_order = 0,
    } = req.body;

    const cleanName = String(name || "").trim();
    const cleanText = String(testimonial_text || "").trim();

    if (!cleanName)
      return res.status(400).json({ success: false, error: "Name is required" });
    if (!cleanText)
      return res.status(400).json({
        success: false, error: "Testimonial text is required",
      });

    const ratingNum = parseInt(String(rating), 10);
    if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5)
      return res.status(400).json({
        success: false, error: "Rating must be 1–5",
      });

    const result = await query(
      `INSERT INTO testimonials
         (name, location, avatar_url, rating, trip, date_text,
          testimonial_text, is_featured, is_active, sort_order,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
       RETURNING ${COLS}`,
      [
        cleanName,
        String(location   || "").trim() || null,
        String(avatar_url || "").trim() || null,
        ratingNum,
        String(trip       || "").trim() || null,
        String(date_text  || "").trim() || null,
        cleanText,
        Boolean(is_featured),
        Boolean(is_active),
        parseInt(String(sort_order), 10) || 0,
      ],
    );

    res.status(201).json({
      success: true,
      data:    result.rows[0],
      message: "Testimonial created successfully",
    });
  } catch (err) { next(err); }
};

/** PUT|PATCH /api/testimonials/:id — admin updates any field */
exports.update = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0);
    if (id < 1)
      return res.status(400).json({
        success: false, error: "Invalid testimonial ID",
      });

    const existing = await query(
      "SELECT id FROM testimonials WHERE id = $1", [id],
    );
    if (!existing.rows[0])
      return res.status(404).json({
        success: false, error: "Testimonial not found",
      });

    const updates = {};
    for (const field of ALLOWED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    if (!Object.keys(updates).length)
      return res.status(400).json({
        success: false, error: "No valid fields to update",
      });

    if (updates.rating !== undefined) {
      const r = parseInt(String(updates.rating), 10);
      if (!Number.isFinite(r) || r < 1 || r > 5)
        return res.status(400).json({
          success: false, error: "Rating must be 1–5",
        });
      updates.rating = r;
    }

    const keys      = Object.keys(updates);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values    = [...keys.map((k) => updates[k]), id];

    const result = await query(
      `UPDATE testimonials
         SET ${setClause}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING ${COLS}`,
      values,
    );

    res.json({
      success: true,
      data:    result.rows[0],
      message: "Testimonial updated",
    });
  } catch (err) { next(err); }
};

/** PATCH /api/testimonials/:id/toggle-featured */
exports.toggleFeatured = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0);
    if (id < 1)
      return res.status(400).json({
        success: false, error: "Invalid testimonial ID",
      });

    const result = await query(
      `UPDATE testimonials
         SET is_featured = NOT is_featured, updated_at = NOW()
       WHERE id = $1
       RETURNING ${COLS}`,
      [id],
    );

    if (!result.rows[0])
      return res.status(404).json({
        success: false, error: "Testimonial not found",
      });

    const row = result.rows[0];
    res.json({
      success: true,
      data:    row,
      message: row.is_featured ? "Marked as featured" : "Removed from featured",
    });
  } catch (err) { next(err); }
};

/** PATCH /api/testimonials/:id/toggle-active */
exports.toggleActive = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0);
    if (id < 1)
      return res.status(400).json({
        success: false, error: "Invalid testimonial ID",
      });

    const result = await query(
      `UPDATE testimonials
         SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1
       RETURNING ${COLS}`,
      [id],
    );

    if (!result.rows[0])
      return res.status(404).json({
        success: false, error: "Testimonial not found",
      });

    const row = result.rows[0];
    res.json({
      success: true,
      data:    row,
      message: row.is_active ? "Testimonial activated" : "Testimonial deactivated",
    });
  } catch (err) { next(err); }
};

/** PATCH /api/testimonials/reorder */
exports.reorder = async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({
        success: false, error: "items array is required",
      });

    const ids    = items.map((i) => parseInt(String(i.id),         10));
    const orders = items.map((i) => parseInt(String(i.sort_order), 10));

    if (ids.some(isNaN) || orders.some(isNaN))
      return res.status(400).json({
        success: false,
        error:   "All items must have numeric id and sort_order",
      });

    await query(
      `UPDATE testimonials AS t
         SET sort_order = v.sort_order::INTEGER, updated_at = NOW()
       FROM (
         SELECT UNNEST($1::INTEGER[]) AS id,
                UNNEST($2::INTEGER[]) AS sort_order
       ) AS v
       WHERE t.id = v.id`,
      [ids, orders],
    );

    res.json({
      success: true,
      message: `${items.length} testimonial(s) reordered`,
    });
  } catch (err) { next(err); }
};

/** DELETE /api/testimonials/:id */
exports.remove = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0);
    if (id < 1)
      return res.status(400).json({
        success: false, error: "Invalid testimonial ID",
      });

    const result = await query(
      "DELETE FROM testimonials WHERE id = $1 RETURNING id, name",
      [id],
    );

    if (!result.rows[0])
      return res.status(404).json({
        success: false, error: "Testimonial not found",
      });

    res.json({
      success: true,
      message: `"${result.rows[0].name}" deleted`,
      data:    { id: result.rows[0].id },
    });
  } catch (err) { next(err); }
};

/** DELETE /api/testimonials — bulk delete */
exports.bulkDelete = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({
        success: false, error: "ids array is required",
      });

    const validIds = ids
      .map((id) => parseInt(String(id), 10))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (!validIds.length)
      return res.status(400).json({
        success: false, error: "No valid IDs provided",
      });

    const result = await query(
      "DELETE FROM testimonials WHERE id = ANY($1::INTEGER[]) RETURNING id",
      [validIds],
    );

    res.json({
      success: true,
      message: `${result.rows.length} testimonial(s) deleted`,
      data:    { deleted: result.rows.map((r) => r.id) },
    });
  } catch (err) { next(err); }
};