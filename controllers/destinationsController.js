const { query } = require("../config/db");
const { slugify, paginate } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const serializeDestination = (row) => ({
  ...row,
  countryId: row.country_slug || row.country_id,
  mapPosition: {
    lat: toNumber(row.latitude),
    lng: toNumber(row.longitude),
  },
});

const resolveCountryDbId = async (countryIdOrSlug) => {
  if (countryIdOrSlug === null || countryIdOrSlug === undefined || countryIdOrSlug === "") {
    return null;
  }

  const asString = String(countryIdOrSlug).trim();
  if (/^\d+$/.test(asString)) {
    const countryRes = await query(
      "SELECT id FROM countries WHERE id = $1 AND is_active = true",
      [parseInt(asString, 10)]
    );
    return countryRes.rows[0]?.id || null;
  }

  const countryRes = await query(
    "SELECT id FROM countries WHERE slug = $1 AND is_active = true",
    [asString.toLowerCase()]
  );
  return countryRes.rows[0]?.id || null;
};

exports.getAll = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 12, category, country_id, search,
      sort = "-featured", min_rating, difficulty,
    } = req.query;

    let where = "WHERE d.is_active = true";
    const params = [];
    let idx = 1;

    if (category) { where += ` AND d.category = $${idx++}`; params.push(category); }
    if (country_id) {
      const resolvedCountryId = await resolveCountryDbId(country_id);
      if (!resolvedCountryId) {
        return res.json({ data: [], pagination: paginate(0, page, limit) });
      }
      where += ` AND d.country_id = $${idx++}`;
      params.push(resolvedCountryId);
    }
    if (difficulty) { where += ` AND d.difficulty = $${idx++}`; params.push(difficulty); }
    if (min_rating) { where += ` AND d.rating >= $${idx++}`; params.push(parseFloat(min_rating)); }
    if (search) {
      where += ` AND (d.name ILIKE $${idx} OR d.description ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countRes = await query(`SELECT COUNT(*) FROM destinations d ${where}`, params);
    const total = parseInt(countRes.rows[0].count);
    const pagination = paginate(total, page, limit);

    const sortMap = {
      name: "d.name ASC",
      "-name": "d.name DESC",
      rating: "d.rating DESC",
      created: "d.created_at DESC",
      "-featured": "d.is_featured DESC, d.rating DESC",
      views: "d.view_count DESC",
    };
    const orderBy = sortMap[sort] || "d.is_featured DESC, d.rating DESC";

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT d.*, c.name AS country_name, c.slug AS country_slug
       FROM destinations d
       LEFT JOIN countries c ON d.country_id = c.id
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({ data: result.rows.map(serializeDestination), pagination });
  } catch (err) {
    next(err);
  }
};

exports.getFeatured = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT d.*, c.name AS country_name, c.slug AS country_slug
       FROM destinations d
       LEFT JOIN countries c ON d.country_id = c.id
       WHERE d.is_featured = true AND d.is_active = true
       ORDER BY d.rating DESC LIMIT 8`
    );
    res.json({ data: result.rows.map(serializeDestination) });
  } catch (err) {
    next(err);
  }
};

