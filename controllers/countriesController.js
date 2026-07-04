// controllers/countriesController.js
// ============================================================
// Countries Controller — Complete Final Implementation
// ============================================================
'use strict';

const pool = require('../config/db');

/* ─────────────────────────────────────────────────────────────
   TINY HELPERS
───────────────────────────────────────────────────────────── */
const ok = (res, data, meta = {}) =>
  res.status(200).json({ success: true, data, ...meta });

const fail = (res, status, message, details = null) =>
  res.status(status).json({
    success: false,
    message,
    ...(details && { details }),
  });

const slugify = (str = '') =>
  str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

const int = (v, def = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

/* ─────────────────────────────────────────────────────────────
   ALLOWED SORT COLUMNS  (whitelist prevents SQL injection)
───────────────────────────────────────────────────────────── */
const SORT_COLS = new Set([
  'name',
  'created_at',
  'updated_at',
  'destinations_count',
  'display_order',
]);

/* ─────────────────────────────────────────────────────────────
   BASE SELECT
   Includes every column added by the migration so that every
   controller function returns a consistent shape.
───────────────────────────────────────────────────────────── */
const BASE_SELECT = `
  SELECT
    c.id,
    c.name,
    c.slug,
    c.code,

    /* flag — support both column names that may exist */
    COALESCE(c.flag_url, c.flag)            AS flag_url,
    c.flag,

    /* geography */
    c.continent,
    c.region,
    c.capital,
    c.latitude,
    c.longitude,

    /* content */
    c.description,
    c.emotional_description,
    c.hero_image_url,
    c.traveler_quote,
    c.best_for,

    /* status */
    c.is_active,
    c.is_featured,
    c.display_order,

    /* timestamps */
    c.created_at,
    c.updated_at,

    /* live destination count (active, non-deleted only) */
    COUNT(
      DISTINCT d.id
    ) FILTER (
      WHERE d.is_active  = TRUE
        AND d.deleted_at IS NULL
    )::INT                                  AS destinations_count
`;

const BASE_FROM = `
  FROM countries c
  LEFT JOIN destinations d
    ON  d.country_id = c.id
`;

/*
  GROUP BY must list every non-aggregated column that appears in
  BASE_SELECT.  We keep it as a single constant so adding a new
  column only requires editing in two places (SELECT + GROUP BY).
*/
const GROUP_BY = `
  GROUP BY
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
    c.updated_at
`;

/* ─────────────────────────────────────────────────────────────
   WRITABLE COLUMNS  (used by create & update)
   Order matches the INSERT values array.
───────────────────────────────────────────────────────────── */
const WRITABLE_COLS = [
  'name',
  'code',
  'flag_url',
  'flag',
  'continent',
  'region',
  'capital',
  'latitude',
  'longitude',
  'description',
  'emotional_description',
  'hero_image_url',
  'traveler_quote',
  'best_for',
  'is_active',
  'is_featured',
  'display_order',
];

/* ═══════════════════════════════════════════════════════════
   ① GET ALL
   GET /api/countries
   Query params:
     page, limit, search, continent, is_active, is_featured,
     sort, order
═══════════════════════════════════════════════════════════ */
exports.getAll = async (req, res) => {
  try {
    const {
      page        = 1,
      limit       = 50,
      search      = '',
      continent   = '',
      is_active,
      is_featured,
      sort        = 'display_order',
      order       = 'ASC',
    } = req.query;

    const pageNum  = Math.max(1, int(page, 1));
    const lim      = Math.min(Math.max(1, int(limit, 50)), 200);
    const offset   = (pageNum - 1) * lim;
    const col      = SORT_COLS.has(sort) ? sort : 'display_order';
    const dir      = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const wheres = ['c.deleted_at IS NULL'];
    const vals   = [];
    let   n       = 1;

    /* search */
    if (search && search.trim()) {
      wheres.push(`(
        c.name      ILIKE $${n}
        OR c.slug   ILIKE $${n}
        OR c.region ILIKE $${n}
      )`);
      vals.push(`%${search.trim()}%`);
      n++;
    }

    /* continent filter */
    if (continent && continent.trim()) {
      wheres.push(`c.continent ILIKE $${n}`);
      vals.push(continent.trim());
      n++;
    }

    /* is_active filter (default: show only active) */
    if (is_active !== undefined) {
      wheres.push(`c.is_active = $${n}`);
      vals.push(is_active === 'true' || is_active === true);
      n++;
    } else {
      wheres.push('c.is_active = TRUE');
    }

    /* is_featured filter */
    if (is_featured !== undefined) {
      wheres.push(`c.is_featured = $${n}`);
      vals.push(is_featured === 'true' || is_featured === true);
      n++;
    }

    const WHERE = 'WHERE ' + wheres.join(' AND ');

    /* total count (before pagination) */
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total
       FROM countries c
       ${WHERE}`,
      vals,
    );
    const total = int(countRows[0].total, 0);

    /* paginated data */
    const { rows } = await pool.query(
      `${BASE_SELECT}
       ${BASE_FROM}
       ${WHERE}
       ${GROUP_BY}
       ORDER BY c.${col} ${dir}, c.name ASC
       LIMIT  $${n}
       OFFSET $${n + 1}`,
      [...vals, lim, offset],
    );

    return ok(res, rows, {
      pagination: {
        total,
        page:       pageNum,
        limit:      lim,
        totalPages: Math.ceil(total / lim),
        hasNext:    pageNum < Math.ceil(total / lim),
        hasPrev:    pageNum > 1,
      },
    });
  } catch (e) {
    console.error('[countries.getAll]', e);
    return fail(res, 500, 'Failed to fetch countries', e.message);
  }
};

/* ═══════════════════════════════════════════════════════════
   ② GET ONE  (by slug OR numeric id)
   GET /api/countries/:slug
═══════════════════════════════════════════════════════════ */
exports.getOne = async (req, res) => {
  try {
    const { slug } = req.params;
    const isId     = /^\d+$/.test(slug);

    const { rows } = await pool.query(
      `${BASE_SELECT}
       ${BASE_FROM}
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
    return fail(res, 500, 'Failed to fetch country', e.message);
  }
};

/* ═══════════════════════════════════════════════════════════
   ③ GET FEATURED
   GET /api/countries/featured?limit=12
═══════════════════════════════════════════════════════════ */
exports.getFeatured = async (req, res) => {
  try {
    const lim = Math.min(int(req.query.limit, 12), 50);

    const { rows } = await pool.query(
      `${BASE_SELECT}
       ${BASE_FROM}
       WHERE c.deleted_at  IS NULL
         AND c.is_active    = TRUE
         AND c.is_featured  = TRUE
       ${GROUP_BY}
       ORDER BY c.display_order ASC, c.name ASC
       LIMIT $1`,
      [lim],
    );

    return ok(res, rows);
  } catch (e) {
    console.error('[countries.getFeatured]', e);
    return fail(res, 500, 'Failed to fetch featured countries', e.message);
  }
};

/* ═══════════════════════════════════════════════════════════
   ④ GET BY CONTINENT
   GET /api/countries/continent/:continent
═══════════════════════════════════════════════════════════ */
exports.getByContinent = async (req, res) => {
  try {
    const { continent } = req.params;
    const lim = Math.min(int(req.query.limit, 50), 200);

    const { rows } = await pool.query(
      `${BASE_SELECT}
       ${BASE_FROM}
       WHERE c.deleted_at IS NULL
         AND c.is_active   = TRUE
         AND c.continent   ILIKE $1
       ${GROUP_BY}
       ORDER BY c.display_order ASC, c.name ASC
       LIMIT $2`,
      [continent, lim],
    );

    return ok(res, rows);
  } catch (e) {
    console.error('[countries.getByContinent]', e);
    return fail(res, 500, 'Failed to fetch countries by continent', e.message);
  }
};

/* ═══════════════════════════════════════════════════════════
   ⑤ GET STATS
   GET /api/countries/stats
═══════════════════════════════════════════════════════════ */
exports.getStats = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                            ::INT  AS total,
        COUNT(*) FILTER (WHERE is_active   = TRUE)         ::INT  AS active,
        COUNT(*) FILTER (WHERE is_active   = FALSE)        ::INT  AS inactive,
        COUNT(*) FILTER (WHERE is_featured = TRUE)         ::INT  AS featured,
        COUNT(DISTINCT continent)                          ::INT  AS continents,
        COUNT(DISTINCT region)                             ::INT  AS regions
      FROM countries
      WHERE deleted_at IS NULL
    `);

    /* destinations summary */
    const { rows: destRows } = await pool.query(`
      SELECT COUNT(*)::INT AS total_destinations
      FROM destinations
      WHERE is_active  = TRUE
        AND deleted_at IS NULL
    `);

    return ok(res, {
      ...rows[0],
      total_destinations: destRows[0].total_destinations,
    });
  } catch (e) {
    console.error('[countries.getStats]', e);
    return fail(res, 500, 'Failed to fetch country stats', e.message);
  }
};

/* ═══════════════════════════════════════════════════════════
   ⑥ CREATE
   POST /api/countries  (admin)
═══════════════════════════════════════════════════════════ */
exports.create = async (req, res) => {
  try {
    const {
      name,
      code                  = null,
      flag_url              = null,
      flag                  = null,
      continent             = null,
      region                = null,
      capital               = null,
      latitude              = null,
      longitude             = null,
      description           = null,
      emotional_description = null,
      hero_image_url        = null,
      traveler_quote        = null,
      best_for              = null,
      is_active             = true,
      is_featured           = false,
      display_order         = 0,
    } = req.body;

    if (!name || !name.trim()) {
      return fail(res, 400, 'name is required');
    }

    const slug = slugify(name);

    /* check for slug collision */
    const { rows: existing } = await pool.query(
      `SELECT id FROM countries WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
      [slug],
    );
    if (existing.length) {
      return fail(res, 409, `A country with the name "${name}" already exists`);
    }

    const { rows } = await pool.query(
      `INSERT INTO countries (
         name, slug, code, flag_url, flag,
         continent, region, capital,
         latitude, longitude,
         description, emotional_description,
         hero_image_url, traveler_quote, best_for,
         is_active, is_featured, display_order
       ) VALUES (
         $1,  $2,  $3,  $4,  $5,
         $6,  $7,  $8,
         $9,  $10,
         $11, $12,
         $13, $14, $15,
         $16, $17, $18
       )
       RETURNING *`,
      [
        name.trim(), slug, code, flag_url, flag,
        continent, region, capital,
        latitude, longitude,
        description, emotional_description,
        hero_image_url, traveler_quote, best_for,
        is_active, is_featured, display_order,
      ],
    );

    return res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === '23505') {
      return fail(res, 409, 'Country name or slug already exists');
    }
    console.error('[countries.create]', e);
    return fail(res, 500, 'Failed to create country', e.message);
  }
};

