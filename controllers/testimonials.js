/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TESTIMONIALS CONTROLLER v2.1
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Fixes:
 *  - ensureSchema() called on module load — creates user_id column if missing
 *  - submitPublic: robust user field extraction from any auth middleware shape
 *  - Rate-limit check uses user_id (not session) for accuracy
 *  - All query errors surfaced with descriptive messages
 *  - Consistent response shape: { success, data, message, pagination? }
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict'

const { query }    = require('../config/db')
const { paginate } = require('../utils/helpers')
const logger       = require('../utils/logger')

// ── Column list used in all SELECT/RETURNING ──────────────────────────────────
const COLS = `
  id, name, location, avatar_url, rating, trip, date_text,
  testimonial_text, is_featured, is_active, sort_order,
  created_at, updated_at
`.trim()

// ── Fields an admin may update ────────────────────────────────────────────────
const ALLOWED_FIELDS = [
  'name', 'location', 'avatar_url', 'rating', 'trip',
  'date_text', 'testimonial_text', 'is_featured', 'is_active', 'sort_order',
]

// ── Max words allowed in public submissions ───────────────────────────────────
const MAX_WORDS = 60

// ── Schema guard — adds user_id column if missing (idempotent) ───────────────
const ensureSchema = async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS testimonials (
        id               SERIAL PRIMARY KEY,
        name             VARCHAR(255) NOT NULL,
        location         VARCHAR(255),
        avatar_url       VARCHAR(500),
        rating           INTEGER      DEFAULT 5,
        trip             VARCHAR(255),
        date_text        VARCHAR(100),
        testimonial_text TEXT         NOT NULL,
        is_featured      BOOLEAN      DEFAULT false,
        is_active        BOOLEAN      DEFAULT true,
        sort_order       INTEGER      DEFAULT 0,
        user_id          INTEGER,
        created_at       TIMESTAMP    DEFAULT NOW(),
        updated_at       TIMESTAMP    DEFAULT NOW()
      )
    `)

    // Add user_id column to existing tables (safe — IF NOT EXISTS)
    await query(`
      ALTER TABLE testimonials
        ADD COLUMN IF NOT EXISTS user_id INTEGER
    `).catch(() => {}) // ignore if already exists

    // Indexes
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_testimonials_active   ON testimonials(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_testimonials_featured ON testimonials(is_featured)`,
      `CREATE INDEX IF NOT EXISTS idx_testimonials_user     ON testimonials(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_testimonials_sort     ON testimonials(sort_order ASC)`,
    ]
    for (const idx of indexes) {
      await query(idx).catch(() => {})
    }
  } catch (err) {
    logger.warn('[Testimonials] Schema ensure non-fatal:', err.message)
  }
}

// Run schema check once at module load (non-blocking)
ensureSchema()

/* ═══════════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════════ */

const wordCount = (str = '') =>
  String(str).trim().split(/\s+/).filter(Boolean).length

const safeInt = (v, def = 1) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : def
}

/** Extract user info from any shape auth middleware might attach */
const extractUser = (req) => {
  const u = req.user || req.currentUser || {}
  return {
    id:     u.id    || u.userId    || u.user_id  || null,
    name:   u.full_name || u.fullName || u.name  || null,
    email:  u.email || null,
    avatar: u.avatar_url || u.avatarUrl || u.avatar || null,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   PUBLIC ENDPOINTS
═══════════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/testimonials
 * Paginated list of active testimonials.
 */
exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, featured } = req.query
    const params  = []
    const clauses = ['is_active = true']
    let   idx     = 1

    if (featured !== undefined) {
      clauses.push(`is_featured = $${idx++}`)
      params.push(featured === 'true')
    }

    const where      = `WHERE ${clauses.join(' AND ')}`
    const countRes   = await query(`SELECT COUNT(*) FROM testimonials ${where}`, params)
    const pagination = paginate(parseInt(countRes.rows[0].count, 10), page, limit)

    params.push(pagination.limit, pagination.offset)

    const result = await query(
      `SELECT ${COLS} FROM testimonials ${where}
       ORDER BY is_featured DESC, sort_order ASC, created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    )

    res.json({ success: true, data: result.rows, pagination })
  } catch (err) { next(err) }
}

/**
 * GET /api/testimonials/featured
 * Top 12 featured active testimonials.
 */
exports.getFeatured = async (req, res, next) => {
  try {
    const limit  = Math.min(safeInt(req.query.limit, 12), 50)
    const result = await query(
      `SELECT ${COLS} FROM testimonials
       WHERE is_active = true AND is_featured = true
       ORDER BY sort_order ASC, created_at DESC
       LIMIT $1`,
      [limit],
    )
    res.json({ success: true, data: result.rows, count: result.rows.length })
  } catch (err) { next(err) }
}

/**
 * GET /api/testimonials/stats
 * Aggregate stats for dashboard.
 */
exports.getStats = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE is_active  = true)        AS active,
        COUNT(*) FILTER (WHERE is_active  = false)       AS inactive,
        COUNT(*) FILTER (WHERE is_featured = true)       AS featured,
        ROUND(AVG(rating), 2)                            AS avg_rating,
        COUNT(*) FILTER (WHERE rating = 5)               AS five_star,
        COUNT(*) FILTER (WHERE rating = 4)               AS four_star,
        COUNT(*) FILTER (WHERE rating <= 3)              AS three_or_less
      FROM testimonials
    `)
    res.json({ success: true, data: result.rows[0] })
  } catch (err) { next(err) }
}

