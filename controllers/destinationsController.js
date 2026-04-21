// controllers/destinationsController.js
// ============================================================
// Destinations Controller — Clean Implementation
// Strong Country Relationship, No Pricing
// ============================================================

const { query } = require("../config/db");
const { slugify, paginate } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");

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
  if (typeof value === "string") return value.toLowerCase() === "true" || value === "1";
  return Boolean(value);
};

const normalizeArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed).filter(Boolean);
      } catch {
        return [];
      }
    }
    return trimmed.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [];
};

const parseJson = (value, defaultValue = {}) => {
  if (!value) return defaultValue;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
};

/**
 * Resolve country by ID or slug — returns full country data
 */
const resolveCountry = async (idOrSlug) => {
  if (!idOrSlug) return null;
  const str = String(idOrSlug).trim();
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

/**
 * Update country's destination count
 */
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
  );
};

/**
 * Generate unique slug
 */
const createUniqueSlug = async (name, excludeId = null) => {
  const base = slugify(name);
  let slug = base;
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

const formatDuration = (days, nights) => {
  if (days && nights) return `${days} Days / ${nights} Nights`;
  if (days) return `${days} Day${days > 1 ? "s" : ""}`;
  if (nights) return `${nights} Night${nights > 1 ? "s" : ""}`;
  return null;
};

/* ═══════════════════════════════════════════════════════════════
   SERIALIZATION
   ═══════════════════════════════════════════════════════════════ */

const serialize = (row, options = {}) => {
  const images = normalizeArray(row.image_urls);
  const mainImage = images[0] || row.image_url || null;

  return {
    // Identifiers
    id: row.id,
    slug: row.slug,

    // Basic Info
    name: row.name,
    tagline: row.tagline,
    shortDescription: row.short_description,
    description: row.description,
    overview: row.overview,

    // Extended Content
    highlights: row.highlights || [],
    activities: row.activities || [],
    wildlife: row.wildlife || [],
    bestTimeToVisit: row.best_time_to_visit,
    gettingThere: row.getting_there,
    whatToExpect: row.what_to_expect,
    localTips: row.local_tips,
    safetyInfo: row.safety_info,

    // Classification
    category: row.category,
    difficulty: row.difficulty,
    destinationType: row.destination_type,

    // Country (STRONG RELATIONSHIP)
    country: {
      id: row.country_id,
      slug: row.country_slug,
      name: row.country_name,
      flag: row.country_flag,
      flagUrl: row.country_flag_url,
      continent: row.country_continent,
      region: row.country_region,
    },
    countryId: row.country_id,
    countrySlug: row.country_slug,
    countryName: row.country_name,

    // Location
    region: row.region,
    nearestCity: row.nearest_city,
    nearestAirport: row.nearest_airport,
    distanceFromAirportKm: toNumber(row.distance_from_airport_km),
    address: row.address,
    mapPosition: {
      lat: toNumber(row.latitude),
      lng: toNumber(row.longitude),
    },
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    altitudeMeters: toNumber(row.altitude_meters),

    // Media
    images,
    imageUrl: mainImage,
    heroImage: row.hero_image || mainImage,
    thumbnailUrl: row.thumbnail_url || mainImage,
    videoUrl: row.video_url,
    virtualTourUrl: row.virtual_tour_url,

    // Duration & Group
    duration: row.duration_display || formatDuration(row.duration_days, row.duration_nights),
    durationDays: toNumber(row.duration_days),
    durationNights: toNumber(row.duration_nights),
    minGroupSize: toNumber(row.min_group_size, 1),
    maxGroupSize: toNumber(row.max_group_size),
    minAge: toNumber(row.min_age),
    fitnessLevel: row.fitness_level,

    // Ratings & Stats
    rating: toNumber(row.rating, 0),
    reviewCount: toNumber(row.review_count, 0),
    viewCount: toNumber(row.view_count, 0),
    bookingCount: toNumber(row.booking_count, 0),
    wishlistCount: toNumber(row.wishlist_count, 0),

    // Availability
    entranceFee: row.entrance_fee,
    operatingHours: row.operating_hours,
    isSoldOut: toBoolean(row.is_sold_out),

    // Flags
    status: row.status,
    isActive: toBoolean(row.is_active),
    isFeatured: toBoolean(row.is_featured),
    isPopular: toBoolean(row.is_popular),
    isNew: toBoolean(row.is_new),
    isEcoFriendly: toBoolean(row.is_eco_friendly),
    isFamilyFriendly: toBoolean(row.is_family_friendly),

    // SEO
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,

    // Timestamps
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,

    // Include relations if requested
    ...(options.includeRelations && {
      gallery: row.gallery || [],
      itinerary: row.itinerary || [],
      faqs: row.faqs || [],
      reviews: row.reviews || [],
      tags: row.tags || [],
      related: row.related || [],
      nearby: row.nearby || [],
    }),
  };
};

const serializeReview = (row) => ({
  id: row.id,
  reviewerName: row.reviewer_name,
  reviewerCountry: row.reviewer_country,
  reviewerAvatar: row.reviewer_avatar,
  title: row.title,
  content: row.content,
  rating: toNumber(row.overall_rating),
  tripDate: row.trip_date,
  tripType: row.trip_type,
  images: row.images || [],
  isVerified: toBoolean(row.is_verified),
  isFeatured: toBoolean(row.is_featured),
  helpfulCount: toNumber(row.helpful_count, 0),
  createdAt: row.created_at,
});

/* ═══════════════════════════════════════════════════════════════
   QUERY BUILDING
   ═══════════════════════════════════════════════════════════════ */

const BASE_SELECT = `
  SELECT 
    d.*,
    c.name AS country_name,
    c.slug AS country_slug,
    c.flag AS country_flag,
    c.flag_url AS country_flag_url,
    c.continent AS country_continent,
    c.region AS country_region
  FROM destinations d
  INNER JOIN countries c ON d.country_id = c.id AND c.is_active = true
`;

const buildFilters = async (filters) => {
  const conditions = ["d.is_active = true"];
  const params = [];
  let idx = 1;

  // Status
  if (filters.status) {
    conditions.push(`d.status = $${idx++}`);
    params.push(filters.status);
  } else if (!filters.includeUnpublished) {
    conditions.push(`d.status = 'published'`);
  }

  // Country (STRONG)
  if (filters.country || filters.country_id || filters.countrySlug) {
    const country = await resolveCountry(filters.country || filters.country_id || filters.countrySlug);
    if (country) {
      conditions.push(`d.country_id = $${idx++}`);
      params.push(country.id);
    } else {
      conditions.push("1 = 0"); // No results
    }
  }

  // Continent (via country)
  if (filters.continent) {
    conditions.push(`c.continent ILIKE $${idx++}`);
    params.push(filters.continent);
  }

  // Category
  if (filters.category) {
    conditions.push(`d.category = $${idx++}`);
    params.push(filters.category);
  }

  // Difficulty
  if (filters.difficulty) {
    conditions.push(`d.difficulty = $${idx++}`);
    params.push(filters.difficulty);
  }

  // Rating
  if (filters.minRating) {
    conditions.push(`d.rating >= $${idx++}`);
    params.push(parseFloat(filters.minRating));
  }

  // Duration
  if (filters.minDuration) {
    conditions.push(`d.duration_days >= $${idx++}`);
    params.push(parseInt(filters.minDuration));
  }
  if (filters.maxDuration) {
    conditions.push(`d.duration_days <= $${idx++}`);
    params.push(parseInt(filters.maxDuration));
  }

  // Boolean flags
  const boolFlags = ["featured", "popular", "new", "eco_friendly", "family_friendly"];
  boolFlags.forEach((flag) => {
    const key = flag.replace("_", "");
    if (filters[key] !== undefined || filters[flag] !== undefined) {
      conditions.push(`d.is_${flag} = $${idx++}`);
      params.push(toBoolean(filters[key] || filters[flag]));
    }
  });

  // Search
  if (filters.search || filters.q) {
    const term = filters.search || filters.q;
    conditions.push(`(
      d.name ILIKE $${idx} OR 
      d.description ILIKE $${idx} OR 
      d.short_description ILIKE $${idx} OR 
      c.name ILIKE $${idx}
    )`);
    params.push(`%${term}%`);
    idx++;
  }

  // Tag
  if (filters.tag) {
    conditions.push(`EXISTS (
      SELECT 1 FROM destination_tags dt 
      WHERE dt.destination_id = d.id AND dt.tag_slug = $${idx++}
    )`);
    params.push(filters.tag.toLowerCase());
  }

  // Bounds (map)
  if (filters.bounds) {
    try {
      const [swLat, swLng, neLat, neLng] = filters.bounds.split(",").map(Number);
      if ([swLat, swLng, neLat, neLng].every(Number.isFinite)) {
        conditions.push(`d.latitude BETWEEN $${idx} AND $${idx + 1}`);
        conditions.push(`d.longitude BETWEEN $${idx + 2} AND $${idx + 3}`);
        params.push(swLat, neLat, swLng, neLng);
        idx += 4;
      }
    } catch (e) {}
  }

  // Exclude IDs
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
    name: "d.name ASC",
    "-name": "d.name DESC",
    rating: "d.rating DESC NULLS LAST",
    newest: "d.published_at DESC NULLS LAST, d.created_at DESC",
    oldest: "d.created_at ASC",
    popular: "d.booking_count DESC, d.view_count DESC",
    featured: "d.is_featured DESC, d.is_popular DESC, d.rating DESC NULLS LAST",
    views: "d.view_count DESC",
    duration: "d.duration_days ASC NULLS LAST",
    "-duration": "d.duration_days DESC NULLS LAST",
    random: "RANDOM()",
  };
  return map[sort] || map.featured;
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC ENDPOINTS
   ═══════════════════════════════════════════════════════════════ */

/**
 * GET /api/destinations
 */
exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 12, sort = "featured", ...filters } = req.query;

    const { where, params, nextIdx } = await buildFilters(filters);
    const orderBy = buildSort(sort);

    // Count
    const countRes = await query(
      `SELECT COUNT(*) FROM destinations d 
       INNER JOIN countries c ON d.country_id = c.id AND c.is_active = true 
       ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);
    const pagination = paginate(total, page, limit);

    // Fetch
    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `${BASE_SELECT} ${where} ORDER BY ${orderBy} LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      params
    );

    res.json({
      success: true,
      data: result.rows.map((r) => serialize(r)),
      pagination,
      meta: { sort, filters: Object.keys(filters).length ? filters : undefined },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/destinations/featured
 */
exports.getFeatured = async (req, res, next) => {
  try {
    const { limit = 8, country, continent } = req.query;

    let where = "WHERE d.is_featured = true AND d.is_active = true AND d.status = 'published'";
    const params = [];
    let idx = 1;

    if (country) {
      const c = await resolveCountry(country);
      if (c) {
        where += ` AND d.country_id = $${idx++}`;
        params.push(c.id);
      }
    }
    if (continent) {
      where += ` AND c.continent ILIKE $${idx++}`;
      params.push(continent);
    }

    params.push(parseInt(limit));

    const result = await query(
      `${BASE_SELECT} ${where} ORDER BY d.featured_at DESC NULLS LAST, d.rating DESC NULLS LAST LIMIT $${idx}`,
      params
    );

    res.json({ success: true, data: result.rows.map((r) => serialize(r)), count: result.rows.length });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/destinations/popular
 */
exports.getPopular = async (req, res, next) => {
  try {
    const { limit = 8, country } = req.query;

    let where = "WHERE d.is_active = true AND d.status = 'published'";
    const params = [];
    let idx = 1;

    if (country) {
      const c = await resolveCountry(country);
      if (c) {
        where += ` AND d.country_id = $${idx++}`;
        params.push(c.id);
      }
    }

    params.push(parseInt(limit));

    const result = await query(
      `${BASE_SELECT} ${where} ORDER BY d.booking_count DESC, d.view_count DESC, d.rating DESC NULLS LAST LIMIT $${idx}`,
      params
    );

    res.json({ success: true, data: result.rows.map((r) => serialize(r)), count: result.rows.length });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/destinations/new
 */
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

/**
 * GET /api/destinations/country/:countrySlug
 */
exports.getByCountry = async (req, res, next) => {
  try {
    const { countrySlug } = req.params;
    const { page = 1, limit = 12, sort = "featured", category } = req.query;

    const country = await resolveCountry(countrySlug);
    if (!country) {
      return res.status(404).json({ success: false, error: "Country not found" });
    }

    let where = "WHERE d.country_id = $1 AND d.is_active = true AND d.status = 'published'";
    const params = [country.id];
    let idx = 2;

    if (category) {
      where += ` AND d.category = $${idx++}`;
      params.push(category);
    }

    const countRes = await query(`SELECT COUNT(*) FROM destinations d ${where}`, params);
    const total = parseInt(countRes.rows[0].count);
    const pagination = paginate(total, page, limit);

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `${BASE_SELECT} ${where} ORDER BY ${buildSort(sort)} LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({
      success: true,
      data: result.rows.map((r) => serialize(r)),
      pagination,
      country: {
        id: country.id,
        slug: country.slug,
        name: country.name,
        flag: country.flag,
        continent: country.continent,
        destinationCount: total,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/destinations/categories
 */
exports.getCategories = async (req, res, next) => {
  try {
    const { country } = req.query;

    let where = "WHERE d.is_active = true AND d.status = 'published' AND d.category IS NOT NULL";
    const params = [];

    if (country) {
      const c = await resolveCountry(country);
      if (c) {
        where += " AND d.country_id = $1";
        params.push(c.id);
      }
    }

    const result = await query(
      `SELECT 
        d.category,
        COUNT(*) AS count,
        AVG(d.rating) FILTER (WHERE d.rating > 0) AS avg_rating
       FROM destinations d
       ${where}
       GROUP BY d.category
       ORDER BY count DESC`,
      params
    );

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        name: r.category,
        slug: slugify(r.category),
        displayName: r.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        count: parseInt(r.count),
        avgRating: toNumber(r.avg_rating),
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/destinations/difficulties
 */
exports.getDifficulties = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT difficulty, COUNT(*) AS count
      FROM destinations
      WHERE is_active = true AND status = 'published' AND difficulty IS NOT NULL
      GROUP BY difficulty
      ORDER BY CASE difficulty
        WHEN 'easy' THEN 1 WHEN 'moderate' THEN 2 WHEN 'challenging' THEN 3
        WHEN 'difficult' THEN 4 WHEN 'expert' THEN 5 END
    `);

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        level: r.difficulty,
        displayName: r.difficulty.charAt(0).toUpperCase() + r.difficulty.slice(1),
        count: parseInt(r.count),
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/destinations/map
 */
exports.getMapData = async (req, res, next) => {
  try {
    const { country, category, bounds, limit = 500 } = req.query;

    let where = "WHERE d.is_active = true AND d.status = 'published' AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL";
    const params = [];
    let idx = 1;

    if (country) {
      const c = await resolveCountry(country);
      if (c) {
        where += ` AND d.country_id = $${idx++}`;
        params.push(c.id);
      }
    }

    if (category) {
      where += ` AND d.category = $${idx++}`;
      params.push(category);
    }

    if (bounds) {
      try {
        const [swLat, swLng, neLat, neLng] = bounds.split(",").map(Number);
        if ([swLat, swLng, neLat, neLng].every(Number.isFinite)) {
          where += ` AND d.latitude BETWEEN $${idx} AND $${idx + 1}`;
          where += ` AND d.longitude BETWEEN $${idx + 2} AND $${idx + 3}`;
          params.push(swLat, neLat, swLng, neLng);
          idx += 4;
        }
      } catch (e) {}
    }

    params.push(parseInt(limit));

    const result = await query(
      `SELECT 
        d.id, d.name, d.slug, d.latitude, d.longitude, d.category, d.difficulty,
        d.image_url, d.short_description, d.rating, d.review_count,
        d.is_featured, d.is_popular,
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
        id: r.id,
        name: r.name,
        slug: r.slug,
        position: { lat: toNumber(r.latitude), lng: toNumber(r.longitude) },
        category: r.category,
        difficulty: r.difficulty,
        imageUrl: r.image_url,
        shortDescription: r.short_description,
        rating: toNumber(r.rating),
        reviewCount: toNumber(r.review_count),
        isFeatured: toBoolean(r.is_featured),
        isPopular: toBoolean(r.is_popular),
        country: { name: r.country_name, slug: r.country_slug, flag: r.country_flag },
      })),
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/destinations/search
 */
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
    const total = parseInt(countRes.rows[0].count);
    const pagination = paginate(total, page, limit);

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `${BASE_SELECT} ${where}
       ORDER BY CASE WHEN d.name ILIKE $${nextIdx + 2} THEN 0 ELSE 1 END, d.rating DESC NULLS LAST
       LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      [...params, `${q}%`]
    );

    res.json({ success: true, data: result.rows.map((r) => serialize(r)), pagination, query: q });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/destinations/suggestions
 */
exports.getSuggestions = async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const result = await query(
      `SELECT d.id, d.name, d.slug, d.category, d.image_url, d.rating,
              c.name AS country_name, c.slug AS country_slug, c.flag AS country_flag
       FROM destinations d
       INNER JOIN countries c ON d.country_id = c.id
       WHERE d.is_active = true AND d.status = 'published'
         AND (d.name ILIKE $1 OR c.name ILIKE $1)
       ORDER BY CASE WHEN d.name ILIKE $2 THEN 0 ELSE 1 END, d.is_featured DESC, d.rating DESC NULLS LAST
       LIMIT $3`,
      [`%${q}%`, `${q}%`, parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        category: r.category,
        imageUrl: r.image_url,
        rating: toNumber(r.rating),
        country: { name: r.country_name, slug: r.country_slug, flag: r.country_flag },
        type: "destination",
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/destinations/tags
 */
exports.getTags = async (req, res, next) => {
  try {
    const { limit = 50 } = req.query;

    const result = await query(
      `SELECT dt.tag_name, dt.tag_slug, dt.tag_category, COUNT(DISTINCT dt.destination_id) AS count
       FROM destination_tags dt
       INNER JOIN destinations d ON dt.destination_id = d.id
       WHERE d.is_active = true AND d.status = 'published'
       GROUP BY dt.tag_name, dt.tag_slug, dt.tag_category
       ORDER BY count DESC
       LIMIT $1`,
      [parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        name: r.tag_name,
        slug: r.tag_slug,
        category: r.tag_category,
        count: parseInt(r.count),
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/destinations/stats
 */
exports.getStats = async (req, res, next) => {
  try {
    const stats = await query(`
      SELECT 
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'published') AS published,
        COUNT(*) FILTER (WHERE is_featured) AS featured,
        COUNT(*) FILTER (WHERE is_popular) AS popular,
        COUNT(DISTINCT country_id) AS countries,
        AVG(rating) FILTER (WHERE rating > 0) AS avg_rating,
        SUM(view_count) AS total_views,
        SUM(review_count) AS total_reviews
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
          total: parseInt(stats.rows[0].total) || 0,
          published: parseInt(stats.rows[0].published) || 0,
          featured: parseInt(stats.rows[0].featured) || 0,
          popular: parseInt(stats.rows[0].popular) || 0,
          countries: parseInt(stats.rows[0].countries) || 0,
          avgRating: toNumber(stats.rows[0].avg_rating),
          totalViews: parseInt(stats.rows[0].total_views) || 0,
          totalReviews: parseInt(stats.rows[0].total_reviews) || 0,
        },
        byCategory: byCategory.rows.map((r) => ({ category: r.category, count: parseInt(r.count) })),
        byCountry: byCountry.rows.map((r) => ({
          name: r.name,
          slug: r.slug,
          flag: r.flag,
          count: parseInt(r.count),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/destinations/:idOrSlug
 */
exports.getOne = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const { include } = req.query;

    const isNum = /^\d+$/.test(idOrSlug);
    const col = isNum ? "d.id" : "d.slug";
    const val = isNum ? parseInt(idOrSlug) : idOrSlug.toLowerCase();

    const result = await query(`${BASE_SELECT} WHERE ${col} = $1 AND d.is_active = true`, [val]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    const row = result.rows[0];
    const destId = row.id;

    // Increment views (async)
    query("UPDATE destinations SET view_count = view_count + 1 WHERE id = $1", [destId]).catch(() => {});

    const dest = serialize(row);
    const includes = include ? include.split(",").map((s) => s.trim().toLowerCase()) : [];
    const all = includes.includes("all");

    const promises = [];

    // Gallery
    if (all || includes.includes("gallery") || includes.includes("images")) {
      promises.push(
        query(
          `SELECT * FROM destination_images WHERE destination_id = $1 AND is_active = true ORDER BY is_primary DESC, sort_order ASC`,
          [destId]
        ).then((r) => {
          dest.gallery = r.rows.map((img) => ({
            id: img.id,
            imageUrl: img.image_url,
            caption: img.caption,
            isPrimary: toBoolean(img.is_primary),
          }));
        })
      );
    }

    // Itinerary
    if (all || includes.includes("itinerary")) {
      promises.push(
        query(
          `SELECT * FROM destination_itineraries WHERE destination_id = $1 AND is_active = true ORDER BY day_number ASC`,
          [destId]
        ).then((r) => {
          dest.itinerary = r.rows.map((it) => ({
            id: it.id,
            dayNumber: it.day_number,
            title: it.title,
            description: it.description,
            activities: it.activities || [],
            meals: it.meals || [],
            accommodation: it.accommodation,
            imageUrl: it.image_url,
          }));
        })
      );
    }

    // FAQs
    if (all || includes.includes("faqs")) {
      promises.push(
        query(
          `SELECT * FROM destination_faqs WHERE destination_id = $1 AND is_active = true ORDER BY sort_order ASC`,
          [destId]
        ).then((r) => {
          dest.faqs = r.rows.map((f) => ({
            id: f.id,
            question: f.question,
            answer: f.answer,
            category: f.category,
          }));
        })
      );
    }

    // Reviews
    if (all || includes.includes("reviews")) {
      promises.push(
        query(
          `SELECT * FROM destination_reviews WHERE destination_id = $1 AND status = 'approved' 
           ORDER BY is_featured DESC, created_at DESC LIMIT 10`,
          [destId]
        ).then((r) => {
          dest.reviews = r.rows.map(serializeReview);
        })
      );
    }

    // Tags
    if (all || includes.includes("tags")) {
      promises.push(
        query(`SELECT * FROM destination_tags WHERE destination_id = $1 ORDER BY tag_name ASC`, [destId]).then((r) => {
          dest.tags = r.rows.map((t) => ({ name: t.tag_name, slug: t.tag_slug, category: t.tag_category }));
        })
      );
    }

    // Related (same country or category)
    if (all || includes.includes("related")) {
      promises.push(
        query(
          `${BASE_SELECT}
           WHERE d.id != $1 AND d.is_active = true AND d.status = 'published'
             AND (d.country_id = $2 OR d.category = $3)
           ORDER BY CASE WHEN d.country_id = $2 AND d.category = $3 THEN 0
                         WHEN d.category = $3 THEN 1
                         WHEN d.country_id = $2 THEN 2 ELSE 3 END,
                    d.rating DESC NULLS LAST
           LIMIT 6`,
          [destId, row.country_id, row.category]
        ).then((r) => {
          dest.related = r.rows.map((rr) => serialize(rr));
        })
      );
    }

    await Promise.all(promises);

    // Fallback gallery from images array
    if (!dest.gallery?.length && dest.images?.length) {
      dest.gallery = dest.images.map((url, i) => ({
        id: `fallback-${i}`,
        imageUrl: url,
        isPrimary: i === 0,
      }));
    }

    res.json({ success: true, data: dest });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/destinations/:idOrSlug/related
 */
exports.getRelated = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const { limit = 6 } = req.query;

    const isNum = /^\d+$/.test(idOrSlug);
    const col = isNum ? "id" : "slug";
    const val = isNum ? parseInt(idOrSlug) : idOrSlug.toLowerCase();

    const source = await query(`SELECT id, country_id, category FROM destinations WHERE ${col} = $1`, [val]);

    if (source.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    const { id, country_id, category } = source.rows[0];

    const result = await query(
      `${BASE_SELECT}
       WHERE d.id != $1 AND d.is_active = true AND d.status = 'published'
         AND (d.country_id = $2 OR d.category = $3)
       ORDER BY CASE WHEN d.country_id = $2 AND d.category = $3 THEN 0
                     WHEN d.category = $3 THEN 1
                     WHEN d.country_id = $2 THEN 2 ELSE 3 END,
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
   ENGAGEMENT
   ═══════════════════════════════════════════════════════════════ */

exports.incrementView = async (req, res, next) => {
  try {
    const { id } = req.params;
    await query("UPDATE destinations SET view_count = view_count + 1 WHERE id = $1", [id]);
    res.json({ success: true, message: "View recorded" });
  } catch (err) {
    next(err);
  }
};

exports.incrementWishlist = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action = "add" } = req.body;
    const inc = action === "remove" ? -1 : 1;

    const result = await query(
      `UPDATE destinations SET wishlist_count = GREATEST(0, wishlist_count + $2) WHERE id = $1 RETURNING wishlist_count`,
      [id, inc]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    res.json({ success: true, wishlistCount: parseInt(result.rows[0].wishlist_count) });
  } catch (err) {
    next(err);
  }
};

exports.incrementShare = async (req, res, next) => {
  try {
    const { id } = req.params;
    await query("UPDATE destinations SET share_count = share_count + 1 WHERE id = $1", [id]);
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
    const { id } = req.params;
    const { page = 1, limit = 10, sort = "-created" } = req.query;

    const countRes = await query(
      `SELECT COUNT(*) FROM destination_reviews WHERE destination_id = $1 AND status = 'approved'`,
      [id]
    );
    const total = parseInt(countRes.rows[0].count);
    const pagination = paginate(total, page, limit);

    const sortMap = {
      created: "created_at ASC",
      "-created": "created_at DESC",
      rating: "overall_rating DESC",
      helpful: "helpful_count DESC",
    };

    const result = await query(
      `SELECT * FROM destination_reviews 
       WHERE destination_id = $1 AND status = 'approved'
       ORDER BY is_featured DESC, ${sortMap[sort] || sortMap["-created"]}
       LIMIT $2 OFFSET $3`,
      [id, pagination.limit, pagination.offset]
    );

    res.json({ success: true, data: result.rows.map(serializeReview), pagination });
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

    // Check destination exists
    const dest = await query("SELECT id FROM destinations WHERE id = $1 AND is_active = true", [id]);
    if (dest.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    const images = req.files ? req.files.map((f) => getUploadedFileUrl(f)) : normalizeArray(req.body.images);

    const result = await query(
      `INSERT INTO destination_reviews 
       (destination_id, user_id, reviewer_name, reviewer_country, title, content, overall_rating, trip_date, trip_type, images, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       RETURNING *`,
      [id, req.user?.id || null, reviewer_name || "Anonymous", reviewer_country, title, content, rating, trip_date, trip_type, images]
    );

    res.status(201).json({
      success: true,
      message: "Review submitted. It will be visible after moderation.",
      data: serializeReview(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
};

exports.markReviewHelpful = async (req, res, next) => {
  try {
    const { reviewId } = req.params;

    const result = await query(
      `UPDATE destination_reviews SET helpful_count = helpful_count + 1 WHERE id = $1 RETURNING helpful_count`,
      [reviewId]
    );

    if (result.rows.length === 0) {
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
      `SELECT * FROM destination_images WHERE destination_id = $1 AND is_active = true ORDER BY is_primary DESC, sort_order ASC`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        imageUrl: r.image_url,
        thumbnailUrl: r.thumbnail_url,
        caption: r.caption,
        altText: r.alt_text,
        isPrimary: toBoolean(r.is_primary),
        sortOrder: r.sort_order,
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
    if (dest.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    if (!req.files?.length && !req.body.image_urls) {
      return res.status(400).json({ success: false, error: "No images provided" });
    }

    const maxOrder = await query(
      "SELECT COALESCE(MAX(sort_order), 0) AS max FROM destination_images WHERE destination_id = $1",
      [id]
    );
    let order = maxOrder.rows[0].max;

    const images = [];
    const urls = [];

    // File uploads
    if (req.files?.length) {
      for (const file of req.files) {
        order++;
        const url = getUploadedFileUrl(file);
        const result = await query(
          `INSERT INTO destination_images (destination_id, image_url, sort_order, caption, uploaded_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [id, url, order, req.body.caption || null, req.user?.id || null]
        );
        images.push(result.rows[0]);
        urls.push(url);
      }
    }

    // URL-based
    if (req.body.image_urls) {
      for (const url of normalizeArray(req.body.image_urls)) {
        order++;
        const result = await query(
          `INSERT INTO destination_images (destination_id, image_url, sort_order, caption, uploaded_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [id, url, order, req.body.caption || null, req.user?.id || null]
        );
        images.push(result.rows[0]);
        urls.push(url);
      }
    }

    // Update destination
    await query(
      `UPDATE destinations SET 
       image_urls = COALESCE(image_urls, '{}'::TEXT[]) || $2::TEXT[],
       image_url = COALESCE(image_url, $3),
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
    const { id, imageId } = req.params;
    const { caption, alt_text, is_primary, sort_order } = req.body;

    if (toBoolean(is_primary)) {
      await query("UPDATE destination_images SET is_primary = false WHERE destination_id = $1 AND id != $2", [id, imageId]);
    }

    const fields = {};
    if (caption !== undefined) fields.caption = caption;
    if (alt_text !== undefined) fields.alt_text = alt_text;
    if (is_primary !== undefined) fields.is_primary = toBoolean(is_primary);
    if (sort_order !== undefined) fields.sort_order = toNumber(sort_order);

    const keys = Object.keys(fields);
    if (!keys.length) {
      return res.status(400).json({ success: false, error: "No fields to update" });
    }

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const vals = [...keys.map((k) => fields[k]), imageId, id];

    const result = await query(
      `UPDATE destination_images SET ${sets} WHERE id = $${vals.length - 1} AND destination_id = $${vals.length} RETURNING *`,
      vals
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Image not found" });
    }

    // Update primary image on destination
    if (toBoolean(is_primary)) {
      await query("UPDATE destinations SET image_url = $2 WHERE id = $1", [id, result.rows[0].image_url]);
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
      "DELETE FROM destination_images WHERE id = $1 AND destination_id = $2 RETURNING *",
      [imageId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Image not found" });
    }

    const deleted = result.rows[0];

    // Remove from destination array
    await query(
      `UPDATE destinations SET image_urls = array_remove(COALESCE(image_urls, '{}'::TEXT[]), $2) WHERE id = $1`,
      [id, deleted.image_url]
    );

    // Set new primary if needed
    if (deleted.is_primary) {
      const newPrimary = await query(
        `UPDATE destination_images SET is_primary = true 
         WHERE destination_id = $1 AND is_active = true ORDER BY sort_order ASC LIMIT 1 RETURNING image_url`,
        [id]
      );
      await query("UPDATE destinations SET image_url = $2 WHERE id = $1", [id, newPrimary.rows[0]?.image_url || null]);
    }

    res.json({ success: true, message: "Image deleted" });
  } catch (err) {
    next(err);
  }
};

exports.reorderImages = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { imageIds } = req.body;

    if (!Array.isArray(imageIds) || !imageIds.length) {
      return res.status(400).json({ success: false, error: "imageIds array required" });
    }

    await Promise.all(
      imageIds.map((imgId, i) =>
        query("UPDATE destination_images SET sort_order = $1 WHERE id = $2 AND destination_id = $3", [i + 1, imgId, id])
      )
    );

    // Update destination array order
    const ordered = await query(
      `SELECT image_url FROM destination_images WHERE destination_id = $1 AND is_active = true ORDER BY sort_order ASC`,
      [id]
    );
    const urls = ordered.rows.map((r) => r.image_url);
    await query("UPDATE destinations SET image_urls = $2, image_url = $3 WHERE id = $1", [id, urls, urls[0] || null]);

    res.json({ success: true, message: "Images reordered" });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════
   ITINERARY
   ═══════════════════════════════════════════════════════════════ */

exports.getItinerary = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM destination_itineraries WHERE destination_id = $1 AND is_active = true ORDER BY day_number ASC`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        dayNumber: r.day_number,
        title: r.title,
        description: r.description,
        activities: r.activities || [],
        highlights: r.highlights || [],
        meals: r.meals || [],
        accommodation: r.accommodation,
        distanceKm: toNumber(r.distance_km),
        imageUrl: r.image_url,
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.addItineraryDay = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { day_number, title, description, activities, highlights, meals, accommodation, distance_km, image_url } = req.body;

    if (!day_number || !title) {
      return res.status(400).json({ success: false, error: "day_number and title are required" });
    }

    const result = await query(
      `INSERT INTO destination_itineraries 
       (destination_id, day_number, title, description, activities, highlights, meals, accommodation, distance_km, image_url, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $2)
       RETURNING *`,
      [id, toNumber(day_number), title, description, normalizeArray(activities), normalizeArray(highlights), normalizeArray(meals), accommodation, toNumber(distance_km), image_url]
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

    ["activities", "highlights", "meals"].forEach((f) => {
      if (fields[f]) fields[f] = normalizeArray(fields[f]);
    });

    const keys = Object.keys(fields);
    if (!keys.length) {
      return res.status(400).json({ success: false, error: "No fields to update" });
    }

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const vals = [...keys.map((k) => fields[k]), dayId, id];

    const result = await query(
      `UPDATE destination_itineraries SET ${sets} WHERE id = $${vals.length - 1} AND destination_id = $${vals.length} RETURNING *`,
      vals
    );

    if (result.rows.length === 0) {
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
      "DELETE FROM destination_itineraries WHERE id = $1 AND destination_id = $2 RETURNING id",
      [dayId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Itinerary day not found" });
    }

    res.json({ success: true, message: "Itinerary day deleted" });
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
      `SELECT * FROM destination_faqs WHERE destination_id = $1 AND is_active = true ORDER BY sort_order ASC`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        category: r.category,
        helpfulCount: toNumber(r.helpful_count),
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.addFaq = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { question, answer, category, sort_order } = req.body;

    if (!question || !answer) {
      return res.status(400).json({ success: false, error: "question and answer are required" });
    }

    const result = await query(
      `INSERT INTO destination_faqs (destination_id, question, answer, category, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, question, answer, category, toNumber(sort_order, 0)]
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

    const keys = Object.keys(fields);
    if (!keys.length) {
      return res.status(400).json({ success: false, error: "No fields to update" });
    }

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const vals = [...keys.map((k) => fields[k]), faqId, id];

    const result = await query(
      `UPDATE destination_faqs SET ${sets} WHERE id = $${vals.length - 1} AND destination_id = $${vals.length} RETURNING *`,
      vals
    );

    if (result.rows.length === 0) {
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
      "DELETE FROM destination_faqs WHERE id = $1 AND destination_id = $2 RETURNING id",
      [faqId, id]
    );

    if (result.rows.length === 0) {
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
      `SELECT * FROM destination_tags WHERE destination_id = $1 ORDER BY tag_name ASC`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows.map((r) => ({ id: r.id, name: r.tag_name, slug: r.tag_slug, category: r.tag_category })),
    });
  } catch (err) {
    next(err);
  }
};

exports.addDestinationTag = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tag_name, tag_category } = req.body;

    if (!tag_name?.trim()) {
      return res.status(400).json({ success: false, error: "tag_name is required" });
    }

    const slug = slugify(tag_name);

    const result = await query(
      `INSERT INTO destination_tags (destination_id, tag_name, tag_slug, tag_category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (destination_id, tag_slug) DO NOTHING
       RETURNING *`,
      [id, tag_name.trim(), slug, tag_category || null]
    );

    if (result.rows.length === 0) {
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
      "DELETE FROM destination_tags WHERE id = $1 AND destination_id = $2 RETURNING id",
      [tagId, id]
    );

    if (result.rows.length === 0) {
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

/**
 * POST /api/destinations
 */
exports.create = async (req, res, next) => {
  try {
    const data = req.body;

    // Validation
    if (!data.name?.trim()) {
      return res.status(400).json({ success: false, error: "Name is required" });
    }
    if (!data.country_id) {
      return res.status(400).json({ success: false, error: "country_id is required" });
    }

    // Resolve country
    const country = await resolveCountry(data.country_id);
    if (!country) {
      return res.status(400).json({ success: false, error: "Invalid country_id" });
    }

    // Generate slug
    const slug = await createUniqueSlug(data.name);

    // Images
    const uploadedImg = req.file ? getUploadedFileUrl(req.file) : null;
    let imageUrls = normalizeArray(data.image_urls);
    if (uploadedImg) imageUrls = [uploadedImg, ...imageUrls.filter((u) => u !== uploadedImg)];
    if (!imageUrls.length && data.image_url) imageUrls = [data.image_url];
    const mainImg = imageUrls[0] || null;

    const status = data.status || "draft";
    const publishedAt = status === "published" ? new Date() : null;
    const featuredAt = toBoolean(data.is_featured) ? new Date() : null;

    const result = await query(
      `INSERT INTO destinations (
        country_id, name, slug, tagline, short_description, description, overview,
        what_to_expect, best_time_to_visit, getting_there, local_tips, safety_info,
        category, difficulty, destination_type,
        latitude, longitude, altitude_meters, address, region, nearest_city, nearest_airport, distance_from_airport_km,
        image_url, image_urls, hero_image, thumbnail_url, video_url, virtual_tour_url,
        duration_days, duration_nights, duration_display,
        min_group_size, max_group_size, min_age, fitness_level,
        highlights, activities, wildlife,
        entrance_fee, operating_hours,
        status, is_featured, is_popular, is_new, is_eco_friendly, is_family_friendly,
        meta_title, meta_description,
        published_at, featured_at, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
        $41, $42, $43, $44, $45, $46, $47, $48, $49, $50
      ) RETURNING *`,
      [
        country.id,
        data.name.trim(),
        slug,
        data.tagline || null,
        data.short_description || null,
        data.description || null,
        data.overview || null,
        data.what_to_expect || null,
        data.best_time_to_visit || country.best_time_to_visit || null,
        data.getting_there || null,
        data.local_tips || null,
        data.safety_info || null,
        data.category || "safari",
        data.difficulty || "moderate",
        data.destination_type || null,
        toNumber(data.latitude),
        toNumber(data.longitude),
        toNumber(data.altitude_meters),
        data.address || null,
        data.region || country.region || null,
        data.nearest_city || country.capital || null,
        data.nearest_airport || null,
        toNumber(data.distance_from_airport_km),
        mainImg,
        imageUrls,
        data.hero_image || mainImg,
        data.thumbnail_url || mainImg,
        data.video_url || null,
        data.virtual_tour_url || null,
        toNumber(data.duration_days),
        toNumber(data.duration_nights),
        formatDuration(toNumber(data.duration_days), toNumber(data.duration_nights)),
        toNumber(data.min_group_size, 1),
        toNumber(data.max_group_size),
        toNumber(data.min_age),
        data.fitness_level || null,
        normalizeArray(data.highlights),
        normalizeArray(data.activities),
        normalizeArray(data.wildlife),
        data.entrance_fee || null,
        data.operating_hours || null,
        status,
        toBoolean(data.is_featured),
        toBoolean(data.is_popular),
        toBoolean(data.is_new),
        toBoolean(data.is_eco_friendly),
        toBoolean(data.is_family_friendly),
        data.meta_title || data.name.trim(),
        data.meta_description || data.short_description || null,
        publishedAt,
        featuredAt,
        req.user?.id || null,
      ]
    );

    // Update country count
    await syncCountryDestinationCount(country.id);

    // Get full data with country
    const full = await query(`${BASE_SELECT} WHERE d.id = $1`, [result.rows[0].id]);

    res.status(201).json({ success: true, message: "Destination created", data: serialize(full.rows[0]) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ success: false, error: "Destination with this name already exists" });
    }
    next(err);
  }
};

/**
 * PUT /api/destinations/:id
 */
  exports.update = async (req, res, next) => {
	  try {
	    const { id } = req.params;
	    const data = req.body;

    // Check exists
    const existing = await query("SELECT * FROM destinations WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

	    const current = existing.rows[0];
	    const fields = { ...data };
	    // Destinations must be price-less; ignore any incoming price fields.
	    // This also avoids "column does not exist" errors on older schemas.
	    delete fields.price;
	    delete fields.prices;

	    // Name change -> new slug
	    if (fields.name && fields.name !== current.name) {
	      fields.slug = await createUniqueSlug(fields.name, id);
	    }

    // Country change
    if (fields.country_id && fields.country_id !== current.country_id) {
      const newCountry = await resolveCountry(fields.country_id);
      if (!newCountry) {
        return res.status(400).json({ success: false, error: "Invalid country_id" });
      }
      fields.country_id = newCountry.id;
    }

    // Image upload
    if (req.file) {
      const url = getUploadedFileUrl(req.file);
      fields.image_url = url;
      const existingUrls = normalizeArray(fields.image_urls || current.image_urls);
      fields.image_urls = [url, ...existingUrls.filter((u) => u !== url)];
    } else if (fields.image_urls) {
      fields.image_urls = normalizeArray(fields.image_urls);
      fields.image_url = fields.image_urls[0] || current.image_url;
    }

    // Array fields
    ["highlights", "activities", "wildlife"].forEach((f) => {
      if (fields[f]) fields[f] = normalizeArray(fields[f]);
    });

    // Duration display
    if (fields.duration_days || fields.duration_nights) {
      fields.duration_display = formatDuration(
        toNumber(fields.duration_days ?? current.duration_days),
        toNumber(fields.duration_nights ?? current.duration_nights)
      );
    }

    // Status -> published_at
    if (fields.status === "published" && current.status !== "published") {
      fields.published_at = new Date();
    }

    // Featured -> featured_at
    if (fields.is_featured === true && !current.is_featured) {
      fields.featured_at = new Date();
    } else if (fields.is_featured === false) {
      fields.featured_at = null;
    }

    // Clean undefined
    Object.keys(fields).forEach((k) => {
      if (fields[k] === undefined) delete fields[k];
    });

    const keys = Object.keys(fields);
    if (!keys.length) {
      return res.status(400).json({ success: false, error: "No fields to update" });
    }

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const vals = [...keys.map((k) => fields[k]), id];

    const result = await query(
      `UPDATE destinations SET ${sets}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`,
      vals
    );

    // Sync country counts if changed
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

/**
 * DELETE /api/destinations/:id
 */
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { permanent = false } = req.query;

    const existing = await query("SELECT id, name, slug, country_id FROM destinations WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    const { country_id, name, slug } = existing.rows[0];

    if (toBoolean(permanent)) {
      await query("DELETE FROM destinations WHERE id = $1", [id]);
    } else {
      await query("UPDATE destinations SET is_active = false, status = 'archived', updated_at = NOW() WHERE id = $1", [id]);
    }

    await syncCountryDestinationCount(country_id);

    res.json({
      success: true,
      message: toBoolean(permanent) ? "Destination permanently deleted" : "Destination archived",
      data: { id: parseInt(id), name, slug },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/destinations/:id/restore
 */
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE destinations SET is_active = true, status = 'draft', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Destination not found" });
    }

    await syncCountryDestinationCount(result.rows[0].country_id);

    res.json({ success: true, message: "Destination restored", data: serialize(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/destinations/bulk
 */
exports.bulkUpdate = async (req, res, next) => {
  try {
    const { ids, updates } = req.body;

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, error: "ids array required" });
    }

    if (!updates || !Object.keys(updates).length) {
      return res.status(400).json({ success: false, error: "updates object required" });
    }

    // Allowed fields for bulk
    const allowed = ["status", "is_active", "is_featured", "is_popular", "is_new", "is_eco_friendly", "is_family_friendly", "category", "difficulty"];
    const fields = {};
    allowed.forEach((f) => {
      if (updates[f] !== undefined) fields[f] = updates[f];
    });

    if (!Object.keys(fields).length) {
      return res.status(400).json({ success: false, error: "No valid fields" });
    }

    // Handle timestamps
    if (fields.is_featured === true) fields.featured_at = new Date();
    if (fields.is_featured === false) fields.featured_at = null;
    if (fields.status === "published") fields.published_at = new Date();

    fields.updated_at = new Date();

    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const placeholders = ids.map((_, i) => `$${keys.length + i + 1}`).join(", ");

    const result = await query(
      `UPDATE destinations SET ${sets} WHERE id IN (${placeholders}) RETURNING id, name, slug`,
      [...keys.map((k) => fields[k]), ...ids]
    );

    res.json({
      success: true,
      message: `${result.rows.length} destinations updated`,
      data: result.rows,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = exports;
