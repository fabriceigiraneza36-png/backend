// controllers/destinationsController.js

const { query } = require("../config/db");
const { slugify, paginate } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");

/* ===================================================================
   UTILITY FUNCTIONS
   =================================================================== */

/**
 * Safely convert value to number
 */
const toNumber = (value, defaultValue = null) => {
  if (value === null || value === undefined || value === "") return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
};

/**
 * Safely convert value to boolean
 */
const toBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value === "1";
  }
  return Boolean(value);
};

/**
 * Normalize image URLs from various input formats
 */
const normalizeImageUrls = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      } catch {
        return [];
      }
    }
    return trimmed.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [];
};

/**
 * Normalize array fields from various input formats
 */
const normalizeArrayField = (value) => {
  if (!value) return null;
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : null;
      } catch {
        return null;
      }
    }
    return trimmed.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return null;
};

/**
 * Resolve country database ID from ID or slug
 */
const resolveCountryDbId = async (countryIdOrSlug) => {
  if (!countryIdOrSlug) return null;

  const asString = String(countryIdOrSlug).trim();
  
  // Check if numeric ID
  if (/^\d+$/.test(asString)) {
    const result = await query(
      "SELECT id FROM countries WHERE id = $1 AND is_active = true",
      [parseInt(asString, 10)]
    );
    return result.rows[0]?.id || null;
  }

  // Check by slug
  const result = await query(
    "SELECT id FROM countries WHERE slug = $1 AND is_active = true",
    [asString.toLowerCase()]
  );
  return result.rows[0]?.id || null;
};

/**
 * Calculate duration display string
 */
const formatDurationDisplay = (days, nights) => {
  if (days && nights) return `${days} Days / ${nights} Nights`;
  if (days) return `${days} Days`;
  if (nights) return `${nights} Nights`;
  return null;
};

/**
 * Calculate group size display string
 */
const formatGroupSizeDisplay = (min, max) => {
  if (min && max) return `${min}-${max} People`;
  if (max) return `Up to ${max} People`;
  if (min) return `Min ${min} People`;
  return null;
};

/* ===================================================================
   SERIALIZATION
   =================================================================== */

/**
 * Serialize destination row for API response
 */
const serializeDestination = (row, options = {}) => {
  const { includeRelations = false } = options;
  
  // Normalize image URLs
  const imageUrls = normalizeImageUrls(row.image_urls);
  const resolvedImageUrls = imageUrls.length 
    ? imageUrls 
    : (row.image_url ? [row.image_url] : []);

  // Build response object
  const destination = {
    // Identifiers
    id: row.id,
    uuid: row.uuid,
    slug: row.slug,
    
    // Basic Info
    name: row.name,
    shortName: row.short_name,
    tagline: row.tagline,
    shortDescription: row.short_description,
    description: row.description,
    
    // Extended Content
    overview: row.overview,
    whatToExpect: row.what_to_expect,
    bestTimeToVisit: row.best_time_to_visit,
    gettingThere: row.getting_there,
    localTips: row.local_tips,
    safetyInfo: row.safety_info,
    
    // Categorization
    category: row.category,
    subCategory: row.sub_category,
    difficulty: row.difficulty,
    
    // Location
    location: row.region || row.country_name,
    country: row.country_name,
    countryId: row.country_id,
    countrySlug: row.country_slug,
    region: row.region,
    nearestCity: row.nearest_city,
    nearestAirport: row.nearest_airport,
    distanceFromAirportKm: toNumber(row.distance_from_airport_km),
    address: row.address,
    mapPosition: {
      lat: toNumber(row.latitude),
      lng: toNumber(row.longitude),
    },
    altitudeMeters: toNumber(row.altitude_meters),
    
    // Media
    images: resolvedImageUrls,
    imageUrl: resolvedImageUrls[0] || null,
    heroImage: resolvedImageUrls[0] || null,
    thumbnailUrl: row.thumbnail_url || resolvedImageUrls[0] || null,
    videoUrl: row.video_url,
    videoThumbnailUrl: row.video_thumbnail_url,
    virtualTourUrl: row.virtual_tour_url,
    
    // Trip Details
    duration: row.duration_display || formatDurationDisplay(row.duration_days, row.duration_nights),
    durationDays: toNumber(row.duration_days),
    durationNights: toNumber(row.duration_nights),
    groupSize: row.group_size_display || formatGroupSizeDisplay(row.min_group_size, row.max_group_size),
    minGroupSize: toNumber(row.min_group_size, 1),
    maxGroupSize: toNumber(row.max_group_size, 20),
    minAge: toNumber(row.min_age, 0),
    maxAge: toNumber(row.max_age),
    fitnessLevel: row.fitness_level,
    
    // Pricing
    price: toNumber(row.starting_price),
    startingPrice: toNumber(row.starting_price),
    originalPrice: toNumber(row.original_price),
    currency: row.currency || 'USD',
    pricingType: row.pricing_type,
    priceIncludes: row.price_includes,
    priceExcludes: row.price_excludes,
    depositPercentage: toNumber(row.deposit_percentage, 20),
    cancellationPolicy: row.cancellation_policy,
    hasDiscount: row.original_price && row.starting_price < row.original_price,
    discountPercentage: row.original_price && row.starting_price < row.original_price
      ? Math.round(((row.original_price - row.starting_price) / row.original_price) * 100)
      : 0,
    
    // Ratings & Reviews
    rating: toNumber(row.rating, 0),
    ratingCount: toNumber(row.rating_count, 0),
    reviewCount: toNumber(row.review_count, 0),
    
    // Statistics
    viewCount: toNumber(row.view_count, 0),
    bookingCount: toNumber(row.booking_count, 0),
    wishlistCount: toNumber(row.wishlist_count, 0),
    shareCount: toNumber(row.share_count, 0),
    
    // Availability
    totalSpots: toNumber(row.total_spots),
    spotsLeft: toNumber(row.spots_left),
    isSoldOut: toBoolean(row.is_sold_out),
    nextAvailableDate: row.next_available_date,
    bookingDeadlineDays: toNumber(row.booking_deadline_days, 3),
    
    // Features & Highlights
    highlights: row.highlights || [],
    features: row.features || [],
    activities: row.activities || [],
    wildlife: row.wildlife || [],
    accommodations: row.accommodations || [],
    mealsIncluded: row.meals_included || [],
    
    // Status & Visibility
    status: row.status,
    isActive: toBoolean(row.is_active),
    isFeatured: toBoolean(row.is_featured),
    isPopular: toBoolean(row.is_popular),
    isNew: toBoolean(row.is_new),
    isEcoFriendly: toBoolean(row.is_eco_friendly),
    isFamilyFriendly: toBoolean(row.is_family_friendly),
    isWheelchairAccessible: toBoolean(row.is_wheelchair_accessible),
    
    // SEO
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    metaKeywords: row.meta_keywords || [],
    canonicalUrl: row.canonical_url,
    
    // Timestamps
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    featuredAt: row.featured_at,
  };

  // Include relations if requested
  if (includeRelations) {
    destination.images = row.gallery_images || [];
    destination.pricing = row.pricing || [];
    destination.itinerary = row.itinerary || [];
    destination.seasons = row.seasons || [];
    destination.inclusions = row.inclusions || [];
    destination.exclusions = row.exclusions || [];
    destination.faqs = row.faqs || [];
    destination.reviews = row.reviews || [];
    destination.tags = row.tags || [];
  }

  return destination;
};

/**
 * Serialize image row for API response
 */
const serializeImage = (row) => ({
  id: row.id,
  uuid: row.uuid,
  destinationId: row.destination_id,
  imageUrl: row.image_url,
  thumbnailUrl: row.thumbnail_url,
  mediumUrl: row.medium_url,
  largeUrl: row.large_url,
  caption: row.caption,
  altText: row.alt_text,
  credit: row.credit,
  imageType: row.image_type,
  category: row.category,
  isPrimary: toBoolean(row.is_primary),
  sortOrder: row.sort_order,
  width: row.width,
  height: row.height,
  fileSizeKb: row.file_size_kb,
  format: row.format,
  isActive: toBoolean(row.is_active),
  createdAt: row.created_at,
});

/**
 * Serialize review row for API response
 */
const serializeReview = (row) => ({
  id: row.id,
  uuid: row.uuid,
  reviewerName: row.reviewer_name,
  reviewerAvatar: row.reviewer_avatar,
  reviewerCountry: row.reviewer_country,
  title: row.title,
  content: row.content,
  overallRating: toNumber(row.overall_rating),
  valueRating: toNumber(row.value_rating),
  serviceRating: toNumber(row.service_rating),
  accommodationRating: toNumber(row.accommodation_rating),
  guideRating: toNumber(row.guide_rating),
  tripDate: row.trip_date,
  tripType: row.trip_type,
  images: row.images || [],
  isVerified: toBoolean(row.is_verified),
  isFeatured: toBoolean(row.is_featured),
  helpfulCount: toNumber(row.helpful_count, 0),
  responseContent: row.response_content,
  responseDate: row.response_date,
  createdAt: row.created_at,
});

/* ===================================================================
   QUERY BUILDERS
   =================================================================== */

/**
 * Build WHERE clause for destination queries
 */
