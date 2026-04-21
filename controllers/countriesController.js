const { query } = require("../config/db");
const { slugify, paginate } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");

const resolveIdOrSlug = (params) => params.idOrSlug || params.id;

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const parseJsonField = (value, defaultValue = {}) => {
  if (!value) return defaultValue;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
};

/* ── serializers ─────────────────────────────────────── */

const serializeCountry = (row, includeRelated = false) => {
  const country = {
    id: row.slug || String(row.id),
    countryId: row.slug || String(row.id),
    dbId: row.id,
    slug: row.slug,
    name: row.name,
    officialName: row.official_name,
    capital: row.capital,
    flag: row.flag,
    flagUrl: row.flag_url,
    tagline: row.tagline,
    motto: row.motto,
    demonym: row.demonym,
    independence: row.independence_date,
    governmentType: row.government_type,
    headOfState: row.head_of_state,
    continent: row.continent,
    region: row.region,
    subRegion: row.sub_region,
    description: row.description,
    fullDescription: row.full_description,
    additionalInfo: row.additional_info,
    population: row.population,
    area: row.area,
    populationDensity: row.population_density,
    urbanPopulation: row.urban_population,
    lifeExpectancy: row.life_expectancy,
    medianAge: row.median_age,
    literacyRate: row.literacy_rate,
    languages: row.languages || [],
    officialLanguages: row.official_languages || [],
    nationalLanguages: row.national_languages || [],
    ethnicGroups: row.ethnic_groups || [],
    religions: row.religions || [],
    currency: row.currency,
    currencySymbol: row.currency_symbol,
    timezone: row.timezone,
    callingCode: row.calling_code,
    internetTLD: row.internet_tld,
    drivingSide: row.driving_side,
    electricalPlug: row.electrical_plug,
    voltage: row.voltage,
    waterSafety: row.water_safety,
    climate: row.climate,
    bestTime: row.best_time_to_visit,
    seasons: parseJsonField(row.seasons, { dry: [], wet: [], best: null }),
    visaInfo: row.visa_info,
    healthInfo: row.health_info,
    highlights: row.highlights || [],
    experiences: row.experiences || [],
    travelTips: row.travel_tips || [],
    neighboringCountries: row.neighboring_countries || [],
    wildlife: parseJsonField(row.wildlife, { mammals: [], birds: [], marine: [] }),
    cuisine: parseJsonField(row.cuisine, {
      staples: [],
      specialties: [],
      beverages: [],
    }),
    economicInfo: parseJsonField(row.economic_info, {}),
    geography: parseJsonField(row.geography, {}),
    imageUrl: row.image_url,
    coverImageUrl: row.cover_image_url,
    heroImage: row.hero_image || row.cover_image_url || row.image_url,
    images: row.images || [],
    mapPosition: { lat: toNumber(row.latitude), lng: toNumber(row.longitude) },
    destinationCount: parseInt(row.destination_count || 0, 10),
    viewCount: row.view_count || 0,
    isFeatured: row.is_featured,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (includeRelated) {
    country.airports = row.airports || [];
    country.festivals = row.festivals || [];
    country.unescoSites = row.unesco_sites || [];
    country.historicalTimeline = row.historical_events || [];
  }

  return country;
};

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
  id: row.id,
  year: row.year,
  event: row.event,
  type: row.event_type,
  isMajor: row.is_major,
});

/* ── helpers ─────────────────────────────────────── */

const destCountSub = `(SELECT COUNT(*) FROM destinations d WHERE d.country_id = c.id AND d.is_active = true) AS destination_count`;

/* ── PUBLIC ──────────────────────────────────────── */

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
      where += ` AND c.continent ILIKE $${idx++}`;
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

    const countRes = await query(
      `SELECT COUNT(*) FROM countries c ${where}`,
      params
    );
    const pagination = paginate(parseInt(countRes.rows[0].count, 10), page, limit);

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT c.*, ${destCountSub}
       FROM countries c ${where}
       ORDER BY c.is_featured DESC, c.display_order ASC, c.name ASC
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({
      data: result.rows.map((r) => serializeCountry(r)),
      pagination,
    });
  } catch (err) {
    next(err);
  }
};

exports.getFeatured = async (req, res, next) => {
  try {
    const { limit = 12 } = req.query;
    const result = await query(
      `SELECT c.*, ${destCountSub}
       FROM countries c
       WHERE c.is_active = true AND c.is_featured = true
       ORDER BY c.display_order ASC, c.name ASC
       LIMIT $1`,
      [parseInt(limit, 10)]
    );
    res.json({ data: result.rows.map((r) => serializeCountry(r)) });
  } catch (err) {
    next(err);
  }
};

