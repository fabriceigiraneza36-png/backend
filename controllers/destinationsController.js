// controllers/destinationsController.js
/**
 * DESTINATIONS CONTROLLER v7.0
 *
 * Key changes:
 *  - Admin mode: ?admin=true shows ALL destinations regardless of status/active
 *  - Public mode (default): only shows published + active
 *  - Explicit safeLimit/safePage/safeOffset (no paginate helper dependency)
 *  - VARCHAR auto-truncation to prevent 500s
 *  - All pg errors return 400/409 not 500
 *  - Fault-tolerant getOne (one failing sub-query doesn't kill response)
 *  - LEFT JOIN countries so destinations show even without country
 *  - Cached column schema introspection
 */

'use strict'

const { query }              = require('../config/db')
const { slugify }            = require('../utils/helpers')
const { getUploadedFileUrl } = require('../utils/uploadHelpers')

const LOG = '[Destinations]'

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */

const toNum = (v, def = null) => {
  if (v === null || v === undefined || v === '') return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

const toBool = (v) => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim()
    return s === 'true' || s === '1' || s === 'yes'
  }
  return Boolean(v)
}

const toArr = (v) => {
  if (!v) return []
  if (Array.isArray(v)) return v.filter(Boolean)
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return []
    if (t.startsWith('[')) {
      try { return JSON.parse(t).filter(Boolean) } catch { return [] }
    }
    return t.split(',').map(s => s.trim()).filter(Boolean)
  }
  return []
}

const parseJson = (v, def = {}) => {
  if (!v)                     return def
  if (typeof v === 'object')  return v
  try { return JSON.parse(v) } catch { return def }
}

const fmtDuration = (days, nights) => {
  if (days && nights) return `${days} Days / ${nights} Nights`
  if (days)           return `${days} Day${days > 1 ? 's' : ''}`
  if (nights)         return `${nights} Night${nights > 1 ? 's' : ''}`
  return null
}

const safeLimit  = (v, def = 20)  => Math.min(Math.max(parseInt(v, 10) || def, 1), 200)
const safePage   = (v, def = 1)   => Math.max(parseInt(v, 10) || def, 1)
const safeOffset = (page, limit)  => (page - 1) * limit

/** Detect admin request (bypass published/active filters) */
const isAdminRequest = (req) => {
  return (
    toBool(req.query.admin)                                     ||
    toBool(req.query.includeAll)                                ||
    toBool(req.query.includeUnpublished)                        ||
    toBool(req.headers['x-admin-request'])                      ||
    (req.user && (req.user.role === 'admin' || req.user.role === 'super_admin'))
  )
}

const pgMsg = (err) => {
  switch (err.code) {
    case '23505': return `Duplicate value: ${err.detail || err.message}`
    case '23503': return `Referenced record not found: ${err.detail || err.message}`
    case '22001': return `Value too long: ${err.detail || err.message}`
    case '22P02': return `Invalid format: ${err.detail || err.message}`
    case '23502': return `Required field missing: ${err.detail || err.message}`
    case '42703': return `Unknown column: ${err.detail || err.message}`
    default:      return err.message
  }
}

const KNOWN_PG = new Set(['23505','23503','22001','22P02','23502','42703'])

const handlePgError = (err, res, next) => {
  if (KNOWN_PG.has(err.code)) {
    const status = err.code === '23505' ? 409 : 400
    return res.status(status).json({ success: false, error: pgMsg(err), code: err.code })
  }
  return next(err)
}

const safeTask = (label, fn) =>
  fn().catch(err => {
    console.error(`${LOG} "${label}" sub-task failed:`, err.message?.slice(0, 200))
    return undefined
  })

