const { query } = require("../config/db");
const { slugify } = require("../utils/helpers");

const parseArray = (value) => {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      } catch {
        return [];
      }
    }
    return trimmed.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [];
};

const parseNumber = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const serializeTip = (row) => ({
  ...row,
  title: row.headline,
  content: row.body || row.summary,
});

exports.getAll = async (req, res, next) => {
  try {
    const { category, trip_phase, featured } = req.query;
    let sql = "SELECT * FROM tips WHERE is_active = true";
    const params = [];
    let idx = 1;

    if (category) {
      sql += ` AND category = $${idx++}`;
      params.push(category);
    }
    if (trip_phase) {
      sql += ` AND trip_phase = $${idx++}`;
      params.push(trip_phase);
    }
    if (featured === "true") {
      sql += " AND is_featured = true";
    }

    sql += " ORDER BY priority_level ASC, sort_order ASC, created_at DESC";
    const result = await query(sql, params);
    res.json({ data: result.rows.map(serializeTip) });
  } catch (err) {
    next(err);
  }
};

exports.getCategories = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT category, COUNT(*) AS count
       FROM tips
       WHERE is_active = true AND category IS NOT NULL
       GROUP BY category
       ORDER BY count DESC, category ASC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isNumeric = /^\d+$/.test(String(id));
    const result = await query(
      `SELECT * FROM tips WHERE ${isNumeric ? "id" : "slug"} = $1`,
      [isNumeric ? parseInt(id, 10) : id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Tip not found" });
    res.json({ data: serializeTip(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const {
      headline,
      title,
      summary,
      body,
      content,
      category,
      trip_phase,
      audience,
      difficulty_level,
      priority_level,
      read_time_minutes,
      checklist,
      tags,
      icon,
      image_url,
      source_url,
      cta_text,
      cta_url,
      sort_order,
      is_featured,
      is_active,
    } = req.body;

    const finalHeadline = headline || title;
    const finalSummary = summary || content || body;
    if (!finalHeadline || !finalSummary) {
      return res.status(400).json({ error: "headline (or title) and summary (or content) are required" });
    }

    const finalSlug = slugify(finalHeadline);
    const result = await query(
      `INSERT INTO tips
       (headline, slug, summary, body, category, trip_phase, audience, difficulty_level,
        priority_level, read_time_minutes, checklist, tags, icon, image_url, source_url,
        cta_text, cta_url, sort_order, is_featured, is_active)
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        finalHeadline,
        finalSlug,
        finalSummary,
        body || content || null,
        category || null,
        trip_phase || null,
        audience || "all-travelers",
        difficulty_level || "all-levels",
        parseNumber(priority_level, 3),
        parseNumber(read_time_minutes, 3),
        parseArray(checklist),
        parseArray(tags),
        icon || null,
        image_url || null,
        source_url || null,
        cta_text || null,
        cta_url || null,
        parseNumber(sort_order, 0),
        Boolean(is_featured),
        is_active !== false,
      ]
    );
    res.status(201).json({ data: serializeTip(result.rows[0]) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Tip with this headline already exists" });
    }
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const input = { ...req.body };
    const fields = {};

    if (input.headline || input.title) {
      const finalHeadline = input.headline || input.title;
      fields.headline = finalHeadline;
      fields.slug = slugify(finalHeadline);
    }
    if (Object.prototype.hasOwnProperty.call(input, "summary")) fields.summary = input.summary;
    if (Object.prototype.hasOwnProperty.call(input, "body")) fields.body = input.body;
    if (Object.prototype.hasOwnProperty.call(input, "content") && !fields.body) fields.body = input.content;
    if (Object.prototype.hasOwnProperty.call(input, "category")) fields.category = input.category;
    if (Object.prototype.hasOwnProperty.call(input, "trip_phase")) fields.trip_phase = input.trip_phase;
    if (Object.prototype.hasOwnProperty.call(input, "audience")) fields.audience = input.audience;
    if (Object.prototype.hasOwnProperty.call(input, "difficulty_level")) fields.difficulty_level = input.difficulty_level;
    if (Object.prototype.hasOwnProperty.call(input, "priority_level")) fields.priority_level = parseNumber(input.priority_level, 3);
    if (Object.prototype.hasOwnProperty.call(input, "read_time_minutes")) fields.read_time_minutes = parseNumber(input.read_time_minutes, 3);
    if (Object.prototype.hasOwnProperty.call(input, "checklist")) fields.checklist = parseArray(input.checklist);
    if (Object.prototype.hasOwnProperty.call(input, "tags")) fields.tags = parseArray(input.tags);
    if (Object.prototype.hasOwnProperty.call(input, "icon")) fields.icon = input.icon;
    if (Object.prototype.hasOwnProperty.call(input, "image_url")) fields.image_url = input.image_url;
    if (Object.prototype.hasOwnProperty.call(input, "source_url")) fields.source_url = input.source_url;
    if (Object.prototype.hasOwnProperty.call(input, "cta_text")) fields.cta_text = input.cta_text;
    if (Object.prototype.hasOwnProperty.call(input, "cta_url")) fields.cta_url = input.cta_url;
    if (Object.prototype.hasOwnProperty.call(input, "sort_order")) fields.sort_order = parseNumber(input.sort_order, 0);
    if (Object.prototype.hasOwnProperty.call(input, "is_featured")) fields.is_featured = Boolean(input.is_featured);
    if (Object.prototype.hasOwnProperty.call(input, "is_active")) fields.is_active = Boolean(input.is_active);

    const keys = Object.keys(fields);
    if (keys.length === 0) return res.status(400).json({ error: "No fields" });

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), id];

    const result = await query(
      `UPDATE tips SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Tip not found" });
    res.json({ data: serializeTip(result.rows[0]) });
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
