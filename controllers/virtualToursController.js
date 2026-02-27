// controllers/virtualToursController.js

const { query } = require("../config/db");
const { slugify } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");
const {
  validateTourCreate,
  validateTourUpdate,
} = require("../validators/virtualTourValidator");

// ═══════════════════════════════════════════════════
// COLUMN WHITELIST — prevents SQL injection in
// dynamic ORDER BY / filter clauses
// ═══════════════════════════════════════════════════
const ALLOWED_SORT_COLS = [
  "sort_order",
  "created_at",
  "view_count",
  "title",
  "duration",
];

const ALLOWED_UPDATE_COLS = [
  "title",
  "description",
  "destination_id",
  "video_url",
  "thumbnail_url",
  "panorama_url",
  "duration",
  "is_featured",
  "is_active",
  "sort_order",
  "media_type",
  "tags",
  "meta",
];

// Base SELECT used by multiple endpoints
const BASE_SELECT = `
  SELECT vt.id, vt.title, vt.slug, vt.description,
         vt.destination_id, vt.video_url, vt.thumbnail_url,
         vt.panorama_url, vt.duration, vt.view_count,
         vt.is_featured, vt.is_active, vt.sort_order,
         vt.media_type, vt.tags, vt.meta,
         vt.created_at, vt.updated_at,
         d.name  AS destination_name,
         d.slug  AS destination_slug
  FROM virtual_tours vt
  LEFT JOIN destinations d ON vt.destination_id = d.id`;

// ─── Helper: extract YouTube video ID from any URL ──
const extractYouTubeId = (url) => {
  if (!url) return null;
  const regex =
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
};

// ─── Helper: build pagination meta ─────────────────
const buildPagination = (total, page, limit) => ({
  total: parseInt(total),
  page,
  limit,
  totalPages: Math.ceil(total / limit),
  hasNext: page * limit < total,
  hasPrev: page > 1,
});

const getUploadedFieldUrl = (files, fieldName) => {
  if (!files || !Array.isArray(files[fieldName]) || files[fieldName].length === 0) {
    return null;
  }
  return getUploadedFileUrl(files[fieldName][0]);
};

const parseOptionalInteger = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : value;
};

const parseOptionalBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return value;
};

const parseTags = (value, fallback = []) => {
  if (value === undefined || value === null || value === "") return fallback;

  if (Array.isArray(value)) {
    return value
      .map((tag) => (typeof tag === "string" ? tag.trim().toLowerCase() : tag))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((tag) => (typeof tag === "string" ? tag.trim().toLowerCase() : tag))
          .filter(Boolean);
      }
    } catch {
      return value
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
    }
  }

  return value;
};

const parseMeta = (value, fallback = {}) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : value;
    } catch {
      return value;
    }
  }

  return value;
};

const inferMediaType = (providedType, videoUrl, panoramaUrl) => {
  if (providedType) return providedType;
  if (videoUrl && panoramaUrl) return "mixed";
  if (panoramaUrl) return "panorama";
  return "video";
};

const normalizeCreatePayload = (req) => {
  const payload = { ...req.body };

  const uploadedVideo = getUploadedFieldUrl(req.files, "video");
  const uploadedThumbnail = getUploadedFieldUrl(req.files, "thumbnail");
  const uploadedPanorama = getUploadedFieldUrl(req.files, "panorama");

  if (uploadedVideo) payload.video_url = uploadedVideo;
  if (uploadedThumbnail) payload.thumbnail_url = uploadedThumbnail;
  if (uploadedPanorama) payload.panorama_url = uploadedPanorama;

  payload.destination_id = parseOptionalInteger(payload.destination_id);
  payload.sort_order = parseOptionalInteger(payload.sort_order);
  payload.is_featured = parseOptionalBoolean(payload.is_featured, false);
  payload.tags = parseTags(payload.tags, []);
  payload.meta = parseMeta(payload.meta, {});
  payload.media_type = inferMediaType(
    payload.media_type,
    payload.video_url,
    payload.panorama_url
  );

  return payload;
};

const normalizeUpdatePayload = (req) => {
  const payload = { ...req.body };

  const uploadedVideo = getUploadedFieldUrl(req.files, "video");
  const uploadedThumbnail = getUploadedFieldUrl(req.files, "thumbnail");
  const uploadedPanorama = getUploadedFieldUrl(req.files, "panorama");

  if (uploadedVideo) payload.video_url = uploadedVideo;
  if (uploadedThumbnail) payload.thumbnail_url = uploadedThumbnail;
  if (uploadedPanorama) payload.panorama_url = uploadedPanorama;

  if (payload.destination_id !== undefined) {
    payload.destination_id = parseOptionalInteger(payload.destination_id);
  }
  if (payload.sort_order !== undefined) {
    payload.sort_order = parseOptionalInteger(payload.sort_order);
  }
  if (payload.is_featured !== undefined) {
    payload.is_featured = parseOptionalBoolean(payload.is_featured, payload.is_featured);
  }
  if (payload.is_active !== undefined) {
    payload.is_active = parseOptionalBoolean(payload.is_active, payload.is_active);
  }
  if (payload.tags !== undefined) {
    payload.tags = parseTags(payload.tags, payload.tags);
  }
  if (payload.meta !== undefined) {
    payload.meta = parseMeta(payload.meta, payload.meta);
  }

  if (payload.media_type === undefined && (payload.video_url || payload.panorama_url)) {
    payload.media_type = inferMediaType(
      null,
      payload.video_url || null,
      payload.panorama_url || null
    );
  }

  return payload;
};