const safeQuery = async (sql, params = [], label = '') => {
  try {
    const { rows } = await query(sql, params)
    return rows
  } catch (err) {
    console.error(
      `${LOG} safeQuery${label ? ` [${label}]` : ''} error:`,
      err.message?.slice(0, 200),
    )
    return []
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   VARCHAR TRUNCATION
═══════════════════════════════════════════════════════════════════════════ */

const VARCHAR_LIMITS = {
  status:         30,
  difficulty:     50,
  price_currency: 10,
  malaria_risk:   50,
  safety_rating:  30,
  category:      100,
  fitness_level: 100,
}

let COLUMN_META = null

const getColumnMeta = async () => {
  if (COLUMN_META) return COLUMN_META
  try {
    const { rows } = await query(`
      SELECT column_name, character_maximum_length, data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'destinations' AND table_schema = 'public'
    `)
    COLUMN_META = {}
    for (const r of rows) {
      COLUMN_META[r.column_name] = {
        maxLen:   r.character_maximum_length,
        dataType: r.data_type?.toLowerCase(),
        udtName:  r.udt_name?.toLowerCase(),
      }
    }
  } catch {
    COLUMN_META = {}
  }
  return COLUMN_META
}

const truncate = (col, val) => {
  if (typeof val !== 'string') return val
  const known = VARCHAR_LIMITS[col]
  if (known && val.length > known) return val.slice(0, known)
  const meta = COLUMN_META?.[col]
  if (meta?.maxLen && val.length > meta.maxLen) return val.slice(0, meta.maxLen)
  return val
}

/* ═══════════════════════════════════════════════════════════════════════════
   COUNTRY RESOLVER
═══════════════════════════════════════════════════════════════════════════ */

const resolveCountry = async (idOrSlug) => {
  if (!idOrSlug) return null
  const str   = String(idOrSlug).trim()
  const isNum = /^\d+$/.test(str)
  const rows  = await safeQuery(
    `SELECT id, slug, name, flag, flag_url, continent, region, sub_region,
            currency, currency_symbol, timezone, calling_code, capital,
            languages, climate, best_time_to_visit, visa_info, health_info
     FROM countries
     WHERE ${isNum ? 'id' : 'slug'} = $1`,
    [isNum ? parseInt(str, 10) : str.toLowerCase()],
    'resolveCountry',
  )
  return rows[0] || null
}

const syncCountryDestCount = async (countryId) => {
  if (!countryId) return
  await query(
    `UPDATE countries
     SET destination_count = (
       SELECT COUNT(*) FROM destinations
       WHERE country_id = $1 AND is_active = true AND status = 'published'
     ), updated_at = NOW()
     WHERE id = $1`,
    [countryId],
  ).catch(err => console.warn(`${LOG} syncCountryDestCount failed:`, err.message))
}

const createUniqueSlug = async (name, excludeId = null) => {
  const base = slugify(name) || `destination-${Date.now()}`
  let slug   = base
  let counter = 1

  while (true) {
    const rows = await safeQuery(
      `SELECT id FROM destinations WHERE slug = $1${excludeId ? ' AND id != $2' : ''}`,
      excludeId ? [slug, excludeId] : [slug],
    )
    if (!rows.length) break
    slug = `${base}-${counter++}`
    if (counter > 100) throw new Error('Cannot generate unique slug after 100 attempts')
  }
  return slug
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCHEMA BOOTSTRAP
═══════════════════════════════════════════════════════════════════════════ */

exports.ensureDestinationSchema = async () => {
  const run = (sql) =>
    query(sql).catch(e => console.warn(`${LOG} [Schema] skipped:`, e.message.slice(0, 120)))

  /* ── Base table (if it doesn't exist) ─────────────────────────────── */
  await run(`
    CREATE TABLE IF NOT EXISTS destinations (
      id                       SERIAL PRIMARY KEY,
      name                     TEXT NOT NULL,
      slug                     TEXT NOT NULL UNIQUE,
      country_id               INTEGER,
      tagline                  TEXT,
      short_description        TEXT,
      description              TEXT,
      overview                 TEXT,
      what_to_expect           TEXT,
      best_time_to_visit       TEXT,
      getting_there            TEXT,
      local_tips               TEXT,
      safety_info              TEXT,
      category                 TEXT DEFAULT 'safari',
      difficulty               TEXT DEFAULT 'moderate',
      destination_type         TEXT,
      latitude                 NUMERIC(10,7),
      longitude                NUMERIC(10,7),
      altitude_meters          NUMERIC(8,2),
      address                  TEXT,
      region                   TEXT,
      nearest_city             TEXT,
      nearest_airport          TEXT,
      distance_from_airport_km NUMERIC(8,2),
      image_url                TEXT,
      image_urls               TEXT[] DEFAULT '{}'::TEXT[],
      hero_image               TEXT,
      thumbnail_url            TEXT,
      cover_image_url          TEXT,
      video_url                TEXT,
      virtual_tour_url         TEXT,
      duration_days            INTEGER,
      duration_nights          INTEGER,
      duration_display         TEXT,
      min_group_size           INTEGER DEFAULT 1,
      max_group_size           INTEGER,
      min_age                  INTEGER,
      fitness_level            TEXT,
      highlights               TEXT[] DEFAULT '{}'::TEXT[],
      activities               TEXT[] DEFAULT '{}'::TEXT[],
      wildlife                 TEXT[] DEFAULT '{}'::TEXT[],
      entrance_fee             TEXT,
      operating_hours          TEXT,
      status                   TEXT DEFAULT 'draft',
      is_active                BOOLEAN DEFAULT true,
      is_featured              BOOLEAN DEFAULT false,
      is_popular               BOOLEAN DEFAULT false,
      is_new                   BOOLEAN DEFAULT false,
      is_eco_friendly          BOOLEAN DEFAULT false,
      is_family_friendly       BOOLEAN DEFAULT false,
      is_sold_out              BOOLEAN DEFAULT false,
      rating                   NUMERIC(3,2) DEFAULT 0,
      review_count             INTEGER DEFAULT 0,
      view_count               INTEGER DEFAULT 0,
      booking_count            INTEGER DEFAULT 0,
      wishlist_count           INTEGER DEFAULT 0,
      share_count              INTEGER DEFAULT 0,
      meta_title               TEXT,
      meta_description         TEXT,
      published_at             TIMESTAMPTZ,
      featured_at              TIMESTAMPTZ,
      created_by               INTEGER,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  /* ── Column additions for existing installs ──────────────────────── */
  const colMigrations = [
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS tagline            TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS overview           TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS what_to_expect     TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS best_time_to_visit TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS getting_there      TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS local_tips         TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS safety_info        TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS destination_type   TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS latitude           NUMERIC(10,7)`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS longitude          NUMERIC(10,7)`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS altitude_meters    NUMERIC(8,2)`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS address            TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS region             TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS nearest_city       TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS nearest_airport    TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS distance_from_airport_km NUMERIC(8,2)`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS image_urls         TEXT[] DEFAULT '{}'::TEXT[]`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS hero_image         TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS thumbnail_url      TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS cover_image_url    TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS video_url          TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS virtual_tour_url   TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS duration_days      INTEGER`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS duration_nights    INTEGER`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS duration_display   TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS min_group_size     INTEGER DEFAULT 1`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS max_group_size     INTEGER`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS min_age            INTEGER`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS fitness_level      TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS highlights         TEXT[] DEFAULT '{}'::TEXT[]`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS activities         TEXT[] DEFAULT '{}'::TEXT[]`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS wildlife           TEXT[] DEFAULT '{}'::TEXT[]`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS entrance_fee       TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS operating_hours    TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS status             TEXT DEFAULT 'draft'`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS is_active          BOOLEAN DEFAULT true`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS is_featured        BOOLEAN DEFAULT false`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS is_popular         BOOLEAN DEFAULT false`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS is_new             BOOLEAN DEFAULT false`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS is_eco_friendly    BOOLEAN DEFAULT false`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS is_family_friendly BOOLEAN DEFAULT false`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS is_sold_out        BOOLEAN DEFAULT false`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS rating             NUMERIC(3,2) DEFAULT 0`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS review_count       INTEGER DEFAULT 0`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS view_count         INTEGER DEFAULT 0`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS booking_count      INTEGER DEFAULT 0`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS wishlist_count     INTEGER DEFAULT 0`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS share_count        INTEGER DEFAULT 0`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS meta_title         TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS meta_description   TEXT`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS published_at       TIMESTAMPTZ`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS featured_at        TIMESTAMPTZ`,
    `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS created_by         INTEGER`,

    /* Widen narrow VARCHAR columns */
    `DO $$BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='destinations' AND column_name='status'
                    AND data_type='character varying' AND character_maximum_length < 30)
       THEN ALTER TABLE destinations ALTER COLUMN status TYPE TEXT; END IF;
     END$$`,
    `DO $$BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='destinations' AND column_name='difficulty'
                    AND data_type='character varying' AND character_maximum_length < 50)
       THEN ALTER TABLE destinations ALTER COLUMN difficulty TYPE TEXT; END IF;
     END$$`,
  ]

  for (const sql of colMigrations) await run(sql)

  /* ── Satellite tables ────────────────────────────────────────────── */
  await run(`
    CREATE TABLE IF NOT EXISTS destination_images (
      id             SERIAL PRIMARY KEY,
      destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      image_url      TEXT    NOT NULL,
      thumbnail_url  TEXT,
      caption        TEXT,
      alt_text       TEXT,
      is_primary     BOOLEAN     DEFAULT false,
      is_active      BOOLEAN     DEFAULT true,
      sort_order     INTEGER     DEFAULT 0,
      uploaded_by    INTEGER,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )`)

  await run(`
    CREATE TABLE IF NOT EXISTS destination_itineraries (
      id             SERIAL PRIMARY KEY,
      destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      day_number     INTEGER NOT NULL,
      title          TEXT    NOT NULL,
      description    TEXT,
      activities     TEXT[]  DEFAULT '{}'::TEXT[],
      highlights     TEXT[]  DEFAULT '{}'::TEXT[],
      meals          TEXT[]  DEFAULT '{}'::TEXT[],
      accommodation  TEXT,
      distance_km    NUMERIC(8,2),
      image_url      TEXT,
      sort_order     INTEGER     DEFAULT 0,
      is_active      BOOLEAN     DEFAULT true,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )`)

  await run(`
    CREATE TABLE IF NOT EXISTS destination_faqs (
      id             SERIAL PRIMARY KEY,
      destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      question       TEXT    NOT NULL,
      answer         TEXT    NOT NULL,
      category       TEXT,
      helpful_count  INTEGER     DEFAULT 0,
      sort_order     INTEGER     DEFAULT 0,
      is_active      BOOLEAN     DEFAULT true,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )`)

  await run(`
    CREATE TABLE IF NOT EXISTS destination_reviews (
      id               SERIAL PRIMARY KEY,
      destination_id   INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      user_id          INTEGER,
      reviewer_name    TEXT        DEFAULT 'Anonymous',
      reviewer_country TEXT,
      reviewer_avatar  TEXT,
      title            TEXT,
      content          TEXT NOT NULL,
      overall_rating   NUMERIC(3,2) NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
      trip_date        DATE,
      trip_type        TEXT,
      images           TEXT[]      DEFAULT '{}'::TEXT[],
      helpful_count    INTEGER     DEFAULT 0,
      status           TEXT        DEFAULT 'pending',
      is_verified      BOOLEAN     DEFAULT false,
      is_featured      BOOLEAN     DEFAULT false,
      is_active        BOOLEAN     DEFAULT true,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    )`)

  await run(`ALTER TABLE destination_reviews ADD COLUMN IF NOT EXISTS is_active  BOOLEAN DEFAULT true`)
  await run(`ALTER TABLE destination_reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`)

  await run(`
    CREATE TABLE IF NOT EXISTS destination_tags (
      id             SERIAL PRIMARY KEY,
      destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      tag_name       TEXT NOT NULL,
      tag_slug       TEXT NOT NULL,
      tag_category   TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(destination_id, tag_slug)
    )`)

  await run(`
    CREATE TABLE IF NOT EXISTS destination_practical_info (
      id                       SERIAL PRIMARY KEY,
      destination_id           INTEGER NOT NULL UNIQUE REFERENCES destinations(id) ON DELETE CASCADE,
      nearest_airport          TEXT,
      distance_from_airport    TEXT,
      drive_time_from_capital  TEXT,
      road_conditions          TEXT,
      transport_options        TEXT[]  DEFAULT '{}'::TEXT[],
      border_crossings         TEXT,
      vaccinations_required    TEXT[]  DEFAULT '{}'::TEXT[],
      vaccinations_recommended TEXT[]  DEFAULT '{}'::TEXT[],
      malaria_risk             TEXT,
      water_safety             TEXT,
      medical_facilities       TEXT,
      emergency_contacts       JSONB   DEFAULT '{}'::JSONB,
      safety_rating            TEXT,
      safety_notes             TEXT,
      permits_required         TEXT[]  DEFAULT '{}'::TEXT[],
      permit_cost              TEXT,
      booking_lead_time        TEXT,
      visitor_limits           TEXT,
      regulations              TEXT,
      avg_temp_low_c           NUMERIC(4,1),
      avg_temp_high_c          NUMERIC(4,1),
      rainfall_mm_annual       NUMERIC(8,2),
      humidity_percent         INTEGER,
      uv_index_peak            INTEGER,
      best_months              TEXT[]  DEFAULT '{}'::TEXT[],
      avoid_months             TEXT[]  DEFAULT '{}'::TEXT[],
      climate_notes            TEXT,
      packing_essentials       TEXT[]  DEFAULT '{}'::TEXT[],
      clothing_tips            TEXT,
      gear_recommendations     TEXT[]  DEFAULT '{}'::TEXT[],
      budget_range_usd         TEXT,
      entrance_fee_usd         TEXT,
      guide_cost_usd           TEXT,
      meal_cost_range          TEXT,
      cell_coverage            TEXT,
      wifi_available           BOOLEAN DEFAULT false,
      electricity_voltage      TEXT,
      plug_types               TEXT[]  DEFAULT '{}'::TEXT[],
      currency_tips            TEXT,
      tipping_culture          TEXT,
      local_etiquette          TEXT[]  DEFAULT '{}'::TEXT[],
      photography_rules        TEXT,
      updated_at               TIMESTAMPTZ DEFAULT NOW()
    )`)

  await run(`
    CREATE TABLE IF NOT EXISTS destination_tips (
      id             SERIAL PRIMARY KEY,
      destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      tip_id         INTEGER NOT NULL,
      sort_order     INTEGER DEFAULT 0,
      is_featured    BOOLEAN DEFAULT false,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(destination_id, tip_id)
    )`)

  /* ── Indexes ─────────────────────────────────────────────────────── */
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_dest_slug            ON destinations (slug)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_country_active  ON destinations (country_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_status          ON destinations (status)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_is_active       ON destinations (is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_is_featured     ON destinations (is_featured) WHERE is_featured = true`,
    `CREATE INDEX IF NOT EXISTS idx_dest_category        ON destinations (category)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_rating          ON destinations (rating DESC NULLS LAST)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_created_at      ON destinations (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_published_at    ON destinations (published_at DESC NULLS LAST)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_images_dest     ON destination_images (destination_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_itin_dest       ON destination_itineraries (destination_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_faqs_dest       ON destination_faqs (destination_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_rev_dest_status ON destination_reviews (destination_id, status, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_tags_dest       ON destination_tags (destination_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_practical_dest  ON destination_practical_info (destination_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_tips_dest       ON destination_tips (destination_id)`,
  ]

  for (const idx of indexes) await run(idx)

  COLUMN_META = null
  await getColumnMeta()

  console.log(`${LOG} ✅ Schema bootstrap complete`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   SQL FRAGMENTS
═══════════════════════════════════════════════════════════════════════════ */

const BASE_SELECT = `
  SELECT
    d.*,
    c.name      AS country_name,
    c.slug      AS country_slug,
    c.flag      AS country_flag,
    c.flag_url  AS country_flag_url,
    c.continent AS country_continent,
    c.region    AS country_region
  FROM destinations d
  LEFT JOIN countries c ON c.id = d.country_id
`

const REVIEW_AGG_SQL = `
  SELECT
    ROUND(AVG(overall_rating)::numeric, 2)                    AS avg_rating,
    COUNT(*)::INTEGER                                          AS total_reviews,
    COUNT(*) FILTER (WHERE overall_rating >= 4.5)::INTEGER    AS five_star,
    COUNT(*) FILTER (WHERE overall_rating >= 3.5
                       AND overall_rating  < 4.5)::INTEGER    AS four_star,
    COUNT(*) FILTER (WHERE overall_rating >= 2.5
                       AND overall_rating  < 3.5)::INTEGER    AS three_star,
    COUNT(*) FILTER (WHERE overall_rating >= 1.5
                       AND overall_rating  < 2.5)::INTEGER    AS two_star,
    COUNT(*) FILTER (WHERE overall_rating  < 1.5)::INTEGER    AS one_star
  FROM destination_reviews
  WHERE destination_id = $1 AND status = 'approved' AND is_active = true
`

/* ═══════════════════════════════════════════════════════════════════════════
   SERIALISERS
═══════════════════════════════════════════════════════════════════════════ */

const serialize = (row) => {
  if (!row) return null
  const images  = toArr(row.image_urls)
  const mainImg = images[0] || row.image_url || null

  return {
    id:               row.id,
    slug:             row.slug,
    name:             row.name,
    tagline:          row.tagline,
    shortDescription: row.short_description,
    description:      row.description,
    overview:         row.overview,

    highlights:      toArr(row.highlights),
    activities:      toArr(row.activities),
    wildlife:        toArr(row.wildlife),
    bestTimeToVisit: row.best_time_to_visit,
    gettingThere:    row.getting_there,
    whatToExpect:    row.what_to_expect,
    localTips:       row.local_tips,
    safetyInfo:      row.safety_info,

    category:        row.category,
    difficulty:      row.difficulty,
    destinationType: row.destination_type,

    country: {
      id:        row.country_id,
      slug:      row.country_slug      || null,
      name:      row.country_name      || null,
      flag:      row.country_flag      || null,
      flagUrl:   row.country_flag_url  || null,
      continent: row.country_continent || null,
      region:    row.country_region    || null,
    },
    countryId:   row.country_id,
    countrySlug: row.country_slug || null,
    countryName: row.country_name || null,

    region:                row.region,
    nearestCity:           row.nearest_city,
    nearestAirport:        row.nearest_airport,
    distanceFromAirportKm: toNum(row.distance_from_airport_km),
    address:               row.address,
    latitude:              toNum(row.latitude),
    longitude:             toNum(row.longitude),
    altitudeMeters:        toNum(row.altitude_meters),
    mapPosition:           { lat: toNum(row.latitude), lng: toNum(row.longitude) },

    images,
    imageUrl:      mainImg,
    heroImage:     row.hero_image      || mainImg,
    thumbnailUrl:  row.thumbnail_url   || mainImg,
    coverImageUrl: row.cover_image_url || mainImg,
    videoUrl:      row.video_url,
    virtualTourUrl:row.virtual_tour_url,

    duration:       row.duration_display || fmtDuration(row.duration_days, row.duration_nights),
    durationDays:   toNum(row.duration_days),
    durationNights: toNum(row.duration_nights),
    minGroupSize:   toNum(row.min_group_size, 1),
    maxGroupSize:   toNum(row.max_group_size),
    minAge:         toNum(row.min_age),
    fitnessLevel:   row.fitness_level,

    rating:        toNum(row.rating, 0),
    reviewCount:   toNum(row.review_count, 0),
    viewCount:     toNum(row.view_count, 0),
    bookingCount:  toNum(row.booking_count, 0),
    wishlistCount: toNum(row.wishlist_count, 0),
    shareCount:    toNum(row.share_count, 0),

    entranceFee:    row.entrance_fee,
    operatingHours: row.operating_hours,
    isSoldOut:      toBool(row.is_sold_out),

    status:           row.status,
    isActive:         toBool(row.is_active),
    isFeatured:       toBool(row.is_featured),
    isPopular:        toBool(row.is_popular),
    isNew:            toBool(row.is_new),
    isEcoFriendly:    toBool(row.is_eco_friendly),
    isFamilyFriendly: toBool(row.is_family_friendly),

    metaTitle:       row.meta_title,
    metaDescription: row.meta_description,

    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
    publishedAt: row.published_at,
    featuredAt:  row.featured_at,

    gallery:         [],
    itinerary:       [],
    faqs:            [],
    reviews:         [],
    reviewAggregate: null,
    tips:            [],
    tags:            [],
    related:         [],
    practicalInfo:   null,
    howToGetThere:   null,
  }
}

const serializeImage = (img) => ({
  id:           img.id,
  imageUrl:     img.image_url,
  thumbnailUrl: img.thumbnail_url,
  caption:      img.caption,
  altText:      img.alt_text,
  isPrimary:    toBool(img.is_primary),
  sortOrder:    toNum(img.sort_order, 0),
})

const serializeReview = (row) => ({
  id:              row.id,
  reviewerName:    row.reviewer_name,
  reviewerCountry: row.reviewer_country,
  reviewerAvatar:  row.reviewer_avatar,
  title:           row.title,
  content:         row.content,
  rating:          toNum(row.overall_rating),
  tripDate:        row.trip_date,
  tripType:        row.trip_type,
  images:          toArr(row.images),
  isVerified:      toBool(row.is_verified),
  isFeatured:      toBool(row.is_featured),
  helpfulCount:    toNum(row.helpful_count, 0),
  createdAt:       row.created_at,
})

const serializeAggregate = (agg) => {
  const a = agg || {}
  return {
    avgRating:    toNum(a.avg_rating, 0),
    totalReviews: parseInt(a.total_reviews, 10) || 0,
    distribution: {
      fiveStar:  parseInt(a.five_star,  10) || 0,
      fourStar:  parseInt(a.four_star,  10) || 0,
      threeStar: parseInt(a.three_star, 10) || 0,
      twoStar:   parseInt(a.two_star,   10) || 0,
      oneStar:   parseInt(a.one_star,   10) || 0,
    },
  }
}

const serializePracticalInfo = (row) => {
  if (!row) return null
  return {
    id:            row.id,
    destinationId: row.destination_id,
    gettingThere: {
      nearestAirport:       row.nearest_airport,
      distanceFromAirport:  row.distance_from_airport,
      driveTimeFromCapital: row.drive_time_from_capital,
      roadConditions:       row.road_conditions,
      transportOptions:     toArr(row.transport_options),
      borderCrossings:      row.border_crossings,
    },
    healthAndSafety: {
      vaccinationsRequired:    toArr(row.vaccinations_required),
      vaccinationsRecommended: toArr(row.vaccinations_recommended),
      malariaRisk:             row.malaria_risk,
      waterSafety:             row.water_safety,
      medicalFacilities:       row.medical_facilities,
      emergencyContacts:       parseJson(row.emergency_contacts, {}),
      safetyRating:            row.safety_rating,
      safetyNotes:             row.safety_notes,
    },
    permitsAndRegulations: {
      permitsRequired: toArr(row.permits_required),
      permitCost:      row.permit_cost,
      bookingLeadTime: row.booking_lead_time,
      visitorLimits:   row.visitor_limits,
      regulations:     row.regulations,
    },
    climate: {
      avgTempLowC:      toNum(row.avg_temp_low_c),
      avgTempHighC:     toNum(row.avg_temp_high_c),
      rainfallMmAnnual: toNum(row.rainfall_mm_annual),
      humidityPercent:  toNum(row.humidity_percent),
      uvIndexPeak:      toNum(row.uv_index_peak),
      bestMonths:       toArr(row.best_months),
      avoidMonths:      toArr(row.avoid_months),
      climateNotes:     row.climate_notes,
    },
    packing: {
      essentials:          toArr(row.packing_essentials),
      clothingTips:        row.clothing_tips,
      gearRecommendations: toArr(row.gear_recommendations),
    },
    budget: {
      rangeUsd:       row.budget_range_usd,
      entranceFeeUsd: row.entrance_fee_usd,
      guideCostUsd:   row.guide_cost_usd,
      mealCostRange:  row.meal_cost_range,
    },
    connectivity: {
      cellCoverage:       row.cell_coverage,
      wifiAvailable:      toBool(row.wifi_available),
      electricityVoltage: row.electricity_voltage,
      plugTypes:          toArr(row.plug_types),
    },
    culture: {
      currencyTips:     row.currency_tips,
      tippingCulture:   row.tipping_culture,
      localEtiquette:   toArr(row.local_etiquette),
      photographyRules: row.photography_rules,
    },
    updatedAt: row.updated_at,
  }
}

const serializeTipLink = (row) => ({
  id:         row.id,
  tipId:      row.tip_id,
  slug:       row.slug,
  headline:   row.headline || row.slug,
  summary:    row.summary,
  body:       row.body,
  category:   row.category,
  tripPhase:  row.trip_phase,
  icon:       row.icon,
  imageUrl:   row.image_url,
  tags:       toArr(row.tags),
  checklist:  toArr(row.checklist),
  isFeatured: toBool(row.is_featured),
  sortOrder:  toNum(row.sort_order, 0),
})

/* ═══════════════════════════════════════════════════════════════════════════
   FILTER / SORT BUILDERS
═══════════════════════════════════════════════════════════════════════════ */

const buildFilters = async (filters, { adminMode = false } = {}) => {
  const conds  = []
  const params = []
  let   pi     = 1

  /* ── ACTIVE FILTER ────────────────────────────────────────────────── */
  if (adminMode) {
    /* Admin: show everything unless explicitly filtered */
    if (filters.is_active !== undefined && filters.is_active !== '') {
      conds.push(`d.is_active = $${pi++}`)
      params.push(toBool(filters.is_active))
    }
    if (filters.status) {
      conds.push(`d.status = $${pi++}`)
      params.push(filters.status)
    }
  } else {
    /* Public: only active + published by default */
    conds.push(`d.is_active = true`)
    if (filters.status) {
      conds.push(`d.status = $${pi++}`)
      params.push(filters.status)
    } else {
      conds.push(`d.status = 'published'`)
    }
  }

  /* ── COUNTRY ──────────────────────────────────────────────────────── */
  if (filters.country || filters.country_id || filters.countrySlug) {
    const c = await resolveCountry(
      filters.country || filters.country_id || filters.countrySlug,
    )
    if (c) {
      conds.push(`d.country_id = $${pi++}`)
      params.push(c.id)
    } else {
      conds.push('1 = 0')
    }
  }

  if (filters.continent) {
    conds.push(`c.continent ILIKE $${pi++}`)
    params.push(filters.continent)
  }

  if (filters.category) {
    conds.push(`d.category = $${pi++}`)
    params.push(filters.category)
  }

  if (filters.difficulty) {
    conds.push(`d.difficulty = $${pi++}`)
    params.push(filters.difficulty)
  }

  if (filters.destination_type) {
    conds.push(`d.destination_type = $${pi++}`)
    params.push(filters.destination_type)
  }

  if (filters.minRating) {
    conds.push(`d.rating >= $${pi++}`)
    params.push(parseFloat(filters.minRating))
  }

  if (filters.minDuration) {
    conds.push(`d.duration_days >= $${pi++}`)
    params.push(parseInt(filters.minDuration, 10))
  }

  if (filters.maxDuration) {
    conds.push(`d.duration_days <= $${pi++}`)
    params.push(parseInt(filters.maxDuration, 10))
  }

  const boolFlags = ['featured','popular','new','eco_friendly','family_friendly']
  for (const flag of boolFlags) {
    const camel = flag.replace(/_([a-z])/g, (_, l) => l.toUpperCase())
    const val   = filters[camel] !== undefined ? filters[camel] : filters[flag]
    if (val !== undefined && val !== '') {
      conds.push(`d.is_${flag} = $${pi++}`)
      params.push(toBool(val))
    }
  }

  const term = filters.search || filters.q
  if (term) {
    conds.push(`(
      d.name              ILIKE $${pi} OR
      d.description       ILIKE $${pi} OR
      d.short_description ILIKE $${pi} OR
      c.name              ILIKE $${pi}
    )`)
    params.push(`%${term}%`)
    pi++
  }

  if (filters.tag) {
    conds.push(`EXISTS (
      SELECT 1 FROM destination_tags dt
      WHERE dt.destination_id = d.id AND dt.tag_slug = $${pi++}
    )`)
    params.push(filters.tag.toLowerCase())
  }

  if (filters.bounds) {
    const parts = filters.bounds.split(',').map(Number)
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [swLat, swLng, neLat, neLng] = parts
      conds.push(`d.latitude  BETWEEN $${pi} AND $${pi + 1}`)
      conds.push(`d.longitude BETWEEN $${pi + 2} AND $${pi + 3}`)
      params.push(swLat, neLat, swLng, neLng)
      pi += 4
    }
  }

  if (filters.exclude) {
    const ids = toArr(filters.exclude).map(Number).filter(Number.isFinite)
    if (ids.length) {
      conds.push(`d.id != ALL($${pi++})`)
      params.push(ids)
    }
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return { where, params, nextIdx: pi }
}

const SORT_MAP = {
  name:     'd.name ASC',
  '-name':  'd.name DESC',
  rating:   'd.rating DESC NULLS LAST',
  newest:   'd.created_at DESC',
  oldest:   'd.created_at ASC',
  popular:  'd.booking_count DESC NULLS LAST, d.view_count DESC NULLS LAST',
  featured: 'd.is_featured DESC, d.rating DESC NULLS LAST, d.created_at DESC',
  views:    'd.view_count DESC NULLS LAST',
  duration: 'd.duration_days ASC NULLS LAST',
  random:   'RANDOM()',
}

const buildSort = (sort) => SORT_MAP[sort] || SORT_MAP.newest

/* ═══════════════════════════════════════════════════════════════════════════
   GET ALL
═══════════════════════════════════════════════════════════════════════════ */

exports.getAll = async (req, res, next) => {
  try {
    const {
      page   = 1,
      limit  = 20,
      sort   = 'newest',
      ...filters
    } = req.query

    const adminMode = isAdminRequest(req)
    const lim       = safeLimit(limit, 20)
    const pg        = safePage(page,   1)
    const offset    = safeOffset(pg, lim)

    const { where, params, nextIdx } = await buildFilters(filters, { adminMode })
    const orderBy = buildSort(sort)

    const [countRes, dataRes] = await Promise.all([
      query(
        `SELECT COUNT(*)
         FROM destinations d
         LEFT JOIN countries c ON c.id = d.country_id
         ${where}`,
        params,
      ),
      query(
        `${BASE_SELECT} ${where}
         ORDER BY ${orderBy}
         LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
        [...params, lim, offset],
      ),
    ])

    const total      = parseInt(countRes.rows[0].count, 10)
    const totalPages = Math.ceil(total / lim) || 0

    return res.json({
      success: true,
      data:    dataRes.rows.map(serialize),
      pagination: {
        total,
        page:        pg,
        limit:       lim,
        total_pages: totalPages,
        has_next:    pg < totalPages,
        has_prev:    pg > 1,
      },
      meta: { adminMode },
    })
  } catch (err) {
    console.error(`${LOG} getAll failed:`, err)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET FEATURED
═══════════════════════════════════════════════════════════════════════════ */

exports.getFeatured = async (req, res, next) => {
  try {
    const { limit = 8, country, continent } = req.query
    const lim    = Math.min(parseInt(limit, 10) || 8, 50)
    const conds  = [`d.is_featured = true`, `d.is_active = true`, `d.status = 'published'`]
    const params = []
    let   pi     = 1

    if (country) {
      const c = await resolveCountry(country)
      if (c) { conds.push(`d.country_id = $${pi++}`); params.push(c.id) }
    }
    if (continent) {
      conds.push(`c.continent ILIKE $${pi++}`)
      params.push(continent)
    }
    params.push(lim)

    const rows = await safeQuery(
      `${BASE_SELECT}
       WHERE ${conds.join(' AND ')}
       ORDER BY d.featured_at DESC NULLS LAST, d.rating DESC NULLS LAST
       LIMIT $${pi}`,
      params, 'getFeatured',
    )

    return res.json({ success: true, data: rows.map(serialize), count: rows.length })
  } catch (err) { next(err) }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET POPULAR
═══════════════════════════════════════════════════════════════════════════ */

exports.getPopular = async (req, res, next) => {
  try {
    const { limit = 8, country } = req.query
    const lim    = Math.min(parseInt(limit, 10) || 8, 50)
    const conds  = [`d.is_active = true`, `d.status = 'published'`]
    const params = []
    let   pi     = 1

    if (country) {
      const c = await resolveCountry(country)
      if (c) { conds.push(`d.country_id = $${pi++}`); params.push(c.id) }
    }
    params.push(lim)

    const rows = await safeQuery(
      `${BASE_SELECT}
       WHERE ${conds.join(' AND ')}
       ORDER BY d.booking_count DESC NULLS LAST, d.view_count DESC NULLS LAST, d.rating DESC NULLS LAST
       LIMIT $${pi}`,
      params, 'getPopular',
    )

    return res.json({ success: true, data: rows.map(serialize), count: rows.length })
  } catch (err) { next(err) }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET NEW
═══════════════════════════════════════════════════════════════════════════ */

exports.getNew = async (req, res, next) => {
  try {
    const safeDays = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365)
    const lim      = Math.min(parseInt(req.query.limit, 10) || 8, 50)

    const rows = await safeQuery(
      `${BASE_SELECT}
       WHERE d.is_active = true AND d.status = 'published'
         AND (d.is_new = true OR d.created_at >= NOW() - ($1 || ' days')::INTERVAL)
       ORDER BY d.created_at DESC
       LIMIT $2`,
      [safeDays, lim], 'getNew',
    )

    return res.json({ success: true, data: rows.map(serialize), count: rows.length })
  } catch (err) { next(err) }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET BY COUNTRY
═══════════════════════════════════════════════════════════════════════════ */

exports.getByCountry = async (req, res, next) => {
  try {
    const { countrySlug }                                       = req.params
    const { page = 1, limit = 12, sort = 'newest', category }   = req.query

    const lim    = safeLimit(limit, 12)
    const pg     = safePage(page, 1)
    const offset = safeOffset(pg, lim)

    const country = await resolveCountry(countrySlug)
    if (!country) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    const conds  = [`d.country_id = $1`, `d.is_active = true`, `d.status = 'published'`]
    const params = [country.id]
    let   pi     = 2

    if (category) {
      conds.push(`d.category = $${pi++}`)
      params.push(category)
    }

    const where = `WHERE ${conds.join(' AND ')}`

    const [countRes, dataRes] = await Promise.all([
      query(
        `SELECT COUNT(*)
         FROM destinations d
         LEFT JOIN countries c ON c.id = d.country_id
         ${where}`,
        params,
      ),
      query(
        `${BASE_SELECT} ${where}
         ORDER BY ${buildSort(sort)}
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, lim, offset],
      ),
    ])

    const total      = parseInt(countRes.rows[0].count, 10)
    const totalPages = Math.ceil(total / lim) || 0

    return res.json({
      success: true,
      data:    dataRes.rows.map(serialize),
      pagination: {
        total, page: pg, limit: lim, total_pages: totalPages,
        has_next: pg < totalPages, has_prev: pg > 1,
      },
      country: {
        id:               country.id,
        slug:             country.slug,
        name:             country.name,
        flag:             country.flag,
        continent:        country.continent,
        destinationCount: total,
      },
    })
  } catch (err) { next(err) }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET CATEGORIES / DIFFICULTIES / MAP / SEARCH / SUGGESTIONS / TAGS
═══════════════════════════════════════════════════════════════════════════ */

exports.getCategories = async (req, res, next) => {
  try {
    const { country } = req.query
    const adminMode   = isAdminRequest(req)
    const conds       = [`d.category IS NOT NULL`]
    const params      = []

    if (!adminMode) {
      conds.unshift(`d.is_active = true`, `d.status = 'published'`)
    }

    let pi = 1
    if (country) {
      const c = await resolveCountry(country)
      if (c) { conds.push(`d.country_id = $${pi++}`); params.push(c.id) }
    }

    const rows = await safeQuery(
      `SELECT
         d.category,
         COUNT(*)::INTEGER                                              AS count,
         ROUND(AVG(d.rating) FILTER (WHERE d.rating > 0)::numeric, 2) AS avg_rating
       FROM destinations d
       LEFT JOIN countries c ON c.id = d.country_id
       WHERE ${conds.join(' AND ')}
       GROUP BY d.category
       ORDER BY count DESC`,
      params, 'getCategories',
    )

    return res.json({
      success: true,
      data: rows.map(r => ({
        name:        r.category,
        slug:        slugify(r.category),
        displayName: r.category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        count:       r.count,
        avgRating:   toNum(r.avg_rating),
      })),
    })
  } catch (err) { next(err) }
}

exports.getDifficulties = async (req, res, next) => {
  try {
    const rows = await safeQuery(
      `SELECT difficulty, COUNT(*)::INTEGER AS count
       FROM destinations
       WHERE difficulty IS NOT NULL
       GROUP BY difficulty
       ORDER BY CASE difficulty
         WHEN 'easy'        THEN 1 WHEN 'moderate'   THEN 2
         WHEN 'challenging' THEN 3 WHEN 'difficult'  THEN 4
         WHEN 'expert'      THEN 5 ELSE 6 END`,
      [], 'getDifficulties',
    )
    return res.json({
      success: true,
      data: rows.map(r => ({
        level:       r.difficulty,
        displayName: r.difficulty.charAt(0).toUpperCase() + r.difficulty.slice(1),
        count:       r.count,
      })),
    })
  } catch (err) { next(err) }
}

exports.getMapData = async (req, res, next) => {
  try {
    const { country, category, bounds, limit = 500 } = req.query
    const lim    = Math.min(parseInt(limit, 10) || 500, 1000)
    const conds  = [
      `d.is_active = true`,
      `d.status = 'published'`,
      `d.latitude IS NOT NULL`,
      `d.longitude IS NOT NULL`,
    ]
    const params = []
    let   pi     = 1

    if (country) {
      const c = await resolveCountry(country)
      if (c) { conds.push(`d.country_id = $${pi++}`); params.push(c.id) }
    }
    if (category) {
      conds.push(`d.category = $${pi++}`)
      params.push(category)
    }
    if (bounds) {
      const parts = bounds.split(',').map(Number)
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        const [swLat, swLng, neLat, neLng] = parts
        conds.push(`d.latitude  BETWEEN $${pi} AND $${pi + 1}`)
        conds.push(`d.longitude BETWEEN $${pi + 2} AND $${pi + 3}`)
        params.push(swLat, neLat, swLng, neLng)
        pi += 4
      }
    }
    params.push(lim)

    const rows = await safeQuery(
      `SELECT d.id, d.name, d.slug, d.latitude, d.longitude,
              d.category, d.difficulty, d.image_url, d.short_description,
              d.rating, d.review_count, d.is_featured, d.is_popular,
              c.name AS country_name, c.slug AS country_slug, c.flag AS country_flag
       FROM destinations d
       LEFT JOIN countries c ON c.id = d.country_id
       WHERE ${conds.join(' AND ')}
       ORDER BY d.is_featured DESC, d.rating DESC NULLS LAST
       LIMIT $${pi}`,
      params, 'getMapData',
    )

    return res.json({
      success: true,
      count:   rows.length,
      data: rows.map(r => ({
        id:               r.id,
        name:             r.name,
        slug:             r.slug,
        position:         { lat: toNum(r.latitude), lng: toNum(r.longitude) },
        category:         r.category,
        difficulty:       r.difficulty,
        imageUrl:         r.image_url,
        shortDescription: r.short_description,
        rating:           toNum(r.rating),
        reviewCount:      toNum(r.review_count),
        isFeatured:       toBool(r.is_featured),
        isPopular:        toBool(r.is_popular),
        country: { name: r.country_name, slug: r.country_slug, flag: r.country_flag },
      })),
    })
  } catch (err) { next(err) }
}

exports.search = async (req, res, next) => {
  try {
    const { q, page = 1, limit = 12 } = req.query
    const lim = safeLimit(limit, 12)

    if (!q || q.length < 2) {
      return res.json({
        success:    true,
        data:       [],
        pagination: { total: 0, page: 1, limit: lim, total_pages: 0, has_next: false, has_prev: false },
      })
    }

    const pg     = safePage(page, 1)
    const offset = safeOffset(pg, lim)

    const adminMode = isAdminRequest(req)
    const { where, params, nextIdx } = await buildFilters({ search: q }, { adminMode })

    const [countRes, dataRes] = await Promise.all([
      query(
        `SELECT COUNT(*)
         FROM destinations d
         LEFT JOIN countries c ON c.id = d.country_id
         ${where}`,
        params,
      ),
      query(
        `${BASE_SELECT} ${where}
         ORDER BY CASE WHEN d.name ILIKE $${nextIdx + 2} THEN 0 ELSE 1 END,
                  d.rating DESC NULLS LAST
         LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
        [...params, lim, offset, `${q}%`],
      ),
    ])

    const total      = parseInt(countRes.rows[0].count, 10)
    const totalPages = Math.ceil(total / lim) || 0

    return res.json({
      success: true,
      data:    dataRes.rows.map(serialize),
      pagination: {
        total, page: pg, limit: lim, total_pages: totalPages,
        has_next: pg < totalPages, has_prev: pg > 1,
      },
      query: q,
    })
  } catch (err) { next(err) }
}

exports.getSuggestions = async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query
    if (!q || q.length < 2) return res.json({ success: true, data: [] })

    const lim  = Math.min(parseInt(limit, 10) || 10, 20)
    const rows = await safeQuery(
      `SELECT d.id, d.name, d.slug, d.category, d.image_url, d.rating,
              c.name AS country_name, c.slug AS country_slug, c.flag AS country_flag
       FROM destinations d
       LEFT JOIN countries c ON c.id = d.country_id
       WHERE d.is_active = true AND d.status = 'published'
         AND (d.name ILIKE $1 OR c.name ILIKE $1)
       ORDER BY CASE WHEN d.name ILIKE $2 THEN 0 ELSE 1 END,
                d.is_featured DESC, d.rating DESC NULLS LAST
       LIMIT $3`,
      [`%${q}%`, `${q}%`, lim], 'getSuggestions',
    )

    return res.json({
      success: true,
      data: rows.map(r => ({
        id:       r.id,
        name:     r.name,
        slug:     r.slug,
        category: r.category,
        imageUrl: r.image_url,
        rating:   toNum(r.rating),
        country:  { name: r.country_name, slug: r.country_slug, flag: r.country_flag },
        type:     'destination',
      })),
    })
  } catch (err) { next(err) }
}

exports.getTags = async (req, res, next) => {
  try {
    const lim  = Math.min(parseInt(req.query.limit, 10) || 50, 200)
    const rows = await safeQuery(
      `SELECT dt.tag_name, dt.tag_slug, dt.tag_category,
              COUNT(DISTINCT dt.destination_id)::INTEGER AS count
       FROM destination_tags dt
       INNER JOIN destinations d ON dt.destination_id = d.id
         AND d.is_active = true AND d.status = 'published'
       GROUP BY dt.tag_name, dt.tag_slug, dt.tag_category
       ORDER BY count DESC
       LIMIT $1`,
      [lim], 'getTags',
    )
    return res.json({
      success: true,
      data: rows.map(r => ({
        name:     r.tag_name,
        slug:     r.tag_slug,
        category: r.tag_category,
        count:    r.count,
      })),
    })
  } catch (err) { next(err) }
}

exports.getStats = async (req, res, next) => {
  try {
    const [statsRows, byCatRows, byCountryRows] = await Promise.all([
      safeQuery(
        `SELECT
           COUNT(*)::INTEGER                                          AS total,
           COUNT(*) FILTER (WHERE status = 'published')::INTEGER     AS published,
           COUNT(*) FILTER (WHERE status = 'draft')::INTEGER         AS draft,
           COUNT(*) FILTER (WHERE is_active = true)::INTEGER         AS active,
           COUNT(*) FILTER (WHERE is_featured = true)::INTEGER       AS featured,
           COUNT(*) FILTER (WHERE is_popular  = true)::INTEGER       AS popular,
           COUNT(DISTINCT country_id)::INTEGER                       AS countries,
           ROUND(AVG(rating) FILTER (WHERE rating > 0)::numeric, 2) AS avg_rating,
           COALESCE(SUM(view_count),   0)::INTEGER                  AS total_views,
           COALESCE(SUM(review_count), 0)::INTEGER                  AS total_reviews
         FROM destinations`,
        [], 'stats:overview',
      ),
      safeQuery(
        `SELECT category, COUNT(*)::INTEGER AS count
         FROM destinations
         WHERE category IS NOT NULL
         GROUP BY category ORDER BY count DESC`,
        [], 'stats:category',
      ),
      safeQuery(
        `SELECT c.name, c.slug, c.flag, COUNT(d.id)::INTEGER AS count
         FROM destinations d
         JOIN countries c ON d.country_id = c.id
         GROUP BY c.id, c.name, c.slug, c.flag
         ORDER BY count DESC LIMIT 10`,
        [], 'stats:country',
      ),
    ])

    const s = statsRows[0] || {}
    return res.json({
      success: true,
      data: {
        overview: {
          total:        s.total         || 0,
          published:    s.published     || 0,
          draft:        s.draft         || 0,
          active:       s.active        || 0,
          featured:     s.featured      || 0,
          popular:      s.popular       || 0,
          countries:    s.countries     || 0,
          avgRating:    toNum(s.avg_rating),
          totalViews:   s.total_views   || 0,
          totalReviews: s.total_reviews || 0,
        },
        byCategory: byCatRows.map(r => ({ category: r.category, count: r.count })),
        byCountry:  byCountryRows.map(r => ({ name: r.name, slug: r.slug, flag: r.flag, count: r.count })),
      },
    })
  } catch (err) { next(err) }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET ONE
═══════════════════════════════════════════════════════════════════════════ */

exports.getOne = async (req, res, next) => {
  try {
    const idOrSlug = req.params.idOrSlug || req.params.slug || req.params.id
    if (!idOrSlug) {
      return res.status(400).json({ success: false, error: 'Destination id or slug required' })
    }

    const adminMode = isAdminRequest(req)
    const isNum     = /^\d+$/.test(String(idOrSlug))
    const col       = isNum ? 'd.id' : 'd.slug'
    const val       = isNum ? parseInt(idOrSlug, 10) : String(idOrSlug).toLowerCase()

    /* Admin can view inactive; public sees only active */
    const activeClause = adminMode ? '' : 'AND d.is_active = true'

    const rows = await safeQuery(
      `${BASE_SELECT} WHERE ${col} = $1 ${activeClause}`,
      [val], 'getOne:main',
    )

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Destination not found' })
    }

    const row    = rows[0]
    const destId = row.id

    /* Fire-and-forget view bump (only for public) */
    if (!adminMode) {
      query(
        `UPDATE destinations SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1`,
        [destId],
      ).catch(() => {})
    }

    const dest = serialize(row)

    const raw      = String(req.query.include || '')
    const includes = raw ? raw.split(',').map(s => s.trim().toLowerCase()) : []
    const all      = includes.includes('all')

    const tasks = []

    if (all || includes.includes('gallery') || includes.includes('images')) {
      tasks.push(safeTask('gallery', async () => {
        const r = await safeQuery(
          `SELECT * FROM destination_images
           WHERE destination_id = $1 AND is_active = true
           ORDER BY is_primary DESC, sort_order ASC`,
          [destId], 'getOne:gallery',
        )
        dest.gallery = r.map(serializeImage)
      }))
    }

    if (all || includes.includes('itinerary')) {
      tasks.push(safeTask('itinerary', async () => {
        const r = await safeQuery(
          `SELECT * FROM destination_itineraries
           WHERE destination_id = $1 AND is_active = true
           ORDER BY day_number ASC, sort_order ASC`,
          [destId], 'getOne:itinerary',
        )
        dest.itinerary = r.map(it => ({
          id:            it.id,
          dayNumber:     it.day_number,
          title:         it.title,
          description:   it.description,
          activities:    toArr(it.activities),
          highlights:    toArr(it.highlights),
          meals:         toArr(it.meals),
          accommodation: it.accommodation,
          distanceKm:    toNum(it.distance_km),
          imageUrl:      it.image_url,
        }))
      }))
    }

    if (all || includes.includes('faqs')) {
      tasks.push(safeTask('faqs', async () => {
        const r = await safeQuery(
          `SELECT * FROM destination_faqs
           WHERE destination_id = $1 AND is_active = true
           ORDER BY sort_order ASC, id ASC`,
          [destId], 'getOne:faqs',
        )
        dest.faqs = r.map(f => ({
          id:           f.id,
          question:     f.question,
          answer:       f.answer,
          category:     f.category,
          helpfulCount: toNum(f.helpful_count, 0),
        }))
      }))
    }

    if (all || includes.includes('reviews')) {
      tasks.push(safeTask('reviews', async () => {
        const [reviewRows, aggRows] = await Promise.all([
          safeQuery(
            `SELECT * FROM destination_reviews
             WHERE destination_id = $1 AND status = 'approved' AND is_active = true
             ORDER BY is_featured DESC, created_at DESC
             LIMIT 10`,
            [destId], 'getOne:reviews',
          ),
          safeQuery(REVIEW_AGG_SQL, [destId], 'getOne:agg'),
        ])
        dest.reviews         = reviewRows.map(serializeReview)
        const agg            = serializeAggregate(aggRows[0])
        dest.reviewAggregate = agg
        dest.aggregate       = agg
      }))
    }

    if (all || includes.includes('tags')) {
      tasks.push(safeTask('tags', async () => {
        const r = await safeQuery(
          `SELECT * FROM destination_tags
           WHERE destination_id = $1
           ORDER BY tag_category ASC, tag_name ASC`,
          [destId], 'getOne:tags',
        )
        dest.tags = r.map(t => ({
          id: t.id, name: t.tag_name, slug: t.tag_slug, category: t.tag_category,
        }))
      }))
    }

    if (all || includes.includes('practical') || includes.includes('practical_info')) {
      tasks.push(safeTask('practical_info', async () => {
        const r = await safeQuery(
          `SELECT * FROM destination_practical_info WHERE destination_id = $1`,
          [destId], 'getOne:practical',
        )
        dest.practicalInfo = serializePracticalInfo(r[0] || null)
      }))
    }

    if (all || includes.includes('related')) {
      tasks.push(safeTask('related', async () => {
        const r = await safeQuery(
          `${BASE_SELECT}
           WHERE d.id != $1
             AND d.is_active = true
             AND d.status = 'published'
             AND (d.country_id = $2 OR d.category = $3)
           ORDER BY
             CASE
               WHEN d.country_id = $2 AND d.category = $3 THEN 0
               WHEN d.category   = $3                      THEN 1
               WHEN d.country_id = $2                      THEN 2
               ELSE 3
             END,
             d.rating DESC NULLS LAST
           LIMIT 6`,
          [destId, row.country_id, row.category], 'getOne:related',
        )
        dest.related = r.map(serialize)
      }))
    }

    await Promise.all(tasks)

    if (!dest.gallery?.length && dest.images?.length) {
      dest.gallery = dest.images.map((url, i) => ({
        id:           `img-${i}`,
        imageUrl:     url,
        thumbnailUrl: url,
        isPrimary:    i === 0,
        sortOrder:    i,
      }))
    }

    return res.json({ success: true, data: dest })
  } catch (err) { next(err) }
}

exports.getRelated = async (req, res, next) => {
  try {
    const idOrSlug = req.params.idOrSlug || req.params.slug || req.params.id
    const lim      = Math.min(parseInt(req.query.limit, 10) || 6, 20)
    const isNum    = /^\d+$/.test(String(idOrSlug))

    const source = await safeQuery(
      `SELECT id, country_id, category FROM destinations
       WHERE ${isNum ? 'id' : 'slug'} = $1 AND is_active = true`,
      [isNum ? parseInt(idOrSlug, 10) : String(idOrSlug).toLowerCase()],
      'getRelated:source',
    )

    if (!source.length) {
      return res.status(404).json({ success: false, error: 'Destination not found' })
    }

    const { id, country_id, category } = source[0]
    const rows = await safeQuery(
      `${BASE_SELECT}
       WHERE d.id != $1
         AND d.is_active = true
         AND d.status = 'published'
         AND (d.country_id = $2 OR d.category = $3)
       ORDER BY
         CASE
           WHEN d.country_id = $2 AND d.category = $3 THEN 0
           WHEN d.category   = $3                      THEN 1
           WHEN d.country_id = $2                      THEN 2
           ELSE 3
         END,
         d.rating DESC NULLS LAST
       LIMIT $4`,
      [id, country_id, category, lim], 'getRelated:results',
    )

    return res.json({ success: true, data: rows.map(serialize), count: rows.length })
  } catch (err) { next(err) }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN CRUD — CREATE
═══════════════════════════════════════════════════════════════════════════ */

exports.create = async (req, res, next) => {
  try {
    const data = req.body || {}

    if (!data.name?.trim()) {
      return res.status(400).json({ success: false, error: 'name is required' })
    }
    if (!data.country_id) {
      return res.status(400).json({ success: false, error: 'country_id is required' })
    }

    const country = await resolveCountry(data.country_id)
    if (!country) {
      return res.status(400).json({ success: false, error: 'Invalid country_id' })
    }

    await getColumnMeta()

    const slug = await createUniqueSlug(data.name.trim())

    const uploadedImg = req.file ? getUploadedFileUrl(req.file) : null
    let   imageUrls   = toArr(data.image_urls)
    if (uploadedImg) imageUrls = [uploadedImg, ...imageUrls.filter(u => u !== uploadedImg)]
    if (!imageUrls.length && data.image_url) imageUrls = [data.image_url]
    const mainImg = imageUrls[0] || null

    const status      = truncate('status', data.status || 'draft')
    const publishedAt = status === 'published' ? new Date() : null
    const featuredAt  = toBool(data.is_featured) ? new Date() : null

    const { rows } = await query(
      `INSERT INTO destinations (
        country_id, name, slug, tagline, short_description, description, overview,
        what_to_expect, best_time_to_visit, getting_there, local_tips, safety_info,
        category, difficulty, destination_type,
        latitude, longitude, altitude_meters, address, region,
        nearest_city, nearest_airport, distance_from_airport_km,
        image_url, image_urls, hero_image, thumbnail_url, video_url, virtual_tour_url,
        duration_days, duration_nights, duration_display,
        min_group_size, max_group_size, min_age, fitness_level,
        highlights, activities, wildlife,
        entrance_fee, operating_hours,
        status, is_active, is_featured, is_popular, is_new, is_eco_friendly, is_family_friendly,
        meta_title, meta_description,
        published_at, featured_at, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
        $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53
      ) RETURNING *`,
      [
        country.id,
        data.name.trim(),
        slug,
        data.tagline           || null,
        data.short_description || null,
        data.description       || null,
        data.overview          || null,
        data.what_to_expect    || null,
        data.best_time_to_visit|| country.best_time_to_visit || null,
        data.getting_there     || null,
        data.local_tips        || null,
        data.safety_info       || null,
        truncate('category',   data.category   || 'safari'),
        truncate('difficulty', data.difficulty || 'moderate'),
        data.destination_type  || null,
        toNum(data.latitude),
        toNum(data.longitude),
        toNum(data.altitude_meters),
        data.address           || null,
        data.region            || country.region  || null,
        data.nearest_city      || country.capital || null,
        data.nearest_airport   || null,
        toNum(data.distance_from_airport_km),
        mainImg,
        imageUrls,
        data.hero_image        || mainImg,
        data.thumbnail_url     || mainImg,
        data.video_url         || null,
        data.virtual_tour_url  || null,
        toNum(data.duration_days),
        toNum(data.duration_nights),
        fmtDuration(toNum(data.duration_days), toNum(data.duration_nights)),
        toNum(data.min_group_size, 1),
        toNum(data.max_group_size),
        toNum(data.min_age),
        truncate('fitness_level', data.fitness_level || null),
        toArr(data.highlights),
        toArr(data.activities),
        toArr(data.wildlife),
        data.entrance_fee      || null,
        data.operating_hours   || null,
        status,
        data.is_active !== undefined ? toBool(data.is_active) : true,
        toBool(data.is_featured),
        toBool(data.is_popular),
        toBool(data.is_new),
        toBool(data.is_eco_friendly),
        toBool(data.is_family_friendly),
        data.meta_title        || data.name.trim(),
        data.meta_description  || data.short_description || null,
        publishedAt,
        featuredAt,
        req.user?.id           || null,
      ],
    )

    await syncCountryDestCount(country.id)

    const full = await safeQuery(`${BASE_SELECT} WHERE d.id = $1`, [rows[0].id], 'create:full')
    return res.status(201).json({
      success: true,
      message: 'Destination created',
      data:    serialize(full[0]),
    })
  } catch (err) {
    console.error(`${LOG} create FAILED:`, {
      message: err.message, code: err.code, detail: err.detail,
    })
    return handlePgError(err, res, next)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   UPDATE
═══════════════════════════════════════════════════════════════════════════ */

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params
    const data   = req.body || {}

    const existRows = await safeQuery(
      'SELECT * FROM destinations WHERE id = $1', [id], 'update:exist',
    )
    if (!existRows.length) {
      return res.status(404).json({ success: false, error: 'Destination not found' })
    }

    await getColumnMeta()

    const current = existRows[0]
    const fields  = { ...data }

    delete fields.id
    delete fields.created_at
    delete fields.slug
    delete fields.price
    delete fields.prices

    if (fields.name && fields.name.trim() !== current.name) {
      fields.name = fields.name.trim()
      fields.slug = await createUniqueSlug(fields.name, id)
    } else {
      delete fields.name
    }

    if (fields.country_id && parseInt(fields.country_id, 10) !== parseInt(current.country_id, 10)) {
      const newCountry = await resolveCountry(fields.country_id)
      if (!newCountry) {
        return res.status(400).json({ success: false, error: 'Invalid country_id' })
      }
      fields.country_id = newCountry.id
    }

    if (req.file) {
      const url         = getUploadedFileUrl(req.file)
      fields.image_url  = url
      const existing    = toArr(data.image_urls || current.image_urls)
      fields.image_urls = [url, ...existing.filter(u => u !== url)]
    } else if (fields.image_urls) {
      fields.image_urls = toArr(fields.image_urls)
      if (fields.image_urls.length) fields.image_url = fields.image_urls[0]
    }

    for (const f of ['highlights','activities','wildlife']) {
      if (fields[f] !== undefined) fields[f] = toArr(fields[f])
    }

    if (fields.duration_days !== undefined || fields.duration_nights !== undefined) {
      const d = toNum(fields.duration_days   ?? current.duration_days)
      const n = toNum(fields.duration_nights ?? current.duration_nights)
      fields.duration_display = fmtDuration(d, n)
    }

    if (fields.status === 'published' && current.status !== 'published') {
      fields.published_at = new Date()
    }

    if (fields.is_featured === true || fields.is_featured === 'true') {
      fields.is_featured = true
      if (!current.is_featured) fields.featured_at = new Date()
    } else if (fields.is_featured === false || fields.is_featured === 'false') {
      fields.is_featured = false
      fields.featured_at = null
    }

    /* Coerce boolean fields */
    const boolFields = ['is_active','is_popular','is_new','is_eco_friendly','is_family_friendly','is_sold_out']
    for (const f of boolFields) {
      if (fields[f] !== undefined) fields[f] = toBool(fields[f])
    }

    /* Truncate varchar */
    for (const col of Object.keys(VARCHAR_LIMITS)) {
      if (fields[col] !== undefined) fields[col] = truncate(col, fields[col])
    }

    for (const k of Object.keys(fields)) {
      if (fields[k] === undefined) delete fields[k]
    }

    const keys = Object.keys(fields)
    if (!keys.length) {
      return res.status(400).json({ success: false, error: 'No fields to update' })
    }

    const vals = [...keys.map(k => fields[k]), id]
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')

    await query(
      `UPDATE destinations SET ${sets}, updated_at = NOW() WHERE id = $${vals.length}`,
      vals,
    )

    if (fields.country_id && parseInt(fields.country_id, 10) !== parseInt(current.country_id, 10)) {
      await syncCountryDestCount(current.country_id)
      await syncCountryDestCount(fields.country_id)
    }

    const full = await safeQuery(`${BASE_SELECT} WHERE d.id = $1`, [id], 'update:full')
    return res.json({
      success: true,
      message: 'Destination updated',
      data:    serialize(full[0]),
    })
  } catch (err) {
    console.error(`${LOG} update FAILED:`, {
      message: err.message, code: err.code, detail: err.detail,
    })
    return handlePgError(err, res, next)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOGGLE ACTIVE / FEATURED
═══════════════════════════════════════════════════════════════════════════ */

exports.toggleActive = async (req, res, next) => {
  try {
    const { id } = req.params
    const { rows } = await query(
      `UPDATE destinations
       SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id],
    )
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Destination not found' })
    }
    return res.json({
      success: true,
      message: rows[0].is_active ? 'Destination activated' : 'Destination deactivated',
      data:    serialize(rows[0]),
    })
  } catch (err) { next(err) }
}

exports.toggleFeatured = async (req, res, next) => {
  try {
    const { id } = req.params
    const { rows } = await query(
      `UPDATE destinations
       SET is_featured = NOT is_featured,
           featured_at = CASE WHEN NOT is_featured THEN NOW() ELSE NULL END,
           updated_at  = NOW()
       WHERE id = $1 RETURNING *`,
      [id],
    )
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Destination not found' })
    }
    return res.json({
      success: true,
      message: rows[0].is_featured ? 'Marked as featured' : 'Removed from featured',
      data:    serialize(rows[0]),
    })
  } catch (err) { next(err) }
}

/* ═══════════════════════════════════════════════════════════════════════════
   REMOVE / RESTORE
═══════════════════════════════════════════════════════════════════════════ */

exports.remove = async (req, res, next) => {
  try {
    const { id }    = req.params
    const permanent = toBool(req.query.permanent)

    const existRows = await safeQuery(
      'SELECT id, name, slug, country_id FROM destinations WHERE id = $1',
      [id], 'remove:exist',
    )
    if (!existRows.length) {
      return res.status(404).json({ success: false, error: 'Destination not found' })
    }

    const { country_id, name, slug } = existRows[0]

    if (permanent) {
      await query('DELETE FROM destinations WHERE id = $1', [id])
    } else {
      await query(
        `UPDATE destinations
         SET is_active = false, status = 'archived', updated_at = NOW()
         WHERE id = $1`,
        [id],
      )
    }

    await syncCountryDestCount(country_id)

    return res.json({
      success: true,
      message: permanent ? 'Destination permanently deleted' : 'Destination archived',
      data:    { id: parseInt(id, 10), name, slug },
    })
  } catch (err) { next(err) }
}

exports.restore = async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE destinations
       SET is_active = true, status = 'draft', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id],
    )
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Destination not found' })
    }
    await syncCountryDestCount(rows[0].country_id)
    return res.json({ success: true, message: 'Destination restored', data: serialize(rows[0]) })
  } catch (err) { next(err) }
}

