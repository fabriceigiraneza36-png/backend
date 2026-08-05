// controllers/countriesController.js
"use strict";

const crypto = require("crypto");
const { query } = require("../config/db");
const logger = require("../utils/logger");
const { slugify } = require("../utils/slugify");
const slugify = require("../utils/slugify");

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    SAFE REQUIRE: HELPERS
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

let getCountryService;
let sanitizeInput;

try {
  ({
    getCountryService,
    sanitizeInput,
  } = require("../services/countryService"));
} catch (err) {
  logger.warn("[Countries] countryService not found â€” trying legacy paths:", err.message);

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
        logger.info(`[Countries] âœ… Using getCountryService from: ${p}`);
        break;
      }
      if (typeof mod.default === "object" && mod.default.getCountryService) {
        getCountryService = mod.default.getCountryService;
        logger.info(`[Countries] âœ… Using getCountryService from: ${p} (default export)`);
        break;
      }
    } catch {/* try next */}
  }

  if (!getCountryService) {
    logger.warn("[Countries] No countryService found â€” using stub");
    getCountryService = () => ({});
  }

  try {
    const mod = require("../utils/helpers");
    if (typeof mod.sanitizeInput === "function") {
      sanitizeInput = mod.sanitizeInput;
      logger.info("[Countries] âœ… Using sanitizeInput from: ../utils/helpers");
    }
  } catch (err) {
    logger.warn("[Countries] helpers not found â€” using basic sanitize", err.message);
    sanitizeInput = (input) => {
      if (typeof input !== "string") return "";
      return input
        .replace(/[<>]/g, "")
        .replace(/['"]/g, "")
        .trim();
    };
  }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    EXPORTS
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

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

    let validSortFields = ["name", "code", "continent", "region"];
    if (!validSortFields.includes(sortBy)) sortBy = "name";
    if (!["asc", "desc"].includes(order.toLowerCase())) order = "asc";

    const searchTerm = `%${search}%`;

    const { rows: dataRes, rowCount } = await query(
      `SELECT * FROM countries WHERE name ILIKE $1 OR code ILIKE $1 ORDER BY ${sortBy} ${order.toUpperCase()} LIMIT $2 OFFSET $3`,
      [searchTerm, limitNum, offset]
    );

    const { rows: countRes } = await query(
      `SELECT COUNT(*) FROM countries WHERE name ILIKE $1 OR code ILIKE $1`,
      [searchTerm]
    );

    const total = parseInt(countRes.rows[0].count, 10);

    return res.json({
      success: true,
      data: dataRes.rows,
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
      data: rows[0],
    });
  } catch (err) {
    logger.error("[Countries] getById:", err.message);
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
      tagline,
      motto,
      description,
      full_description,
      hero_images,
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
    } = req.body;

    // Required fields
    if (!name || !code) {
      return res.status(400).json({
        success: false,
        error: "Name and code are required",
      });
    }

    // Sanitize string fields
    const sanitizeString = (value) => {
      if (typeof value !== "string") return "";
      return value
        .replace(/[<>]/g, "")
        .replace(/['"]/g, "")
        .trim();
    };

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

    // Prepare columns and values for INSERT
    const columns = [];
    const values = [];
    let paramIndex = 1;

    const addField = (col, val, isString = false) => {
      if (val !== undefined && val !== null) {
        columns.push(`${col} = $${paramIndex++}`);
        values.push(isString ? sanitizeString(val) : val);
      }
    };

    // Add all fields
    addField("name", nameTrimmed, true);
    addField("code", codeTrimmed, true);
    addField("continent", continent, true);
    addField("region", region, true);
    addField("slug", slugValue, true);
    addField("official_name", official_name, true);
    addField("flag", flag, true);
    addField("flag_url", flag_url, true);
    addField("tagline", tagline, true);
    addField("motto", motto, true);
    addField("description", description, true);
    addField("full_description", full_description, true);
    addField("hero_images", hero_images);
    addField("short_notes", short_notes, true);
    addField("destination_count", destination_count);
    addField("activities", activities);
    addField("faqs", faqs);
    addField("extra_info", extra_info);
    addField("language", language, true);
    addField("timezone", timezone, true);
    addField("currency", currency, true);
    addField("climate", climate, true);
    addField("best_time_to_visit", best_time_to_visit, true);
    addField("visa_info", visa_info, true);
    addField("key_facts", key_facts);
    addField("government", government);
    addField("languages", languages);
    addField("climate_detail", climate_detail);
    addField("geography", geography);
    addField("practical_info", practical_info);
    addField("wildlife", wildlife);
    addField("cuisine", cuisine);
    addField("ratings", ratings);
    addField("highlights", highlights);
    addField("experiences", experiences);
    addField("travel_tips", travel_tips);
    addField("neighboring_countries", neighboring_countries);
    addField("demonym", demonym, true);
    addField("is_featured", is_featured);

    // Build query
    const queryText = `
      INSERT INTO columns (${columns.map((c) => c.split(" =")[0]).join(", ")})
      VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})
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
        error: "Country with this code already exists",
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
      tagline,
      motto,
      description,
      full_description,
      hero_images,
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
    } = req.body;

    // Sanitize string fields
    const sanitizeString = (value) => {
      if (typeof value !== "string") return "";
      return value
        .replace(/[<>]/g, "")
        .replace(/['"]/g, "")
        .trim();
    };

    // Build SET clause
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    const addField = (col, val, isString = false) => {
      if (val !== undefined && val !== null) {
        setClauses.push(`${col} = $${paramIndex++}`);
        values.push(isString ? sanitizeString(val) : val);
      }
    };

    // Handle each field
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
    addField("tagline", tagline, true);
    addField("motto", motto, true);
    addField("description", description, true);
    addField("full_description", full_description, true);
    addField("hero_images", hero_images);
    addField("short_notes", short_notes, true);
    addField("destination_count", destination_count);
    addField("activities", activities);
    addField("faqs", faqs);
    addField("extra_info", extra_info);
    addField("language", language, true);
    addField("timezone", timezone, true);
    addField("currency", currency, true);
    addField("climate", climate, true);
    addField("best_time_to_visit", best_time_to_visit, true);
    addField("visa_info", visa_info, true);
    addField("key_facts", key_facts);
    addField("government", government);
    addField("languages", languages);
    addField("climate_detail", climate_detail);
    addField("geography", geography);
    addField("practical_info", practical_info);
    addField("wildlife", wildlife);
    addField("cuisine", cuisine);
    addField("ratings", ratings);
    addField("highlights", highlights);
    addField("experiences", experiences);
    addField("travel_tips", travel_tips);
    addField("neighboring_countries", neighboring_countries);
    addField("demonym", demonym, true);
    addField("is_featured", is_featured);

    if (setClauses.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid fields to update",
      });
    }

    values.push(id); // for WHERE clause

    const queryText = `
      UPDATE countries
      SET ${setClauses.join(", ")}
      WHERE id = $${params.length}
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
        error: "Country with this code already exists",
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
// Function to get images for a country by ID
    // Function to get images for a country by ID
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
          \SELECT hero_images FROM countries WHERE id = \,
          [id]
        );
        
        if (rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: "Country not found",
          });
        }
        
        let heroImages = rows[0].hero_images;
        // If it's a string, try to parse as JSON
        if (typeof heroImages === 'string') {
          try {
            const parsed = JSON.parse(heroImages);
            if (Array.isArray(parsed)) {
              heroImages = parsed;
            } else {
              // If not an array, treat as a single string and split by commas if needed
              heroImages = [heroImages];
            }
          } catch (e) {
            // If JSON parsing fails, split by comma and trim
            heroImages = heroImages.split(',').map(s => s.trim()).filter(s => s !== '');
          }
        } else if (!Array.isArray(heroImages)) {
          // If it's not a string and not an array, wrap in an array
          heroImages = [heroImages];
        }
        
        // Filter out empty strings and ensure each item is a string
        const images = heroImages
          .filter(img => typeof img === 'string' && img.trim() !== '')
          .map(img => img.trim());
        
        return res.json({
          success: true,
          data: images,
        });
      } catch (err) {
        logger.error("[Countries] getImages:", err.message);
        next(err);
      }
    };
    // Function to get images for a country by ID
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
          \SELECT hero_images FROM countries WHERE id = \,
          [id]
        );
        
        if (rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: "Country not found",
          });
        }
        
        let heroImages = rows[0].hero_images;
        // If it's a string, try to parse as JSON
        if (typeof heroImages === 'string') {
          try {
            const parsed = JSON.parse(heroImages);
            if (Array.isArray(parsed)) {
              heroImages = parsed;
            } else {
              // If not an array, treat as a single string and split by commas if needed
              heroImages = [heroImages];
            }
          } catch (e) {
            // If JSON parsing fails, split by comma and trim
            heroImages = heroImages.split(',').map(s => s.trim()).filter(s => s !== '');
          }
        } else if (!Array.isArray(heroImages)) {
          // If it's not a string and not an array, wrap in an array
          heroImages = [heroImages];
        }
        
        // Filter out empty strings and ensure each item is a string
        const images = heroImages
          .filter(img => typeof img === 'string' && img.trim() !== '')
          .map(img => img.trim());
        
        return res.json({
          success: true,
          data: images,
        });
      } catch (err) {
        logger.error("[Countries] getImages:", err.message);
        next(err);
      }
    };
};
