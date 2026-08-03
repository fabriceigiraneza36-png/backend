// controllers/countriesController.js
"use strict";

const crypto = require("crypto");
const { query } = require("../config/db");
const logger = require("../utils/logger");

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
    SAFE REQUIRE: HELPERS
══════════════════════════════════════════════════════════════════════════════════════════════ */

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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
    EXPORTS
═════════════════════════════════════════════════════════════════════════════════════════════ */

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
    const { name, code, continent, region } = req.body;

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        error: "Name and code are required",
      });
    }

    const nameTrimmed = sanitizeInput(name);
    const codeTrimmed = sanitizeInput(code).toUpperCase();
    const continentTrimmed = sanitizeInput(continent);
    const regionTrimmed = sanitizeInput(region);

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

    const { rows } = await query(
      `INSERT INTO countries (name, code, continent, region) VALUES ($1, $2, $3, $4) RETURNING *`,
      [nameTrimmed, codeTrimmed, continentTrimmed, regionTrimmed]
    );

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
    const { name, code, continent, region } = req.body;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid country ID",
      });
    }

    const nameTrimmed = name ? sanitizeInput(name) : undefined;
    const codeTrimmed = code ? sanitizeInput(code).toUpperCase() : undefined;
    const continentTrimmed = continent ? sanitizeInput(continent) : undefined;
    const regionTrimmed = region ? sanitizeInput(region) : undefined;

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (nameTrimmed !== undefined) {
      if (nameTrimmed.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Name cannot be empty",
        });
      }
      updates.push(`name = $${paramIndex++}`);
      values.push(nameTrimmed);
    }

    if (codeTrimmed !== undefined) {
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
      updates.push(`code = $${paramIndex++}`);
      values.push(codeTrimmed);
    }

    if (continentTrimmed !== undefined) {
      updates.push(`continent = $${paramIndex++}`);
      values.push(continentTrimmed);
    }

    if (regionTrimmed !== undefined) {
      updates.push(`region = $${paramIndex++}`);
      values.push(regionTrimmed);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid fields to update",
      });
    }

    values.push(id);

    const { rows } = await query(
      `UPDATE countries SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
      values
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
    EXPORTS
═══════════════════════════════════════════════════════════════════════════════════════════════ */

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
};