/* ═══════════════════════════════════════════════════════════════════════════
   BULK UPDATE / BULK DELETE
═══════════════════════════════════════════════════════════════════════════ */

exports.bulkUpdate = async (req, res, next) => {
  try {
    const { ids, updates } = req.body

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, error: 'ids array required' })
    }
    if (!updates || !Object.keys(updates).length) {
      return res.status(400).json({ success: false, error: 'updates object required' })
    }

    const ALLOWED = new Set([
      'status','is_active','is_featured','is_popular','is_new',
      'is_eco_friendly','is_family_friendly','category','difficulty',
    ])

    const fields = {}
    for (const k of Object.keys(updates)) {
      if (ALLOWED.has(k)) fields[k] = updates[k]
    }

    if (!Object.keys(fields).length) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' })
    }

    if (fields.is_featured === true || fields.is_featured === 'true') {
      fields.is_featured = true
      fields.featured_at = new Date()
    } else if (fields.is_featured === false || fields.is_featured === 'false') {
      fields.is_featured = false
      fields.featured_at = null
    }
    if (fields.status === 'published') fields.published_at = new Date()

    for (const col of Object.keys(VARCHAR_LIMITS)) {
      if (fields[col] !== undefined) fields[col] = truncate(col, fields[col])
    }

    const keys           = Object.keys(fields)
    const safeIds        = ids.map(x => parseInt(x, 10)).filter(Number.isFinite)
    const idPlaceholders = safeIds.map((_, i) => `$${keys.length + i + 1}`).join(', ')
    const sets           = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')

    const { rows } = await query(
      `UPDATE destinations SET ${sets}, updated_at = NOW()
       WHERE id IN (${idPlaceholders})
       RETURNING id, name, slug, status, is_active, is_featured`,
      [...keys.map(k => fields[k]), ...safeIds],
    )

    return res.json({
      success: true,
      message: `${rows.length} destination(s) updated`,
      data:    rows,
    })
  } catch (err) {
    return handlePgError(err, res, next)
  }
}