/**
 * GET /api/testimonials/:id
 * Single testimonial by numeric ID.
 */
exports.getOne = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0)
    if (!id || id < 1)
      return res.status(400).json({ success: false, error: 'Invalid testimonial ID' })

    const result = await query(
      `SELECT ${COLS} FROM testimonials WHERE id = $1`,
      [id],
    )

    if (!result.rows[0])
      return res.status(404).json({ success: false, error: 'Testimonial not found' })

    res.json({ success: true, data: result.rows[0] })
  } catch (err) { next(err) }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   PUBLIC SUBMIT — POST /api/testimonials/submit
═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Authenticated users submit their own review.
 * Saved as is_active=false — admin must approve before it's public.
 *
 * Rules:
 *  - Must be authenticated (protect middleware)
 *  - Max 60 words
 *  - Rating 1–5
 *  - Max 1 submission per user per 24 hours
 *  - Avatar / display name auto-derived from user profile
 */
exports.submitPublic = async (req, res, next) => {
  try {
    const user = extractUser(req)

    if (!user.id) {
      return res.status(401).json({
        success: false,
        error:   'You must be logged in to submit a review.',
      })
    }

    // ── Extract & validate body ─────────────────────────────────────────────
    const rawText    = String(req.body.testimonial_text || '').trim()
    const rawRating  = req.body.rating
    const rawTrip    = String(req.body.trip     || '').trim()
    const rawLocation = String(req.body.location || '').trim()

    if (!rawText) {
      return res.status(400).json({
        success: false,
        error:   'Review text is required.',
      })
    }

    const wc = wordCount(rawText)
    if (wc > MAX_WORDS) {
      return res.status(400).json({
        success: false,
        error:   `Your review is ${wc} words. Please trim it to ${MAX_WORDS} words or fewer.`,
        wordCount: wc,
        maxWords:  MAX_WORDS,
      })
    }

    const ratingNum = parseInt(rawRating, 10)
    if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({
        success: false,
        error:   'Rating must be a number between 1 and 5.',
      })
    }

    // ── Rate limit: 1 per user per 24 hours ─────────────────────────────────
    const recent = await query(
      `SELECT id FROM testimonials
       WHERE user_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [user.id],
    )

    if (recent.rows.length > 0) {
      return res.status(429).json({
        success:    false,
        error:      'You have already submitted a review in the last 24 hours. Thank you for your feedback!',
        retryAfter: 86400, // seconds
      })
    }

    // ── Derive display fields ────────────────────────────────────────────────
    const displayName = (user.name || user.email?.split('@')[0] || 'Traveler').trim()

    const dateText = new Date().toLocaleDateString('en-US', {
      month: 'long',
      year:  'numeric',
    })

    // ── Insert pending review ────────────────────────────────────────────────
    const result = await query(
      `INSERT INTO testimonials
         (name, location, avatar_url, rating, trip, date_text,
          testimonial_text, is_featured, is_active, sort_order,
          user_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,false,0,$8,NOW(),NOW())
       RETURNING ${COLS}, user_id`,
      [
        displayName,
        rawLocation || null,
        user.avatar,
        ratingNum,
        rawTrip    || null,
        dateText,
        rawText,
        user.id,
      ],
    )

    logger.info(`[Testimonials] Public submit: user=${user.id} rating=${ratingNum}`)

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your review has been submitted and will appear after a quick approval check — usually within 24 hours.',
      data:    result.rows[0],
    })
  } catch (err) {
    logger.error('[Testimonials] submitPublic failed:', err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   ADMIN ENDPOINTS
═══════════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/testimonials/admin/all
 * Full list with filters — for admin dashboard.
 */
exports.adminGetAll = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 20,
      featured, active, search, rating,
      sort = 'created_at', order = 'DESC',
    } = req.query

    const params  = []
    const clauses = []
    let   idx     = 1

    if (featured !== undefined) {
      clauses.push(`is_featured = $${idx++}`)
      params.push(featured === 'true')
    }
    if (active !== undefined) {
      clauses.push(`is_active = $${idx++}`)
      params.push(active === 'true')
    }
    if (rating) {
      clauses.push(`rating = $${idx++}`)
      params.push(parseInt(rating, 10))
    }
    if (search) {
      clauses.push(`(
        name             ILIKE $${idx} OR
        testimonial_text ILIKE $${idx} OR
        location         ILIKE $${idx} OR
        trip             ILIKE $${idx}
      )`)
      params.push(`%${search.trim()}%`)
      idx++
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const SORT_WHITELIST = new Set(['id', 'name', 'rating', 'sort_order', 'created_at', 'updated_at'])
    const sortCol        = SORT_WHITELIST.has(sort) ? sort : 'created_at'
    const sortDir        = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'

    const countRes   = await query(`SELECT COUNT(*) FROM testimonials ${where}`, params)
    const pagination = paginate(parseInt(countRes.rows[0].count, 10), page, limit)

    params.push(pagination.limit, pagination.offset)

    const result = await query(
      `SELECT ${COLS}, user_id FROM testimonials ${where}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    )

    res.json({ success: true, data: result.rows, pagination })
  } catch (err) { next(err) }
}