exports.search = async (req, res, next) => {
  try {
    const { q, limit = 15 } = req.query;
    if (!q || String(q).trim().length < 2) return res.json({ data: [] });

    const term = `%${String(q).trim()}%`;
    const result = await query(
      `SELECT c.*, ${destCountSub}
       FROM countries c
       WHERE c.is_active = true
         AND (c.name ILIKE $1 OR c.capital ILIKE $1 OR c.continent ILIKE $1
              OR c.region ILIKE $1 OR c.description ILIKE $1 OR c.tagline ILIKE $1)
       ORDER BY
         CASE WHEN c.name ILIKE $2 THEN 0 WHEN c.name ILIKE $1 THEN 1 ELSE 2 END,
         c.name ASC
       LIMIT $3`,
      [term, `${String(q).trim()}%`, parseInt(limit, 10)]
    );
    res.json({ data: result.rows.map((r) => serializeCountry(r)) });
  } catch (err) {
    next(err);
  }
};

exports.getStats = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*)::int                                           AS total_countries,
        COUNT(*) FILTER (WHERE is_featured)::int                AS featured_countries,
        COUNT(DISTINCT continent)::int                          AS total_continents,
        COALESCE(SUM(population),0)::bigint                     AS total_population,
        (SELECT COUNT(*)::int FROM destinations WHERE is_active = true) AS total_destinations,
        (SELECT COUNT(*)::int FROM country_airports)            AS total_airports,
        (SELECT COUNT(*)::int FROM country_unesco_sites)        AS total_unesco_sites
      FROM countries WHERE is_active = true
    `);
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.getContinents = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT continent,
             COUNT(*)::int AS country_count,
             COALESCE(SUM(population),0)::bigint AS total_population
      FROM countries
      WHERE is_active = true AND continent IS NOT NULL
      GROUP BY continent
      ORDER BY continent ASC
    `);
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.getByContinent = async (req, res, next) => {
  try {
    const { continent } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const countRes = await query(
      "SELECT COUNT(*) FROM countries WHERE is_active = true AND continent ILIKE $1",
      [continent]
    );
    const pagination = paginate(
      parseInt(countRes.rows[0].count, 10),
      page,
      limit
    );

    const result = await query(
      `SELECT c.*, ${destCountSub}
       FROM countries c
       WHERE c.is_active = true AND c.continent ILIKE $1
       ORDER BY c.is_featured DESC, c.name ASC
       LIMIT $2 OFFSET $3`,
      [continent, pagination.limit, pagination.offset]
    );
    res.json({
      data: result.rows.map((r) => serializeCountry(r)),
      pagination,
    });
  } catch (err) {
    next(err);
  }
};

/* ── SINGLE ──────────────────────────────────────── */

exports.getOne = async (req, res, next) => {
  try {
    const idOrSlug = resolveIdOrSlug(req.params);
    const isNumeric = /^\d+$/.test(String(idOrSlug));
    const { includeRelated = "true" } = req.query;

    const result = await query(
      `SELECT c.*, ${destCountSub}
       FROM countries c
       WHERE ${isNumeric ? "c.id" : "c.slug"} = $1 AND c.is_active = true`,
      [isNumeric ? parseInt(idOrSlug, 10) : String(idOrSlug).toLowerCase()]
    );

    if (!result.rows.length)
      return res.status(404).json({ error: "Country not found" });

    const row = result.rows[0];
    query("UPDATE countries SET view_count = view_count + 1 WHERE id = $1", [
      row.id,
    ]).catch(() => {});

    let relatedData = {};
    if (includeRelated === "true") {
      const [airports, festivals, unesco, history] = await Promise.all([
        query(
          "SELECT * FROM country_airports WHERE country_id = $1 ORDER BY display_order",
          [row.id]
        ),
        query(
          "SELECT * FROM country_festivals WHERE country_id = $1 ORDER BY display_order",
          [row.id]
        ),
        query(
          "SELECT * FROM country_unesco_sites WHERE country_id = $1 ORDER BY year_inscribed DESC",
          [row.id]
        ),
        query(
          "SELECT * FROM country_historical_events WHERE country_id = $1 ORDER BY sort_year",
          [row.id]
        ),
      ]);
      relatedData = {
        airports: airports.rows.map(serializeAirport),
        festivals: festivals.rows.map(serializeFestival),
        unesco_sites: unesco.rows.map(serializeUnescoSite),
        historical_events: history.rows.map(serializeHistoricalEvent),
      };
    }

    res.json({
      data: serializeCountry(
        { ...row, ...relatedData },
        includeRelated === "true"
      ),
    });
  } catch (err) {
    next(err);
  }
};

