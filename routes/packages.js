// routes/packages.js
const express  = require('express')
const router   = express.Router()
const { query: db } = require('../config/db')
const { authenticate, optionalAuth, requireAdmin } = require('../middleware/auth')
const logger   = require('../utils/logger')

/* ═══════════════════════════════════════════════════════════════════════════
   SAFE REQUIRE: EMAIL SERVICE (for booking notifications)
═══════════════════════════════════════════════════════════════════════════ */
let sendBookingReceivedEmail = null
let sendAdminBookingNotification = null

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

const packagePayload = (body = {}, existing = {}) => ({
  title: String(body.title || existing.title || 'Travel package').trim().slice(0, 255),
  slug: existing.slug || `${slugify(body.title || 'travel-package')}-${Date.now()}`,
  cover_image_url: packageImage(body) || existing.cover_image_url || '',
  is_published: body.is_published === undefined
    ? (existing.is_published ?? false) : Boolean(body.is_published),
  is_featured: body.is_featured === undefined
    ? (existing.is_featured ?? false) : Boolean(body.is_featured),
})

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
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS is_featured   BOOLEAN DEFAULT false`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS is_published  BOOLEAN DEFAULT true`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS destination_id INTEGER`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS booking_count INTEGER DEFAULT 0`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS view_count    INTEGER DEFAULT 0`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS currency      VARCHAR(10) DEFAULT 'USD'`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS price         NUMERIC(12,2)`,
      `ALTER TABLE packages ADD COLUMN IF NOT EXISTS cover_image_url TEXT`,
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
router.get('/', optionalAuth, async (req, res) => {
  try {
    await ensurePackagesSchema()

    const { page = 1, limit = 10, sort = 'featured', destination } = req.query
    const parsedLimit  = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100)
    const parsedPage   = Math.max(parseInt(page, 10) || 1, 1)
    const parsedOffset = (parsedPage - 1) * parsedLimit

    const where = []
    const vals  = []

    if (destination) {
      vals.push(destination)
      where.push(_hasDestinationId
        ? `p.destination_id = $${vals.length}`
        : `p.destination = $${vals.length}`)
    }

    let orderBy = 'p.is_featured DESC NULLS LAST, p.created_at DESC'
    if (sort === 'price_asc')  orderBy = 'COALESCE(p.price, 0) ASC,  p.id ASC'
    if (sort === 'price_desc') orderBy = 'COALESCE(p.price, 0) DESC, p.id DESC'
    if (sort === 'latest')     orderBy = 'p.created_at DESC'
    if (sort === 'popular')    orderBy = 'COALESCE(p.booking_count,0) DESC, COALESCE(p.view_count,0) DESC'

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

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
      ? 'd.name AS destination_name, d.slug AS destination_slug'
      : 'p.destination AS destination_name, NULL AS destination_slug'
    const destinationJoin = _hasDestinationId
      ? 'LEFT JOIN destinations d ON d.id = p.destination_id'
      : ''

    const dataRes   = await db(
      `SELECT p.*,
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
             COALESCE(SUM(booking_count), 0)::INTEGER AS bookings
      FROM packages
    `)
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
    const result = await db(
      `INSERT INTO packages (title, slug, cover_image_url, is_published, is_featured)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [payload.title, payload.slug, payload.cover_image_url, payload.is_published, payload.is_featured],
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
    if (!payload.cover_image_url) {
      return res.status(400).json({ success: false, error: 'A package poster image is required' })
    }
    const result = await db(
      `UPDATE packages
       SET cover_image_url = $1, is_published = $2, is_featured = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [payload.cover_image_url, payload.is_published, payload.is_featured, req.params.id],
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
    const result = await db('DELETE FROM packages WHERE id = $1 RETURNING id', [req.params.id])
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Package not found' })
    return res.json({ success: true, data: { id: result.rows[0].id } })
  } catch (err) {
    logger.error('[Packages] delete error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to delete package' })
  }
})

router.post('/:id/:action(publish|unpublish)', requireAdmin, async (req, res) => {
  try {
    const isPublished = req.params.action === 'publish'
    const result = await db(
      'UPDATE packages SET is_published = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [isPublished, req.params.id],
    )
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Package not found' })
    return res.json({ success: true, data: result.rows[0] })
  } catch (err) {
    logger.error('[Packages] publish error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to update package status' })
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   GET /api/packages/:id
═══════════════════════════════════════════════════════════════════════════ */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const pkg = await db(
      `SELECT p.*,
              d.name AS destination_name,
              d.slug AS destination_slug
       FROM packages p
       LEFT JOIN destinations d ON d.id = p.destination_id
       WHERE p.id = $1`,
      [req.params.id],
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
router.post('/:id/book', optionalAuth, async (req, res) => {
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
    } = req.body

    // Load package
    const pkg = await db(
      `SELECT id, title, price, currency, destination_id, is_published
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

    // Normalize input
    const finalName    = String(guest_name || full_name || name || '').trim()
    const finalEmail   = String(guest_email || email || '').trim().toLowerCase()
    const finalPhone   = String(guest_phone || phone || '').trim() || null
    const finalTravel  = travel_date || startDate || null
    const finalEnd     = end_date  || endDate  || null
    const finalReqs    = (special_requests || specialRequests || '').toString().trim() || null

    // Validate
    const errors = []
    if (finalName.length < 2)  errors.push('Name is required (min 2 characters)')
    if (!finalEmail)           errors.push('Email is required')
    if (finalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalEmail)) {
      errors.push('Invalid email format')
    }
    if (errors.length) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors })
    }

    const adultsNum   = Math.max(1, parseInt(adults, 10)   || 1)
    const childrenNum = Math.max(0, parseInt(children, 10) || 0)
    const travelersNum = parseInt(travelers_count, 10) || (adultsNum + childrenNum)

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

    // Insert booking
    const result = await db(
      `INSERT INTO bookings (
         booking_number, destination_id, package_id, full_name, email, phone,
         travel_date, return_date, number_of_travelers,
         number_of_adults, number_of_children,
         special_requests, status, booking_type, source, user_id
       )
       VALUES ($1, $2, $3, $4, $5, $6,
               $7, $8, $9,
               $10, $11,
               $12, 'pending', 'package', 'website', $13)
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
      ],
    )

    const booking = result.rows[0]
    logger.info(`[Packages] ✅ Booking created: ${bookingNumber}`)

    // Increment package booking count (graceful if column missing)
    db(
      'UPDATE packages SET booking_count = COALESCE(booking_count, 0) + 1 WHERE id = $1',
      [p.id],
    ).catch(() => {})

    // Fire booking emails
    const enrichedBooking = {
      ...booking,
      package_title:    p.title,
      package_name:     p.title,
      package_price:    p.price,
      package_currency: p.currency,
      booking_type:     'package',
    }

    if (sendBookingReceivedEmail) {
      asyncNoThrow(sendBookingReceivedEmail(enrichedBooking), 'sendBookingReceivedEmail')
    }
    if (sendAdminBookingNotification) {
      asyncNoThrow(sendAdminBookingNotification(enrichedBooking), 'sendAdminBookingNotification')
    }

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
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    })
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   PATCH /api/packages/:id/bookings/:bId  (admin update)
═══════════════════════════════════════════════════════════════════════════ */
router.patch('/:id/bookings/:bId', requireAdmin, async (req, res) => {
  try {
    const { id, bId } = req.params
    const { status, admin_notes, payment_status } = req.body

    const sets   = ['updated_at = NOW()']
    const params = []
    let pi = 1

    if (status)                     { sets.push(`status = $${pi++}`);         params.push(status) }
    if (admin_notes !== undefined)  { sets.push(`admin_notes = $${pi++}`);    params.push(admin_notes) }
    if (payment_status)             { sets.push(`payment_status = $${pi++}`); params.push(payment_status) }

    const result = await db(
      `UPDATE bookings
       SET ${sets.join(', ')}
       WHERE id = $${pi++} AND package_id = $${pi++}
       RETURNING *`,
      [...params, bId, id],
    )

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: 'Package booking not found' })
    }
    return res.json({ success: true, data: result.rows[0] })
  } catch (err) {
    logger.error('[Packages] booking update error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to update package booking' })
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   GET /api/packages/:id/bookings  (admin: list bookings for a package)
═══════════════════════════════════════════════════════════════════════════ */
router.get('/:id/bookings', requireAdmin, async (req, res) => {
  try {
    const pkgId  = req.params.id
    const { page = 1, limit = 10, status } = req.query
    const lim    = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100)
    const pg     = Math.max(parseInt(page, 10) || 1, 1)
    const offset = (pg - 1) * lim

    const where = ['b.package_id = $1']
    const vals  = [pkgId]

    if (status) {
      vals.push(status)
      where.push(`b.status = $${vals.length}`)
    }

    const whereSql = where.join(' AND ')

    const [countRes, dataRes] = await Promise.all([
      db(`SELECT COUNT(*) FROM bookings b WHERE ${whereSql}`, vals),
      db(
        `SELECT b.*,
                u.email     AS user_email,
                u.full_name AS user_name
         FROM bookings b
         LEFT JOIN users u ON u.id = b.user_id
         WHERE ${whereSql}
         ORDER BY b.created_at DESC
         LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
        [...vals, lim, offset],
      ),
    ])

    return res.json({
      success: true,
      data: dataRes.rows,
      pagination: {
        total: parseInt(countRes.rows[0].count, 10),
        page:  pg,
        limit: lim,
        pages: Math.ceil(parseInt(countRes.rows[0].count, 10) / lim),
      },
    })
  } catch (err) {
    logger.error('[Packages] fetch bookings error:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to fetch package bookings' })
  }
})

module.exports = router