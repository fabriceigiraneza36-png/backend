// controllers/galleryController.js
const { query } = require("../config/db");
const { paginate } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");

// ─── Allowed sort options (prevent SQL injection) ───────────────────────────
const SORT_OPTIONS = {
  newest: "g.created_at DESC",
  oldest: "g.created_at ASC",
  featured: "g.is_featured DESC, g.sort_order ASC, g.created_at DESC",
  popular: "g.view_count DESC, g.created_at DESC",
  title_asc: "g.title ASC NULLS LAST",
  title_desc: "g.title DESC NULLS LAST",
};

const DEFAULT_SORT = SORT_OPTIONS.featured;

// ─── Allowed filter fields (whitelist) ──────────────────────────────────────
const ALLOWED_FILTERS = [
  "category",
  "country_id",
  "destination_id",
  "photographer",
  "is_featured",
  "source",
];

// ─── Helper: build WHERE clause from query params ───────────────────────────
function buildWhereClause(queryParams) {
  const conditions = ["g.is_active = true"];
  const params = [];
  let idx = 1;

  for (const field of ALLOWED_FILTERS) {
    const value = queryParams[field];
    if (value === undefined || value === "") continue;

    if (field === "is_featured") {
      conditions.push(`g.is_featured = $${idx++}`);
      params.push(value === "true" || value === "1");
    } else {
      conditions.push(`g.${field} = $${idx++}`);
      params.push(value);
    }
  }

  // Tag filter: ?tag=adventure → WHERE 'adventure' = ANY(g.tags)
  if (queryParams.tag) {
    conditions.push(`$${idx++} = ANY(g.tags)`);
    params.push(queryParams.tag);
  }

  // Full-text search: ?search=safari
  if (queryParams.search) {
    conditions.push(
      `to_tsvector('english', COALESCE(g.title,'') || ' ' || COALESCE(g.description,'')) @@ plainto_tsquery('english', $${idx++})`
    );
    params.push(queryParams.search);
  }

  return { where: `WHERE ${conditions.join(" AND ")}`, params, nextIdx: idx };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/gallery
// ═══════════════════════════════════════════════════════════════════════════
exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 24, sort = "featured" } = req.query;

    const { where, params, nextIdx } = buildWhereClause(req.query);
    const orderBy = SORT_OPTIONS[sort] || DEFAULT_SORT;

    // Count
    const countRes = await query(
      `SELECT COUNT(*) FROM gallery g ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count, 10);
    const pagination = paginate(total, page, limit);

    // Data
    const dataParams = [...params, pagination.limit, pagination.offset];
    const result = await query(
      `SELECT
         g.id,
         g.title,
         g.slug,
         g.description,
         g.image_url,
         g.thumbnail_url,
         g.alt_text,
         g.category::TEXT,
         g.tags,
         g.location,
         g.country_id,
         c.name            AS country_name,
         g.destination_id,
         d.name            AS destination_name,
         g.photographer,
         g.is_featured,
         g.sort_order,
         g.view_count,
         g.width,
         g.height,
         g.blurhash,
         g.created_at,
         g.updated_at
       FROM gallery g
       LEFT JOIN countries c    ON g.country_id     = c.id
       LEFT JOIN destinations d ON g.destination_id = d.id
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      dataParams
    );

    res.json({
      success: true,
      data: result.rows,
      pagination,
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/gallery/categories
// ═══════════════════════════════════════════════════════════════════════════
exports.getCategories = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         category::TEXT,
         COUNT(*)::INTEGER AS count,
         MIN(image_url) AS sample_image
       FROM gallery
       WHERE is_active = true AND category IS NOT NULL
       GROUP BY category
       ORDER BY count DESC`
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/gallery/tags
// ═══════════════════════════════════════════════════════════════════════════
exports.getTags = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT UNNEST(tags) AS tag, COUNT(*)::INTEGER AS count
       FROM gallery
       WHERE is_active = true
       GROUP BY tag
       ORDER BY count DESC
       LIMIT 50`
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/gallery/:idOrSlug
// ═══════════════════════════════════════════════════════════════════════════
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Support lookup by numeric ID or slug
    const isNumeric = /^\d+$/.test(id);
    const condition = isNumeric ? "g.id = $1" : "g.slug = $1";
    const param = isNumeric ? parseInt(id, 10) : id;

    const result = await query(
      `SELECT
         g.*,
         g.category::TEXT,
         c.name AS country_name,
         d.name AS destination_name
       FROM gallery g
       LEFT JOIN countries c    ON g.country_id     = c.id
       LEFT JOIN destinations d ON g.destination_id = d.id
       WHERE ${condition}`,
      [param]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Image not found" });
    }

    // Increment view count in background (non-blocking)
    query("SELECT gallery_increment_views($1)", [result.rows[0].id]).catch(
      () => {}
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/gallery
// ═══════════════════════════════════════════════════════════════════════════
exports.create = async (req, res, next) => {
  try {
    const {
      title,
      description,
      category,
      tags,
      location,
      country_id,
      destination_id,
      photographer,
      credit_url,
      is_featured,
      sort_order,
      width,
      height,
      file_size,
      mime_type,
      blurhash,
    } = req.body;

    const image_url = req.file
      ? getUploadedFileUrl(req.file)
      : req.body.image_url;

    if (!image_url) {
      return res
        .status(400)
        .json({ success: false, error: "Image is required" });
    }

    // Parse tags: accept JSON array string or comma-separated
    let parsedTags = [];
    if (tags) {
      try {
        parsedTags = JSON.parse(tags);
      } catch {
        parsedTags = String(tags)
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
      }
    }

    const result = await query(
      `INSERT INTO gallery (
         title, description, image_url, category, tags, location,
         country_id, destination_id, photographer, credit_url,
         is_featured, sort_order, width, height, file_size,
         mime_type, blurhash
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10,
         $11, $12, $13, $14, $15,
         $16, $17
       ) RETURNING *`,
      [
        title || null,
        description || null,
        image_url,
        category || "other",
        parsedTags,
        location || null,
        country_id || null,
        destination_id || null,
        photographer || null,
        credit_url || null,
        is_featured === "true" || is_featured === true || false,
        parseInt(sort_order, 10) || 0,
        width ? parseInt(width, 10) : null,
        height ? parseInt(height, 10) : null,
        file_size ? parseInt(file_size, 10) : null,
        mime_type || (req.file ? req.file.mimetype : null),
        blurhash || null,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/gallery/bulk
// ═══════════════════════════════════════════════════════════════════════════
exports.bulkCreate = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No images uploaded" });
    }

    const { category, country_id, destination_id, tags } = req.body;

    let parsedTags = [];
    if (tags) {
      try {
        parsedTags = JSON.parse(tags);
      } catch {
        parsedTags = String(tags)
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
      }
    }

    // Build a single multi-row INSERT for performance
    const values = [];
    const placeholders = [];
    let idx = 1;

    for (const file of req.files) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
      );
      values.push(
        getUploadedFileUrl(file),
        category || "other",
        country_id || null,
        destination_id || null,
        parsedTags
      );
    }

    const result = await query(
      `INSERT INTO gallery (image_url, category, country_id, destination_id, tags)
       VALUES ${placeholders.join(", ")}
       RETURNING *`,
      values
    );

    res.status(201).json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/gallery/:id
// ═══════════════════════════════════════════════════════════════════════════
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Whitelist allowed fields
    const ALLOWED_UPDATE_FIELDS = [
      "title",
      "description",
      "image_url",
      "thumbnail_url",
      "alt_text",
      "category",
      "tags",
      "location",
      "country_id",
      "destination_id",
      "photographer",
      "credit_url",
      "source",
      "is_featured",
      "is_active",
      "sort_order",
      "width",
      "height",
      "file_size",
      "mime_type",
      "blurhash",
      "latitude",
      "longitude",
    ];

    const fields = {};

    for (const key of ALLOWED_UPDATE_FIELDS) {
      if (req.body[key] !== undefined) {
        fields[key] = req.body[key];
      }
    }

    // Handle file upload override
    if (req.file) {
      fields.image_url = getUploadedFileUrl(req.file);
    }

    // Parse special fields
    if (fields.tags && typeof fields.tags === "string") {
      try {
        fields.tags = JSON.parse(fields.tags);
      } catch {
        fields.tags = fields.tags
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
      }
    }

    if (fields.is_featured !== undefined) {
      fields.is_featured =
        fields.is_featured === "true" || fields.is_featured === true;
    }

    if (fields.is_active !== undefined) {
      fields.is_active =
        fields.is_active === "true" || fields.is_active === true;
    }

    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No valid fields to update" });
    }

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), parseInt(id, 10)];

    const result = await query(
      `UPDATE gallery SET ${sets}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Image not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/gallery/:id
// ═══════════════════════════════════════════════════════════════════════════
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Soft-delete option: set is_active = false instead of removing
    const { permanent } = req.query;

    if (permanent === "true") {
      const result = await query(
        "DELETE FROM gallery WHERE id = $1 RETURNING id, title, image_url",
        [parseInt(id, 10)]
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Image not found" });
      }

      return res.json({
        success: true,
        message: "Image permanently deleted",
        data: result.rows[0],
      });
    }

    // Default: soft delete
    const result = await query(
      "UPDATE gallery SET is_active = false WHERE id = $1 RETURNING id, title",
      [parseInt(id, 10)]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Image not found" });
    }

    res.json({
      success: true,
      message: "Image deactivated",
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/gallery/:id/restore  (re-activate soft-deleted image)
// ═══════════════════════════════════════════════════════════════════════════
exports.restore = async (req, res, next) => {
  try {
    const result = await query(
      "UPDATE gallery SET is_active = true WHERE id = $1 RETURNING *",
      [parseInt(req.params.id, 10)]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Image not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/gallery/reorder  (batch update sort_order)
// ═══════════════════════════════════════════════════════════════════════════
exports.reorder = async (req, res, next) => {
  try {
    const { items } = req.body; // [{ id: 1, sort_order: 0 }, ...]

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "items array is required" });
    }

    const cases = items
      .map((item, i) => `WHEN $${i * 2 + 1}::INTEGER THEN $${i * 2 + 2}::INTEGER`)
      .join(" ");
    const ids = items.map((item) => item.id);
    const params = items.flatMap((item) => [item.id, item.sort_order]);

    await query(
      `UPDATE gallery
       SET sort_order = CASE id ${cases} END
       WHERE id = ANY($${params.length + 1}::INTEGER[])`,
      [...params, ids]
    );

    res.json({ success: true, message: `Reordered ${items.length} images` });
  } catch (err) {
    next(err);
  }
};