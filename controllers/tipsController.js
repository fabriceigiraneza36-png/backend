const { query } = require("../config/db");

exports.getAll = async (req, res, next) => {
  try {
    const { category } = req.query;
    let sql = "SELECT * FROM tips WHERE is_active = true";
    const params = [];

    if (category) {
      sql += " AND category = $1";
      params.push(category);
    }

    sql += " ORDER BY sort_order ASC, created_at DESC";
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.getCategories = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT category, COUNT(*) AS count FROM tips
       WHERE is_active = true AND category IS NOT NULL
       GROUP BY category ORDER BY count DESC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const result = await query("SELECT * FROM tips WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Tip not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { title, content, category, icon, image_url, sort_order } = req.body;
    const result = await query(
      `INSERT INTO tips (title, content, category, icon, image_url, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [title, content, category, icon, image_url, sort_order || 0]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    if (keys.length === 0) return res.status(400).json({ error: "No fields" });

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), id];

    const result = await query(
      `UPDATE tips SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Tip not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const result = await query("DELETE FROM tips WHERE id = $1 RETURNING id", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Tip not found" });
    res.json({ message: "Tip deleted" });
  } catch (err) {
    next(err);
  }
};