// controllers/countriesController.js
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COUNTRIES CONTROLLER v6.0
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Full support for all country fields returned by the API:
 *
 *   Core identity   : name, slug, official_name, demonym, motto, tagline, flag,
 *                     flag_url, continent, region, sub_region, capital
 *
 *   Descriptions    : description, full_description, short_description,
 *                     short_notes, best_time_to_visit
 *
 *   Nested JSONB    : geography, wildlife, cuisine, climate_detail,
 *                     key_facts, government, practical_info, extra_info,
 *                     hero_images (array of objects), activities, faqs, seasons
 *
 *   Flat TEXT[]     : languages, official_languages, highlights, experiences,
 *                     travel_tips, neighboring_countries, images
 *
 *   Media           : image_url, cover_image_url, hero_image, flag_url,
 *                     gallery (JSONB array of objects)
 *
 *   Numeric / stats : population, area, area_sq_km, latitude, longitude,
 *                     urban_population, literacy_rate, life_expectancy,
 *                     median_age, view_count, destination_count
 *
 *   Flags           : is_active, is_featured
 *
 * Key design decisions:
 *
 *  • JSONB_FIELDS  — always JSON.stringify'd before passing to pg
 *  • ARRAY_FIELDS  — always passed as native JS arrays (TEXT[])
 *  • prepareValue() is the single point that enforces this
 *  • getWritableColumns() introspects the live schema and caches the result
 *  • ensureCountriesSchema() is exported for server.js boot-time use
 */

'use strict'

const { query }  = require('../config/db')
const logger     = require('../utils/logger')
const {
  transformCountry,
  transformCountryCard,
} = require('../utils/countryTransformer')

/* ═══════════════════════════════════════════════════════════════════════════
   TINY HELPERS
═══════════════════════════════════════════════════════════════════════════ */

/** Clamp an integer; return def when the value is not finite. */
const safeInt = (v, def = 0, min = 0, max = 99_999) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def
}

/** Run a query; on error log fully and return [] (or rethrow). */
const safeQuery = async (sql, params = [], { throwOnError = false } = {}) => {
  try {
    const { rows } = await query(sql, params)
    return rows
  } catch (err) {
    logger.error('[Countries] safeQuery error:', {
      message: err.message,
      code:    err.code,
      detail:  err.detail,
      hint:    err.hint,
      where:   err.where,
      sql:     sql.slice(0, 200),
    })
    if (throwOnError) throw err
    return []
  }
}

/** Convert a string to a URL-safe slug. */
const toSlug = (str = '') =>
  String(str)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/--+/g, '-')

/**
 * Parse a value that might be:
 *   • Already a JS array / object  → return as-is
 *   • A JSON string '["a","b"]'    → parse and return the array
 *   • A plain scalar string        → return as-is
 *   • null / undefined             → return null
 */
const parseIfJsonString = (val) => {
  if (val === null || val === undefined) return null
  if (typeof val !== 'string')          return val
  const trimmed = val.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed) } catch { /* fall through */ }
  }
  return val
}

/* ═══════════════════════════════════════════════════════════════════════════
   FIELD TYPE REGISTRY
═══════════════════════════════════════════════════════════════════════════ */

/**
 * JSONB columns — value is JSON.stringify'd before the pg call.
 * These hold structured objects / arrays-of-objects.
 */
const JSONB_FIELDS = new Set([
  // New rich fields
  'geography',       // { terrain, highest_point, lakes[], forests[], volcanoes[] }
  'wildlife',        // { primates[], big_five[], birds[] }
  'cuisine',         // { famous_dishes[], staples[], beverages[] }
  'climate_detail',  // { best_time, seasons: { 'Dry Season': {...}, ... } }
  'key_facts',       // { urban_population, literacy_rate, life_expectancy }
  'government',      // { type }
  'practical_info',  // { electricity:{plug_type,voltage}, water, connectivity:{internet_tld}, driving_side }
  'extra_info',      // { driving_side, water_safety, ... }
  // Legacy / existing
  'hero_images',     // array of { url, caption } objects
  'gallery',         // array of { url, caption, source } objects
  'activities',
  'faqs',
  'seasons',
])

/**
 * TEXT[] columns — must be passed as a native JS array.
 * Never JSON.stringify these; pg rejects a stringified array for TEXT[].
 */
