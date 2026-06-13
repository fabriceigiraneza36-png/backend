// controllers/destinationsController.js
// ============================================================
// Destinations Controller — Full Production Implementation
// ✅ All related tables wrapped in safeTask (fault-tolerant)
// ✅ ensureDestinationSchema() bootstraps all tables on startup
// ✅ No pricing / payment anywhere
// ✅ Strong country relationship
// ============================================================

const { query } = require("../config/db");
const { slugify, paginate } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");

/* ═══════════════════════════════════════════════════════════════
   SCHEMA BOOTSTRAP
   Safe to call on every server start — all IF NOT EXISTS
   ═══════════════════════════════════════════════════════════════ */

exports.ensureDestinationSchema = async () => {
  const run = (sql) => query(sql).catch((e) =>
    console.warn("[Schema] Non-fatal:", e.message.slice(0, 120))
  );

  // ── Core destination columns (safe additions) ──────────────
  await run(`ALTER TABLE destinations ADD COLUMN IF NOT EXISTS featured_at    TIMESTAMP`);
  await run(`ALTER TABLE destinations ADD COLUMN IF NOT EXISTS created_by     INTEGER`);
  await run(`ALTER TABLE destinations ADD COLUMN IF NOT EXISTS share_count    INTEGER DEFAULT 0`);
  await run(`ALTER TABLE destinations ADD COLUMN IF NOT EXISTS duration_display VARCHAR(100)`);

  // ── destination_images ────────────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS destination_images (
      id             SERIAL PRIMARY KEY,
      destination_id INTEGER NOT NULL,
      image_url      TEXT    NOT NULL,
      thumbnail_url  TEXT,
      caption        VARCHAR(500),
      alt_text       VARCHAR(500),
      is_primary     BOOLEAN   DEFAULT false,
      is_active      BOOLEAN   DEFAULT true,
      sort_order     INTEGER   DEFAULT 0,
      uploaded_by    INTEGER,
      created_at     TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── destination_itineraries ───────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS destination_itineraries (
      id             SERIAL PRIMARY KEY,
      destination_id INTEGER NOT NULL,
      day_number     INTEGER NOT NULL,
      title          VARCHAR(500) NOT NULL,
      description    TEXT,
      activities     TEXT[]    DEFAULT '{}'::TEXT[],
      highlights     TEXT[]    DEFAULT '{}'::TEXT[],
      meals          TEXT[]    DEFAULT '{}'::TEXT[],
      accommodation  VARCHAR(500),
      distance_km    NUMERIC(8,2),
      image_url      TEXT,
      sort_order     INTEGER   DEFAULT 0,
      is_active      BOOLEAN   DEFAULT true,
      created_at     TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── destination_faqs ──────────────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS destination_faqs (
      id             SERIAL PRIMARY KEY,
      destination_id INTEGER NOT NULL,
      question       TEXT    NOT NULL,
      answer         TEXT    NOT NULL,
      category       VARCHAR(100),
      helpful_count  INTEGER   DEFAULT 0,
      sort_order     INTEGER   DEFAULT 0,
      is_active      BOOLEAN   DEFAULT true,
      created_at     TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── destination_reviews ───────────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS destination_reviews (
      id               SERIAL PRIMARY KEY,
      destination_id   INTEGER NOT NULL,
      user_id          INTEGER,
      reviewer_name    VARCHAR(255) DEFAULT 'Anonymous',
      reviewer_country VARCHAR(100),
      reviewer_avatar  TEXT,
      title            VARCHAR(500),
      content          TEXT NOT NULL,
      overall_rating   NUMERIC(3,2) NOT NULL
                         CHECK (overall_rating BETWEEN 1 AND 5),
      trip_date        DATE,
      trip_type        VARCHAR(100),
      images           TEXT[]    DEFAULT '{}'::TEXT[],
      helpful_count    INTEGER   DEFAULT 0,
      status           VARCHAR(30)  DEFAULT 'pending',
      is_verified      BOOLEAN   DEFAULT false,
      is_featured      BOOLEAN   DEFAULT false,
      created_at       TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── destination_tags ──────────────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS destination_tags (
      id             SERIAL PRIMARY KEY,
      destination_id INTEGER NOT NULL,
      tag_name       VARCHAR(255) NOT NULL,
      tag_slug       VARCHAR(255) NOT NULL,
      tag_category   VARCHAR(100),
      created_at     TIMESTAMP DEFAULT NOW(),
      UNIQUE(destination_id, tag_slug)
    )
  `);

  // ── destination_practical_info ────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS destination_practical_info (
      id             SERIAL PRIMARY KEY,
      destination_id INTEGER NOT NULL UNIQUE,
      nearest_airport          TEXT,
      distance_from_airport    TEXT,
      drive_time_from_capital  TEXT,
      road_conditions          TEXT,
      transport_options        TEXT[]  DEFAULT '{}'::TEXT[],
      border_crossings         TEXT,
      vaccinations_required    TEXT[]  DEFAULT '{}'::TEXT[],
      vaccinations_recommended TEXT[]  DEFAULT '{}'::TEXT[],
      malaria_risk             VARCHAR(50),
      water_safety             TEXT,
      medical_facilities       TEXT,
      emergency_contacts       JSONB   DEFAULT '{}'::JSONB,
      safety_rating            VARCHAR(30),
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
      electricity_voltage      VARCHAR(20),
      plug_types               TEXT[]  DEFAULT '{}'::TEXT[],
      currency_tips            TEXT,
      tipping_culture          TEXT,
      local_etiquette          TEXT[]  DEFAULT '{}'::TEXT[],
      photography_rules        TEXT,
      updated_at               TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── destination_tips (link table) ─────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS destination_tips (
      id             SERIAL PRIMARY KEY,
      destination_id INTEGER NOT NULL,
      tip_id         INTEGER NOT NULL,
      sort_order     INTEGER DEFAULT 0,
      is_featured    BOOLEAN DEFAULT false,
      created_at     TIMESTAMP DEFAULT NOW(),
      UNIQUE(destination_id, tip_id)
    )
  `);

  // ── Add destination_id to tips if missing ─────────────────
  await run(`ALTER TABLE tips ADD COLUMN IF NOT EXISTS destination_id INTEGER`);

  // ── Indexes ───────────────────────────────────────────────
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_dest_slug          ON destinations(slug)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_country_id    ON destinations(country_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_status        ON destinations(status)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_is_active     ON destinations(is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_is_featured   ON destinations(is_featured)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_category      ON destinations(category)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_rating        ON destinations(rating DESC NULLS LAST)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_images_destid ON destination_images(destination_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_itin_destid   ON destination_itineraries(destination_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_faqs_destid   ON destination_faqs(destination_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_rev_destid    ON destination_reviews(destination_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_rev_status    ON destination_reviews(destination_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_tags_destid   ON destination_tags(destination_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_practical_id  ON destination_practical_info(destination_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_tips_destid   ON destination_tips(destination_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dest_tips_tipid    ON destination_tips(tip_id)`,
  ];
  for (const idx of indexes) await run(idx);

  console.log("[Schema] ✅ Destination schema bootstrap complete");
};

/* ═══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

const toNumber = (value, defaultValue = null) => {
  if (value === null || value === undefined || value === "") return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
};

const toBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string")
    return value.toLowerCase() === "true" || value === "1";
  return Boolean(value);
};

const normalizeArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try { return JSON.parse(trimmed).filter(Boolean); }
      catch { return []; }
    }
    return trimmed.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [];
};

const parseJson = (value, defaultValue = {}) => {
  if (!value) return defaultValue;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); }
  catch { return defaultValue; }
};

const formatDuration = (days, nights) => {
  if (days && nights) return `${days} Days / ${nights} Nights`;
  if (days)   return `${days} Day${days > 1 ? "s" : ""}`;
  if (nights) return `${nights} Night${nights > 1 ? "s" : ""}`;
  return null;
};

// Wraps a task so one failing table never kills the whole getOne response
const safeTask = (label, fn) =>
  fn().catch((err) => {
    console.warn(`[destinations.getOne] ${label} failed (non-fatal):`, err.message?.slice(0, 100));
  });

/* ── Country resolver ─────────────────────────────────────── */
const resolveCountry = async (idOrSlug) => {
  if (!idOrSlug) return null;
  const str   = String(idOrSlug).trim();
  const isNum = /^\d+$/.test(str);
  const result = await query(
    `SELECT id, slug, name, flag, flag_url, continent, region, sub_region,
            currency, currency_symbol, timezone, calling_code, capital,
            languages, climate, best_time_to_visit, visa_info, health_info
     FROM countries
     WHERE ${isNum ? "id" : "slug"} = $1 AND is_active = true`,
    [isNum ? parseInt(str, 10) : str.toLowerCase()]
  );
  return result.rows[0] || null;
};

const syncCountryDestinationCount = async (countryId) => {
  if (!countryId) return;
  await query(
    `UPDATE countries
     SET destination_count = (
       SELECT COUNT(*) FROM destinations
       WHERE country_id = $1 AND is_active = true AND status = 'published'
     ), updated_at = NOW()
     WHERE id = $1`,
    [countryId]
  ).catch(() => {});
};

const createUniqueSlug = async (name, excludeId = null) => {
  const base = slugify(name);
  let slug    = base;
  let counter = 1;
  while (true) {
    const existing = await query(
      `SELECT id FROM destinations WHERE slug = $1 ${excludeId ? "AND id != $2" : ""}`,
      excludeId ? [slug, excludeId] : [slug]
    );
    if (existing.rows.length === 0) break;
    slug = `${base}-${counter++}`;
    if (counter > 100) throw new Error("Cannot generate unique slug");
  }
  return slug;
};

/* ═══════════════════════════════════════════════════════════════
   SERIALIZATION
   ═══════════════════════════════════════════════════════════════ */

const serialize = (row, options = {}) => {
  const images    = normalizeArray(row.image_urls);
  const mainImage = images[0] || row.image_url || null;

  return {
    id:   row.id,
    slug: row.slug,

    name:             row.name,
    tagline:          row.tagline,
    shortDescription: row.short_description,
    description:      row.description,
    overview:         row.overview,

    highlights:      row.highlights      || [],
    activities:      row.activities      || [],
    wildlife:        row.wildlife        || [],
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
      slug:      row.country_slug,
      name:      row.country_name,
      flag:      row.country_flag,
      flagUrl:   row.country_flag_url,
      continent: row.country_continent,
      region:    row.country_region,
    },
    countryId:   row.country_id,
    countrySlug: row.country_slug,
    countryName: row.country_name,

    region:                  row.region,
    nearestCity:             row.nearest_city,
    nearestAirport:          row.nearest_airport,
    distanceFromAirportKm:   toNumber(row.distance_from_airport_km),
    address:                 row.address,
    mapPosition: {
      lat: toNumber(row.latitude),
      lng: toNumber(row.longitude),
    },
    latitude:       toNumber(row.latitude),
    longitude:      toNumber(row.longitude),
    altitudeMeters: toNumber(row.altitude_meters),

    images,
    imageUrl:       mainImage,
    heroImage:      row.hero_image     || mainImage,
    thumbnailUrl:   row.thumbnail_url  || mainImage,
    videoUrl:       row.video_url,
    virtualTourUrl: row.virtual_tour_url,

    duration:       row.duration_display || formatDuration(row.duration_days, row.duration_nights),
    durationDays:   toNumber(row.duration_days),
    durationNights: toNumber(row.duration_nights),
    minGroupSize:   toNumber(row.min_group_size, 1),
    maxGroupSize:   toNumber(row.max_group_size),
    minAge:         toNumber(row.min_age),
    fitnessLevel:   row.fitness_level,

    rating:        toNumber(row.rating, 0),
    reviewCount:   toNumber(row.review_count, 0),
    viewCount:     toNumber(row.view_count, 0),
    bookingCount:  toNumber(row.booking_count, 0),
    wishlistCount: toNumber(row.wishlist_count, 0),

    entranceFee:    row.entrance_fee,
    operatingHours: row.operating_hours,
    isSoldOut:      toBoolean(row.is_sold_out),

    status:           row.status,
    isActive:         toBoolean(row.is_active),
    isFeatured:       toBoolean(row.is_featured),
    isPopular:        toBoolean(row.is_popular),
    isNew:            toBoolean(row.is_new),
    isEcoFriendly:    toBoolean(row.is_eco_friendly),
    isFamilyFriendly: toBoolean(row.is_family_friendly),

    metaTitle:       row.meta_title,
    metaDescription: row.meta_description,

    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
    publishedAt: row.published_at,

    // Relations — populated by getOne when include=all
    gallery:        [],
    itinerary:      [],
    faqs:           [],
    reviews:        [],
    reviewAggregate:null,
    tips:           [],
    tags:           [],
    related:        [],
    practicalInfo:  null,
    howToGetThere:  null,
  };
};

const serializeReview = (row) => ({
  id:             row.id,
  reviewerName:   row.reviewer_name,
  reviewerCountry:row.reviewer_country,
  reviewerAvatar: row.reviewer_avatar,
  title:          row.title,
  content:        row.content,
  rating:         toNumber(row.overall_rating),
  tripDate:       row.trip_date,
  tripType:       row.trip_type,
  images:         row.images || [],
  isVerified:     toBoolean(row.is_verified),
  isFeatured:     toBoolean(row.is_featured),
  helpfulCount:   toNumber(row.helpful_count, 0),
  createdAt:      row.created_at,
});

const serializePracticalInfo = (row) => {
  if (!row) return null;
  return {
    id:            row.id,
    destinationId: row.destination_id,

    gettingThere: {
      nearestAirport:       row.nearest_airport,
      distanceFromAirport:  row.distance_from_airport,
      driveTimeFromCapital: row.drive_time_from_capital,
      roadConditions:       row.road_conditions,
      transportOptions:     row.transport_options     || [],
      borderCrossings:      row.border_crossings,
    },

    healthAndSafety: {
      vaccinationsRequired:    row.vaccinations_required    || [],
      vaccinationsRecommended: row.vaccinations_recommended || [],
      malariaRisk:             row.malaria_risk,
      waterSafety:             row.water_safety,
      medicalFacilities:       row.medical_facilities,
      emergencyContacts:       parseJson(row.emergency_contacts, {}),
      safetyRating:            row.safety_rating,
      safetyNotes:             row.safety_notes,
    },

    permitsAndRegulations: {
      permitsRequired: row.permits_required  || [],
      permitCost:      row.permit_cost,
      bookingLeadTime: row.booking_lead_time,
      visitorLimits:   row.visitor_limits,
      regulations:     row.regulations,
    },

    climate: {
      avgTempLowC:      toNumber(row.avg_temp_low_c),
      avgTempHighC:     toNumber(row.avg_temp_high_c),
      rainfallMmAnnual: toNumber(row.rainfall_mm_annual),
      humidityPercent:  toNumber(row.humidity_percent),
      uvIndexPeak:      toNumber(row.uv_index_peak),
      bestMonths:       row.best_months  || [],
      avoidMonths:      row.avoid_months || [],
      climateNotes:     row.climate_notes,
    },

    packing: {
      essentials:          row.packing_essentials    || [],
      clothingTips:        row.clothing_tips,
      gearRecommendations: row.gear_recommendations  || [],
    },

    budget: {
      rangeUsd:       row.budget_range_usd,
      entranceFeeUsd: row.entrance_fee_usd,
      guideCostUsd:   row.guide_cost_usd,
      mealCostRange:  row.meal_cost_range,
    },

    connectivity: {
      cellCoverage:       row.cell_coverage,
      wifiAvailable:      toBoolean(row.wifi_available),
      electricityVoltage: row.electricity_voltage,
      plugTypes:          row.plug_types || [],
    },

    culture: {
      currencyTips:    row.currency_tips,
      tippingCulture:  row.tipping_culture,
      localEtiquette:  row.local_etiquette  || [],
      photographyRules:row.photography_rules,
    },

    updatedAt: row.updated_at,
  };
};

const serializeTipLink = (row) => ({
  id:         row.id,
  tipId:      row.tip_id,
  slug:       row.slug,
  headline:   row.slug,
  summary:    row.summary,
  body:       row.body,
  category:   row.category,
  tripPhase:  row.trip_phase,
  icon:       row.icon,
  imageUrl:   row.image_url,
  tags:       row.tags      || [],
  checklist:  row.checklist || [],
  isFeatured: toBoolean(row.is_featured),
  sortOrder:  toNumber(row.sort_order, 0),
});

/* ═══════════════════════════════════════════════════════════════
   QUERY BUILDING
   ═══════════════════════════════════════════════════════════════ */

const BASE_SELECT = `
  SELECT
    d.*,
    c.name       AS country_name,
    c.slug       AS country_slug,
    c.flag       AS country_flag,
    c.flag_url   AS country_flag_url,
    c.continent  AS country_continent,
    c.region     AS country_region
  FROM destinations d
  INNER JOIN countries c ON d.country_id = c.id AND c.is_active = true
`;

const buildFilters = async (filters) => {
  const conditions = ["d.is_active = true"];
  const params     = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`d.status = $${idx++}`);
    params.push(filters.status);
  } else if (!filters.includeUnpublished) {
    conditions.push(`d.status = 'published'`);
  }

  if (filters.country || filters.country_id || filters.countrySlug) {
    const country = await resolveCountry(
      filters.country || filters.country_id || filters.countrySlug
    );
    if (country) {
      conditions.push(`d.country_id = $${idx++}`);
      params.push(country.id);
    } else {
      conditions.push("1 = 0");
    }
  }

  if (filters.continent) {
    conditions.push(`c.continent ILIKE $${idx++}`);
    params.push(filters.continent);
  }

  if (filters.category) {
    conditions.push(`d.category = $${idx++}`);
    params.push(filters.category);
  }

  if (filters.difficulty) {
    conditions.push(`d.difficulty = $${idx++}`);
    params.push(filters.difficulty);
  }

  if (filters.minRating) {
    conditions.push(`d.rating >= $${idx++}`);
    params.push(parseFloat(filters.minRating));
  }

  if (filters.minDuration) {
    conditions.push(`d.duration_days >= $${idx++}`);
    params.push(parseInt(filters.minDuration));
  }

  if (filters.maxDuration) {
    conditions.push(`d.duration_days <= $${idx++}`);
    params.push(parseInt(filters.maxDuration));
  }

  const boolFlags = ["featured", "popular", "new", "eco_friendly", "family_friendly"];
  boolFlags.forEach((flag) => {
    const key = flag.replace("_", "");
    const val = filters[key] !== undefined ? filters[key] : filters[flag];
    if (val !== undefined) {
      conditions.push(`d.is_${flag} = $${idx++}`);
      params.push(toBoolean(val));
    }
  });

  if (filters.search || filters.q) {
    const term = filters.search || filters.q;
    conditions.push(`(
      d.name              ILIKE $${idx} OR
      d.description       ILIKE $${idx} OR
      d.short_description ILIKE $${idx} OR
      c.name              ILIKE $${idx}
    )`);
    params.push(`%${term}%`);
    idx++;
  }

  if (filters.tag) {
    conditions.push(`EXISTS (
      SELECT 1 FROM destination_tags dt
      WHERE dt.destination_id = d.id AND dt.tag_slug = $${idx++}
    )`);
    params.push(filters.tag.toLowerCase());
  }

  if (filters.bounds) {
    try {
      const [swLat, swLng, neLat, neLng] = filters.bounds.split(",").map(Number);
      if ([swLat, swLng, neLat, neLng].every(Number.isFinite)) {
        conditions.push(`d.latitude  BETWEEN $${idx} AND $${idx + 1}`);
        conditions.push(`d.longitude BETWEEN $${idx + 2} AND $${idx + 3}`);
        params.push(swLat, neLat, swLng, neLng);
        idx += 4;
      }
    } catch (_) {}
  }

  if (filters.exclude) {
    const ids = normalizeArray(filters.exclude).map((id) => parseInt(id));
    if (ids.length) {
      conditions.push(`d.id != ALL($${idx++})`);
      params.push(ids);
    }
  }

  return { where: `WHERE ${conditions.join(" AND ")}`, params, nextIdx: idx };
};

const buildSort = (sort) => {
  const map = {
    name:        "d.name ASC",
    "-name":     "d.name DESC",
    rating:      "d.rating DESC NULLS LAST",
    newest:      "d.published_at DESC NULLS LAST, d.created_at DESC",
    oldest:      "d.created_at ASC",
    popular:     "d.booking_count DESC, d.view_count DESC",
    featured:    "d.is_featured DESC, d.is_popular DESC, d.rating DESC NULLS LAST",
    views:       "d.view_count DESC",
    duration:    "d.duration_days ASC NULLS LAST",
    "-duration": "d.duration_days DESC NULLS LAST",
    random:      "RANDOM()",
  };
  return map[sort] || map.featured;
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC LIST ENDPOINTS
   ═══════════════════════════════════════════════════════════════ */

exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 12, sort = "featured", ...filters } = req.query;
    const { where, params, nextIdx } = await buildFilters(filters);
    const orderBy = buildSort(sort);

    const countRes = await query(
      `SELECT COUNT(*) FROM destinations d
       INNER JOIN countries c ON d.country_id = c.id AND c.is_active = true
       ${where}`,
      params
    );
    const total      = parseInt(countRes.rows[0].count);
    const pagination = paginate(total, page, limit);

    const result = await query(
      `${BASE_SELECT} ${where}
       ORDER BY ${orderBy}
       LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      [...params, pagination.limit, pagination.offset]
    );

    res.json({
      success: true,
      data:    result.rows.map((r) => serialize(r)),
      pagination,
    });
  } catch (err) {
    next(err);
  }
};

exports.getFeatured = async (req, res, next) => {
  try {
    const { limit = 8, country, continent } = req.query;
    let where  = "WHERE d.is_featured = true AND d.is_active = true AND d.status = 'published'";
    const params = [];
    let idx = 1;

    if (country) {
      const c = await resolveCountry(country);
      if (c) { where += ` AND d.country_id = $${idx++}`; params.push(c.id); }
    }
    if (continent) {
      where += ` AND c.continent ILIKE $${idx++}`;
      params.push(continent);
    }
    params.push(parseInt(limit));

    const result = await query(
      `${BASE_SELECT} ${where}
       ORDER BY d.featured_at DESC NULLS LAST, d.rating DESC NULLS LAST
       LIMIT $${idx}`,
      params
    );

    res.json({ success: true, data: result.rows.map((r) => serialize(r)), count: result.rows.length });
  } catch (err) {
    next(err);
  }
};

exports.getPopular = async (req, res, next) => {
  try {
    const { limit = 8, country } = req.query;
    let where  = "WHERE d.is_active = true AND d.status = 'published'";
    const params = [];
    let idx = 1;

    if (country) {
      const c = await resolveCountry(country);
      if (c) { where += ` AND d.country_id = $${idx++}`; params.push(c.id); }
    }
    params.push(parseInt(limit));

    const result = await query(
      `${BASE_SELECT} ${where}
       ORDER BY d.booking_count DESC, d.view_count DESC, d.rating DESC NULLS LAST
       LIMIT $${idx}`,
      params
    );

    res.json({ success: true, data: result.rows.map((r) => serialize(r)), count: result.rows.length });
  } catch (err) {
    next(err);
  }
};

exports.getNew = async (req, res, next) => {
  try {
    const { limit = 8, days = 30 } = req.query;
    const result = await query(
      `${BASE_SELECT}
       WHERE d.is_active = true AND d.status = 'published'
         AND (d.is_new = true OR d.published_at >= NOW() - INTERVAL '${parseInt(days)} days')
       ORDER BY d.published_at DESC NULLS LAST
       LIMIT $1`,
      [parseInt(limit)]
    );
    res.json({ success: true, data: result.rows.map((r) => serialize(r)), count: result.rows.length });
  } catch (err) {
    next(err);
  }
};

exports.getByCountry = async (req, res, next) => {
  try {
    const { countrySlug }                                       = req.params;
    const { page = 1, limit = 12, sort = "featured", category } = req.query;

    const country = await resolveCountry(countrySlug);
    if (!country) {
      return res.status(404).json({ success: false, error: "Country not found" });
    }

    let where  = "WHERE d.country_id = $1 AND d.is_active = true AND d.status = 'published'";
    const params = [country.id];
    let idx = 2;

    if (category) { where += ` AND d.category = $${idx++}`; params.push(category); }

    const countRes = await query(
      `SELECT COUNT(*) FROM destinations d ${where}`, params
    );
    const total      = parseInt(countRes.rows[0].count);
    const pagination = paginate(total, page, limit);

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `${BASE_SELECT} ${where}
       ORDER BY ${buildSort(sort)}
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({
      success: true,
      data:    result.rows.map((r) => serialize(r)),
      pagination,
      country: {
        id:               country.id,
        slug:             country.slug,
        name:             country.name,
        flag:             country.flag,
        continent:        country.continent,
        destinationCount: total,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getCategories = async (req, res, next) => {
  try {
    const { country } = req.query;
    let where  = "WHERE d.is_active = true AND d.status = 'published' AND d.category IS NOT NULL";
    const params = [];

    if (country) {
      const c = await resolveCountry(country);
      if (c) { where += " AND d.country_id = $1"; params.push(c.id); }
    }

    const result = await query(
      `SELECT d.category,
              COUNT(*)                                   AS count,
              AVG(d.rating) FILTER (WHERE d.rating > 0) AS avg_rating
       FROM destinations d ${where}
       GROUP BY d.category ORDER BY count DESC`,
      params
    );

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        name:        r.category,
        slug:        slugify(r.category),
        displayName: r.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        count:       parseInt(r.count),
        avgRating:   toNumber(r.avg_rating),
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.getDifficulties = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT difficulty, COUNT(*) AS count
      FROM destinations
      WHERE is_active = true AND status = 'published' AND difficulty IS NOT NULL
      GROUP BY difficulty
      ORDER BY CASE difficulty
        WHEN 'easy'        THEN 1 WHEN 'moderate'   THEN 2
        WHEN 'challenging' THEN 3 WHEN 'difficult'  THEN 4
        WHEN 'expert'      THEN 5 END
    `);
    res.json({
      success: true,
      data: result.rows.map((r) => ({
        level:       r.difficulty,
        displayName: r.difficulty.charAt(0).toUpperCase() + r.difficulty.slice(1),
        count:       parseInt(r.count),
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.getMapData = async (req, res, next) => {
  try {
    const { country, category, bounds, limit = 500 } = req.query;
    let where  = `WHERE d.is_active = true AND d.status = 'published'
                   AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL`;
    const params = [];
    let idx = 1;

    if (country) {
      const c = await resolveCountry(country);
      if (c) { where += ` AND d.country_id = $${idx++}`; params.push(c.id); }
    }
    if (category) { where += ` AND d.category = $${idx++}`; params.push(category); }
    if (bounds) {
      try {
        const [swLat, swLng, neLat, neLng] = bounds.split(",").map(Number);
        if ([swLat, swLng, neLat, neLng].every(Number.isFinite)) {
          where += ` AND d.latitude  BETWEEN $${idx} AND $${idx + 1}`;
          where += ` AND d.longitude BETWEEN $${idx + 2} AND $${idx + 3}`;
          params.push(swLat, neLat, swLng, neLng);
          idx += 4;
        }
      } catch (_) {}
    }
    params.push(parseInt(limit));

    const result = await query(
      `SELECT d.id, d.name, d.slug, d.latitude, d.longitude,
              d.category, d.difficulty, d.image_url, d.short_description,
              d.rating, d.review_count, d.is_featured, d.is_popular,
              c.name AS country_name, c.slug AS country_slug, c.flag AS country_flag
       FROM destinations d
       INNER JOIN countries c ON d.country_id = c.id
       ${where}
       ORDER BY d.is_featured DESC, d.rating DESC NULLS LAST
       LIMIT $${idx}`,
      params
    );

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        id:               r.id,
        name:             r.name,
        slug:             r.slug,
        position:         { lat: toNumber(r.latitude), lng: toNumber(r.longitude) },
        category:         r.category,
        difficulty:       r.difficulty,
        imageUrl:         r.image_url,
        shortDescription: r.short_description,
        rating:           toNumber(r.rating),
        reviewCount:      toNumber(r.review_count),
        isFeatured:       toBoolean(r.is_featured),
        isPopular:        toBoolean(r.is_popular),
        country: { name: r.country_name, slug: r.country_slug, flag: r.country_flag },
      })),
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
};

exports.search = async (req, res, next) => {
  try {
    const { q, page = 1, limit = 12 } = req.query;
    if (!q || q.length < 2) {
      return res.json({ success: true, data: [], pagination: paginate(0, page, limit) });
    }

    const { where, params, nextIdx } = await buildFilters({ search: q });

    const countRes = await query(
      `SELECT COUNT(*) FROM destinations d
       INNER JOIN countries c ON d.country_id = c.id AND c.is_active = true
       ${where}`,
      params
    );
    const total      = parseInt(countRes.rows[0].count);
    const pagination = paginate(total, page, limit);

    const result = await query(
      `${BASE_SELECT} ${where}
       ORDER BY CASE WHEN d.name ILIKE $${nextIdx + 2} THEN 0 ELSE 1 END,
                d.rating DESC NULLS LAST
       LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      [...params, pagination.limit, pagination.offset, `${q}%`]
    );

    res.json({ success: true, data: result.rows.map((r) => serialize(r)), pagination, query: q });
  } catch (err) {
    next(err);
  }
};

exports.getSuggestions = async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, data: [] });

    const result = await query(
      `SELECT d.id, d.name, d.slug, d.category, d.image_url, d.rating,
              c.name AS country_name, c.slug AS country_slug, c.flag AS country_flag
       FROM destinations d
       INNER JOIN countries c ON d.country_id = c.id
       WHERE d.is_active = true AND d.status = 'published'
         AND (d.name ILIKE $1 OR c.name ILIKE $1)
       ORDER BY CASE WHEN d.name ILIKE $2 THEN 0 ELSE 1 END,
                d.is_featured DESC, d.rating DESC NULLS LAST
       LIMIT $3`,
      [`%${q}%`, `${q}%`, parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        id:       r.id,
        name:     r.name,
        slug:     r.slug,
        category: r.category,
        imageUrl: r.image_url,
        rating:   toNumber(r.rating),
        country: { name: r.country_name, slug: r.country_slug, flag: r.country_flag },
        type:     "destination",
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.getTags = async (req, res, next) => {
  try {
    const { limit = 50 } = req.query;
    const result = await query(
      `SELECT dt.tag_name, dt.tag_slug, dt.tag_category,
              COUNT(DISTINCT dt.destination_id) AS count
       FROM destination_tags dt
       INNER JOIN destinations d ON dt.destination_id = d.id
       WHERE d.is_active = true AND d.status = 'published'
       GROUP BY dt.tag_name, dt.tag_slug, dt.tag_category
       ORDER BY count DESC
       LIMIT $1`,
      [parseInt(limit)]
    ).catch(() => ({ rows: [] }));   // safe if table missing

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        name:     r.tag_name,
        slug:     r.tag_slug,
        category: r.tag_category,
        count:    parseInt(r.count),
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.getStats = async (req, res, next) => {
  try {
    const stats = await query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE status = 'published')         AS published,
        COUNT(*) FILTER (WHERE is_featured)                  AS featured,
        COUNT(*) FILTER (WHERE is_popular)                   AS popular,
        COUNT(DISTINCT country_id)                           AS countries,
        AVG(rating) FILTER (WHERE rating > 0)                AS avg_rating,
        SUM(view_count)                                      AS total_views,
        SUM(review_count)                                    AS total_reviews
      FROM destinations WHERE is_active = true
    `);

    const byCategory = await query(`
      SELECT category, COUNT(*) AS count
      FROM destinations
      WHERE is_active = true AND status = 'published' AND category IS NOT NULL
      GROUP BY category ORDER BY count DESC
    `);

    const byCountry = await query(`
      SELECT c.name, c.slug, c.flag, COUNT(d.id) AS count
      FROM destinations d
      INNER JOIN countries c ON d.country_id = c.id
      WHERE d.is_active = true AND d.status = 'published'
      GROUP BY c.id ORDER BY count DESC LIMIT 10
    `);

    res.json({
      success: true,
      data: {
        overview: {
          total:        parseInt(stats.rows[0].total)        || 0,
          published:    parseInt(stats.rows[0].published)    || 0,
          featured:     parseInt(stats.rows[0].featured)     || 0,
          popular:      parseInt(stats.rows[0].popular)      || 0,
          countries:    parseInt(stats.rows[0].countries)    || 0,
          avgRating:    toNumber(stats.rows[0].avg_rating),
          totalViews:   parseInt(stats.rows[0].total_views)  || 0,
          totalReviews: parseInt(stats.rows[0].total_reviews)|| 0,
        },
        byCategory: byCategory.rows.map((r) => ({
          category: r.category, count: parseInt(r.count),
        })),
        byCountry: byCountry.rows.map((r) => ({
          name: r.name, slug: r.slug, flag: r.flag, count: parseInt(r.count),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════
   SINGLE DESTINATION — getOne with fault-tolerant parallel tasks
   ═══════════════════════════════════════════════════════════════ */

exports.getOne = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const { include }  = req.query;

    const isNum = /^\d+$/.test(idOrSlug);
    const col   = isNum ? "d.id"   : "d.slug";
    const val   = isNum ? parseInt(idOrSlug) : idOrSlug.toLowerCase();

    const result = await query(
      `${BASE_SELECT} WHERE ${col} = $1 AND d.is_active = true`, [val]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    const row    = result.rows[0];
    const destId = row.id;

    // Async view increment — non-blocking
    query(
      "UPDATE destinations SET view_count = view_count + 1 WHERE id = $1", [destId]
    ).catch(() => {});

    const dest     = serialize(row);
    const includes = include ? include.split(",").map((s) => s.trim().toLowerCase()) : [];
    const all      = includes.includes("all");

    const tasks = [];

    // ── 1. Gallery ────────────────────────────────────────────
    if (all || includes.includes("gallery") || includes.includes("images")) {
      tasks.push(safeTask("gallery", async () => {
        const r = await query(
          `SELECT * FROM destination_images
           WHERE destination_id = $1 AND is_active = true
           ORDER BY is_primary DESC, sort_order ASC`,
          [destId]
        );
        dest.gallery = r.rows.map((img) => ({
          id:           img.id,
          imageUrl:     img.image_url,
          thumbnailUrl: img.thumbnail_url,
          caption:      img.caption,
          altText:      img.alt_text,
          isPrimary:    toBoolean(img.is_primary),
          sortOrder:    img.sort_order,
        }));
      }));
    }

    // ── 2. Itinerary ──────────────────────────────────────────
    if (all || includes.includes("itinerary")) {
      tasks.push(safeTask("itinerary", async () => {
        const r = await query(
          `SELECT * FROM destination_itineraries
           WHERE destination_id = $1 AND is_active = true
           ORDER BY day_number ASC`,
          [destId]
        );
        dest.itinerary = r.rows.map((it) => ({
          id:            it.id,
          dayNumber:     it.day_number,
          title:         it.title,
          description:   it.description,
          activities:    it.activities || [],
          highlights:    it.highlights || [],
          meals:         it.meals      || [],
          accommodation: it.accommodation,
          distanceKm:    toNumber(it.distance_km),
          imageUrl:      it.image_url,
        }));
      }));
    }

    // ── 3. FAQs ───────────────────────────────────────────────
    if (all || includes.includes("faqs")) {
      tasks.push(safeTask("faqs", async () => {
        const r = await query(
          `SELECT * FROM destination_faqs
           WHERE destination_id = $1 AND is_active = true
           ORDER BY sort_order ASC`,
          [destId]
        );
        dest.faqs = r.rows.map((f) => ({
          id:           f.id,
          question:     f.question,
          answer:       f.answer,
          category:     f.category,
          helpfulCount: toNumber(f.helpful_count, 0),
        }));
      }));
    }

    // ── 4. Reviews + Aggregate ────────────────────────────────
    if (all || includes.includes("reviews")) {
      tasks.push(safeTask("reviews", async () => {
        const r = await query(
          `SELECT * FROM destination_reviews
           WHERE destination_id = $1 AND status = 'approved'
           ORDER BY is_featured DESC, created_at DESC
           LIMIT 10`,
          [destId]
        );
        dest.reviews = r.rows.map(serializeReview);

        const agg = await query(
          `SELECT
             AVG(overall_rating)                                   AS avg_rating,
             COUNT(*)                                              AS total_reviews,
             COUNT(*) FILTER (WHERE overall_rating >= 4.5)        AS five_star,
             COUNT(*) FILTER (WHERE overall_rating >= 3.5
                                AND overall_rating  < 4.5)        AS four_star,
             COUNT(*) FILTER (WHERE overall_rating >= 2.5
                                AND overall_rating  < 3.5)        AS three_star,
             COUNT(*) FILTER (WHERE overall_rating >= 1.5
                                AND overall_rating  < 2.5)        AS two_star,
             COUNT(*) FILTER (WHERE overall_rating  < 1.5)        AS one_star
           FROM destination_reviews
           WHERE destination_id = $1 AND status = 'approved'`,
          [destId]
        );
        const a = agg.rows[0] || {};
        dest.aggregate = {
          avgRating:    toNumber(a.avg_rating, 0),
          totalReviews: parseInt(a.total_reviews) || 0,
          distribution: {
            fiveStar:  parseInt(a.five_star)  || 0,
            fourStar:  parseInt(a.four_star)  || 0,
            threeStar: parseInt(a.three_star) || 0,
            twoStar:   parseInt(a.two_star)   || 0,
            oneStar:   parseInt(a.one_star)   || 0,
          },
        };
      }));
    }

    // ── 5. Tags ───────────────────────────────────────────────
    if (all || includes.includes("tags")) {
      tasks.push(safeTask("tags", async () => {
        const r = await query(
          `SELECT * FROM destination_tags
           WHERE destination_id = $1 ORDER BY tag_name ASC`,
          [destId]
        );
        dest.tags = r.rows.map((t) => ({
          name: t.tag_name, slug: t.tag_slug, category: t.tag_category,
        }));
      }));
    }

    // ── 6. Practical Info ─────────────────────────────────────
    if (all || includes.includes("practical") || includes.includes("practical_info")) {
      tasks.push(safeTask("practical_info", async () => {
        const r = await query(
          `SELECT * FROM destination_practical_info WHERE destination_id = $1`,
          [destId]
        );
        dest.practicalInfo = serializePracticalInfo(r.rows[0] || null);
      }));
    }

    // ── 7. How To Get There ───────────────────────────────────
    if (all || includes.includes("how_to_get_there") || includes.includes("getting_there")) {
      tasks.push(safeTask("how_to_get_there", async () => {
        const r = await query(
          `SELECT
             dpi.nearest_airport,
             dpi.distance_from_airport,
             dpi.drive_time_from_capital,
             dpi.road_conditions,
             dpi.transport_options,
             dpi.border_crossings,
             d.nearest_airport          AS dest_nearest_airport,
             d.nearest_city             AS dest_nearest_city,
             d.distance_from_airport_km,
             d.getting_there            AS dest_getting_there,
             d.latitude,
             d.longitude,
             d.address,
             c.capital                  AS country_capital,
             c.name                     AS country_name,
             c.calling_code
           FROM destinations d
           INNER JOIN countries c ON d.country_id = c.id
           LEFT JOIN destination_practical_info dpi ON dpi.destination_id = d.id
           WHERE d.id = $1`,
          [destId]
        );
        const r2 = r.rows[0] || {};
        dest.howToGetThere = {
          nearestAirport:       r2.nearest_airport       || r2.dest_nearest_airport || null,
          nearestCity:          r2.dest_nearest_city      || null,
          distanceFromAirport:  r2.distance_from_airport  ||
                                (r2.distance_from_airport_km
                                  ? `${r2.distance_from_airport_km} km`
                                  : null),
          driveTimeFromCapital: r2.drive_time_from_capital || null,
          countryCapital:       r2.country_capital         || null,
          roadConditions:       r2.road_conditions         || null,
          transportOptions:     r2.transport_options       || [],
          borderCrossings:      r2.border_crossings        || null,
          generalInfo:          r2.dest_getting_there      || null,
          mapPosition: {
            lat: toNumber(r2.latitude),
            lng: toNumber(r2.longitude),
          },
          address:     r2.address      || null,
          countryName: r2.country_name || null,
          callingCode: r2.calling_code || null,
        };
      }));
    }

    // ── 8. Linked Tips ────────────────────────────────────────
    if (all || includes.includes("tips")) {
      tasks.push(safeTask("tips", async () => {
        const r = await query(
          `SELECT
             dt_link.id, dt_link.tip_id, dt_link.sort_order, dt_link.is_featured,
             t.slug, t.summary, t.body, t.category, t.trip_phase,
             t.icon, t.image_url, t.tags, t.checklist, t.is_active
           FROM destination_tips dt_link
           INNER JOIN tips t ON t.id = dt_link.tip_id AND t.is_active = true
           WHERE dt_link.destination_id = $1
           ORDER BY dt_link.is_featured DESC, dt_link.sort_order ASC`,
          [destId]
        );
        dest.tips = r.rows.map(serializeTipLink);
      }));
    }

    // ── 9. Related Destinations ───────────────────────────────
    if (all || includes.includes("related")) {
      tasks.push(safeTask("related", async () => {
        const r = await query(
          `${BASE_SELECT}
           WHERE d.id != $1 AND d.is_active = true AND d.status = 'published'
             AND (d.country_id = $2 OR d.category = $3)
           ORDER BY
             CASE WHEN d.country_id = $2 AND d.category = $3 THEN 0
                  WHEN d.category   = $3                      THEN 1
                  WHEN d.country_id = $2                      THEN 2
                  ELSE 3 END,
             d.rating DESC NULLS LAST
           LIMIT 6`,
          [destId, row.country_id, row.category]
        );
        dest.related = r.rows.map((rr) => serialize(rr));
      }));
    }

    // ── Run all tasks in parallel ─────────────────────────────
    await Promise.all(tasks);

    // Fallback gallery from images array when no DB gallery rows
    if (!dest.gallery?.length && dest.images?.length) {
      dest.gallery = dest.images.map((url, i) => ({
        id:        `img-${i}`,
        imageUrl:  url,
        isPrimary: i === 0,
      }));
    }

    res.json({ success: true, data: dest });
  } catch (err) {
    next(err);
  }
};

exports.getRelated = async (req, res, next) => {
  try {
    const { idOrSlug }  = req.params;
    const { limit = 6 } = req.query;

    const isNum = /^\d+$/.test(idOrSlug);
    const col   = isNum ? "id" : "slug";
    const val   = isNum ? parseInt(idOrSlug) : idOrSlug.toLowerCase();

    const source = await query(
      `SELECT id, country_id, category FROM destinations WHERE ${col} = $1`, [val]
    );
    if (!source.rows.length) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    const { id, country_id, category } = source.rows[0];
    const result = await query(
      `${BASE_SELECT}
       WHERE d.id != $1 AND d.is_active = true AND d.status = 'published'
         AND (d.country_id = $2 OR d.category = $3)
       ORDER BY
         CASE WHEN d.country_id = $2 AND d.category = $3 THEN 0
              WHEN d.category   = $3                      THEN 1
              WHEN d.country_id = $2                      THEN 2
              ELSE 3 END,
         d.rating DESC NULLS LAST
       LIMIT $4`,
      [id, country_id, category, parseInt(limit)]
    );

    res.json({ success: true, data: result.rows.map((r) => serialize(r)) });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════
    ITINERARY CRUD
    ═══════════════════════════════════════════════════════════════ */

exports.addItineraryDay = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { day_number, title, description, activities, highlights, meals,
            accommodation, distance_km, image_url } = req.body;

    if (!day_number || !title) {
      return res.status(400).json({ success: false, error: "day_number and title are required" });
    }

    const max = await query(
      `SELECT COALESCE(MAX(day_number), 0) AS max FROM destination_itineraries WHERE destination_id = $1`,
      [id]
    ).catch(() => ({ rows: [{ max: 0 }] }));

    const dayNum = parseInt(day_number) || max.rows[0].max + 1;

    const result = await query(
      `INSERT INTO destination_itineraries (
        destination_id, day_number, title, description, activities, highlights, meals,
        accommodation, distance_km, image_url
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, dayNum, title, description || null, normalizeArray(activities), normalizeArray(highlights),
       normalizeArray(meals), accommodation || null, toNumber(distance_km), image_url || null]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateItineraryDay = async (req, res, next) => {
  try {
    const { id, dayId } = req.params;
    const fields = { ...req.body };
    const keys = Object.keys(fields);
    if (!keys.length) {
      return res.status(400).json({ success: false, error: "No fields to update" });
    }

    ["activities", "highlights", "meals"].forEach((f) => {
      if (fields[f]) fields[f] = normalizeArray(fields[f]);
    });

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const vals = [...keys.map((k) => fields[k]), dayId, id];

    const result = await query(
      `UPDATE destination_itineraries SET ${sets}
       WHERE id = $${vals.length - 1} AND destination_id = $${vals.length}
       RETURNING *`,
      vals
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Itinerary day not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.removeItineraryDay = async (req, res, next) => {
  try {
    const { id, dayId } = req.params;
    const result = await query(
      `DELETE FROM destination_itineraries
       WHERE id = $1 AND destination_id = $2 RETURNING id`,
      [dayId, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Itinerary day not found" });
    }
    res.json({ success: true, message: "Itinerary day deleted" });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════
    PRACTICAL INFO CRUD
    ═══════════════════════════════════════════════════════════════ */

exports.getPracticalInfo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM destination_practical_info WHERE destination_id = $1`, [id]
    ).catch(() => ({ rows: [] }));
    res.json({ success: true, data: serializePracticalInfo(result.rows[0] || null) });
  } catch (err) {
    next(err);
  }
};

exports.upsertPracticalInfo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const b = req.body;

    const dest = await query(
      "SELECT id FROM destinations WHERE id = $1 AND is_active = true", [id]
    );
    if (!dest.rows.length) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    const result = await query(
      `INSERT INTO destination_practical_info (
        destination_id,
        nearest_airport, distance_from_airport, drive_time_from_capital,
        road_conditions, transport_options, border_crossings,
        vaccinations_required, vaccinations_recommended, malaria_risk,
        water_safety, medical_facilities, emergency_contacts,
        safety_rating, safety_notes,
        permits_required, permit_cost, booking_lead_time, visitor_limits, regulations,
        avg_temp_low_c, avg_temp_high_c, rainfall_mm_annual, humidity_percent,
        uv_index_peak, best_months, avoid_months, climate_notes,
        packing_essentials, clothing_tips, gear_recommendations,
        budget_range_usd, entrance_fee_usd, guide_cost_usd, meal_cost_range,
        cell_coverage, wifi_available, electricity_voltage, plug_types,
        currency_tips, tipping_culture, local_etiquette, photography_rules,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
        $39,$40,$41,$42,$43, NOW()
      )
      ON CONFLICT (destination_id) DO UPDATE SET
        nearest_airport          = EXCLUDED.nearest_airport,
        distance_from_airport    = EXCLUDED.distance_from_airport,
        drive_time_from_capital  = EXCLUDED.drive_time_from_capital,
        road_conditions          = EXCLUDED.road_conditions,
        transport_options        = EXCLUDED.transport_options,
        border_crossings         = EXCLUDED.border_crossings,
        vaccinations_required    = EXCLUDED.vaccinations_required,
        vaccinations_recommended = EXCLUDED.vaccinations_recommended,
        malaria_risk             = EXCLUDED.malaria_risk,
        water_safety             = EXCLUDED.water_safety,
        medical_facilities       = EXCLUDED.medical_facilities,
        emergency_contacts       = EXCLUDED.emergency_contacts,
        safety_rating            = EXCLUDED.safety_rating,
        safety_notes             = EXCLUDED.safety_notes,
        permits_required         = EXCLUDED.permits_required,
        permit_cost              = EXCLUDED.permit_cost,
        booking_lead_time        = EXCLUDED.booking_lead_time,
        visitor_limits           = EXCLUDED.visitor_limits,
        regulations              = EXCLUDED.regulations,
        avg_temp_low_c           = EXCLUDED.avg_temp_low_c,
        avg_temp_high_c          = EXCLUDED.avg_temp_high_c,
        rainfall_mm_annual       = EXCLUDED.rainfall_mm_annual,
        humidity_percent         = EXCLUDED.humidity_percent,
        uv_index_peak            = EXCLUDED.uv_index_peak,
        best_months              = EXCLUDED.best_months,
        avoid_months             = EXCLUDED.avoid_months,
        climate_notes            = EXCLUDED.climate_notes,
        packing_essentials       = EXCLUDED.packing_essentials,
        clothing_tips            = EXCLUDED.clothing_tips,
        gear_recommendations     = EXCLUDED.gear_recommendations,
        budget_range_usd         = EXCLUDED.budget_range_usd,
        entrance_fee_usd         = EXCLUDED.entrance_fee_usd,
        guide_cost_usd           = EXCLUDED.guide_cost_usd,
        meal_cost_range          = EXCLUDED.meal_cost_range,
        cell_coverage            = EXCLUDED.cell_coverage,
        wifi_available           = EXCLUDED.wifi_available,
        electricity_voltage      = EXCLUDED.electricity_voltage,
        plug_types               = EXCLUDED.plug_types,
        currency_tips            = EXCLUDED.currency_tips,
        tipping_culture          = EXCLUDED.tipping_culture,
        local_etiquette          = EXCLUDED.local_etiquette,
        photography_rules        = EXCLUDED.photography_rules,
        updated_at               = NOW()
      RETURNING *`,
      [
        id,
        b.nearest_airport         || null,
        b.distance_from_airport   || null,
        b.drive_time_from_capital || null,
        b.road_conditions         || null,
        normalizeArray(b.transport_options),
        b.border_crossings        || null,
        normalizeArray(b.vaccinations_required),
        normalizeArray(b.vaccinations_recommended),
        b.malaria_risk            || null,
        b.water_safety            || null,
        b.medical_facilities      || null,
        b.emergency_contacts ? JSON.stringify(b.emergency_contacts) : "{}",
        b.safety_rating           || null,
        b.safety_notes            || null,
        normalizeArray(b.permits_required),
        b.permit_cost             || null,
        b.booking_lead_time       || null,
        b.visitor_limits          || null,
        b.regulations             || null,
        toNumber(b.avg_temp_low_c),
        toNumber(b.avg_temp_high_c),
        toNumber(b.rainfall_mm_annual),
        toNumber(b.humidity_percent),
        toNumber(b.uv_index_peak),
        normalizeArray(b.best_months),
        normalizeArray(b.avoid_months),
        b.climate_notes           || null,
        normalizeArray(b.packing_essentials),
        b.clothing_tips           || null,
        normalizeArray(b.gear_recommendations),
        b.budget_range_usd        || null,
        b.entrance_fee_usd        || null,
        b.guide_cost_usd          || null,
        b.meal_cost_range         || null,
        b.cell_coverage           || null,
        toBoolean(b.wifi_available),
        b.electricity_voltage     || null,
        normalizeArray(b.plug_types),
        b.currency_tips           || null,
        b.tipping_culture         || null,
        normalizeArray(b.local_etiquette),
        b.photography_rules       || null,
      ]
    );

    res.json({ success: true, message: "Practical info saved", data: serializePracticalInfo(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════
   TIPS LINKING
   ═══════════════════════════════════════════════════════════════ */

exports.getDestinationTipsLinked = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT
         dt_link.id, dt_link.tip_id, dt_link.sort_order, dt_link.is_featured,
         t.slug, t.summary, t.body, t.category, t.trip_phase,
         t.icon, t.image_url, t.tags, t.checklist, t.is_active
       FROM destination_tips dt_link
       INNER JOIN tips t ON t.id = dt_link.tip_id AND t.is_active = true
       WHERE dt_link.destination_id = $1
       ORDER BY dt_link.is_featured DESC, dt_link.sort_order ASC`,
      [id]
    ).catch(() => ({ rows: [] }));

    res.json({ success: true, data: result.rows.map(serializeTipLink), count: result.rows.length });
  } catch (err) {
    next(err);
  }
};

exports.linkTip = async (req, res, next) => {
  try {
    const { id }                              = req.params;
    const { tip_id, sort_order = 0, is_featured = false } = req.body;

    if (!tip_id) {
      return res.status(400).json({ success: false, error: "tip_id is required" });
    }

    const tipCheck = await query(
      "SELECT id FROM tips WHERE id = $1 AND is_active = true", [tip_id]
    );
    if (!tipCheck.rows.length) {
      return res.status(404).json({ success: false, error: "Tip not found or inactive" });
    }

    const result = await query(
      `INSERT INTO destination_tips (destination_id, tip_id, sort_order, is_featured)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (destination_id, tip_id) DO UPDATE SET
         sort_order  = EXCLUDED.sort_order,
         is_featured = EXCLUDED.is_featured
       RETURNING *`,
      [id, tip_id, toNumber(sort_order, 0), toBoolean(is_featured)]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.unlinkTip = async (req, res, next) => {
  try {
    const { id, tipId } = req.params;
    const result = await query(
      `DELETE FROM destination_tips
       WHERE destination_id = $1 AND tip_id = $2 RETURNING id`,
      [id, tipId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Tip link not found" });
    }
    res.json({ success: true, message: "Tip unlinked from destination" });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════
   ENGAGEMENT
   ═══════════════════════════════════════════════════════════════ */

exports.incrementView = async (req, res, next) => {
  try {
    await query(
      "UPDATE destinations SET view_count = view_count + 1 WHERE id = $1", [req.params.id]
    );
    res.json({ success: true, message: "View recorded" });
  } catch (err) {
    next(err);
  }
};

exports.incrementWishlist = async (req, res, next) => {
  try {
    const { id }             = req.params;
    const { action = "add" } = req.body;
    const inc                = action === "remove" ? -1 : 1;

    const result = await query(
      `UPDATE destinations
       SET wishlist_count = GREATEST(0, wishlist_count + $2)
       WHERE id = $1 RETURNING wishlist_count`,
      [id, inc]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }
    res.json({ success: true, wishlistCount: parseInt(result.rows[0].wishlist_count) });
  } catch (err) {
    next(err);
  }
};

exports.incrementShare = async (req, res, next) => {
  try {
    await query(
      "UPDATE destinations SET share_count = COALESCE(share_count,0) + 1 WHERE id = $1",
      [req.params.id]
    ).catch(() => {});
    res.json({ success: true, message: "Share recorded" });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════
   REVIEWS
   ═══════════════════════════════════════════════════════════════ */

exports.getReviews = async (req, res, next) => {
  try {
    const { id }                              = req.params;
    const { page = 1, limit = 10, sort = "-created" } = req.query;

    const countRes = await query(
      `SELECT COUNT(*) FROM destination_reviews
       WHERE destination_id = $1 AND status = 'approved'`, [id]
    ).catch(() => ({ rows: [{ count: "0" }] }));

    const total      = parseInt(countRes.rows[0].count);
    const pagination = paginate(total, page, limit);

    const sortMap = {
      "created":  "created_at ASC",
      "-created": "created_at DESC",
      "rating":   "overall_rating DESC",
      "helpful":  "helpful_count DESC",
    };

    const result = await query(
      `SELECT * FROM destination_reviews
       WHERE destination_id = $1 AND status = 'approved'
       ORDER BY is_featured DESC, ${sortMap[sort] || sortMap["-created"]}
       LIMIT $2 OFFSET $3`,
      [id, pagination.limit, pagination.offset]
    ).catch(() => ({ rows: [] }));

    const aggRes = await query(
      `SELECT
         AVG(overall_rating)                                   AS avg_rating,
         COUNT(*)                                              AS total_reviews,
         COUNT(*) FILTER (WHERE overall_rating >= 4.5)        AS five_star,
         COUNT(*) FILTER (WHERE overall_rating >= 3.5
                            AND overall_rating  < 4.5)        AS four_star,
         COUNT(*) FILTER (WHERE overall_rating >= 2.5
                            AND overall_rating  < 3.5)        AS three_star,
         COUNT(*) FILTER (WHERE overall_rating >= 1.5
                            AND overall_rating  < 2.5)        AS two_star,
         COUNT(*) FILTER (WHERE overall_rating  < 1.5)        AS one_star
       FROM destination_reviews
       WHERE destination_id = $1 AND status = 'approved'`,
      [id]
    ).catch(() => ({ rows: [{}] }));

    const agg = aggRes.rows[0] || {};

    res.json({
      success: true,
      data:    result.rows.map(serializeReview),
      pagination,
      aggregate: {
        avgRating:    toNumber(agg.avg_rating, 0),
        totalReviews: parseInt(agg.total_reviews) || 0,
        distribution: {
          fiveStar:  parseInt(agg.five_star)  || 0,
          fourStar:  parseInt(agg.four_star)  || 0,
          threeStar: parseInt(agg.three_star) || 0,
          twoStar:   parseInt(agg.two_star)   || 0,
          oneStar:   parseInt(agg.one_star)   || 0,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.addReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reviewer_name, reviewer_country, title, content, overall_rating, trip_date, trip_type } = req.body;

    if (!content || !overall_rating) {
      return res.status(400).json({ success: false, error: "Content and rating are required" });
    }

    const rating = parseFloat(overall_rating);
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: "Rating must be between 1 and 5" });
    }

    const dest = await query(
      "SELECT id FROM destinations WHERE id = $1 AND is_active = true", [id]
    );
    if (!dest.rows.length) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    const images = req.files
      ? req.files.map((f) => getUploadedFileUrl(f))
      : normalizeArray(req.body.images);

    const result = await query(
      `INSERT INTO destination_reviews
       (destination_id, user_id, reviewer_name, reviewer_country, title,
        content, overall_rating, trip_date, trip_type, images, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
       RETURNING *`,
      [
        id,
        req.user?.id      || null,
        reviewer_name     || "Anonymous",
        reviewer_country  || null,
        title             || null,
        content,
        rating,
        trip_date         || null,
        trip_type         || null,
        images,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Review submitted. It will be visible after moderation.",
      data:    serializeReview(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
};

exports.markReviewHelpful = async (req, res, next) => {
  try {
    const { reviewId } = req.params;
    const result = await query(
      `UPDATE destination_reviews
       SET helpful_count = helpful_count + 1
       WHERE id = $1 RETURNING helpful_count`,
      [reviewId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Review not found" });
    }
    res.json({ success: true, helpfulCount: parseInt(result.rows[0].helpful_count) });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════
   IMAGES
   ═══════════════════════════════════════════════════════════════ */

exports.getImages = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM destination_images
       WHERE destination_id = $1 AND is_active = true
       ORDER BY is_primary DESC, sort_order ASC`,
      [id]
    ).catch(() => ({ rows: [] }));

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        id:           r.id,
        imageUrl:     r.image_url,
        thumbnailUrl: r.thumbnail_url,
        caption:      r.caption,
        altText:      r.alt_text,
        isPrimary:    toBoolean(r.is_primary),
        sortOrder:    r.sort_order,
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.addImages = async (req, res, next) => {
  try {
    const { id } = req.params;

    const dest = await query("SELECT id FROM destinations WHERE id = $1", [id]);
    if (!dest.rows.length) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }
    if (!req.files?.length && !req.body.image_urls) {
      return res.status(400).json({ success: false, error: "No images provided" });
    }

    const maxOrder = await query(
      `SELECT COALESCE(MAX(sort_order), 0) AS max
       FROM destination_images WHERE destination_id = $1`, [id]
    ).catch(() => ({ rows: [{ max: 0 }] }));

    let order     = maxOrder.rows[0].max;
    const images  = [];
    const urls    = [];

    if (req.files?.length) {
      for (const file of req.files) {
        order++;
        const url    = getUploadedFileUrl(file);
        const result = await query(
          `INSERT INTO destination_images
           (destination_id, image_url, sort_order, caption, uploaded_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [id, url, order, req.body.caption || null, req.user?.id || null]
        );
        images.push(result.rows[0]);
        urls.push(url);
      }
    }

    if (req.body.image_urls) {
      for (const url of normalizeArray(req.body.image_urls)) {
        order++;
        const result = await query(
          `INSERT INTO destination_images
           (destination_id, image_url, sort_order, caption, uploaded_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [id, url, order, req.body.caption || null, req.user?.id || null]
        );
        images.push(result.rows[0]);
        urls.push(url);
      }
    }

    await query(
      `UPDATE destinations
       SET image_urls = COALESCE(image_urls, '{}'::TEXT[]) || $2::TEXT[],
           image_url  = COALESCE(image_url, $3),
           updated_at = NOW()
       WHERE id = $1`,
      [id, urls, urls[0]]
    );

    res.status(201).json({ success: true, message: `${images.length} image(s) added`, data: images });
  } catch (err) {
    next(err);
  }
};

exports.updateImage = async (req, res, next) => {
  try {
    const { id, imageId }                                    = req.params;
    const { caption, alt_text, is_primary, sort_order }     = req.body;

    if (toBoolean(is_primary)) {
      await query(
        `UPDATE destination_images SET is_primary = false
         WHERE destination_id = $1 AND id != $2`, [id, imageId]
      );
    }

    const fields = {};
    if (caption    !== undefined) fields.caption    = caption;
    if (alt_text   !== undefined) fields.alt_text   = alt_text;
    if (is_primary !== undefined) fields.is_primary = toBoolean(is_primary);
    if (sort_order !== undefined) fields.sort_order = toNumber(sort_order);

    const keys = Object.keys(fields);
    if (!keys.length) {
      return res.status(400).json({ success: false, error: "No fields to update" });
    }

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const vals = [...keys.map((k) => fields[k]), imageId, id];

    const result = await query(
      `UPDATE destination_images SET ${sets}
       WHERE id = $${vals.length - 1} AND destination_id = $${vals.length}
       RETURNING *`,
      vals
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Image not found" });
    }

    if (toBoolean(is_primary)) {
      await query(
        "UPDATE destinations SET image_url = $2 WHERE id = $1",
        [id, result.rows[0].image_url]
      );
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.removeImage = async (req, res, next) => {
  try {
    const { id, imageId } = req.params;

    const result = await query(
      `DELETE FROM destination_images
       WHERE id = $1 AND destination_id = $2 RETURNING *`,
      [imageId, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Image not found" });
    }

    const deleted = result.rows[0];
    await query(
      `UPDATE destinations
       SET image_urls = array_remove(COALESCE(image_urls, '{}'::TEXT[]), $2)
       WHERE id = $1`,
      [id, deleted.image_url]
    );

    if (deleted.is_primary) {
      const newPrimary = await query(
        `UPDATE destination_images SET is_primary = true
         WHERE id = (
           SELECT id FROM destination_images
           WHERE destination_id = $1 AND is_active = true
           ORDER BY sort_order ASC LIMIT 1
         ) RETURNING image_url`,
        [id]
      ).catch(() => ({ rows: [] }));
      await query(
        "UPDATE destinations SET image_url = $2 WHERE id = $1",
        [id, newPrimary.rows[0]?.image_url || null]
      );
    }

    res.json({ success: true, message: "Image deleted" });
  } catch (err) {
    next(err);
  }
};

exports.reorderImages = async (req, res, next) => {
  try {
    const { id }       = req.params;
    const { imageIds } = req.body;

    if (!Array.isArray(imageIds) || !imageIds.length) {
      return res.status(400).json({ success: false, error: "imageIds array required" });
    }

    await Promise.all(
      imageIds.map((imgId, i) =>
        query(
          "UPDATE destination_images SET sort_order = $1 WHERE id = $2 AND destination_id = $3",
          [i + 1, imgId, id]
        )
      )
    );

    const ordered = await query(
      `SELECT image_url FROM destination_images
       WHERE destination_id = $1 AND is_active = true
       ORDER BY sort_order ASC`, [id]
    );
    const urls = ordered.rows.map((r) => r.image_url);
    await query(
      "UPDATE destinations SET image_urls = $2, image_url = $3 WHERE id = $1",
      [id, urls, urls[0] || null]
    );

    res.json({ success: true, message: "Images reordered" });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════
   FAQs
   ═══════════════════════════════════════════════════════════════ */

exports.getFaqs = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM destination_faqs
       WHERE destination_id = $1 AND is_active = true
       ORDER BY sort_order ASC`,
      [id]
    ).catch(() => ({ rows: [] }));

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        id:           r.id,
        question:     r.question,
        answer:       r.answer,
        category:     r.category,
        helpfulCount: toNumber(r.helpful_count, 0),
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.addFaq = async (req, res, next) => {
  try {
    const { id }                               = req.params;
    const { question, answer, category, sort_order } = req.body;

    if (!question || !answer) {
      return res.status(400).json({ success: false, error: "question and answer are required" });
    }

    const result = await query(
      `INSERT INTO destination_faqs
       (destination_id, question, answer, category, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, question, answer, category || null, toNumber(sort_order, 0)]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateFaq = async (req, res, next) => {
  try {
    const { id, faqId } = req.params;
    const fields = { ...req.body };
    const keys   = Object.keys(fields);
    if (!keys.length) {
      return res.status(400).json({ success: false, error: "No fields to update" });
    }

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const vals = [...keys.map((k) => fields[k]), faqId, id];

    const result = await query(
      `UPDATE destination_faqs SET ${sets}
       WHERE id = $${vals.length - 1} AND destination_id = $${vals.length}
       RETURNING *`,
      vals
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "FAQ not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.removeFaq = async (req, res, next) => {
  try {
    const { id, faqId } = req.params;
    const result = await query(
      `DELETE FROM destination_faqs
       WHERE id = $1 AND destination_id = $2 RETURNING id`,
      [faqId, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "FAQ not found" });
    }
    res.json({ success: true, message: "FAQ deleted" });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════
   TAGS
   ═══════════════════════════════════════════════════════════════ */

exports.getDestinationTags = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM destination_tags
       WHERE destination_id = $1 ORDER BY tag_name ASC`,
      [id]
    ).catch(() => ({ rows: [] }));

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id, name: r.tag_name, slug: r.tag_slug, category: r.tag_category,
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.addDestinationTag = async (req, res, next) => {
  try {
    const { id }                     = req.params;
    const { tag_name, tag_category } = req.body;

    if (!tag_name?.trim()) {
      return res.status(400).json({ success: false, error: "tag_name is required" });
    }

    const tag_slug = slugify(tag_name);
    const result   = await query(
      `INSERT INTO destination_tags (destination_id, tag_name, tag_slug, tag_category)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (destination_id, tag_slug) DO NOTHING
       RETURNING *`,
      [id, tag_name.trim(), tag_slug, tag_category || null]
    );

    if (!result.rows.length) {
      return res.status(409).json({ success: false, error: "Tag already exists" });
    }
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.removeDestinationTag = async (req, res, next) => {
  try {
    const { id, tagId } = req.params;
    const result = await query(
      `DELETE FROM destination_tags
       WHERE id = $1 AND destination_id = $2 RETURNING id`,
      [tagId, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Tag not found" });
    }
    res.json({ success: true, message: "Tag removed" });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════
   ADMIN CRUD
   ═══════════════════════════════════════════════════════════════ */

exports.create = async (req, res, next) => {
  try {
    const data = req.body;

    if (!data.name?.trim()) {
      return res.status(400).json({ success: false, error: "Name is required" });
    }
    if (!data.country_id) {
      return res.status(400).json({ success: false, error: "country_id is required" });
    }

    const country = await resolveCountry(data.country_id);
    if (!country) {
      return res.status(400).json({ success: false, error: "Invalid country_id" });
    }

    const slug = await createUniqueSlug(data.name);

    const uploadedImg = req.file ? getUploadedFileUrl(req.file) : null;
    let imageUrls     = normalizeArray(data.image_urls);
    if (uploadedImg) imageUrls = [uploadedImg, ...imageUrls.filter((u) => u !== uploadedImg)];
    if (!imageUrls.length && data.image_url) imageUrls = [data.image_url];
    const mainImg = imageUrls[0] || null;

    const status      = data.status    || "draft";
    const publishedAt = status         === "published" ? new Date() : null;
    const featuredAt  = toBoolean(data.is_featured) ? new Date() : null;

    const result = await query(
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
        status, is_featured, is_popular, is_new, is_eco_friendly, is_family_friendly,
        meta_title, meta_description,
        published_at, featured_at, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
        $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52
      ) RETURNING *`,
      [
        country.id,
        data.name.trim(),
        slug,
        data.tagline            || null,
        data.short_description  || null,
        data.description        || null,
        data.overview           || null,
        data.what_to_expect     || null,
        data.best_time_to_visit || country.best_time_to_visit || null,
        data.getting_there      || null,
        data.local_tips         || null,
        data.safety_info        || null,
        data.category           || "safari",
        data.difficulty         || "moderate",
        data.destination_type   || null,
        toNumber(data.latitude),
        toNumber(data.longitude),
        toNumber(data.altitude_meters),
        data.address            || null,
        data.region             || country.region  || null,
        data.nearest_city       || country.capital || null,
        data.nearest_airport    || null,
        toNumber(data.distance_from_airport_km),
        mainImg,
        imageUrls,
        data.hero_image         || mainImg,
        data.thumbnail_url      || mainImg,
        data.video_url          || null,
        data.virtual_tour_url   || null,
        toNumber(data.duration_days),
        toNumber(data.duration_nights),
        formatDuration(toNumber(data.duration_days), toNumber(data.duration_nights)),
        toNumber(data.min_group_size, 1),
        toNumber(data.max_group_size),
        toNumber(data.min_age),
        data.fitness_level      || null,
        normalizeArray(data.highlights),
        normalizeArray(data.activities),
        normalizeArray(data.wildlife),
        data.entrance_fee       || null,
        data.operating_hours    || null,
        status,
        toBoolean(data.is_featured),
        toBoolean(data.is_popular),
        toBoolean(data.is_new),
        toBoolean(data.is_eco_friendly),
        toBoolean(data.is_family_friendly),
        data.meta_title         || data.name.trim(),
        data.meta_description   || data.short_description || null,
        publishedAt,
        featuredAt,
        req.user?.id            || null,
      ]
    );

    await syncCountryDestinationCount(country.id);

    const full = await query(`${BASE_SELECT} WHERE d.id = $1`, [result.rows[0].id]);
    res.status(201).json({
      success: true,
      message: "Destination created",
      data:    serialize(full.rows[0]),
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ success: false, error: "Destination with this name already exists" });
    }
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data   = req.body;

    const existing = await query("SELECT * FROM destinations WHERE id = $1", [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    const current = existing.rows[0];
    const fields  = { ...data };

    // Never allow pricing through update
    delete fields.price;
    delete fields.prices;

    if (fields.name && fields.name !== current.name) {
      fields.slug = await createUniqueSlug(fields.name, id);
    }

    if (fields.country_id && fields.country_id !== current.country_id) {
      const newCountry = await resolveCountry(fields.country_id);
      if (!newCountry) {
        return res.status(400).json({ success: false, error: "Invalid country_id" });
      }
      fields.country_id = newCountry.id;
    }

    if (req.file) {
      const url          = getUploadedFileUrl(req.file);
      fields.image_url   = url;
      const existingUrls = normalizeArray(fields.image_urls || current.image_urls);
      fields.image_urls  = [url, ...existingUrls.filter((u) => u !== url)];
    } else if (fields.image_urls) {
      fields.image_urls = normalizeArray(fields.image_urls);
      fields.image_url  = fields.image_urls[0] || current.image_url;
    }

    ["highlights", "activities", "wildlife"].forEach((f) => {
      if (fields[f]) fields[f] = normalizeArray(fields[f]);
    });

    if (fields.duration_days || fields.duration_nights) {
      fields.duration_display = formatDuration(
        toNumber(fields.duration_days   ?? current.duration_days),
        toNumber(fields.duration_nights ?? current.duration_nights)
      );
    }

    if (fields.status === "published" && current.status !== "published") {
      fields.published_at = new Date();
    }

    if (fields.is_featured === true && !current.is_featured) {
      fields.featured_at = new Date();
    } else if (fields.is_featured === false) {
      fields.featured_at = null;
    }

    Object.keys(fields).forEach((k) => {
      if (fields[k] === undefined) delete fields[k];
    });

    const keys = Object.keys(fields);
    if (!keys.length) {
      return res.status(400).json({ success: false, error: "No fields to update" });
    }

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const vals = [...keys.map((k) => fields[k]), id];

    await query(
      `UPDATE destinations SET ${sets}, updated_at = NOW()
       WHERE id = $${vals.length}`,
      vals
    );

    if (fields.country_id && fields.country_id !== current.country_id) {
      await syncCountryDestinationCount(current.country_id);
      await syncCountryDestinationCount(fields.country_id);
    }

    const full = await query(`${BASE_SELECT} WHERE d.id = $1`, [id]);
    res.json({ success: true, message: "Destination updated", data: serialize(full.rows[0]) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ success: false, error: "Name/slug already exists" });
    }
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const { id }               = req.params;
    const { permanent = false } = req.query;

    const existing = await query(
      "SELECT id, name, slug, country_id FROM destinations WHERE id = $1", [id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    const { country_id, name, slug } = existing.rows[0];

    if (toBoolean(permanent)) {
      await query("DELETE FROM destinations WHERE id = $1", [id]);
    } else {
      await query(
        `UPDATE destinations
         SET is_active = false, status = 'archived', updated_at = NOW()
         WHERE id = $1`, [id]
      );
    }

    await syncCountryDestinationCount(country_id);

    res.json({
      success: true,
      message: toBoolean(permanent) ? "Destination permanently deleted" : "Destination archived",
      data:    { id: parseInt(id), name, slug },
    });
  } catch (err) {
    next(err);
  }
};

exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `UPDATE destinations
       SET is_active = true, status = 'draft', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }
    await syncCountryDestinationCount(result.rows[0].country_id);
    res.json({ success: true, message: "Destination restored", data: serialize(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

exports.getItinerary = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM destination_itineraries
       WHERE destination_id = $1 AND is_active = true
       ORDER BY day_number ASC`,
      [id]
    ).catch(() => ({ rows: [] }));

    res.json({
      success: true,
      data: result.rows.map((it) => ({
        id:            it.id,
        dayNumber:     it.day_number,
        title:         it.title,
        description:   it.description,
        activities:    it.activities || [],
        highlights:    it.highlights || [],
        meals:         it.meals      || [],
        accommodation: it.accommodation,
        distanceKm:    toNumber(it.distance_km),
        imageUrl:      it.image_url,
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.bulkUpdate = async (req, res, next) => {
  try {
    const { ids, updates } = req.body;

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, error: "ids array required" });
    }
    if (!updates || !Object.keys(updates).length) {
      return res.status(400).json({ success: false, error: "updates object required" });
    }

    const allowed = [
      "status", "is_active", "is_featured", "is_popular", "is_new",
      "is_eco_friendly", "is_family_friendly", "category", "difficulty",
    ];
    const fields = {};
    allowed.forEach((f) => {
      if (updates[f] !== undefined) fields[f] = updates[f];
    });

    if (!Object.keys(fields).length) {
      return res.status(400).json({ success: false, error: "No valid fields" });
    }

    if (fields.is_featured === true)   fields.featured_at  = new Date();
    if (fields.is_featured === false)  fields.featured_at  = null;
    if (fields.status === "published") fields.published_at = new Date();
    fields.updated_at = new Date();

    const keys         = Object.keys(fields);
    const sets         = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const placeholders = ids.map((_, i) => `$${keys.length + i + 1}`).join(", ");

    const result = await query(
      `UPDATE destinations SET ${sets}
       WHERE id IN (${placeholders})
       RETURNING id, name, slug`,
      [...keys.map((k) => fields[k]), ...ids]
    );

    res.json({
      success: true,
      message: `${result.rows.length} destinations updated`,
      data:    result.rows,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = exports;