/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BOOKINGS CONTROLLER v2.0
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Fix: removed references to columns that may not exist in older DB instances.
 * The schema is now guaranteed by ensureBookingsSchema() in the route file,
 * but the INSERT/SELECT queries are also made resilient with COALESCE defaults.
 */

"use strict";

const { query }  = require("../config/db");
const {
  generateBookingNumber,
  generateConfirmationCode,
  paginate,
  sanitizeInput,
} = require("../utils/helpers");
const {
  sendBookingConfirmation,
  sendBookingStatusUpdate,
  sendBookingCancellation,
  sendAdminBookingNotification,
} = require("../utils/email");
const logger = require("../utils/logger");

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const BOOKING_STATUS = {
  PENDING:   "pending",
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  ON_HOLD:   "on-hold",
  REFUNDED:  "refunded",
};

const STATUS_TRANSITIONS = {
  pending:   ["confirmed", "cancelled", "on-hold"],
  confirmed: ["completed", "cancelled", "on-hold"],
  "on-hold": ["confirmed", "cancelled", "pending"],
  completed: ["refunded"],
  cancelled: ["pending"],
  refunded:  [],
};

const BOOKING_TYPES    = ["destination", "service", "custom", "package"];
const ALLOWED_SORT_COL = new Set(["created_at", "travel_date", "full_name", "status", "booking_number"]);

// ═══════════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const safeInt = (v, def, min = 1, max = 500) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

const isValidTransition = (from, to) =>
  (STATUS_TRANSITIONS[from] || []).includes(to);

const getStatusMessage = (status) =>
  ({
    pending:   "Your booking is being reviewed. We will contact you within 24 hours.",
    confirmed: "Your booking has been confirmed! Check your email for details.",
    "on-hold": "Your booking is on hold. Please contact us for more information.",
    completed: "Trip completed. Thank you for traveling with us!",
    cancelled: "This booking has been cancelled.",
    refunded:  "This booking has been refunded.",
  }[status] || "Unknown status");