exports.bulkDelete = async (req, res, next) => {
  try {
    const { ids, permanent = false } = req.body

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, error: 'ids array required' })
    }

    const safeIds = ids.map(x => parseInt(x, 10)).filter(Number.isFinite)
    if (!safeIds.length) {
      return res.status(400).json({ success: false, error: 'No valid IDs provided' })
    }

    const isPermanent = toBool(permanent)
    let result

    if (isPermanent) {
      result = await query(
        `DELETE FROM destinations WHERE id = ANY($1::INTEGER[])
         RETURNING id, name, slug, country_id`,
        [safeIds],
      )
    } else {
      result = await query(
        `UPDATE destinations
         SET is_active = false, status = 'archived', updated_at = NOW()
         WHERE id = ANY($1::INTEGER[])
         RETURNING id, name, slug, country_id`,
        [safeIds],
      )
    }

    /* Sync all affected country counts */
    const countryIds = [...new Set(result.rows.map(r => r.country_id).filter(Boolean))]
    for (const cid of countryIds) await syncCountryDestCount(cid)

    return res.json({
      success: true,
      message: `${result.rows.length} destination(s) ${isPermanent ? 'deleted' : 'archived'}`,
      data:    result.rows,
    })
  } catch (err) {
    return handlePgError(err, res, next)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ITINERARY / FAQs / IMAGES / TAGS / TIPS / REVIEWS / ENGAGEMENT
   (unchanged sub-resource endpoints)
═══════════════════════════════════════════════════════════════════════════ */

exports.getItinerary = async (req, res, next) => {
  try {
    const rows = await safeQuery(
      `SELECT * FROM destination_itineraries
       WHERE destination_id = $1 AND is_active = true
       ORDER BY day_number ASC`,
      [req.params.id], 'getItinerary',
    )
    return res.json({
      success: true,
      data: rows.map(it => ({
        id: it.id, dayNumber: it.day_number, title: it.title,
        description: it.description, activities: toArr(it.activities),
        highlights: toArr(it.highlights), meals: toArr(it.meals),
        accommodation: it.accommodation, distanceKm: toNum(it.distance_km),
        imageUrl: it.image_url,
      })),
    })
  } catch (err) { next(err) }
}

exports.addItineraryDay = async (req, res, next) => {
  try {
    const { id } = req.params
    const { day_number, title, description, activities, highlights,
            meals, accommodation, distance_km, image_url } = req.body

    if (!title?.trim()) {
      return res.status(400).json({ success: false, error: 'title is required' })
    }

    const maxRows = await safeQuery(
      `SELECT COALESCE(MAX(day_number), 0)::INTEGER AS max
       FROM destination_itineraries WHERE destination_id = $1`,
      [id],
    )
    const dayNum = parseInt(day_number, 10) || (maxRows[0]?.max || 0) + 1

    const { rows } = await query(
      `INSERT INTO destination_itineraries
       (destination_id, day_number, title, description,
        activities, highlights, meals, accommodation, distance_km, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, dayNum, title.trim(), description || null,
       toArr(activities), toArr(highlights), toArr(meals),
       accommodation || null, toNum(distance_km), image_url || null],
    )
    return res.status(201).json({ success: true, data: rows[0] })
  } catch (err) { next(err) }
}

exports.updateItineraryDay = async (req, res, next) => {
  try {
    const { id, dayId } = req.params
    const fields = { ...req.body }
    for (const f of ['activities','highlights','meals']) {
      if (fields[f] !== undefined) fields[f] = toArr(fields[f])
    }
    const keys = Object.keys(fields).filter(k => fields[k] !== undefined)
    if (!keys.length) return res.status(400).json({ success: false, error: 'No fields to update' })

    const vals = [...keys.map(k => fields[k]), dayId, id]
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')

    const { rows } = await query(
      `UPDATE destination_itineraries SET ${sets}
       WHERE id = $${vals.length - 1} AND destination_id = $${vals.length}
       RETURNING *`,
      vals,
    )
    if (!rows.length) return res.status(404).json({ success: false, error: 'Itinerary day not found' })
    return res.json({ success: true, data: rows[0] })
  } catch (err) { next(err) }
}

exports.removeItineraryDay = async (req, res, next) => {
  try {
    const { id, dayId } = req.params
    const { rows } = await query(
      `DELETE FROM destination_itineraries
       WHERE id = $1 AND destination_id = $2 RETURNING id`,
      [dayId, id],
    )
    if (!rows.length) return res.status(404).json({ success: false, error: 'Itinerary day not found' })
    return res.json({ success: true, message: 'Itinerary day deleted' })
  } catch (err) { next(err) }
}

exports.getPracticalInfo = async (req, res, next) => {
  try {
    const rows = await safeQuery(
      `SELECT * FROM destination_practical_info WHERE destination_id = $1`,
      [req.params.id], 'getPracticalInfo',
    )
    return res.json({ success: true, data: serializePracticalInfo(rows[0] || null) })
  } catch (err) { next(err) }
}

exports.upsertPracticalInfo = async (req, res, next) => {
  try {
    const { id } = req.params
    const b      = req.body

    const destRows = await safeQuery(
      'SELECT id FROM destinations WHERE id = $1', [id], 'upsertPractical:check',
    )
    if (!destRows.length) return res.status(404).json({ success: false, error: 'Destination not found' })

    const { rows } = await query(
      `INSERT INTO destination_practical_info (
        destination_id, nearest_airport, distance_from_airport, drive_time_from_capital,
        road_conditions, transport_options, border_crossings,
        vaccinations_required, vaccinations_recommended, malaria_risk,
        water_safety, medical_facilities, emergency_contacts,
        safety_rating, safety_notes, permits_required, permit_cost,
        booking_lead_time, visitor_limits, regulations,
        avg_temp_low_c, avg_temp_high_c, rainfall_mm_annual, humidity_percent,
        uv_index_peak, best_months, avoid_months, climate_notes,
        packing_essentials, clothing_tips, gear_recommendations,
        budget_range_usd, entrance_fee_usd, guide_cost_usd, meal_cost_range,
        cell_coverage, wifi_available, electricity_voltage, plug_types,
        currency_tips, tipping_culture, local_etiquette, photography_rules, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,
                $40,$41,$42,$43, NOW())
      ON CONFLICT (destination_id) DO UPDATE SET
        nearest_airport = EXCLUDED.nearest_airport,
        distance_from_airport = EXCLUDED.distance_from_airport,
        drive_time_from_capital = EXCLUDED.drive_time_from_capital,
        road_conditions = EXCLUDED.road_conditions,
        transport_options = EXCLUDED.transport_options,
        border_crossings = EXCLUDED.border_crossings,
        vaccinations_required = EXCLUDED.vaccinations_required,
        vaccinations_recommended = EXCLUDED.vaccinations_recommended,
        malaria_risk = EXCLUDED.malaria_risk,
        water_safety = EXCLUDED.water_safety,
        medical_facilities = EXCLUDED.medical_facilities,
        emergency_contacts = EXCLUDED.emergency_contacts,
        safety_rating = EXCLUDED.safety_rating,
        safety_notes = EXCLUDED.safety_notes,
        permits_required = EXCLUDED.permits_required,
        permit_cost = EXCLUDED.permit_cost,
        booking_lead_time = EXCLUDED.booking_lead_time,
        visitor_limits = EXCLUDED.visitor_limits,
        regulations = EXCLUDED.regulations,
        avg_temp_low_c = EXCLUDED.avg_temp_low_c,
        avg_temp_high_c = EXCLUDED.avg_temp_high_c,
        rainfall_mm_annual = EXCLUDED.rainfall_mm_annual,
        humidity_percent = EXCLUDED.humidity_percent,
        uv_index_peak = EXCLUDED.uv_index_peak,
        best_months = EXCLUDED.best_months,
        avoid_months = EXCLUDED.avoid_months,
        climate_notes = EXCLUDED.climate_notes,
        packing_essentials = EXCLUDED.packing_essentials,
        clothing_tips = EXCLUDED.clothing_tips,
        gear_recommendations = EXCLUDED.gear_recommendations,
        budget_range_usd = EXCLUDED.budget_range_usd,
        entrance_fee_usd = EXCLUDED.entrance_fee_usd,
        guide_cost_usd = EXCLUDED.guide_cost_usd,
        meal_cost_range = EXCLUDED.meal_cost_range,
        cell_coverage = EXCLUDED.cell_coverage,
        wifi_available = EXCLUDED.wifi_available,
        electricity_voltage = EXCLUDED.electricity_voltage,
        plug_types = EXCLUDED.plug_types,
        currency_tips = EXCLUDED.currency_tips,
        tipping_culture = EXCLUDED.tipping_culture,
        local_etiquette = EXCLUDED.local_etiquette,
        photography_rules = EXCLUDED.photography_rules,
        updated_at = NOW()
      RETURNING *`,
      [
        id, b.nearest_airport || null, b.distance_from_airport || null,
        b.drive_time_from_capital || null, b.road_conditions || null,
        toArr(b.transport_options), b.border_crossings || null,
        toArr(b.vaccinations_required), toArr(b.vaccinations_recommended),
        truncate('malaria_risk', b.malaria_risk || null),
        b.water_safety || null, b.medical_facilities || null,
        b.emergency_contacts ? JSON.stringify(b.emergency_contacts) : '{}',
        truncate('safety_rating', b.safety_rating || null),
        b.safety_notes || null, toArr(b.permits_required),
        b.permit_cost || null, b.booking_lead_time || null,
        b.visitor_limits || null, b.regulations || null,
        toNum(b.avg_temp_low_c), toNum(b.avg_temp_high_c),
        toNum(b.rainfall_mm_annual), toNum(b.humidity_percent),
        toNum(b.uv_index_peak), toArr(b.best_months), toArr(b.avoid_months),
        b.climate_notes || null, toArr(b.packing_essentials),
        b.clothing_tips || null, toArr(b.gear_recommendations),
        b.budget_range_usd || null, b.entrance_fee_usd || null,
        b.guide_cost_usd || null, b.meal_cost_range || null,
        b.cell_coverage || null, toBool(b.wifi_available),
        b.electricity_voltage || null, toArr(b.plug_types),
        b.currency_tips || null, b.tipping_culture || null,
        toArr(b.local_etiquette), b.photography_rules || null,
      ],
    )

    return res.json({
      success: true,
      message: 'Practical info saved',
      data:    serializePracticalInfo(rows[0]),
    })
  } catch (err) {
    return handlePgError(err, res, next)
  }
}

/* ── Tips linking ── */
exports.getDestinationTipsLinked = async (req, res, next) => {
  try {
    const rows = await safeQuery(
      `SELECT dt_link.id, dt_link.tip_id, dt_link.sort_order, dt_link.is_featured,
              t.slug, t.summary, t.body, t.category, t.trip_phase,
              t.icon, t.image_url, t.tags, t.checklist
       FROM destination_tips dt_link
       INNER JOIN tips t ON t.id = dt_link.tip_id AND t.is_active = true
       WHERE dt_link.destination_id = $1
       ORDER BY dt_link.is_featured DESC, dt_link.sort_order ASC`,
      [req.params.id], 'getLinkedTips',
    )
    return res.json({ success: true, data: rows.map(serializeTipLink), count: rows.length })
  } catch (err) { next(err) }
}

exports.linkTip = async (req, res, next) => {
  try {
    const { id } = req.params
    const { tip_id, sort_order = 0, is_featured = false } = req.body

    if (!tip_id) return res.status(400).json({ success: false, error: 'tip_id is required' })

    const { rows } = await query(
      `INSERT INTO destination_tips (destination_id, tip_id, sort_order, is_featured)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (destination_id, tip_id) DO UPDATE SET
         sort_order = EXCLUDED.sort_order, is_featured = EXCLUDED.is_featured
       RETURNING *`,
      [id, tip_id, toNum(sort_order, 0), toBool(is_featured)],
    )
    return res.status(201).json({ success: true, data: rows[0] })
  } catch (err) { next(err) }
}

exports.unlinkTip = async (req, res, next) => {
  try {
    const { id, tipId } = req.params
    const { rows } = await query(
      `DELETE FROM destination_tips WHERE destination_id = $1 AND tip_id = $2 RETURNING id`,
      [id, tipId],
    )
    if (!rows.length) return res.status(404).json({ success: false, error: 'Tip link not found' })
    return res.json({ success: true, message: 'Tip unlinked' })
  } catch (err) { next(err) }
}

/* ── Engagement ── */
exports.incrementView = async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE destinations SET view_count = COALESCE(view_count, 0) + 1
       WHERE id = $1 RETURNING view_count`,
      [req.params.id],
    )
    if (!rows.length) return res.status(404).json({ success: false, error: 'Destination not found' })
    return res.json({ success: true, viewCount: parseInt(rows[0].view_count, 10) })
  } catch (err) { next(err) }
}

exports.incrementWishlist = async (req, res, next) => {
  try {
    const { id } = req.params
    const { action = 'add' } = req.body
    const inc = action === 'remove' ? -1 : 1
    const { rows } = await query(
      `UPDATE destinations
       SET wishlist_count = GREATEST(0, COALESCE(wishlist_count, 0) + $2)
       WHERE id = $1 RETURNING wishlist_count`,
      [id, inc],
    )
    if (!rows.length) return res.status(404).json({ success: false, error: 'Destination not found' })
    return res.json({ success: true, wishlistCount: parseInt(rows[0].wishlist_count, 10) })
  } catch (err) { next(err) }
}

exports.incrementShare = async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE destinations SET share_count = COALESCE(share_count, 0) + 1
       WHERE id = $1 RETURNING share_count`,
      [req.params.id],
    )
    return res.json({ success: true, shareCount: parseInt(rows[0]?.share_count || 0, 10) })
  } catch (err) { next(err) }
}

/* ── Reviews ── */
exports.getReviews = async (req, res, next) => {
  try {
    const { id } = req.params
    const { page = 1, limit = 10, sort = '-created' } = req.query

    const sortMap = {
      'created': 'created_at ASC', '-created': 'created_at DESC',
      'rating': 'overall_rating DESC', 'helpful': 'helpful_count DESC',
    }
    const orderBy = sortMap[sort] || sortMap['-created']
    const lim     = Math.min(parseInt(limit, 10) || 10, 50)
    const pg      = Math.max(parseInt(page, 10) || 1, 1)
    const offset  = (pg - 1) * lim

    const [countRows, reviewRows, aggRows] = await Promise.all([
      safeQuery(
        `SELECT COUNT(*)::INTEGER AS count FROM destination_reviews
         WHERE destination_id = $1 AND status = 'approved' AND is_active = true`,
        [id], 'reviews:count',
      ),
      safeQuery(
        `SELECT * FROM destination_reviews
         WHERE destination_id = $1 AND status = 'approved' AND is_active = true
         ORDER BY is_featured DESC, ${orderBy}
         LIMIT $2 OFFSET $3`,
        [id, lim, offset], 'reviews:list',
      ),
      safeQuery(REVIEW_AGG_SQL, [id], 'reviews:agg'),
    ])

    const total      = countRows[0]?.count || 0
    const totalPages = Math.ceil(total / lim) || 0

    return res.json({
      success: true,
      data:    reviewRows.map(serializeReview),
      pagination: {
        total, page: pg, limit: lim, total_pages: totalPages,
        has_next: pg < totalPages, has_prev: pg > 1,
      },
      aggregate: serializeAggregate(aggRows[0]),
    })
  } catch (err) { next(err) }
}

exports.addReview = async (req, res, next) => {
  try {
    const { id } = req.params
    const { reviewer_name, reviewer_country, title, content,
            overall_rating, trip_date, trip_type } = req.body

    if (!content?.trim()) {
      return res.status(400).json({ success: false, error: 'content is required' })
    }
    const rating = parseFloat(overall_rating)
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: 'overall_rating must be 1–5' })
    }

    const destRows = await safeQuery(
      'SELECT id FROM destinations WHERE id = $1 AND is_active = true',
      [id], 'addReview:check',
    )
    if (!destRows.length) return res.status(404).json({ success: false, error: 'Destination not found' })

    const images = req.files?.length
      ? req.files.map(f => getUploadedFileUrl(f))
      : toArr(req.body.images)

    const { rows } = await query(
      `INSERT INTO destination_reviews
       (destination_id, user_id, reviewer_name, reviewer_country,
        title, content, overall_rating, trip_date, trip_type, images, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending') RETURNING *`,
      [id, req.user?.id || null, reviewer_name?.trim() || 'Anonymous',
       reviewer_country || null, title?.trim() || null, content.trim(),
       rating, trip_date || null, trip_type || null, images],
    )

    return res.status(201).json({
      success: true,
      message: 'Review submitted and awaiting moderation.',
      data:    serializeReview(rows[0]),
    })
  } catch (err) { next(err) }
}

