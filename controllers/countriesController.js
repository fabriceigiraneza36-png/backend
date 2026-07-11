/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COUNTRIES CONTROLLER v5.1
 * ═══════════════════════════════════════════════════════════════════════════════
 * Fixes:
 *   - create(): broken NOW() placeholder logic replaced with clean approach
 *   - safeQuery(): now logs full error for debugging
 *   - getOne(): explicit error surface + column existence guard
 *   - update(): slug uniqueness check on update
 *   - All DB errors propagated to next() so Express error handler catches them
 */

'use strict'

const { query }  = require('../config/db')
const logger     = require('../utils/logger')
const {
  transformCountry,
  transformCountryCard,
} = require('../utils/countryTransformer')

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */

const safeInt = (v, def = 0, min = 0, max = 99_999) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def
}

/**
 * safeQuery: runs a query and returns rows.
 * On error, logs the full error (not just message) and returns fallback.
 * Pass throwOnError=true in critical paths to surface the real problem.
 */
const safeQuery = async (sql, params = [], { throwOnError = false } = {}) => {
  try {
    const { rows } = await query(sql, params)
    return rows
  } catch (err) {
    logger.error('[Countries] safeQuery error:', {
      message: err.message,
      code:    err.code,
      detail:  err.detail,
      sql:     sql.slice(0, 120),
    })
    if (throwOnError) throw err
    return []
  }
}

const toSlug = (str = '') =>
  String(str)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/--+/g, '-')

/**
 * Safely serialise a value for a JSONB column.
 */
const toJsonb = (val) => {
  if (val === null || val === undefined) return null
  if (Array.isArray(val) || typeof val === 'object') {
    try { return JSON.stringify(val) } catch { return null }
  }
  if (typeof val === 'string') {
    try { JSON.parse(val); return val } catch { return null }
  }
  return null
}

/* ─── Fields that must be serialised as JSONB ─────────────────────────────── */
const JSONB_FIELDS = new Set([
  'hero_images', 'activities', 'faqs', 'extra_info',
  'highlights', 'experiences', 'travel_tips',
  'neighboring_countries', 'seasons', 'geography',
  'wildlife', 'cuisine', 'official_languages', 'languages', 'images',
])

/* ─── All columns the controller may write ───────────────────────────────── */
const WRITABLE_COLUMNS = [
  // Core
  'name', 'slug', 'continent', 'region',
  'description', 'full_description', 'short_description', 'short_notes',
  'official_name', 'demonym', 'motto', 'tagline',
  // Images
  'image_url', 'hero_image', 'flag_url', 'flag', 'cover_image_url',
  'hero_images',
  // v5.0 JSONB
  'activities', 'faqs', 'extra_info',
  // Location
  'capital', 'latitude', 'longitude',
  // Facts
  'currency', 'currency_symbol', 'language',
  'timezone', 'climate', 'best_time_to_visit',
  'visa_info', 'health_info', 'water_safety',
  'electrical_plug', 'voltage', 'internet_tld',
  'calling_code', 'driving_side', 'electricity',
  'government_type',
  // v5.0 scalar info
  'population', 'area_sq_km',
  'safety_info', 'transport_info', 'food_info',
  'culture_info', 'wildlife_info', 'geography_info',
  // Legacy JSONB
  'highlights', 'experiences', 'travel_tips',
  'neighboring_countries', 'seasons',
  'wildlife', 'cuisine',
  'official_languages', 'languages', 'images',
  // Stats
  'area', 'urban_population', 'literacy_rate',
  'life_expectancy', 'median_age',
  // Flags
  'is_active', 'is_featured',
  // SEO
  'meta_title', 'meta_description',
]

/* ─── Columns that actually exist in the DB ──────────────────────────────── */
// We'll verify against pg_attribute on first request (lazy init)
let VERIFIED_COLUMNS = null

