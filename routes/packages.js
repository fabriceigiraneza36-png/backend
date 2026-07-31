// routes/packages.js
const express  = require('express')
const router   = express.Router()
const { query: db } = require('../config/db')
const { authenticate, optionalAuth, requireAdmin } = require('../middleware/auth')
const logger   = require('../utils/logger')

// ── helpers ──────────────────────────────────────────────────────────────────
const slugify = (str) =>
  str.toLowerCase().trim()
     .replace(/[^\w\s-]/g, '')
     .replace(/\s+/g, '-')
     .replace(/-+/g, '-')

const genBookingRef = (id) =>
  `PKG-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(id).padStart(5,'0')}`

const parseJsonField = (val, fallback = []) => {
  if (!val) return fallback
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return fallback }
  }
  return val
}

// ── GET /api/packages ────────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10, sort = 'featured', destination } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const where = []
    const vals = []

    if (destination) {
      where.push(`destination_id = $${++vals.length}`)
      vals.push(destination)
    }

    const [countRes, dataRes] = await Promise.all([
      db(
        `SELECT COUNT(*) FROM packages p ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
        [...vals]
      ),
      db(
        `SELECT p.*,
           d.name AS destination_name,
                  d.slug   AS destination_slug
         FROM packages p
         LEFT JOIN destinations d ON d.id = p.destination_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY 
           CASE WHEN $3 = 'featured' THEN p.is_featured DESC END,
           CASE WHEN $3 = 'price_asc' THEN (p.price || 0) ASC END,
           CASE WHEN $3 = 'price_desc' THEN (p.price || 0) DESC END,
           CASE WHEN $3 = 'latest' THEN p.created_at DESC END
         LIMIT $${++vals.length} OFFSET $${++vals.length}`,
        [...resp, limit, offset]
      ),
    ])

    return res.json({
      success: true,
      data: dataRes.rows,
      pagination: {
        total: parseInt(countRes.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(parseInt(countRes.rows[0].count) / parseInt(limit)),
      },
    })
  } catch (err) {
    logger.error('[Packages] fetch error:', err.message)
    return res.status(500).json({ error: 'Failed to fetch packages' })
  }
})

// ── GET /api/packages/:id ────────────────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const pkg = await db(
      `SELECT p.*,
              d.name AS destination_name,
              d.slug   AS destination_slug
       FROM packages p
       LEFT JOIN destinations d ON d.id = p.destination_id
       WHERE p.id = $1`,
      [req.params.id]
    )

    if (!pkg.rows.length) return res.status(404).json({ error: 'Package not found' })
    return res.json({ success: true, data: pkg.rows[0] })
  } catch (err) {
    logger.error('[Packages] fetch error:', err.message)
    return res.status(500).json({ error: 'Failed to fetch package' })
  }
})

// ── GET /api/packages/:id/availability ───────────────────────────────────────
router.get('/:id/availability', optionalAuth, async (req, res) => {
  try {
    const pkgId = req.params.id
    const { startDate, endDate } = req.query

    const [pkg, bookings] = await Promise.all([
      db('SELECT * FROM packages WHERE id = $1', [pkgId]),
      db(
        `SELECT * FROM package_bookings 
         WHERE package_id = $1 
           AND status NOT IN ('cancelled', 'completed')
           AND (
             (start_date BETWEEN $2 AND $3) OR
             (end_date BETWEEN $2 AND $3) OR
             ($2 BETWEEN start_date AND end_date)
           )`,
        [pkgId, startDate || '1900-01-01', endDate || '9999-12-31']
      ),
    ])

    if (!pkg.rows.length) return res.status(404).json({ error: 'Package not found' })

    const bookedDates = []
    for (const b of bookings.rows) {
      let current = new Date(b.start_date)
      const end = new Date(b.end_date)
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
        package_id: pkgId,
        booked_dates: [...new Set(bookedDates)],
        available_dates: [], // TODO: implement
      },
    })
  } catch (err) {
    logger.error('[Packages] availability error:', err.message)
    return res.status(500).json({ error: 'Failed to check availability' })
  }
})

// ── POST /api/packages/:id/book  (user or guest books a package) ─────────────
router.post('/:id/book', optionalAuth, async (req, res) => {
  try {
    const pkgId = req.params.id
    const {
      guest_name, guest_email, guest_phone,
      travelers_count = 1, adults = 1, children = 0,
      travel_date, end_date, special_requests,
      dietary_needs, pickup_location, total_price, deposit_paid,
      currency, source, agreeToTerms, newsletterOptIn,
      preferredContactMethod, flexibleDates, flexibleMonths,
    } = req.body

    const pkg = await db(`SELECT id, title, price, currency FROM packages WHERE id = $1 AND is_published = true`, [pkgId])
    if (!pkg.rows.length) return res.status(404).json({ error: 'Package not found' })
    const p = pkg.rows[0]

    // Validate
    const errors = []
    if (!guest_name?.trim()) errors.push('Name is required')
    if (!guest_email?.trim()) errors.push('Email is required')
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (guest_email && !emailRegex.test(guest_email.trim())) errors.push('Invalid email format')
    if (errors.length) return res.status(400).json({ success: false, message: 'Validation failed', errors })

    const adultsNum = Math.max(1, parseInt(adults))
    const childrenNum = Math.max(0, parseInt(children))
    const travelersCountNum = parseInt(travelers_count) || (adultsNum + childrenNum)

    // Generate booking reference
    let bookingNumber = generateBookingRef(0)
    let attempts = 0
    while (attempts < 5) {
      try {
        const existing = await db('SELECT id FROM bookings WHERE booking_number = $1', [bookingNumber])
        if (!existing.rows.length) break
        bookingNumber = generateBookingRef(0)
        attempts++
      } catch { break }
    }

    // Insert booking
    const result = await db(`
      INSERT INTO bookings (
        booking_number, destination_id, service_id, full_name, email, phone, whatsapp, nationality,
        travel_date, return_date, number_of_travelers, accommodation_type, special_requests, status, admin_notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15
      ) RETURNING *
    `, [
      bookingNumber,
      null, // destination_id (package booking)
      null, // service_id
      guest_name.trim(),
      guest_email.trim(),
      guest_phone || null,
      null, // whatsapp
      null, // nationality
      travel_date || null,
      end_date || null,
      travelersCountNum,
      null, // accommodation_type
      (special_requests || '').trim() || null,
      'pending',
      null // admin_notes
    ])

    const booking = result.rows[0]
    logger.info(`[Packages] Booking created: ${bookingNumber}`)

    // Update package booking count (if column exists)
    await db(`UPDATE packages SET booking_count = COALESCE(booking_count, 0) + 1 WHERE id = $1`, [p.id]).catch(() => {})

    // Notify admins via socket
    const io = req.app.get('io')
    if (io) io.emit('package:new-booking', { booking, packageId: p.id })

    return res.status(201).json({
      success: true,
      message: 'Package booking request submitted successfully',
      data: {
        ...booking,
        booking_ref: bookingNumber,
        booking_number: bookingNumber,
        package_title: p.title,
        package_price: p.price,
        package_currency: p.currency,
      },
    })
  } catch (err) {
    logger.error('[Packages] booking error:', err.message)
    return res.status(500).json({ error: 'Failed to create package booking' })
  }
})

// PATCH /api/packages/:id/bookings/:bId  (admin update booking)
router.patch('/:id/bookings/:bId', requireAdmin, async (req, res) => {
  try {
    const { bId } = req.params
    const { status, admin_notes, priority, payment_status, total_price } = req.body
    const sets = [`updated_at = NOW()`]
    const params = []
    let pi = 1

    if (status)         { sets.push(`status = $${pi++}`);         params.push(status) }
    if (admin_notes !== undefined) { sets.push(`admin_notes = $${pi++}`); params.push(admin_notes) }
    if (priority)       { sets.push(`priority = $${pi++}`);       params.push(priority) }
    if (payment_status) { sets.push(`payment_status = $${pi++}`); params.push(payment_status) }
    if (typeof total_price !== 'undefined') { sets.push(`total_price = $${pi++}`); params.push(parseFloat(total_price)) }

    const result = await db(
      `UPDATE package_bookings
       SET ${sets.join(', ')}
       WHERE id = $${pi++}
       RETURNING *`,
      [...params, bId]
    )

    if (!result.rows.length) return res.status(404).json({ error: 'Package booking not found' })
    return res.json({ success: true, data: result.rows[0] })
  } catch (err) {
    logger.error('[Packages] booking update error:', err.message)
    return res.status(500).json({ error: 'Failed to update package booking' })
  }
})

// GET /api/packages/:id/bookings  (admin: list bookings for a package)
router.get('/:id/bookings', requireAdmin, async (req, res) => {
  try {
    const pkgId = req.params.id
    const { page = 1, limit = 10, status } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const where = []
    const vals = [pkgId]

    if (status) {
      where.push(`status = $${++vals.length}`)
      vals.push(status)
    }

    const [countRes, dataRes] = await Promise.all([
      db(
        `SELECT COUNT(*) FROM package_bookings WHERE package_id = $1 ${where.length ? `AND ${where.join(' AND ')}` : ''}`,
        [...vals]
      ),
      db(
        `SELECT pb.*,
                 u.email   AS user_email,
                 u.full_name AS user_name
         FROM package_bookings pb
         LEFT JOIN users u ON u.id = pb.user_id
         WHERE pb.package_id = $1 ${where.length ? `AND ${where.join(' AND ')}` : ''}
         ORDER BY pb.created_at DESC
         LIMIT $${++vals.length} OFFSET $${++vals.length}`,
        [...pkgId, ...(status ? [status] : []), limit, offset]
      ),
    ])

    return res.json({
      success: true,
      data: dataRes.rows,
      pagination: {
        total: parseInt(countRes.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(parseInt(countRes.rows[0].count) / parseInt(limit)),
      },
    })
  } catch (err) {
    logger.error('[Packages] fetch bookings error:', err.message)
    return res.status(500).json({ error: 'Failed to fetch package bookings' })
  }
})

module.exports = router