const buildWhereClause = async (filters) => {
  const conditions = ["d.is_active = true"];
  const params = [];
  let idx = 1;

  // Status filter
  if (filters.status) {
    conditions.push(`d.status = $${idx++}`);
    params.push(filters.status);
  } else {
    conditions.push(`d.status = 'published'`);
  }

  // Category filter
  if (filters.category) {
    conditions.push(`d.category = $${idx++}`);
    params.push(filters.category);
  }

  // Country filter
  if (filters.country_id || filters.country) {
    const countryIdOrSlug = filters.country_id || filters.country;
    const resolvedCountryId = await resolveCountryDbId(countryIdOrSlug);
    if (resolvedCountryId) {
      conditions.push(`d.country_id = $${idx++}`);
      params.push(resolvedCountryId);
    } else {
      // No matching country - return empty results
      conditions.push("1 = 0");
    }
  }

  // Difficulty filter
  if (filters.difficulty) {
    conditions.push(`d.difficulty = $${idx++}`);
    params.push(filters.difficulty);
  }

  // Rating filter
  if (filters.min_rating) {
    conditions.push(`d.rating >= $${idx++}`);
    params.push(parseFloat(filters.min_rating));
  }

  // Price range filters
  if (filters.min_price) {
    conditions.push(`d.starting_price >= $${idx++}`);
    params.push(parseFloat(filters.min_price));
  }
  if (filters.max_price) {
    conditions.push(`d.starting_price <= $${idx++}`);
    params.push(parseFloat(filters.max_price));
  }

  // Duration filter
  if (filters.min_duration) {
    conditions.push(`d.duration_days >= $${idx++}`);
    params.push(parseInt(filters.min_duration));
  }
  if (filters.max_duration) {
    conditions.push(`d.duration_days <= $${idx++}`);
    params.push(parseInt(filters.max_duration));
  }

  // Featured filter
  if (filters.featured !== undefined) {
    conditions.push(`d.is_featured = $${idx++}`);
    params.push(toBoolean(filters.featured));
  }

  // Popular filter
  if (filters.popular !== undefined) {
    conditions.push(`d.is_popular = $${idx++}`);
    params.push(toBoolean(filters.popular));
  }

  // Eco-friendly filter
  if (filters.eco_friendly !== undefined) {
    conditions.push(`d.is_eco_friendly = $${idx++}`);
    params.push(toBoolean(filters.eco_friendly));
  }

  // Family-friendly filter
  if (filters.family_friendly !== undefined) {
    conditions.push(`d.is_family_friendly = $${idx++}`);
    params.push(toBoolean(filters.family_friendly));
  }

  // Search filter (full-text search)
  if (filters.search) {
    const searchTerms = filters.search.trim().split(/\s+/).join(' & ');
    conditions.push(`
      (to_tsvector('english', COALESCE(d.name, '') || ' ' || COALESCE(d.description, '') || ' ' || COALESCE(d.short_description, '')) 
      @@ to_tsquery('english', $${idx}::text)
      OR d.name ILIKE $${idx + 1}
      OR d.description ILIKE $${idx + 1})
    `);
    params.push(searchTerms);
    params.push(`%${filters.search}%`);
    idx += 2;
  }

  // Tag filter
  if (filters.tag) {
    conditions.push(`
      EXISTS (
        SELECT 1 FROM destination_tags dt 
        WHERE dt.destination_id = d.id 
        AND dt.tag_slug = $${idx++}
      )
    `);
    params.push(filters.tag.toLowerCase());
  }

  // Availability filter
  if (filters.available !== undefined && toBoolean(filters.available)) {
    conditions.push(`(d.spots_left > 0 OR d.spots_left IS NULL)`);
    conditions.push(`d.is_sold_out = false`);
  }

  return { where: `WHERE ${conditions.join(" AND ")}`, params, nextIdx: idx };
};

/**
 * Build ORDER BY clause for destination queries
 */
const buildOrderClause = (sort) => {
  const sortMap = {
    name: "d.name ASC",
    "-name": "d.name DESC",
    rating: "d.rating DESC NULLS LAST",
    "-rating": "d.rating ASC",
    price: "d.starting_price ASC NULLS LAST",
    "-price": "d.starting_price DESC NULLS LAST",
    created: "d.created_at DESC",
    "-created": "d.created_at ASC",
    updated: "d.updated_at DESC",
    views: "d.view_count DESC",
    bookings: "d.booking_count DESC",
    "-featured": "d.is_featured DESC, d.is_popular DESC, d.rating DESC NULLS LAST",
    popular: "d.booking_count DESC, d.view_count DESC, d.rating DESC NULLS LAST",
    recommended: "d.is_featured DESC, d.rating DESC NULLS LAST, d.review_count DESC",
    newest: "d.published_at DESC NULLS LAST, d.created_at DESC",
    duration: "d.duration_days ASC NULLS LAST",
    "-duration": "d.duration_days DESC NULLS LAST",
  };

  return sortMap[sort] || sortMap["-featured"];
};

/* ===================================================================
   CONTROLLER METHODS
   =================================================================== */

/**
 * Get all destinations with filtering, sorting, and pagination
 * GET /api/destinations
 */