/**
 * POST /api/testimonials
 * Admin creates a testimonial directly (active immediately).
 */
exports.create = async (req, res, next) => {
  try {
    const {
      name, location, avatar_url, rating = 5, trip,
      date_text, testimonial_text,
      is_featured = false, is_active = true, sort_order = 0,
    } = req.body

    if (!String(name || '').trim())
      return res.status(400).json({ success: false, error: 'Name is required' })
    if (!String(testimonial_text || '').trim())
      return res.status(400).json({ success: false, error: 'Testimonial text is required' })

    const ratingNum = parseInt(rating, 10)
    if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5)
      return res.status(400).json({ success: false, error: 'Rating must be 1–5' })

    const result = await query(
      `INSERT INTO testimonials
         (name, location, avatar_url, rating, trip, date_text,
          testimonial_text, is_featured, is_active, sort_order,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
       RETURNING ${COLS}`,
      [
        String(name).trim(),
        String(location || '').trim()    || null,
        String(avatar_url || '').trim()  || null,
        ratingNum,
        String(trip || '').trim()        || null,
        String(date_text || '').trim()   || null,
        String(testimonial_text).trim(),
        Boolean(is_featured),
        Boolean(is_active),
        parseInt(sort_order, 10) || 0,
      ],
    )

    res.status(201).json({
      success: true,
      data:    result.rows[0],
      message: 'Testimonial created successfully',
    })
  } catch (err) { next(err) }
}

/**
 * PUT/PATCH /api/testimonials/:id
 * Admin updates any field.
 */
exports.update = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0)
    if (!id || id < 1)
      return res.status(400).json({ success: false, error: 'Invalid testimonial ID' })

    const existing = await query('SELECT id FROM testimonials WHERE id=$1', [id])
    if (!existing.rows[0])
      return res.status(404).json({ success: false, error: 'Testimonial not found' })

    const updates = {}
    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) updates[field] = req.body[field]
    }

    if (!Object.keys(updates).length)
      return res.status(400).json({ success: false, error: 'No valid fields to update' })

    if (updates.rating !== undefined) {
      const r = parseInt(updates.rating, 10)
      if (!Number.isFinite(r) || r < 1 || r > 5)
        return res.status(400).json({ success: false, error: 'Rating must be 1–5' })
      updates.rating = r
    }

    const keys      = Object.keys(updates)
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')
    const values    = [...keys.map(k => updates[k]), id]

    const result = await query(
      `UPDATE testimonials SET ${setClause}, updated_at=NOW()
       WHERE id=$${values.length} RETURNING ${COLS}`,
      values,
    )

    res.json({
      success: true,
      data:    result.rows[0],
      message: 'Testimonial updated',
    })
  } catch (err) { next(err) }
}

