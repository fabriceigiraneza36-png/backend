// controllers/countriesController.js
/**
 * COUNTRIES CONTROLLER v7.0
 * 
 * Fixes:
 *  - Removed expensive LEFT JOIN on every list/getAll (use subquery instead)
 *  - Fixed VARCHAR(10) issue by truncating/validating fields before insert
 *  - Added proper error messages for constraint violations
 *  - Optimized queries with indexes hints
 *  - Single source of truth for field serialization
 *  - Proper connection pooling usage
 */

'use strict'

const { query }  = require('../config/db')
const logger     = require('../utils/logger')
const {
  transformCountry,
  transformCountryCard,
} = require('../utils/countryTransformer')

/* ═══════════════════════════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
═════════════════════════════════════════════════════════════════════════════ */

const LOG_PREFIX = '[Countries]'

const safeInt = (v, def = 0, min = 0, max = 99_999) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def
}

const toSlug = (str = '') =>
  String(str)
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/--+/g, '-')
    .slice(0, 200)

const parseJsonField = (val) => {
  if (val === null || val === undefined) return null
  if (typeof val !== 'string')          return val
  const trimmed = val.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed) } catch { /* fall through */ }
  }
  return val
}

/**
 * Friendly error messages for common Postgres error codes
 */
const pgErrorMessage = (err) => {
  switch (err.code) {
    case '23505': return `Duplicate value: ${err.detail || err.message}`
    case '23503': return `Referenced record does not exist: ${err.detail || err.message}`
    case '22001': return `Value too long for field: ${err.detail || err.message}`
    case '22003': return `Numeric value out of range: ${err.detail || err.message}`
    case '22P02': return `Invalid input format: ${err.detail || err.message}`
    case '23502': return `Required field missing: ${err.detail || err.message}`
    case '42703': return `Unknown column: ${err.detail || err.message}`
    default:      return err.message
  }
}

/**
 * Safe query wrapper - logs errors with context, never throws unless asked
 */