/* ═══════════════════════════════════════════════════════════
   ⑦ UPDATE  (PUT or PATCH)
   PUT   /api/countries/:id  (admin)
   PATCH /api/countries/:id  (admin)
═══════════════════════════════════════════════════════════ */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;

    /* build SET clause dynamically from whitelisted columns */
    const setClauses = [];
    const vals       = [];
    let   n           = 1;

    for (const col of WRITABLE_COLS) {
      if (req.body[col] !== undefined) {
        setClauses.push(`${col} = $${n++}`);
        vals.push(req.body[col]);
      }
    }

    /* auto-regenerate slug when name changes */
    if (req.body.name) {
      const newSlug = slugify(req.body.name);

      /* collision check (exclude current record) */
      const { rows: clash } = await pool.query(
        `SELECT id FROM countries
         WHERE  slug        = $1
           AND  id         != $2
           AND  deleted_at  IS NULL
         LIMIT 1`,
        [newSlug, id],
      );
      if (clash.length) {
        return fail(res, 409, 'Another country with that name already exists');
      }

      setClauses.push(`slug = $${n++}`);
      vals.push(newSlug);
    }

    if (!setClauses.length) {
      return fail(res, 400, 'No valid fields provided for update');
    }

    /* always bump updated_at */
    setClauses.push(`updated_at = NOW()`);

    vals.push(id); /* bind :id last */

    const { rows } = await pool.query(
      `UPDATE countries
       SET    ${setClauses.join(', ')}
       WHERE  id         = $${n}
         AND  deleted_at IS NULL
       RETURNING *`,
      vals,
    );

    if (!rows.length) return fail(res, 404, 'Country not found');
    return ok(res, rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return fail(res, 409, 'Country name or slug already exists');
    }
    console.error('[countries.update]', e);
    return fail(res, 500, 'Failed to update country', e.message);
  }
};