exports.getAll = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 12,
      sort = "-featured",
      ...filters
    } = req.query;

    // Build query
    const { where, params, nextIdx } = await buildWhereClause(filters);
    const orderBy = buildOrderClause(sort);

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM destinations d ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);
    const pagination = paginate(total, page, limit);

    // Get destinations
        // Get destinations
    const destinationsResult = await query(
      `SELECT 
        d.*,
        c.name AS country_name,
        c.slug AS country_slug,
        c.flag_url AS country_flag
       FROM destinations d
       LEFT JOIN countries c ON d.country_id = c.id
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      [...params, pagination.limit, pagination.offset]
    );

    // Serialize results
    const destinations = destinationsResult.rows.map((row) =>
      serializeDestination(row)
    );

    res.json({
      success: true,
      data: destinations,
      pagination,
      meta: {
        sort,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get featured destinations
 * GET /api/destinations/featured
 */
exports.getFeatured = async (req, res, next) => {
  try {
    const { limit = 8 } = req.query;

    const result = await query(
      `SELECT 
        d.*,
        c.name AS country_name,
        c.slug AS country_slug,
        c.flag_url AS country_flag
       FROM destinations d
       LEFT JOIN countries c ON d.country_id = c.id
       WHERE d.is_featured = true 
         AND d.is_active = true 
         AND d.status = 'published'
       ORDER BY d.featured_at DESC NULLS LAST, d.rating DESC NULLS LAST
       LIMIT $1`,
      [parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => serializeDestination(row)),
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get popular destinations
 * GET /api/destinations/popular
 */
exports.getPopular = async (req, res, next) => {
  try {
    const { limit = 8 } = req.query;

    const result = await query(
      `SELECT 
        d.*,
        c.name AS country_name,
        c.slug AS country_slug,
        c.flag_url AS country_flag
       FROM destinations d
       LEFT JOIN countries c ON d.country_id = c.id
       WHERE d.is_active = true 
         AND d.status = 'published'
       ORDER BY d.booking_count DESC, d.view_count DESC, d.rating DESC NULLS LAST
       LIMIT $1`,
      [parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => serializeDestination(row)),
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get new destinations
 * GET /api/destinations/new
 */
exports.getNew = async (req, res, next) => {
  try {
    const { limit = 8, days = 30 } = req.query;

    const result = await query(
      `SELECT 
        d.*,
        c.name AS country_name,
        c.slug AS country_slug,
        c.flag_url AS country_flag
       FROM destinations d
       LEFT JOIN countries c ON d.country_id = c.id
       WHERE d.is_active = true 
         AND d.status = 'published'
         AND (d.is_new = true OR d.published_at >= NOW() - INTERVAL '${parseInt(days)} days')
       ORDER BY d.published_at DESC NULLS LAST, d.created_at DESC
       LIMIT $1`,
      [parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => serializeDestination(row)),
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get destination categories with counts
 * GET /api/destinations/categories
 */
exports.getCategories = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT 
        category,
        COUNT(*) AS count,
        AVG(rating) AS avg_rating,
        MIN(starting_price) AS min_price,
        MAX(starting_price) AS max_price
       FROM destinations 
       WHERE is_active = true 
         AND status = 'published' 
         AND category IS NOT NULL
       GROUP BY category 
       ORDER BY count DESC`
    );

    const categories = result.rows.map((row) => ({
      name: row.category,
      displayName: row.category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      count: parseInt(row.count),
      avgRating: toNumber(row.avg_rating),
      priceRange: {
        min: toNumber(row.min_price),
        max: toNumber(row.max_price),
      },
    }));

    res.json({
      success: true,
      data: categories,
      count: categories.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get difficulty levels with counts
 * GET /api/destinations/difficulties
 */
exports.getDifficulties = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT 
        difficulty,
        COUNT(*) AS count
       FROM destinations 
       WHERE is_active = true 
         AND status = 'published' 
         AND difficulty IS NOT NULL
       GROUP BY difficulty 
       ORDER BY 
         CASE difficulty
           WHEN 'easy' THEN 1
           WHEN 'moderate' THEN 2
           WHEN 'challenging' THEN 3
           WHEN 'difficult' THEN 4
           WHEN 'expert' THEN 5
         END`
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        level: row.difficulty,
        displayName: row.difficulty.charAt(0).toUpperCase() + row.difficulty.slice(1),
        count: parseInt(row.count),
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get map data for all destinations
 * GET /api/destinations/map
 */
exports.getMapData = async (req, res, next) => {
  try {
    const { country_id, category, bounds } = req.query;

    let where = "WHERE d.is_active = true AND d.status = 'published' AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL";
    const params = [];
    let idx = 1;

    if (country_id) {
      const resolvedCountryId = await resolveCountryDbId(country_id);
      if (resolvedCountryId) {
        where += ` AND d.country_id = $${idx++}`;
        params.push(resolvedCountryId);
      }
    }

    if (category) {
      where += ` AND d.category = $${idx++}`;
      params.push(category);
    }

    // Bounding box filter for map viewport
    if (bounds) {
      try {
        const [swLat, swLng, neLat, neLng] = bounds.split(',').map(Number);
        if ([swLat, swLng, neLat, neLng].every(Number.isFinite)) {
          where += ` AND d.latitude BETWEEN $${idx} AND $${idx + 1}`;
          where += ` AND d.longitude BETWEEN $${idx + 2} AND $${idx + 3}`;
          params.push(swLat, neLat, swLng, neLng);
          idx += 4;
        }
      } catch (e) {
        // Invalid bounds format, ignore
      }
    }

    const result = await query(
      `SELECT 
        d.id,
        d.uuid,
        d.name,
        d.slug,
        d.latitude,
        d.longitude,
        d.category,
        d.difficulty,
        d.image_url,
        d.image_urls,
        d.short_description,
        d.rating,
        d.review_count,
        d.starting_price,
        d.currency,
        d.is_featured,
        d.is_popular,
        c.name AS country_name,
        c.slug AS country_slug
       FROM destinations d
       LEFT JOIN countries c ON d.country_id = c.id
       ${where}
       ORDER BY d.is_featured DESC, d.rating DESC NULLS LAST`,
      params
    );

    const mapData = result.rows.map((row) => ({
      id: row.id,
      uuid: row.uuid,
      name: row.name,
      slug: row.slug,
      position: {
        lat: toNumber(row.latitude),
        lng: toNumber(row.longitude),
      },
      category: row.category,
      difficulty: row.difficulty,
      imageUrl: normalizeImageUrls(row.image_urls)[0] || row.image_url,
      shortDescription: row.short_description,
      rating: toNumber(row.rating),
      reviewCount: toNumber(row.review_count),
      price: toNumber(row.starting_price),
      currency: row.currency || 'USD',
      isFeatured: toBoolean(row.is_featured),
      isPopular: toBoolean(row.is_popular),
      country: row.country_name,
      countrySlug: row.country_slug,
    }));

    res.json({
      success: true,
      data: mapData,
      count: mapData.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get search suggestions (autocomplete)
 * GET /api/destinations/suggestions
 */
exports.getSuggestions = async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const result = await query(
      `SELECT 
        d.id,
        d.name,
        d.slug,
        d.category,
        d.image_url,
        c.name AS country_name
       FROM destinations d
       LEFT JOIN countries c ON d.country_id = c.id
       WHERE d.is_active = true 
         AND d.status = 'published'
         AND (d.name ILIKE $1 OR c.name ILIKE $1)
       ORDER BY 
         CASE WHEN d.name ILIKE $2 THEN 0 ELSE 1 END,
         d.is_featured DESC,
         d.rating DESC NULLS LAST
       LIMIT $3`,
      [`%${q}%`, `${q}%`, parseInt(limit)]
    );

    const suggestions = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: row.category,
      imageUrl: row.image_url,
      country: row.country_name,
      type: 'destination',
    }));

    res.json({
      success: true,
      data: suggestions,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get tags with counts
 * GET /api/destinations/tags
 */
exports.getTags = async (req, res, next) => {
  try {
    const { category: tagCategory, limit = 50 } = req.query;

    let where = "";
    const params = [];

    if (tagCategory) {
      where = "WHERE dt.tag_category = $1";
      params.push(tagCategory);
    }

    const result = await query(
      `SELECT 
        dt.tag_name,
        dt.tag_slug,
        dt.tag_category,
        COUNT(DISTINCT dt.destination_id) AS count
       FROM destination_tags dt
       INNER JOIN destinations d ON dt.destination_id = d.id
       WHERE d.is_active = true AND d.status = 'published'
       ${where ? `AND ${where.replace('WHERE ', '')}` : ''}
       GROUP BY dt.tag_name, dt.tag_slug, dt.tag_category
       ORDER BY count DESC
       LIMIT $${params.length + 1}`,
      [...params, parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        name: row.tag_name,
        slug: row.tag_slug,
        category: row.tag_category,
        count: parseInt(row.count),
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get single destination by ID or slug
 * GET /api/destinations/:idOrSlug
 */
exports.getOne = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const { include } = req.query; // comma-separated list: images,pricing,itinerary,seasons,inclusions,exclusions,faqs,reviews,tags
    
    const isNumeric = /^\d+$/.test(idOrSlug);
    const column = isNumeric ? "d.id" : "d.slug";
    const value = isNumeric ? parseInt(idOrSlug) : idOrSlug.toLowerCase();

    // Get main destination
    const result = await query(
      `SELECT 
        d.*,
        c.name AS country_name,
        c.slug AS country_slug,
        c.flag_url AS country_flag,
        c.currency AS country_currency
       FROM destinations d
       LEFT JOIN countries c ON d.country_id = c.id
       WHERE ${column} = $1 AND d.is_active = true`,
      [value]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Destination not found",
        code: "DESTINATION_NOT_FOUND",
      });
    }

    const destinationRow = result.rows[0];
    const destinationId = destinationRow.id;

    // Increment view count (async, don't wait)
    query(
      "UPDATE destinations SET view_count = view_count + 1 WHERE id = $1",
      [destinationId]
    ).catch(() => {}); // Ignore errors

    // Build response with optional includes
    const includeList = include ? include.split(',').map((s) => s.trim().toLowerCase()) : [];
    const includeAll = includeList.includes('all');

    const destination = serializeDestination(destinationRow);

    // Fetch related data based on includes
    const fetchPromises = [];

    // Images
    if (includeAll || includeList.includes('images')) {
      fetchPromises.push(
        query(
          `SELECT * FROM destination_images 
           WHERE destination_id = $1 AND is_active = true 
           ORDER BY is_primary DESC, sort_order ASC`,
          [destinationId]
        ).then((r) => {
          destination.gallery = r.rows.map(serializeImage);
        })
      );
    }

    // Pricing
    if (includeAll || includeList.includes('pricing')) {
      fetchPromises.push(
        query(
          `SELECT * FROM destination_pricing 
           WHERE destination_id = $1 AND is_active = true 
           ORDER BY sort_order ASC`,
          [destinationId]
        ).then((r) => {
          destination.pricing = r.rows.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            price: toNumber(row.price),
            originalPrice: toNumber(row.original_price),
            currency: row.currency || 'USD',
            pricingType: row.pricing_type,
            minPersons: toNumber(row.min_persons),
            maxPersons: toNumber(row.max_persons),
            validFrom: row.valid_from,
            validUntil: row.valid_until,
            seasonType: row.season_type,
          }));
        })
      );
    }

    // Itinerary
    if (includeAll || includeList.includes('itinerary')) {
      fetchPromises.push(
        query(
          `SELECT * FROM destination_itineraries 
           WHERE destination_id = $1 AND is_active = true 
           ORDER BY day_number ASC, sort_order ASC`,
          [destinationId]
        ).then((r) => {
          destination.itinerary = r.rows.map((row) => ({
            id: row.id,
            dayNumber: row.day_number,
            title: row.title,
            subtitle: row.subtitle,
            description: row.description,
            activities: row.activities || [],
            highlights: row.highlights || [],
            meals: row.meals || [],
            accommodation: row.accommodation,
            startLocation: row.start_location,
            endLocation: row.end_location,
            distanceKm: toNumber(row.distance_km),
            drivingTime: row.driving_time,
            imageUrl: row.image_url,
          }));
        })
      );
    }

    // Seasons
    if (includeAll || includeList.includes('seasons')) {
      fetchPromises.push(
        query(
          `SELECT * FROM destination_seasons 
           WHERE destination_id = $1 AND is_active = true 
           ORDER BY sort_order ASC, start_month ASC`,
          [destinationId]
        ).then((r) => {
          destination.seasons = r.rows.map((row) => ({
            id: row.id,
            name: row.name,
            seasonType: row.season_type,
            description: row.description,
            startMonth: row.start_month,
            endMonth: row.end_month,
            weatherDescription: row.weather_description,
            avgTemperatureCelsius: toNumber(row.avg_temperature_celsius),
            rainfallMm: toNumber(row.rainfall_mm),
            wildlifeHighlights: row.wildlife_highlights || [],
            isRecommended: toBoolean(row.is_recommended),
            crowdLevel: row.crowd_level,
          }));
        })
      );
    }

    // Inclusions
    if (includeAll || includeList.includes('inclusions')) {
      fetchPromises.push(
        query(
          `SELECT * FROM destination_inclusions 
           WHERE destination_id = $1 AND is_active = true 
           ORDER BY sort_order ASC`,
          [destinationId]
        ).then((r) => {
          destination.inclusions = r.rows.map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description,
            icon: row.icon,
            category: row.category,
          }));
        })
      );
    }

    // Exclusions
    if (includeAll || includeList.includes('exclusions')) {
      fetchPromises.push(
        query(
          `SELECT * FROM destination_exclusions 
           WHERE destination_id = $1 AND is_active = true 
           ORDER BY sort_order ASC`,
          [destinationId]
        ).then((r) => {
          destination.exclusions = r.rows.map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description,
            icon: row.icon,
          }));
        })
      );
    }

    // FAQs
    if (includeAll || includeList.includes('faqs')) {
      fetchPromises.push(
        query(
          `SELECT * FROM destination_faqs 
           WHERE destination_id = $1 AND is_active = true 
           ORDER BY sort_order ASC`,
          [destinationId]
        ).then((r) => {
          destination.faqs = r.rows.map((row) => ({
            id: row.id,
            question: row.question,
            answer: row.answer,
            category: row.category,
            helpfulCount: toNumber(row.helpful_count),
          }));
        })
      );
    }

    // Reviews
    if (includeAll || includeList.includes('reviews')) {
      fetchPromises.push(
        query(
          `SELECT * FROM destination_reviews 
           WHERE destination_id = $1 AND status = 'approved' 
           ORDER BY is_featured DESC, created_at DESC
           LIMIT 10`,
          [destinationId]
        ).then((r) => {
          destination.reviews = r.rows.map(serializeReview);
        })
      );
    }

    // Tags
    if (includeAll || includeList.includes('tags')) {
      fetchPromises.push(
        query(
          `SELECT * FROM destination_tags 
           WHERE destination_id = $1 
           ORDER BY tag_category, tag_name`,
          [destinationId]
        ).then((r) => {
          destination.tags = r.rows.map((row) => ({
            name: row.tag_name,
            slug: row.tag_slug,
            category: row.tag_category,
          }));
        })
      );
    }

    // Related destinations
    if (includeAll || includeList.includes('related')) {
      fetchPromises.push(
        query(
          `SELECT 
            d.id, d.uuid, d.name, d.slug, d.short_description,
            d.image_url, d.image_urls, d.rating, d.starting_price,
            d.duration_display, d.category,
            c.name AS country_name
           FROM destinations d
           LEFT JOIN countries c ON d.country_id = c.id
           WHERE d.id != $1 
             AND d.is_active = true 
             AND d.status = 'published'
             AND (d.country_id = $2 OR d.category = $3)
           ORDER BY 
             CASE WHEN d.country_id = $2 AND d.category = $3 THEN 0
                  WHEN d.category = $3 THEN 1
                  WHEN d.country_id = $2 THEN 2
                  ELSE 3 END,
             d.rating DESC NULLS LAST
           LIMIT 4`,
          [destinationId, destinationRow.country_id, destinationRow.category]
        ).then((r) => {
          destination.related = r.rows.map((row) => ({
            id: row.id,
            uuid: row.uuid,
            name: row.name,
            slug: row.slug,
            shortDescription: row.short_description,
            imageUrl: normalizeImageUrls(row.image_urls)[0] || row.image_url,
            rating: toNumber(row.rating),
            price: toNumber(row.starting_price),
            duration: row.duration_display,
            category: row.category,
            country: row.country_name,
          }));
        })
      );
    }

    // Wait for all includes to complete
    await Promise.all(fetchPromises);

    // If no gallery images from DB, use image_urls array
    if (!destination.gallery || destination.gallery.length === 0) {
      destination.gallery = destination.images.map((imageUrl, index) => ({
        id: `fallback-${destinationId}-${index + 1}`,
        destinationId,
        imageUrl,
        thumbnailUrl: imageUrl,
        caption: `${destination.name} image ${index + 1}`,
        isPrimary: index === 0,
        sortOrder: index + 1,
        isActive: true,
      }));
    }

    res.json({
      success: true,
      data: destination,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get related destinations
 * GET /api/destinations/:idOrSlug/related
 */
exports.getRelated = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const { limit = 4 } = req.query;

    const isNumeric = /^\d+$/.test(idOrSlug);
    const column = isNumeric ? "id" : "slug";
    const value = isNumeric ? parseInt(idOrSlug) : idOrSlug.toLowerCase();

    // Get source destination
    const sourceResult = await query(
      `SELECT id, country_id, category FROM destinations WHERE ${column} = $1`,
      [value]
    );

    if (sourceResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Destination not found",
      });
    }

    const source = sourceResult.rows[0];

    // Get related destinations
    const result = await query(
      `SELECT 
        d.*,
        c.name AS country_name,
        c.slug AS country_slug
       FROM destinations d
       LEFT JOIN countries c ON d.country_id = c.id
       WHERE d.id != $1 
         AND d.is_active = true 
         AND d.status = 'published'
         AND (d.country_id = $2 OR d.category = $3)
       ORDER BY 
         CASE WHEN d.country_id = $2 AND d.category = $3 THEN 0
              WHEN d.category = $3 THEN 1
              WHEN d.country_id = $2 THEN 2
              ELSE 3 END,
         d.is_featured DESC,
         d.rating DESC NULLS LAST
       LIMIT $4`,
      [source.id, source.country_id, source.category, parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => serializeDestination(row)),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new destination
 * POST /api/destinations
 */
exports.create = async (req, res, next) => {
  try {
    const {
      country_id,
      name,
      tagline,
      short_description,
      description,
      overview,
      what_to_expect,
      best_time_to_visit,
      getting_there,
      local_tips,
      safety_info,
      category,
      sub_category,
      difficulty,
      latitude,
      longitude,
      altitude_meters,
      address,
      region,
      nearest_city,
      nearest_airport,
      distance_from_airport_km,
      video_url,
      virtual_tour_url,
      duration_days,
      duration_nights,
      min_group_size,
      max_group_size,
      min_age,
      max_age,
      fitness_level,
      starting_price,
      original_price,
      currency,
      pricing_type,
      price_includes,
      price_excludes,
      deposit_percentage,
      cancellation_policy,
      total_spots,
      booking_deadline_days,
      highlights,
      features,
      activities,
      wildlife,
      accommodations,
      meals_included,
      status,
      is_featured,
      is_popular,
      is_new,
      is_eco_friendly,
      is_family_friendly,
      is_wheelchair_accessible,
      meta_title,
      meta_description,
      meta_keywords,
    } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: "Name is required",
        code: "VALIDATION_ERROR",
      });
    }

    if (!country_id) {
      return res.status(400).json({
        success: false,
        error: "Country ID is required. Every destination must belong to a country.",
        code: "VALIDATION_ERROR",
      });
    }

    // Resolve country
    const resolvedCountryId = await resolveCountryDbId(country_id);
    if (!resolvedCountryId) {
      return res.status(400).json({
        success: false,
        error: "Invalid country_id. Country not found or inactive.",
        code: "INVALID_COUNTRY",
      });
    }

    // Generate slug
    const slug = slugify(name);

    // Check for duplicate slug
    const existingSlug = await query(
      "SELECT id FROM destinations WHERE slug = $1",
      [slug]
    );
    if (existingSlug.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: "A destination with this name already exists",
        code: "DUPLICATE_SLUG",
      });
    }

    // Handle image uploads
    const uploadedImage = req.file ? getUploadedFileUrl(req.file) : null;
    const bodyImageUrls = normalizeImageUrls(req.body.image_urls);
    let imageUrls = uploadedImage
      ? [uploadedImage, ...bodyImageUrls.filter((url) => url !== uploadedImage)]
      : bodyImageUrls;
    
    if (!imageUrls.length && req.body.image_url) {
      imageUrls = [req.body.image_url];
    }
    const imageUrl = imageUrls[0] || null;

    // Calculate duration display
    const durationDisplay = formatDurationDisplay(
      toNumber(duration_days),
      toNumber(duration_nights)
    );

    // Calculate group size display
    const groupSizeDisplay = formatGroupSizeDisplay(
      toNumber(min_group_size),
      toNumber(max_group_size)
    );

    // Determine published_at
    const publishStatus = status || 'draft';
    const publishedAt = publishStatus === 'published' ? new Date() : null;
    const featuredAt = toBoolean(is_featured) ? new Date() : null;

    // Insert destination
    const result = await query(
      `INSERT INTO destinations (
        country_id, name, slug, tagline, short_description, description,
        overview, what_to_expect, best_time_to_visit, getting_there, local_tips, safety_info,
        category, sub_category, difficulty,
        latitude, longitude, altitude_meters, address, region, nearest_city, nearest_airport, distance_from_airport_km,
        image_url, image_urls, video_url, virtual_tour_url,
        duration_days, duration_nights, duration_display,
        min_group_size, max_group_size, group_size_display, min_age, max_age, fitness_level,
        starting_price, original_price, currency, pricing_type, price_includes, price_excludes,
        deposit_percentage, cancellation_policy,
        total_spots, spots_left, booking_deadline_days,
        highlights, features, activities, wildlife, accommodations, meals_included,
        status, is_featured, is_popular, is_new, is_eco_friendly, is_family_friendly, is_wheelchair_accessible,
        meta_title, meta_description, meta_keywords,
        published_at, featured_at, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23,
        $24, $25, $26, $27,
        $28, $29, $30,
        $31, $32, $33, $34, $35, $36,
        $37, $38, $39, $40, $41, $42,
        $43, $44,
        $45, $46, $47,
        $48, $49, $50, $51, $52, $53,
        $54, $55, $56, $57, $58, $59, $60,
        $61, $62, $63,
        $64, $65, $66
      ) RETURNING *`,
      [
        resolvedCountryId,
        name.trim(),
        slug,
        tagline,
        short_description,
        description,
        overview,
        what_to_expect,
        best_time_to_visit,
        getting_there,
        local_tips,
        safety_info,
        category || 'safari',
        sub_category,
        difficulty || 'moderate',
        toNumber(latitude),
        toNumber(longitude),
        toNumber(altitude_meters),
        address,
        region,
        nearest_city,
        nearest_airport,
        toNumber(distance_from_airport_km),
        imageUrl,
        imageUrls,
        video_url,
        virtual_tour_url,
        toNumber(duration_days),
        toNumber(duration_nights),
        durationDisplay,
        toNumber(min_group_size, 1),
        toNumber(max_group_size, 20),
        groupSizeDisplay,
        toNumber(min_age, 0),
        toNumber(max_age),
        fitness_level,
        toNumber(starting_price),
        toNumber(original_price),
        currency || 'USD',
        pricing_type || 'per_person',
        price_includes,
        price_excludes,
        toNumber(deposit_percentage, 20),
        cancellation_policy,
        toNumber(total_spots),
        toNumber(total_spots), // spots_left starts equal to total
        toNumber(booking_deadline_days, 3),
        normalizeArrayField(highlights),
        normalizeArrayField(features),
        normalizeArrayField(activities),
        normalizeArrayField(wildlife),
        normalizeArrayField(accommodations),
        normalizeArrayField(meals_included),
        publishStatus,
        toBoolean(is_featured),
        toBoolean(is_popular),
        toBoolean(is_new),
        toBoolean(is_eco_friendly),
        toBoolean(is_family_friendly),
        toBoolean(is_wheelchair_accessible),
        meta_title || name.trim(),
        meta_description || short_description,
        normalizeArrayField(meta_keywords),
        publishedAt,
        featuredAt,
        req.user?.id || null,
      ]
    );

    // Update country destination count
    await query(
      `UPDATE countries SET destination_count = (
         SELECT COUNT(*) FROM destinations WHERE country_id = $1 AND is_active = true
       ) WHERE id = $1`,
      [resolvedCountryId]
    );

    // Fetch country info for response
    const countryResult = await query(
      "SELECT name, slug FROM countries WHERE id = $1",
      [resolvedCountryId]
    );

    const destinationRow = {
      ...result.rows[0],
      country_name: countryResult.rows[0]?.name,
      country_slug: countryResult.rows[0]?.slug,
    };

    res.status(201).json({
      success: true,
      message: "Destination created successfully",
      data: serializeDestination(destinationRow),
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "A destination with this name already exists",
        code: "DUPLICATE_ENTRY",
      });
    }
    next(err);
  }
};

/**
 * Update a destination
 * PUT /api/destinations/:id
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if destination exists
    const existingResult = await query(
      "SELECT * FROM destinations WHERE id = $1",
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Destination not found",
        code: "DESTINATION_NOT_FOUND",
      });
    }

    const existing = existingResult.rows[0];
    const fields = { ...req.body };

    // Handle name change -> update slug
    if (fields.name && fields.name !== existing.name) {
      fields.slug = slugify(fields.name);
      
      // Check for duplicate slug
      const duplicateSlug = await query(
        "SELECT id FROM destinations WHERE slug = $1 AND id != $2",
        [fields.slug, id]
      );
      if (duplicateSlug.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: "A destination with this name already exists",
          code: "DUPLICATE_SLUG",
        });
      }
    }

    // Handle image upload
    if (req.file) {
      const uploadedImage = getUploadedFileUrl(req.file);
      fields.image_url = uploadedImage;
      const inputUrls = normalizeImageUrls(fields.image_urls);
      fields.image_urls = [uploadedImage, ...inputUrls.filter((url) => url !== uploadedImage)];
    } else if (Object.prototype.hasOwnProperty.call(fields, "image_urls")) {
      fields.image_urls = normalizeImageUrls(fields.image_urls);
      fields.image_url = fields.image_urls[0] || existing.image_url;
    }

    // Handle country change
    if (Object.prototype.hasOwnProperty.call(fields, "country_id")) {
      if (!fields.country_id) {
        return res.status(400).json({
          success: false,
          error: "Country ID cannot be empty",
          code: "VALIDATION_ERROR",
        });
      }
      const resolvedCountryId = await resolveCountryDbId(fields.country_id);
      if (!resolvedCountryId) {
        return res.status(400).json({
          success: false,
          error: "Invalid country_id. Country not found or inactive.",
          code: "INVALID_COUNTRY",
        });
      }
      fields.country_id = resolvedCountryId;
    }

    // Handle array fields
    const arrayFields = [
      'highlights', 'features', 'activities', 'wildlife',
      'accommodations', 'meals_included', 'meta_keywords'
    ];
    arrayFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(fields, field)) {
        fields[field] = normalizeArrayField(fields[field]);
      }
    });

    // Handle duration display
    if (fields.duration_days || fields.duration_nights) {
      fields.duration_display = formatDurationDisplay(
        toNumber(fields.duration_days ?? existing.duration_days),
        toNumber(fields.duration_nights ?? existing.duration_nights)
      );
    }

    // Handle group size display
    if (fields.min_group_size || fields.max_group_size) {
      fields.group_size_display = formatGroupSizeDisplay(
        toNumber(fields.min_group_size ?? existing.min_group_size),
        toNumber(fields.max_group_size ?? existing.max_group_size)
      );
    }

    // Handle status change to published
    if (fields.status === 'published' && existing.status !== 'published') {
      fields.published_at = new Date();
    }

    // Handle featured change
    if (fields.is_featured === true && !existing.is_featured) {
      fields.featured_at = new Date();
    } else if (fields.is_featured === false) {
      fields.featured_at = null;
    }

    // Add updated_by
    fields.updated_by = req.user?.id || null;

    // Remove undefined/null fields that shouldn't overwrite existing values
    Object.keys(fields).forEach((key) => {
      if (fields[key] === undefined) {
        delete fields[key];
      }
    });

    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No fields to update",
        code: "NO_FIELDS",
      });
    }

    // Build update query
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), id];

    const result = await query(
      `UPDATE destinations SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );

    // Update country destination counts if country changed
    if (fields.country_id && fields.country_id !== existing.country_id) {
      // Update old country count
      await query(
        `UPDATE countries SET destination_count = (
           SELECT COUNT(*) FROM destinations WHERE country_id = $1 AND is_active = true
         ) WHERE id = $1`,
        [existing.country_id]
      );
      // Update new country count
      await query(
        `UPDATE countries SET destination_count = (
           SELECT COUNT(*) FROM destinations WHERE country_id = $1 AND is_active = true
         ) WHERE id = $1`,
        [fields.country_id]
      );
    }

    // Fetch country info for response
    const countryResult = await query(
      "SELECT name, slug FROM countries WHERE id = $1",
      [result.rows[0].country_id]
    );

    const destinationRow = {
      ...result.rows[0],
      country_name: countryResult.rows[0]?.name,
      country_slug: countryResult.rows[0]?.slug,
    };

    res.json({
      success: true,
      message: "Destination updated successfully",
      data: serializeDestination(destinationRow),
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "A destination with this name already exists",
        code: "DUPLICATE_ENTRY",
      });
    }
    next(err);
  }
};