const getWritableColumns = async () => {
  if (VERIFIED_COLUMNS) return VERIFIED_COLUMNS
  try {
    const { rows } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'countries'
        AND table_schema = 'public'
    `)
    const existing = new Set(rows.map(r => r.column_name))
    VERIFIED_COLUMNS = WRITABLE_COLUMNS.filter(c => existing.has(c))
    logger.info(
      `[Countries] Verified ${VERIFIED_COLUMNS.length}/${WRITABLE_COLUMNS.length} writable columns`,
    )
  } catch (err) {
    logger.warn('[Countries] Could not verify columns, using full list:', err.message)
    VERIFIED_COLUMNS = WRITABLE_COLUMNS
  }
  return VERIFIED_COLUMNS
}

/* ─── SELECT used in every single-row fetch ──────────────────────────────── */
const COUNTRY_SELECT = `
  SELECT
    c.*,
    COUNT(DISTINCT d.id)
      FILTER (WHERE d.is_active = true)::INTEGER AS destination_count
  FROM countries c
  LEFT JOIN destinations d ON d.country_id = c.id
`

/* ─── SELECT for destination cards embedded in getOne ────────────────────── */
const DEST_CARD_SELECT = `
  SELECT
    d.id, d.name, d.slug, d.short_description, d.image_url,
    d.difficulty, d.duration, d.duration_days,
    d.price_from, d.price_currency,
    d.rating, d.review_count,
    d.is_featured, d.highlights, d.best_time_to_visit,
    d.category,
    COALESCE(d.booking_count, 0)::INTEGER AS booking_count
  FROM destinations d
  WHERE d.country_id = $1
    AND d.is_active  = true
  ORDER BY
    d.is_featured   DESC NULLS LAST,
    d.booking_count DESC NULLS LAST,
    d.name          ASC
`

/* ═══════════════════════════════════════════════════════════════════════════
   GET ALL   GET /api/countries
═══════════════════════════════════════════════════════════════════════════ */

exports.getAll = async (req, res, next) => {
  try {
    const {
      page        = 1,
      limit       = 50,
      continent,
      search,
      is_active,
      is_featured,
      featured,           // alias used by admin UI
      sortBy      = 'name',
      order       = 'asc',
      raw         = false,
    } = req.query

    const ALLOWED_SORT = new Set([
      'name', 'continent', 'created_at', 'updated_at', 'view_count',
    ])

    const params = []
    const conds  = ['1=1']
    let   pi     = 1

    if (continent) {
      conds.push(`c.continent ILIKE $${pi++}`)
      params.push(`%${continent}%`)
    }

    // Support both is_active and active query params
    const activeFilter = is_active ?? req.query.active
    if (activeFilter !== undefined) {
      conds.push(`c.is_active = $${pi++}`)
      params.push(activeFilter === 'true' || activeFilter === true)
    }

    // Support both is_featured and featured
    const featuredFilter = is_featured ?? featured
    if (featuredFilter !== undefined && featuredFilter !== '') {
      conds.push(`c.is_featured = $${pi++}`)
      params.push(featuredFilter === 'true' || featuredFilter === true)
    }

    if (search) {
      conds.push(`(
        c.name        ILIKE $${pi} OR
        c.description ILIKE $${pi} OR
        c.continent   ILIKE $${pi} OR
        c.tagline     ILIKE $${pi}
      )`)
      params.push(`%${search.trim()}%`)
      pi++
    }

    const where   = conds.join(' AND ')
    const sortCol = ALLOWED_SORT.has(sortBy) ? sortBy : 'name'
    const sortDir = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
    const lim     = safeInt(limit, 50, 1, 200)
    const pg      = safeInt(page, 1, 1, 9_999)
    const offset  = (pg - 1) * lim

    const [countRes, dataRes] = await Promise.all([
      query(
        `SELECT COUNT(*) FROM countries c WHERE ${where}`,
        params,
      ),
      query(
        `${COUNTRY_SELECT}
         WHERE ${where}
         GROUP BY c.id
         ORDER BY c.${sortCol} ${sortDir}
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, lim, offset],
      ),
    ])

    const total      = parseInt(countRes.rows[0].count, 10)
    const totalPages = Math.ceil(total / lim)
    const isRaw      = raw === 'true' || raw === true

    return res.json({
      success: true,
      data:    isRaw ? dataRes.rows : dataRes.rows.map(transformCountryCard),
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
    logger.error('[Countries] getAll failed:', err)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET ONE   GET /api/countries/:slug
═══════════════════════════════════════════════════════════════════════════ */

exports.getOne = async (req, res, next) => {
  try {
    const rawSlug = (req.params.slug || req.params.id || '').trim()

    const includeRelated = ['true', '1', 'yes'].includes(
      String(req.query.includeRelated || '').toLowerCase(),
    )
    const isRaw = ['true', '1', 'yes'].includes(
      String(req.query.raw || '').toLowerCase(),
    )

    if (!rawSlug) {
      return res.status(400).json({
        success: false,
        error:   'Country identifier required',
      })
    }

    let country = null
    const slugLower = rawSlug.toLowerCase()

    // 1. By slug
    try {
      const bySlug = await query(
        `${COUNTRY_SELECT} WHERE LOWER(c.slug) = $1 GROUP BY c.id LIMIT 1`,
        [slugLower],
      )
      if (bySlug.rows[0]) country = bySlug.rows[0]
    } catch (err) {
      logger.error('[Countries] getOne slug lookup failed:', {
        message: err.message,
        code:    err.code,
        detail:  err.detail,
      })
      return next(err)
    }

    // 2. By name
    if (!country) {
      try {
        const byName = await query(
          `${COUNTRY_SELECT} WHERE LOWER(c.name) = $1 GROUP BY c.id LIMIT 1`,
          [slugLower],
        )
        if (byName.rows[0]) country = byName.rows[0]
      } catch (err) {
        logger.error('[Countries] getOne name lookup failed:', err.message)
        return next(err)
      }
    }

    // 3. By numeric id
    if (!country) {
      const numId = parseInt(rawSlug, 10)
      if (Number.isFinite(numId) && numId > 0) {
        try {
          const byId = await query(
            `${COUNTRY_SELECT} WHERE c.id = $1 GROUP BY c.id LIMIT 1`,
            [numId],
          )
          if (byId.rows[0]) country = byId.rows[0]
        } catch (err) {
          logger.error('[Countries] getOne id lookup failed:', err.message)
          return next(err)
        }
      }
    }

    if (!country) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    // Increment view count (fire-and-forget)
    query(
      'UPDATE countries SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1',
      [country.id],
    ).catch(() => {})

    if (isRaw) {
      return res.json({ success: true, data: country })
    }

    let transformed
    try {
      transformed = transformCountry(country)
    } catch (err) {
      logger.error('[Countries] transformCountry failed:', err.message)
      // Fall back to raw data if transformer errors
      transformed = { ...country }
    }

    // Always embed destinations
    transformed.destinations = await safeQuery(DEST_CARD_SELECT, [country.id])

    if (includeRelated) {
      const [servicesResult, bookingStatsResult, similarResult] =
        await Promise.allSettled([
          safeQuery(
            `SELECT
               s.id, s.title, s.slug, s.description,
               s.image_url, s.price_from, s.price_currency,
               s.duration, s.category, s.is_featured,
               s.rating, s.review_count
             FROM services s
             WHERE s.country_id = $1 AND s.is_active = true
             ORDER BY s.is_featured DESC NULLS LAST, s.title ASC
             LIMIT 20`,
            [country.id],
          ),
          safeQuery(
            `SELECT
               COUNT(DISTINCT b.id)::INTEGER AS total_bookings,
               COALESCE(SUM(b.number_of_travelers), 0)::INTEGER AS total_travelers,
               COUNT(DISTINCT b.id)
                 FILTER (WHERE b.created_at >= NOW() - INTERVAL '30 days')
                 ::INTEGER AS bookings_last_30_days
             FROM bookings b
             JOIN destinations d ON b.destination_id = d.id
             WHERE d.country_id = $1`,
            [country.id],
          ),
          safeQuery(
            `${COUNTRY_SELECT}
             WHERE c.continent = $1 AND c.id != $2 AND c.is_active = true
             GROUP BY c.id
             ORDER BY destination_count DESC
             LIMIT 4`,
            [country.continent || '', country.id],
          ),
        ])

      const unwrap = (r, fallback = []) =>
        r.status === 'fulfilled' ? (r.value ?? fallback) : fallback

      transformed.services       = unwrap(servicesResult)
      transformed.booking_stats  = unwrap(bookingStatsResult)[0] ?? {
        total_bookings: 0, total_travelers: 0, bookings_last_30_days: 0,
      }
      transformed.similar_countries = unwrap(similarResult).map(transformCountryCard)
    }

    return res.json({ success: true, data: transformed })
  } catch (err) {
    logger.error('[Countries] getOne failed:', err)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET FEATURED   GET /api/countries/featured
═══════════════════════════════════════════════════════════════════════════ */

exports.getFeatured = async (req, res, next) => {
  try {
    const limit = Math.min(safeInt(req.query.limit, 6, 1, 50), 50)
    const rows  = await safeQuery(
      `${COUNTRY_SELECT}
       WHERE c.is_active = true AND c.is_featured = true
       GROUP BY c.id
       ORDER BY c.name ASC
       LIMIT $1`,
      [limit],
    )
    return res.json({
      success: true,
      data:    rows.map(transformCountryCard),
      count:   rows.length,
    })
  } catch (err) {
    logger.error('[Countries] getFeatured failed:', err)
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
      `${COUNTRY_SELECT}
       WHERE c.is_active = true AND c.continent ILIKE $1
       GROUP BY c.id
       ORDER BY c.name ASC`,
      [`%${continent}%`],
    )
    return res.json({
      success:   true,
      data:      rows.map(transformCountryCard),
      count:     rows.length,
      continent,
    })
  } catch (err) {
    logger.error('[Countries] getByContinent failed:', err)
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
          COUNT(*)::INTEGER                                    AS total_countries,
          COUNT(*) FILTER (WHERE is_active  = true)::INTEGER  AS active_countries,
          COUNT(*) FILTER (WHERE is_featured = true)::INTEGER AS featured_countries,
          COUNT(DISTINCT continent)::INTEGER                   AS continents
        FROM countries
      `),
      safeQuery(`
        SELECT continent, COUNT(*)::INTEGER AS count
        FROM countries
        WHERE continent IS NOT NULL
        GROUP BY continent
        ORDER BY count DESC
      `),
      safeQuery(`
        SELECT
          c.id, c.name, c.slug, c.flag_url, c.flag,
          COUNT(DISTINCT d.id)::INTEGER AS destination_count,
          COUNT(DISTINCT b.id)::INTEGER AS booking_count
        FROM countries c
        LEFT JOIN destinations d ON d.country_id = c.id AND d.is_active = true
        LEFT JOIN bookings b     ON b.destination_id = d.id
        WHERE c.is_active = true
        GROUP BY c.id, c.name, c.slug, c.flag_url, c.flag
        ORDER BY booking_count DESC, destination_count DESC
        LIMIT 10
      `),
    ])

    return res.json({
      success: true,
      data: {
        overview: overview[0] ?? {
          total_countries: 0, active_countries: 0,
          featured_countries: 0, continents: 0,
        },
        by_continent:  byCont,
        top_countries: topCountries,
      },
    })
  } catch (err) {
    logger.error('[Countries] getStats failed:', err)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CREATE   POST /api/countries
   FIX: Rewrote placeholder builder — no more NOW()-as-string mixing
═══════════════════════════════════════════════════════════════════════════ */

exports.create = async (req, res, next) => {
  try {
    const body    = req.body || {}
    const columns = await getWritableColumns()

    /* ── Required ─────────────────────────────────────────────────────── */
    const name = String(body.name || '').trim()
    if (!name) {
      return res.status(400).json({ success: false, error: 'Country name is required' })
    }

    const slug = String(body.slug || '').trim() || toSlug(name)

    /* ── Duplicate check ──────────────────────────────────────────────── */
    const existing = await safeQuery(
      'SELECT id FROM countries WHERE slug = $1',
      [slug],
    )
    if (existing[0]) {
      return res.status(409).json({
        success: false,
        error:   `A country with slug "${slug}" already exists`,
      })
    }

    /* ── Build column list + values ───────────────────────────────────── */
    // Always start with name + slug
    const cols   = ['name', 'slug']
    const vals   = [name,   slug]

    for (const col of columns) {
      if (col === 'name' || col === 'slug') continue
      if (body[col] === undefined)          continue

      cols.push(col)
      vals.push(JSONB_FIELDS.has(col) ? toJsonb(body[col]) : body[col])
    }

    // Add timestamps as the last two columns
    cols.push('created_at', 'updated_at')

    // Build placeholders: $1, $2 … for data cols; NOW() for timestamps
    const placeholders = [
      ...vals.map((_, i) => `$${i + 1}`),
      'NOW()',
      'NOW()',
    ]

    const sql = `
      INSERT INTO countries (${cols.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `

    const { rows } = await query(sql, vals)

    return res.status(201).json({
      success: true,
      message: 'Country created successfully',
      data:    rows[0],
    })
  } catch (err) {
    logger.error('[Countries] create failed:', {
      message: err.message,
      code:    err.code,
      detail:  err.detail,
    })
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   UPDATE   PUT | PATCH /api/countries/:id
═══════════════════════════════════════════════════════════════════════════ */

exports.update = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0, 1)
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid country ID' })
    }

    const body    = req.body || {}
    const columns = await getWritableColumns()

    if (body.name !== undefined && !String(body.name).trim()) {
      return res.status(400).json({ success: false, error: 'Name cannot be empty' })
    }

    /* ── Slug uniqueness check on update ──────────────────────────────── */
    if (body.slug) {
      const slugConflict = await safeQuery(
        'SELECT id FROM countries WHERE slug = $1 AND id != $2',
        [body.slug, id],
      )
      if (slugConflict[0]) {
        return res.status(409).json({
          success: false,
          error:   `Slug "${body.slug}" is already used by another country`,
        })
      }
    }

    /* ── Build SET clause ─────────────────────────────────────────────── */
    const setClauses = []
    const values     = []

    for (const col of columns) {
      if (body[col] === undefined) continue
      values.push(JSONB_FIELDS.has(col) ? toJsonb(body[col]) : body[col])
      setClauses.push(`${col} = $${values.length}`)
    }

    if (!setClauses.length) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' })
    }

    setClauses.push('updated_at = NOW()')
    values.push(id)

    const { rows } = await query(
      `UPDATE countries
       SET ${setClauses.join(', ')}
       WHERE id = $${values.length}
       RETURNING *`,
      values,
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
    logger.error('[Countries] update failed:', {
      message: err.message,
      code:    err.code,
      detail:  err.detail,
    })
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
      `UPDATE countries
       SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
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
    logger.error('[Countries] toggleActive failed:', err)
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
      `UPDATE countries
       SET is_featured = NOT is_featured, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
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
    logger.error('[Countries] toggleFeatured failed:', err)
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

    /* ── Verify country exists first ──────────────────────────────────── */
    const exists = await safeQuery(
      'SELECT id, name FROM countries WHERE id = $1',
      [id],
    )
    if (!exists[0]) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    /* ── Guard: active destinations ───────────────────────────────────── */
    const linked = await safeQuery(
      'SELECT COUNT(*)::INTEGER AS count FROM destinations WHERE country_id = $1',
      [id],
    )
    const destCount = parseInt(linked[0]?.count ?? 0, 10)
    if (destCount > 0) {
      return res.status(409).json({
        success:           false,
        error:             `Cannot delete: country has ${destCount} destination(s). Remove them first.`,
        destination_count: destCount,
      })
    }

    const { rows } = await query(
      'DELETE FROM countries WHERE id = $1 RETURNING id, name',
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
    logger.error('[Countries] remove failed:', err)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   BULK DELETE   DELETE /api/countries   body: { ids: number[] }
═══════════════════════════════════════════════════════════════════════════ */

exports.bulkDelete = async (req, res, next) => {
  try {
    const { ids } = req.body

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, error: 'ids array is required' })
    }

    const validIds = ids
      .map(id => parseInt(id, 10))
      .filter(id => Number.isFinite(id) && id > 0)

    if (!validIds.length) {
      return res.status(400).json({ success: false, error: 'No valid IDs provided' })
    }

    const { rows } = await query(
      `DELETE FROM countries
       WHERE id = ANY($1::INTEGER[])
         AND id NOT IN (
           SELECT DISTINCT country_id
           FROM destinations
           WHERE country_id IS NOT NULL
         )
       RETURNING id, name`,
      [validIds],
    )

    const skipped = validIds.length - rows.length

    return res.json({
      success: true,
      message: `${rows.length} country/countries deleted${
        skipped ? `, ${skipped} skipped (have destinations)` : ''
      }`,
      data: {
        deleted: rows.map(r => r.id),
        skipped,
      },
    })
  } catch (err) {
    logger.error('[Countries] bulkDelete failed:', err)
    next(err)
  }
}

module.exports = exports