const validateBooking = (data, isUpdate = false) => {
  const errors = [];

  if (!isUpdate) {
    if (!data.full_name?.trim())
      errors.push({ field: "full_name", message: "Full name is required" });

    if (!data.email?.trim())
      errors.push({ field: "email", message: "Email is required" });
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
      errors.push({ field: "email", message: "Invalid email address" });

    if (data.travel_date) {
      const td = new Date(data.travel_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (td < today)
        errors.push({ field: "travel_date", message: "Travel date cannot be in the past" });
    }
  }

  if (data.travel_date && data.return_date) {
    if (new Date(data.return_date) < new Date(data.travel_date))
      errors.push({ field: "return_date", message: "Return date must be after travel date" });
  }

  if (data.number_of_travelers !== undefined) {
    const n = parseInt(data.number_of_travelers, 10);
    if (!Number.isFinite(n) || n < 1 || n > 100)
      errors.push({ field: "number_of_travelers", message: "Travelers must be 1–100" });
  }

  return errors;
};

/**
 * Log booking activity — never throws.
 */
const logActivity = async (bookingId, action, description, adminId = null) => {
  try {
    await query(
      `INSERT INTO activity_log
         (entity_type, entity_id, action, description, admin_id, metadata, created_at)
       VALUES ('booking', $1, $2, $3, $4, $5, NOW())`,
      [bookingId, action, description, adminId, JSON.stringify({ ts: new Date() })],
    );
  } catch (err) {
    logger.warn("[Bookings] logActivity non-fatal:", err.message);
  }
};

/**
 * Fetch a booking with all JOINs by id or booking_number.
 */
const getBookingDetail = async (identifier, type = "id") => {
  const where = type === "id" ? "b.id = $1" : "b.booking_number = $1";
  const { rows } = await query(
    `SELECT
        b.*,
        d.name         AS destination_name,
        d.slug         AS destination_slug,
        d.image_url    AS destination_image,
        c.name         AS country_name,
        c.slug         AS country_slug,
        s.title        AS service_name,
        s.slug         AS service_slug,
        u.full_name    AS user_name,
        u.email        AS user_email
       FROM bookings b
       LEFT JOIN destinations d ON b.destination_id = d.id
       LEFT JOIN countries    c ON d.country_id     = c.id
       LEFT JOIN services     s ON b.service_id     = s.id
       LEFT JOIN users        u ON b.user_id        = u.id
       WHERE ${where}`,
    [identifier],
  );
  return rows[0] || null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE BOOKING  — POST /api/bookings
// ═══════════════════════════════════════════════════════════════════════════════

exports.create = async (req, res, next) => {
  try {
    const {
      full_name,
      email,
      destination_id,
      service_id,
      booking_type        = "destination",
      phone,
      whatsapp,
      nationality,
      country,
      travel_date,
      return_date,
      flexible_dates      = false,
      number_of_travelers = 1,
      number_of_adults    = 1,
      number_of_children  = 0,
      children_ages,
      accommodation_type,
      room_type,
      dietary_requirements,
      special_requests,
      accessibility_needs,
      travelers_details,
      emergency_contact,
      customer_notes,
      source              = "website",
      utm_source,
      utm_medium,
      utm_campaign,
      referrer_url,
    } = req.body;

    const errors = validateBooking(req.body);
    if (errors.length) {
      return res.status(400).json({ success: false, error: "Validation failed", details: errors });
    }

    if (!BOOKING_TYPES.includes(booking_type)) {
      return res.status(400).json({ success: false, error: "Invalid booking type" });
    }

    if (destination_id) {
      const { rows } = await query(
        "SELECT id, is_active FROM destinations WHERE id = $1", [destination_id],
      );
      if (!rows[0]) return res.status(400).json({ success: false, error: "Destination not found" });
      if (!rows[0].is_active) return res.status(400).json({ success: false, error: "Destination unavailable" });
    }

    if (service_id) {
      const { rows } = await query(
        "SELECT id, is_active FROM services WHERE id = $1", [service_id],
      );
      if (!rows[0]) return res.status(400).json({ success: false, error: "Service not found" });
      if (!rows[0].is_active) return res.status(400).json({ success: false, error: "Service unavailable" });
    }

    const booking_number = generateBookingNumber();
    const user_id        = req.user?.id || null;

    const { rows } = await query(
      `INSERT INTO bookings (
          booking_number, user_id, destination_id, service_id, booking_type,
          full_name, email, phone, whatsapp, nationality, country,
          travel_date, return_date, flexible_dates,
          number_of_travelers, number_of_adults, number_of_children, children_ages,
          accommodation_type, room_type, dietary_requirements,
          special_requests, accessibility_needs,
          travelers_details, emergency_contact, customer_notes,
          source, utm_source, utm_medium, utm_campaign, referrer_url,
          status, payment_status, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,$11,
          $12,$13,$14,
          $15,$16,$17,$18,
          $19,$20,$21,
          $22,$23,
          $24,$25,$26,
          $27,$28,$29,$30,$31,
          'pending','pending',NOW(),NOW()
        ) RETURNING *`,
      [
        booking_number, user_id,
        destination_id || null, service_id || null, booking_type,
        sanitizeInput(full_name), email.toLowerCase().trim(),
        phone || null, whatsapp || null, nationality || null, country || null,
        travel_date || null, return_date || null, flexible_dates,
        number_of_travelers, number_of_adults, number_of_children,
        children_ages ? JSON.stringify(children_ages) : null,
        accommodation_type || null, room_type || null,
        dietary_requirements || null, special_requests || null,
        accessibility_needs || null,
        travelers_details  ? JSON.stringify(travelers_details)  : null,
        emergency_contact  ? JSON.stringify(emergency_contact)  : null,
        customer_notes || null,
        source, utm_source || null, utm_medium || null,
        utm_campaign || null, referrer_url || null,
      ],
    );

    const booking     = rows[0];
    const fullBooking = await getBookingDetail(booking.id);

    logActivity(booking.id, "created", `Booking ${booking_number} created`);

    // Non-blocking counter updates
    if (destination_id) {
      query("UPDATE destinations SET booking_count = booking_count + 1 WHERE id = $1", [destination_id]).catch(() => {});
    }
    if (service_id) {
      query("UPDATE services SET booking_count = booking_count + 1 WHERE id = $1", [service_id]).catch(() => {});
    }

    // Non-blocking emails
    Promise.all([
      sendBookingConfirmation(fullBooking),
      sendAdminBookingNotification(fullBooking),
    ]).catch((err) => logger.error("[Bookings] Email send failed:", err.message));

    return res.status(201).json({
      success: true,
      message: "Booking submitted successfully! We will contact you shortly.",
      data: {
        booking_number: booking.booking_number,
        status:         booking.status,
        email:          booking.email,
        travel_date:    booking.travel_date,
        destination:    fullBooking?.destination_name || null,
        service:        fullBooking?.service_name     || null,
        created_at:     booking.created_at,
      },
    });
  } catch (err) {
    logger.error("[Bookings] create failed:", err.message, err.detail || "");
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET ALL  — GET /api/bookings  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.getAll = async (req, res, next) => {
  try {
    const {
      page            = 1,
      limit           = 20,
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
      sortBy          = "created_at",
      order           = "desc",
    } = req.query;

    const params = [];
    const conds  = ["1=1"];
    let   pi     = 1;

    if (status)         { conds.push(`b.status = $${pi}`);           params.push(status);                   pi++; }
    if (payment_status) { conds.push(`b.payment_status = $${pi}`);   params.push(payment_status);           pi++; }
    if (booking_type)   { conds.push(`b.booking_type = $${pi}`);     params.push(booking_type);             pi++; }
    if (destination_id) { conds.push(`b.destination_id = $${pi}`);   params.push(parseInt(destination_id)); pi++; }
    if (service_id)     { conds.push(`b.service_id = $${pi}`);       params.push(parseInt(service_id));     pi++; }
    if (date_from)      { conds.push(`b.created_at >= $${pi}`);      params.push(date_from);                pi++; }
    if (date_to)        { conds.push(`b.created_at <= $${pi}`);      params.push(date_to);                  pi++; }
    if (travel_date_from) { conds.push(`b.travel_date >= $${pi}`);   params.push(travel_date_from);         pi++; }
    if (travel_date_to)   { conds.push(`b.travel_date <= $${pi}`);   params.push(travel_date_to);           pi++; }

    if (search) {
      conds.push(`(
        b.full_name      ILIKE $${pi} OR
        b.email          ILIKE $${pi} OR
        b.booking_number ILIKE $${pi} OR
        b.phone          ILIKE $${pi}
      )`);
      params.push(`%${search.trim()}%`);
      pi++;
    }

    const where    = conds.join(" AND ");
    const sortCol  = ALLOWED_SORT_COL.has(sortBy) ? sortBy : "created_at";
    const sortDir  = order.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const limitNum = safeInt(limit,  20, 1, 100);
    const pageNum  = safeInt(page,   1,  1, 9999);
    const offset   = (pageNum - 1) * limitNum;

    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM bookings b WHERE ${where}`, params),
      query(
        `SELECT
            b.*,
            d.name      AS destination_name,
            d.slug      AS destination_slug,
            d.image_url AS destination_image,
            c.name      AS country_name,
            s.title     AS service_name,
            u.full_name AS user_name,
            u.email     AS user_email
           FROM bookings b
           LEFT JOIN destinations d ON b.destination_id = d.id
           LEFT JOIN countries    c ON d.country_id     = c.id
           LEFT JOIN services     s ON b.service_id     = s.id
           LEFT JOIN users        u ON b.user_id        = u.id
           WHERE ${where}
           ORDER BY b.${sortCol} ${sortDir}
           LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limitNum, offset],
      ),
    ]);

    const total      = parseInt(countRes.rows[0].count, 10);
    const totalPages = Math.ceil(total / limitNum);

    return res.json({
      success: true,
      data:    dataRes.rows,
      pagination: {
        total,
        page:        pageNum,
        limit:       limitNum,
        total_pages: totalPages,
        has_next:    pageNum < totalPages,
        has_prev:    pageNum > 1,
      },
    });
  } catch (err) {
    logger.error("[Bookings] getAll failed:", err.message, err.detail || "");
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TRACK  — GET /api/bookings/track/:bookingNumber  (public)
// ═══════════════════════════════════════════════════════════════════════════════

exports.track = async (req, res, next) => {
  try {
    const { bookingNumber } = req.params;
    if (!bookingNumber)
      return res.status(400).json({ success: false, error: "Booking number required" });

    const booking = await getBookingDetail(bookingNumber, "booking_number");
    if (!booking)
      return res.status(404).json({ success: false, error: "Booking not found" });

    return res.json({
      success: true,
      data: {
        booking_number:      booking.booking_number,
        status:              booking.status,
        payment_status:      booking.payment_status,
        travel_date:         booking.travel_date,
        return_date:         booking.return_date,
        number_of_travelers: booking.number_of_travelers,
        destination:         booking.destination_name,
        service:             booking.service_name,
        country:             booking.country_name,
        created_at:          booking.created_at,
        confirmed_at:        booking.confirmed_at,
        status_message:      getStatusMessage(booking.status),
      },
    });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MY BOOKINGS  — GET /api/bookings/my-bookings  (auth user)
// ═══════════════════════════════════════════════════════════════════════════════

exports.getMyBookings = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, error: "Authentication required" });

    const { page = 1, limit = 10, status } = req.query;

    const params = [userId];
    const conds  = ["b.user_id = $1"];
    let   pi     = 2;

    if (status && Object.values(BOOKING_STATUS).includes(status)) {
      conds.push(`b.status = $${pi}`);
      params.push(status);
      pi++;
    }

    const where    = conds.join(" AND ");
    const limitNum = safeInt(limit, 10, 1, 100);
    const pageNum  = safeInt(page,  1,  1, 9999);
    const offset   = (pageNum - 1) * limitNum;

    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM bookings b WHERE ${where}`, params),
      query(
        `SELECT
            b.id, b.booking_number, b.booking_type, b.status, b.payment_status,
            b.full_name, b.email, b.phone, b.travel_date, b.return_date,
            b.flexible_dates, b.number_of_travelers, b.number_of_adults,
            b.number_of_children, b.accommodation_type, b.room_type,
            b.special_requests, b.customer_notes, b.created_at, b.updated_at,
            b.confirmed_at,
            d.name      AS destination_name,
            d.slug      AS destination_slug,
            d.image_url AS destination_image,
            c.name      AS country_name,
            c.slug      AS country_slug,
            s.title     AS service_name,
            s.slug      AS service_slug
           FROM bookings b
           LEFT JOIN destinations d ON b.destination_id = d.id
           LEFT JOIN countries    c ON d.country_id     = c.id
           LEFT JOIN services     s ON b.service_id     = s.id
           WHERE ${where}
           ORDER BY b.created_at DESC
           LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limitNum, offset],
      ),
    ]);

    const total      = parseInt(countRes.rows[0].count, 10);
    const totalPages = Math.ceil(total / limitNum);

    return res.json({
      success: true,
      data:    dataRes.rows,
      pagination: {
        total,
        page:        pageNum,
        limit:       limitNum,
        total_pages: totalPages,
        has_next:    pageNum < totalPages,
        has_prev:    pageNum > 1,
      },
    });
  } catch (err) {
    logger.error("[Bookings] getMyBookings failed:", err.message, err.detail || "");
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET STATS  — GET /api/bookings/stats  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.getStats = async (req, res, next) => {
  try {
    const period      = req.query.period === "6months" ? "6 months" : "12 months";
    const [overview, monthly, topDest, bySrc, upcoming, conversion] =
      await Promise.all([
        query(`
          SELECT
            COUNT(*)                                                         AS total_bookings,
            COUNT(*) FILTER (WHERE status = 'pending')                      AS pending,
            COUNT(*) FILTER (WHERE status = 'confirmed')                    AS confirmed,
            COUNT(*) FILTER (WHERE status = 'completed')                    AS completed,
            COUNT(*) FILTER (WHERE status = 'cancelled')                    AS cancelled,
            COUNT(*) FILTER (WHERE status = 'on-hold')                      AS on_hold,
            COUNT(*) FILTER (WHERE payment_status = 'paid')                 AS paid,
            SUM(number_of_travelers)                                        AS total_travelers,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS last_7_days,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')  AS last_30_days
          FROM bookings
        `),
        query(`
          SELECT
            TO_CHAR(created_at, 'YYYY-MM')  AS month,
            TO_CHAR(created_at, 'Mon YYYY') AS month_label,
            COUNT(*)                        AS total,
            COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed,
            COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
            SUM(number_of_travelers)        AS travelers
          FROM bookings
          WHERE created_at >= NOW() - INTERVAL '${period}'
          GROUP BY month, month_label
          ORDER BY month ASC
        `),
        query(`
          SELECT
            d.id, d.name, d.slug, d.image_url,
            COUNT(b.id)                AS booking_count,
            SUM(b.number_of_travelers) AS total_travelers
          FROM bookings b
          JOIN destinations d ON b.destination_id = d.id
          WHERE b.created_at >= NOW() - INTERVAL '3 months'
          GROUP BY d.id, d.name, d.slug, d.image_url
          ORDER BY booking_count DESC
          LIMIT 10
        `),
        query(`
          SELECT
            COALESCE(source, 'direct') AS source,
            COUNT(*) AS count
          FROM bookings
          WHERE created_at >= NOW() - INTERVAL '3 months'
          GROUP BY source
          ORDER BY count DESC
        `),
        query(`
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE travel_date BETWEEN NOW() AND NOW() + INTERVAL '7 days')  AS next_7_days,
            COUNT(*) FILTER (WHERE travel_date BETWEEN NOW() AND NOW() + INTERVAL '30 days') AS next_30_days
          FROM bookings
          WHERE status IN ('confirmed', 'pending')
            AND travel_date >= NOW()
        `),
        query(`
          SELECT
            ROUND(
              COUNT(*) FILTER (WHERE status IN ('confirmed','completed')) * 100.0 /
              NULLIF(COUNT(*), 0), 2
            ) AS conversion_rate
          FROM bookings
          WHERE created_at >= NOW() - INTERVAL '3 months'
        `),
      ]);

    return res.json({
      success: true,
      data: {
        overview:         overview.rows[0],
        monthly_trends:   monthly.rows,
        top_destinations: topDest.rows,
        by_source:        bySrc.rows,
        upcoming:         upcoming.rows[0],
        conversion_rate:  conversion.rows[0]?.conversion_rate || 0,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("[Bookings] getStats failed:", err.message);
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET ONE  — GET /api/bookings/:id  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.getOne = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1) return res.status(400).json({ success: false, error: "Invalid booking ID" });

    const booking = await getBookingDetail(id);
    if (!booking) return res.status(404).json({ success: false, error: "Booking not found" });

    let history = [];
    try {
      const h = await query(
        `SELECT action, description, created_at, admin_id
           FROM activity_log
           WHERE entity_type = 'booking' AND entity_id = $1
           ORDER BY created_at DESC LIMIT 20`,
        [id],
      );
      history = h.rows;
    } catch { /* activity_log table may not exist yet — non-fatal */ }

    return res.json({ success: true, data: { ...booking, activity_history: history } });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE  — PUT /api/bookings/:id  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.update = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;

    const existing = await query("SELECT id FROM bookings WHERE id = $1", [id]);
    if (!existing.rows[0]) return res.status(404).json({ success: false, error: "Booking not found" });

    const ALLOWED = [
      "full_name","email","phone","whatsapp","nationality","country",
      "travel_date","return_date","flexible_dates",
      "number_of_travelers","number_of_adults","number_of_children","children_ages",
      "accommodation_type","room_type","dietary_requirements",
      "special_requests","accessibility_needs",
      "travelers_details","emergency_contact",
      "admin_notes","internal_notes","customer_notes","payment_status",
    ];

    const updates = {};
    for (const f of ALLOWED) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    if (!Object.keys(updates).length)
      return res.status(400).json({ success: false, error: "No valid fields to update" });

    const errs = validateBooking(updates, true);
    if (errs.length)
      return res.status(400).json({ success: false, error: "Validation failed", details: errs });

    // Serialize JSON fields
    for (const f of ["travelers_details", "emergency_contact", "children_ages"]) {
      if (updates[f] && typeof updates[f] === "object") {
        updates[f] = JSON.stringify(updates[f]);
      }
    }

    const fields  = Object.keys(updates);
    const vals    = Object.values(updates);
    const setCl   = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");

    await query(
      `UPDATE bookings SET ${setCl}, updated_at = NOW() WHERE id = $${fields.length + 1}`,
      [...vals, id],
    );

    logActivity(id, "updated", `Fields changed: ${fields.join(", ")}`, adminId);

    const updated = await getBookingDetail(id);
    return res.json({ success: true, message: "Booking updated", data: updated });
  } catch (err) {
    logger.error("[Bookings] update failed:", err.message);
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE STATUS  — PATCH /api/bookings/:id/status  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.updateStatus = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;
    const { status, reason, notify_customer = true } = req.body;

    if (!status) return res.status(400).json({ success: false, error: "Status is required" });

    const existing = await query("SELECT * FROM bookings WHERE id = $1", [id]);
    if (!existing.rows[0]) return res.status(404).json({ success: false, error: "Booking not found" });

    const current = existing.rows[0].status;

    if (!isValidTransition(current, status)) {
      return res.status(400).json({
        success:            false,
        error:              "Invalid status transition",
        current_status:     current,
        requested_status:   status,
        allowed_transitions: STATUS_TRANSITIONS[current] || [],
      });
    }

    const params     = [status];
    let   pi         = 2;
    let   setClauses = "status = $1, updated_at = NOW()";

    if (status === "confirmed") {
      setClauses += `, confirmed_at = NOW(), confirmation_code = $${pi++}`;
      params.push(generateConfirmationCode());
    } else if (status === "cancelled") {
      setClauses += `, cancelled_at = NOW()`;
      if (reason) { setClauses += `, cancellation_reason = $${pi++}`; params.push(reason); }
    } else if (status === "completed") {
      setClauses += `, completed_at = NOW()`;
    }

    params.push(id);
    await query(`UPDATE bookings SET ${setClauses} WHERE id = $${pi} RETURNING *`, params);

    logActivity(id, `status_${status}`, `${current} → ${status}${reason ? `. Reason: ${reason}` : ""}`, adminId);

    const full = await getBookingDetail(id);

    if (notify_customer) {
      const send =
        status === "confirmed" ? sendBookingConfirmation(full) :
        status === "cancelled" ? sendBookingCancellation(full, reason) :
                                 sendBookingStatusUpdate(full, current, status);
      send.catch((e) => logger.error("[Bookings] Email notification failed:", e.message));
    }

    return res.json({ success: true, message: `Status updated to ${status}`, data: full });
  } catch (err) {
    logger.error("[Bookings] updateStatus failed:", err.message);
    next(err);
  }
};

// Shortcuts
exports.confirm = (req, res, next) => { req.body.status = "confirmed"; return exports.updateStatus(req, res, next); };
exports.cancel  = (req, res, next) => { req.body.status = "cancelled"; return exports.updateStatus(req, res, next); };

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE  — DELETE /api/bookings/:id  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.remove = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;

    const { rows } = await query(
      "SELECT id, booking_number, destination_id, service_id FROM bookings WHERE id = $1", [id],
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: "Booking not found" });

    await query("DELETE FROM bookings WHERE id = $1", [id]);

    if (rows[0].destination_id)
      query("UPDATE destinations SET booking_count = GREATEST(0,booking_count-1) WHERE id = $1", [rows[0].destination_id]).catch(() => {});
    if (rows[0].service_id)
      query("UPDATE services SET booking_count = GREATEST(0,booking_count-1) WHERE id = $1", [rows[0].service_id]).catch(() => {});

    logActivity(id, "deleted", `Booking ${rows[0].booking_number} deleted`, adminId);

    return res.json({ success: true, message: "Booking deleted" });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════════
// BULK STATUS  — POST /api/bookings/bulk-status  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.bulkUpdateStatus = async (req, res, next) => {
  try {
    const { booking_ids, status } = req.body;
    const adminId = req.admin?.id || req.user?.id || null;

    if (!Array.isArray(booking_ids) || !booking_ids.length)
      return res.status(400).json({ success: false, error: "booking_ids array required" });

    if (!Object.values(BOOKING_STATUS).includes(status))
      return res.status(400).json({ success: false, error: "Invalid status" });

    const results = { success: [], failed: [] };

    for (const bid of booking_ids) {
      try {
        const { rows } = await query("SELECT status FROM bookings WHERE id = $1", [bid]);
        if (!rows[0]) { results.failed.push({ id: bid, reason: "Not found" }); continue; }
        if (!isValidTransition(rows[0].status, status)) {
          results.failed.push({ id: bid, reason: `${rows[0].status} → ${status} not allowed` }); continue;
        }
        await query("UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2", [status, bid]);
        logActivity(bid, `bulk_${status}`, `Bulk: ${rows[0].status} → ${status}`, adminId);
        results.success.push(bid);
      } catch (e) {
        results.failed.push({ id: bid, reason: e.message });
      }
    }

    return res.json({
      success: true,
      message: `Updated ${results.success.length}/${booking_ids.length} bookings`,
      data:    results,
    });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT  — GET /api/bookings/export  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.export = async (req, res, next) => {
  try {
    const { format = "json", status, date_from, date_to } = req.query;

    const params = [];
    const conds  = ["1=1"];
    let   pi     = 1;

    if (status)    { conds.push(`b.status = $${pi}`);       params.push(status);    pi++; }
    if (date_from) { conds.push(`b.created_at >= $${pi}`);  params.push(date_from); pi++; }
    if (date_to)   { conds.push(`b.created_at <= $${pi}`);  params.push(date_to);   pi++; }

    const { rows } = await query(
      `SELECT
          b.booking_number, b.full_name, b.email, b.phone,
          b.nationality, b.travel_date, b.return_date,
          b.number_of_travelers, b.accommodation_type,
          b.special_requests, b.status, b.payment_status,
          b.created_at,
          d.name AS destination, c.name AS destination_country, s.title AS service
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id = d.id
         LEFT JOIN countries    c ON d.country_id     = c.id
         LEFT JOIN services     s ON b.service_id     = s.id
         WHERE ${conds.join(" AND ")}
         ORDER BY b.created_at DESC`,
      params,
    );

    if (format === "csv") {
      if (!rows.length) return res.status(200).send("");

      const headers = Object.keys(rows[0]);
      let csv = headers.join(",") + "\n";
      rows.forEach((row) => {
        csv += headers.map((h) => {
          const v = row[h] == null ? "" : String(row[h]);
          return /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        }).join(",") + "\n";
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=bookings-${Date.now()}.csv`);
      return res.send(csv);
    }

    return res.json({ success: true, data: rows, total: rows.length, exported_at: new Date().toISOString() });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ADD NOTES  — POST /api/bookings/:id/notes  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.addNotes = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;
    const { admin_notes, internal_notes } = req.body;

    if (!admin_notes && !internal_notes)
      return res.status(400).json({ success: false, error: "Notes content is required" });

    const sets   = [];
    const params = [];
    let   pi     = 1;

    if (admin_notes) {
      sets.push(`admin_notes = COALESCE(admin_notes,'') || E'\\n[' || TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI') || '] ' || $${pi++}`);
      params.push(admin_notes);
    }
    if (internal_notes) {
      sets.push(`internal_notes = COALESCE(internal_notes,'') || E'\\n[' || TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI') || '] ' || $${pi++}`);
      params.push(internal_notes);
    }

    params.push(id);
    const { rows } = await query(
      `UPDATE bookings SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${pi} RETURNING *`,
      params,
    );

    if (!rows[0]) return res.status(404).json({ success: false, error: "Booking not found" });

    logActivity(id, "notes_added", "Notes updated", adminId);
    return res.json({ success: true, message: "Notes added", data: rows[0] });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════════
// UPCOMING  — GET /api/bookings/upcoming  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.getUpcoming = async (req, res, next) => {
  try {
    const days  = safeInt(req.query.days,  30,  1, 365);
    const limit = safeInt(req.query.limit, 20,  1, 100);

    const { rows } = await query(
      `SELECT b.*, d.name AS destination_name, c.name AS country_name, s.title AS service_name
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id = d.id
         LEFT JOIN countries    c ON d.country_id     = c.id
         LEFT JOIN services     s ON b.service_id     = s.id
         WHERE b.status IN ('confirmed','pending')
           AND b.travel_date >= CURRENT_DATE
           AND b.travel_date <= CURRENT_DATE + $1
         ORDER BY b.travel_date ASC
         LIMIT $2`,
      [days, limit],
    );

    return res.json({ success: true, data: rows, period: `Next ${days} days` });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════════
// RECENT  — GET /api/bookings/recent  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.getRecent = async (req, res, next) => {
  try {
    const limit = safeInt(req.query.limit, 10, 1, 100);

    const { rows } = await query(
      `SELECT b.id, b.booking_number, b.full_name, b.email, b.status,
              b.travel_date, b.number_of_travelers, b.created_at,
              d.name AS destination_name, d.image_url AS destination_image,
              s.title AS service_name
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id = d.id
         LEFT JOIN services     s ON b.service_id     = s.id
         ORDER BY b.created_at DESC
         LIMIT $1`,
      [limit],
    );

    return res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MOST BOOKED  — GET /api/bookings/most-booked  (public)
// ═══════════════════════════════════════════════════════════════════════════════

exports.getMostBookedDestinations = async (req, res, next) => {
  try {
    const limit  = safeInt(req.query.limit, 10, 1, 50);
    const period = req.query.period;

    let dateFilter = "";
    if (period === "month") dateFilter = "AND b.created_at >= NOW() - INTERVAL '30 days'";
    else if (period === "year") dateFilter = "AND b.created_at >= NOW() - INTERVAL '365 days'";

    const { rows } = await query(
      `SELECT
          d.id, d.name, d.slug, d.image_url, d.short_description,
          d.difficulty,
          c.name AS country_name, c.slug AS country_slug,
          COUNT(b.id)                AS booking_count,
          SUM(b.number_of_travelers) AS total_travelers
         FROM destinations d
         LEFT JOIN bookings b ON b.destination_id = d.id ${dateFilter}
         LEFT JOIN countries c ON d.country_id = c.id
         WHERE d.is_active = true
         GROUP BY d.id, d.name, d.slug, d.image_url, d.short_description,
                  d.difficulty, c.name, c.slug
         ORDER BY booking_count DESC, total_travelers DESC
         LIMIT $1`,
      [limit],
    );

    return res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════════
// BY DESTINATION / BY COUNTRY / STATS — kept compact for brevity
// ═══════════════════════════════════════════════════════════════════════════════

exports.getBookingsByDestination = async (req, res, next) => {
  try {
    const destId = parseInt(req.params.destinationId, 10);
    if (!destId) return res.status(400).json({ success: false, error: "Invalid destination ID" });

    const period = req.query.period;
    let df = "";
    if (period === "month") df = "AND b.created_at >= NOW() - INTERVAL '30 days'";
    else if (period === "year") df = "AND b.created_at >= NOW() - INTERVAL '365 days'";

    const [destRes, statsRes] = await Promise.all([
      query(`SELECT d.*, c.name AS country_name, c.slug AS country_slug
               FROM destinations d LEFT JOIN countries c ON d.country_id = c.id
               WHERE d.id = $1`, [destId]),
      query(`SELECT
               COUNT(*) AS total_bookings,
               COUNT(*) FILTER (WHERE b.status = 'confirmed') AS confirmed,
               COUNT(*) FILTER (WHERE b.status = 'completed') AS completed,
               COUNT(*) FILTER (WHERE b.status = 'cancelled') AS cancelled,
               COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
             FROM bookings b WHERE b.destination_id = $1 ${df}`, [destId]),
    ]);

    if (!destRes.rows[0]) return res.status(404).json({ success: false, error: "Destination not found" });

    return res.json({ success: true, data: { destination: destRes.rows[0], stats: statsRes.rows[0] } });
  } catch (err) { next(err); }
};

exports.getBookingsByCountry = async (req, res, next) => {
  try {
    const cId = parseInt(req.params.countryId, 10);
    if (!cId) return res.status(400).json({ success: false, error: "Invalid country ID" });

    const period = req.query.period;
    let df = "";
    if (period === "month") df = "AND b.created_at >= NOW() - INTERVAL '30 days'";
    else if (period === "year") df = "AND b.created_at >= NOW() - INTERVAL '365 days'";

    const [cRes, sRes] = await Promise.all([
      query("SELECT id, name, slug, image_url, flag_url, continent FROM countries WHERE id = $1", [cId]),
      query(`SELECT
               COUNT(DISTINCT b.id) AS total_bookings,
               COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
             FROM bookings b
             JOIN destinations d ON b.destination_id = d.id
             WHERE d.country_id = $1 ${df}`, [cId]),
    ]);

    if (!cRes.rows[0]) return res.status(404).json({ success: false, error: "Country not found" });

    return res.json({ success: true, data: { country: cRes.rows[0], stats: sRes.rows[0] } });
  } catch (err) { next(err); }
};

exports.getCountriesBookingStats = async (req, res, next) => {
  try {
    const period = req.query.period;
    let df = "";
    if (period === "month") df = "AND b.created_at >= NOW() - INTERVAL '30 days'";
    else if (period === "year") df = "AND b.created_at >= NOW() - INTERVAL '365 days'";

    const { rows } = await query(`
      SELECT
        c.id, c.name, c.slug, c.image_url, c.flag_url, c.continent,
        COUNT(DISTINCT b.id)                        AS total_bookings,
        COUNT(DISTINCT d.id)                        AS destinations_offered,
        COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
      FROM countries c
      LEFT JOIN destinations d ON d.country_id = c.id AND d.is_active = true
      LEFT JOIN bookings b ON b.destination_id = d.id ${df}
      WHERE c.is_active = true
      GROUP BY c.id, c.name, c.slug, c.image_url, c.flag_url, c.continent
      ORDER BY total_bookings DESC
    `);

    return res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

exports.getDestinationsBookingStats = async (req, res, next) => {
  try {
    const { period, country_id, page = 1, limit = 20 } = req.query;
    let df = "";
    if (period === "month") df = "AND b.created_at >= NOW() - INTERVAL '30 days'";
    else if (period === "year") df = "AND b.created_at >= NOW() - INTERVAL '365 days'";

    const params = [];
    const conds  = ["d.is_active = true"];
    let   pi     = 1;

    if (country_id) { conds.push(`d.country_id = $${pi++}`); params.push(parseInt(country_id)); }

    const where    = conds.join(" AND ");
    const limitNum = safeInt(limit, 20, 1, 100);
    const pageNum  = safeInt(page,  1,  1, 9999);
    const offset   = (pageNum - 1) * limitNum;

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT
            d.id, d.name, d.slug, d.image_url, d.difficulty, d.rating, d.review_count,
            c.id AS country_id, c.name AS country_name, c.slug AS country_slug,
            COUNT(b.id)                                      AS total_bookings,
            COALESCE(SUM(b.number_of_travelers),0)::INTEGER  AS total_travelers
           FROM destinations d
           LEFT JOIN countries c ON d.country_id = c.id
           LEFT JOIN bookings b ON b.destination_id = d.id ${df}
           WHERE ${where}
           GROUP BY d.id, d.name, d.slug, d.image_url, d.difficulty,
                    d.rating, d.review_count, c.id, c.name, c.slug
           ORDER BY total_bookings DESC
           LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limitNum, offset],
      ),
      query(
        `SELECT COUNT(*) FROM destinations d WHERE ${where}`,
        params,
      ),
    ]);

    const total      = parseInt(countRes.rows[0].count, 10);
    const totalPages = Math.ceil(total / limitNum);

    return res.json({
      success: true,
      data:    dataRes.rows,
      pagination: { total, page: pageNum, limit: limitNum, total_pages: totalPages,
                    has_next: pageNum < totalPages, has_prev: pageNum > 1 },
    });
  } catch (err) { next(err); }
};