exports.markReviewHelpful = async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE destination_reviews SET helpful_count = COALESCE(helpful_count, 0) + 1
       WHERE id = $1 RETURNING helpful_count`,
      [req.params.reviewId],
    )
    if (!rows.length) return res.status(404).json({ success: false, error: 'Review not found' })
    return res.json({ success: true, helpfulCount: parseInt(rows[0].helpful_count, 10) })
  } catch (err) { next(err) }
}

/* ── Images ── */
exports.getImages = async (req, res, next) => {
  try {
    const rows = await safeQuery(
      `SELECT * FROM destination_images
       WHERE destination_id = $1 AND is_active = true
       ORDER BY is_primary DESC, sort_order ASC`,
      [req.params.id], 'getImages',
    )
    return res.json({ success: true, data: rows.map(serializeImage) })
  } catch (err) { next(err) }
}

exports.addImages = async (req, res, next) => {
  try {
    const { id } = req.params

    const destRows = await safeQuery(
      'SELECT id FROM destinations WHERE id = $1', [id], 'addImages:check',
    )
    if (!destRows.length) return res.status(404).json({ success: false, error: 'Destination not found' })

    if (!req.files?.length && !req.body.image_urls) {
      return res.status(400).json({ success: false, error: 'No images provided' })
    }

    const maxRows = await safeQuery(
      `SELECT COALESCE(MAX(sort_order), 0)::INTEGER AS max
       FROM destination_images WHERE destination_id = $1`,
      [id],
    )
    let order   = maxRows[0]?.max || 0
    const added = []
    const urls  = []

    const insertImage = async (url) => {
      order++
      const { rows } = await query(
        `INSERT INTO destination_images
         (destination_id, image_url, sort_order, caption, uploaded_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [id, url, order, req.body.caption || null, req.user?.id || null],
      )
      added.push(rows[0])
      urls.push(url)
    }

    if (req.files?.length) {
      for (const f of req.files) await insertImage(getUploadedFileUrl(f))
    }
    if (req.body.image_urls) {
      for (const url of toArr(req.body.image_urls)) await insertImage(url)
    }

    if (urls.length) {
      await query(
        `UPDATE destinations
         SET image_urls = COALESCE(image_urls, '{}'::TEXT[]) || $2::TEXT[],
             image_url  = COALESCE(image_url, $3),
             updated_at = NOW()
         WHERE id = $1`,
        [id, urls, urls[0]],
      )
    }

    return res.status(201).json({
      success: true,
      message: `${added.length} image(s) added`,
      data:    added.map(serializeImage),
    })
  } catch (err) { next(err) }
}

