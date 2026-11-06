// routes/packages.js
const express  = require('express')
const crypto = require('crypto')
const router   = express.Router()
const { query: db } = require('../config/db')
const { authenticate, optionalAuth, requireAdmin } = require('../middleware/auth')
const logger   = require('../utils/logger')
const { destroyCloudinaryUrls } = require('../utils/cloudinaryCleanup')
const { enqueueContextCampaign } = require('../utils/emailCampaignQueue')
const { notifyPackageBookingCreated, createNotificationInternal } = require('../controllers/notificationsController')

let packageCommentsSchemaPromise = null
const ensurePackageCommentsSchema = () => {
  if (!packageCommentsSchemaPromise) {
    packageCommentsSchemaPromise = (async () => {
      await db(`
        CREATE TABLE IF NOT EXISTS package_comments (
          id SERIAL PRIMARY KEY,
          package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          author_name VARCHAR(255) NOT NULL,
          author_avatar TEXT,
          content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
          is_approved BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      await db(`CREATE INDEX IF NOT EXISTS idx_package_comments_package_created ON package_comments(package_id, created_at DESC)`)
    })().catch((error) => {
      packageCommentsSchemaPromise = null
      throw error
    })
  }
  return packageCommentsSchemaPromise
}

/* ═══════════════════════════════════════════════════════════════════════════
   SAFE REQUIRE: EMAIL SERVICE (for booking notifications)
═══════════════════════════════════════════════════════════════════════════ */
let sendBookingReceivedEmail = null
let sendAdminBookingNotification = null
let sendBookingConfirmation = null

const EMAIL_PATHS = [
  '../utils/bookingEmails',
  '../services/emailService',
  '../utils/emailService',
  '../services/email',
  '../utils/email',
]

for (const p of EMAIL_PATHS) {
  try {
    const mod = require(p)
    sendBookingReceivedEmail     = sendBookingReceivedEmail     || mod.sendBookingReceivedEmail     || null
    sendAdminBookingNotification = sendAdminBookingNotification || mod.sendAdminBookingNotification || null
    sendBookingConfirmation = sendBookingConfirmation || mod.sendBookingConfirmation || null
    if (sendBookingReceivedEmail || sendAdminBookingNotification) {
      logger.info(`[Packages] ✅ Email service loaded from: ${p}`)
      break
    }
  } catch { /* try next */ }
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */

const slugify = (str) =>
  String(str || '').toLowerCase().trim()
     .replace(/[^\w\s-]/g, '')
     .replace(/\s+/g, '-')
     .replace(/-+/g, '-')

const genBookingRef = (id) =>
  `PKG-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(id || Math.floor(10000 + Math.random() * 90000)).slice(-5)}`

const asyncNoThrow = (promise, label) => {
  Promise.resolve(promise).catch((e) => {
    logger.warn(`[Packages] ${label} failed:`, e.message)
  })
}

const packageImage = (body = {}) => String(
  body.cover_image_url || body.image_url || body.thumbnail_url || ''
).trim()

const normalizeLegacyPackageBooking = (row = {}) => ({
  ...row,
  booking_number: row.booking_ref || row.booking_number || null,
  booking_type: 'package',
  full_name: row.full_name || row.guest_name || row.user_name || null,
  email: row.email || row.guest_email || row.user_email || null,
  phone: row.phone || row.guest_phone || null,
  return_date: row.return_date || row.end_date || null,
  number_of_travelers: row.number_of_travelers ?? row.travelers_count ?? 1,
  number_of_adults: row.number_of_adults ?? row.adults ?? 1,
  number_of_children: row.number_of_children ?? row.children ?? 0,
  dietary_requirements: row.dietary_requirements || row.dietary_needs || null,
  source_table: 'package_bookings',
  user_name: row.user_name || row.full_name || row.guest_name || null,
  user_email: row.user_email || row.guest_email || row.email || null,
})

const jsonList = (value, fallback = []) => {
  if (value === undefined || value === null) return fallback
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : fallback } catch { return fallback }
  }
  return fallback
}
const packagePayload = (body = {}, existing = {}) => {
  const mode = body.poster_mode === 'poster' || body.creation_mode === 'poster' ? 'poster' : (body.poster_mode === 'manual' || body.creation_mode === 'manual' ? 'manual' : (existing.poster_mode || 'manual'))
  const gallery = jsonList(body.image_gallery ?? body.images, existing.image_gallery || [])
    .map(item => typeof item === 'string' ? item.trim() : String(item?.url || item?.image_url || '').trim())
    .filter(Boolean).slice(0, 30)
  const poster = String(body.poster_image_url || packageImage(body) || existing.cover_image_url || '').trim()
  return {
    title: String(body.title || existing.title || 'Travel package').trim().slice(0, 255),
    slug: existing.slug || slugify(body.title || 'travel-package') + '-' + Date.now(),
    description: String(body.description ?? existing.description ?? '').trim(),
    short_description: String(body.short_description ?? existing.short_description ?? '').trim(),
    cover_image_url: poster || gallery[0] || '',
    image_gallery: mode === 'poster' ? (poster ? [poster] : gallery) : gallery,
    poster_mode: mode,
    destination_id: body.destination_id === undefined ? (existing.destination_id ?? null) : (body.destination_id ? Number(body.destination_id) : null),
    price: body.price === undefined ? (existing.price ?? null) : (body.price === '' ? null : Number(body.price)),
    currency: String(body.currency || existing.currency || 'USD').slice(0, 10),
    duration_days: body.duration_days === undefined ? (existing.duration_days ?? null) : (body.duration_days === '' ? null : Number(body.duration_days)),
    duration_nights: body.duration_nights === undefined ? (existing.duration_nights ?? null) : (body.duration_nights === '' ? null : Number(body.duration_nights)),
    category: String(body.category || existing.category || '').trim(),
    highlights: jsonList(body.highlights, existing.highlights || []),
    inclusions: jsonList(body.inclusions, existing.inclusions || []),
    exclusions: jsonList(body.exclusions, existing.exclusions || []),
    review_questions: jsonList(body.review_questions, existing.review_questions || []),
    is_published: body.is_published === undefined ? (existing.is_published ?? false) : Boolean(body.is_published),
    is_featured: body.is_featured === undefined ? (existing.is_featured ?? false) : Boolean(body.is_featured),
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCHEMA GUARD
═══════════════════════════════════════════════════════════════════════════ */

let _schemaChecked = false
let _hasDestinationId = false
const ensurePackagesSchema = async () => {
  if (_schemaChecked) return
  _schemaChecked = true

  try {
    await db(`
      CREATE TABLE IF NOT EXISTS packages (
        id              SERIAL PRIMARY KEY,
        title           TEXT NOT NULL,
        slug            TEXT UNIQUE,
        description     TEXT,
        destination_id  INTEGER,
        price           NUMERIC(12,2),
        currency        VARCHAR(10) DEFAULT 'USD',
        duration_days   INTEGER,
        cover_image_url TEXT,
        is_published    BOOLEAN DEFAULT true,
        is_featured     BOOLEAN DEFAULT false,
        booking_count   INTEGER DEFAULT 0,
        view_count      INTEGER DEFAULT 0,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    const cols = [
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS destination_id INTEGER`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS booking_count INTEGER DEFAULT 0`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD'`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS price NUMERIC(12,2)`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS cover_image_url TEXT`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS category TEXT`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS poster_mode VARCHAR(20) DEFAULT 'manual'`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS image_gallery JSONB DEFAULT '[]'::jsonb`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS highlights JSONB DEFAULT '[]'::jsonb`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS inclusions JSONB DEFAULT '[]'::jsonb`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS exclusions JSONB DEFAULT '[]'::jsonb`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS review_questions JSONB DEFAULT '[]'::jsonb`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS duration_nights INTEGER`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS short_description TEXT`,
    ]
    for (const sql of cols) {
      await db(sql).catch(() => {})
    }

    const destinationColumn = await db(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'packages' AND column_name = 'destination_id'
      LIMIT 1
    `).catch(() => ({ rows: [] }))
    _hasDestinationId = destinationColumn.rows.length > 0

    // Image-based packages are the current public package workflow. Repair legacy
    // rows that were created as drafts by the old admin form so visible package
    // cards are actually requestable. Packages without an image or destination
    // remain untouched and therefore cannot be published accidentally.
    await db(`
      UPDATE packages
      SET is_published = true, updated_at = NOW()
      WHERE COALESCE(is_published, false) = false
        AND NULLIF(TRIM(COALESCE(cover_image_url, '')), '') IS NOT NULL
        AND destination_id IS NOT NULL
    `).catch((repairErr) => {
      logger.warn('[Packages] Legacy publish repair skipped:', repairErr.message)
    })

    logger.info('[Packages] ✅ Schema verified')
  } catch (err) {
    logger.warn('[Packages] Schema check failed:', err.message)
  }
}

// Fire schema check on startup (non-blocking)
ensurePackagesSchema().catch(() => {})

/* ═══════════════════════════════════════════════════════════════════════════
   GET /api/packages
═══════════════════════════════════════════════════════════════════════════ */

/* ── Public package discussion; posting requires a signed-in traveller ── */
router.get('/:packageId/comments', optionalAuth, async (req, res) => {
  try {
    await ensurePackagesSchema()
    await ensurePackageCommentsSchema()
    const packageId = Number.parseInt(req.params.packageId, 10)
    if (!Number.isInteger(packageId) || packageId < 1) return res.status(400).json({ success: false, message: 'Invalid package.' })
    const pkg = await db(`SELECT id FROM packages WHERE id = $1 AND COALESCE(is_published, false) = true LIMIT 1`, [packageId])
    if (!pkg.rows[0]) return res.status(404).json({ success: false, message: 'Package not found.' })
    const { rows } = await db(
      `SELECT c.id, c.package_id, c.user_id, c.author_name, c.author_avatar,
              c.content, c.created_at, c.updated_at,
              u.full_name AS profile_name, u.avatar_url AS profile_avatar
         FROM package_comments c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.package_id = $1 AND c.is_approved = TRUE
        ORDER BY c.created_at DESC
        LIMIT 100`,
      [packageId],
    )
    return res.json({ success: true, data: rows.map(row => ({
      id: row.id, packageId: row.package_id, content: row.content,
      createdAt: row.created_at, updatedAt: row.updated_at,
      authorName: row.profile_name || row.author_name || 'Traveller',
      authorAvatar: row.profile_avatar || row.author_avatar || null,
      userId: row.user_id,
    })) })
  } catch (error) {
    logger.error('[Packages] Load package comments failed:', error.message)
    return res.status(500).json({ success: false, message: 'Could not load package discussion.' })
  }
})

router.post('/:packageId/comments', authenticate, async (req, res) => {
  try {
    await ensurePackagesSchema()
    await ensurePackageCommentsSchema()
    const packageId = Number.parseInt(req.params.packageId, 10)
    const userId = Number.parseInt(req.user?.id, 10)
    const content = String(req.body?.content || '').trim()
    if (!Number.isInteger(packageId) || packageId < 1) return res.status(400).json({ success: false, message: 'Invalid package.' })
    if (!Number.isInteger(userId) || userId < 1) return res.status(401).json({ success: false, message: 'Sign in to join this discussion.' })
    if (!content || content.length > 4000) return res.status(400).json({ success: false, message: 'Write a comment of 1–4,000 characters.' })
    const pkg = await db(`SELECT id FROM packages WHERE id = $1 AND COALESCE(is_published, false) = true LIMIT 1`, [packageId])
    if (!pkg.rows[0]) return res.status(404).json({ success: false, message: 'Package not found.' })
    const profile = await db(`SELECT full_name, avatar_url FROM users WHERE id = $1 LIMIT 1`, [userId])
    const name = String(profile.rows[0]?.full_name || req.user?.full_name || req.user?.name || 'Traveller').trim().slice(0,255)
    const avatar = profile.rows[0]?.avatar_url || req.user?.avatar_url || req.user?.avatar || null
    const { rows } = await db(
      `INSERT INTO package_comments (package_id, user_id, author_name, author_avatar, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, package_id, user_id, author_name, author_avatar, content, created_at, updated_at`,
      [packageId, userId, name, avatar, content],
    )
    const row = rows[0]
    return res.status(201).json({ success: true, data: {
      id: row.id, packageId: row.package_id, userId: row.user_id,
      authorName: row.author_name, authorAvatar: row.author_avatar,
      content: row.content, createdAt: row.created_at, updatedAt: row.updated_at,
    } })
  } catch (error) {
    logger.error('[Packages] Create package comment failed:', error.message)
    return res.status(500).json({ success: false, message: 'Could not publish your comment.' })
  }
})

router.get('/', optionalAuth, async (req, res) => {
  try {
    await ensurePackagesSchema()

    const {
      page = 1,
      limit = 10,
      sort = 'featured',
      sortBy,
      order,
      destination,
      search,
      category,
      duration,
      minPrice,
      maxPrice,
    } = req.query
    const parsedLimit  = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100)
    const parsedPage   = Math.max(parseInt(page, 10) || 1, 1)
    const parsedOffset = (parsedPage - 1) * parsedLimit

    const where = []
    const vals  = []
    const canSeeUnpublished = req.userType === 'admin' || req.user?.role === 'admin' || req.user?.is_admin === true || req.user?.isAdmin === true

    // Public package cards must never expose drafts/unpublished packages.
    // Admin users still need the same endpoint to manage drafts.
    if (!canSeeUnpublished) {
      where.push('COALESCE(p.is_published, false) = true')
    }

    if (destination) {
      vals.push(destination)
      where.push(_hasDestinationId
        ? `p.destination_id = ${vals.length}`
        : `p.destination = ${vals.length}`)
    }

    if (search) {
      vals.push(`%${String(search).trim()}%`)
      where.push(`(p.title ILIKE ${vals.length} OR COALESCE(p.description, '') ILIKE ${vals.length})`)
    }
    if (category) {
      vals.push(String(category).trim())
      where.push(`LOWER(COALESCE(p.category, '')) = LOWER(${vals.length})`)
    }
    if (duration) {
      const maxDays = parseInt(duration, 10)
      if (Number.isFinite(maxDays) && maxDays > 0) {
        vals.push(maxDays)
        where.push(`COALESCE(p.duration_days, 0) <= ${vals.length}`)
      }
    }
    if (minPrice !== undefined && minPrice !== '') {
      vals.push(Number(minPrice))
      where.push(`COALESCE(p.price, 0) >= ${vals.length}`)
    }
    if (maxPrice !== undefined && maxPrice !== '') {
      vals.push(Number(maxPrice))
      where.push(`COALESCE(p.price, 0) <= ${vals.length}`)
    }

    let orderBy = 'p.is_featured DESC NULLS LAST, p.created_at DESC'
    const effectiveSort = sortBy || sort
    if (effectiveSort === 'price_asc' || (effectiveSort === 'price' && order === 'asc')) {
      orderBy = 'COALESCE(p.price, 0) ASC, p.id ASC'
    } else if (effectiveSort === 'price_desc' || (effectiveSort === 'price' && order === 'desc')) {
      orderBy = 'COALESCE(p.price, 0) DESC, p.id DESC'
    } else if (effectiveSort === 'latest' || (effectiveSort === 'created_at' && order === 'desc')) {
      orderBy = 'p.created_at DESC'
    } else if (effectiveSort === 'popular' || (effectiveSort === 'view_count' && order === 'desc')) {
      orderBy = `${liveBookingCount} DESC, COALESCE(p.view_count,0) DESC`
    } else if (effectiveSort === 'sort_order') {
      orderBy = 'COALESCE(p.sort_order, 0) ASC, p.is_featured DESC NULLS LAST, p.created_at DESC'
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const liveBookingCount = `(
      (SELECT COUNT(*)::INTEGER FROM bookings b WHERE b.package_id = p.id)
      +
      (SELECT COUNT(*)::INTEGER FROM package_bookings pb WHERE pb.package_id = p.id)
    )`

    let countRes
    try {
      countRes = await db(`SELECT COUNT(*) FROM packages p ${whereSql}`, vals)
    } catch (dbErr) {
      logger.error('[Packages] COUNT query failed:', dbErr.message, dbErr.stack)
      return res.json({
        success: true,
        data: [],
        pagination: { total: 0, page: parsedPage, limit: parsedLimit, pages: 0 },
        warning: 'Packages table may not be initialized.',
      })
    }

    const dataVals   = [...vals]
    const limitIdx   = dataVals.push(parsedLimit)
    const offsetIdx  = dataVals.push(parsedOffset)

    const destinationSelect = _hasDestinationId
      ? 'd.name AS destination_name, d.slug AS destination_slug, d.country_id AS destination_country_id, co.name AS country_name, co.slug AS country_slug'
      : 'p.destination AS destination_name, NULL AS destination_slug, NULL AS destination_country_id, p.country AS country_name, NULL AS country_slug'
    const destinationJoin = _hasDestinationId
      ? 'LEFT JOIN destinations d ON d.id = p.destination_id LEFT JOIN countries co ON co.id = d.country_id'
      : ''

    const dataRes   = await db(
      `SELECT p.*,
              ${liveBookingCount} AS booking_count,
              ${destinationSelect}
       FROM packages p
       ${destinationJoin}
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      dataVals,
    )

    return res.json({
      success: true,
      data: dataRes.rows,
      pagination: {
        total: parseInt(countRes.rows[0].count, 10),
        page:  parsedPage,
        limit: parsedLimit,
        pages: Math.ceil(parseInt(countRes.rows[0].count, 10) / parsedLimit),
      },
    })
  } catch (err) {
    logger.error('[Packages] fetch error:', err.message, err.stack)
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch packages',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    })
  }
})

/* Keep this before /:id: otherwise Express treats "stats" as a package ID. */
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    await ensurePackagesSchema()
    const result = await db(`
      SELECT COUNT(*)::INTEGER AS total,
             COUNT(*) FILTER (WHERE is_published = true)::INTEGER AS published,
             COUNT(*) FILTER (WHERE is_featured = true)::INTEGER AS featured,
             (
               (SELECT COUNT(*) FROM bookings b INNER JOIN packages p ON p.id = b.package_id)
               +
               (SELECT COUNT(*) FROM package_bookings pb INNER JOIN packages p ON p.id = pb.package_id)
             )::INTEGER AS bookings,
             (
               SELECT COUNT(*)::INTEGER
                 FROM package_messages pm
                WHERE COALESCE(pm.is_read, false) = false
                  AND COALESCE(pm.sender_type, '') <> 'admin'
             ) AS unread_messages
      FROM packages
    `)
    const pendingResult = await db(`
      SELECT (
        (SELECT COUNT(*) FROM bookings b INNER JOIN packages p ON p.id = b.package_id WHERE b.status = 'pending')
        +
        (SELECT COUNT(*) FROM package_bookings pb INNER JOIN packages p ON p.id = pb.package_id WHERE pb.status = 'pending')
      )::INTEGER AS pending
    `).catch(() => ({ rows: [{ pending: 0 }] }))
    const row = result.rows[0]
    const pending = Number(pendingResult.rows?.[0]?.pending || 0)
    return res.json({
      success: true,
      data: {
        ...row,
        packages: { total: row.total, published: row.published, featured: row.featured },
        bookings: { total: row.bookings, pending },
        messages: { unread: Number(row.unread_messages || 0) },
      },
    })
  } catch (err) {
    logger.error('[Packages] stats error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to fetch package stats' })
  }
})

