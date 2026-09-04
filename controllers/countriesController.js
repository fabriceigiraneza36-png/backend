// controllers/countriesController.js
"use strict";

const crypto = require("crypto");
const { query } = require("../config/db");
const logger = require("../utils/logger");
const { slugify } = require("../utils/slugify");
const { normalizeImages, urlsOnly } = require("../utils/media");

/* ═══════════════════════════════════════════════════════════════════════════
    SAFE REQUIRE: HELPERS
═══════════════════════════════════════════════════════════════════════════ */

let getCountryService;
let sanitizeInput;

try {
  ({
    getCountryService,
    sanitizeInput,
  } = require("../services/countryService"));
} catch (err) {
  logger.warn("[Countries] countryService not found — trying legacy paths:", err.message);

  const LEGACY_PATHS = [
    "../services/country",
    "../utils/countryService",
    "../services/countryService",
    "../utils/country",
  ];

  for (const p of LEGACY_PATHS) {
    try {
      const mod = require(p);
      if (typeof mod.getCountryService === "function") {
        getCountryService = mod.getCountryService;
        logger.info(`[Countries] ✅ Using getCountryService from: ${p}`);
        break;
      }
      if (typeof mod.default === "object" && mod.default.getCountryService) {
        getCountryService = mod.default.getCountryService;
        logger.info(`[Countries] ✅ Using getCountryService from: ${p} (default export)`);
        break;
      }
    } catch {/* try next */}
  }

  if (!getCountryService) {
    logger.warn("[Countries] No countryService found — using stub");
    getCountryService = () => ({});
  }

  try {
    const mod = require("../utils/helpers");
    if (typeof mod.sanitizeInput === "function") {
      sanitizeInput = mod.sanitizeInput;
      logger.info("[Countries] ✅ Using sanitizeInput from: ../utils/helpers");
    }
  } catch (err) {
    logger.warn("[Countries] helpers not found — using basic sanitize", err.message);
    sanitizeInput = (input) => {
      if (typeof input !== "string") return "";
      return input
        .replace(/[<>]/g, "")
        .replace(/['"]/g, "")
        .trim();
    };
  }
}

const sanitizeString = (value) => {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/['"]/g, "")
    .trim();
};

/* ═══════════════════════════════════════════════════════════════════════════
    EXPORTS
═══════════════════════════════════════════════════════════════════════════ */

const getAll = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      sortBy = "name",
      order = "asc",
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10), 1);
    const limitNum = Math.min(parseInt(limit, 10), 100);
    const offset = (pageNum - 1) * limitNum;

    let cleanSortBy = "name";
    const validSortFields = ["name", "code", "continent", "region"];
    if (validSortFields.includes(sortBy)) {
      cleanSortBy = sortBy;
    }
    
    const cleanOrder = ["asc", "desc"].includes(order.toLowerCase()) ? order.toUpperCase() : "ASC";
    const searchTerm = `%${search}%`;

    const { rows: dataRes } = await query(
      `SELECT * FROM countries WHERE name ILIKE $1 OR code ILIKE $1 ORDER BY ${cleanSortBy} ${cleanOrder} LIMIT $2 OFFSET $3`,
      [searchTerm, limitNum, offset]
    );

    const { rows: countRes } = await query(
      `SELECT COUNT(*) FROM countries WHERE name ILIKE $1 OR code ILIKE $1`,
      [searchTerm]
    );

    const total = parseInt(countRes.rows[0].count, 10);

    return res.json({
      success: true,
      data: dataRes.map(sanitizeCountryMedia),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(total / limitNum),
        has_next: pageNum < Math.ceil(total / limitNum),
        has_prev: pageNum > 1,
      },
    });
  } catch (err) {
    logger.error("[Countries] getAll:", err.message);
    next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid country ID",
      });
    }

    const { rows } = await query(
      `SELECT * FROM countries WHERE id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Country not found",
      });
    }

    return res.json({
      success: true,
      data: sanitizeCountryMedia(rows[0]),
    });
  } catch (err) {
    logger.error("[Countries] getById:", err.message);
    next(err);
  }
};

const getOne = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const isNumeric = /^\d+$/.test(slug);
    const whereClause = isNumeric ? "id = $1" : "slug = $1";

    const countryQuery = await query(`SELECT * FROM countries WHERE ${whereClause} AND is_active = true`, [slug]);
    if (!countryQuery.rows.length) {
      return res.status(404).json({ error: "Country not found" });
    }
    const country = sanitizeCountryMedia(countryQuery.rows[0]);

    // Track views asynchronously
    query("UPDATE countries SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1", [country.id]).catch(() => {});

    // Use only columns shared by the current and legacy destinations schemas.
    const destinationsQuery = await query(`
      SELECT
        d.id,
        d.name,
        d.slug,
        d.short_description,
        d.image_url,
        d.difficulty,
        COALESCE(d.duration_display, d.duration_days::TEXT, 'N/A') AS duration,
        d.duration_days,
        NULL AS price_from,
        'USD' AS price_currency,
        d.rating,
        d.review_count,
        d.is_featured,
        d.highlights,
        d.best_time_to_visit,
        d.category
      FROM destinations d
      WHERE d.country_id = $1 AND d.is_active = true
      ORDER BY d.is_featured DESC, d.name ASC
    `, [country.id]).catch(err => {
      logger.error(`[Countries] fallback destinations query error: ${err.message}`);
      return { rows: [] };
    });

    // Safe retrieve for similar countries (renames subquery alias to prevent ambiguous sort conflict)
    const similarQuery = await query(`
      SELECT * FROM (
        SELECT
          c.id, c.name, c.slug, c.flag_url, c.image_url, c.continent,
          (SELECT COUNT(*)::INTEGER FROM destinations d
           WHERE d.country_id = c.id AND d.is_active = true
          ) AS calc_dest_count
        FROM countries c
        WHERE c.continent = $1
          AND c.id != $2
          AND c.is_active = true
      ) sub
      ORDER BY sub.calc_dest_count DESC, sub.name ASC
      LIMIT 3
    `, [country.continent, country.id]).catch(err => {
      logger.error(`[Countries] fallback similar query error: ${err.message}`);
      return { rows: [] };
    });

    // Legacy services tables may not have country_id, so only query related
    // services when that relationship is available.
    const serviceCountryColumn = await query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'services' AND column_name = 'country_id'
      LIMIT 1
    `).catch(() => ({ rows: [] }));
    const servicesQuery = serviceCountryColumn.rows.length ? await query(`
      SELECT
        s.id, s.title, s.slug, s.description,
        s.image_url, 
        0 AS price_from, 
        'USD' AS price_currency,
        NULL AS duration, s.category, s.is_featured,
        s.rating, s.review_count
      FROM services s
      WHERE s.country_id = $1 AND s.is_active = true
      ORDER BY s.is_featured DESC, s.title ASC
    `, [country.id]).catch(err => {
      logger.error(`[Countries] fallback services query error: ${err.message}`);
      return { rows: [] };
    }) : { rows: [] };

    return res.json({
      success: true,
      data: {
        ...country,
        destinations: destinationsQuery.rows,
        similar: similarQuery.rows,
        services: servicesQuery.rows
      }
    });
  } catch (err) {
    logger.error("[Countries] getOne error:", err.message);
    next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const {
      name,
      code,
      continent,
      region,
      slug,
      official_name,
      flag,
      flag_url,
      image_url,
      cover_image_url,
      hero_image,
      tagline,
      motto,
      description,
      full_description,
      hero_images,
      gallery,
      short_notes,
      destination_count,
      activities,
      faqs,
      extra_info,
      language,
      timezone,
      currency,
      climate,
      best_time_to_visit,
      visa_info,
      key_facts,
      government,
      languages,
      climate_detail,
      geography,
      practical_info,
      wildlife,
      cuisine,
      ratings,
      highlights,
      experiences,
      travel_tips,
      neighboring_countries,
      demonym,
      is_featured,
      is_active,
    } = req.body;

    // Required fields validation
    if (!name || !code) {
      return res.status(400).json({
        success: false,
        error: "Name and code are required",
      });
    }

    const nameTrimmed = sanitizeString(name);
    const codeTrimmed = sanitizeString(code).toUpperCase();
    if (nameTrimmed.length === 0 || codeTrimmed.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Name and code cannot be empty after sanitization",
      });
    }

    if (codeTrimmed.length !== 2) {
      return res.status(400).json({
        success: false,
        error: "Country code must be exactly 2 characters",
      });
    }

    const slugValue = slug ? sanitizeString(slug) : slugify(nameTrimmed);
    if (!slugValue) {
      return res.status(400).json({
        success: false,
        error: "Unable to generate slug",
      });
    }

    const columns = [];
    const placeholders = [];
    const values = [];
    let paramIndex = 1;

    const addField = (col, val, isString = false) => {
      if (val !== undefined && val !== null) {
        columns.push(col);
        placeholders.push(`$${paramIndex++}`);
        values.push(isString ? sanitizeString(val) : val);
      }
    };

    addField("name", nameTrimmed, true);
    addField("code", codeTrimmed, true);
    addField("continent", continent, true);
    addField("region", region, true);
    addField("slug", slugValue, true);
    addField("official_name", official_name, true);
    addField("flag", flag, true);
    addField("flag_url", flag_url, true);
    addField("image_url", cleanCountryImage(image_url), true);
    addField("cover_image_url", cleanCountryImage(cover_image_url), true);
    addField("hero_image", cleanCountryImage(hero_image), true);
    addField("tagline", tagline, true);
    addField("motto", motto, true);
    addField("description", description, true);
    addField("full_description", full_description, true);
    addField("hero_images", cleanCountryImages(gallery || hero_images));
    addField("short_notes", short_notes, true);
    addField("destination_count", destination_count);
    addField("activities", Array.isArray(activities) || typeof activities === "object" ? JSON.stringify(activities) : activities);
    addField("faqs", Array.isArray(faqs) || typeof faqs === "object" ? JSON.stringify(faqs) : faqs);
    addField("extra_info", typeof extra_info === "object" ? JSON.stringify(extra_info) : extra_info);
    addField("language", language, true);
    addField("timezone", timezone, true);
    addField("currency", currency, true);
    addField("climate", climate, true);
    addField("best_time_to_visit", best_time_to_visit, true);
    addField("visa_info", visa_info, true);
    addField("key_facts", typeof key_facts === "object" ? JSON.stringify(key_facts) : key_facts);
    addField("government", typeof government === "object" ? JSON.stringify(government) : government);
    addField("languages", Array.isArray(languages) ? JSON.stringify(languages) : languages);
    addField("climate_detail", typeof climate_detail === "object" ? JSON.stringify(climate_detail) : climate_detail);
    addField("geography", typeof geography === "object" ? JSON.stringify(geography) : geography);
    addField("practical_info", typeof practical_info === "object" ? JSON.stringify(practical_info) : practical_info);
    addField("wildlife", typeof wildlife === "object" ? JSON.stringify(wildlife) : wildlife);
    addField("cuisine", typeof cuisine === "object" ? JSON.stringify(cuisine) : cuisine);
    addField("ratings", typeof ratings === "object" ? JSON.stringify(ratings) : ratings);
    addField("highlights", Array.isArray(highlights) ? JSON.stringify(highlights) : highlights);
    addField("experiences", Array.isArray(experiences) ? JSON.stringify(experiences) : experiences);
    addField("travel_tips", Array.isArray(travel_tips) ? JSON.stringify(travel_tips) : travel_tips);
    addField("neighboring_countries", Array.isArray(neighboring_countries) ? JSON.stringify(neighboring_countries) : neighboring_countries);
    addField("demonym", demonym, true);
    addField("is_featured", is_featured);
    addField("is_active", is_active);

    const queryText = `
      INSERT INTO countries (${columns.join(", ")})
      VALUES (${placeholders.join(", ")})
      RETURNING *
    `;

    const { rows } = await query(queryText, values);

    return res.status(201).json({
      success: true,
      data: rows[0],
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "Country with this code or slug already exists",
      });
    }
    logger.error("[Countries] create:", err.message);
    next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid country ID",
      });
    }

    const {
      name,
      code,
      continent,
      region,
      slug,
      official_name,
      flag,
      flag_url,
      image_url,
      cover_image_url,
      hero_image,
      tagline,
      motto,
      description,
      full_description,
      hero_images,
      gallery,
      short_notes,
      destination_count,
      activities,
      faqs,
      extra_info,
      language,
      timezone,
      currency,
      climate,
      best_time_to_visit,
      visa_info,
      key_facts,
      government,
      languages,
      climate_detail,
      geography,
      practical_info,
      wildlife,
      cuisine,
      ratings,
      highlights,
      experiences,
      travel_tips,
      neighboring_countries,
      demonym,
      is_featured,
      is_active,
    } = req.body;

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    const addField = (col, val, isString = false) => {
      if (val !== undefined && val !== null) {
        setClauses.push(`${col} = $${paramIndex++}`);
        values.push(isString ? sanitizeString(val) : val);
      }
    };

    if (name !== undefined) {
      const nameTrimmed = sanitizeString(name);
      if (nameTrimmed.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Name cannot be empty",
        });
      }
      addField("name", nameTrimmed, true);
    }
    if (code !== undefined) {
      const codeTrimmed = sanitizeString(code).toUpperCase();
      if (codeTrimmed.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Code cannot be empty",
        });
      }
      if (codeTrimmed.length !== 2) {
        return res.status(400).json({
          success: false,
          error: "Country code must be exactly 2 characters",
        });
      }
      addField("code", codeTrimmed, true);
    }
    if (slug !== undefined) {
      const slugValue = slug ? sanitizeString(slug) : slugify(sanitizeString(name || ""));
      if (!slugValue) {
        return res.status(400).json({
          success: false,
          error: "Unable to generate slug",
        });
      }
      addField("slug", slugValue, true);
    }

    addField("continent", continent, true);
    addField("region", region, true);
    addField("official_name", official_name, true);
    addField("flag", flag, true);
    addField("flag_url", flag_url, true);
    addField("image_url", cleanCountryImage(image_url), true);
    addField("cover_image_url", cleanCountryImage(cover_image_url), true);
    addField("hero_image", cleanCountryImage(hero_image), true);
    addField("tagline", tagline, true);
    addField("motto", motto, true);
    addField("description", description, true);
    addField("full_description", full_description, true);
    addField("hero_images", cleanCountryImages(gallery || hero_images));
    addField("short_notes", short_notes, true);
    addField("destination_count", destination_count);
    addField("activities", Array.isArray(activities) || typeof activities === "object" ? JSON.stringify(activities) : activities);
    addField("faqs", Array.isArray(faqs) || typeof faqs === "object" ? JSON.stringify(faqs) : faqs);
    addField("extra_info", typeof extra_info === "object" ? JSON.stringify(extra_info) : extra_info);
    addField("language", language, true);
    addField("timezone", timezone, true);
    addField("currency", currency, true);
    addField("climate", climate, true);
    addField("best_time_to_visit", best_time_to_visit, true);
    addField("visa_info", visa_info, true);
    addField("key_facts", typeof key_facts === "object" ? JSON.stringify(key_facts) : key_facts);
    addField("government", typeof government === "object" ? JSON.stringify(government) : government);
    addField("languages", Array.isArray(languages) ? JSON.stringify(languages) : languages);
    addField("climate_detail", typeof climate_detail === "object" ? JSON.stringify(climate_detail) : climate_detail);
    addField("geography", typeof geography === "object" ? JSON.stringify(geography) : geography);
    addField("practical_info", typeof practical_info === "object" ? JSON.stringify(practical_info) : practical_info);
    addField("wildlife", typeof wildlife === "object" ? JSON.stringify(wildlife) : wildlife);
    addField("cuisine", typeof cuisine === "object" ? JSON.stringify(cuisine) : cuisine);
    addField("ratings", typeof ratings === "object" ? JSON.stringify(ratings) : ratings);
    addField("highlights", Array.isArray(highlights) ? JSON.stringify(highlights) : highlights);
    addField("experiences", Array.isArray(experiences) ? JSON.stringify(experiences) : experiences);
    addField("travel_tips", Array.isArray(travel_tips) ? JSON.stringify(travel_tips) : travel_tips);
    addField("neighboring_countries", Array.isArray(neighboring_countries) ? JSON.stringify(neighboring_countries) : neighboring_countries);
    addField("demonym", demonym, true);
    addField("is_featured", is_featured);
    addField("is_active", is_active);

    if (setClauses.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid fields to update",
      });
    }

    // Set the placeholder index specifically for the WHERE clause to avoid index displacement
    const whereParamIndex = paramIndex;
    values.push(id); 

    const queryText = `
      UPDATE countries
      SET ${setClauses.join(", ")}
      WHERE id = $${whereParamIndex}
      RETURNING *
    `;

    const { rows } = await query(queryText, values);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Country not found",
      });
    }

    return res.json({
      success: true,
      data: rows[0],
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "Country with this code or slug already exists",
      });
    }
    logger.error("[Countries] update:", err.message);
    next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid country ID",
      });
    }

    const { rows } = await query(
      `DELETE FROM countries WHERE id = $1 RETURNING *`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Country not found",
      });
    }

    return res.json({
      success: true,
      data: rows[0],
      message: "Country deleted successfully",
    });
  } catch (err) {
    logger.error("[Countries] remove:", err.message);
    next(err);
  }
};

