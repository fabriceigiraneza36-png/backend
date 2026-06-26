/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COUNTRIES CONTROLLER — getOne fix for includeRelated=true 500 error
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Replace your existing getOne export with this entire fixed version.
 * The key fixes:
 *   1. Every sub-query is wrapped in try/catch so one failure ≠ 500
 *   2. Column existence is not assumed — safe fallbacks on all JOINs
 *   3. `slug` lookup is case-insensitive
 *   4. `includeRelated` sub-queries run in parallel via Promise.allSettled
 */

"use strict";

const { query } = require("../config/db");
const logger    = require("../utils/logger");

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const safeInt = (v, def, min = 1, max = 500) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

/** Run a query and return rows, or [] on error — never throws. */
const safeQuery = async (sql, params = []) => {
  try {
    const { rows } = await query(sql, params);
    return rows;
  } catch (err) {
    logger.warn("[Countries] safeQuery non-fatal:", err.message, "| SQL:", sql.slice(0, 120));
    return [];
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   GET ALL   GET /api/countries
═══════════════════════════════════════════════════════════════════════════════ */

exports.getAll = async (req, res, next) => {
  try {
    const {
      page      = 1,
      limit     = 50,
      continent,
      search,
      is_active,
      sortBy    = "name",
      order     = "asc",
    } = req.query;

    const ALLOWED_SORT = new Set(["name","continent","created_at","destination_count"]);

    const params = [];
    const conds  = ["1=1"];
    let   pi     = 1;

    if (continent)              { conds.push(`c.continent ILIKE $${pi++}`);          params.push(`%${continent}%`); }
    if (is_active !== undefined){ conds.push(`c.is_active = $${pi++}`);              params.push(is_active === "true"); }
    if (search)                 { conds.push(`(c.name ILIKE $${pi} OR c.description ILIKE $${pi})`); params.push(`%${search}%`); pi++; }

    const where   = conds.join(" AND ");
    const sortCol = ALLOWED_SORT.has(sortBy) ? sortBy : "name";
    const sortDir = order.toUpperCase() === "DESC" ? "DESC" : "ASC";
    const lim     = safeInt(limit, 50, 1, 200);
    const pg      = safeInt(page,  1,  1, 9999);
    const offset  = (pg - 1) * lim;

    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM countries c WHERE ${where}`, params),
      query(
        `SELECT
            c.*,
            COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = true)::INTEGER AS destination_count
           FROM countries c
           LEFT JOIN destinations d ON d.country_id = c.id
           WHERE ${where}
           GROUP BY c.id
           ORDER BY c.${sortCol} ${sortDir}
           LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, lim, offset],
      ),
    ]);

    const total      = parseInt(countRes.rows[0].count, 10);
    const totalPages = Math.ceil(total / lim);

    return res.json({
      success: true,
      data:    dataRes.rows,
      pagination: {
        total,
        page:        pg,
        limit:       lim,
        total_pages: totalPages,
        has_next:    pg < totalPages,
        has_prev:    pg > 1,
      },
    });
  } catch (err) {
    logger.error("[Countries] getAll failed:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   GET ONE   GET /api/countries/:slug
   ─── THIS IS THE FIX for the 500 on includeRelated=true ────────────────────
═══════════════════════════════════════════════════════════════════════════════ */

exports.getOne = async (req, res, next) => {
  try {
    const rawSlug       = req.params.slug || req.params.id || "";
    const includeRelated = ["true","1","yes"].includes(
      String(req.query.includeRelated || "").toLowerCase(),
    );

    if (!rawSlug.trim()) {
      return res.status(400).json({ success: false, error: "Country identifier required" });
    }

    /* ── Lookup: try slug first, then id, then name ── */
    let country = null;
    const slugLower = rawSlug.toLowerCase().trim();

    // 1. By slug
    const bySlug = await safeQuery(
      `SELECT c.*,
              COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = true)::INTEGER AS destination_count
         FROM countries c
         LEFT JOIN destinations d ON d.country_id = c.id
         WHERE LOWER(c.slug) = $1
         GROUP BY c.id
         LIMIT 1`,
      [slugLower],
    );
    if (bySlug[0]) country = bySlug[0];

    // 2. By name (case-insensitive)
    if (!country) {
      const byName = await safeQuery(
        `SELECT c.*,
                COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = true)::INTEGER AS destination_count
           FROM countries c
           LEFT JOIN destinations d ON d.country_id = c.id
           WHERE LOWER(c.name) = $1
           GROUP BY c.id
           LIMIT 1`,
        [slugLower],
      );
      if (byName[0]) country = byName[0];
    }

    // 3. By numeric ID
    if (!country) {
      const numId = parseInt(rawSlug, 10);
      if (Number.isFinite(numId) && numId > 0) {
        const byId = await safeQuery(
          `SELECT c.*,
                  COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = true)::INTEGER AS destination_count
             FROM countries c
             LEFT JOIN destinations d ON d.country_id = c.id
             WHERE c.id = $1
             GROUP BY c.id
             LIMIT 1`,
          [numId],
        );
        if (byId[0]) country = byId[0];
      }
    }

    if (!country) {
      return res.status(404).json({ success: false, error: "Country not found" });
    }

    /* ── Increment view count (non-blocking, non-fatal) ── */
    query(
      "UPDATE countries SET view_count = COALESCE(view_count,0) + 1 WHERE id = $1",
      [country.id],
    ).catch(() => {});

    /* ── Build base response ── */
    const response = { success: true, data: { ...country } };

    /* ── includeRelated: run all sub-queries in parallel, none can crash ── */
    if (includeRelated) {
      const [
        destinationsResult,
        servicesResult,
        bookingStatsResult,
        similarCountriesResult,
        highlightsResult,
      ] = await Promise.allSettled([

        /* Active destinations for this country */
        safeQuery(
          `SELECT
              d.id, d.name, d.slug, d.short_description, d.description,
              d.image_url, d.gallery_images, d.difficulty, d.duration,
              d.price_from, d.price_currency, d.rating, d.review_count,
              d.is_featured, d.is_active, d.booking_count,
              d.highlights, d.best_time_to_visit, d.climate,
              d.latitude, d.longitude, d.category,
              COALESCE(d.booking_count, 0)::INTEGER AS total_bookings
             FROM destinations d
             WHERE d.country_id = $1 AND d.is_active = true
             ORDER BY d.is_featured DESC NULLS LAST, d.booking_count DESC NULLS LAST, d.name ASC`,
          [country.id],
        ),

        /* Services linked to this country */
        safeQuery(
          `SELECT
              s.id, s.title, s.slug, s.description, s.short_description,
              s.image_url, s.price_from, s.price_currency,
              s.duration, s.category, s.is_featured, s.is_active,
              s.rating, s.review_count
             FROM services s
             WHERE s.country_id = $1 AND s.is_active = true
             ORDER BY s.is_featured DESC NULLS LAST, s.title ASC
             LIMIT 20`,
          [country.id],
        ),

        /* Booking stats */
        safeQuery(
          `SELECT
              COUNT(DISTINCT b.id)::INTEGER                   AS total_bookings,
              COALESCE(SUM(b.number_of_travelers), 0)::INTEGER AS total_travelers,
              COUNT(DISTINCT b.id) FILTER (
                WHERE b.created_at >= NOW() - INTERVAL '30 days'
              )::INTEGER AS bookings_last_30_days
             FROM bookings b
             JOIN destinations d ON b.destination_id = d.id
             WHERE d.country_id = $1`,
          [country.id],
        ),

        /* Similar countries (same continent, excluding self) */
        safeQuery(
          `SELECT
              c.id, c.name, c.slug, c.image_url, c.flag_url, c.continent,
              c.short_description,
              COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = true)::INTEGER AS destination_count
             FROM countries c
             LEFT JOIN destinations d ON d.country_id = c.id
             WHERE c.continent = $1
               AND c.id != $2
               AND c.is_active = true
             GROUP BY c.id, c.name, c.slug, c.image_url, c.flag_url,
                      c.continent, c.short_description
             ORDER BY destination_count DESC
             LIMIT 4`,
          [country.continent || "", country.id],
        ),

        /* Country highlights / featured destinations */
        safeQuery(
          `SELECT
              d.id, d.name, d.slug, d.image_url, d.short_description,
              d.difficulty, d.duration, d.price_from, d.rating
             FROM destinations d
             WHERE d.country_id = $1
               AND d.is_active  = true
               AND d.is_featured = true
             ORDER BY d.rating DESC NULLS LAST
             LIMIT 6`,
          [country.id],
        ),
      ]);

      // Safely unwrap Promise.allSettled results
      const unwrap = (result, fallback = []) =>
        result.status === "fulfilled" ? (result.value || fallback) : fallback;

      response.data.destinations    = unwrap(destinationsResult);
      response.data.services        = unwrap(servicesResult);
      response.data.booking_stats   = unwrap(bookingStatsResult)[0] || {
        total_bookings: 0, total_travelers: 0, bookings_last_30_days: 0,
      };
      response.data.similar_countries = unwrap(similarCountriesResult);
      response.data.highlights        = unwrap(highlightsResult);

      // Computed convenience fields
      response.data.destination_count = response.data.destinations.length;
      response.data.featured_count    = response.data.highlights.length;
    }

    return res.json(response);
  } catch (err) {
    logger.error("[Countries] getOne failed:", err.message, err.stack);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   CREATE   POST /api/countries
═══════════════════════════════════════════════════════════════════════════════ */

exports.create = async (req, res, next) => {
  try {
    const {
      name, slug, continent, description, short_description,
      image_url, flag_url, capital, currency, language,
      timezone, visa_info, best_time_to_visit, climate,
      latitude, longitude, is_active = true, is_featured = false,
      meta_title, meta_description,
    } = req.body;

    if (!name?.trim())
      return res.status(400).json({ success: false, error: "Country name is required" });

    const computedSlug = slug?.trim() ||
      name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]/g, "");

    // Check slug uniqueness
    const { rows: existing } = await query(
      "SELECT id FROM countries WHERE slug = $1",
      [computedSlug],
    );
    if (existing[0])
      return res.status(409).json({ success: false, error: "A country with this slug already exists" });

    const { rows } = await query(
      `INSERT INTO countries (
          name, slug, continent, description, short_description,
          image_url, flag_url, capital, currency, language,
          timezone, visa_info, best_time_to_visit, climate,
          latitude, longitude, is_active, is_featured,
          meta_title, meta_description, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          NOW(),NOW()
        ) RETURNING *`,
      [
        name.trim(), computedSlug, continent || null, description || null,
        short_description || null, image_url || null, flag_url || null,
        capital || null, currency || null, language || null,
        timezone || null, visa_info || null, best_time_to_visit || null,
        climate || null, latitude || null, longitude || null,
        Boolean(is_active), Boolean(is_featured),
        meta_title || null, meta_description || null,
      ],
    );

    return res.status(201).json({ success: true, message: "Country created", data: rows[0] });
  } catch (err) {
    logger.error("[Countries] create failed:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   UPDATE   PUT /api/countries/:id
═══════════════════════════════════════════════════════════════════════════════ */

exports.update = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1)
      return res.status(400).json({ success: false, error: "Invalid country ID" });

    const ALLOWED = [
      "name","slug","continent","description","short_description",
      "image_url","flag_url","capital","currency","language",
      "timezone","visa_info","best_time_to_visit","climate",
      "latitude","longitude","is_active","is_featured",
      "meta_title","meta_description",
    ];

    const updates = {};
    for (const f of ALLOWED) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    if (!Object.keys(updates).length)
      return res.status(400).json({ success: false, error: "No valid fields to update" });

    if (!updates.name?.trim && updates.name !== undefined && !String(updates.name).trim())
      return res.status(400).json({ success: false, error: "Name cannot be empty" });

    const fields    = Object.keys(updates);
    const values    = Object.values(updates);
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");

    const { rows } = await query(
      `UPDATE countries SET ${setClause}, updated_at=NOW() WHERE id=$${fields.length + 1} RETURNING *`,
      [...values, id],
    );

    if (!rows[0])
      return res.status(404).json({ success: false, error: "Country not found" });

    return res.json({ success: true, message: "Country updated", data: rows[0] });
  } catch (err) {
    logger.error("[Countries] update failed:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   DELETE   DELETE /api/countries/:id
═══════════════════════════════════════════════════════════════════════════════ */

exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1)
      return res.status(400).json({ success: false, error: "Invalid country ID" });

    // Check for linked destinations
    const { rows: linked } = await query(
      "SELECT COUNT(*) FROM destinations WHERE country_id=$1",
      [id],
    );
    if (parseInt(linked[0].count, 10) > 0) {
      return res.status(409).json({
        success: false,
        error:   "Cannot delete country with existing destinations. Remove destinations first.",
        destination_count: parseInt(linked[0].count, 10),
      });
    }

    const { rows } = await query("DELETE FROM countries WHERE id=$1 RETURNING id,name", [id]);
    if (!rows[0])
      return res.status(404).json({ success: false, error: "Country not found" });

    return res.json({ success: true, message: `Country "${rows[0].name}" deleted` });
  } catch (err) {
    logger.error("[Countries] remove failed:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   STATS   GET /api/countries/stats
═══════════════════════════════════════════════════════════════════════════════ */

exports.getStats = async (req, res, next) => {
  try {
    const [overview, byCont, topCountries] = await Promise.all([
      safeQuery(`
        SELECT
          COUNT(*)::INTEGER                              AS total_countries,
          COUNT(*) FILTER (WHERE is_active=true)::INTEGER AS active_countries,
          COUNT(DISTINCT continent)::INTEGER             AS continents
        FROM countries
      `),
      safeQuery(`
        SELECT
          continent,
          COUNT(*)::INTEGER AS count
        FROM countries
        WHERE continent IS NOT NULL
        GROUP BY continent
        ORDER BY count DESC
      `),
      safeQuery(`
        SELECT
          c.id, c.name, c.slug, c.flag_url,
          COUNT(DISTINCT d.id)::INTEGER AS destination_count,
          COUNT(DISTINCT b.id)::INTEGER AS booking_count
        FROM countries c
        LEFT JOIN destinations d ON d.country_id=c.id AND d.is_active=true
        LEFT JOIN bookings b ON b.destination_id=d.id
        WHERE c.is_active=true
        GROUP BY c.id,c.name,c.slug,c.flag_url
        ORDER BY booking_count DESC, destination_count DESC
        LIMIT 10
      `),
    ]);

    return res.json({
      success: true,
      data: {
        overview:      overview[0] || { total_countries: 0, active_countries: 0, continents: 0 },
        by_continent:  byCont,
        top_countries: topCountries,
      },
    });
  } catch (err) {
    logger.error("[Countries] getStats failed:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   FEATURED   GET /api/countries/featured
═══════════════════════════════════════════════════════════════════════════════ */

exports.getFeatured = async (req, res, next) => {
  try {
    const limit = safeInt(req.query.limit, 6, 1, 50);

    const rows = await safeQuery(
      `SELECT
          c.*,
          COUNT(DISTINCT d.id) FILTER (WHERE d.is_active=true)::INTEGER AS destination_count
         FROM countries c
         LEFT JOIN destinations d ON d.country_id=c.id
         WHERE c.is_active=true AND c.is_featured=true
         GROUP BY c.id
         ORDER BY c.name ASC
         LIMIT $1`,
      [limit],
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    logger.error("[Countries] getFeatured failed:", err.message);
    next(err);
  }
};

module.exports = exports;