// Admin packages are represented by one uploaded poster image.
router.post('/', requireAdmin, async (req, res) => {
  try {
    await ensurePackagesSchema()
    const payload = packagePayload(req.body)
    if (!payload.cover_image_url) {
      return res.status(400).json({ success: false, error: 'A package poster image is required' })
    }
    if (payload.poster_mode === 'manual' && payload.image_gallery.length < 2) {
      return res.status(400).json({ success: false, error: 'Manual packages require at least two images' })
    }
    if (payload.poster_mode === 'poster' && !payload.cover_image_url) {
      return res.status(400).json({ success: false, error: 'Upload a package poster or provide its image URL' })
    }
    const result = await db(
      `INSERT INTO packages
        (title, slug, description, short_description, cover_image_url, image_gallery, poster_mode,
         destination_id, price, currency, duration_days, duration_nights, category, highlights, inclusions, exclusions, review_questions, is_published, is_featured)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19) RETURNING *`,
      [payload.title, payload.slug, payload.description, payload.short_description, payload.cover_image_url,
       JSON.stringify(payload.image_gallery), payload.poster_mode, payload.destination_id, payload.price, payload.currency,
       payload.duration_days, payload.duration_nights, payload.category, JSON.stringify(payload.highlights),
       JSON.stringify(payload.inclusions), JSON.stringify(payload.exclusions), JSON.stringify(payload.review_questions), payload.is_published, payload.is_featured],
    )
    return res.status(201).json({ success: true, data: result.rows[0] })
  } catch (err) {
    logger.error('[Packages] create error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to create package' })
  }
})