const getImages = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid country ID",
      });
    }

    const { rows } = await query(
      "SELECT hero_images FROM countries WHERE id = $1",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Country not found",
      });
    }

    let heroImages = rows[0].hero_images;
    if (typeof heroImages === 'string') {
      try {
        const parsed = JSON.parse(heroImages);
        if (Array.isArray(parsed)) {
          heroImages = parsed;
        } else {
          heroImages = [heroImages];
        }
      } catch (e) {
        heroImages = heroImages.split(',').map(s => s.trim()).filter(s => s !== '');
      }
    } else if (!Array.isArray(heroImages) && heroImages !== null) {
      heroImages = [heroImages];
    } else if (heroImages === null) {
      heroImages = [];
    }

    const images = urlsOnly(heroImages);

    return res.json({
      success: true,
      data: images,
    });
  } catch (err) {
    logger.error("[Countries] getImages:", err.message);
    next(err);
  }
};

module.exports = {
  getAll,
  getById,
  getOne,
  create,
  update,
  remove,
  getImages,
  getFeatured: async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT * FROM countries WHERE is_featured = true ORDER BY name`
      );
      return res.json({
        success: true,
        data: rows,
      });
    } catch (err) {
      logger.error("[Countries] getFeatured:", err.message);
      next(err);
    }
  },
  getByContinent: async (req, res, next) => {
    try {
      const { continent } = req.params;
      const { rows } = await query(
        `SELECT * FROM countries WHERE continent = $1 ORDER BY name`,
        [continent]
      );
      return res.json({
        success: true,
        data: rows,
      });
    } catch (err) {
      logger.error("[Countries] getByContinent:", err.message);
      next(err);
    }
  },
  getStats: async (req, res, next) => {
    try {
      const { rows: countRes } = await query(
        `SELECT COUNT(*) as total FROM countries`
      );
      const total = parseInt(countRes.rows[0].total, 10);

      const { rows: featuredRes } = await query(
        `SELECT COUNT(*) as featured FROM countries WHERE is_featured = true`
      );
      const featured = parseInt(featuredRes.rows[0].featured, 10);

      return res.json({
        success: true,
        data: {
          total,
          featured,
        },
      });
    } catch (err) {
      logger.error("[Countries] getStats:", err.message);
      next(err);
    }
  },
  bulkDelete: async (req, res, next) => {
    try {
      const { ids } = req.body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Please provide an array of country IDs to delete",
        });
      }

      const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
      const { rows } = await query(
        `DELETE FROM countries WHERE id IN (${placeholders}) RETURNING *`,
        ids
      );

      return res.json({
        success: true,
        data: rows,
        message: `${rows.length} countries deleted successfully`,
      });
    } catch (err) {
      logger.error("[Countries] bulkDelete:", err.message);
      next(err);
    }
  },
  toggleActive: async (req, res, next) => {
    try {
      const { id } = req.params;

      const { rows } = await query(
        `UPDATE countries SET is_active = NOT is_active WHERE id = $1 RETURNING *`,
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Country not found",
        });
      }

      return res.json({
        success: true,
        data: rows[0],
      });
    } catch (err) {
      logger.error("[Countries] toggleActive:", err.message);
      next(err);
    }
  },
  toggleFeatured: async (req, res, next) => {
    try {
      const { id } = req.params;

      const { rows } = await query(
        `UPDATE countries SET is_featured = NOT is_featured WHERE id = $1 RETURNING *`,
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Country not found",
        });
      }

      return res.json({
        success: true,
        data: rows[0],
      });
    } catch (err) {
      logger.error("[Countries] toggleFeatured:", err.message);
      next(err);
    }
  },
};

const cleanCountryImages = (value) => JSON.stringify(normalizeImages(value));
const cleanCountryImage = (value) => normalizeImages([value])[0]?.url || null;
const sanitizeCountryMedia = (country) => ({
  ...country,
  image_url: cleanCountryImage(country.image_url),
  cover_image_url: cleanCountryImage(country.cover_image_url),
  hero_image: cleanCountryImage(country.hero_image),
  hero_images: cleanCountryImages(country.hero_images),
});