const ARRAY_FIELDS = new Set([
  'highlights',
  'experiences',
  'travel_tips',
  'neighboring_countries',
  'images',
  'languages',
  'official_languages',
])

/* ═══════════════════════════════════════════════════════════════════════════
   WRITABLE COLUMN LIST
   All columns the controller may write.  Filtered against live schema by
   getWritableColumns() before any INSERT / UPDATE.
═══════════════════════════════════════════════════════════════════════════ */

const WRITABLE_COLUMNS = [
  /* ── identity ─────────────────────────────────────────────────────── */
  'name', 'slug', 'official_name', 'demonym', 'motto', 'tagline',
  'continent', 'region', 'sub_region', 'capital', 'flag', 'flag_url',

  /* ── descriptions ─────────────────────────────────────────────────── */
  'description', 'full_description', 'short_description',
  'short_notes', 'best_time_to_visit',

  /* ── flat contact / travel fields ────────────────────────────────── */
  'currency', 'currency_symbol', 'language',
  'timezone', 'climate',
  'visa_info', 'health_info', 'water_safety',
  'electrical_plug', 'voltage', 'internet_tld',
  'calling_code', 'driving_side', 'electricity',
  'government_type',

  /* ── media ────────────────────────────────────────────────────────── */
  'image_url', 'cover_image_url', 'hero_image',

  /* ── coordinates ──────────────────────────────────────────────────── */
  'latitude', 'longitude',

  /* ── numeric stats ────────────────────────────────────────────────── */
  'population', 'area', 'area_sq_km',
  'urban_population', 'literacy_rate', 'life_expectancy', 'median_age',

  /* ── misc text ────────────────────────────────────────────────────── */
  'safety_info', 'transport_info', 'food_info',
  'culture_info', 'wildlife_info', 'geography_info',

  /* ── TEXT[] arrays ────────────────────────────────────────────────── */
  'highlights', 'experiences', 'travel_tips',
  'neighboring_countries', 'images',
  'languages', 'official_languages',

  /* ── JSONB (new rich fields) ─────────────────────────────────────── */
  'geography',
  'wildlife',
  'cuisine',
  'climate_detail',
  'key_facts',
  'government',
  'practical_info',
  'extra_info',

  /* ── JSONB (legacy) ──────────────────────────────────────────────── */
  'hero_images',
  'gallery',
  'activities',
  'faqs',
  'seasons',

  /* ── flags ────────────────────────────────────────────────────────── */
  'is_active', 'is_featured',

  /* ── seo ──────────────────────────────────────────────────────────── */
  'meta_title', 'meta_description',
]

/* ─── Column cache ───────────────────────────────────────────────────────── */

/** null = not yet loaded */
let VERIFIED_COLUMNS = null

/** Map<columnName, { data_type, udt_name }> */
let COLUMN_TYPE_MAP  = null

/**
 * Returns the subset of WRITABLE_COLUMNS that actually exist in the DB.
 * Also builds COLUMN_TYPE_MAP for runtime type-aware serialisation.
 * Result is cached for the process lifetime (reset by ensureCountriesSchema).
 */
const getWritableColumns = async () => {
  if (VERIFIED_COLUMNS) return VERIFIED_COLUMNS

  try {
    const { rows } = await query(
      `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
       WHERE table_name   = 'countries'
         AND table_schema = 'public'`,
    )

    const existing  = new Set(rows.map(r => r.column_name))
    COLUMN_TYPE_MAP = {}

    for (const r of rows) {
      COLUMN_TYPE_MAP[r.column_name] = {
        data_type: r.data_type.toLowerCase(),
        udt_name:  r.udt_name.toLowerCase(),
      }
    }

    VERIFIED_COLUMNS = WRITABLE_COLUMNS.filter(c => existing.has(c))

    logger.info(
      `[Countries] Column verification: ${VERIFIED_COLUMNS.length} writable ` +
      `(${WRITABLE_COLUMNS.length - VERIFIED_COLUMNS.length} not in DB)`,
    )
  } catch (err) {
    logger.error('[Countries] Could not introspect schema, using full list:', err.message)
    VERIFIED_COLUMNS = [...WRITABLE_COLUMNS]
    COLUMN_TYPE_MAP  = {}
  }

  return VERIFIED_COLUMNS
}

