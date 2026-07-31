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

// ── Validation ────────────────────────────────────────────────────────────────
const validateBooking = (body) => {
  const errors = []

  if (!body.guest_name && !body.full_name && !body.name) {
    errors.push('Full name is required (min 2 characters)')
  }
  const nameStr = String(body.guest_name || body.full_name || body.name || '').trim()
  if (nameStr.length < 2) {
    errors.push('Full name must be at least 2 characters')
  }

  if (!body.guest_email && !body.email) {
    errors.push('Email is required')
  }
  const emailStr = String(body.guest_email || body.email || '').trim().toLowerCase()
  if (emailStr.length < 5) {
    errors.push('A valid email is required')
  }

  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (emailStr && !emailRx.test(emailStr)) {
    errors.push('Please enter a valid email address')
  }

  const adults = parseInt(body.number_of_adults || body.adults || 1)
  if (isNaN(adults) || adults < 1) {
    errors.push('number_of_adults must be at least 1')
  }

  const travelDate = body.travel_date || body.startDate || null
  if (travelDate) {
    const d = new Date(travelDate)
    if (isNaN(d.getTime())) {
      errors.push('Travel date must be a valid date')
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
    // Frontend sends: email, full_name, phone, destinationId, countryId,
    //   startDate, endDate, adults, children, groupType, specialRequests,
    //   preferredContactMethod, newsletterOptIn, agreeToTerms, flexibleDates, flexibleMonths
    // Backend columns: guest_email, guest_name, guest_phone, destination_id, etc.
    const guestName      = String(body.guest_name || body.full_name || body.name || '').trim()
    const guestEmail     = String(body.guest_email || body.email || '').trim().toLowerCase()
    const guestPhone     = String(body.guest_phone || body.phone || '').trim() || null
    const adults         = Math.max(1, parseInt(body.number_of_adults || body.adults || 1))
    const children       = Math.max(0, parseInt(body.number_of_children || body.children || 0))
    const numberOfTravelers = adults + children
    const travelDate     = body.travel_date || body.startDate || null
    const endDate        = body.end_date || body.endDate || null
    const specialReqs    = body.special_requests || body.specialRequests ? String(body.special_requests || body.specialRequests).trim() : null
    const destinationId  = body.destinationId ? parseInt(body.destinationId) : null
    const userId         = req.user?.id || null // Note: user_id column not in bookings table, but we keep for reference if needed elsewhere

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
        booking_number, destination_id, service_id, full_name, email, phone, whatsapp, nationality,
        travel_date, return_date, number_of_travelers, accommodation_type, special_requests, status, admin_notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15
      ) RETURNING *`,
      [
        bookingNumber,
        destinationId,
        null, // service_id
        guestName,
        guestEmail,
        guestPhone,
        null, // whatsapp
        null, // nationality
        travelDate || null,
        endDate || null,
        numberOfTravelers,
        null, // accommodation_type
        specialReqs,
        'pending',
        null // admin_notes
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
      error: err.message,
      detail: err.detail || undefined,
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