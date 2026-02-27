const { query } = require("../config/db");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");

exports.getAll = async (req, res, next) => {
  try {
    const result = await query(
      "SELECT * FROM team_members WHERE is_active = true ORDER BY sort_order ASC"
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const result = await query("SELECT * FROM team_members WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Member not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { name, role, bio, email, phone, social_links, sort_order } = req.body;
    const image_url = req.file ? getUploadedFileUrl(req.file) : req.body.image_url || null;

    const result = await query(
      `INSERT INTO team_members (name, role, bio, image_url, email, phone, social_links, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, role, bio, image_url, email, phone,
       social_links ? (typeof social_links === "string" ? social_links : JSON.stringify(social_links)) : "{}",
       sort_order || 0]
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
    if (req.file) fields.image_url = getUploadedFileUrl(req.file);
    if (fields.social_links && typeof fields.social_links === "object") {
      fields.social_links = JSON.stringify(fields.social_links);
    }

    const keys = Object.keys(fields);
    if (keys.length === 0) return res.status(400).json({ error: "No fields" });

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), id];

    const result = await query(
      `UPDATE team_members SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Member not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const result = await query("DELETE FROM team_members WHERE id = $1 RETURNING id", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Member not found" });
    res.json({ message: "Team member deleted" });
  } catch (err) {
    next(err);
  }
};
