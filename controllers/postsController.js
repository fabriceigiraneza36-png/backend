const { query } = require("../config/db");
const { slugify, paginate, calculateReadTime } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");

exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, category, tag, search, sort = "created" } = req.query;

    let where = "WHERE is_published = true";
    const params = [];
    let idx = 1;

    if (category) { where += ` AND category = $${idx++}`; params.push(category); }
    if (tag) { where += ` AND $${idx++} = ANY(tags)`; params.push(tag); }
    if (search) {
      where += ` AND (title ILIKE $${idx} OR content ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countRes = await query(`SELECT COUNT(*) FROM posts ${where}`, params);
    const pagination = paginate(parseInt(countRes.rows[0].count), page, limit);

    const sortMap = {
      created: "published_at DESC NULLS LAST",
      views: "view_count DESC",
      title: "title ASC",
    };
    const orderBy = sortMap[sort] || "published_at DESC NULLS LAST";

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT id, title, slug, excerpt, image_url, author_name, author_avatar,
              category, tags, view_count, read_time, published_at, created_at
       FROM posts ${where}
       ORDER BY ${orderBy}
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
      `SELECT id, title, slug, excerpt, image_url, author_name, category, published_at
       FROM posts WHERE is_featured = true AND is_published = true
       ORDER BY published_at DESC LIMIT 5`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.getCategories = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT category, COUNT(*) AS count FROM posts
       WHERE is_published = true AND category IS NOT NULL
       GROUP BY category ORDER BY count DESC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
};

exports.getBySlug = async (req, res, next) => {
  try {
    const result = await query("SELECT * FROM posts WHERE slug = $1 AND is_published = true", [req.params.slug]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    await query("UPDATE posts SET view_count = view_count + 1 WHERE id = $1", [result.rows[0].id]);

    // related posts
    const related = await query(
      `SELECT id, title, slug, excerpt, image_url, published_at
       FROM posts WHERE category = $1 AND id != $2 AND is_published = true
       ORDER BY published_at DESC LIMIT 3`,
      [result.rows[0].category, result.rows[0].id]
    );

    res.json({ data: { ...result.rows[0], related_posts: related.rows } });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const {
      title, content, excerpt, author_name, author_avatar,
      category, tags, is_published, is_featured,
      meta_title, meta_description,
    } = req.body;

    const slug = slugify(title);
    const image_url = req.file ? getUploadedFileUrl(req.file) : req.body.image_url || null;
    const read_time = calculateReadTime(content);
    const published_at = is_published ? new Date() : null;

    const result = await query(
      `INSERT INTO posts
       (title, slug, content, excerpt, image_url, author_name, author_avatar,
        category, tags, is_published, is_featured, read_time, published_at,
        meta_title, meta_description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [title, slug, content, excerpt, image_url, author_name, author_avatar,
       category,
       tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : null,
       is_published || false, is_featured || false,
       read_time, published_at,
       meta_title, meta_description]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Post with this title already exists" });
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const fields = { ...req.body };

    if (fields.name) fields.slug = slugify(fields.title);
    if (fields.title) fields.slug = slugify(fields.title);
    if (fields.content) fields.read_time = calculateReadTime(fields.content);
    if (req.file) fields.image_url = getUploadedFileUrl(req.file);
    if (fields.tags && typeof fields.tags === "string") fields.tags = JSON.parse(fields.tags);
    if (fields.is_published === true || fields.is_published === "true") {
      const existing = await query("SELECT published_at FROM posts WHERE id = $1", [id]);
      if (!existing.rows[0]?.published_at) fields.published_at = new Date();
    }

    const keys = Object.keys(fields);
    if (keys.length === 0) return res.status(400).json({ error: "No fields to update" });

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), id];

    const result = await query(
      `UPDATE posts SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Post not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const result = await query("DELETE FROM posts WHERE id = $1 RETURNING id, title", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Post not found" });
    res.json({ message: "Post deleted", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};