const safeQuery = async (sql, params = [], { throwOnError = false, label = '' } = {}) => {
  try {
    const { rows } = await query(sql, params)
    return rows
  } catch (err) {
    logger.error(`${LOG_PREFIX} query error${label ? ` [${label}]` : ''}:`, {
      message:  err.message,
      code:     err.code,
      detail:   err.detail,
      sql:      sql.slice(0, 300),
    })
    if (throwOnError) throw err
    return []
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   FIELD TYPE REGISTRY
═════════════════════════════════════════════════════════════════════════════ */

/**
 * JSONB columns - always JSON.stringify before passing to pg
 */
const JSONB_FIELDS = new Set([
  'geography',
  'wildlife',
  'cuisine',
  'climate_detail',
  'key_facts',
  'government',
  'practical_info',
  'extra_info',
  'hero_images',
  'gallery',
  'activities',
  'faqs',
  'seasons',
])

/**
 * TEXT[] columns - must be native JS arrays, never JSON strings
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

/**
 * Columns known to have VARCHAR length limits in older schemas.
 * Map of columnName -> maxLength
 * This prevents "value too long for type character varying(N)" errors.
 */
const VARCHAR_LIMITS = {
  calling_code:     20,
  currency_symbol:  10,
  flag:             20,
  voltage:          20,
  electrical_plug:  20,
  internet_tld:     20,
  driving_side:     20,
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WRITABLE COLUMNS
═════════════════════════════════════════════════════════════════════════════ */

const WRITABLE_COLUMNS = [
  // Identity
  'name', 'slug', 'official_name', 'demonym', 'motto', 'tagline',
  'continent', 'region', 'sub_region', 'capital',
  'flag', 'flag_url',

  // Descriptions
  'description', 'full_description', 'short_description',
  'short_notes', 'best_time_to_visit',

  // Practical / travel flat fields
  'currency', 'currency_symbol', 'language',
  'timezone', 'climate',
  'visa_info', 'health_info', 'water_safety',
  'electrical_plug', 'voltage', 'internet_tld',
  'calling_code', 'driving_side', 'electricity',
  'government_type',

  // Media
  'image_url', 'cover_image_url', 'hero_image',

  // Coordinates
  'latitude', 'longitude',

  // Numeric stats
  'population', 'area', 'area_sq_km',
  'urban_population', 'literacy_rate', 'life_expectancy', 'median_age',

  // Misc text
  'safety_info', 'transport_info', 'food_info',
  'culture_info', 'wildlife_info', 'geography_info',

  // TEXT[] arrays
  'highlights', 'experiences', 'travel_tips',
  'neighboring_countries', 'images',
  'languages', 'official_languages',

  // JSONB structured
  'geography', 'wildlife', 'cuisine',
  'climate_detail', 'key_facts', 'government',
  'practical_info', 'extra_info',

  // JSONB legacy
  'hero_images', 'gallery', 'activities', 'faqs', 'seasons',

  // Flags
  'is_active', 'is_featured',

  // SEO
  'meta_title', 'meta_description',
]

/* ── Column cache ─────────────────────────────────────────────────────────── */

let _verifiedColumns  = null   // string[]
let _columnTypeMap    = null   // Record<string, { data_type, udt_name, char_max_length }>

/**
 * Returns verified writable columns against live DB schema.
 * Cached for process lifetime (invalidated by ensureCountriesSchema).
 */
const getWritableColumns = async () => {
  if (_verifiedColumns) return _verifiedColumns

try {
      const { rows } = await query(`
        SELECT
          column_name,
          data_type,
          udt_name,
          character_maximum_length,
          numeric_precision,
          numeric_scale
        FROM information_schema.columns
        WHERE table_name   = 'countries'
          AND table_schema = 'public'
      `)

    const existing   = new Set(rows.map(r => r.column_name))
    _columnTypeMap   = {}

    for (const r of rows) {
      _columnTypeMap[r.column_name] = {
        data_type:         r.data_type.toLowerCase(),
        udt_name:          r.udt_name.toLowerCase(),
        char_max_length:   r.character_maximum_length,
        numeric_precision: r.numeric_precision,
        numeric_scale:     r.numeric_scale,
      }
    }

    _verifiedColumns = WRITABLE_COLUMNS.filter(c => existing.has(c))

    const skipped = WRITABLE_COLUMNS.filter(c => !existing.has(c))
    logger.info(
      `${LOG_PREFIX} Column verification: ${_verifiedColumns.length} writable` +
      (skipped.length ? ` (skipped: ${skipped.join(', ')})` : ''),
    )
  } catch (err) {
    logger.error(`${LOG_PREFIX} Schema introspection failed, using full list:`, err.message)
    _verifiedColumns = [...WRITABLE_COLUMNS]
    _columnTypeMap   = {}
  }

  return _verifiedColumns
}

const invalidateColumnCache = () => {
  _verifiedColumns = null
  _columnTypeMap   = null
}

/* ═══════════════════════════════════════════════════════════════════════════════
   VALUE SERIALISER
══════════════════════════════════════════════════════════════════════════════ */

/**
 * Serialize a value for a Postgres parameter based on column type info.
 *
 * - JSONB  → JSON.stringify
 * - ARRAY  → native JS array (parse JSON strings first)
 * - VARCHAR with known limit → truncate to prevent "value too long" errors
 * - Scalar → pass through
 */
const prepareValue = (col, val) => {
  if (val === null || val === undefined) return null

  const typeInfo = _columnTypeMap?.[col] ?? {}

  /* ── JSONB ─────────────────────────────────────────────────────────── */
  const isJsonb =
    JSONB_FIELDS.has(col)               ||
    typeInfo.data_type === 'jsonb'      ||
    typeInfo.udt_name  === 'jsonb'

  if (isJsonb) {
    const parsed = parseJsonField(val)
    if (parsed === null) return null
    try { return JSON.stringify(parsed) }
    catch { return null }
  }

  /* ── TEXT[] / ARRAY ─────────────────────────────────────────────────── */
  const isArray =
    ARRAY_FIELDS.has(col)                         ||
    typeInfo.data_type === 'array'                ||
    (typeInfo.udt_name ?? '').startsWith('_')

  if (isArray) {
    const parsed = parseJsonField(val)
    if (Array.isArray(parsed)) return parsed.map(String)
    if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()]
    return null
  }

  /* ── Boolean ────────────────────────────────────────────────────────── */
  if (typeInfo.data_type === 'boolean') {
    if (typeof val === 'boolean') return val
    const s = String(val).toLowerCase().trim()
    return s === 'true' || s === '1' || s === 'yes'
  }

  /* ── Numeric ────────────────────────────────────────────────────────── */
  // Handle integer and bigint types with string-based validation to prevent overflow
  if (typeInfo.data_type === 'integer' || typeInfo.data_type === 'bigint') {
    const s = String(val).trim()
    if (s === '') return null
    const match = s.match(/^([+-]?)(\d*)(?:\.(\d*))?$/)
    if (!match) return null // Reject non-decimal formats (e.g. scientific notation)
    const [, sign, intPart, fracPart] = match
    let digits = intPart.replace(/^0+(?=\d)/, '') || '0' // Remove leading zeros
    
    if (typeInfo.data_type === 'integer') {
      const maxDigits = 10
      const maxPos = '2147483647'
      const maxNeg = '2147483648' // |min int|
      if (digits.length > maxDigits) return null
      if (digits.length === maxDigits) {
        const maxStr = sign === '-' ? maxNeg : maxPos
        if (digits > maxStr) return null
      }
      return Number(sign + digits) // Safe to convert to Number (≤10 digits)
    } else if (typeInfo.data_type === 'bigint') {
      const maxDigits = 19
      const maxPos = '9223372036854775807'
      const maxNeg = '9223372036854775808' // |min bigint|
      if (digits.length > maxDigits) return null
      if (digits.length === maxDigits) {
        const maxStr = sign === '-' ? maxNeg : maxPos
        if (digits > maxStr) return null
      }
      // Return as string to preserve precision for bigint
      return (sign === '-' ? '-' : '') + digits
    }
  }

  // Handle numeric/decimal types with precision and scale
  if (
    typeInfo.data_type === 'numeric' ||
    typeInfo.data_type === 'decimal'
  ) {
    const precision = Number(typeInfo.numeric_precision)
    const scale     = Number(typeInfo.numeric_scale)
    if (!Number.isFinite(precision) || !Number.isFinite(scale)) {
      // fallback if metadata missing
      const n = Number(val)
      return Number.isFinite(n) ? n : null
    }
    const s = String(val).trim()
    if (s === '') return null
    // Handle sign
    const signMatch = s.match(/^([+-]?)(.*)$/)
    const sign = signMatch[1] || ''
    const abs  = signMatch[2]
    // Split integer and fractional parts
    const [intPart, fracPart = ''] = abs.split('.')
    // Remove leading zeros from intPart for length count (but keep at least one digit if all zeros)
    const intDigits = intPart.replace(/^0+(?=\d)/, '') || '0'
    const fracDigits = fracPart
    // Truncate fractional part to scale if needed
    let trimmedFrac = fracDigits
    if (fracDigits.length > scale) {
      trimmedFrac = fracDigits.slice(0, scale) // simply truncate; could round
      logger.warn(`${LOG_PREFIX} Truncating fractional part of "${col}" from ${fracDigits.length} to ${scale} digits`)
    }
    // If integer part exceeds (precision - scale), reject to avoid overflow
    const maxIntLen = precision - scale
    if (intDigits.length > maxIntLen) {
      logger.warn(`${LOG_PREFIX} Integer part of "${col}" exceeds allowed length (${intDigits.length} > ${maxIntLen}); setting to null`)
      return null
    }
    // Reconstruct
    const result = sign + intDigits + (scale > 0 ? '.' + trimmedFrac.padEnd(scale, '0') : '')
    return result
  }

  // Handle floating point real/double precision (just pass through if finite)
  if (
    typeInfo.data_type === 'real' ||
    typeInfo.data_type === 'double precision'
  ) {
    const n = Number(val)
    return Number.isFinite(n) ? n : null
  }

  /* ── VARCHAR with length limit ──────────────────────────────────────── */
  // First check our own known limits map
  const knownLimit = VARCHAR_LIMITS[col]
  if (knownLimit && typeof val === 'string' && val.length > knownLimit) {
    logger.warn(
      `${LOG_PREFIX} Truncating "${col}" from ${val.length} to ${knownLimit} chars`,
    )
    return val.slice(0, knownLimit)
  }

  // Then check DB-reported limit
  const dbLimit = typeInfo.char_max_length
  if (dbLimit && typeof val === 'string' && val.length > dbLimit) {
    logger.warn(
      `${LOG_PREFIX} Truncating "${col}" from ${val.length} to ${dbLimit} chars (DB limit)`,
    )
    return val.slice(0, dbLimit)
  }

  return val
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SQL FRAGMENTS
   
   KEY OPTIMIZATION:
   Instead of LEFT JOIN destinations on every list/query (very slow),
   we use a correlated subquery only when needed, or a separate
   COUNT query. For list views we skip destination_count entirely
   and fetch it on-demand.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * Optimized SELECT for list views - NO JOIN to destinations.
 * destination_count is fetched separately only when needed.
 */
const COUNTRY_LIST_SELECT = `SELECT c.* FROM countries c`

/**
 * Full SELECT with destination count - used only for single country fetch.
 * Uses a subquery instead of GROUP BY to avoid full table scan.
 */
const COUNTRY_DETAIL_SELECT = `
  SELECT
    c.*,
    (
      SELECT COUNT(*)::INTEGER
      FROM destinations d
      WHERE d.country_id = c.id
        AND d.is_active  = true
    ) AS destination_count
  FROM countries c
`

/**
 * Destination cards for a single country page.
 */
const DEST_CARD_SELECT = `
  SELECT
    d.id,
    d.name,
    d.slug,
    d.short_description,
    d.image_url,
    d.difficulty,
    d.duration,
    d.duration_days,
    d.price_from,
    d.price_currency,
    d.rating,
    d.review_count,
    d.is_featured,
    d.highlights,
    d.best_time_to_visit,
    d.category,
    COALESCE(d.booking_count, 0)::INTEGER AS booking_count
  FROM destinations d
  WHERE d.country_id = $1
    AND d.is_active  = true
  ORDER BY
    d.is_featured   DESC NULLS LAST,
    d.booking_count DESC NULLS LAST,
    d.name          ASC
  LIMIT 50
`

/* ═══════════════════════════════════════════════════════════════════════════════
   SCHEMA BOOTSTRAP
═════════════════════════════════════════════════════════════════════════════ */

exports.ensureCountriesSchema = async () => {
  try {
    /* ── Base table ─────────────────────────────────────────────────── */
    await query(`
      CREATE TABLE IF NOT EXISTS countries (
        id                    SERIAL PRIMARY KEY,

        -- Identity
        name                  TEXT NOT NULL,
        slug                  TEXT NOT NULL UNIQUE,
        official_name         TEXT,
        demonym               TEXT,
        motto                 TEXT,
        tagline               TEXT,
        flag                  TEXT,
        flag_url              TEXT,
        continent             TEXT,
        region                TEXT,
        sub_region            TEXT,
        capital               TEXT,

        -- Descriptions
        description           TEXT,
        full_description      TEXT,
        short_description     TEXT,
        short_notes           TEXT,
        best_time_to_visit    TEXT,

        -- Practical travel
        currency              TEXT,
        currency_symbol       TEXT,
        language              TEXT,
        timezone              TEXT,
        climate               TEXT,
        visa_info             TEXT,
        health_info           TEXT,
        water_safety          TEXT,
        electrical_plug       TEXT,
        voltage               TEXT,
        internet_tld          TEXT,
        calling_code          TEXT,
        driving_side          TEXT,
        electricity           TEXT,
        government_type       TEXT,

        -- Media
        image_url             TEXT,
        cover_image_url       TEXT,
        hero_image            TEXT,

-- Coordinates
         latitude              NUMERIC(15, 8),
         longitude             NUMERIC(15, 8),

        -- Numeric stats
        population            BIGINT,
        area                  NUMERIC(15, 2),
        area_sq_km            NUMERIC(15, 2),
        urban_population      BIGINT,
        literacy_rate         NUMERIC(5, 2),
        life_expectancy       NUMERIC(5, 2),
        median_age            NUMERIC(5, 2),

        -- Misc text info
        safety_info           TEXT,
        transport_info        TEXT,
        food_info             TEXT,
        culture_info          TEXT,
        wildlife_info         TEXT,
        geography_info        TEXT,

        -- TEXT[] arrays
        highlights            TEXT[],
        experiences           TEXT[],
        travel_tips           TEXT[],
        neighboring_countries TEXT[],
        images                TEXT[],
        languages             TEXT[],
        official_languages    TEXT[],

        -- JSONB structured
        geography             JSONB,
        wildlife              JSONB,
        cuisine               JSONB,
        climate_detail        JSONB,
        key_facts             JSONB,
        government            JSONB,
        practical_info        JSONB,
        extra_info            JSONB,

        -- JSONB legacy
        hero_images           JSONB,
        gallery               JSONB,
        activities            JSONB,
        faqs                  JSONB,
        seasons               JSONB,

        -- Flags
        is_active             BOOLEAN NOT NULL DEFAULT true,
        is_featured           BOOLEAN NOT NULL DEFAULT false,

        -- SEO
        meta_title            TEXT,
        meta_description      TEXT,

        -- Counters
        view_count            INTEGER NOT NULL DEFAULT 0,

        -- Timestamps
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    /* ── Migrations ──────────────────────────────────────────────────── */
    const migrations = [
      // Fix VARCHAR(10) that causes "value too long" errors
      // Widen any narrow varchar columns to TEXT
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'countries'
             AND column_name = 'currency_symbol'
             AND data_type = 'character varying'
             AND character_maximum_length <= 10
         ) THEN
           ALTER TABLE countries ALTER COLUMN currency_symbol TYPE TEXT;
         END IF;
       END$$`,

      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'countries'
             AND column_name = 'calling_code'
             AND data_type = 'character varying'
             AND character_maximum_length <= 10
         ) THEN
           ALTER TABLE countries ALTER COLUMN calling_code TYPE TEXT;
         END IF;
       END$$`,

      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'countries'
             AND column_name = 'flag'
             AND data_type = 'character varying'
             AND character_maximum_length <= 10
         ) THEN
           ALTER TABLE countries ALTER COLUMN flag TYPE TEXT;
         END IF;
       END$$`,

// Fix urban_population data type - was DECIMAL(5,2) which is too small
       `DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'countries'
              AND column_name = 'urban_population'
              AND data_type = 'numeric'
              AND numeric_precision = 5
              AND numeric_scale = 2
          ) THEN
            ALTER TABLE countries ALTER COLUMN urban_population TYPE BIGINT USING urban_population::BIGINT;
          END IF;
        END$$`,

        // Ensure latitude/longitude have sufficient precision
        `DO $$
         BEGIN
           IF EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'countries'
               AND column_name = 'latitude'
               AND data_type = 'numeric'
               AND (numeric_precision < 15 OR numeric_scale < 8)
           ) THEN
             ALTER TABLE countries ALTER COLUMN latitude TYPE NUMERIC(15,8);
           END IF;
         END$$`,

        `DO $$
         BEGIN
           IF EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'countries'
               AND column_name = 'longitude'
               AND data_type = 'numeric'
               AND (numeric_precision < 15 OR numeric_scale < 8)
           ) THEN
             ALTER TABLE countries ALTER COLUMN longitude TYPE NUMERIC(15,8);
           END IF;
         END$$`,

      // Add missing columns
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS demonym             TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS motto               TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS flag                TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS flag_url            TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS sub_region          TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS capital             TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS full_description    TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS short_description   TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS short_notes         TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS best_time_to_visit  TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS cover_image_url     TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS hero_image          TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS water_safety        TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS electrical_plug     TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS voltage             TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS internet_tld        TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS calling_code        TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS driving_side        TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS electricity         TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS government_type     TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS area_sq_km          NUMERIC(15,2)`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS urban_population    BIGINT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS literacy_rate       NUMERIC(5,2)`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS life_expectancy     NUMERIC(5,2)`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS median_age          NUMERIC(5,2)`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS safety_info         TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS transport_info      TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS food_info           TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS culture_info        TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS wildlife_info       TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS geography_info      TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS images              TEXT[]`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS official_languages  TEXT[]`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS neighboring_countries TEXT[]`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS geography           JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS wildlife            JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS cuisine             JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS climate_detail      JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS key_facts           JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS government          JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS practical_info      JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS extra_info          JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS gallery             JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS hero_images         JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS activities          JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS faqs                JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS seasons             JSONB`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS view_count          INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS meta_title          TEXT`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS meta_description    TEXT`,
    ]

    for (const sql of migrations) {
      await query(sql).catch(err =>
        logger.warn(`${LOG_PREFIX} Migration skipped:`, err.message),
      )
    }

    /* ── Indexes (critical for query performance) ────────────────────── */
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_countries_slug
          ON countries (slug)`,
      `CREATE INDEX IF NOT EXISTS idx_countries_continent
          ON countries (continent) WHERE is_active = true`,
      `CREATE INDEX IF NOT EXISTS idx_countries_is_active
          ON countries (is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_countries_is_featured
          ON countries (is_active, is_featured) WHERE is_active = true`,
      `CREATE INDEX IF NOT EXISTS idx_countries_name
          ON countries (name)`,
      // Critical: index for the subquery in COUNTRY_DETAIL_SELECT
      `CREATE INDEX IF NOT EXISTS idx_destinations_country_active
          ON destinations (country_id, is_active) WHERE is_active = true`,
    ]

    for (const sql of indexes) {
      await query(sql).catch(err =>
        logger.warn(`${LOG_PREFIX} Index skipped:`, err.message),
      )
    }

    invalidateColumnCache()
    await getWritableColumns()

    logger.info(`${LOG_PREFIX} Schema ready ✅`)
  } catch (err) {
    logger.error(`${LOG_PREFIX} ensureCountriesSchema failed:`, err.message)
    throw err
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   GET ALL   GET /api/countries
   
   OPTIMIZED: No JOIN to destinations. Returns destination_count only
   when explicitly requested via ?include_counts=true
══════════════════════════════════════════════════════════════════════════════ */

exports.getAll = async (req, res, next) => {
  try {
    const {
      page            = 1,
      limit           = 50,
      continent,
      search,
      is_active,
      active,
      is_featured,
      featured,
      sortBy          = 'name',
      order           = 'asc',
      raw             = false,
      include_counts  = false,
    } = req.query

    const ALLOWED_SORT = new Set([
      'name', 'continent', 'created_at', 'updated_at', 'view_count', 'population',
    ])

    const params = []
    const conds  = ['1=1']
    let   pi     = 1

    if (continent) {
      conds.push(`c.continent ILIKE $${pi++}`)
      params.push(`%${continent}%`)
    }

    const activeFilter = is_active ?? active
    if (activeFilter !== undefined && activeFilter !== '') {
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
    const sortCol = ALLOWED_SORT.has(sortBy) ? `c.${sortBy}` : 'c.name'
    const sortDir = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
    const lim     = safeInt(limit, 50, 1, 200)
    const pg      = safeInt(page,   1, 1, 9_999)
    const offset  = (pg - 1) * lim

    /*
     * Use include_counts only when explicitly requested.
     * The subquery approach is much faster than a LEFT JOIN + GROUP BY
     * for large datasets because it's evaluated per-row lazily.
     */
    const selectSql = (include_counts === 'true' || include_counts === true)
      ? `SELECT c.*,
            (SELECT COUNT(*)::INTEGER FROM destinations d
             WHERE d.country_id = c.id AND d.is_active = true
            ) AS destination_count
          FROM countries c`
      : COUNTRY_LIST_SELECT

    const [countRes, dataRes] = await Promise.all([
      query(
        `SELECT COUNT(*) FROM countries c WHERE ${where}`,
        params,
      ),
      query(
        `${selectSql}
         WHERE ${where}
         ORDER BY ${sortCol} ${sortDir}
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
    logger.error(`${LOG_PREFIX} getAll failed:`, err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   GET ONE   GET /api/countries/:slug
══════════════════════════════════════════════════════════════════════════════ */

exports.getOne = async (req, res, next) => {
  try {
    const rawSlug = String(req.params.slug || req.params.id || '').trim()

    if (!rawSlug) {
      return res.status(400).json({ success: false, error: 'Country identifier required' })
    }

    const includeRelated = ['true', '1', 'yes'].includes(
      String(req.query.includeRelated || '').toLowerCase(),
    )
    const isRaw = ['true', '1', 'yes'].includes(
      String(req.query.raw || '').toLowerCase(),
    )

    const lower = rawSlug.toLowerCase()
    let country = null

    /* ── 1. by slug ─────────────────────────────────────────────────── */
    const bySlug = await safeQuery(
      `${COUNTRY_DETAIL_SELECT} WHERE LOWER(c.slug) = $1 LIMIT 1`,
      [lower],
      { throwOnError: true, label: 'getOne:slug' },
    )
    if (bySlug[0]) country = bySlug[0]

    /* ── 2. by name ─────────────────────────────────────────────────── */
    if (!country) {
      const byName = await safeQuery(
        `${COUNTRY_DETAIL_SELECT} WHERE LOWER(c.name) = $1 LIMIT 1`,
        [lower],
        { throwOnError: false, label: 'getOne:name' },
      )
      if (byName[0]) country = byName[0]
    }

    /* ── 3. by numeric id ───────────────────────────────────────────── */
    if (!country) {
      const numId = parseInt(rawSlug, 10)
      if (Number.isFinite(numId) && numId > 0) {
        const byId = await safeQuery(
          `${COUNTRY_DETAIL_SELECT} WHERE c.id = $1 LIMIT 1`,
          [numId],
          { throwOnError: false, label: 'getOne:id' },
        )
        if (byId[0]) country = byId[0]
      }
    }

    if (!country) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    /* ── Fire-and-forget view bump ──────────────────────────────────── */
    query(
      `UPDATE countries
       SET view_count = COALESCE(view_count, 0) + 1
       WHERE id = $1`,
      [country.id],
    ).catch(() => {})

    if (isRaw) return res.json({ success: true, data: country })

    /* ── Transform ──────────────────────────────────────────────────── */
    let transformed
    try {
      transformed = transformCountry(country)
    } catch (err) {
      logger.warn(`${LOG_PREFIX} transformCountry error (using raw):`, err.message)
      transformed = { ...country }
    }

    /* ── Destinations ───────────────────────────────────────────────── */
    transformed.destinations = await safeQuery(
      DEST_CARD_SELECT,
      [country.id],
      { label: 'getOne:destinations' },
    )

    /* ── Optional related data ──────────────────────────────────────── */
    if (includeRelated) {
      const [servicesR, statsR, similarR] = await Promise.allSettled([
        safeQuery(
          `SELECT
             s.id, s.title, s.slug, s.description,
             s.image_url, s.price_from, s.price_currency,
             s.duration, s.category, s.is_featured,
             s.rating, s.review_count
           FROM services s
           WHERE s.country_id = $1
             AND s.is_active  = true
           ORDER BY s.is_featured DESC NULLS LAST, s.title ASC
           LIMIT 20`,
          [country.id],
          { label: 'getOne:services' },
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
          { label: 'getOne:stats' },
        ),
        safeQuery(
          `SELECT
             c.*,
             (SELECT COUNT(*)::INTEGER FROM destinations d
              WHERE d.country_id = c.id AND d.is_active = true
             ) AS destination_count
           FROM countries c
           WHERE c.continent = $1
             AND c.id        != $2
             AND c.is_active = true
           ORDER BY destination_count DESC
           LIMIT 4`,
          [country.continent || '', country.id],
          { label: 'getOne:similar' },
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
    logger.error(`${LOG_PREFIX} getOne failed:`, err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   GET FEATURED   GET /api/countries/featured
═════════════════════════════════════════════════════════════════════════════ */

exports.getFeatured = async (req, res, next) => {
  try {
    const limit = Math.min(safeInt(req.query.limit, 6, 1, 50), 50)

    const rows = await safeQuery(
      `SELECT c.*,
          (SELECT COUNT(*)::INTEGER FROM destinations d
           WHERE d.country_id = c.id AND d.is_active = true
          ) AS destination_count
        FROM countries c
        WHERE c.is_active   = true
          AND c.is_featured = true
        ORDER BY c.name ASC
        LIMIT $1`,
      [limit],
      { label: 'getFeatured' },
    )

    return res.json({
      success: true,
      data:    rows.map(transformCountryCard),
      count:   rows.length,
    })
  } catch (err) {
    logger.error(`${LOG_PREFIX} getFeatured failed:`, err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   GET BY CONTINENT   GET /api/countries/continent/:continent
═════════════════════════════════════════════════════════════════════════════ */

exports.getByContinent = async (req, res, next) => {
  try {
    const continent = String(req.params.continent || '').trim()
    if (!continent) {
      return res.status(400).json({ success: false, error: 'Continent name required' })
    }

    const rows = await safeQuery(
      `SELECT c.*,
          (SELECT COUNT(*)::INTEGER FROM destinations d
           WHERE d.country_id = c.id AND d.is_active = true
          ) AS destination_count
        FROM countries c
        WHERE c.is_active   = true
          AND c.continent ILIKE $1
        ORDER BY c.name ASC`,
      [`%${continent}%`],
      { label: 'getByContinent' },
    )

    return res.json({
      success:   true,
      data:      rows.map(transformCountryCard),
      count:     rows.length,
      continent,
    })
  } catch (err) {
    logger.error(`${LOG_PREFIX} getByContinent failed:`, err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   GET STATS   GET /api/countries/stats
══════════════════════════════════════════════════════════════════════════════ */

exports.getStats = async (req, res, next) => {
  try {
    const [overview, byCont, topCountries] = await Promise.all([
      safeQuery(
        `SELECT
            COUNT(*)::INTEGER                                    AS total_countries,
            COUNT(*) FILTER (WHERE is_active   = true)::INTEGER AS active_countries,
            COUNT(*) FILTER (WHERE is_featured = true)::INTEGER AS featured_countries,
            COUNT(DISTINCT continent)::INTEGER                   AS continents
          FROM countries`,
        [],
        { label: 'stats:overview' },
      ),
      safeQuery(
        `SELECT
            continent,
            COUNT(*)::INTEGER AS count
          FROM countries
          WHERE continent IS NOT NULL
          GROUP BY continent
          ORDER BY count DESC`,
        [],
        { label: 'stats:continent' },
      ),
      safeQuery(
        `SELECT
            c.id,
            c.name,
            c.slug,
            c.flag_url,
            c.flag,
            (SELECT COUNT(*)::INTEGER FROM destinations d
             WHERE d.country_id = c.id AND d.is_active = true
            ) AS destination_count,
            (SELECT COUNT(DISTINCT b.id)::INTEGER
             FROM bookings b
             JOIN destinations d ON b.destination_id = d.id
             WHERE d.country_id = c.id
            ) AS booking_count
          FROM countries c
          WHERE c.is_active = true
          ORDER BY booking_count DESC, destination_count DESC
          LIMIT 10`,
        [],
        { label: 'stats:top' },
      ),
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
    logger.error(`${LOG_PREFIX} getStats failed:`, err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   CREATE   POST /api/countries
══════════════════════════════════════════════════════════════════════════════ */

exports.create = async (req, res, next) => {
  try {
    const body    = req.body || {}
    const columns = await getWritableColumns()

    /* ── Validate required fields ────────────────────────────────────── */
    const name = String(body.name || '').trim()
    if (!name) {
      return res.status(400).json({
        success: false,
        error:   'Country name is required',
      })
    }

    const slug = String(body.slug || '').trim() || toSlug(name)
    if (!slug) {
      return res.status(400).json({
        success: false,
        error:   'Could not generate a valid slug from the provided name',
      })
    }

    /* ── Slug uniqueness ─────────────────────────────────────────────── */
    const existing = await safeQuery(
      'SELECT id FROM countries WHERE slug = $1',
      [slug],
      { label: 'create:slugCheck' },
    )
    if (existing[0]) {
      return res.status(409).json({
        success: false,
        code:    'SLUG_CONFLICT',
        error:   `A country with slug "${slug}" already exists`,
      })
    }

/* ── Build INSERT ────────────────────────────────────────────────── */
     const colNames = ['name', 'slug']
     const values   = [name, slug]

for (const col of columns) {
       if (col === 'name' || col === 'slug') continue
       if (body[col] === undefined) continue

       const prepared = prepareValue(col, body[col])
       if (prepared === null || prepared === undefined) continue

       colNames.push(col)
       values.push(prepared)
     }

    /* timestamps */
    colNames.push('created_at', 'updated_at')
    const placeholders = values.map((_, i) => `$${i + 1}`)
    placeholders.push('NOW()', 'NOW()')

    const sql = `
      INSERT INTO countries (${colNames.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `

    const { rows } = await query(sql, values)

    return res.status(201).json({
      success: true,
      message: 'Country created successfully',
      data:    rows[0],
    })
  } catch (err) {
    logger.error(`${LOG_PREFIX} create FAILED:`, {
      message:  err.message,
      code:     err.code,
      detail:   err.detail,
      hint:     err.hint,
      where:    err.where,
      position: err.position,
    })

    /* Return user-friendly error instead of 500 */
    const status = err.code === '23505' ? 409 : 400
    const knownCodes = new Set(['23505','23503','22001','22P02','23502','42703'])

    if (knownCodes.has(err.code)) {
      return res.status(status).json({
        success: false,
        error:   pgErrorMessage(err),
        code:    err.code,
      })
    }

    return res.status(500).json({ success: false, error: err.message })
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   UPDATE   PUT | PATCH /api/countries/:id
══════════════════════════════════════════════════════════════════════════════ */

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
        { label: 'update:slugCheck' },
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
      return res.status(400).json({
        success: false,
        error:   'No valid fields to update',
      })
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
    logger.error(`${LOG_PREFIX} update FAILED:`, {
      message: err.message,
      code:    err.code,
      detail:  err.detail,
    })

    const knownCodes = new Set(['23505','23503','22001','22P02','23502','42703'])
    if (knownCodes.has(err.code)) {
      const status = err.code === '23505' ? 409 : 400
      return res.status(status).json({
        success: false,
        error:   pgErrorMessage(err),
        code:    err.code,
      })
    }

    return res.status(500).json({ success: false, error: err.message })
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   TOGGLE ACTIVE   PATCH /api/countries/:id/toggle-active
══════════════════════════════════════════════════════════════════════════════ */

exports.toggleActive = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0, 1)
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid country ID' })
    }

    const { rows } = await query(
      `UPDATE countries
       SET is_active   = NOT is_active,
           updated_at  = NOW()
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
    logger.error(`${LOG_PREFIX} toggleActive failed:`, err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   TOGGLE FEATURED   PATCH /api/countries/:id/toggle-featured
══════════════════════════════════════════════════════════════════════════════ */

exports.toggleFeatured = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0, 1)
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid country ID' })
    }

    const { rows } = await query(
      `UPDATE countries
       SET is_featured = NOT is_featured,
           updated_at  = NOW()
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
    logger.error(`${LOG_PREFIX} toggleFeatured failed:`, err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