exports.updateImage = async (req, res, next) => {
  try {
    const { id, imageId } = req.params
    const { caption, alt_text, is_primary, sort_order } = req.body

    if (is_primary !== undefined && toBool(is_primary)) {
      await query(
        `UPDATE destination_images SET is_primary = false
         WHERE destination_id = $1 AND id != $2`,
        [id, imageId],
      )
    }

    const fields = {}
    if (caption    !== undefined) fields.caption    = caption
    if (alt_text   !== undefined) fields.alt_text   = alt_text
    if (is_primary !== undefined) fields.is_primary = toBool(is_primary)
    if (sort_order !== undefined) fields.sort_order = toNum(sort_order)

    const keys = Object.keys(fields)
    if (!keys.length) return res.status(400).json({ success: false, error: 'No fields to update' })

    const vals = [...keys.map(k => fields[k]), imageId, id]
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')

    const { rows } = await query(
      `UPDATE destination_images SET ${sets}
       WHERE id = $${vals.length - 1} AND destination_id = $${vals.length} RETURNING *`,
      vals,
    )
    if (!rows.length) return res.status(404).json({ success: false, error: 'Image not found' })

    if (toBool(is_primary)) {
      await query(
        `UPDATE destinations SET image_url = $2, updated_at = NOW() WHERE id = $1`,
        [id, rows[0].image_url],
      )
    }

    return res.json({ success: true, data: serializeImage(rows[0]) })
  } catch (err) { next(err) }
}