exports.getDestinations = async (req, res, next) => {
  try {
    const idOrSlug = resolveIdOrSlug(req.params);
    const isNumeric = /^\d+$/.test(String(idOrSlug));
    const { page = 1, limit = 20, search, category } = req.query;

    const countryRes = await query(
      `SELECT id, name, slug FROM countries
       WHERE ${isNumeric ? "id" : "slug"} = $1 AND is_active = true`,
      [isNumeric ? parseInt(idOrSlug, 10) : String(idOrSlug).toLowerCase()]
    );

    if (!countryRes.rows.length)
      return res.status(404).json({ error: "Country not found" });

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

    const countRes = await query(
      `SELECT COUNT(*) FROM destinations d ${where}`,
      params
    );
    const pagination = paginate(
      parseInt(countRes.rows[0].count, 10),
      page,
      limit
    );

    params.push(pagination.limit, pagination.offset);
	    const result = await query(
	      `SELECT d.* FROM destinations d ${where}
	       ORDER BY d.is_featured DESC, d.rating DESC, d.name ASC
	       LIMIT $${idx++} OFFSET $${idx}`,
	      params
	    );

	    res.json({
	      data: result.rows.map((r) => {
	        // Destinations are price-less; ensure any legacy `price` column never leaks.
	        const { price, ...rest } = r || {};
	        return {
	          ...rest,
	          countryId: country.slug || String(country.id),
	          countryName: country.name,
	          mapPosition: { lat: toNumber(r?.latitude), lng: toNumber(r?.longitude) },
	          highlights: r?.highlights || [],
	          activities: r?.activities || [],
	          images: r?.images || [],
	        };
	      }),
	      pagination,
	      country: { id: country.id, slug: country.slug, name: country.name },
	    });
	  } catch (err) {
	    next(err);
	  }
	};

/* ── ADMIN CRUD ──────────────────────────────────── */

