const { query } = require("../config/db");
const { slugify } = require("../utils/helpers");

exports.getBySlug = async (req, res, next) => {
  try {
    const result = await query(
      "SELECT * FROM pages WHERE slug = $1 AND is_published = true",
      [req.params.slug]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Page not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const result = await query("SELECT * FROM pages ORDER BY title ASC");
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { title, content, meta_title, meta_description, is_published } = req.body;
    const slug = slugify(title);

    const result = await query(
      `INSERT INTO pages (title, slug, content, meta_title, meta_description, is_published)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [title, slug, content, meta_title, meta_description, is_published !== false]
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

    const keys = Object.keys(fields);
    if (keys.length === 0) return res.status(400).json({ error: "No fields" });

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), id];

    const result = await query(
      `UPDATE pages SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Page not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const result = await query("DELETE FROM pages WHERE id = $1 RETURNING id", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Page not found" });
    res.json({ message: "Page deleted" });
  } catch (err) {
    next(err);
  }
};