exports.getCategories = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT category, COUNT(*) AS count
       FROM destinations WHERE is_active = true AND category IS NOT NULL
       GROUP BY category ORDER BY count DESC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.getMapData = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT d.id, d.name, d.slug, d.latitude, d.longitude, d.category,
              d.image_url, d.short_description, d.rating,
              c.name AS country_name
       FROM destinations d
       LEFT JOIN countries c ON d.country_id = c.id
       WHERE d.is_active = true AND d.latitude IS NOT NULL`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const isNumeric = /^\d+$/.test(idOrSlug);

    const result = await query(
      `SELECT d.*, c.name AS country_name, c.slug AS country_slug
       FROM destinations d
       LEFT JOIN countries c ON d.country_id = c.id
       WHERE ${isNumeric ? "d.id" : "d.slug"} = $1 AND d.is_active = true`,
      [isNumeric ? parseInt(idOrSlug) : idOrSlug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Destination not found" });
    }

    await query("UPDATE destinations SET view_count = view_count + 1 WHERE id = $1", [result.rows[0].id]);

    const images = await query(
      "SELECT * FROM destination_images WHERE destination_id = $1 ORDER BY sort_order",
      [result.rows[0].id]
    );

    res.json({ data: { ...serializeDestination(result.rows[0]), images: images.rows } });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const {
      country_id, name, description, short_description, category,
      latitude, longitude, rating, duration, difficulty, 
      highlights, best_season, is_featured,
    } = req.body;

    const slug = slugify(name);
    const image_url = req.file ? getUploadedFileUrl(req.file) : req.body.image_url || null;

    if (!country_id) {
      return res.status(400).json({ error: "country_id is required. Every location must belong to a country." });
    }
    const resolvedCountryId = await resolveCountryDbId(country_id);
    if (!resolvedCountryId) {
      return res.status(400).json({ error: "Invalid country_id. Country not found or inactive." });
    }

    const result = await query(
      `INSERT INTO destinations
       (country_id, name, slug, description, short_description, image_url,
        category, latitude, longitude, rating, duration, difficulty, 
        highlights, best_season, is_featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [resolvedCountryId, name, slug, description, short_description, image_url,
       category, latitude, longitude,       rating || 0, duration, difficulty,
       highlights ? (Array.isArray(highlights) ? highlights : JSON.parse(highlights)) : null,
       best_season, is_featured || false]
    );

    // update country destination count
    await query(
      `UPDATE countries SET destination_count = (
         SELECT COUNT(*) FROM destinations WHERE country_id = $1
       ) WHERE id = $1`,
      [resolvedCountryId]
    );

    res.status(201).json({ data: serializeDestination(result.rows[0]) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Destination with this name already exists" });
    }
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const fields = { ...req.body };

    if (fields.name) fields.slug = slugify(fields.name);
    if (req.file) fields.image_url = getUploadedFileUrl(req.file);
    if (fields.highlights && typeof fields.highlights === "string") {
      fields.highlights = JSON.parse(fields.highlights);
    }

    if (Object.prototype.hasOwnProperty.call(fields, "country_id")) {
      if (!fields.country_id) {
        return res.status(400).json({ error: "country_id cannot be empty. Every location must belong to a country." });
      }
      const resolvedCountryId = await resolveCountryDbId(fields.country_id);
      if (!resolvedCountryId) {
        return res.status(400).json({ error: "Invalid country_id. Country not found or inactive." });
      }
      fields.country_id = resolvedCountryId;
    }

    const keys = Object.keys(fields);
    if (keys.length === 0) return res.status(400).json({ error: "No fields to update" });

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), id];

    const result = await query(
      `UPDATE destinations SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Destination not found" });
    }
    res.json({ data: serializeDestination(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const result = await query(
      "DELETE FROM destinations WHERE id = $1 RETURNING id, name, country_id",
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Destination not found" });
    }
    if (result.rows[0].country_id) {
      await query(
        `UPDATE countries SET destination_count = (
           SELECT COUNT(*) FROM destinations WHERE country_id = $1
         ) WHERE id = $1`,
        [result.rows[0].country_id]
      );
    }
    res.json({ message: "Destination deleted", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.getImages = async (req, res, next) => {
  try {
    const result = await query(
      "SELECT * FROM destination_images WHERE destination_id = $1 ORDER BY sort_order",
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.addImages = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    const images = [];
    for (let i = 0; i < req.files.length; i++) {
      const result = await query(
        `INSERT INTO destination_images (destination_id, image_url, sort_order)
         VALUES ($1, $2, $3) RETURNING *`,
        [id, getUploadedFileUrl(req.files[i]), i]
      );
      images.push(result.rows[0]);
    }

    res.status(201).json({ data: images });
  } catch (err) {
    next(err);
  }
};

exports.removeImage = async (req, res, next) => {
  try {
    const result = await query(
      "DELETE FROM destination_images WHERE id = $1 RETURNING *",
      [req.params.imageId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Image not found" });
    }
    res.json({ message: "Image deleted" });
  } catch (err) {
    next(err);
  }
};
