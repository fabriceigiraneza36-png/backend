// controllers/countriesController.js
// ============================================================
// Countries Controller — full implementation
// ============================================================
'use strict';

const pool = require('../config/db');

/* ── tiny helpers ── */
const ok  = (res, data, meta = {}) =>
  res.status(200).json({ success: true, data, ...meta });

const fail = (res, status, message, details = null) =>
  res.status(status).json({ success: false, message, ...(details && { details }) });

const slugify = (str = '') =>
  str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

/* ── safe integer ── */
const int = (v, def = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

/* ── column whitelist for ORDER BY ── */
const SORT_COLS = new Set([
  'name','created_at','updated_at',
  'destinations_count','display_order',
]);

/* ════════════════════════════════════════════════════════════
   BASE SELECT — includes emotional_description
════════════════════════════════════════════════════════════ */
const BASE_SELECT = `
  SELECT
    c.id,
    c.name,
    c.slug,
    c.code,
    c.flag_url,
    c.flag,
    c.continent,
    c.region,
    c.capital,
    c.latitude,
    c.longitude,
    c.description,
    c.emotional_description,
    c.hero_image_url,
    c.traveler_quote,
    c.best_for,
    c.is_active,
    c.is_featured,
    c.display_order,
    c.created_at,
    c.updated_at,
    COUNT(DISTINCT d.id) FILTER (
      WHERE d.is_active = TRUE AND d.deleted_at IS NULL
    )::INT AS destinations_count
  FROM countries c
  LEFT JOIN destinations d
    ON d.country_id = c.id
   AND d.is_active  = TRUE
   AND d.deleted_at IS NULL
`;

const GROUP_BY = `
  GROUP BY
    c.id, c.name, c.slug, c.code, c.flag_url, c.flag,
    c.continent, c.region, c.capital,
    c.latitude, c.longitude, c.description,
    c.emotional_description, c.hero_image_url,
    c.traveler_quote, c.best_for,
    c.is_active, c.is_featured, c.display_order,
    c.created_at, c.updated_at
`;

/* ════════════════════════════════════════════════════════════
   GET ALL
════════════════════════════════════════════════════════════ */
exports.getAll = async (req, res) => {
  try {
    const {
      page       = 1,
      limit      = 50,
      search     = '',
      continent  = '',
      is_active,
      is_featured,
      sort       = 'display_order',
      order      = 'ASC',
    } = req.query;

    const offset  = (int(page, 1) - 1) * int(limit, 50);
    const lim     = Math.min(int(limit, 50), 200);
    const col     = SORT_COLS.has(sort) ? sort : 'display_order';
    const dir     = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const wheres  = ['c.deleted_at IS NULL'];
    const vals    = [];
    let   n        = 1;

    if (search) {
      wheres.push(`(c.name ILIKE $${n} OR c.slug ILIKE $${n})`);
      vals.push(`%${search}%`); n++;
    }
    if (continent) {
      wheres.push(`c.continent ILIKE $${n}`);
      vals.push(continent); n++;
    }
    if (is_active !== undefined) {
      wheres.push(`c.is_active = $${n}`);
      vals.push(is_active === 'true' || is_active === true); n++;
    } else {
      wheres.push('c.is_active = TRUE');
    }
    if (is_featured !== undefined) {
      wheres.push(`c.is_featured = $${n}`);
      vals.push(is_featured === 'true' || is_featured === true); n++;
    }

    const where = 'WHERE ' + wheres.join(' AND ');

    const countQ = await pool.query(
      `SELECT COUNT(*) FROM countries c ${where}`,
      vals,
    );
    const total = int(countQ.rows[0].count);

    const { rows } = await pool.query(
      `${BASE_SELECT}
       ${where}
       ${GROUP_BY}
       ORDER BY c.${col} ${dir}
       LIMIT $${n} OFFSET $${n + 1}`,
      [...vals, lim, offset],
    );

    return ok(res, rows, {
      pagination: {
        total,
        page:       int(page, 1),
        limit:      lim,
        totalPages: Math.ceil(total / lim),
      },
    });
  } catch (e) {
    console.error('[countries.getAll]', e);
    return fail(res, 500, 'Failed to fetch countries');
  }
};

/* ════════════════════════════════════════════════════════════
   GET ONE  (by slug or id)
════════════════════════════════════════════════════════════ */
exports.getOne = async (req, res) => {
  try {
    const { slug } = req.params;
    const isId = /^\d+$/.test(slug);

    const { rows } = await pool.query(
      `${BASE_SELECT}
       WHERE c.deleted_at IS NULL
         AND (${isId ? 'c.id = $1' : 'c.slug = $1'})
       ${GROUP_BY}
       LIMIT 1`,
      [isId ? int(slug) : slug],
    );

    if (!rows.length) return fail(res, 404, 'Country not found');
    return ok(res, rows[0]);
  } catch (e) {
    console.error('[countries.getOne]', e);
    return fail(res, 500, 'Failed to fetch country');
  }
};

/* ════════════════════════════════════════════════════════════
   GET FEATURED
════════════════════════════════════════════════════════════ */
exports.getFeatured = async (req, res) => {
  try {
    const limit = Math.min(int(req.query.limit, 12), 50);
    const { rows } = await pool.query(
      `${BASE_SELECT}
       WHERE c.deleted_at IS NULL
         AND c.is_active  = TRUE
         AND c.is_featured = TRUE
       ${GROUP_BY}
       ORDER BY c.display_order ASC, c.name ASC
       LIMIT $1`,
      [limit],
    );
    return ok(res, rows);
  } catch (e) {
    console.error('[countries.getFeatured]', e);
    return fail(res, 500, 'Failed to fetch featured countries');
  }
};

/* ════════════════════════════════════════════════════════════
   GET BY CONTINENT
════════════════════════════════════════════════════════════ */
exports.getByContinent = async (req, res) => {
  try {
    const { continent } = req.params;
    const limit = Math.min(int(req.query.limit, 50), 200);
    const { rows } = await pool.query(
      `${BASE_SELECT}
       WHERE c.deleted_at IS NULL
         AND c.is_active  = TRUE
         AND c.continent  ILIKE $1
       ${GROUP_BY}
       ORDER BY c.display_order ASC, c.name ASC
       LIMIT $2`,
      [continent, limit],
    );
    return ok(res, rows);
  } catch (e) {
    console.error('[countries.getByContinent]', e);
    return fail(res, 500, 'Failed to fetch countries by continent');
  }
};

/* ════════════════════════════════════════════════════════════
   GET STATS
════════════════════════════════════════════════════════════ */
exports.getStats = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                        ::INT AS total,
        COUNT(*) FILTER (WHERE is_active  = TRUE)      ::INT AS active,
        COUNT(*) FILTER (WHERE is_featured = TRUE)     ::INT AS featured,
        COUNT(DISTINCT continent)                       ::INT AS continents
      FROM countries
      WHERE deleted_at IS NULL
    `);
    return ok(res, rows[0]);
  } catch (e) {
    console.error('[countries.getStats]', e);
    return fail(res, 500, 'Failed to fetch stats');
  }
};

/* ════════════════════════════════════════════════════════════
   CREATE
════════════════════════════════════════════════════════════ */
exports.create = async (req, res) => {
  try {
    const {
      name, code = null, flag_url = null, flag = null,
      continent = null, region = null, capital = null,
      latitude = null, longitude = null,
      description = null,
      emotional_description = null,
      hero_image_url = null,
      traveler_quote = null,
      best_for = null,
      is_active = true, is_featured = false, display_order = 0,
    } = req.body;

    if (!name) return fail(res, 400, 'name is required');

    const slug = slugify(name);
    const { rows } = await pool.query(
      `INSERT INTO countries
         (name,slug,code,flag_url,flag,continent,region,capital,
          latitude,longitude,description,emotional_description,
          hero_image_url,traveler_quote,best_for,
          is_active,is_featured,display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [name, slug, code, flag_url, flag, continent, region, capital,
       latitude, longitude, description, emotional_description,
       hero_image_url, traveler_quote, best_for,
       is_active, is_featured, display_order],
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'Country name/slug already exists');
    console.error('[countries.create]', e);
    return fail(res, 500, 'Failed to create country');
  }
};

