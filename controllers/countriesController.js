/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COUNTRIES CONTROLLER v3.0
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Fix: All exports verified — no undefined controller functions.
 * Every function referenced in routes/countries.js is exported here.
 *
 * Exports:
 *   getAll, getOne, create, update, remove,
 *   getStats, getFeatured, getByContinent,
 *   toggleActive, toggleFeatured, bulkDelete
 */

'use strict'

const { query } = require('../config/db')
const logger    = require('../utils/logger')

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const safeInt = (v, def = 0, min = 0, max = 99999) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def
}

/**
 * Run a query and return rows, or [] on error — never throws.
 */
const safeQuery = async (sql, params = []) => {
  try {
    const { rows } = await query(sql, params)
    return rows
  } catch (err) {
    logger.warn('[Countries] safeQuery non-fatal:', err.message)
    return []
  }
}

/**
 * Build a URL-friendly slug from a string.
 */
const toSlug = (str = '') =>
  String(str)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/--+/g, '-')

/* ─── Schema guard ───────────────────────────────────────────────────────── */

const ensureCountriesSchema = async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS countries (
        id                SERIAL PRIMARY KEY,
        name              VARCHAR(255) NOT NULL,
        slug              VARCHAR(255) UNIQUE NOT NULL,
        continent         VARCHAR(100),
        description       TEXT,
        short_description TEXT,
        image_url         VARCHAR(500),
        flag_url          VARCHAR(500),
        capital           VARCHAR(255),
        currency          VARCHAR(100),
        language          VARCHAR(255),
        timezone          VARCHAR(100),
        visa_info         TEXT,
        best_time_to_visit TEXT,
        climate           TEXT,
        latitude          NUMERIC(10,6),
        longitude         NUMERIC(10,6),
        is_active         BOOLEAN   DEFAULT true,
        is_featured       BOOLEAN   DEFAULT false,
        view_count        INTEGER   DEFAULT 0,
        meta_title        VARCHAR(255),
        meta_description  TEXT,
        created_at        TIMESTAMP DEFAULT NOW(),
        updated_at        TIMESTAMP DEFAULT NOW()
      )
    `)

    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_countries_slug      ON countries(slug)`,
      `CREATE INDEX IF NOT EXISTS idx_countries_active    ON countries(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_countries_featured  ON countries(is_featured)`,
      `CREATE INDEX IF NOT EXISTS idx_countries_continent ON countries(continent)`,
    ]
    for (const idx of indexes) await query(idx).catch(() => {})
  } catch (err) {
    logger.warn('[Countries] Schema ensure non-fatal:', err.message)
  }
}

// Run once on module load (non-blocking)
ensureCountriesSchema()

/* ═══════════════════════════════════════════════════════════════════════════
   GET ALL   GET /api/countries
═══════════════════════════════════════════════════════════════════════════ */