exports.removeImage = async (req, res, next) => {
  try {
    const { id, imageId } = req.params
    const { rows } = await query(
      `DELETE FROM destination_images WHERE id = $1 AND destination_id = $2 RETURNING *`,
      [imageId, id],
    )
    if (!rows.length) return res.status(404).json({ success: false, error: 'Image not found' })

    const deleted = rows[0]
    await query(
      `UPDATE destinations
       SET image_urls = array_remove(COALESCE(image_urls, '{}'::TEXT[]), $2),
           updated_at = NOW() WHERE id = $1`,
      [id, deleted.image_url],
    )

    if (deleted.is_primary) {
      const newPrimary = await safeQuery(
        `UPDATE destination_images SET is_primary = true
         WHERE id = (
           SELECT id FROM destination_images
           WHERE destination_id = $1 AND is_active = true
           ORDER BY sort_order ASC LIMIT 1
         ) RETURNING image_url`,
        [id],
      )
      await query(
        `UPDATE destinations SET image_url = $2, updated_at = NOW() WHERE id = $1`,
        [id, newPrimary[0]?.image_url || null],
      )
    }

    return res.json({ success: true, message: 'Image deleted' })
  } catch (err) { next(err) }
}

exports.reorderImages = async (req, res, next) => {
  try {
    const { id } = req.params
    const { imageIds } = req.body

    if (!Array.isArray(imageIds) || !imageIds.length) {
      return res.status(400).json({ success: false, error: 'imageIds array required' })
    }

    await Promise.all(
      imageIds.map((imgId, i) =>
        query(
          `UPDATE destination_images SET sort_order = $1
           WHERE id = $2 AND destination_id = $3`,
          [i + 1, imgId, id],
        ),
      ),
    )

    const ordered = await safeQuery(
      `SELECT image_url FROM destination_images
       WHERE destination_id = $1 AND is_active = true
       ORDER BY sort_order ASC`,
      [id],
    )
    const urls = ordered.map(r => r.image_url)

    await query(
      `UPDATE destinations SET image_urls = $2, image_url = $3, updated_at = NOW() WHERE id = $1`,
      [id, urls, urls[0] || null],
    )

    return res.json({ success: true, message: 'Images reordered' })
  } catch (err) { next(err) }
}