/* ═══════════════════════════════════════════════════════════════════════════
   VALUE SERIALISER
═══════════════════════════════════════════════════════════════════════════ */

/**
 * Prepare a value for a pg parameter based on the column's DB type.
 *
 *  JSONB  → JSON.stringify (raw JS objects / arrays must never go directly to pg)
 *  ARRAY  → native JS array  (parse JSON strings first; pg TEXT[] rejects strings)
 *  Scalar → pass through
 */
const prepareValue = (col, val) => {
  if (val === null || val === undefined) return null

  /* ── JSONB ──────────────────────────────────────────────────────────── */
  const typeInfo = COLUMN_TYPE_MAP?.[col]
  const isJsonb  =
    JSONB_FIELDS.has(col)                        ||
    typeInfo?.data_type === 'jsonb'              ||
    typeInfo?.udt_name  === 'jsonb'

  if (isJsonb) {
    const parsed = parseIfJsonString(val)
    try { return JSON.stringify(parsed) } catch { return null }
  }

  /* ── TEXT[] / ARRAY ─────────────────────────────────────────────────── */
  const isArray =
    ARRAY_FIELDS.has(col)                        ||
    typeInfo?.data_type === 'array'              ||
    (typeInfo?.udt_name ?? '').startsWith('_')   // pg udt_name for arrays starts with _

  if (isArray) {
    const parsed = parseIfJsonString(val)
    if (Array.isArray(parsed)) return parsed
    if (typeof parsed === 'string' && parsed.trim() !== '') return [parsed]
    return null
  }

  /* ── Scalar ─────────────────────────────────────────────────────────── */
  return val
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHARED SQL FRAGMENTS
═══════════════════════════════════════════════════════════════════════════ */

const COUNTRY_SELECT = `
  SELECT
    c.*,
    COUNT(DISTINCT d.id)
      FILTER (WHERE d.is_active = true)::INTEGER AS destination_count
  FROM countries c
  LEFT JOIN destinations d ON d.country_id = c.id
`

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
   SCHEMA BOOTSTRAP
   Exported so server.js can call it once at startup.
═══════════════════════════════════════════════════════════════════════════ */

exports.ensureCountriesSchema = async () => {
  try {
    /* ── Base table ─────────────────────────────────────────────────── */
    await query(`
      CREATE TABLE IF NOT EXISTS countries (
        id                  SERIAL PRIMARY KEY,

        -- Identity
        name                TEXT NOT NULL,
        slug                TEXT NOT NULL UNIQUE,
        official_name       TEXT,
        demonym             TEXT,
        motto               TEXT,
        tagline             TEXT,
        flag                TEXT,
        flag_url            TEXT,
        continent           TEXT,
        region              TEXT,
        sub_region          TEXT,
        capital             TEXT,

        -- Descriptions
        description         TEXT,
        full_description    TEXT,
        short_description   TEXT,
        short_notes         TEXT,
        best_time_to_visit  TEXT,

        -- Practical travel (flat)
        currency            TEXT,
        currency_symbol     TEXT,
        language            TEXT,
        timezone            TEXT,
        climate             TEXT,
        visa_info           TEXT,
        health_info         TEXT,
        water_safety        TEXT,
        electrical_plug     TEXT,
        voltage             TEXT,
        internet_tld        TEXT,
        calling_code        TEXT,
        driving_side        TEXT,
        electricity         TEXT,
        government_type     TEXT,

        -- Media
        image_url           TEXT,
        cover_image_url     TEXT,
        hero_image          TEXT,

        -- Coordinates
        latitude            NUMERIC(10, 7),
        longitude           NUMERIC(10, 7),

        -- Numeric stats
        population          BIGINT,
        area                NUMERIC(15, 2),
        area_sq_km          NUMERIC(15, 2),
        urban_population    BIGINT,
        literacy_rate       NUMERIC(5, 2),
        life_expectancy     NUMERIC(5, 2),
        median_age          NUMERIC(5, 2),

        -- Misc text info
        safety_info         TEXT,
        transport_info      TEXT,
        food_info           TEXT,
        culture_info        TEXT,
        wildlife_info       TEXT,
        geography_info      TEXT,

        -- TEXT[] arrays
        highlights          TEXT[],
        experiences         TEXT[],
        travel_tips         TEXT[],
        neighboring_countries TEXT[],
        images              TEXT[],
        languages           TEXT[],
        official_languages  TEXT[],

        -- JSONB — rich structured data
        geography           JSONB,   -- { terrain, highest_point, lakes[], forests[], volcanoes[] }
        wildlife            JSONB,   -- { primates[], big_five[], birds[] }
        cuisine             JSONB,   -- { famous_dishes[], staples[], beverages[] }
        climate_detail      JSONB,   -- { best_time, seasons: { 'Dry Season': {months,note}, ... } }
        key_facts           JSONB,   -- { urban_population, literacy_rate, life_expectancy }
        government          JSONB,   -- { type }
        practical_info      JSONB,   -- { electricity:{plug_type,voltage}, water, connectivity:{internet_tld}, driving_side }
        extra_info          JSONB,   -- { driving_side, water_safety, ... }
        hero_images         JSONB,   -- [{ url, caption }]
        gallery             JSONB,   -- [{ url, caption, source }]
        activities          JSONB,
        faqs                JSONB,
        seasons             JSONB,

        -- Flags
        is_active           BOOLEAN NOT NULL DEFAULT true,
        is_featured         BOOLEAN NOT NULL DEFAULT false,

        -- SEO
        meta_title          TEXT,
        meta_description    TEXT,

        -- Counters
        view_count          INTEGER NOT NULL DEFAULT 0,

        -- Timestamps
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    /* ── Migrations: add columns that may be missing in older installs ── */
    const alterations = [
      // Identity
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS demonym           TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS motto             TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS flag              TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS flag_url          TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS sub_region        TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS capital           TEXT`,

      // Descriptions
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS full_description  TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS short_description TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS short_notes       TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS best_time_to_visit TEXT`,

      // Media
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS cover_image_url  TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS hero_image        TEXT`,

      // Practical flat
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS water_safety      TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS electrical_plug   TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS voltage           TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS internet_tld      TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS calling_code      TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS driving_side      TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS electricity       TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS government_type   TEXT`,

      // Numeric
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS area_sq_km        NUMERIC(15,2)`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS urban_population   BIGINT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS literacy_rate      NUMERIC(5,2)`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS life_expectancy    NUMERIC(5,2)`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS median_age         NUMERIC(5,2)`,

      // Misc text
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS safety_info        TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS transport_info     TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS food_info          TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS culture_info       TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS wildlife_info      TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS geography_info     TEXT`,

      // TEXT[]
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS images             TEXT[]`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS official_languages TEXT[]`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS neighboring_countries TEXT[]`,

      // JSONB — new rich fields
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS geography          JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS wildlife           JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS cuisine            JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS climate_detail     JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS key_facts          JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS government         JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS practical_info     JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS extra_info         JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS gallery            JSONB`,

      // JSONB — legacy
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS hero_images        JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS activities         JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS faqs               JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS seasons            JSONB`,

      // Counters / SEO
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS view_count         INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS meta_title         TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS meta_description   TEXT`,
    ]

    for (const sql of alterations) {
      await query(sql).catch(err =>
        logger.warn('[Countries] ALTER skipped:', err.message),
      )
    }

    /* ── Indexes ─────────────────────────────────────────────────────── */
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_countries_slug        ON countries (slug)`,
      `CREATE INDEX IF NOT EXISTS idx_countries_continent   ON countries (continent)`,
      `CREATE INDEX IF NOT EXISTS idx_countries_is_active   ON countries (is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_countries_is_featured ON countries (is_featured)`,
      `CREATE INDEX IF NOT EXISTS idx_countries_name        ON countries (name)`,
    ]

    for (const sql of indexes) {
      await query(sql).catch(err =>
        logger.warn('[Countries] INDEX skipped:', err.message),
      )
    }

    /* ── Reset column cache so getWritableColumns() re-reads ────────── */
    VERIFIED_COLUMNS = null
    COLUMN_TYPE_MAP  = null

    // Pre-warm cache
    await getWritableColumns()

    logger.info('[Countries] Schema ready ✅')
  } catch (err) {
    logger.error('[Countries] ensureCountriesSchema failed:', err.message)
    throw err
  }
}

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
      featured,
      sortBy      = 'name',
      order       = 'asc',
      raw         = false,
    } = req.query

    const ALLOWED_SORT = new Set([
      'name', 'continent', 'created_at', 'updated_at', 'view_count', 'population',
    ])

    const params = []
    const conds  = ['1=1']
    let pi = 1

    if (continent) {
      conds.push(`c.continent ILIKE $${pi++}`)
      params.push(`%${continent}%`)
    }

    const activeFilter = is_active ?? req.query.active
    if (activeFilter !== undefined) {
      conds.push(`c.is_active = $${pi++}`)
      params.push(activeFilter === 'true' || activeFilter === true)
    }

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
        c.tagline     ILIKE $${pi} OR
        c.capital     ILIKE $${pi}
      )`)
      params.push(`%${search.trim()}%`)
      pi++
    }

    const where   = conds.join(' AND ')
    const sortCol = ALLOWED_SORT.has(sortBy) ? sortBy : 'name'
    const sortDir = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
    const lim     = safeInt(limit, 50, 1, 200)
    const pg      = safeInt(page,   1, 1, 9_999)
    const offset  = (pg - 1) * lim

    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM countries c WHERE ${where}`, params),
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
      return res.status(400).json({ success: false, error: 'Country identifier required' })
    }

    let country = null
    const lower = rawSlug.toLowerCase()

    // 1 — by slug
    try {
      const r = await query(
        `${COUNTRY_SELECT} WHERE LOWER(c.slug) = $1 GROUP BY c.id LIMIT 1`,
        [lower],
      )
      if (r.rows[0]) country = r.rows[0]
    } catch (err) {
      logger.error('[Countries] getOne slug lookup:', err)
      return next(err)
    }

    // 2 — by name
    if (!country) {
      try {
        const r = await query(
          `${COUNTRY_SELECT} WHERE LOWER(c.name) = $1 GROUP BY c.id LIMIT 1`,
          [lower],
        )
        if (r.rows[0]) country = r.rows[0]
      } catch (err) {
        logger.error('[Countries] getOne name lookup:', err)
        return next(err)
      }
    }

    // 3 — by numeric id
    if (!country) {
      const numId = parseInt(rawSlug, 10)
      if (Number.isFinite(numId) && numId > 0) {
        try {
          const r = await query(
            `${COUNTRY_SELECT} WHERE c.id = $1 GROUP BY c.id LIMIT 1`,
            [numId],
          )
          if (r.rows[0]) country = r.rows[0]
        } catch (err) {
          logger.error('[Countries] getOne id lookup:', err)
          return next(err)
        }
      }
    }

    if (!country) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    // Fire-and-forget view bump
    query(
      'UPDATE countries SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1',
      [country.id],
    ).catch(() => {})

    if (isRaw) return res.json({ success: true, data: country })

    let transformed
    try { transformed = transformCountry(country) }
    catch (err) {
      logger.error('[Countries] transformCountry failed:', err.message)
      transformed = { ...country }
    }

    transformed.destinations = await safeQuery(DEST_CARD_SELECT, [country.id])

    if (includeRelated) {
      const [servicesR, statsR, similarR] = await Promise.allSettled([
        safeQuery(
          `SELECT s.id, s.title, s.slug, s.description,
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
               FILTER (WHERE b.created_at >= NOW() - INTERVAL '30 days')::INTEGER
               AS bookings_last_30_days
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

      transformed.services          = unwrap(servicesR)
      transformed.booking_stats     = unwrap(statsR)[0] ?? {
        total_bookings: 0, total_travelers: 0, bookings_last_30_days: 0,
      }
      transformed.similar_countries = unwrap(similarR).map(transformCountryCard)
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
          COUNT(*) FILTER (WHERE is_active   = true)::INTEGER AS active_countries,
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
          total_countries:    0,
          active_countries:   0,
          featured_countries: 0,
          continents:         0,
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
═══════════════════════════════════════════════════════════════════════════ */

exports.create = async (req, res, next) => {
  try {
    const body    = req.body || {}
    const columns = await getWritableColumns()

    /* ── Required ────────────────────────────────────────────────────── */
    const name = String(body.name || '').trim()
    if (!name) {
      return res.status(400).json({ success: false, error: 'Country name is required' })
    }

    const slug = String(body.slug || '').trim() || toSlug(name)

    /* ── Slug uniqueness ─────────────────────────────────────────────── */
    const existing = await safeQuery(
      'SELECT id FROM countries WHERE slug = $1',
      [slug],
    )
    if (existing[0]) {
      return res.status(409).json({
        success: false,
        code:    'SLUG_CONFLICT',
        error:   `A country with slug "${slug}" already exists`,
      })
    }

    /* ── Handle composite / nested fields sent from the admin form ───── */
    //
    // The admin sends e.g.:
    //   body.geography      = { terrain, highest_point, lakes, forests, volcanoes }
    //   body.wildlife       = { primates, big_five, birds }
    //   body.cuisine        = { famous_dishes, staples, beverages }
    //   body.climate_detail = { best_time, seasons: { 'Dry Season': {...}, ... } }
    //   body.key_facts      = { urban_population, literacy_rate, life_expectancy }
    //   body.government     = { type }
    //   body.practical_info = { electricity:{plug_type,voltage}, water, connectivity:{internet_tld}, driving_side }
    //   body.extra_info     = { driving_side, water_safety }
    //   body.hero_images    = [{ url, caption }]
    //   body.gallery        = [{ url, caption, source }]
    //
    // prepareValue() will JSON.stringify all JSONB_FIELDS automatically.

    /* ── Build INSERT ────────────────────────────────────────────────── */
    const colNames = ['name', 'slug']
    const values   = [name, slug]

    for (const col of columns) {
      if (col === 'name' || col === 'slug') continue
      if (body[col] === undefined)          continue

      const prepared = prepareValue(col, body[col])
      if (prepared === null || prepared === undefined) continue

      colNames.push(col)
      values.push(prepared)
    }

    colNames.push('created_at', 'updated_at')
    const placeholders = values.map((_, i) => `$${i + 1}`)
    placeholders.push('NOW()', 'NOW()')

    const sql = `
      INSERT INTO countries (${colNames.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `

    logger.info('[Countries] create SQL preview:', {
      cols: colNames,
      sql:  sql.slice(0, 400),
    })

    const { rows } = await query(sql, values)

    return res.status(201).json({
      success: true,
      message: 'Country created successfully',
      data:    rows[0],
    })
  } catch (err) {
    logger.error('[Countries] create FAILED:', {
      message:  err.message,
      code:     err.code,
      detail:   err.detail,
      hint:     err.hint,
      where:    err.where,
      position: err.position,
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

    /* ── Slug uniqueness on update ───────────────────────────────────── */
    if (body.slug) {
      const conflict = await safeQuery(
        'SELECT id FROM countries WHERE slug = $1 AND id != $2',
        [body.slug, id],
      )
      if (conflict[0]) {
        return res.status(409).json({
          success: false,
          code:    'SLUG_CONFLICT',
          error:   `Slug "${body.slug}" is already used by another country`,
        })
      }
    }

    /* ── Build SET clause ────────────────────────────────────────────── */
    const setClauses = []
    const values     = []

    for (const col of columns) {
      if (body[col] === undefined) continue

      const prepared = prepareValue(col, body[col])
      values.push(prepared)
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
    logger.error('[Countries] update FAILED:', {
      message: err.message,
      code:    err.code,
      detail:  err.detail,
      hint:    err.hint,
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

    /* ── Existence check ─────────────────────────────────────────────── */
    const existRows = await safeQuery(
      'SELECT id, name FROM countries WHERE id = $1',
      [id],
    )
    if (!existRows[0]) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }
    const countryName = existRows[0].name

    /* ── Count linked destinations ───────────────────────────────────── */
    const linkedRows = await safeQuery(
      'SELECT COUNT(*)::INTEGER AS count FROM destinations WHERE country_id = $1',
      [id],
    )
    const destCount = parseInt(linkedRows[0]?.count ?? 0, 10)

    /* ── Resolve force flag ──────────────────────────────────────────── */
    const force =
      req.query.force === 'true'                             ||
      req.body?.force === true                               ||
      String(req.body?.force || '').toLowerCase() === 'true'

    /* ── Guard: linked destinations, no force ────────────────────────── */
    if (destCount > 0 && !force) {
      return res.status(409).json({
        success:           false,
        code:              'HAS_DESTINATIONS',
        error:             `Cannot delete: "${countryName}" has ${destCount} destination(s). ` +
                           `Send force=true to delete the country and all its destinations.`,
        destination_count: destCount,
        country_name:      countryName,
        can_force:         true,
      })
    }

    /* ── Cascade delete ──────────────────────────────────────────────── */
    let removedBookings     = 0
    let removedDestinations = 0

    if (destCount > 0 && force) {
      const destRows = await safeQuery(
        'SELECT id FROM destinations WHERE country_id = $1',
        [id],
      )
      const destIds = destRows.map(r => r.id)

      if (destIds.length > 0) {
        try {
          const delB = await query(
            'DELETE FROM bookings WHERE destination_id = ANY($1::INTEGER[]) RETURNING id',
            [destIds],
          )
          removedBookings = delB.rows.length
        } catch (err) {
          logger.warn('[Countries] cascade bookings delete skipped:', {
            message: err.message,
            code:    err.code,
          })
        }

        const delD = await query(
          'DELETE FROM destinations WHERE country_id = $1 RETURNING id',
          [id],
        )
        removedDestinations = delD.rows.length
      }
    }

    /* ── Delete the country ──────────────────────────────────────────── */
    const { rows } = await query(
      'DELETE FROM countries WHERE id = $1 RETURNING id, name',
      [id],
    )

    if (!rows[0]) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    const parts = [`Country "${rows[0].name}" deleted`]
    if (removedDestinations) parts.push(`${removedDestinations} destination(s) removed`)
    if (removedBookings)     parts.push(`${removedBookings} booking(s) removed`)

    return res.json({
      success: true,
      message: parts.join(' · '),
      data: {
        id:                   rows[0].id,
        name:                 rows[0].name,
        removed_destinations: removedDestinations,
        removed_bookings:     removedBookings,
      },
    })
  } catch (err) {
    logger.error('[Countries] remove FAILED:', {
      message: err.message,
      code:    err.code,
      detail:  err.detail,
    })
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   BULK DELETE   DELETE /api/countries   body: { ids, force? }
═══════════════════════════════════════════════════════════════════════════ */

exports.bulkDelete = async (req, res, next) => {
  try {
    const { ids, force = false } = req.body

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, error: 'ids array is required' })
    }

    const validIds = ids
      .map(id => parseInt(id, 10))
      .filter(id => Number.isFinite(id) && id > 0)

    if (!validIds.length) {
      return res.status(400).json({ success: false, error: 'No valid IDs provided' })
    }

    const forceFlag = force === true || String(force).toLowerCase() === 'true'

    const deleted = []
    const skipped = []

    for (const id of validIds) {
      try {
        const linked = await safeQuery(
          'SELECT COUNT(*)::INTEGER AS count FROM destinations WHERE country_id = $1',
          [id],
        )
        const count = parseInt(linked[0]?.count ?? 0, 10)

        if (count > 0 && !forceFlag) {
          skipped.push({ id, reason: `has ${count} destination(s)` })
          continue
        }

        if (count > 0 && forceFlag) {
          const destIds = (
            await safeQuery('SELECT id FROM destinations WHERE country_id = $1', [id])
          ).map(r => r.id)

          if (destIds.length > 0) {
            await query(
              'DELETE FROM bookings WHERE destination_id = ANY($1::INTEGER[])',
              [destIds],
            ).catch(err =>
              logger.warn(`[Countries] bulkDelete bookings id=${id}:`, err.message),
            )
            await query('DELETE FROM destinations WHERE country_id = $1', [id])
          }
        }

        const { rows } = await query(
          'DELETE FROM countries WHERE id = $1 RETURNING id, name',
          [id],
        )
        if (rows[0]) deleted.push(rows[0].id)
        else skipped.push({ id, reason: 'not found' })
      } catch (err) {
        logger.error(`[Countries] bulkDelete id=${id}:`, err.message)
        skipped.push({ id, reason: err.message })
      }
    }

    return res.json({
      success: true,
      message: `${deleted.length} deleted, ${skipped.length} skipped`,
      data:    { deleted, skipped },
    })
  } catch (err) {
    logger.error('[Countries] bulkDelete failed:', err)
    next(err)
  }
}

module.exports = exports