/* ═══════════════════════════════════════════════════════════
   ⑧ REMOVE  (soft delete)
   DELETE /api/countries/:id  (admin)
═══════════════════════════════════════════════════════════ */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `UPDATE countries
       SET    deleted_at = NOW(),
              is_active  = FALSE,
              updated_at = NOW()
       WHERE  id         = $1
         AND  deleted_at IS NULL
       RETURNING id, name, slug`,
      [id],
    );

    if (!rows.length) return fail(res, 404, 'Country not found');
    return ok(res, { deleted: rows[0] });
  } catch (e) {
    console.error('[countries.remove]', e);
    return fail(res, 500, 'Failed to delete country', e.message);
  }
};

/* ═══════════════════════════════════════════════════════════
   ⑨ BULK DELETE
   DELETE /api/countries  (body: { ids: [1,2,3] })  (admin)
═══════════════════════════════════════════════════════════ */
exports.bulkDelete = async (req, res) => {
  const client = await pool.connect();
  try {
    const { ids = [] } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return fail(res, 400, 'ids must be a non-empty array');
    }

    /* sanitise: keep only positive integers */
    const safeIds = ids
      .map(v => int(v, -1))
      .filter(v => v > 0);

    if (!safeIds.length) {
      return fail(res, 400, 'No valid numeric ids provided');
    }

    const placeholders = safeIds.map((_, i) => `$${i + 1}`).join(', ');

    await client.query('BEGIN');

    const { rowCount } = await client.query(
      `UPDATE countries
       SET    deleted_at = NOW(),
              is_active  = FALSE,
              updated_at = NOW()
       WHERE  id         IN (${placeholders})
         AND  deleted_at IS NULL`,
      safeIds,
    );

    await client.query('COMMIT');

    return ok(res, { deleted: rowCount });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[countries.bulkDelete]', e);
    return fail(res, 500, 'Failed to bulk delete countries', e.message);
  } finally {
    client.release();
  }
};

