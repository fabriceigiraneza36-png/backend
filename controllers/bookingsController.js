/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA TRAVEL - BOOKING CONTROLLER
 * Professional booking management with comprehensive features
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { query } = require("../config/db");
const { 
  generateBookingNumber, 
  generateConfirmationCode,
  paginate,
  sanitizeInput,
  formatDate 
} = require("../utils/helpers");
const { 
  sendBookingConfirmation, 
  sendBookingStatusUpdate,
  sendBookingCancellation,
  sendAdminBookingNotification
} = require("../utils/email");
const logger = require("../utils/logger");

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  ON_HOLD: 'on-hold',
  REFUNDED: 'refunded'
};

const PAYMENT_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  PARTIALLY_PAID: 'partially-paid',
  REFUNDED: 'refunded'
};

const BOOKING_TYPES = ['destination', 'service', 'custom', 'package'];

// Valid status transitions
const STATUS_TRANSITIONS = {
  'pending': ['confirmed', 'cancelled', 'on-hold'],
  'confirmed': ['completed', 'cancelled', 'on-hold'],
  'on-hold': ['confirmed', 'cancelled', 'pending'],
  'completed': ['refunded'],
  'cancelled': ['pending'], // Can reopen
  'refunded': []
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate booking input data
 */
const validateBookingInput = (data, isUpdate = false) => {
  const errors = [];

  if (!isUpdate) {
    if (!data.full_name?.trim()) {
      errors.push({ field: 'full_name', message: 'Full name is required' });
    }
    if (!data.email?.trim()) {
      errors.push({ field: 'email', message: 'Email is required' });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errors.push({ field: 'email', message: 'Invalid email format' });
    }
  }

  if (data.travel_date && data.return_date) {
    const travelDate = new Date(data.travel_date);
    const returnDate = new Date(data.return_date);
    if (returnDate < travelDate) {
      errors.push({ field: 'return_date', message: 'Return date must be after travel date' });
    }
  }

  if (data.travel_date) {
    const travelDate = new Date(data.travel_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (travelDate < today && !isUpdate) {
      errors.push({ field: 'travel_date', message: 'Travel date cannot be in the past' });
    }
  }

  if (data.number_of_travelers && (data.number_of_travelers < 1 || data.number_of_travelers > 100)) {
    errors.push({ field: 'number_of_travelers', message: 'Number of travelers must be between 1 and 100' });
  }

  if (data.number_of_adults && data.number_of_adults < 1) {
    errors.push({ field: 'number_of_adults', message: 'At least one adult is required' });
  }

  if (data.number_of_children && data.number_of_children < 0) {
    errors.push({ field: 'number_of_children', message: 'Number of children cannot be negative' });
  }

  return errors;
};

/**
 * Validate status transition
 */
const isValidStatusTransition = (currentStatus, newStatus) => {
  const allowed = STATUS_TRANSITIONS[currentStatus] || [];
  return allowed.includes(newStatus);
};

/**
 * Log booking activity
 */
const logBookingActivity = async (bookingId, action, details, adminId = null) => {
  try {
    await query(
      `INSERT INTO activity_log (entity_type, entity_id, action, description, admin_id, metadata, created_at)
       VALUES ('booking', $1, $2, $3, $4, $5, NOW())`,
      [bookingId, action, details, adminId, JSON.stringify({ timestamp: new Date() })]
    );
  } catch (err) {
    logger.error('Failed to log booking activity', { error: err.message, bookingId, action });
  }
};

/**
 * Get booking with full details
 */
const getBookingWithDetails = async (identifier, type = 'id') => {
  const whereClause = type === 'id' ? 'b.id = $1' : 'b.booking_number = $1';
  
  const result = await query(
    `SELECT 
      b.*,
      d.name AS destination_name,
      d.slug AS destination_slug,
      d.image_url AS destination_image,
      d.duration AS destination_duration,
      c.name AS country_name,
      c.slug AS country_slug,
      s.title AS service_name,
      s.slug AS service_slug,
      u.full_name AS user_name,
      u.email AS user_email
     FROM bookings b
     LEFT JOIN destinations d ON b.destination_id = d.id
     LEFT JOIN countries c ON d.country_id = c.id
     LEFT JOIN services s ON b.service_id = s.id
     LEFT JOIN users u ON b.user_id = u.id
     WHERE ${whereClause}`,
    [identifier]
  );

  return result.rows[0] || null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLLER METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create new booking
 * POST /api/bookings
 */
exports.create = async (req, res, next) => {
  try {
    const {
      // Required
      full_name,
      email,
      
      // Optional - Destination/Service
      destination_id,
      service_id,
      booking_type = 'destination',
      
      // Contact
      phone,
      whatsapp,
      nationality,
      country,
      
      // Travel Details
      travel_date,
      return_date,
      flexible_dates = false,
      number_of_travelers = 1,
      number_of_adults = 1,
      number_of_children = 0,
      children_ages,
      
      // Preferences
      accommodation_type,
      room_type,
      dietary_requirements,
      special_requests,
      accessibility_needs,
      
      // Additional Info
      travelers_details,
      emergency_contact,
      customer_notes,
      
      // Tracking
      source,
      utm_source,
      utm_medium,
      utm_campaign,
      referrer_url
    } = req.body;

    // Validation
    const validationErrors = validateBookingInput(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validationErrors
      });
    }

    // Validate booking type
    if (!BOOKING_TYPES.includes(booking_type)) {
      return res.status(400).json({
        error: 'Invalid booking type',
        validTypes: BOOKING_TYPES
      });
    }

    // Validate destination exists if provided
    if (destination_id) {
      const destCheck = await query(
        'SELECT id, name, is_active FROM destinations WHERE id = $1',
        [destination_id]
      );
      if (destCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Destination not found' });
      }
      if (!destCheck.rows[0].is_active) {
        return res.status(400).json({ error: 'This destination is currently unavailable' });
      }
    }

    // Validate service exists if provided
    if (service_id) {
      const serviceCheck = await query(
        'SELECT id, title, is_active FROM services WHERE id = $1',
        [service_id]
      );
      if (serviceCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Service not found' });
      }
      if (!serviceCheck.rows[0].is_active) {
        return res.status(400).json({ error: 'This service is currently unavailable' });
      }
    }

    // Generate unique booking number
    const booking_number = generateBookingNumber();
    
    // Get user_id if authenticated
    const user_id = req.user?.id || null;

    // Insert booking
    const result = await query(
      `INSERT INTO bookings (
        booking_number, user_id, destination_id, service_id, booking_type,
        full_name, email, phone, whatsapp, nationality, country,
        travel_date, return_date, flexible_dates,
        number_of_travelers, number_of_adults, number_of_children, children_ages,
        accommodation_type, room_type, dietary_requirements, special_requests, accessibility_needs,
        travelers_details, emergency_contact, customer_notes,
        source, utm_source, utm_medium, utm_campaign, referrer_url,
        status, payment_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
        $27, $28, $29, $30, $31, 'pending', 'pending'
      ) RETURNING *`,
      [
        booking_number, user_id, destination_id || null, service_id || null, booking_type,
        sanitizeInput(full_name), email.toLowerCase().trim(), phone, whatsapp, nationality, country,
        travel_date || null, return_date || null, flexible_dates,
        number_of_travelers, number_of_adults, number_of_children,
        children_ages ? JSON.stringify(children_ages) : null,
        accommodation_type, room_type, dietary_requirements, special_requests, accessibility_needs,
        travelers_details ? JSON.stringify(travelers_details) : null,
        emergency_contact ? JSON.stringify(emergency_contact) : null,
        customer_notes,
        source || 'website', utm_source, utm_medium, utm_campaign, referrer_url
      ]
    );

    const booking = result.rows[0];

    // Get full booking details for response and email
    const fullBooking = await getBookingWithDetails(booking.id);

    // Log activity
    await logBookingActivity(booking.id, 'created', `Booking ${booking_number} created`);

    // Update destination/service booking count
    if (destination_id) {
      await query(
        'UPDATE destinations SET booking_count = booking_count + 1 WHERE id = $1',
        [destination_id]
      );
    }
    if (service_id) {
      await query(
        'UPDATE services SET booking_count = booking_count + 1 WHERE id = $1',
        [service_id]
      );
    }

    // Send confirmation emails (non-blocking)
    Promise.all([
      sendBookingConfirmation(fullBooking),
      sendAdminBookingNotification(fullBooking)
    ]).catch(err => {
      logger.error('Failed to send booking emails', { error: err.message, booking_number });
    });

    // Response
    res.status(201).json({
      success: true,
      message: 'Booking submitted successfully! We will contact you shortly.',
      data: {
        booking_number: booking.booking_number,
        status: booking.status,
        email: booking.email,
        travel_date: booking.travel_date,
        destination: fullBooking?.destination_name,
        service: fullBooking?.service_name,
        created_at: booking.created_at
      }
    });

  } catch (err) {
    logger.error('Booking creation failed', { error: err.message, body: req.body });
    next(err);
  }
};

/**
 * Track booking by booking number (Public)
 * GET /api/bookings/track/:bookingNumber
 */
exports.track = async (req, res, next) => {
  try {
    const { bookingNumber } = req.params;

    if (!bookingNumber) {
      return res.status(400).json({ error: 'Booking number is required' });
    }

    const booking = await getBookingWithDetails(bookingNumber, 'booking_number');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Return limited info for public tracking
    res.json({
      success: true,
      data: {
        booking_number: booking.booking_number,
        status: booking.status,
        payment_status: booking.payment_status,
        travel_date: booking.travel_date,
        return_date: booking.return_date,
        number_of_travelers: booking.number_of_travelers,
        destination: booking.destination_name,
        service: booking.service_name,
        country: booking.country_name,
        created_at: booking.created_at,
        confirmed_at: booking.confirmed_at,
        // Status message
        status_message: getStatusMessage(booking.status)
      }
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Get status message helper
 */
const getStatusMessage = (status) => {
  const messages = {
    'pending': 'Your booking is being reviewed. We will contact you within 24 hours.',
    'confirmed': 'Your booking has been confirmed! Check your email for details.',
    'on-hold': 'Your booking is on hold. Please contact us for more information.',
    'completed': 'Trip completed. Thank you for traveling with us!',
    'cancelled': 'This booking has been cancelled.',
    'refunded': 'This booking has been refunded.'
  };
  return messages[status] || 'Unknown status';
};

/**
 * Get all bookings (Admin)
 * GET /api/bookings
 */
exports.getAll = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      payment_status,
      booking_type,
      destination_id,
      service_id,
      search,
      date_from,
      date_to,
      travel_date_from,
      travel_date_to,
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    // Build query conditions
    let conditions = ['1=1'];
    const params = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`b.status = $${paramIndex++}`);
      params.push(status);
    }

    if (payment_status) {
      conditions.push(`b.payment_status = $${paramIndex++}`);
      params.push(payment_status);
    }

    if (booking_type) {
      conditions.push(`b.booking_type = $${paramIndex++}`);
      params.push(booking_type);
    }

    if (destination_id) {
      conditions.push(`b.destination_id = $${paramIndex++}`);
      params.push(parseInt(destination_id));
    }

    if (service_id) {
      conditions.push(`b.service_id = $${paramIndex++}`);
      params.push(parseInt(service_id));
    }

    if (search) {
      conditions.push(`(
        b.full_name ILIKE $${paramIndex} OR 
        b.email ILIKE $${paramIndex} OR 
        b.booking_number ILIKE $${paramIndex} OR
        b.phone ILIKE $${paramIndex} OR
        b.whatsapp ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (date_from) {
      conditions.push(`b.created_at >= $${paramIndex++}`);
      params.push(date_from);
    }

    if (date_to) {
      conditions.push(`b.created_at <= $${paramIndex++}`);
      params.push(date_to);
    }

    if (travel_date_from) {
      conditions.push(`b.travel_date >= $${paramIndex++}`);
      params.push(travel_date_from);
    }

    if (travel_date_to) {
      conditions.push(`b.travel_date <= $${paramIndex++}`);
      params.push(travel_date_to);
    }

    const whereClause = conditions.join(' AND ');

    // Validate sort parameters
    const allowedSortFields = ['created_at', 'travel_date', 'full_name', 'status', 'booking_number'];
    const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortDir = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM bookings b WHERE ${whereClause}`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].count);
    const pagination = paginate(totalCount, parseInt(page), parseInt(limit));

    // Get bookings with related data
    const bookingsResult = await query(
      `SELECT 
        b.*,
        d.name AS destination_name,
        d.slug AS destination_slug,
        d.image_url AS destination_image,
        c.name AS country_name,
        s.title AS service_name,
        s.slug AS service_slug,
        u.full_name AS user_name,
        u.email AS user_email
       FROM bookings b
       LEFT JOIN destinations d ON b.destination_id = d.id
       LEFT JOIN countries c ON d.country_id = c.id
       LEFT JOIN services s ON b.service_id = s.id
       LEFT JOIN users u ON b.user_id = u.id
       WHERE ${whereClause}
       ORDER BY b.${sortField} ${sortDir}
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pagination.limit, pagination.offset]
    );

    res.json({
      success: true,
      data: bookingsResult.rows,
      pagination,
      filters: {
        status,
        payment_status,
        booking_type,
        search,
        date_from,
        date_to
      }
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Get booking statistics (Admin)
 * GET /api/bookings/stats
 */
exports.getStats = async (req, res, next) => {
  try {
    const { period = '12months' } = req.query;

    // Overall statistics
    const overallStats = await query(`
      SELECT
        COUNT(*) AS total_bookings,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
        COUNT(*) FILTER (WHERE status = 'on-hold') AS on_hold,
        COUNT(*) FILTER (WHERE status = 'refunded') AS refunded,
        COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid,
        COUNT(*) FILTER (WHERE payment_status = 'pending') AS payment_pending,
        SUM(number_of_travelers) AS total_travelers,
        AVG(number_of_travelers)::DECIMAL(10,2) AS avg_travelers_per_booking,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS last_7_days,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS last_30_days
      FROM bookings
    `);

    // Monthly trends
    const monthlyTrends = await query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        TO_CHAR(created_at, 'Mon YYYY') AS month_label,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
        SUM(number_of_travelers) AS travelers
      FROM bookings
      WHERE created_at >= NOW() - INTERVAL '${period === '12months' ? '12 months' : '6 months'}'
      GROUP BY month, month_label
      ORDER BY month ASC
    `);

    // Top destinations
    const topDestinations = await query(`
      SELECT 
        d.id,
        d.name,
        d.slug,
        d.image_url,
        COUNT(b.id) AS booking_count,
        SUM(b.number_of_travelers) AS total_travelers
      FROM bookings b
      JOIN destinations d ON b.destination_id = d.id
      WHERE b.created_at >= NOW() - INTERVAL '3 months'
      GROUP BY d.id, d.name, d.slug, d.image_url
      ORDER BY booking_count DESC
      LIMIT 10
    `);

    // Bookings by source
    const bookingsBySource = await query(`
      SELECT 
        COALESCE(source, 'direct') AS source,
        COUNT(*) AS count,
        ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0), 2) AS percentage
      FROM bookings
      WHERE created_at >= NOW() - INTERVAL '3 months'
      GROUP BY source
      ORDER BY count DESC
    `);

    // Bookings by nationality
    const bookingsByNationality = await query(`
      SELECT 
        COALESCE(nationality, 'Unknown') AS nationality,
        COUNT(*) AS count
      FROM bookings
      WHERE created_at >= NOW() - INTERVAL '3 months'
        AND nationality IS NOT NULL
      GROUP BY nationality
      ORDER BY count DESC
      LIMIT 10
    `);

    // Average lead time (days between booking and travel)
    const leadTimeStats = await query(`
      SELECT 
        AVG(travel_date - created_at::date)::INTEGER AS avg_lead_time_days,
        MIN(travel_date - created_at::date) AS min_lead_time_days,
        MAX(travel_date - created_at::date) AS max_lead_time_days
      FROM bookings
      WHERE travel_date IS NOT NULL
        AND travel_date > created_at::date
        AND created_at >= NOW() - INTERVAL '3 months'
    `);

    // Upcoming bookings
    const upcomingBookings = await query(`
      SELECT 
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE travel_date BETWEEN NOW() AND NOW() + INTERVAL '7 days') AS next_7_days,
        COUNT(*) FILTER (WHERE travel_date BETWEEN NOW() AND NOW() + INTERVAL '30 days') AS next_30_days,
        COUNT(*) FILTER (WHERE travel_date BETWEEN NOW() AND NOW() + INTERVAL '90 days') AS next_90_days
      FROM bookings
      WHERE status IN ('confirmed', 'pending')
        AND travel_date >= NOW()
    `);

    // Conversion rate (confirmed / total)
    const conversionRate = await query(`
      SELECT 
        ROUND(
          COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed')) * 100.0 / 
          NULLIF(COUNT(*), 0), 
          2
        ) AS conversion_rate
      FROM bookings
      WHERE created_at >= NOW() - INTERVAL '3 months'
    `);

    res.json({
      success: true,
      data: {
        overview: overallStats.rows[0],
        monthly_trends: monthlyTrends.rows,
        top_destinations: topDestinations.rows,
        by_source: bookingsBySource.rows,
        by_nationality: bookingsByNationality.rows,
        lead_time: leadTimeStats.rows[0],
        upcoming: upcomingBookings.rows[0],
        conversion_rate: conversionRate.rows[0]?.conversion_rate || 0
      },
      generated_at: new Date().toISOString()
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Get single booking (Admin)
 * GET /api/bookings/:id
 */
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;

    const booking = await getBookingWithDetails(parseInt(id));

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Get activity history
    const activityHistory = await query(
      `SELECT action, description, created_at, admin_id
       FROM activity_log
       WHERE entity_type = 'booking' AND entity_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...booking,
        activity_history: activityHistory.rows
      }
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Update booking (Admin)
 * PUT /api/bookings/:id
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id || null;
    
    // Fields that can be updated
    const allowedFields = [
      'full_name', 'email', 'phone', 'whatsapp', 'nationality', 'country',
      'travel_date', 'return_date', 'flexible_dates',
      'number_of_travelers', 'number_of_adults', 'number_of_children', 'children_ages',
      'accommodation_type', 'room_type', 'dietary_requirements',
      'special_requests', 'accessibility_needs',
      'travelers_details', 'emergency_contact',
      'admin_notes', 'internal_notes', 'customer_notes',
      'payment_status'
    ];

    // Check booking exists
    const existing = await query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Filter allowed fields
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Validate updates
    const validationErrors = validateBookingInput(updates, true);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validationErrors
      });
    }

    // Handle JSONB fields
    if (updates.travelers_details && typeof updates.travelers_details === 'object') {
      updates.travelers_details = JSON.stringify(updates.travelers_details);
    }
    if (updates.emergency_contact && typeof updates.emergency_contact === 'object') {
      updates.emergency_contact = JSON.stringify(updates.emergency_contact);
    }
    if (updates.children_ages && Array.isArray(updates.children_ages)) {
      updates.children_ages = JSON.stringify(updates.children_ages);
    }

    // Build update query
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

    const result = await query(
      `UPDATE bookings 
       SET ${setClause}, updated_at = NOW()
       WHERE id = $${fields.length + 1}
       RETURNING *`,
      [...values, id]
    );

    // Log activity
    await logBookingActivity(
      id,
      'updated',
      `Booking updated. Fields: ${fields.join(', ')}`,
      adminId
    );

    const updatedBooking = await getBookingWithDetails(parseInt(id));

    res.json({
      success: true,
      message: 'Booking updated successfully',
      data: updatedBooking
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Update booking status (Admin)
 * PATCH /api/bookings/:id/status
 */
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason, notify_customer = true } = req.body;
    const adminId = req.admin?.id || null;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Check booking exists
    const existing = await query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const currentStatus = existing.rows[0].status;

    // Validate status transition
    if (!isValidStatusTransition(currentStatus, status)) {
      return res.status(400).json({
        error: 'Invalid status transition',
        current_status: currentStatus,
        requested_status: status,
        allowed_transitions: STATUS_TRANSITIONS[currentStatus]
      });
    }

    // Build update based on new status
    let updateQuery = 'UPDATE bookings SET status = $1, updated_at = NOW()';
    const params = [status];
    let paramIndex = 2;

    // Status-specific updates
    if (status === 'confirmed') {
      const confirmation_code = generateConfirmationCode();
      updateQuery += `, confirmed_at = NOW(), confirmation_code = $${paramIndex++}`;
      params.push(confirmation_code);
    } else if (status === 'cancelled') {
      updateQuery += `, cancelled_at = NOW()`;
      if (reason) {
        updateQuery += `, cancellation_reason = $${paramIndex++}`;
        params.push(reason);
      }
    } else if (status === 'completed') {
      updateQuery += `, completed_at = NOW()`;
    }

    updateQuery += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);

    const result = await query(updateQuery, params);
    const booking = result.rows[0];

    // Log activity
    await logBookingActivity(
      id,
      `status_${status}`,
      `Status changed from ${currentStatus} to ${status}${reason ? `. Reason: ${reason}` : ''}`,
      adminId
    );

    // Get full booking details
    const fullBooking = await getBookingWithDetails(parseInt(id));

    // Send notification email if requested
    if (notify_customer) {
      if (status === 'confirmed') {
        sendBookingConfirmation(fullBooking).catch(err => {
          logger.error('Failed to send confirmation email', { error: err.message });
        });
      } else if (status === 'cancelled') {
        sendBookingCancellation(fullBooking, reason).catch(err => {
          logger.error('Failed to send cancellation email', { error: err.message });
        });
      } else {
        sendBookingStatusUpdate(fullBooking, currentStatus, status).catch(err => {
          logger.error('Failed to send status update email', { error: err.message });
        });
      }
    }

    res.json({
      success: true,
      message: `Booking status updated to ${status}`,
      data: fullBooking
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Confirm booking (Admin shortcut)
 * POST /api/bookings/:id/confirm
 */
exports.confirm = async (req, res, next) => {
  req.body.status = 'confirmed';
  return exports.updateStatus(req, res, next);
};

/**
 * Cancel booking (Admin shortcut)
 * POST /api/bookings/:id/cancel
 */
exports.cancel = async (req, res, next) => {
  req.body.status = 'cancelled';
  return exports.updateStatus(req, res, next);
};

/**
 * Delete booking (Admin)
 * DELETE /api/bookings/:id
 */
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id || null;

    // Check booking exists
    const existing = await query(
      'SELECT id, booking_number, destination_id, service_id FROM bookings WHERE id = $1',
      [id]
    );
    
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = existing.rows[0];

    // Delete booking
    await query('DELETE FROM bookings WHERE id = $1', [id]);

    // Update counts
    if (booking.destination_id) {
      await query(
        'UPDATE destinations SET booking_count = GREATEST(0, booking_count - 1) WHERE id = $1',
        [booking.destination_id]
      );
    }
    if (booking.service_id) {
      await query(
        'UPDATE services SET booking_count = GREATEST(0, booking_count - 1) WHERE id = $1',
        [booking.service_id]
      );
    }

    // Log activity
    await logBookingActivity(id, 'deleted', `Booking ${booking.booking_number} deleted`, adminId);

    res.json({
      success: true,
      message: 'Booking deleted successfully'
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Bulk update booking status (Admin)
 * POST /api/bookings/bulk-status
 */
exports.bulkUpdateStatus = async (req, res, next) => {
  try {
    const { booking_ids, status, reason, notify_customers = false } = req.body;
    const adminId = req.admin?.id || null;

    if (!Array.isArray(booking_ids) || booking_ids.length === 0) {
      return res.status(400).json({ error: 'booking_ids array is required' });
    }

    if (!status || !Object.values(BOOKING_STATUS).includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        valid_statuses: Object.values(BOOKING_STATUS)
      });
    }

    const results = {
      success: [],
      failed: []
    };

    for (const bookingId of booking_ids) {
      try {
        const existing = await query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
        
        if (existing.rows.length === 0) {
          results.failed.push({ id: bookingId, reason: 'Not found' });
          continue;
        }

        const currentStatus = existing.rows[0].status;

        if (!isValidStatusTransition(currentStatus, status)) {
          results.failed.push({ 
            id: bookingId, 
            reason: `Invalid transition from ${currentStatus} to ${status}` 
          });
          continue;
        }

        await query(
          'UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2',
          [status, bookingId]
        );

        await logBookingActivity(
          bookingId,
          `bulk_status_${status}`,
          `Bulk status update: ${currentStatus} → ${status}`,
          adminId
        );

        results.success.push(bookingId);

      } catch (err) {
        results.failed.push({ id: bookingId, reason: err.message });
      }
    }

    res.json({
      success: true,
      message: `Updated ${results.success.length} of ${booking_ids.length} bookings`,
      data: results
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Export bookings (Admin)
 * GET /api/bookings/export
 */
exports.export = async (req, res, next) => {
  try {
    const {
      format = 'json',
      status,
      date_from,
      date_to
    } = req.query;

    let conditions = ['1=1'];
    const params = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`b.status = $${paramIndex++}`);
      params.push(status);
    }

    if (date_from) {
      conditions.push(`b.created_at >= $${paramIndex++}`);
      params.push(date_from);
    }

    if (date_to) {
      conditions.push(`b.created_at <= $${paramIndex++}`);
      params.push(date_to);
    }

    const whereClause = conditions.join(' AND ');

    const result = await query(
      `SELECT 
        b.booking_number,
        b.full_name,
        b.email,
        b.phone,
        b.whatsapp,
        b.nationality,
        b.country,
        b.travel_date,
        b.return_date,
        b.number_of_travelers,
        b.number_of_adults,
        b.number_of_children,
        b.accommodation_type,
        b.special_requests,
        b.status,
        b.payment_status,
        b.created_at,
        d.name AS destination,
        c.name AS destination_country,
        s.title AS service
       FROM bookings b
       LEFT JOIN destinations d ON b.destination_id = d.id
       LEFT JOIN countries c ON d.country_id = c.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE ${whereClause}
       ORDER BY b.created_at DESC`,
      params
    );

    if (format === 'csv') {
      // Generate CSV
      const headers = Object.keys(result.rows[0] || {});
      let csv = headers.join(',') + '\n';
      
      result.rows.forEach(row => {
        const values = headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        });
        csv += values.join(',') + '\n';
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=bookings-export-${Date.now()}.csv`);
      return res.send(csv);
    }

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length,
      exported_at: new Date().toISOString()
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Get user's bookings (Authenticated users)
 * GET /api/bookings/my-bookings
 */
exports.getMyBookings = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { page = 1, limit = 10, status } = req.query;

    let conditions = ['b.user_id = $1'];
    const params = [userId];
    let paramIndex = 2;

    if (status) {
      conditions.push(`b.status = $${paramIndex++}`);
      params.push(status);
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) FROM bookings b WHERE ${whereClause}`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].count);
    const pagination = paginate(totalCount, parseInt(page), parseInt(limit));

    const result = await query(
      `SELECT 
        b.*,
        d.name AS destination_name,
        d.slug AS destination_slug,
        d.image_url AS destination_image,
        c.name AS country_name,
        s.title AS service_name
       FROM bookings b
       LEFT JOIN destinations d ON b.destination_id = d.id
       LEFT JOIN countries c ON d.country_id = c.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE ${whereClause}
       ORDER BY b.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pagination.limit, pagination.offset]
    );

    res.json({
      success: true,
      data: result.rows,
      pagination
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Add admin notes (Admin)
 * POST /api/bookings/:id/notes
 */
exports.addNotes = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { admin_notes, internal_notes } = req.body;
    const adminId = req.admin?.id || null;

    if (!admin_notes && !internal_notes) {
      return res.status(400).json({ error: 'Notes content is required' });
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (admin_notes) {
      updates.push(`admin_notes = COALESCE(admin_notes, '') || E'\\n[' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI') || '] ' || $${paramIndex++}`);
      params.push(admin_notes);
    }

    if (internal_notes) {
      updates.push(`internal_notes = COALESCE(internal_notes, '') || E'\\n[' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI') || '] ' || $${paramIndex++}`);
      params.push(internal_notes);
    }

    params.push(id);

    const result = await query(
      `UPDATE bookings 
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    await logBookingActivity(id, 'notes_added', 'Admin notes updated', adminId);

    res.json({
      success: true,
      message: 'Notes added successfully',
      data: result.rows[0]
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Get upcoming bookings (Admin dashboard)
 * GET /api/bookings/upcoming
 */
exports.getUpcoming = async (req, res, next) => {
  try {
    const { days = 30, limit = 20 } = req.query;

    const result = await query(
      `SELECT 
        b.*,
        d.name AS destination_name,
        d.slug AS destination_slug,
        d.image_url AS destination_image,
        c.name AS country_name,
        s.title AS service_name
       FROM bookings b
       LEFT JOIN destinations d ON b.destination_id = d.id
       LEFT JOIN countries c ON d.country_id = c.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE b.status IN ('confirmed', 'pending')
         AND b.travel_date >= CURRENT_DATE
         AND b.travel_date <= CURRENT_DATE + $1::INTEGER
       ORDER BY b.travel_date ASC
       LIMIT $2`,
      [parseInt(days), parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows,
      period: `Next ${days} days`
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Get recent bookings (Admin dashboard)
 * GET /api/bookings/recent
 */
exports.getRecent = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;

    const result = await query(
      `SELECT 
        b.id,
        b.booking_number,
        b.full_name,
        b.email,
        b.status,
        b.travel_date,
        b.number_of_travelers,
        b.created_at,
        d.name AS destination_name,
        d.image_url AS destination_image,
        s.title AS service_name
       FROM bookings b
       LEFT JOIN destinations d ON b.destination_id = d.id
       LEFT JOIN services s ON b.service_id = s.id
       ORDER BY b.created_at DESC
       LIMIT $1`,
      [parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    next(err);
  }
};