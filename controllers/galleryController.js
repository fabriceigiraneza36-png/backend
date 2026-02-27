const { query } = require("../config/db");
const { paginate } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");

exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 24, category, country_id, destination_id } = req.query;

    let where = "WHERE g.is_active = true";
    const params = [];
    let idx = 1;

    if (category) { where += ` AND g.category = $${idx++}`; params.push(category); }
    if (country_id) { where += ` AND g.country_id = $${idx++}`; params.push(country_id); }
    if (destination_id) { where += ` AND g.destination_id = $${idx++}`; params.push(destination_id); }

    const countRes = await query(`SELECT COUNT(*) FROM gallery g ${where}`, params);
    const pagination = paginate(parseInt(countRes.rows[0].count), page, limit);

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT g.*, c.name AS country_name, d.name AS destination_name
       FROM gallery g
       LEFT JOIN countries c ON g.country_id = c.id
       LEFT JOIN destinations d ON g.destination_id = d.id
       ${where}
       ORDER BY g.is_featured DESC, g.sort_order ASC, g.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({ data: result.rows, pagination });
  } catch (err) {
    next(err);
  }
};

exports.getCategories = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT category, COUNT(*) AS count FROM gallery
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
    const result = await query("SELECT * FROM gallery WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Image not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { title, description, category, location, country_id, destination_id, photographer, is_featured } = req.body;
    const image_url = req.file ? getUploadedFileUrl(req.file) : req.body.image_url;

    if (!image_url) return res.status(400).json({ error: "Image is required" });

    const result = await query(
      `INSERT INTO gallery (title, description, image_url, category, location, country_id, destination_id, photographer, is_featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [title, description, image_url, category, location, country_id || null, destination_id || null, photographer, is_featured || false]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.bulkCreate = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    const { category, country_id, destination_id } = req.body;
    const images = [];

    for (const file of req.files) {
      const result = await query(
        `INSERT INTO gallery (image_url, category, country_id, destination_id)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [getUploadedFileUrl(file), category || null, country_id || null, destination_id || null]
      );
      images.push(result.rows[0]);
    }

    res.status(201).json({ data: images });
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
      `UPDATE gallery SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Image not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const result = await query("DELETE FROM gallery WHERE id = $1 RETURNING id", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Image not found" });
    res.json({ message: "Image deleted" });
  } catch (err) {
    next(err);
  }
};