// ═══════════════════════════════════════════════════
// GET /api/virtual-tours
// Supports: ?page, ?limit, ?sort, ?order,
//           ?destination_id, ?is_featured, ?media_type,
//           ?search, ?tag
// ═══════════════════════════════════════════════════
exports.getAll = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    // Dynamic sort
    const sortCol = ALLOWED_SORT_COLS.includes(req.query.sort)
      ? req.query.sort
      : "sort_order";
    const sortDir = req.query.order === "desc" ? "DESC" : "ASC";

    // Build WHERE clauses
    const conditions = ["vt.is_active = true"];
    const params     = [];
    let paramIndex   = 1;

    // Filters
    if (req.query.destination_id) {
      conditions.push(`vt.destination_id = $${paramIndex++}`);
      params.push(parseInt(req.query.destination_id));
    }
    if (req.query.is_featured !== undefined) {
      conditions.push(`vt.is_featured = $${paramIndex++}`);
      params.push(req.query.is_featured === "true");
    }
    if (req.query.media_type) {
      conditions.push(`vt.media_type = $${paramIndex++}`);
      params.push(req.query.media_type);
    }

    // Tag filter
    if (req.query.tag) {
      conditions.push(`$${paramIndex++} = ANY(vt.tags)`);
      params.push(req.query.tag.toLowerCase());
    }

    // Full-text search
    if (req.query.search) {
      conditions.push(
        `(vt.title ILIKE $${paramIndex} OR vt.description ILIKE $${paramIndex})`
      );
      params.push(`%${req.query.search}%`);
      paramIndex++;
    }

    const whereClause = conditions.join(" AND ");

    // Count query
    const countResult = await query(
      `SELECT COUNT(*) FROM virtual_tours vt WHERE ${whereClause}`,
      params
    );
    const total = countResult.rows[0].count;

    // Data query
    const dataParams = [...params, limit, offset];
    const result = await query(
      `${BASE_SELECT}
       WHERE ${whereClause}
       ORDER BY vt.${sortCol} ${sortDir}, vt.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      dataParams
    );

    // Enrich rows with extracted video IDs
    const enriched = result.rows.map((row) => ({
      ...row,
      video_id: extractYouTubeId(row.video_url),
    }));

    res.json({
      data:       enriched,
      pagination: buildPagination(total, page, limit),
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════
// GET /api/virtual-tours/featured
// ═══════════════════════════════════════════════════
exports.getFeatured = async (req, res, next) => {
  try {
    const limit = Math.min(12, parseInt(req.query.limit) || 6);

    const result = await query(
      `${BASE_SELECT}
       WHERE vt.is_featured = true AND vt.is_active = true
       ORDER BY vt.sort_order ASC
       LIMIT $1`,
      [limit]
    );

    const enriched = result.rows.map((row) => ({
      ...row,
      video_id: extractYouTubeId(row.video_url),
    }));

    res.json({ data: enriched });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════
// GET /api/virtual-tours/stats
// Aggregate stats for admin dashboard
// ═══════════════════════════════════════════════════
exports.getStats = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*)                              AS total_tours,
        COUNT(*) FILTER (WHERE is_active)     AS active_tours,
        COUNT(*) FILTER (WHERE is_featured)   AS featured_tours,
        COALESCE(SUM(view_count), 0)          AS total_views,
        COALESCE(AVG(view_count), 0)::int     AS avg_views,
        MAX(created_at)                       AS latest_created
      FROM virtual_tours
    `);

    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════
// GET /api/virtual-tours/:idOrSlug
// ═══════════════════════════════════════════════════
exports.getOne = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const isNumeric    = /^\d+$/.test(idOrSlug);
    const column       = isNumeric ? "vt.id" : "vt.slug";
    const value        = isNumeric ? parseInt(idOrSlug) : idOrSlug;

    const result = await query(
      `${BASE_SELECT} WHERE ${column} = $1`,
      [value]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error:   "Virtual tour not found",
        code:    "TOUR_NOT_FOUND",
        param:   idOrSlug,
      });
    }

    // Increment view count asynchronously — don't block response
    query(
      "UPDATE virtual_tours SET view_count = view_count + 1 WHERE id = $1",
      [result.rows[0].id]
    ).catch((err) =>
      console.error("View count increment failed:", err.message)
    );

    const tour = {
      ...result.rows[0],
      video_id:   extractYouTubeId(result.rows[0].video_url),
      view_count: result.rows[0].view_count + 1, // reflect increment
    };

    res.json({ data: tour });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════