/**
 * Soft delete a destination
 * DELETE /api/destinations/:id
 */
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { permanent = false } = req.query;

    // Get destination before deletion
    const existingResult = await query(
      "SELECT id, name, country_id, slug FROM destinations WHERE id = $1",
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Destination not found",
        code: "DESTINATION_NOT_FOUND",
      });
    }

    const existing = existingResult.rows[0];

    if (toBoolean(permanent)) {
      // Permanent delete - cascade will handle related tables
      await query("DELETE FROM destinations WHERE id = $1", [id]);
    } else {
      // Soft delete - just mark as inactive
      await query(
        "UPDATE destinations SET is_active = false, status = 'archived', updated_at = NOW() WHERE id = $1",
        [id]
      );
    }

    // Update country destination count
    if (existing.country_id) {
      await query(
        `UPDATE countries SET destination_count = (
           SELECT COUNT(*) FROM destinations WHERE country_id = $1 AND is_active = true
         ) WHERE id = $1`,
        [existing.country_id]
      );
    }

    res.json({
      success: true,
      message: toBoolean(permanent)
        ? "Destination permanently deleted"
        : "Destination archived successfully",
      data: {
        id: existing.id,
        name: existing.name,
        slug: existing.slug,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Restore a soft-deleted destination
 * POST /api/destinations/:id/restore
 */
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE destinations 
       SET is_active = true, status = 'draft', updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Destination not found",
        code: "DESTINATION_NOT_FOUND",
      });
    }

    // Update country destination count
    if (result.rows[0].country_id) {
      await query(
        `UPDATE countries SET destination_count = (
           SELECT COUNT(*) FROM destinations WHERE country_id = $1 AND is_active = true
         ) WHERE id = $1`,
        [result.rows[0].country_id]
      );
    }

    res.json({
      success: true,
      message: "Destination restored successfully",
      data: serializeDestination(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Bulk update destinations
 * PATCH /api/destinations/bulk
 */
exports.bulkUpdate = async (req, res, next) => {
  try {
    const { ids, updates } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: "IDs array is required",
        code: "VALIDATION_ERROR",
      });
    }

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: "Updates object is required",
        code: "VALIDATION_ERROR",
      });
    }

    // Only allow certain fields for bulk update
    const allowedFields = [
      'status', 'is_active', 'is_featured', 'is_popular', 'is_new',
      'is_eco_friendly', 'is_family_friendly', 'category', 'difficulty'
    ];

    const fields = {};
    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        fields[field] = updates[field];
      }
    });

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid fields to update",
        code: "NO_VALID_FIELDS",
      });
    }

    // Handle featured_at
    if (fields.is_featured === true) {
      fields.featured_at = new Date();
    } else if (fields.is_featured === false) {
      fields.featured_at = null;
    }

    // Handle published_at
    if (fields.status === 'published') {
      fields.published_at = new Date();
    }

    fields.updated_at = new Date();
    fields.updated_by = req.user?.id || null;

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
      data: {
        updated: result.rows,
        count: result.rows.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ===================================================================
   IMAGE MANAGEMENT
   =================================================================== */

/**
 * Get all images for a destination
 * GET /api/destinations/:id/images
 */
exports.getImages = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM destination_images 
       WHERE destination_id = $1 AND is_active = true 
       ORDER BY is_primary DESC, sort_order ASC`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows.map(serializeImage),
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Add images to a destination
 * POST /api/destinations/:id/images
 */
exports.addImages = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check destination exists
    const destCheck = await query(
      "SELECT id FROM destinations WHERE id = $1",
      [id]
    );
    if (destCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Destination not found",
        code: "DESTINATION_NOT_FOUND",
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No images uploaded",
        code: "NO_FILES",
      });
    }

    // Get current max sort order
    const maxOrderResult = await query(
      "SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM destination_images WHERE destination_id = $1",
      [id]
    );
    let sortOrder = maxOrderResult.rows[0].max_order;

    const images = [];
    const imageUrls = [];

    for (const file of req.files) {
      sortOrder++;
      const imageUrl = getUploadedFileUrl(file);
      
      const result = await query(
        `INSERT INTO destination_images (
          destination_id, image_url, sort_order, uploaded_by
        ) VALUES ($1, $2, $3, $4) RETURNING *`,
        [id, imageUrl, sortOrder, req.user?.id || null]
      );
      
      images.push(serializeImage(result.rows[0]));
      imageUrls.push(imageUrl);
    }

    // Update destination image_urls array
    await query(
      `UPDATE destinations
       SET image_urls = COALESCE(image_urls, ARRAY[]::TEXT[]) || $2::TEXT[],
           image_url = COALESCE(image_url, ($2::TEXT[])[1]),
           updated_at = NOW()
       WHERE id = $1`,
      [id, imageUrls]
    );

    res.status(201).json({
      success: true,
      message: `${images.length} images added successfully`,
      data: images,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update an image
 * PUT /api/destinations/:id/images/:imageId
 */
exports.updateImage = async (req, res, next) => {
  try {
    const { id, imageId } = req.params;
    const { caption, alt_text, credit, is_primary, sort_order, category } = req.body;

    // Check image exists
    const existingResult = await query(
      "SELECT * FROM destination_images WHERE id = $1 AND destination_id = $2",
      [imageId, id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Image not found",
        code: "IMAGE_NOT_FOUND",
      });
    }

    // If setting as primary, unset other primaries first
    if (toBoolean(is_primary)) {
      await query(
        "UPDATE destination_images SET is_primary = false WHERE destination_id = $1 AND id != $2",
        [id, imageId]
      );
    }

    const fields = {};
    if (caption !== undefined) fields.caption = caption;
    if (alt_text !== undefined) fields.alt_text = alt_text;
    if (credit !== undefined) fields.credit = credit;
    if (is_primary !== undefined) fields.is_primary = toBoolean(is_primary);
    if (sort_order !== undefined) fields.sort_order = toNumber(sort_order);
    if (category !== undefined) fields.category = category;

    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No fields to update",
        code: "NO_FIELDS",
      });
    }

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), imageId];

    const result = await query(
      `UPDATE destination_images SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );

    // If primary changed, update destination image_url
    if (toBoolean(is_primary)) {
      await query(
        "UPDATE destinations SET image_url = $2, updated_at = NOW() WHERE id = $1",
        [id, result.rows[0].image_url]
      );
    }

    res.json({
      success: true,
      message: "Image updated successfully",
      data: serializeImage(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete an image
 * DELETE /api/destinations/:id/images/:imageId
 */
exports.removeImage = async (req, res, next) => {
  try {
    const { id, imageId } = req.params;

    const result = await query(
      "DELETE FROM destination_images WHERE id = $1 AND destination_id = $2 RETURNING *",
      [imageId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Image not found",
        code: "IMAGE_NOT_FOUND",
      });
    }

    const deletedImage = result.rows[0];

    // Update destination image_urls array
    await query(
      `UPDATE destinations
       SET image_urls = array_remove(COALESCE(image_urls, ARRAY[]::TEXT[]), $2),
           updated_at = NOW()
       WHERE id = $1`,
      [id, deletedImage.image_url]
    );

    // If this was the primary image, set a new primary
    if (deletedImage.is_primary) {
      const newPrimary = await query(
        `UPDATE destination_images 
         SET is_primary = true 
         WHERE destination_id = $1 AND is_active = true
         ORDER BY sort_order ASC
         LIMIT 1
         RETURNING image_url`,
        [id]
      );

      const newPrimaryUrl = newPrimary.rows[0]?.image_url || null;
      await query(
        "UPDATE destinations SET image_url = $2 WHERE id = $1",
        [id, newPrimaryUrl]
      );
    }

    res.json({
      success: true,
      message: "Image deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Reorder images
 * PUT /api/destinations/:id/images/reorder
 */
exports.reorderImages = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { imageIds } = req.body;

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "imageIds array is required",
        code: "VALIDATION_ERROR",
      });
    }

    // Update sort order for each image
    const updates = imageIds.map((imageId, index) =>
      query(
        "UPDATE destination_images SET sort_order = $1 WHERE id = $2 AND destination_id = $3",
        [index + 1, imageId, id]
      )
    );

    await Promise.all(updates);

    // Update destination image_urls to match new order
    const orderedImages = await query(
      `SELECT image_url FROM destination_images 
       WHERE destination_id = $1 AND is_active = true 
       ORDER BY sort_order ASC`,
      [id]
    );

    const orderedUrls = orderedImages.rows.map((r) => r.image_url);
    await query(
      `UPDATE destinations 
       SET image_urls = $2, image_url = $3, updated_at = NOW() 
       WHERE id = $1`,
      [id, orderedUrls, orderedUrls[0] || null]
    );

    res.json({
      success: true,
      message: "Images reordered successfully",
    });
  } catch (err) {
    next(err);
  }
};

/* ===================================================================
   REVIEWS MANAGEMENT
   =================================================================== */

/**
 * Get reviews for a destination
 * GET /api/destinations/:id/reviews
 */
exports.getReviews = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, sort = "-created", status = "approved" } = req.query;

    let where = "WHERE r.destination_id = $1";
    const params = [id];
    let idx = 2;

    if (status) {
      where += ` AND r.status = $${idx++}`;
      params.push(status);
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM destination_reviews r ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);
    const pagination = paginate(total, page, limit);

    const sortMap = {
      created: "r.created_at ASC",
      "-created": "r.created_at DESC",
      rating: "r.overall_rating DESC",
      "-rating": "r.overall_rating ASC",
      helpful: "r.helpful_count DESC",
    };
    const orderBy = sortMap[sort] || sortMap["-created"];

    params.push(pagination.limit, pagination.offset);

    const result = await query(
      `SELECT r.* FROM destination_reviews r
       ${where}
       ORDER BY r.is_featured DESC, ${orderBy}
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({
      success: true,
      data: result.rows.map(serializeReview),
      pagination,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Add a review
 * POST /api/destinations/:id/reviews
 */
exports.addReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      reviewer_name,
      reviewer_email,
      reviewer_country,
      title,
      content,
      overall_rating,
      value_rating,
      service_rating,
      accommodation_rating,
      guide_rating,
      trip_date,
      trip_type,
    } = req.body;

    // Validate required fields
    if (!content || !overall_rating) {
      return res.status(400).json({
        success: false,
        error: "Content and overall rating are required",
        code: "VALIDATION_ERROR",
      });
    }

    const ratingNum = parseFloat(overall_rating);
    if (ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({
        success: false,
        error: "Rating must be between 1 and 5",
        code: "VALIDATION_ERROR",
      });
    }

    // Check destination exists
    const destCheck = await query(
      "SELECT id FROM destinations WHERE id = $1 AND is_active = true",
      [id]
    );
    if (destCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Destination not found",
        code: "DESTINATION_NOT_FOUND",
      });
    }

    // Handle image uploads
    let images = [];
    if (req.files && req.files.length > 0) {
      images = req.files.map((file) => getUploadedFileUrl(file));
    } else if (req.body.images) {
      images = normalizeImageUrls(req.body.images);
    }

    const result = await query(
      `INSERT INTO destination_reviews (
        destination_id, user_id, reviewer_name, reviewer_email, reviewer_country,
        title, content, overall_rating, value_rating, service_rating,
        accommodation_rating, guide_rating, trip_date, trip_type, images, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        id,
        req.user?.id || null,
        reviewer_name || req.user?.name || 'Anonymous',
        reviewer_email || req.user?.email,
        reviewer_country,
        title,
        content,
        ratingNum,
        toNumber(value_rating),
        toNumber(service_rating),
        toNumber(accommodation_rating),
        toNumber(guide_rating),
        trip_date,
        trip_type,
        images,
        'pending', // Reviews start as pending for moderation
      ]
    );

    res.status(201).json({
      success: true,
      message: "Review submitted successfully. It will be visible after moderation.",
      data: serializeReview(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Mark review as helpful
 * POST /api/destinations/:id/reviews/:reviewId/helpful
 */
exports.markReviewHelpful = async (req, res, next) => {
  try {
    const { reviewId } = req.params;

    const result = await query(
      `UPDATE destination_reviews 
       SET helpful_count = helpful_count + 1 
       WHERE id = $1 
       RETURNING helpful_count`,
      [reviewId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Review not found",
      });
    }

    res.json({
      success: true,
      data: {
        helpfulCount: result.rows[0].helpful_count,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ===================================================================
   ITINERARY MANAGEMENT
   =================================================================== */

/**
 * Get itinerary for a destination
 * GET /api/destinations/:id/itinerary
 */
exports.getItinerary = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM destination_itineraries 
       WHERE destination_id = $1 AND is_active = true 
       ORDER BY day_number ASC, sort_order ASC`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        dayNumber: row.day_number,
        title: row.title,
        subtitle: row.subtitle,
        description: row.description,
        activities: row.activities || [],
        highlights: row.highlights || [],
        meals: row.meals || [],
        accommodation: row.accommodation,
        startLocation: row.start_location,
        endLocation: row.end_location,
        distanceKm: toNumber(row.distance_km),
        drivingTime: row.driving_time,
        imageUrl: row.image_url,
      })),
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Add/update itinerary day
 * POST /api/destinations/:id/itinerary
 */
exports.addItineraryDay = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      day_number,
      title,
      subtitle,
      description,
      activities,
      highlights,
      meals,
      accommodation,
      start_location,
      end_location,
      distance_km,
      driving_time,
      image_url,
    } = req.body;

    if (!day_number || !title) {
      return res.status(400).json({
        success: false,
        error: "Day number and title are required",
        code: "VALIDATION_ERROR",
      });
    }

    const result = await query(
      `INSERT INTO destination_itineraries (
        destination_id, day_number, title, subtitle, description,
        activities, highlights, meals, accommodation,
        start_location, end_location, distance_km, driving_time, image_url,
        sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        id,
        toNumber(day_number),
        title,
        subtitle,
        description,
        normalizeArrayField(activities),
        normalizeArrayField(highlights),
        normalizeArrayField(meals),
        accommodation,
        start_location,
        end_location,
        toNumber(distance_km),
        driving_time,
        image_url,
        toNumber(day_number),
      ]
    );

    res.status(201).json({
      success: true,
      message: "Itinerary day added successfully",
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update itinerary day
 * PUT /api/destinations/:id/itinerary/:dayId
 */
exports.updateItineraryDay = async (req, res, next) => {
  try {
    const { id, dayId } = req.params;
    const fields = { ...req.body };

    // Handle array fields
    ['activities', 'highlights', 'meals'].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(fields, field)) {
        fields[field] = normalizeArrayField(fields[field]);
      }
    });

    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No fields to update",
      });
    }

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), dayId, id];

    const result = await query(
      `UPDATE destination_itineraries 
       SET ${sets} 
       WHERE id = $${values.length - 1} AND destination_id = $${values.length}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Itinerary day not found",
      });
    }

    res.json({
      success: true,
      message: "Itinerary day updated successfully",
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete itinerary day
 * DELETE /api/destinations/:id/itinerary/:dayId
 */
exports.removeItineraryDay = async (req, res, next) => {
  try {
    const { id, dayId } = req.params;

    const result = await query(
      "DELETE FROM destination_itineraries WHERE id = $1 AND destination_id = $2 RETURNING id",
      [dayId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Itinerary day not found",
      });
    }

    res.json({
      success: true,
      message: "Itinerary day deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

/* ===================================================================
   PRICING MANAGEMENT
   =================================================================== */

/**
 * Get pricing for a destination
 * GET /api/destinations/:id/pricing
 */
exports.getPricing = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM destination_pricing 
       WHERE destination_id = $1 AND is_active = true 
       ORDER BY sort_order ASC`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        price: toNumber(row.price),
        originalPrice: toNumber(row.original_price),
        currency: row.currency || 'USD',
        pricingType: row.pricing_type,
        minPersons: toNumber(row.min_persons),
        maxPersons: toNumber(row.max_persons),
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        seasonType: row.season_type,
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Add pricing option
 * POST /api/destinations/:id/pricing
 */
exports.addPricing = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      price,
      original_price,
      currency,
      pricing_type,
      min_persons,
      max_persons,
      valid_from,
      valid_until,
      season_type,
    } = req.body;

    if (!name || !price) {
      return res.status(400).json({
        success: false,
        error: "Name and price are required",
        code: "VALIDATION_ERROR",
      });
    }

    const result = await query(
      `INSERT INTO destination_pricing (
        destination_id, name, description, price, original_price,
        currency, pricing_type, min_persons, max_persons,
        valid_from, valid_until, season_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        id,
        name,
        description,
        toNumber(price),
        toNumber(original_price),
        currency || 'USD',
        pricing_type || 'per_person',
        toNumber(min_persons, 1),
        toNumber(max_persons),
        valid_from,
        valid_until,
        season_type || 'high',
      ]
    );

    res.status(201).json({
      success: true,
      message: "Pricing option added successfully",
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

/* ===================================================================
   FAQs MANAGEMENT
   =================================================================== */

/**
 * Get FAQs for a destination
 * GET /api/destinations/:id/faqs
 */
exports.getFaqs = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM destination_faqs 
       WHERE destination_id = $1 AND is_active = true 
       ORDER BY sort_order ASC`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        question: row.question,
        answer: row.answer,
        category: row.category,
        helpfulCount: toNumber(row.helpful_count),
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Add FAQ
 * POST /api/destinations/:id/faqs
 */
exports.addFaq = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { question, answer, category } = req.body;

    if (!question || !answer) {
      return res.status(400).json({
        success: false,
        error: "Question and answer are required",
        code: "VALIDATION_ERROR",
      });
    }

    const result = await query(
      `INSERT INTO destination_faqs (destination_id, question, answer, category)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, question, answer, category]
    );

    res.status(201).json({
      success: true,
      message: "FAQ added successfully",
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

/* ===================================================================
   STATISTICS & ANALYTICS
   =================================================================== */

/**
 * Get destination statistics
 * GET /api/destinations/stats
 */
exports.getStats = async (req, res, next) => {
  try {
    const stats = await query(`
      SELECT 
        COUNT(*) AS total_destinations,
        COUNT(*) FILTER (WHERE is_active = true AND status = 'published') AS published_destinations,
        COUNT(*) FILTER (WHERE is_featured = true) AS featured_destinations,
        COUNT(*) FILTER (WHERE is_popular = true) AS popular_destinations,
        COUNT(*) FILTER (WHERE is_new = true OR published_at >= NOW() - INTERVAL '30 days') AS new_destinations,
        COUNT(*) FILTER (WHERE is_eco_friendly = true) AS eco_friendly_destinations,
        AVG(rating) FILTER (WHERE rating > 0) AS avg_rating,
        SUM(view_count) AS total_views,
        SUM(booking_count) AS total_bookings,
        SUM(review_count) AS total_reviews,
        AVG(starting_price) FILTER (WHERE starting_price > 0) AS avg_price,
        MIN(starting_price) FILTER (WHERE starting_price > 0) AS min_price,
        MAX(starting_price) AS max_price
      FROM destinations
    `);

    const categoryStats = await query(`
      SELECT 
        category,
        COUNT(*) AS count,
        AVG(rating) AS avg_rating,
        SUM(booking_count) AS total_bookings
      FROM destinations 
      WHERE is_active = true AND status = 'published'
      GROUP BY category
      ORDER BY count DESC
    `);

    const countryStats = await query(`
      SELECT 
        c.name AS country_name,
        c.slug AS country_slug,
        COUNT(d.id) AS destination_count,
        AVG(d.rating) AS avg_rating
      FROM destinations d
      JOIN countries c ON d.country_id = c.id
      WHERE d.is_active = true AND d.status = 'published'
      GROUP BY c.id, c.name, c.slug
      ORDER BY destination_count DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      data: {
        overview: {
          totalDestinations: parseInt(stats.rows[0].total_destinations),
          publishedDestinations: parseInt(stats.rows[0].published_destinations),
          featuredDestinations: parseInt(stats.rows[0].featured_destinations),
          popularDestinations: parseInt(stats.rows[0].popular_destinations),
          newDestinations: parseInt(stats.rows[0].new_destinations),
          ecoFriendlyDestinations: parseInt(stats.rows[0].eco_friendly_destinations),
          avgRating: toNumber(stats.rows[0].avg_rating),
          totalViews: parseInt(stats.rows[0].total_views) || 0,
          totalBookings: parseInt(stats.rows[0].total_bookings) || 0,
          totalReviews: parseInt(stats.rows[0].total_reviews) || 0,
          avgPrice: toNumber(stats.rows[0].avg_price),
          priceRange: {
            min: toNumber(stats.rows[0].min_price),
            max: toNumber(stats.rows[0].max_price),
          },
        },
        byCategory: categoryStats.rows.map((row) => ({
          category: row.category,
          count: parseInt(row.count),
          avgRating: toNumber(row.avg_rating),
          totalBookings: parseInt(row.total_bookings) || 0,
        })),
        byCountry: countryStats.rows.map((row) => ({
          country: row.country_name,
          countrySlug: row.country_slug,
          destinationCount: parseInt(row.destination_count),
          avgRating: toNumber(row.avg_rating),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Increment view count (can be called separately)
 * POST /api/destinations/:id/view
 */
exports.incrementView = async (req, res, next) => {
  try {
    const { id } = req.params;

    await query(
      "UPDATE destinations SET view_count = view_count + 1 WHERE id = $1",
      [id]
    );

    res.json({
      success: true,
      message: "View recorded",
    });
  } catch (err) {
    next(err);
  }
  };

/**
 * Increment wishlist count
 * POST /api/destinations/:id/wishlist
 */
exports.incrementWishlist = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE destinations 
       SET wishlist_count = wishlist_count + 1 
       WHERE id = $1 
       RETURNING wishlist_count`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Destination not found",
        code: "DESTINATION_NOT_FOUND",
      });
    }

    res.json({
      success: true,
      message: "Wishlist count updated",
      data: {
        wishlistCount: parseInt(result.rows[0].wishlist_count, 10),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Increment share count
 * POST /api/destinations/:id/share
 */
exports.incrementShare = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE destinations 
       SET share_count = share_count + 1 
       WHERE id = $1 
       RETURNING share_count`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Destination not found",
        code: "DESTINATION_NOT_FOUND",
      });
    }

    res.json({
      success: true,
      message: "Share count updated",
      data: {
        shareCount: parseInt(result.rows[0].share_count, 10),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Increment booking count
 * POST /api/destinations/:id/book
 */
exports.incrementBooking = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE destinations 
       SET booking_count = booking_count + 1
       WHERE id = $1 
       RETURNING booking_count`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Destination not found",
        code: "DESTINATION_NOT_FOUND",
      });
    }

    res.json({
      success: true,
      message: "Booking count updated",
      data: {
        bookingCount: parseInt(result.rows[0].booking_count, 10),
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ===================================================================
   DESTINATION TAGS
   =================================================================== */

/**
 * Get tags for one destination
 * GET /api/destinations/:id/tags
 */
exports.getDestinationTags = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM destination_tags
       WHERE destination_id = $1
       ORDER BY tag_category ASC, tag_name ASC`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.tag_name,
        slug: row.tag_slug,
        category: row.tag_category,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Add a tag to a destination
 * POST /api/destinations/:id/tags
 */
exports.addDestinationTag = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tag_name, tag_category } = req.body;

    if (!tag_name || !tag_name.trim()) {
      return res.status(400).json({
        success: false,
        error: "tag_name is required",
        code: "VALIDATION_ERROR",
      });
    }

    const tagSlug = slugify(tag_name);

    const result = await query(
      `INSERT INTO destination_tags (destination_id, tag_name, tag_slug, tag_category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (destination_id, tag_slug) DO NOTHING
       RETURNING *`,
      [id, tag_name.trim(), tagSlug, tag_category || null]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: "Tag already exists for this destination",
        code: "TAG_EXISTS",
      });
    }

    res.status(201).json({
      success: true,
      message: "Tag added successfully",
      data: {
        id: result.rows[0].id,
        name: result.rows[0].tag_name,
        slug: result.rows[0].tag_slug,
        category: result.rows[0].tag_category,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Remove a tag from a destination
 * DELETE /api/destinations/:id/tags/:tagId
 */
exports.removeDestinationTag = async (req, res, next) => {
  try {
    const { id, tagId } = req.params;

    const result = await query(
      `DELETE FROM destination_tags 
       WHERE id = $1 AND destination_id = $2
       RETURNING id`,
      [tagId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Tag not found",
        code: "TAG_NOT_FOUND",
      });
    }

    res.json({
      success: true,
      message: "Tag removed successfully",
    });
  } catch (err) {
    next(err);
  }
};

/* ===================================================================
   DESTINATION INCLUSIONS / EXCLUSIONS
   =================================================================== */

/**
 * Get inclusions
 * GET /api/destinations/:id/inclusions
 */
exports.getInclusions = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM destination_inclusions
       WHERE destination_id = $1 AND is_active = true
       ORDER BY sort_order ASC, id ASC`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        icon: row.icon,
        category: row.category,
        sortOrder: row.sort_order,
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Add inclusion
 * POST /api/destinations/:id/inclusions
 */
exports.addInclusion = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, icon, category, sort_order } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        error: "title is required",
        code: "VALIDATION_ERROR",
      });
    }

    const result = await query(
      `INSERT INTO destination_inclusions (
        destination_id, title, description, icon, category, sort_order
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        id,
        title.trim(),
        description || null,
        icon || null,
        category || null,
        toNumber(sort_order, 0),
      ]
    );

    res.status(201).json({
      success: true,
      message: "Inclusion added successfully",
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete inclusion
 * DELETE /api/destinations/:id/inclusions/:inclusionId
 */
exports.removeInclusion = async (req, res, next) => {
  try {
    const { id, inclusionId } = req.params;

    const result = await query(
      `DELETE FROM destination_inclusions
       WHERE id = $1 AND destination_id = $2
       RETURNING id`,
      [inclusionId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Inclusion not found",
        code: "INCLUSION_NOT_FOUND",
      });
    }

    res.json({
      success: true,
      message: "Inclusion removed successfully",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get exclusions
 * GET /api/destinations/:id/exclusions
 */
exports.getExclusions = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM destination_exclusions
       WHERE destination_id = $1 AND is_active = true
       ORDER BY sort_order ASC, id ASC`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        icon: row.icon,
        sortOrder: row.sort_order,
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Add exclusion
 * POST /api/destinations/:id/exclusions
 */
exports.addExclusion = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, icon, sort_order } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        error: "title is required",
        code: "VALIDATION_ERROR",
      });
    }

    const result = await query(
      `INSERT INTO destination_exclusions (
        destination_id, title, description, icon, sort_order
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [
        id,
        title.trim(),
        description || null,
        icon || null,
        toNumber(sort_order, 0),
      ]
    );

    res.status(201).json({
      success: true,
      message: "Exclusion added successfully",
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete exclusion
 * DELETE /api/destinations/:id/exclusions/:exclusionId
 */
exports.removeExclusion = async (req, res, next) => {
  try {
    const { id, exclusionId } = req.params;

    const result = await query(
      `DELETE FROM destination_exclusions
       WHERE id = $1 AND destination_id = $2
       RETURNING id`,
      [exclusionId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Exclusion not found",
        code: "EXCLUSION_NOT_FOUND",
      });
    }

    res.json({
      success: true,
      message: "Exclusion removed successfully",
    });
  } catch (err) {
    next(err);
  }
};

/* ===================================================================
   DESTINATION SEASONS
   =================================================================== */

/**
 * Get seasons
 * GET /api/destinations/:id/seasons
 */
exports.getSeasons = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM destination_seasons
       WHERE destination_id = $1 AND is_active = true
       ORDER BY sort_order ASC, start_month ASC`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        seasonType: row.season_type,
        description: row.description,
        startMonth: row.start_month,
        endMonth: row.end_month,
        weatherDescription: row.weather_description,
        avgTemperatureCelsius: toNumber(row.avg_temperature_celsius),
        rainfallMm: toNumber(row.rainfall_mm),
        wildlifeHighlights: row.wildlife_highlights || [],
        isRecommended: toBoolean(row.is_recommended),
        crowdLevel: row.crowd_level,
        sortOrder: row.sort_order,
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Add season
 * POST /api/destinations/:id/seasons
 */
exports.addSeason = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      season_type,
      description,
      start_month,
      end_month,
      weather_description,
      avg_temperature_celsius,
      rainfall_mm,
      wildlife_highlights,
      is_recommended,
      crowd_level,
      sort_order,
    } = req.body;

    if (!name || !season_type) {
      return res.status(400).json({
        success: false,
        error: "name and season_type are required",
        code: "VALIDATION_ERROR",
      });
    }

    const result = await query(
      `INSERT INTO destination_seasons (
        destination_id, name, season_type, description,
        start_month, end_month, weather_description,
        avg_temperature_celsius, rainfall_mm,
        wildlife_highlights, is_recommended, crowd_level, sort_order
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        id,
        name,
        season_type,
        description || null,
        toNumber(start_month),
        toNumber(end_month),
        weather_description || null,
        toNumber(avg_temperature_celsius),
        toNumber(rainfall_mm),
        normalizeArrayField(wildlife_highlights),
        toBoolean(is_recommended),
        crowd_level || null,
        toNumber(sort_order, 0),
      ]
    );

    res.status(201).json({
      success: true,
      message: "Season added successfully",
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete season
 * DELETE /api/destinations/:id/seasons/:seasonId
 */
exports.removeSeason = async (req, res, next) => {
  try {
    const { id, seasonId } = req.params;

    const result = await query(
      `DELETE FROM destination_seasons
       WHERE id = $1 AND destination_id = $2
       RETURNING id`,
      [seasonId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Season not found",
        code: "SEASON_NOT_FOUND",
      });
    }

    res.json({
      success: true,
      message: "Season removed successfully",
    });
  } catch (err) {
    next(err);
  }
};