/* ═══════════════════════════════════════════════════════════
   ⑩ TOGGLE ACTIVE
   PATCH /api/countries/:id/toggle-active  (admin)
═══════════════════════════════════════════════════════════ */
exports.toggleActive = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `UPDATE countries
       SET    is_active  = NOT is_active,
              updated_at = NOW()
       WHERE  id         = $1
         AND  deleted_at IS NULL
       RETURNING id, name, slug, is_active`,
      [id],
    );

    if (!rows.length) return fail(res, 404, 'Country not found');
    return ok(res, rows[0]);
  } catch (e) {
    console.error('[countries.toggleActive]', e);
    return fail(res, 500, 'Failed to toggle active status', e.message);
  }
};

/* ═══════════════════════════════════════════════════════════
   ⑪ TOGGLE FEATURED
   PATCH /api/countries/:id/toggle-featured  (admin)
═══════════════════════════════════════════════════════════ */
exports.toggleFeatured = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `UPDATE countries
       SET    is_featured = NOT is_featured,
              updated_at  = NOW()
       WHERE  id          = $1
         AND  deleted_at  IS NULL
       RETURNING id, name, slug, is_featured`,
      [id],
    );

    if (!rows.length) return fail(res, 404, 'Country not found');
    return ok(res, rows[0]);
  } catch (e) {
    console.error('[countries.toggleFeatured]', e);
    return fail(res, 500, 'Failed to toggle featured status', e.message);
  }
};