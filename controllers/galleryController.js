// controllers/galleryController.js
const { query } = require("../config/db");
const { paginate } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");

// ─── Allowed sort options ────────────────────────────────────────────────────
const SORT_OPTIONS = {
  newest:     "g.created_at DESC",
  oldest:     "g.created_at ASC",
  featured:   "g.is_featured DESC, g.sort_order ASC, g.created_at DESC",
  popular:    "g.view_count DESC, g.created_at DESC",
  title_asc:  "g.title ASC NULLS LAST",
  title_desc: "g.title DESC NULLS LAST",
};

const DEFAULT_SORT = SORT_OPTIONS.featured;

// ─── Allowed filter fields ───────────────────────────────────────────────────
const ALLOWED_FILTERS = [
  "category",
  "country_id",
  "destination_id",
  "photographer",
  "is_featured",
  "source",
];

// ─── Exact columns that exist in DB ─────────────────────────────────────────
const GALLERY_COLS = `
  g.id,
  g.title,
  g.slug,
  g.description,
  g.image_url,
  g.thumbnail_url,
  g.alt_text,
  g.category,
  g.tags,
  g.location,
  g.country_id,
  g.destination_id,
  g.photographer,
  g.credit_url,
  g.source,
  g.is_featured,
  g.is_active,
  g.sort_order,
  g.view_count,
  g.width,
  g.height,
  g.file_size,
  g.mime_type,
  g.blurhash,
  g.latitude,
  g.longitude,
  g.created_at,
  g.updated_at
`;

// ─── Helper: build WHERE clause ──────────────────────────────────────────────
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

  // Tag filter
  if (queryParams.tag) {
    conditions.push(`$${idx++} = ANY(g.tags)`);
    params.push(queryParams.tag);
  }

  // Full-text search
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
    const total      = parseInt(countRes.rows[0].count, 10);
    const pagination = paginate(total, page, limit);

    // Data
    const dataParams = [...params, pagination.limit, pagination.offset];
    const result = await query(
      `SELECT
         ${GALLERY_COLS},
         c.name AS country_name,
         d.name AS destination_name
       FROM gallery g
       LEFT JOIN countries    c ON g.country_id     = c.id
       LEFT JOIN destinations d ON g.destination_id = d.id
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      dataParams
    );

    res.json({ success: true, data: result.rows, pagination });
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
         category,
         COUNT(*)::INTEGER AS count,
         MIN(image_url)    AS sample_image
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
// GET /api/gallery/:id
// ═══════════════════════════════════════════════════════════════════════════
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;

    const isNumeric = /^\d+$/.test(id);
    const condition = isNumeric ? "g.id = $1" : "g.slug = $1";
    const param     = isNumeric ? parseInt(id, 10) : id;

    const result = await query(
      `SELECT
         ${GALLERY_COLS},
         c.name AS country_name,
         d.name AS destination_name
       FROM gallery g
       LEFT JOIN countries    c ON g.country_id     = c.id
       LEFT JOIN destinations d ON g.destination_id = d.id
       WHERE ${condition}`,
      [param]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Image not found" });
    }

    // Increment view count (non-blocking)
    query("SELECT gallery_increment_views($1)", [result.rows[0].id]).catch(() => {});

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
      return res.status(400).json({ success: false, error: "Image is required" });
    }

    // Parse tags
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
         mime_type, blurhash, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,$10,
         $11,$12,$13,$14,$15,
         $16,$17, NOW()
       ) RETURNING *`,
      [
        title          || null,
        description    || null,
        image_url,
        category       || "other",
        parsedTags,
        location       || null,
        country_id     || null,
        destination_id || null,
        photographer   || null,
        credit_url     || null,
        is_featured === "true" || is_featured === true || false,
        parseInt(sort_order, 10) || 0,
        width     ? parseInt(width, 10)     : null,
        height    ? parseInt(height, 10)    : null,
        file_size ? parseInt(file_size, 10) : null,
        mime_type || (req.file ? req.file.mimetype : null),
        blurhash  || null,
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
      return res.status(400).json({ success: false, error: "No images uploaded" });
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

    const values       = [];
    const placeholders = [];
    let idx = 1;

    for (const file of req.files) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, NOW())`
      );
      values.push(
        getUploadedFileUrl(file),
        category       || "other",
        country_id     || null,
        destination_id || null,
        parsedTags
      );
    }

    const result = await query(
      `INSERT INTO gallery (image_url, category, country_id, destination_id, tags, updated_at)
       VALUES ${placeholders.join(", ")}
       RETURNING *`,
      values
    );

    res.status(201).json({ success: true, data: result.rows, count: result.rows.length });
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

    const ALLOWED_UPDATE_FIELDS = [
      "title", "description", "image_url", "thumbnail_url", "alt_text",
      "category", "tags", "location", "country_id", "destination_id",
      "photographer", "credit_url", "source", "is_featured", "is_active",
      "sort_order", "width", "height", "file_size", "mime_type",
      "blurhash", "latitude", "longitude", "slug",
    ];

    const fields = {};
    for (const key of ALLOWED_UPDATE_FIELDS) {
      if (req.body[key] !== undefined) fields[key] = req.body[key];
    }

    if (req.file) {
      fields.image_url = getUploadedFileUrl(req.file);
    }

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

    if (fields.is_featured !== undefined)
      fields.is_featured = fields.is_featured === "true" || fields.is_featured === true;

    if (fields.is_active !== undefined)
      fields.is_active = fields.is_active === "true" || fields.is_active === true;

    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return res.status(400).json({ success: false, error: "No valid fields to update" });
    }

    // Always update updated_at
    const sets   = [...keys.map((k, i) => `${k} = $${i + 1}`), `updated_at = NOW()`].join(", ");
    const values = [...keys.map((k) => fields[k]), parseInt(id, 10)];

    const result = await query(
      `UPDATE gallery SET ${sets}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Image not found" });
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
    const { id }      = req.params;
    const { permanent } = req.query;

    if (permanent === "true") {
      const result = await query(
        "DELETE FROM gallery WHERE id = $1 RETURNING id, title, image_url",
        [parseInt(id, 10)]
      );

      if (result.rows.length === 0)
        return res.status(404).json({ success: false, error: "Image not found" });

      return res.json({ success: true, message: "Image permanently deleted", data: result.rows[0] });
    }

    // Soft delete
    const result = await query(
      "UPDATE gallery SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id, title",
      [parseInt(id, 10)]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, error: "Image not found" });

    res.json({ success: true, message: "Image deactivated", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/gallery/:id/restore
// ═══════════════════════════════════════════════════════════════════════════
exports.restore = async (req, res, next) => {
  try {
    const result = await query(
      "UPDATE gallery SET is_active = true, updated_at = NOW() WHERE id = $1 RETURNING *",
      [parseInt(req.params.id, 10)]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, error: "Image not found" });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/gallery/reorder
// ═══════════════════════════════════════════════════════════════════════════
exports.reorder = async (req, res, next) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "items array is required" });
    }

    const ids        = items.map((item) => item.id);
    const sortOrders = items.map((item) => item.sort_order);

    await query(
      `UPDATE gallery AS g
       SET sort_order = v.sort_order::INTEGER,
           updated_at = NOW()
       FROM (
         SELECT UNNEST($1::INTEGER[]) AS id,
                UNNEST($2::INTEGER[]) AS sort_order
       ) AS v
       WHERE g.id = v.id`,
      [ids, sortOrders]
    );

    res.json({ success: true, message: `Reordered ${items.length} images` });
  } catch (err) {
    next(err);
  }
};