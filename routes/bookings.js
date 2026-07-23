// routes/bookings.js
const express = require('express')
const router = express.Router()
const { query: db } = require('../config/db')
const { optionalAuth } = require('../middleware/auth')
const logger = require('../utils/logger')

// ── helpers ──────────────────────────────────────────────────────────────────
const generateBookingRef = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let ref = 'BK'
  for (let i = 0; i < 8; i++) {
    ref += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return ref
}

const safeParse = (val, fallback = null) => {
  if (!val) return fallback
  if (typeof val === 'object') return val
  try { return JSON.parse(val) } catch { return fallback }
}

// ── Ensure table exists ───────────────────────────────────────────────────────
const ensureBookingsTable = async () => {
  try {
    await db(`
      CREATE TABLE IF NOT EXISTS bookings (
        id                SERIAL PRIMARY KEY,
        booking_number    VARCHAR(20) UNIQUE NOT NULL,
        booking_type      VARCHAR(50) DEFAULT 'package',
        
        -- Package reference
        package_id        INTEGER REFERENCES packages(id) ON DELETE SET NULL,
        package_title     TEXT,
        package_price     NUMERIC(12,2),
        currency          VARCHAR(10) DEFAULT 'USD',
        
        -- Guest info
        guest_name        TEXT NOT NULL,
        guest_email       TEXT NOT NULL,
        guest_phone       TEXT,
        
        -- Travel details
        travel_date       DATE,
        end_date          DATE,
        number_of_adults  INTEGER DEFAULT 1,
        number_of_children INTEGER DEFAULT 0,
        travelers_count   INTEGER DEFAULT 1,
        
        -- Pricing
        total_price       NUMERIC(12,2),
        
        -- Extra
        special_requests  TEXT,
        status            VARCHAR(30) DEFAULT 'pending',
        notes             TEXT,
        
        -- User link (optional)
        user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    logger.info('Bookings table ready')
  } catch (err) {
    logger.error('Failed to ensure bookings table:', err.message)
  }
}

ensureBookingsTable()

// ── Validation ────────────────────────────────────────────────────────────────
const validateBooking = (body) => {
  const errors = []

  if (!body.guest_name || String(body.guest_name).trim().length < 2) {
    errors.push('guest_name is required (min 2 chars)')
  }

  if (!body.guest_email || String(body.guest_email).trim().length < 5) {
    errors.push('guest_email is required')
  }

  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (body.guest_email && !emailRx.test(String(body.guest_email).trim())) {
    errors.push('guest_email must be a valid email address')
  }

  const adults = parseInt(body.number_of_adults || body.adults || 1)
  if (isNaN(adults) || adults < 1) {
    errors.push('number_of_adults must be at least 1')
  }

  if (body.travel_date) {
    const d = new Date(body.travel_date)
    if (isNaN(d.getTime())) {
      errors.push('travel_date must be a valid date')
    }
  }

  return errors
}

// ── POST /api/bookings ────────────────────────────────────────────────────────
router.post('/', optionalAuth, async (req, res) => {
  try {
    const body = req.body || {}
    logger.info('Booking request received:', JSON.stringify(body))

    // Validate
    const errors = validateBooking(body)
    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      })
    }

    // Normalize fields — accept both naming conventions from frontend
    const guestName    = String(body.guest_name).trim()
    const guestEmail   = String(body.guest_email).trim().toLowerCase()
    const guestPhone   = String(body.guest_phone || '').trim() || null
    const adults       = Math.max(1, parseInt(body.number_of_adults || body.adults || 1))
    const children     = Math.max(0, parseInt(body.number_of_children || body.children || 0))
    const travelersCount = parseInt(body.travelers_count || (adults + children)) || adults
    const packageId    = body.package_id ? parseInt(body.package_id) : null
    const packageTitle = body.package_title ? String(body.package_title).trim() : null
    const packagePrice = body.package_price ? parseFloat(body.package_price) : null
    const currency     = String(body.currency || 'USD').trim().toUpperCase()
    const totalPrice   = body.total_price ? parseFloat(body.total_price) : null
    const travelDate   = body.travel_date || null
    const endDate      = body.end_date || null
    const specialReqs  = body.special_requests ? String(body.special_requests).trim() : null
    const bookingType  = String(body.booking_type || 'package').trim()
    const userId       = req.user?.id || null

    // Generate unique booking number
    let bookingNumber = generateBookingRef()
    let attempts = 0
    while (attempts < 5) {
      try {
        const existing = await db(
          'SELECT id FROM bookings WHERE booking_number = $1',
          [bookingNumber]
        )
        if (!existing.rows.length) break
        bookingNumber = generateBookingRef()
        attempts++
      } catch { break }
    }

    // Insert
    const result = await db(
      `INSERT INTO bookings (
        booking_number, booking_type,
        package_id, package_title, package_price, currency,
        guest_name, guest_email, guest_phone,
        travel_date, end_date,
        number_of_adults, number_of_children, travelers_count,
        total_price, special_requests, status, user_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17, $18
      ) RETURNING *`,
      [
        bookingNumber, bookingType,
        packageId, packageTitle, packagePrice, currency,
        guestName, guestEmail, guestPhone,
        travelDate, endDate,
        adults, children, travelersCount,
        totalPrice, specialReqs, 'pending', userId,
      ]
    )

    const booking = result.rows[0]
    logger.info(`Booking created: ${bookingNumber}`)

    return res.status(201).json({
      success: true,
      message: 'Booking request submitted successfully',
      data: {
        ...booking,
        booking_ref:    bookingNumber,
        booking_number: bookingNumber,
      },
    })
  } catch (err) {
    logger.error('Booking creation error:', err)
    return res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    })
  }
})

// ── GET /api/bookings (admin) ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || 1))
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || 20)))
    const offset = (page - 1) * limit
    const status = req.query.status || null
    const search = req.query.search || null

    let whereClause = 'WHERE 1=1'
    const params = []
    let paramIdx = 1

    if (status) {
      whereClause += ` AND b.status = $${paramIdx++}`
      params.push(status)
    }

    if (search) {
      whereClause += ` AND (
        b.guest_name ILIKE $${paramIdx} OR
        b.guest_email ILIKE $${paramIdx} OR
        b.booking_number ILIKE $${paramIdx} OR
        b.package_title ILIKE $${paramIdx}
      )`
      params.push(`%${search}%`)
      paramIdx++
    }

    const [countRes, dataRes] = await Promise.all([
      db(`SELECT COUNT(*) FROM bookings b ${whereClause}`, params),
      db(
        `SELECT b.*,
          p.title AS pkg_title_ref,
          p.cover_image_url AS pkg_image
        FROM bookings b
        LEFT JOIN packages p ON p.id = b.package_id
        ${whereClause}
        ORDER BY b.created_at DESC
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      ),
    ])

    return res.json({
      success: true,
      data: dataRes.rows,
      pagination: {
        total: parseInt(countRes.rows[0].count),
        page,
        limit,
        pages: Math.ceil(parseInt(countRes.rows[0].count) / limit),
      },
    })
  } catch (err) {
    logger.error('Get bookings error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// ── GET /api/bookings/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const byRef = isNaN(parseInt(id))

    const result = await db(
      byRef
        ? 'SELECT * FROM bookings WHERE booking_number = $1'
        : 'SELECT * FROM bookings WHERE id = $1',
      [id]
    )

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found' })
    }

    return res.json({ success: true, data: result.rows[0] })
  } catch (err) {
    logger.error('Get booking error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// ── PATCH /api/bookings/:id/status ───────────────────────────────────────────
router.patch('/:id/status', async (req, res) => {
  try {
    const { id }     = req.params
    const { status } = req.body

    const allowed = ['pending', 'confirmed', 'cancelled', 'completed', 'waitlisted']
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${allowed.join(', ')}`,
      })
    }

    const result = await db(
      `UPDATE bookings
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, id]
    )

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found' })
    }

    return res.json({ success: true, data: result.rows[0] })
  } catch (err) {
    logger.error('Update booking status error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// ── DELETE /api/bookings/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const result = await db(
      'DELETE FROM bookings WHERE id = $1 RETURNING id',
      [req.params.id]
    )
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found' })
    }
    return res.json({ success: true, message: 'Booking deleted' })
  } catch (err) {
    logger.error('Delete booking error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router