router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    await ensurePackagesSchema()
    const current = await db('SELECT * FROM packages WHERE id = $1', [req.params.id])
    if (!current.rows.length) return res.status(404).json({ success: false, error: 'Package not found' })
    const payload = packagePayload(req.body, current.rows[0])
    if (payload.poster_mode === 'manual' && payload.image_gallery.length < 2) {
      return res.status(400).json({ success: false, error: 'Manual packages require at least two images' })
    }
    if (payload.poster_mode === 'poster' && !payload.cover_image_url) {
      return res.status(400).json({ success: false, error: 'Upload a package poster or provide its image URL' })
    }
    const result = await db(
      `UPDATE packages SET title=$1, description=$2, short_description=$3, cover_image_url=$4,
       image_gallery=$5::jsonb, poster_mode=$6, destination_id=$7, price=$8, currency=$9,
       duration_days=$10, duration_nights=$11, category=$12, highlights=$13::jsonb,
       inclusions=$14::jsonb, exclusions=$15::jsonb, review_questions=$16::jsonb, is_published=$17, is_featured=$18, updated_at=NOW()
       WHERE id=$19 RETURNING *`,
      [payload.title, payload.description, payload.short_description, payload.cover_image_url,
       JSON.stringify(payload.image_gallery), payload.poster_mode, payload.destination_id, payload.price, payload.currency,
       payload.duration_days, payload.duration_nights, payload.category, JSON.stringify(payload.highlights),
       JSON.stringify(payload.inclusions), JSON.stringify(payload.exclusions), JSON.stringify(payload.review_questions), payload.is_published, payload.is_featured, req.params.id],
    )
    const row = result.rows[0]
    return res.json({
      success: true,
      data: {
        ...row,
        packages: { total: row.total, published: row.published, featured: row.featured },
        bookings: { total: row.bookings, pending: 0 },
        messages: { unread: 0 },
      },
    })
  } catch (err) {
    logger.error('[Packages] update error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to update package' })
  }
})

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const media = await db('SELECT cover_image_url, image_gallery FROM packages WHERE id = $1', [req.params.id])
    if (!media.rows.length) return res.status(404).json({ success: false, error: 'Package not found' })
    const row = media.rows[0]
    const urls = [row.cover_image_url]
    const collectUrls = (value) => {
      if (!value) return
      if (typeof value === 'string') {
        if (/res\.cloudinary\.com\//i.test(value)) urls.push(value)
        else {
          try { collectUrls(JSON.parse(value)) } catch {}
        }
      } else if (Array.isArray(value)) value.forEach(collectUrls)
      else if (typeof value === 'object') Object.values(value).forEach(collectUrls)
    }
    collectUrls(row.image_gallery)
    const result = await db('DELETE FROM packages WHERE id = $1 RETURNING id', [req.params.id])
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Package not found' })
    await destroyCloudinaryUrls(urls)
    return res.json({ success: true, data: { id: result.rows[0].id } })
  } catch (err) {
    logger.error('[Packages] delete error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to delete package' })
  }
})

