const { query } = require("../config/db");
const { slugify } = require("../utils/helpers");

exports.getAll = async (req, res, next) => {
  try {
    const result = await query(
      "SELECT * FROM services WHERE is_active = true ORDER BY sort_order ASC"
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.getFeatured = async (req, res, next) => {
  try {
    const result = await query(
      "SELECT * FROM services WHERE is_featured = true AND is_active = true ORDER BY sort_order LIMIT 6"
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
      `SELECT * FROM services WHERE ${isNumeric ? "id" : "slug"} = $1 AND is_active = true`,
      [isNumeric ? parseInt(idOrSlug) : idOrSlug]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Service not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { title, description, short_description, icon, image_url, features, is_featured, sort_order } = req.body;
    const slug = slugify(title);
    const result = await query(
      `INSERT INTO services (title, slug, description, short_description, icon, image_url, features, is_featured, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [title, slug, description, short_description, icon, image_url,
       features ? (Array.isArray(features) ? features : JSON.parse(features)) : null,
       is_featured || false, sort_order || 0]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const fields = { ...req.body };
    if (fields.title) fields.slug = slugify(fields.title);
    if (fields.features && typeof fields.features === "string") fields.features = JSON.parse(fields.features);

    const keys = Object.keys(fields);
    if (keys.length === 0) return res.status(400).json({ error: "No fields" });

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), id];

    const result = await query(
      `UPDATE services SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Service not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const result = await query("DELETE FROM services WHERE id = $1 RETURNING id", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Service not found" });
    res.json({ message: "Service deleted" });
  } catch (err) {
    next(err);
  }
};