exports.getAll = async (req, res, next) => {
  try {
    const {
      page      = 1,
      limit     = 50,
      continent,
      search,
      is_active,
      is_featured,
      sortBy    = 'name',
      order     = 'asc',
    } = req.query

    const ALLOWED_SORT = new Set([
      'name', 'continent', 'created_at', 'view_count',
    ])

    const params  = []
    const conds   = ['1=1']
    let   pi      = 1

    if (continent) {
      conds.push(`c.continent ILIKE $${pi++}`)
      params.push(`%${continent}%`)
    }
    if (is_active !== undefined) {
      conds.push(`c.is_active = $${pi++}`)
      params.push(is_active === 'true' || is_active === true)
    }
    if (is_featured !== undefined) {
      conds.push(`c.is_featured = $${pi++}`)
      params.push(is_featured === 'true' || is_featured === true)
    }
    if (search) {
      conds.push(`(c.name ILIKE $${pi} OR c.description ILIKE $${pi} OR c.continent ILIKE $${pi})`)
      params.push(`%${search.trim()}%`)
      pi++
    }

    const where   = conds.join(' AND ')
    const sortCol = ALLOWED_SORT.has(sortBy) ? sortBy : 'name'
    const sortDir = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
    const lim     = safeInt(limit, 50, 1, 200)
    const pg      = safeInt(page,  1,  1, 9999)
    const offset  = (pg - 1) * lim

    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM countries c WHERE ${where}`, params),
      query(
        `SELECT
            c.*,
            COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = true)::INTEGER
              AS destination_count
           FROM countries c
           LEFT JOIN destinations d ON d.country_id = c.id
           WHERE ${where}
           GROUP BY c.id
           ORDER BY c.${sortCol} ${sortDir}
           LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, lim, offset],
      ),
    ])

    const total      = parseInt(countRes.rows[0].count, 10)
    const totalPages = Math.ceil(total / lim)

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
    })
  } catch (err) {
    logger.error('[Countries] getAll failed:', err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET ONE   GET /api/countries/:slug
═══════════════════════════════════════════════════════════════════════════ */

exports.getOne = async (req, res, next) => {
  try {
    const rawSlug        = req.params.slug || req.params.id || ''
    const includeRelated = ['true', '1', 'yes'].includes(
      String(req.query.includeRelated || '').toLowerCase(),
    )

    if (!rawSlug.trim()) {
      return res.status(400).json({ success: false, error: 'Country identifier required' })
    }

    const slugLower = rawSlug.toLowerCase().trim()

    // Try by slug, then name, then numeric id
    let country = null

    const bySlug = await safeQuery(
      `SELECT c.*,
              COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = true)::INTEGER AS destination_count
         FROM countries c
         LEFT JOIN destinations d ON d.country_id = c.id
         WHERE LOWER(c.slug) = $1
         GROUP BY c.id LIMIT 1`,
      [slugLower],
    )
    if (bySlug[0]) country = bySlug[0]

    if (!country) {
      const byName = await safeQuery(
        `SELECT c.*,
                COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = true)::INTEGER AS destination_count
           FROM countries c
           LEFT JOIN destinations d ON d.country_id = c.id
           WHERE LOWER(c.name) = $1
           GROUP BY c.id LIMIT 1`,
        [slugLower],
      )
      if (byName[0]) country = byName[0]
    }

    if (!country) {
      const numId = parseInt(rawSlug, 10)
      if (Number.isFinite(numId) && numId > 0) {
        const byId = await safeQuery(
          `SELECT c.*,
                  COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = true)::INTEGER AS destination_count
             FROM countries c
             LEFT JOIN destinations d ON d.country_id = c.id
             WHERE c.id = $1
             GROUP BY c.id LIMIT 1`,
          [numId],
        )
        if (byId[0]) country = byId[0]
      }
    }

    if (!country) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    // Increment view count (non-blocking)
    query(
      'UPDATE countries SET view_count = COALESCE(view_count,0) + 1 WHERE id = $1',
      [country.id],
    ).catch(() => {})

    const response = { success: true, data: { ...country } }

    if (includeRelated) {
      const [
        destinationsResult,
        servicesResult,
        bookingStatsResult,
        similarCountriesResult,
        highlightsResult,
      ] = await Promise.allSettled([
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
             ORDER BY d.is_featured DESC NULLS LAST,
                      d.booking_count DESC NULLS LAST,
                      d.name ASC`,
          [country.id],
        ),
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
          [country.continent || '', country.id],
        ),
        safeQuery(
          `SELECT
              d.id, d.name, d.slug, d.image_url, d.short_description,
              d.difficulty, d.duration, d.price_from, d.rating
             FROM destinations d
             WHERE d.country_id = $1
               AND d.is_active   = true
               AND d.is_featured = true
             ORDER BY d.rating DESC NULLS LAST
             LIMIT 6`,
          [country.id],
        ),
      ])

      const unwrap = (result, fallback = []) =>
        result.status === 'fulfilled' ? (result.value || fallback) : fallback

      response.data.destinations     = unwrap(destinationsResult)
      response.data.services         = unwrap(servicesResult)
      response.data.booking_stats    = unwrap(bookingStatsResult)[0] || {
        total_bookings: 0, total_travelers: 0, bookings_last_30_days: 0,
      }
      response.data.similar_countries = unwrap(similarCountriesResult)
      response.data.highlights        = unwrap(highlightsResult)
      response.data.destination_count = response.data.destinations.length
      response.data.featured_count    = response.data.highlights.length
    }

    return res.json(response)
  } catch (err) {
    logger.error('[Countries] getOne failed:', err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET FEATURED   GET /api/countries/featured
═══════════════════════════════════════════════════════════════════════════ */

exports.getFeatured = async (req, res, next) => {
  try {
    const limit = Math.min(safeInt(req.query.limit, 6, 1, 50), 50)

    const rows = await safeQuery(
      `SELECT
          c.*,
          COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = true)::INTEGER AS destination_count
         FROM countries c
         LEFT JOIN destinations d ON d.country_id = c.id
         WHERE c.is_active = true AND c.is_featured = true
         GROUP BY c.id
         ORDER BY c.name ASC
         LIMIT $1`,
      [limit],
    )

    return res.json({ success: true, data: rows, count: rows.length })
  } catch (err) {
    logger.error('[Countries] getFeatured failed:', err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET BY CONTINENT   GET /api/countries/continent/:continent
═══════════════════════════════════════════════════════════════════════════ */

exports.getByContinent = async (req, res, next) => {
  try {
    const continent = String(req.params.continent || '').trim()
    if (!continent) {
      return res.status(400).json({ success: false, error: 'Continent name required' })
    }

    const rows = await safeQuery(
      `SELECT
          c.*,
          COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = true)::INTEGER AS destination_count
         FROM countries c
         LEFT JOIN destinations d ON d.country_id = c.id
         WHERE c.is_active = true
           AND c.continent ILIKE $1
         GROUP BY c.id
         ORDER BY c.name ASC`,
      [`%${continent}%`],
    )

    return res.json({ success: true, data: rows, count: rows.length, continent })
  } catch (err) {
    logger.error('[Countries] getByContinent failed:', err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET STATS   GET /api/countries/stats
═══════════════════════════════════════════════════════════════════════════ */

exports.getStats = async (req, res, next) => {
  try {
    const [overview, byCont, topCountries] = await Promise.all([
      safeQuery(`
        SELECT
          COUNT(*)::INTEGER                              AS total_countries,
          COUNT(*) FILTER (WHERE is_active=true)::INTEGER AS active_countries,
          COUNT(*) FILTER (WHERE is_featured=true)::INTEGER AS featured_countries,
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
        LEFT JOIN destinations d ON d.country_id = c.id AND d.is_active = true
        LEFT JOIN bookings b     ON b.destination_id = d.id
        WHERE c.is_active = true
        GROUP BY c.id, c.name, c.slug, c.flag_url
        ORDER BY booking_count DESC, destination_count DESC
        LIMIT 10
      `),
    ])

    return res.json({
      success: true,
      data: {
        overview:      overview[0] || { total_countries: 0, active_countries: 0, continents: 0 },
        by_continent:  byCont,
        top_countries: topCountries,
      },
    })
  } catch (err) {
    logger.error('[Countries] getStats failed:', err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CREATE   POST /api/countries
═══════════════════════════════════════════════════════════════════════════ */

exports.create = async (req, res, next) => {
  try {
    const {
      name, slug, continent, description, short_description,
      image_url, flag_url, capital, currency, language,
      timezone, visa_info, best_time_to_visit, climate,
      latitude, longitude,
      is_active   = true,
      is_featured = false,
      meta_title, meta_description,
    } = req.body

    if (!String(name || '').trim()) {
      return res.status(400).json({ success: false, error: 'Country name is required' })
    }

    const computedSlug = String(slug || '').trim() || toSlug(name)

    // Check slug uniqueness
    const existing = await safeQuery(
      'SELECT id FROM countries WHERE slug = $1',
      [computedSlug],
    )
    if (existing[0]) {
      return res.status(409).json({
        success: false,
        error:   `A country with slug "${computedSlug}" already exists`,
      })
    }

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
        String(name).trim(),
        computedSlug,
        continent          || null,
        description        || null,
        short_description  || null,
        image_url          || null,
        flag_url           || null,
        capital            || null,
        currency           || null,
        language           || null,
        timezone           || null,
        visa_info          || null,
        best_time_to_visit || null,
        climate            || null,
        latitude           || null,
        longitude          || null,
        Boolean(is_active),
        Boolean(is_featured),
        meta_title         || null,
        meta_description   || null,
      ],
    )

    return res.status(201).json({
      success: true,
      message: 'Country created successfully',
      data:    rows[0],
    })
  } catch (err) {
    logger.error('[Countries] create failed:', err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   UPDATE   PUT/PATCH /api/countries/:id
═══════════════════════════════════════════════════════════════════════════ */

exports.update = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0, 1)
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid country ID' })
    }

    const ALLOWED = [
      'name', 'slug', 'continent', 'description', 'short_description',
      'image_url', 'flag_url', 'capital', 'currency', 'language',
      'timezone', 'visa_info', 'best_time_to_visit', 'climate',
      'latitude', 'longitude', 'is_active', 'is_featured',
      'meta_title', 'meta_description',
    ]

    const updates = {}
    for (const f of ALLOWED) {
      if (req.body[f] !== undefined) updates[f] = req.body[f]
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' })
    }

    if (updates.name !== undefined && !String(updates.name).trim()) {
      return res.status(400).json({ success: false, error: 'Name cannot be empty' })
    }

    const fields    = Object.keys(updates)
    const values    = Object.values(updates)
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ')

    const { rows } = await query(
      `UPDATE countries SET ${setClause}, updated_at=NOW()
       WHERE id=$${fields.length + 1} RETURNING *`,
      [...values, id],
    )

    if (!rows[0]) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    return res.json({
      success: true,
      message: 'Country updated successfully',
      data:    rows[0],
    })
  } catch (err) {
    logger.error('[Countries] update failed:', err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOGGLE ACTIVE   PATCH /api/countries/:id/toggle-active
═══════════════════════════════════════════════════════════════════════════ */

exports.toggleActive = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0, 1)
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid country ID' })
    }

    const { rows } = await query(
      `UPDATE countries SET is_active=NOT is_active, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id],
    )

    if (!rows[0]) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    return res.json({
      success: true,
      message: rows[0].is_active ? 'Country activated' : 'Country deactivated',
      data:    rows[0],
    })
  } catch (err) {
    logger.error('[Countries] toggleActive failed:', err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOGGLE FEATURED   PATCH /api/countries/:id/toggle-featured
═══════════════════════════════════════════════════════════════════════════ */

exports.toggleFeatured = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0, 1)
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid country ID' })
    }

    const { rows } = await query(
      `UPDATE countries SET is_featured=NOT is_featured, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id],
    )

    if (!rows[0]) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    return res.json({
      success: true,
      message: rows[0].is_featured ? 'Marked as featured' : 'Removed from featured',
      data:    rows[0],
    })
  } catch (err) {
    logger.error('[Countries] toggleFeatured failed:', err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   DELETE   DELETE /api/countries/:id
═══════════════════════════════════════════════════════════════════════════ */

exports.remove = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0, 1)
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid country ID' })
    }

    // Check for linked destinations
    const linked = await safeQuery(
      'SELECT COUNT(*) AS count FROM destinations WHERE country_id=$1',
      [id],
    )
    const destCount = parseInt(linked[0]?.count || 0, 10)

    if (destCount > 0) {
      return res.status(409).json({
        success:           false,
        error:             `Cannot delete: this country has ${destCount} destination(s). Remove them first.`,
        destination_count: destCount,
      })
    }

    const { rows } = await query(
      'DELETE FROM countries WHERE id=$1 RETURNING id, name',
      [id],
    )

    if (!rows[0]) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    return res.json({
      success: true,
      message: `Country "${rows[0].name}" deleted`,
      data:    { id: rows[0].id },
    })
  } catch (err) {
    logger.error('[Countries] remove failed:', err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   BULK DELETE   DELETE /api/countries (body: { ids: [] })
═══════════════════════════════════════════════════════════════════════════ */

exports.bulkDelete = async (req, res, next) => {
  try {
    const { ids } = req.body

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, error: 'ids array is required' })
    }

    const validIds = ids.map(id => parseInt(id, 10)).filter(id => Number.isFinite(id) && id > 0)
    if (!validIds.length) {
      return res.status(400).json({ success: false, error: 'No valid IDs provided' })
    }

    const { rows } = await query(
      `DELETE FROM countries WHERE id=ANY($1::INTEGER[])
         AND id NOT IN (
           SELECT DISTINCT country_id FROM destinations WHERE country_id IS NOT NULL
         )
       RETURNING id, name`,
      [validIds],
    )

    const skipped = validIds.length - rows.length

    return res.json({
      success: true,
      message: `${rows.length} country/countries deleted${skipped ? `, ${skipped} skipped (have destinations)` : ''}`,
      data:    { deleted: rows.map(r => r.id), skipped },
    })
  } catch (err) {
    logger.error('[Countries] bulkDelete failed:', err.message)
    next(err)
  }
}

module.exports = exports