router.post('/:id/:action(publish|unpublish)', requireAdmin, async (req, res) => {
  try {
    const isPublished = req.params.action === 'publish'
    const previous = await db(
      'SELECT id, is_published, title, slug, cover_image_url, destination_id FROM packages WHERE id = $1 LIMIT 1',
      [req.params.id],
    )
    if (!previous.rows.length) return res.status(404).json({ success: false, error: 'Package not found' })
    const result = await db(
      'UPDATE packages SET is_published = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [isPublished, req.params.id],
    )
    const pkg = result.rows[0]
    if (isPublished && !previous.rows[0].is_published) {
      const frontendUrl = (process.env.FRONTEND_URL || 'https://www.altuverasafaris.com').replace(/\/+$/, '')
      enqueueContextCampaign({
        context: 'new_package',
        io: req.app.get('io'),
        data: {
          packageName: pkg.title || previous.rows[0].title || 'New Altuvera package',
          heroImageUrl: pkg.cover_image_url || previous.rows[0].cover_image_url || '',
          contentUrl: frontendUrl + '/packages/' + encodeURIComponent(pkg.slug || pkg.id),
          packageId: pkg.id,
          destinationId: pkg.destination_id,
        },
      }).catch((emailErr) => logger.warn('[Packages] contextual email queue failed:', emailErr.message))
    }
    return res.json({ success: true, data: pkg })
  } catch (err) {
    logger.error('[Packages] publish error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to update package status' })
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   GET /api/packages/slug/:slug
   Public slug lookup used by the website package detail pages.
═══════════════════════════════════════════════════════════════════════════ */
router.get('/slug/:slug', optionalAuth, async (req, res) => {
  try {
    await ensurePackagesSchema()
    const canSeeUnpublished = req.userType === 'admin' || req.user?.role === 'admin' || req.user?.is_admin === true || req.user?.isAdmin === true
    const slug = String(req.params.slug || '').trim().toLowerCase()
    if (!slug) return res.status(400).json({ success: false, error: 'Package slug is required' })

    const pkg = await db(
      `SELECT p.*,
              d.name AS destination_name,
              d.slug AS destination_slug
       FROM packages p
       LEFT JOIN destinations d ON d.id = p.destination_id
       WHERE LOWER(p.slug) = $1
         AND (COALESCE(p.is_published, false) = true OR $2 = true)
       LIMIT 1`,
      [slug, canSeeUnpublished],
    )

    if (!pkg.rows.length) {
      return res.status(404).json({ success: false, error: 'Package not found' })
    }

    db('UPDATE packages SET view_count = COALESCE(view_count,0) + 1 WHERE id = $1', [pkg.rows[0].id])
      .catch(() => {})

    return res.json({ success: true, data: pkg.rows[0] })
  } catch (err) {
    logger.error('[Packages] fetch slug error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to fetch package' })
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   GET /api/packages/:id
═══════════════════════════════════════════════════════════════════════════ */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const canSeeUnpublished = req.userType === 'admin' || req.user?.role === 'admin' || req.user?.is_admin === true || req.user?.isAdmin === true
    const pkg = await db(
      `SELECT p.*,
              d.name AS destination_name,
              d.slug AS destination_slug
       FROM packages p
       LEFT JOIN destinations d ON d.id = p.destination_id
       WHERE p.id = $1
         AND (COALESCE(p.is_published, false) = true OR $2 = true)`,
      [req.params.id, canSeeUnpublished],
    )

    if (!pkg.rows.length) {
      return res.status(404).json({ success: false, error: 'Package not found' })
    }

    // Fire-and-forget view count bump
    db('UPDATE packages SET view_count = COALESCE(view_count,0) + 1 WHERE id = $1', [req.params.id])
      .catch(() => {})

    return res.json({ success: true, data: pkg.rows[0] })
  } catch (err) {
    logger.error('[Packages] fetch ID error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to fetch package' })
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   GET /api/packages/:id/availability
═══════════════════════════════════════════════════════════════════════════ */
router.get('/:id/availability', optionalAuth, async (req, res) => {
  try {
    const pkgId = req.params.id
    const { startDate, endDate } = req.query

    const [pkg, bookings] = await Promise.all([
      db('SELECT id FROM packages WHERE id = $1', [pkgId]),
      db(
        `SELECT travel_date, return_date FROM bookings
         WHERE package_id = $1
           AND status NOT IN ('cancelled', 'completed')
           AND (
             (travel_date BETWEEN $2 AND $3) OR
             (return_date BETWEEN $2 AND $3) OR
             ($2 BETWEEN travel_date AND return_date)
           )`,
        [pkgId, startDate || '1900-01-01', endDate || '9999-12-31'],
      ).catch(() => ({ rows: [] })),
    ])

    if (!pkg.rows.length) {
      return res.status(404).json({ success: false, error: 'Package not found' })
    }

    const bookedDates = []
    for (const b of bookings.rows) {
      if (!b.travel_date) continue
      let current = new Date(b.travel_date)
      const end   = b.return_date ? new Date(b.return_date) : current
      while (current <= end) {
        bookedDates.push(current.toISOString().split('T')[0])
        const next = new Date(current)
        next.setDate(next.getDate() + 1)
        current = next
      }
    }

    return res.json({
      success: true,
      data: {
        package_id:      pkgId,
        booked_dates:    [...new Set(bookedDates)],
        available_dates: [],
      },
    })
  } catch (err) {
    logger.error('[Packages] availability error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to check availability' })
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   POST /api/packages/:id/book
═══════════════════════════════════════════════════════════════════════════ */
router.post('/:id/book', authenticate, async (req, res) => {
  try {
    const pkgId = req.params.id
    const {
      guest_name, full_name, name,
      guest_email, email,
      guest_phone, phone,
      travelers_count, adults = 1, children = 0,
      travel_date, startDate,
      end_date, endDate,
      special_requests, specialRequests,
      nationality, country_of_residence, preferred_contact_method,
      accommodation_preference, trip_style, budget_range,
      newsletter_opt_in, newsletterOptIn: newsletterOptInCamel,
    } = req.body

    // Ensure the legacy bookings table has every column used by the package-request flow.
    // Older production schemas may predate package-specific requests.
    const bookingColumns = [
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_number TEXT`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS destination_id INTEGER`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS package_id INTEGER`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS full_name TEXT`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email TEXT`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS phone TEXT`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS travel_date DATE`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS return_date DATE`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS number_of_travelers INTEGER DEFAULT 1`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS number_of_adults INTEGER DEFAULT 1`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS number_of_children INTEGER DEFAULT 0`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS special_requests TEXT`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type TEXT DEFAULT 'custom'`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'website'`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS user_id INTEGER`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS verification_token VARCHAR(128)`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS verification_token_exp TIMESTAMPTZ`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS newsletter_opt_in BOOLEAN DEFAULT false`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    ];
    for (const sql of bookingColumns) {
      await db(sql);
    }

    // Load package
    const pkg = await db(
      `SELECT id, title, price, currency, destination_id, is_published, cover_image_url
       FROM packages WHERE id = $1`,
      [pkgId],
    )
    if (!pkg.rows.length) {
      return res.status(404).json({ success: false, error: 'Package not found' })
    }
    const p = pkg.rows[0]

    if (p.is_published === false) {
      return res.status(400).json({ success: false, error: 'Package is not available for booking' })
    }
    if (!p.destination_id) {
      return res.status(409).json({ success: false, error: 'This package is not linked to a destination yet. Please select its destination in the admin panel before accepting requests.' })
    }

    // Normalize input
    const nameCandidates = [
      req.user?.full_name,
      req.user?.fullName,
      guest_name,
      full_name,
      name,
      req.user?.name,
    ].map((value) => String(value || '').trim()).filter((value) => value.length >= 2)
    const finalName = nameCandidates[0] || ''
    const userEmail = String(req.user?.email || '').trim().toLowerCase()
    const submittedEmail = String(guest_email || email || '').trim().toLowerCase()
    const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    // Keep the authenticated email when valid; fall back to the submitted account value
    // if an older session contains an empty or malformed email field.
    const finalEmail = isValidEmail(userEmail) ? userEmail : (submittedEmail || userEmail)
    const finalPhone   = String(guest_phone || phone || '').trim() || null
    const finalTravel  = travel_date || startDate || null
    const wantsEmailUpdates = newsletter_opt_in === true || newsletter_opt_in === 'true' || newsletterOptInCamel === true || newsletterOptInCamel === 'true'
    const finalEnd     = end_date  || endDate  || null
    const requestProfile = [
      special_requests || specialRequests,
      nationality && `Nationality: ${nationality}`,
      country_of_residence && `Residence: ${country_of_residence}`,
      preferred_contact_method && `Preferred contact: ${preferred_contact_method}`,
      accommodation_preference && `Accommodation: ${accommodation_preference}`,
      trip_style && `Trip style: ${trip_style}`,
      budget_range && `Budget range: ${budget_range}`,
    ].filter(Boolean).join('\n')
    const finalReqs = requestProfile || null

    // Validate
    const errors = []
    if (finalName.length < 2)  errors.push('Name is required (min 2 characters)')
    if (!finalEmail)           errors.push('Email is required')
    if (finalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalEmail)) {
      errors.push('Invalid email format')
    }
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join('; ') || 'Validation failed', errors })
    }

    const adultsNum   = Math.max(1, parseInt(adults, 10)   || 1)
    const childrenNum = Math.max(0, parseInt(children, 10) || 0)
    const travelersNum = parseInt(travelers_count, 10) || (adultsNum + childrenNum)

    if (travelersNum < 1 || travelersNum > 500) {
      errors.push('Number of travelers must be between 1 and 500')
    }
    if (finalTravel) {
      const start = new Date(finalTravel)
      if (Number.isNaN(start.getTime())) {
        errors.push('Invalid travel date')
      } else {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        if (start < today) errors.push('Travel date cannot be in the past')
      }
    }
    if (finalTravel && finalEnd) {
      const start = new Date(finalTravel)
      const end = new Date(finalEnd)
      if (Number.isNaN(end.getTime())) {
        errors.push('Invalid return date')
      } else if (!Number.isNaN(start.getTime()) && end < start) {
        errors.push('Return date must be on or after the travel date')
      }
    }
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join('; ') || 'Validation failed', errors })
    }

    // Generate unique booking reference
    let bookingNumber = genBookingRef(p.id)
    for (let i = 0; i < 5; i++) {
      const existing = await db(
        'SELECT id FROM bookings WHERE booking_number = $1',
        [bookingNumber],
      ).catch(() => ({ rows: [] }))
      if (!existing.rows.length) break
      bookingNumber = genBookingRef(p.id)
    }

    // Give package requests the same verification flow as standard bookings.
    const verificationToken = crypto.randomBytes(32).toString('hex')
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)

    // Insert booking
    const result = await db(
      `INSERT INTO bookings (
         booking_number, destination_id, package_id, full_name, email, phone,
         travel_date, return_date, number_of_travelers,
         number_of_adults, number_of_children,
         special_requests, status, booking_type, source, user_id,
         email_verified, email_verified_at, verification_token, verification_token_exp, newsletter_opt_in
       )
       VALUES ($1, $2, $3, $4, $5, $6,
               $7, $8, $9,
               $10, $11,
               $12, 'pending', 'package', 'website', $13,
               false, NULL, $14, $15, $16)
       RETURNING *`,
      [
        bookingNumber,
        p.destination_id || null,
        p.id,
        finalName,
        finalEmail,
        finalPhone,
        finalTravel,
        finalEnd,
        travelersNum,
        adultsNum,
        childrenNum,
        finalReqs,
        req.user?.id || null,
        verificationToken,
        tokenExpiry,
        wantsEmailUpdates,
      ],
    )

    const booking = result.rows[0]
    logger.info(`[Packages] ✅ Booking created: ${bookingNumber}`)

    if (wantsEmailUpdates && req.user?.id) {
      db('UPDATE users SET subscribed = true, updated_at = NOW() WHERE id = $1', [req.user.id])
        .catch((consentErr) => logger.warn('[Packages] Consent preference sync skipped:', consentErr.message))
    }

    // Keep the denormalized package count aligned with the saved booking rows.
    // Await the reconciliation before responding so the package list/stat cards
    // cannot briefly report zero after a successful request.
    await db(
      `UPDATE packages p
          SET booking_count = (
            SELECT COUNT(*)::INTEGER FROM bookings b WHERE b.package_id = p.id
          ) + (
            SELECT COUNT(*)::INTEGER FROM package_bookings pb WHERE pb.package_id = p.id
          )
        WHERE p.id = $1`,
      [p.id],
    ).catch((countErr) => {
      logger.warn('[Packages] Booking count reconciliation skipped:', countErr.message)
    })

    // Fire booking emails
    const enrichedBooking = {
      ...booking,
      package_title:    p.title,
      package_name:     p.title,
      package_price:    p.price,
      package_currency: p.currency,
      booking_type:     'package',
      user_id:          req.user?.id || null,
      user_name:        req.user?.full_name || req.user?.fullName || req.user?.name || finalName,
      user_email:       req.user?.email || finalEmail,
      user_avatar_url:  req.user?.avatar_url || req.user?.avatarUrl || req.user?.avatar || null,
    }

    // The package-specific notification sends the admin inbox email and creates
    // the direct admin workspace alert. Keep the traveller receipt separate.
    if (sendBookingReceivedEmail) {
      asyncNoThrow(sendBookingReceivedEmail(enrichedBooking), 'sendBookingReceivedEmail')
    }

    // Persist + emit an instant admin notification with a direct package request target.
    asyncNoThrow(
      notifyPackageBookingCreated(booking, p, req),
      'notifyPackageBookingCreated',
    )

    // Notify via socket.io
    try {
      const io = req.app.get('io')
      if (io) {
        io.to('admin-room').emit('booking:new', {
          booking: {
            ...enrichedBooking,
            booking_ref:    bookingNumber,
            booking_number: bookingNumber,
          },
        })
        io.emit('package:new-booking', { booking: enrichedBooking, packageId: p.id })
      }
    } catch (sockErr) {
      logger.warn('[Packages] socket emit failed:', sockErr.message)
    }

    return res.status(201).json({
      success: true,
      message: 'Package booking request submitted successfully',
      data: {
        ...enrichedBooking,
        booking_ref:    bookingNumber,
        booking_number: bookingNumber,
      },
    })
  } catch (err) {
    logger.error('[Packages] booking error:', err.message, err.stack)
    return res.status(500).json({
      success: false,
      error: 'Failed to create package booking',
      // Keep the production response safe but actionable; full SQL details stay in server logs.
      code: err.code || undefined,
      details: process.env.NODE_ENV !== 'production' ? err.message : 'The request could not be saved. Please retry; if it continues, contact support with the time of the attempt.',
    })
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   PATCH /api/packages/:id/bookings/:bId  (admin update)
═══════════════════════════════════════════════════════════════════════════ */
router.patch('/:id/bookings/:bId', requireAdmin, async (req, res) => {
  try {
    const { id, bId } = req.params
    const { status, admin_notes, payment_status } = req.body || {}
    const requestedSource = String(req.query.source || req.body?.source_table || '').toLowerCase()

    // Keep historical package_bookings records visible and editable. Newer
    // package requests are stored in bookings, but older records use this table.
    if (requestedSource === 'package_bookings') {
      const previousLegacy = await db(
        `SELECT pb.*, u.email AS user_email, u.full_name AS user_name,
                u.avatar_url AS user_avatar_url
           FROM package_bookings pb
           LEFT JOIN users u ON u.id = pb.user_id
          WHERE pb.id = $1 AND pb.package_id = $2
          LIMIT 1`,
        [bId, id],
      )
      if (!previousLegacy.rows.length) return res.status(404).json({ success: false, error: 'Package booking not found' })
      const legacySets = ['updated_at = NOW()']
      const legacyParams = []
      if (status) { legacyParams.push(status); legacySets.push(`status = ${legacyParams.length}`) }
      if (admin_notes !== undefined) { legacyParams.push(admin_notes); legacySets.push(`admin_notes = ${legacyParams.length}`) }
      legacyParams.push(bId, id)
      const updatedLegacy = await db(
        `UPDATE package_bookings SET ${legacySets.join(', ')}
          WHERE id = ${legacyParams.length - 1} AND package_id = ${legacyParams.length}
          RETURNING *`,
        legacyParams,
      )
      const booking = normalizeLegacyPackageBooking({ ...previousLegacy.rows[0], ...updatedLegacy.rows[0] })
      try {
        const io = req.app.get('io')
        if (io) io.to('admin-room').emit('package:booking-updated', { booking, packageId: Number(id) })
      } catch (socketErr) { logger.warn('[Packages] legacy booking update socket failed:', socketErr.message) }
      return res.json({ success: true, data: booking })
    }

    const sets   = ['updated_at = NOW()']
    const params = []
    let pi = 1

    if (status)                     { sets.push(`status = $${pi++}`);         params.push(status) }
    if (admin_notes !== undefined)  { sets.push(`admin_notes = $${pi++}`);    params.push(admin_notes) }
    if (payment_status)             { sets.push(`payment_status = $${pi++}`); params.push(payment_status) }

    const previous = await db('SELECT * FROM bookings WHERE id = $1 AND package_id = $2 LIMIT 1', [bId, id])
    if (!previous.rows.length && requestedSource !== 'bookings') {
      const legacy = await db(
        `SELECT pb.*, u.email AS user_email, u.full_name AS user_name,
                u.avatar_url AS user_avatar_url
           FROM package_bookings pb
           LEFT JOIN users u ON u.id = pb.user_id
          WHERE pb.id = $1 AND pb.package_id = $2
          LIMIT 1`,
        [bId, id],
      )
      if (legacy.rows[0]) {
        const legacySets = ['updated_at = NOW()']
        const legacyParams = []
        if (status) { legacyParams.push(status); legacySets.push(`status = ${legacyParams.length}`) }
        if (admin_notes !== undefined) { legacyParams.push(admin_notes); legacySets.push(`admin_notes = ${legacyParams.length}`) }
        legacyParams.push(bId, id)
        const updatedLegacy = await db(
          `UPDATE package_bookings SET ${legacySets.join(', ')}
            WHERE id = ${legacyParams.length - 1} AND package_id = ${legacyParams.length}
            RETURNING *`,
          legacyParams,
        )
        const booking = normalizeLegacyPackageBooking({ ...legacy.rows[0], ...updatedLegacy.rows[0] })
        try {
          const io = req.app.get('io')
          if (io) io.to('admin-room').emit('package:booking-updated', { booking, packageId: Number(id) })
        } catch (socketErr) { logger.warn('[Packages] legacy booking update socket failed:', socketErr.message) }
        return res.json({ success: true, data: booking })
      }
    }
    if (!previous.rows.length) return res.status(404).json({ success: false, error: 'Package booking not found' })
    if (status === 'confirmed' && !previous.rows[0].email_verified) {
      return res.status(409).json({ success: false, error: 'Traveller must confirm this request from their email inbox before the package booking can be confirmed.' })
    }
    const result = await db(
      `UPDATE bookings SET ${sets.join(', ')} WHERE id = ${pi++} AND package_id = ${pi++} RETURNING *`,
      [...params, bId, id],
    )
    const booking = result.rows[0]
    if (status === 'confirmed' && previous.rows[0].status !== 'confirmed') {
      const [pkgResult, userResult] = await Promise.all([
        db('SELECT title FROM packages WHERE id = $1 LIMIT 1', [id]),
        booking.user_id ? db('SELECT id, full_name, email FROM users WHERE id = $1 LIMIT 1', [booking.user_id]).catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] }),
      ])
      const pkgTitle = pkgResult.rows[0]?.title || 'your package'
      const user = userResult.rows[0] || {}
      const email = user.email || booking.email || null
      const traveller = user.full_name || booking.full_name || 'traveller'
      if (sendBookingConfirmation) {
        asyncNoThrow(sendBookingConfirmation({ ...booking, package_name: pkgTitle, package_title: pkgTitle, booking_type: 'package' }), 'send package booking confirmation email')
      }
      if (booking.user_id || email) asyncNoThrow(createNotificationInternal({
        userId: booking.user_id || user.id || null, userEmail: email, type: 'package_request_confirmed', category: 'package',
        title: 'Good news, ' + String(traveller).split(' ')[0] + ' — your trip is confirmed!',
        message: 'Your request for "' + pkgTitle + '" has been confirmed by Altuvera. Open your booking for the dates, guest details, and next steps.',
        actionUrl: '/my-bookings?bookingId=' + encodeURIComponent(booking.id) + '&packageId=' + encodeURIComponent(id),
        actionLabel: 'View confirmed booking', priority: 'high', req,
        metadata: { bookingId: booking.id, packageId: Number(id), bookingNumber: booking.booking_number || null },
      }), 'package confirmation notification/email')
    }
    try { const io = req.app.get('io'); if (io) io.to('admin-room').emit('package:booking-updated', { booking, packageId: Number(id) }) } catch (socketErr) { logger.warn('[Packages] booking update socket failed:', socketErr.message) }
    return res.json({ success: true, data: booking })
  } catch (err) {
    logger.error('[Packages] booking update error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to update package booking' })
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   GET /api/packages/:id/bookings  (admin: list bookings for a package)
═══════════════════════════════════════════════════════════════════════════ */
router.get('/:id/bookings/:bId', requireAdmin, async (req, res) => {
  try {
    const { id: packageId, bId } = req.params
    const source = String(req.query.source || '').toLowerCase()
    let booking = null

    if (source !== 'package_bookings') {
      const current = await db(
        `SELECT b.*, u.email AS user_email, u.full_name AS user_name,
                u.avatar_url AS user_avatar_url
           FROM bookings b
           LEFT JOIN users u ON u.id = b.user_id
          WHERE b.id = $1 AND b.package_id = $2
          LIMIT 1`,
        [bId, packageId],
      )
      if (current.rows[0]) booking = { ...current.rows[0], source_table: 'bookings', booking_type: 'package' }
    }

    if (!booking && source !== 'bookings') {
      const legacy = await db(
        `SELECT pb.*, u.email AS user_email, u.full_name AS user_name,
                u.avatar_url AS user_avatar_url
           FROM package_bookings pb
           LEFT JOIN users u ON u.id = pb.user_id
          WHERE pb.id = $1 AND pb.package_id = $2
          LIMIT 1`,
        [bId, packageId],
      )
      if (legacy.rows[0]) booking = normalizeLegacyPackageBooking(legacy.rows[0])
    }

    if (!booking) return res.status(404).json({ success: false, error: 'Package booking not found' })
    return res.json({ success: true, data: booking })
  } catch (err) {
    logger.error('[Packages] fetch single booking error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to fetch package booking' })
  }
})