/**
 * PATCH /api/testimonials/:id/toggle-featured
 */
exports.toggleFeatured = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0)
    if (!id || id < 1)
      return res.status(400).json({ success: false, error: 'Invalid testimonial ID' })

    const result = await query(
      `UPDATE testimonials SET is_featured=NOT is_featured, updated_at=NOW()
       WHERE id=$1 RETURNING ${COLS}`,
      [id],
    )

    if (!result.rows[0])
      return res.status(404).json({ success: false, error: 'Testimonial not found' })

    const u = result.rows[0]
    res.json({
      success: true,
      data:    u,
      message: u.is_featured ? 'Marked as featured' : 'Removed from featured',
    })
  } catch (err) { next(err) }
}

/**
 * PATCH /api/testimonials/:id/toggle-active
 */
exports.toggleActive = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0)
    if (!id || id < 1)
      return res.status(400).json({ success: false, error: 'Invalid testimonial ID' })

    const result = await query(
      `UPDATE testimonials SET is_active=NOT is_active, updated_at=NOW()
       WHERE id=$1 RETURNING ${COLS}`,
      [id],
    )

    if (!result.rows[0])
      return res.status(404).json({ success: false, error: 'Testimonial not found' })

    const u = result.rows[0]
    res.json({
      success: true,
      data:    u,
      message: u.is_active ? 'Testimonial activated' : 'Testimonial deactivated',
    })
  } catch (err) { next(err) }
}

/**
 * PATCH /api/testimonials/reorder
 */
exports.reorder = async (req, res, next) => {
  try {
    const { items } = req.body
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ success: false, error: 'items array is required' })

    const ids    = items.map(i => parseInt(i.id, 10))
    const orders = items.map(i => parseInt(i.sort_order, 10))

    if (ids.some(isNaN) || orders.some(isNaN))
      return res.status(400).json({ success: false, error: 'All items must have numeric id and sort_order' })

    await query(
      `UPDATE testimonials AS t
         SET sort_order = v.sort_order::INTEGER, updated_at=NOW()
       FROM (
         SELECT UNNEST($1::INTEGER[]) AS id,
                UNNEST($2::INTEGER[]) AS sort_order
       ) AS v
       WHERE t.id = v.id`,
      [ids, orders],
    )

    res.json({ success: true, message: `${items.length} testimonials reordered` })
  } catch (err) { next(err) }
}

/**
 * DELETE /api/testimonials/:id
 */
exports.remove = async (req, res, next) => {
  try {
    const id = safeInt(req.params.id, 0)
    if (!id || id < 1)
      return res.status(400).json({ success: false, error: 'Invalid testimonial ID' })

    const result = await query(
      'DELETE FROM testimonials WHERE id=$1 RETURNING id, name',
      [id],
    )

    if (!result.rows[0])
      return res.status(404).json({ success: false, error: 'Testimonial not found' })

    res.json({
      success: true,
      message: `"${result.rows[0].name}" deleted`,
      data:    { id: result.rows[0].id },
    })
  } catch (err) { next(err) }
}

/**
 * DELETE /api/testimonials (bulk)
 */
exports.bulkDelete = async (req, res, next) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ success: false, error: 'ids array is required' })

    const validIds = ids.map(id => parseInt(id, 10)).filter(id => Number.isFinite(id) && id > 0)
    if (!validIds.length)
      return res.status(400).json({ success: false, error: 'No valid IDs provided' })

    const result = await query(
      `DELETE FROM testimonials WHERE id=ANY($1::INTEGER[]) RETURNING id`,
      [validIds],
    )

    res.json({
      success: true,
      message: `${result.rows.length} testimonial(s) deleted`,
      data:    { deleted: result.rows.map(r => r.id) },
    })
  } catch (err) { next(err) }
}