// POST /api/virtual-tours
// ═══════════════════════════════════════════════════
exports.create = async (req, res, next) => {
  try {
    const payload = normalizeCreatePayload(req);
    const errors = validateTourCreate(payload);
    if (errors.length > 0) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    const {
      title, description, destination_id, video_url,
      thumbnail_url, panorama_url, duration, is_featured,
      sort_order, media_type, tags, meta,
    } = payload;

    const slug = slugify(title);

    // Check slug uniqueness explicitly for a clearer error
    const existing = await query(
      "SELECT id FROM virtual_tours WHERE slug = $1",
      [slug]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: "A virtual tour with this title already exists",
        code:  "DUPLICATE_SLUG",
        slug,
      });
    }

    const result = await query(
      `INSERT INTO virtual_tours
         (title, slug, description, destination_id, video_url,
          thumbnail_url, panorama_url, duration, is_featured,
          sort_order, media_type, tags, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        title.trim(),
        slug,
        description       || null,
        destination_id    || null,
        video_url         || null,
        thumbnail_url     || null,
        panorama_url      || null,
        duration          || null,
        is_featured       ?? false,
        sort_order        ?? 0,
        media_type        || "video",
        tags              || [],
        meta              || {},
      ]
    );

    const tour = {
      ...result.rows[0],
      video_id: extractYouTubeId(result.rows[0].video_url),
    };

    res.status(201).json({
      message: "Virtual tour created successfully",
      data:    tour,
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "A virtual tour with this title already exists",
        code:  "DUPLICATE_SLUG",
      });
    }
    if (err.code === "23503") {
      return res.status(400).json({
        error: "Referenced destination does not exist",
        code:  "INVALID_DESTINATION",
      });
    }
    next(err);
  }
};

// ═══════════════════════════════════════════════════
// PUT /api/virtual-tours/:id
// ═══════════════════════════════════════════════════
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: "ID must be a number" });
    }

    const payload = normalizeUpdatePayload(req);
    const errors = validateTourUpdate(payload);
    if (errors.length > 0) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    const fields = {};
    for (const key of ALLOWED_UPDATE_COLS) {
      if (payload[key] !== undefined) {
        fields[key] = payload[key];
      }
    }

    // Auto-generate slug when title changes
    if (fields.title) {
      fields.slug = slugify(fields.title);
    }

    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return res.status(400).json({
        error: "No valid fields to update",
        code:  "EMPTY_UPDATE",
      });
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    setClauses.push("updated_at = NOW()");

    const values = [...keys.map((k) => fields[k]), parseInt(id)];

    const result = await query(
      `UPDATE virtual_tours
       SET ${setClauses.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Virtual tour not found",
        code:  "TOUR_NOT_FOUND",
      });
    }

    const tour = {
      ...result.rows[0],
      video_id: extractYouTubeId(result.rows[0].video_url),
    };

    res.json({ message: "Virtual tour updated", data: tour });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "A virtual tour with this title already exists",
        code:  "DUPLICATE_SLUG",
      });
    }
    if (err.code === "23503") {
      return res.status(400).json({
        error: "Referenced destination does not exist",
        code:  "INVALID_DESTINATION",
      });
    }
    next(err);
  }
};

// ═══════════════════════════════════════════════════
// PATCH /api/virtual-tours/:id/toggle
// Quick toggle active / featured
// ═══════════════════════════════════════════════════
exports.toggleStatus = async (req, res, next) => {
  try {
    const { id }    = req.params;
    const { field } = req.body; // "is_active" or "is_featured"

    if (!["is_active", "is_featured"].includes(field)) {
      return res.status(400).json({
        error: "field must be 'is_active' or 'is_featured'",
      });
    }

    const result = await query(
      `UPDATE virtual_tours
       SET ${field} = NOT ${field}, updated_at = NOW()
       WHERE id = $1
       RETURNING id, title, ${field}`,
      [parseInt(id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Virtual tour not found" });
    }

    res.json({ message: `${field} toggled`, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════
// PUT /api/virtual-tours/reorder
// Bulk reorder tours
// ═══════════════════════════════════════════════════
exports.reorder = async (req, res, next) => {
  try {
    const { orders } = req.body; // [{ id: 1, sort_order: 0 }, ...]

    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: "orders array is required" });
    }

    const cases  = orders.map((o, i) => `WHEN $${i * 2 + 1} THEN $${i * 2 + 2}`);
    const ids    = orders.map((o) => o.id);
    const params = orders.flatMap((o) => [o.id, o.sort_order]);

    await query(
      `UPDATE virtual_tours
       SET sort_order = CASE id ${cases.join(" ")} END,
           updated_at = NOW()
       WHERE id = ANY($${params.length + 1}::int[])`,
      [...params, ids]
    );

    res.json({ message: "Tour order updated" });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════
// DELETE /api/virtual-tours/:id
// ═══════════════════════════════════════════════════
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      "DELETE FROM virtual_tours WHERE id = $1 RETURNING id, title, slug",
      [parseInt(id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Virtual tour not found",
        code:  "TOUR_NOT_FOUND",
      });
    }

    res.json({
      message: "Virtual tour deleted permanently",
      data:    result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};