/* ── FAQs ── */
exports.getFaqs = async (req, res, next) => {
  try {
    const rows = await safeQuery(
      `SELECT * FROM destination_faqs
       WHERE destination_id = $1 AND is_active = true
       ORDER BY sort_order ASC, id ASC`,
      [req.params.id], 'getFaqs',
    )
    return res.json({
      success: true,
      data: rows.map(r => ({
        id: r.id, question: r.question, answer: r.answer,
        category: r.category, helpfulCount: toNum(r.helpful_count, 0),
      })),
    })
  } catch (err) { next(err) }
}

exports.addFaq = async (req, res, next) => {
  try {
    const { id } = req.params
    const { question, answer, category, sort_order } = req.body

    if (!question?.trim() || !answer?.trim()) {
      return res.status(400).json({ success: false, error: 'question and answer are required' })
    }

    const { rows } = await query(
      `INSERT INTO destination_faqs (destination_id, question, answer, category, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, question.trim(), answer.trim(), category || null, toNum(sort_order, 0)],
    )
    return res.status(201).json({ success: true, data: rows[0] })
  } catch (err) { next(err) }
}

exports.updateFaq = async (req, res, next) => {
  try {
    const { id, faqId } = req.params
    const fields = { ...req.body }
    const keys = Object.keys(fields).filter(k => fields[k] !== undefined)
    if (!keys.length) return res.status(400).json({ success: false, error: 'No fields to update' })

    const vals = [...keys.map(k => fields[k]), faqId, id]
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')

    const { rows } = await query(
      `UPDATE destination_faqs SET ${sets}
       WHERE id = $${vals.length - 1} AND destination_id = $${vals.length} RETURNING *`,
      vals,
    )
    if (!rows.length) return res.status(404).json({ success: false, error: 'FAQ not found' })
    return res.json({ success: true, data: rows[0] })
  } catch (err) { next(err) }
}

exports.removeFaq = async (req, res, next) => {
  try {
    const { id, faqId } = req.params
    const { rows } = await query(
      `DELETE FROM destination_faqs WHERE id = $1 AND destination_id = $2 RETURNING id`,
      [faqId, id],
    )
    if (!rows.length) return res.status(404).json({ success: false, error: 'FAQ not found' })
    return res.json({ success: true, message: 'FAQ deleted' })
  } catch (err) { next(err) }
}

/* ── Tags ── */
exports.getDestinationTags = async (req, res, next) => {
  try {
    const rows = await safeQuery(
      `SELECT * FROM destination_tags
       WHERE destination_id = $1
       ORDER BY tag_category ASC, tag_name ASC`,
      [req.params.id], 'getDestTags',
    )
    return res.json({
      success: true,
      data: rows.map(r => ({
        id: r.id, name: r.tag_name, slug: r.tag_slug, category: r.tag_category,
      })),
    })
  } catch (err) { next(err) }
}

exports.addDestinationTag = async (req, res, next) => {
  try {
    const { id } = req.params
    const { tag_name, tag_category } = req.body

    if (!tag_name?.trim()) return res.status(400).json({ success: false, error: 'tag_name is required' })

    const tag_slug = slugify(tag_name.trim())
    const { rows } = await query(
      `INSERT INTO destination_tags (destination_id, tag_name, tag_slug, tag_category)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (destination_id, tag_slug) DO NOTHING RETURNING *`,
      [id, tag_name.trim(), tag_slug, tag_category || null],
    )

    if (!rows.length) return res.status(409).json({ success: false, error: 'Tag already exists' })
    return res.status(201).json({ success: true, data: rows[0] })
  } catch (err) { next(err) }
}

exports.removeDestinationTag = async (req, res, next) => {
  try {
    const { id, tagId } = req.params
    const { rows } = await query(
      `DELETE FROM destination_tags WHERE id = $1 AND destination_id = $2 RETURNING id`,
      [tagId, id],
    )
    if (!rows.length) return res.status(404).json({ success: false, error: 'Tag not found' })
    return res.json({ success: true, message: 'Tag removed' })
  } catch (err) { next(err) }
}

module.exports = exports