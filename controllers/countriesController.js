const { query } = require("../config/db");
const { slugify, paginate } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");

const resolveIdOrSlug = (params) => params.idOrSlug || params.id;

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// Parse JSONB fields safely
const parseJsonField = (value, defaultValue = {}) => {
  if (!value) return defaultValue;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
};

// Serialize country for API response (matches frontend data structure)
const serializeCountry = (row, includeRelated = false) => {
  const country = {
    // Identifiers
    id: row.slug || String(row.id),
    countryId: row.slug || String(row.id),
    dbId: row.id,
    slug: row.slug,
    
    // Basic Info
    name: row.name,
    officialName: row.official_name,
    capital: row.capital,
    flag: row.flag,
    flagUrl: row.flag_url,
    tagline: row.tagline,
    motto: row.motto,
    demonym: row.demonym,
    
    // Dates & Government
    independence: row.independence_date,
    governmentType: row.government_type,
    headOfState: row.head_of_state,
    
    // Geographic Classification
    continent: row.continent,
    region: row.region,
    subRegion: row.sub_region,
    
    // Descriptions
    description: row.description,
    fullDescription: row.full_description,
    additionalInfo: row.additional_info,
    
    // Demographics
    population: row.population,
    area: row.area,
    populationDensity: row.population_density,
    urbanPopulation: row.urban_population,
    lifeExpectancy: row.life_expectancy,
    medianAge: row.median_age,
    literacyRate: row.literacy_rate,
    
    // Languages (arrays)
    languages: row.languages || [],
    officialLanguages: row.official_languages || [],
    nationalLanguages: row.national_languages || [],
    
    // People & Culture (arrays)
    ethnicGroups: row.ethnic_groups || [],
    religions: row.religions || [],
    
    // Practical Info
    currency: row.currency,
    currencySymbol: row.currency_symbol,
    timezone: row.timezone,
    callingCode: row.calling_code,
    internetTLD: row.internet_tld,
    drivingSide: row.driving_side,
    electricalPlug: row.electrical_plug,
    voltage: row.voltage,
    waterSafety: row.water_safety,
    
    // Climate & Weather
    climate: row.climate,
    bestTime: row.best_time_to_visit,
    seasons: parseJsonField(row.seasons, { dry: [], wet: [], best: null }),
    
    // Travel Requirements
    visaInfo: row.visa_info,
    healthInfo: row.health_info,
    
    // Arrays
    highlights: row.highlights || [],
    experiences: row.experiences || [],
    travelTips: row.travel_tips || [],
    neighboringCountries: row.neighboring_countries || [],
    
    // Nested Objects (JSONB)
    wildlife: parseJsonField(row.wildlife, { mammals: [], birds: [], marine: [] }),
    cuisine: parseJsonField(row.cuisine, { staples: [], specialties: [], beverages: [] }),
    economicInfo: parseJsonField(row.economic_info, {}),
    geography: parseJsonField(row.geography, {}),
    
    // Images
    imageUrl: row.image_url,
    coverImageUrl: row.cover_image_url,
    heroImage: row.hero_image || row.cover_image_url || row.image_url,
    images: row.images || [],
    
    // Map Position
    mapPosition: {
      lat: toNumber(row.latitude),
      lng: toNumber(row.longitude),
    },
    
    // Stats
    destinationCount: parseInt(row.destination_count || 0, 10),
    viewCount: row.view_count || 0,
    
    // Status
    isFeatured: row.is_featured,
    isActive: row.is_active,
    
    // Timestamps
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  
  // Include related data if requested
  if (includeRelated) {
    country.airports = row.airports || [];
    country.festivals = row.festivals || [];
    country.unescoSites = row.unesco_sites || [];
    country.historicalTimeline = row.historical_events || [];
  }
  
  return country;
};

// Serialize related data
const serializeAirport = (row) => ({
  id: row.id,
  name: row.name,
  code: row.code,
  location: row.location,
  type: row.airport_type,
  description: row.description,
  isMainInternational: row.is_main_international,
});

const serializeFestival = (row) => ({
  id: row.id,
  name: row.name,
  period: row.period,
  month: row.month,
  description: row.description,
  isMajorEvent: row.is_major_event,
  imageUrl: row.image_url,
});

const serializeUnescoSite = (row) => ({
  id: row.id,
  name: row.name,
  year: row.year_inscribed,
  type: row.site_type,
  description: row.description,
});

const serializeHistoricalEvent = (row) => ({
  year: row.year,
  event: row.event,
  type: row.event_type,
  isMajor: row.is_major,
});

// ============================================
// CONTROLLER METHODS
// ============================================

exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, featured, continent, search, region } = req.query;

    let where = "WHERE c.is_active = true";
    const params = [];
    let idx = 1;

    if (featured !== undefined) {
      where += ` AND c.is_featured = $${idx++}`;
      params.push(featured === "true");
    }
    if (continent) {
      where += ` AND c.continent = $${idx++}`;
      params.push(continent);
    }
    if (region) {
      where += ` AND c.region ILIKE $${idx++}`;
      params.push(`%${region}%`);
    }
    if (search) {
      where += ` AND (c.name ILIKE $${idx} OR c.description ILIKE $${idx} OR c.capital ILIKE $${idx} OR c.tagline ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countRes = await query(`SELECT COUNT(*) FROM countries c ${where}`, params);
    const pagination = paginate(parseInt(countRes.rows[0].count, 10), page, limit);

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM destinations d WHERE d.country_id = c.id AND d.is_active = true) AS destination_count
       FROM countries c
       ${where}
       ORDER BY c.is_featured DESC, c.display_order ASC, c.name ASC
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({ 
      data: result.rows.map(row => serializeCountry(row)), 
      pagination 
    });
  } catch (err) {
    next(err);
  }
};

exports.getFeatured = async (req, res, next) => {
  try {
    const { limit = 12 } = req.query;
    
    const result = await query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM destinations d WHERE d.country_id = c.id AND d.is_active = true) AS destination_count
       FROM countries c
       WHERE c.is_active = true AND c.is_featured = true
       ORDER BY c.display_order ASC, c.name ASC
       LIMIT $1`,
      [parseInt(limit, 10)]
    );
    
    res.json({ data: result.rows.map(row => serializeCountry(row)) });
  } catch (err) {
    next(err);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const idOrSlug = resolveIdOrSlug(req.params);
    const isNumeric = /^\d+$/.test(String(idOrSlug));
    const { includeRelated = 'true' } = req.query;

    // Get main country data
    const result = await query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM destinations d WHERE d.country_id = c.id AND d.is_active = true) AS destination_count
       FROM countries c
       WHERE ${isNumeric ? "c.id" : "c.slug"} = $1 AND c.is_active = true`,
      [isNumeric ? parseInt(idOrSlug, 10) : String(idOrSlug).toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Country not found" });
    }

    const countryRow = result.rows[0];
    
    // Increment view count (fire and forget)
    query(
      "UPDATE countries SET view_count = view_count + 1 WHERE id = $1",
      [countryRow.id]
    ).catch(() => {}); // Ignore errors

    // Get related data if requested
    let relatedData = {};
    if (includeRelated === 'true') {
      const [airportsRes, festivalsRes, unescoRes, historyRes] = await Promise.all([
        query(
          "SELECT * FROM country_airports WHERE country_id = $1 ORDER BY display_order ASC",
          [countryRow.id]
        ),
        query(
          "SELECT * FROM country_festivals WHERE country_id = $1 ORDER BY display_order ASC",
          [countryRow.id]
        ),
        query(
          "SELECT * FROM country_unesco_sites WHERE country_id = $1 ORDER BY year_inscribed DESC",
          [countryRow.id]
        ),
        query(
          "SELECT * FROM country_historical_events WHERE country_id = $1 ORDER BY sort_year ASC",
          [countryRow.id]
        ),
      ]);
      
      relatedData = {
        airports: airportsRes.rows.map(serializeAirport),
        festivals: festivalsRes.rows.map(serializeFestival),
        unesco_sites: unescoRes.rows.map(serializeUnescoSite),
        historical_events: historyRes.rows.map(serializeHistoricalEvent),
      };
    }

    const serialized = serializeCountry({ ...countryRow, ...relatedData }, includeRelated === 'true');

    res.json({ data: serialized });
  } catch (err) {
    next(err);
  }
};

exports.getDestinations = async (req, res, next) => {
  try {
    const idOrSlug = resolveIdOrSlug(req.params);
    const { page = 1, limit = 20, search, category } = req.query;
    const isNumeric = /^\d+$/.test(String(idOrSlug));

    const countryRes = await query(
      `SELECT id, name, slug
       FROM countries
       WHERE ${isNumeric ? "id" : "slug"} = $1 AND is_active = true`,
      [isNumeric ? parseInt(idOrSlug, 10) : String(idOrSlug).toLowerCase()]
    );

    if (countryRes.rows.length === 0) {
      return res.status(404).json({ error: "Country not found" });
    }

    const country = countryRes.rows[0];
    let where = "WHERE d.country_id = $1 AND d.is_active = true";
    const params = [country.id];
    let idx = 2;

    if (category) {
      where += ` AND d.category = $${idx++}`;
      params.push(category);
    }
    if (search) {
      where += ` AND (d.name ILIKE $${idx} OR d.description ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countRes = await query(`SELECT COUNT(*) FROM destinations d ${where}`, params);
    const pagination = paginate(parseInt(countRes.rows[0].count, 10), page, limit);

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT d.*
       FROM destinations d
       ${where}
       ORDER BY d.is_featured DESC, d.rating DESC, d.name ASC
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({
      data: result.rows.map((row) => ({
        ...row,
        countryId: country.slug || String(country.id),
        countryName: country.name,
        mapPosition: {
          lat: toNumber(row.latitude),
          lng: toNumber(row.longitude),
        },
        highlights: row.highlights || [],
        activities: row.activities || [],
        images: row.images || [],
      })),
      pagination,
      country: {
        id: country.id,
        slug: country.slug,
        name: country.name,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const {
      name,
      official_name,
      capital,
      flag,
      flag_url,
      tagline,
      motto,
      demonym,
      independence_date,
      government_type,
      head_of_state,
      continent,
      region,
      sub_region,
      description,
      full_description,
      additional_info,
      population,
      area,
      population_density,
      urban_population,
      life_expectancy,
      median_age,
      literacy_rate,
      languages,
      official_languages,
      national_languages,
      ethnic_groups,
      religions,
      currency,
      currency_symbol,
      timezone,
      calling_code,
      internet_tld,
      driving_side,
      electrical_plug,
      voltage,
      water_safety,
      climate,
      best_time_to_visit,
      seasons,
      visa_info,
      health_info,
      highlights,
      experiences,
      travel_tips,
      neighboring_countries,
      wildlife,
      cuisine,
      economic_info,
      geography,
      image_url,
      cover_image_url,
      hero_image,
      images,
      latitude,
      longitude,
      is_featured,
      is_active,
    } = req.body;

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Country name is required (min 2 characters)." });
    }

    const slug = slugify(name);
    const uploadedImage = req.file ? getUploadedFileUrl(req.file) : null;
    const finalImageUrl = uploadedImage || image_url || null;

    const result = await query(
      `INSERT INTO countries (
        slug, name, official_name, capital, flag, flag_url, tagline, motto, demonym,
        independence_date, government_type, head_of_state, continent, region, sub_region,
        description, full_description, additional_info,
        population, area, population_density, urban_population, life_expectancy, median_age, literacy_rate,
        languages, official_languages, national_languages, ethnic_groups, religions,
        currency, currency_symbol, timezone, calling_code, internet_tld, driving_side,
        electrical_plug, voltage, water_safety, climate, best_time_to_visit, seasons,
        visa_info, health_info, highlights, experiences, travel_tips, neighboring_countries,
        wildlife, cuisine, economic_info, geography,
        image_url, cover_image_url, hero_image, images, latitude, longitude,
        is_featured, is_active
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
        $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
        $51, $52, $53, $54, $55, $56, $57, $58, $59
      ) RETURNING *`,
      [
        slug,
        String(name).trim(),
        official_name || null,
        capital || null,
        flag || null,
        flag_url || null,
        tagline || null,
        motto || null,
        demonym || null,
        independence_date || null,
        government_type || 'Presidential Republic',
        head_of_state || null,
        continent || 'Africa',
        region || null,
        sub_region || null,
        description || null,
        full_description || null,
        additional_info || null,
        population || null,
        area || null,
        population_density || null,
        urban_population || null,
        life_expectancy || null,
        median_age || null,
        literacy_rate || null,
        languages || [],
        official_languages || [],
        national_languages || [],
        ethnic_groups || [],
        religions || [],
        currency || null,
        currency_symbol || null,
        timezone || null,
        calling_code || null,
        internet_tld || null,
        driving_side || 'Right',
        electrical_plug || null,
        voltage || null,
        water_safety || null,
        climate || null,
        best_time_to_visit || null,
        seasons ? JSON.stringify(seasons) : null,
        visa_info || null,
        health_info || null,
        highlights || [],
        experiences || [],
        travel_tips || [],
        neighboring_countries || [],
        wildlife ? JSON.stringify(wildlife) : null,
        cuisine ? JSON.stringify(cuisine) : null,
        economic_info ? JSON.stringify(economic_info) : null,
        geography ? JSON.stringify(geography) : null,
        finalImageUrl,
        cover_image_url || null,
        hero_image || null,
        images || [],
        latitude || null,
        longitude || null,
        Boolean(is_featured),
        is_active === undefined ? true : Boolean(is_active),
      ]
    );

    res.status(201).json({ data: serializeCountry(result.rows[0]) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Country with this name already exists." });
    }
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // Handle name/slug update
    if (updates.name) {
      updates.name = String(updates.name).trim();
      updates.slug = slugify(updates.name);
    }

    // Handle file upload
    if (req.file) {
      updates.image_url = getUploadedFileUrl(req.file);
    }

    // Convert JSONB fields
    const jsonbFields = ['seasons', 'wildlife', 'cuisine', 'economic_info', 'geography'];
    jsonbFields.forEach(field => {
      if (updates[field] && typeof updates[field] === 'object') {
        updates[field] = JSON.stringify(updates[field]);
      }
    });

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return res.status(400).json({ error: "No fields to update." });
    }

    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(", ");
    const values = [...keys.map((key) => updates[key]), id];

    const result = await query(
      `UPDATE countries
       SET ${setClause}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Country not found." });
    }

    res.json({ data: serializeCountry(result.rows[0]) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Country slug/name already exists." });
    }
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Check for dependent destinations
    const depRes = await query("SELECT COUNT(*) FROM destinations WHERE country_id = $1", [id]);
    const dependentCount = parseInt(depRes.rows[0].count, 10);

    if (dependentCount > 0) {
      return res.status(409).json({
        error: `Cannot delete country with ${dependentCount} existing destinations. Reassign or remove them first.`,
        dependentCount,
      });
    }

    // Delete related data first (cascades handle this, but explicit is clearer)
    await query("DELETE FROM country_airports WHERE country_id = $1", [id]);
    await query("DELETE FROM country_festivals WHERE country_id = $1", [id]);
    await query("DELETE FROM country_unesco_sites WHERE country_id = $1", [id]);
        await query("DELETE FROM country_historical_events WHERE country_id = $1", [id]);

    // Delete the country
    const result = await query(
      "DELETE FROM countries WHERE id = $1 RETURNING id, name, slug",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Country not found." });
    }

    res.json({
      message: "Country and all related data deleted successfully.",
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  getAll,
  getFeatured,
  getOne,
  getDestinations,
  create,
  update,
  remove,
};