/* ════════════════════════════════════════════════════════════
   UPDATE
════════════════════════════════════════════════════════════ */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = [
      'name','code','flag_url','flag','continent','region','capital',
      'latitude','longitude','description','emotional_description',
      'hero_image_url','traveler_quote','best_for',
      'is_active','is_featured','display_order',
    ];

    const fields = [];
    const vals   = [];
    let   n       = 1;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${n++}`);
        vals.push(req.body[key]);
      }
    }
    if (!fields.length) return fail(res, 400, 'No fields to update');

    if (req.body.name) {
      fields.push(`slug = $${n++}`);
      vals.push(slugify(req.body.name));
    }

    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE countries SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${n} AND deleted_at IS NULL
       RETURNING *`,
      vals,
    );
    if (!rows.length) return fail(res, 404, 'Country not found');
    return ok(res, rows[0]);
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'Country name/slug already exists');
    console.error('[countries.update]', e);
    return fail(res, 500, 'Failed to update country');
  }
};

/* ════════════════════════════════════════════════════════════
   REMOVE (soft delete)
════════════════════════════════════════════════════════════ */
exports.remove = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE countries
       SET deleted_at = NOW(), is_active = FALSE
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name`,
      [req.params.id],
    );
    if (!rows.length) return fail(res, 404, 'Country not found');
    return ok(res, { deleted: rows[0] });
  } catch (e) {
    console.error('[countries.remove]', e);
    return fail(res, 500, 'Failed to delete country');
  }
};

/* ════════════════════════════════════════════════════════════
   BULK DELETE
════════════════════════════════════════════════════════════ */
exports.bulkDelete = async (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return fail(res, 400, 'ids array is required');
    }
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rowCount } = await pool.query(
      `UPDATE countries
       SET deleted_at = NOW(), is_active = FALSE
       WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      ids,
    );
    return ok(res, { deleted: rowCount });
  } catch (e) {
    console.error('[countries.bulkDelete]', e);
    return fail(res, 500, 'Failed to bulk delete countries');
  }
};

/* ════════════════════════════════════════════════════════════
   TOGGLE ACTIVE
════════════════════════════════════════════════════════════ */
exports.toggleActive = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE countries
       SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name, is_active`,
      [req.params.id],
    );
    if (!rows.length) return fail(res, 404, 'Country not found');
    return ok(res, rows[0]);
  } catch (e) {
    console.error('[countries.toggleActive]', e);
    return fail(res, 500, 'Failed to toggle active');
  }
};

/* ════════════════════════════════════════════════════════════
   TOGGLE FEATURED
════════════════════════════════════════════════════════════ */
exports.toggleFeatured = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE countries
       SET is_featured = NOT is_featured, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name, is_featured`,
      [req.params.id],
    );
    if (!rows.length) return fail(res, 404, 'Country not found');
    return ok(res, rows[0]);
  } catch (e) {
    console.error('[countries.toggleFeatured]', e);
    return fail(res, 500, 'Failed to toggle featured');
  }
};