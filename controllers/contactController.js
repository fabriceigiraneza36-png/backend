const { query } = require("../config/db");
const { paginate } = require("../utils/helpers");
const { sendContactNotification } = require("../utils/email");

exports.create = async (req, res, next) => {
  try {
    const { full_name, email, phone, subject, message } = req.body;

    if (!full_name || !email || !message) {
      return res.status(400).json({ error: "Name, email, and message are required" });
    }

    const result = await query(
      `INSERT INTO contact_messages (full_name, email, phone, subject, message)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [full_name, email, phone, subject, message]
    );

    // Notify admin
    sendContactNotification(result.rows[0]).catch(() => {});

    res.status(201).json({ message: "Message sent successfully" });
  } catch (err) {
    next(err);
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, is_read } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;

    if (is_read !== undefined) {
      where += ` AND is_read = $${idx++}`;
      params.push(is_read === "true");
    }

    const countRes = await query(`SELECT COUNT(*) FROM contact_messages ${where}`, params);
    const pagination = paginate(parseInt(countRes.rows[0].count), page, limit);

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT * FROM contact_messages ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({ data: result.rows, pagination });
  } catch (err) {
    next(err);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const result = await query("SELECT * FROM contact_messages WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Message not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.markRead = async (req, res, next) => {
  try {
    const result = await query(
      "UPDATE contact_messages SET is_read = true WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Message not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const result = await query("DELETE FROM contact_messages WHERE id = $1 RETURNING id", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Message not found" });
    res.json({ message: "Message deleted" });
  } catch (err) {
    next(err);
  }
};