const { query } = require("../config/db");
const { paginate } = require("../utils/helpers");

exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, featured } = req.query;
    let where = "WHERE is_active = true";
    const params = [];
    let idx = 1;

    if (featured !== undefined) {
      where += ` AND is_featured = $${idx++}`;
      params.push(featured === "true");
    }

    const countRes = await query(`SELECT COUNT(*) FROM testimonials ${where}`, params);
    const pagination = paginate(parseInt(countRes.rows[0].count, 10), page, limit);

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT *
       FROM testimonials
       ${where}
       ORDER BY is_featured DESC, sort_order ASC, id ASC
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({ data: result.rows, pagination });
  } catch (err) {
    next(err);
  }
};

exports.getFeatured = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT *
       FROM testimonials
       WHERE is_active = true AND is_featured = true
       ORDER BY sort_order ASC, id ASC
       LIMIT 12`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const result = await query("SELECT * FROM testimonials WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Testimonial not found" });
    }
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const {
      name,
      location,
      avatar_url,
      rating = 5,
      trip,
      date_text,
      testimonial_text,
      is_featured = false,
      is_active = true,
      sort_order = 0,
    } = req.body;

    if (!name || !testimonial_text) {
      return res.status(400).json({ error: "name and testimonial_text are required" });
    }

    const result = await query(
      `INSERT INTO testimonials
       (name, location, avatar_url, rating, trip, date_text, testimonial_text, is_featured, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [name, location || null, avatar_url || null, rating, trip || null, date_text || null, testimonial_text, is_featured, is_active, sort_order]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const fields = { ...req.body };
    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), req.params.id];

    const result = await query(
      `UPDATE testimonials
       SET ${setClause}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Testimonial not found" });
    }

    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const result = await query("DELETE FROM testimonials WHERE id = $1 RETURNING id", [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Testimonial not found" });
    }
    res.json({ message: "Testimonial deleted" });
  } catch (err) {
    next(err);
  }
};