exports.create = async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || String(b.name).trim().length < 2)
      return res
        .status(400)
        .json({ error: "Country name is required (min 2 chars)." });

    const slug = slugify(b.name);
    const uploadedImage = req.file ? getUploadedFileUrl(req.file) : null;
    const finalImageUrl = uploadedImage || b.image_url || null;

    const result = await query(
      `INSERT INTO countries (
        slug,name,official_name,capital,flag,flag_url,tagline,motto,demonym,
        independence_date,government_type,head_of_state,continent,region,sub_region,
        description,full_description,additional_info,
        population,area,population_density,urban_population,life_expectancy,median_age,literacy_rate,
        languages,official_languages,national_languages,ethnic_groups,religions,
        currency,currency_symbol,timezone,calling_code,internet_tld,driving_side,
        electrical_plug,voltage,water_safety,climate,best_time_to_visit,seasons,
        visa_info,health_info,highlights,experiences,travel_tips,neighboring_countries,
        wildlife,cuisine,economic_info,geography,
        image_url,cover_image_url,hero_image,images,latitude,longitude,
        is_featured,is_active
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
        $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,
        $57,$58,$59
      ) RETURNING *`,
      [
        slug,
        String(b.name).trim(),
        b.official_name || null,
        b.capital || null,
        b.flag || null,
        b.flag_url || null,
        b.tagline || null,
        b.motto || null,
        b.demonym || null,
        b.independence_date || null,
        b.government_type || "Presidential Republic",
        b.head_of_state || null,
        b.continent || "Africa",
        b.region || null,
        b.sub_region || null,
        b.description || null,
        b.full_description || null,
        b.additional_info || null,
        b.population || null,
        b.area || null,
        b.population_density || null,
        b.urban_population || null,
        b.life_expectancy || null,
        b.median_age || null,
        b.literacy_rate || null,
        b.languages || [],
        b.official_languages || [],
        b.national_languages || [],
        b.ethnic_groups || [],
        b.religions || [],
        b.currency || null,
        b.currency_symbol || null,
        b.timezone || null,
        b.calling_code || null,
        b.internet_tld || null,
        b.driving_side || "Right",
        b.electrical_plug || null,
        b.voltage || null,
        b.water_safety || null,
        b.climate || null,
        b.best_time_to_visit || null,
        b.seasons ? JSON.stringify(b.seasons) : null,
        b.visa_info || null,
        b.health_info || null,
        b.highlights || [],
        b.experiences || [],
        b.travel_tips || [],
        b.neighboring_countries || [],
        b.wildlife ? JSON.stringify(b.wildlife) : null,
        b.cuisine ? JSON.stringify(b.cuisine) : null,
        b.economic_info ? JSON.stringify(b.economic_info) : null,
        b.geography ? JSON.stringify(b.geography) : null,
        finalImageUrl,
        b.cover_image_url || null,
        b.hero_image || null,
        b.images || [],
        b.latitude || null,
        b.longitude || null,
        Boolean(b.is_featured),
        b.is_active === undefined ? true : Boolean(b.is_active),
      ]
    );

    res.status(201).json({ data: serializeCountry(result.rows[0]) });
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Country already exists." });
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    if (updates.name) {
      updates.name = String(updates.name).trim();
      updates.slug = slugify(updates.name);
    }
    if (req.file) updates.image_url = getUploadedFileUrl(req.file);

    ["seasons", "wildlife", "cuisine", "economic_info", "geography"].forEach(
      (f) => {
        if (updates[f] && typeof updates[f] === "object")
          updates[f] = JSON.stringify(updates[f]);
      }
    );

    const keys = Object.keys(updates);
    if (!keys.length)
      return res.status(400).json({ error: "No fields to update." });

    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => updates[k]), id];

    const result = await query(
      `UPDATE countries SET ${setClause}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (!result.rows.length)
      return res.status(404).json({ error: "Country not found." });
    res.json({ data: serializeCountry(result.rows[0]) });
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Slug/name already exists." });
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const depRes = await query(
      "SELECT COUNT(*) FROM destinations WHERE country_id = $1",
      [id]
    );
    const cnt = parseInt(depRes.rows[0].count, 10);
    if (cnt > 0)
      return res.status(409).json({
        error: `Cannot delete: ${cnt} destinations exist. Remove them first.`,
        dependentCount: cnt,
      });

    await Promise.all([
      query("DELETE FROM country_airports WHERE country_id = $1", [id]),
      query("DELETE FROM country_festivals WHERE country_id = $1", [id]),
      query("DELETE FROM country_unesco_sites WHERE country_id = $1", [id]),
      query("DELETE FROM country_historical_events WHERE country_id = $1", [id]),
    ]);

    const result = await query(
      "DELETE FROM countries WHERE id = $1 RETURNING id,name,slug",
      [id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: "Country not found." });

    res.json({ message: "Deleted successfully.", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

/* ── AIRPORTS CRUD ───────────────────────────────── */

exports.addAirport = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, code, location, airport_type, description, is_main_international } = req.body;
    if (!name) return res.status(400).json({ error: "Airport name is required." });

    const result = await query(
      `INSERT INTO country_airports
        (country_id, name, code, location, airport_type, description, is_main_international)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, name, code || null, location || null, airport_type || "International", description || null, Boolean(is_main_international)]
    );
    res.status(201).json({ data: serializeAirport(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

exports.removeAirport = async (req, res, next) => {
  try {
    const { id, airportId } = req.params;
    const result = await query(
      "DELETE FROM country_airports WHERE id = $1 AND country_id = $2 RETURNING *",
      [airportId, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Airport not found." });
    res.json({ message: "Airport removed.", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

/* ── FESTIVALS CRUD ──────────────────────────────── */

exports.addFestival = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, period, month, description, is_major_event, image_url } = req.body;
    if (!name) return res.status(400).json({ error: "Festival name is required." });

    const result = await query(
      `INSERT INTO country_festivals
        (country_id, name, period, month, description, is_major_event, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, name, period || null, month || null, description || null, Boolean(is_major_event), image_url || null]
    );
    res.status(201).json({ data: serializeFestival(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

exports.removeFestival = async (req, res, next) => {
  try {
    const { id, festivalId } = req.params;
    const result = await query(
      "DELETE FROM country_festivals WHERE id = $1 AND country_id = $2 RETURNING *",
      [festivalId, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Festival not found." });
    res.json({ message: "Festival removed.", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

/* ── UNESCO SITES CRUD ───────────────────────────── */

exports.addUnescoSite = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, year_inscribed, site_type, description } = req.body;
    if (!name) return res.status(400).json({ error: "Site name is required." });

    const result = await query(
      `INSERT INTO country_unesco_sites
        (country_id, name, year_inscribed, site_type, description)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, name, year_inscribed || null, site_type || "Cultural", description || null]
    );
    res.status(201).json({ data: serializeUnescoSite(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

exports.removeUnescoSite = async (req, res, next) => {
  try {
    const { id, siteId } = req.params;
    const result = await query(
      "DELETE FROM country_unesco_sites WHERE id = $1 AND country_id = $2 RETURNING *",
      [siteId, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "UNESCO site not found." });
    res.json({ message: "UNESCO site removed.", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

/* ── HISTORICAL EVENTS CRUD ──────────────────────── */

exports.addHistoricalEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { year, event, event_type, is_major, sort_year } = req.body;
    if (!event) return res.status(400).json({ error: "Event description is required." });

    const result = await query(
      `INSERT INTO country_historical_events
        (country_id, year, event, event_type, is_major, sort_year)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, year || null, event, event_type || "Political", Boolean(is_major), sort_year || 0]
    );
    res.status(201).json({ data: serializeHistoricalEvent(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

exports.removeHistoricalEvent = async (req, res, next) => {
  try {
    const { id, eventId } = req.params;
    const result = await query(
      "DELETE FROM country_historical_events WHERE id = $1 AND country_id = $2 RETURNING *",
      [eventId, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Event not found." });
    res.json({ message: "Event removed.", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

module.exports = exports;
