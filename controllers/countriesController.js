const { query } = require("../config/db");
const { slugify, paginate } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");

const resolveIdOrSlug = (params) => params.idOrSlug || params.id;
const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const serializeCountry = (row) => ({
  ...row,
  countryId: row.slug || String(row.id),
  heroImage: row.cover_image_url || row.image_url || null,
  bestTime: row.best_time_to_visit || null,
  mapPosition: {
    lat: toNumber(row.latitude),
    lng: toNumber(row.longitude),
  },
  destination_count: parseInt(row.destination_count || 0, 10),
});

exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, featured, continent, search } = req.query;

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
    if (search) {
      where += ` AND (c.name ILIKE $${idx} OR c.description ILIKE $${idx} OR c.capital ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countRes = await query(`SELECT COUNT(*) FROM countries c ${where}`, params);
    const pagination = paginate(parseInt(countRes.rows[0].count, 10), page, limit);

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT c.*
       FROM countries c
       ${where}
       ORDER BY c.is_featured DESC, c.name ASC
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({ data: result.rows.map(serializeCountry), pagination });
  } catch (err) {
    next(err);
  }
};

exports.getFeatured = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.*
       FROM countries c
       WHERE c.is_active = true AND c.is_featured = true
       ORDER BY c.name ASC
       LIMIT 12`
    );
    res.json({ data: result.rows.map(serializeCountry) });
  } catch (err) {
    next(err);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const idOrSlug = resolveIdOrSlug(req.params);
    const isNumeric = /^\d+$/.test(String(idOrSlug));

    const result = await query(
      `SELECT c.*
       FROM countries c
       WHERE ${isNumeric ? "c.id" : "c.slug"} = $1 AND c.is_active = true`,
      [isNumeric ? parseInt(idOrSlug, 10) : String(idOrSlug).toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Country not found" });
    }

    const country = result.rows[0];
    const destCount = await query(
      "SELECT COUNT(*) FROM destinations WHERE country_id = $1 AND is_active = true",
      [country.id]
    );

    res.json({
      data: {
        ...serializeCountry(country),
        destination_count: parseInt(destCount.rows[0].count, 10),
      },
    });
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
        mapPosition: {
          lat: toNumber(row.latitude),
          lng: toNumber(row.longitude),
        },
      })),
      pagination,
      country,
    });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const {
      name,
      description,
      short_description,
      image_url,
      cover_image_url,
      flag_url,
      continent,
      capital,
      currency,
      language,
      timezone,
      best_time_to_visit,
      visa_info,
      latitude,
      longitude,
      is_featured,
      is_active,
    } = req.body;

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Country name is required." });
    }

    const slug = slugify(name);
    const uploadedImage = req.file ? getUploadedFileUrl(req.file) : null;
    const finalImageUrl = uploadedImage || image_url || null;

    const result = await query(
      `INSERT INTO countries
       (name, slug, description, short_description, image_url, cover_image_url, flag_url,
        continent, capital, currency, language, timezone, best_time_to_visit, visa_info,
        latitude, longitude, is_featured, is_active)
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        String(name).trim(),
        slug,
        description || null,
        short_description || null,
        finalImageUrl,
        cover_image_url || null,
        flag_url || null,
        continent || null,
        capital || null,
        currency || null,
        language || null,
        timezone || null,
        best_time_to_visit || null,
        visa_info || null,
        latitude || null,
        longitude || null,
        Boolean(is_featured),
        is_active === undefined ? true : Boolean(is_active),
      ]
    );

    res.status(201).json({ data: serializeCountry(result.rows[0]) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Country already exists." });
    }
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
    if (req.file) {
      updates.image_url = getUploadedFileUrl(req.file);
    }

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return res.status(400).json({ error: "No fields to update." });
    }

    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(", ");
    const values = [...keys.map((key) => updates[key]), id];

    const result = await query(
      `UPDATE countries
       SET ${setClause}
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
    const depRes = await query("SELECT COUNT(*) FROM destinations WHERE country_id = $1", [id]);
    const dependentCount = parseInt(depRes.rows[0].count, 10);

    if (dependentCount > 0) {
      return res.status(409).json({
        error: "Cannot delete country with existing locations/destinations. Reassign or remove them first.",
      });
    }

    const result = await query("DELETE FROM countries WHERE id = $1 RETURNING id, name", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Country not found." });
    }

    res.json({ message: "Country deleted successfully.", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};