router.get('/:id/bookings', requireAdmin, async (req, res) => {
  try {
    const pkgId = req.params.id
    const { page = 1, limit = 10, status } = req.query
    const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100)
    const pg = Math.max(parseInt(page, 10) || 1, 1)
    const offset = (pg - 1) * lim
    const statusClause = status ? ' AND status = $2' : ''
    const filterParams = status ? [pkgId, status] : [pkgId]

    // Read both the current unified bookings table and the historical package
    // booking table. This preserves older requests without migrating/deleting
    // user records and gives the admin view one consistent row shape.
    const rowsSql = `
      WITH package_rows AS (
        SELECT
          b.id, COALESCE(b.booking_number, b.booking_ref)::text AS booking_number,
          b.package_id, COALESCE(b.package_title, p.title)::text AS package_title,
          b.package_price, b.user_id, b.full_name, b.email, b.phone,
          b.travel_date, b.return_date, b.number_of_travelers,
          b.number_of_adults, b.number_of_children, b.special_requests,
          b.dietary_requirements, b.pickup_location, b.status, b.priority,
          b.admin_notes, b.source,
          to_jsonb(b)->>'payment_status' AS payment_status,
          COALESCE((to_jsonb(b)->>'email_verified')::boolean, false) AS email_verified,
          b.created_at, b.updated_at,
          u.email AS user_email, COALESCE(u.full_name, b.full_name) AS user_name,
          u.avatar_url AS user_avatar_url,
          'bookings'::text AS source_table,
          'package'::text AS booking_type
        FROM bookings b
        LEFT JOIN users u ON u.id = b.user_id
        LEFT JOIN packages p ON p.id = b.package_id
        WHERE b.package_id = $1

        UNION ALL

        SELECT
          pb.id, pb.booking_ref::text AS booking_number,
          pb.package_id, COALESCE(pb.package_title, p.title)::text AS package_title,
          pb.package_price, pb.user_id, pb.guest_name AS full_name,
          pb.guest_email AS email, pb.guest_phone AS phone,
          pb.travel_date, pb.end_date AS return_date, pb.travelers_count AS number_of_travelers,
          pb.adults AS number_of_adults, pb.children AS number_of_children,
          pb.special_requests, pb.dietary_needs AS dietary_requirements,
          pb.pickup_location, pb.status, pb.priority, pb.admin_notes, pb.source,
          NULL::text AS payment_status, NULL::boolean AS email_verified,
          pb.created_at, pb.updated_at,
          u.email AS user_email, COALESCE(u.full_name, pb.guest_name) AS user_name,
          u.avatar_url AS user_avatar_url,
          'package_bookings'::text AS source_table,
          'package'::text AS booking_type
        FROM package_bookings pb
        LEFT JOIN users u ON u.id = pb.user_id
        LEFT JOIN packages p ON p.id = pb.package_id
        WHERE pb.package_id = $1
      )
    `

    const [countRes, dataRes] = await Promise.all([
      db(`${rowsSql} SELECT COUNT(*)::int AS total FROM package_rows WHERE TRUE${statusClause}`, filterParams),
      db(
        `${rowsSql}
         SELECT * FROM package_rows
          WHERE TRUE${statusClause}
          ORDER BY created_at DESC NULLS LAST, id DESC, source_table ASC
          LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
        [...filterParams, lim, offset],
      ),
    ])

    const total = Number(countRes.rows[0]?.total || 0)
    // Keep the stored package summary accurate even when the list is filtered
    // to a particular booking status.
    await db(
      `UPDATE packages p
          SET booking_count = (
            SELECT COUNT(*)::INTEGER FROM bookings b WHERE b.package_id = p.id
          ) + (
            SELECT COUNT(*)::INTEGER FROM package_bookings pb WHERE pb.package_id = p.id
          )
        WHERE p.id = $1`,
      [pkgId],
    ).catch((countErr) => logger.warn('[Packages] Package booking count sync skipped:', countErr.message))
    return res.json({
      success: true,
      data: dataRes.rows,
      pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) },
    })
  } catch (err) {
    logger.error('[Packages] fetch bookings error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to fetch package bookings' })
  }
})


/* Admin-created package information forms. */
const normalizeInfoRequest = (row) => ({
  ...row,
  fields: Array.isArray(row.fields) ? row.fields : (typeof row.fields === 'string' ? (() => { try { return JSON.parse(row.fields) } catch { return [] } })() : []),
  response: row.response && typeof row.response === 'object' ? row.response : (typeof row.response === 'string' ? (() => { try { return JSON.parse(row.response) } catch { return {} } })() : {}),
});

router.get('/my/info-requests', authenticate, async (req, res) => {
  try {
    const userId = Number.parseInt(req.user?.id, 10);
    const email = String(req.user?.email || '').trim().toLowerCase();
    const result = await db(
      `SELECT r.*, p.title AS package_title FROM admin_info_requests r
        LEFT JOIN packages p ON p.id = r.package_id
        WHERE r.user_id = $1 OR (r.user_id IS NULL AND LOWER(COALESCE(r.target_email,'')) = $2)
        ORDER BY r.created_at DESC, r.id DESC`,
      [userId, email],
    );
    return res.json({ success: true, data: result.rows.map(normalizeInfoRequest) });
  } catch (error) {
    logger.error('[Packages] Load traveller information requests failed:', error.message);
    return res.status(500).json({ success: false, error: 'Could not load your information requests.' });
  }
});

router.get('/:id/info-requests', requireAdmin, async (req, res) => {
  try {
    const packageId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(packageId) || packageId < 1) return res.status(400).json({ success: false, error: 'Invalid package ID.' });
    const pkg = await db('SELECT id FROM packages WHERE id = $1 LIMIT 1', [packageId]);
    if (!pkg.rows[0]) return res.status(404).json({ success: false, error: 'Package not found.' });
    const result = await db('SELECT * FROM admin_info_requests WHERE package_id = $1 ORDER BY created_at DESC, id DESC', [packageId]);
    return res.json({ success: true, data: result.rows.map(normalizeInfoRequest) });
  } catch (error) {
    logger.error('[Packages] Load information requests failed:', error.message);
    return res.status(500).json({ success: false, error: 'Could not load information requests.' });
  }
});

router.post('/:id/info-requests', requireAdmin, async (req, res) => {
  try {
    const packageId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(packageId) || packageId < 1) return res.status(400).json({ success: false, error: 'Invalid package ID.' });
    const pkgResult = await db('SELECT id, title FROM packages WHERE id = $1 LIMIT 1', [packageId]);
    const pkg = pkgResult.rows[0];
    if (!pkg) return res.status(404).json({ success: false, error: 'Package not found.' });
    const body = req.body || {};
    const title = String(body.title || '').trim().slice(0, 500);
    const description = String(body.description || '').trim();
    const fields = Array.isArray(body.fields) ? body.fields : [];
    const targetEmail = String(body.target_email || '').trim().toLowerCase();
    const requestedUserId = body.user_id ? Number.parseInt(body.user_id, 10) : null;
    if (!title) return res.status(400).json({ success: false, error: 'Form title is required.' });
    if (!fields.length || fields.length > 40) return res.status(400).json({ success: false, error: 'Add between 1 and 40 form fields.' });
    if (!targetEmail && !requestedUserId) return res.status(400).json({ success: false, error: 'Select a traveller with an email address or account.' });
    if (targetEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) return res.status(400).json({ success: false, error: 'Enter a valid traveller email address.' });

    let recipient = null;
    if (requestedUserId) {
      const found = await db('SELECT id, email, full_name FROM users WHERE id = $1 LIMIT 1', [requestedUserId]);
      recipient = found.rows[0] || null;
    }
    if (!recipient && targetEmail) {
      const found = await db('SELECT id, email, full_name FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [targetEmail]);
      recipient = found.rows[0] || null;
    }
    if (!recipient) return res.status(404).json({ success: false, error: 'No traveller account matches this email or user ID. Information forms can only be sent to registered travellers.' });
    const userId = recipient.id;
    const email = recipient.email || targetEmail;
    const name = String(body.target_name || recipient.full_name || '').trim().slice(0, 255);
    if (!email) return res.status(400).json({ success: false, error: 'The selected traveller account has no email address.' });

    const allowedTypes = new Set(['text','email','tel','number','textarea','select','radio','checkbox','date','file']);
    const safeFields = fields.map((field, index) => ({
      id: String(field?.id || 'field-' + (index + 1)).slice(0, 100),
      label: String(field?.label || '').trim().slice(0, 180),
      type: allowedTypes.has(String(field?.type || 'text').toLowerCase()) ? String(field.type || 'text').toLowerCase() : 'text',
      placeholder: String(field?.placeholder || '').slice(0, 300),
      required: Boolean(field?.required),
      options: Array.isArray(field?.options) ? field.options.map(option => String(option).slice(0, 120)).slice(0, 50) : [],
    })).filter(field => field.label);
    if (!safeFields.length) return res.status(400).json({ success: false, error: 'Every form field needs a label.' });

    const expiresHours = Math.min(Math.max(Number.parseInt(body.expires_hours, 10) || 72, 1), 720);
    const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);
    const inserted = await db(
      `INSERT INTO admin_info_requests
        (package_id, user_id, target_email, target_name, title, description, fields,
         theme, accent_color, header_image, custom_css, status, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,'pending',$12,$13)
       RETURNING *`,
      [packageId, userId, email, name, title, description, JSON.stringify(safeFields),
       String(body.theme || 'default').slice(0, 50), String(body.accent_color || '#047857').slice(0, 20),
       String(body.header_image || '').slice(0, 1000), String(body.custom_css || '').slice(0, 12000),
       expiresAt, req.user?.id || null],
    );
    const request = normalizeInfoRequest(inserted.rows[0]);
    await createNotificationInternal({
      userId, userEmail: email, senderType: 'admin', senderId: req.user?.id || null,
      senderName: req.user?.full_name || req.user?.name || 'Altuvera',
      type: 'package_info_request', category: 'package',
      title: 'Additional information requested',
      message: 'Altuvera needs a few more details for your request for ' + pkg.title + '. Open your package requests to complete the form.',
      actionUrl: '/my-bookings?packageId=' + encodeURIComponent(packageId) + '&infoRequestId=' + encodeURIComponent(request.id),
      actionLabel: 'Complete information form', priority: 'high',
      metadata: { packageId, packageTitle: pkg.title, infoRequestId: request.id },
      expiresAt, req,
    }).catch((notificationError) => logger.warn('[Packages] Information request notification failed:', notificationError.message));
    return res.status(201).json({ success: true, message: 'Information request created and traveller notified.', data: request });
  } catch (error) {
    logger.error('[Packages] Create information request failed:', error.message, error.stack);
    return res.status(500).json({ success: false, error: 'Could not send the information request.' });
  }
});

router.post('/:id/info-requests/:rId/respond', authenticate, async (req, res) => {
  try {
    const packageId = Number.parseInt(req.params.id, 10);
    const requestId = Number.parseInt(req.params.rId, 10);
    const userId = Number.parseInt(req.user?.id, 10);
    const email = String(req.user?.email || '').trim().toLowerCase();
    const found = await db(
      `SELECT * FROM admin_info_requests WHERE id = $1 AND package_id = $2
        AND (user_id = $3 OR (user_id IS NULL AND LOWER(COALESCE(target_email,'')) = $4)) LIMIT 1`,
      [requestId, packageId, userId, email],
    );
    const request = found.rows[0];
    if (!request) return res.status(404).json({ success: false, error: 'Information request not found.' });
    if (request.status !== 'pending') return res.status(409).json({ success: false, error: 'This information request is no longer accepting responses.' });
    if (request.expires_at && new Date(request.expires_at) < new Date()) {
      await db("UPDATE admin_info_requests SET status = 'expired', updated_at = NOW() WHERE id = $1", [requestId]);
      return res.status(410).json({ success: false, error: 'This information request has expired.' });
    }
    const answers = req.body?.response && typeof req.body.response === 'object' ? req.body.response : {};
    const fields = normalizeInfoRequest(request).fields;
    const errors = fields.filter(field => field.required).filter(field => {
      const value = answers[field.id];
      if (field.type === 'checkbox' && !(field.options || []).length) return value !== true;
      return value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
    }).map(field => field.label + ' is required.');
    if (errors.length) return res.status(400).json({ success: false, errors, message: errors.join(' ') });
    const updated = await db(
      `UPDATE admin_info_requests SET response = $1::jsonb, status = 'responded',
        responded_at = NOW(), responded_by = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [JSON.stringify(answers), userId, requestId],
    );
    return res.json({ success: true, message: 'Your information has been submitted.', data: normalizeInfoRequest(updated.rows[0]) });
  } catch (error) {
    logger.error('[Packages] Submit information request response failed:', error.message);
    return res.status(500).json({ success: false, error: 'Could not submit your information.' });
  }
});

module.exports = router