/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BOOKINGS CONTROLLER v3.2 — Full Regeneration
 * ═══════════════════════════════════════════════════════════════════════════════
 */

"use strict";

const crypto = require("crypto");
const { query } = require("../config/db");
const {
  generateBookingNumber,
  generateConfirmationCode,
  sanitizeInput,
} = require("../utils/helpers");
const {
  sendEmail,
  sendOtpEmail,
  sendBookingConfirmation,
  sendBookingStatusUpdate,
  sendBookingCancellation,
  sendAdminBookingNotification,
} = require("../utils/email");
const logger = require("../utils/logger");
const { createNotificationInternal } = require("./notificationsController");

/* ═══════════════════════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════════════════════ */

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

const BOOKING_TYPES = ["destination", "service", "custom", "package"];

const ALLOWED_SORT_COL = new Set([
  "created_at", "travel_date", "full_name", "status", "booking_number",
]);

/* ─── OTP configuration ──────────────────────────────────────────────────── */
const OTP_EXPIRY_MS    = 10 * 60 * 1000;   // 10 minutes
const OTP_RESEND_MS    = 60 * 1000;         // 60 seconds
const OTP_MAX_ATTEMPTS = 5;
const OTP_LENGTH       = 6;

/* ─── In-memory OTP store (auto-purged every 5 min) ─────────────────────── */
const OTP_STORE = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of OTP_STORE.entries()) {
    if (now > val.expiresAt) OTP_STORE.delete(key);
  }
}, 5 * 60 * 1000);

/* ═══════════════════════════════════════════════════════════════════════════════
   PRIVATE HELPERS
═══════════════════════════════════════════════════════════════════════════════ */

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

/* ── normalizeBookingData ────────────────────────────────────────────────── */
const normalizeBookingData = (raw) => {
  const d = { ...raw };

  // Name aliases
  if (!d.full_name && d.fullName)      d.full_name = d.fullName;
  if (!d.full_name && d.name)          d.full_name = d.name;

  // Email aliases
  if (!d.email && d.emailAddress)      d.email = d.emailAddress;

  // Phone aliases
  if (!d.phone && d.phoneNumber)       d.phone = d.phoneNumber;
  if (!d.phone && d.telephone)         d.phone = d.telephone;
  if (!d.whatsapp && d.whatsappNumber) d.whatsapp = d.whatsappNumber;

  // Destination / service / package aliases
  if (!d.destination_id && d.destinationId)  d.destination_id = d.destinationId;
  if (!d.destination_id && d.destination)    d.destination_id = d.destination;
  if (!d.service_id     && d.serviceId)      d.service_id     = d.serviceId;
  if (!d.service_id     && d.service)        d.service_id     = d.service;
  if (!d.package_id     && d.packageId)      d.package_id     = d.packageId;

  // Booking type aliases
  if (!d.booking_type && d.bookingType) d.booking_type = d.bookingType;
  if (!d.booking_type && d.type)        d.booking_type = d.type;

  // Date aliases
  if (!d.travel_date && d.travelDate)      d.travel_date = d.travelDate;
  if (!d.travel_date && d.startDate)       d.travel_date = d.startDate;
  if (!d.travel_date && d.departureDate)   d.travel_date = d.departureDate;
  if (!d.return_date && d.returnDate)      d.return_date = d.returnDate;
  if (!d.return_date && d.endDate)         d.return_date = d.endDate;

  // Traveler count aliases
  if (d.number_of_travelers === undefined && d.numberOfTravelers !== undefined)
    d.number_of_travelers = d.numberOfTravelers;
  if (d.number_of_travelers === undefined && d.travelers !== undefined)
    d.number_of_travelers = d.travelers;
  if (d.number_of_travelers === undefined && d.guests !== undefined)
    d.number_of_travelers = d.guests;
  if (d.number_of_travelers === undefined && d.groupSize !== undefined)
    d.number_of_travelers = d.groupSize;

  if (d.number_of_adults === undefined && d.numberOfAdults !== undefined)
    d.number_of_adults = d.numberOfAdults;
  if (d.number_of_adults === undefined && d.adults !== undefined)
    d.number_of_adults = d.adults;

  if (d.number_of_children === undefined && d.numberOfChildren !== undefined)
    d.number_of_children = d.numberOfChildren;
  if (d.number_of_children === undefined && d.children !== undefined)
    d.number_of_children = d.children;

  // Accommodation aliases
  if (!d.accommodation_type && d.accommodationType)
    d.accommodation_type = d.accommodationType;
  if (!d.accommodation_type && d.accommodation)
    d.accommodation_type = d.accommodation;
  if (!d.room_type && d.roomType) d.room_type = d.roomType;

  // Misc aliases
  if (!d.special_requests && d.specialRequests)
    d.special_requests = d.specialRequests;
  if (!d.special_requests && d.requests)
    d.special_requests = d.requests;
  if (!d.dietary_requirements && d.dietaryRequirements)
    d.dietary_requirements = d.dietaryRequirements;
  if (!d.dietary_requirements && d.dietary)
    d.dietary_requirements = d.dietary;
  if (!d.accessibility_needs && d.accessibilityNeeds)
    d.accessibility_needs = d.accessibilityNeeds;
  if (!d.customer_notes && d.customerNotes)
    d.customer_notes = d.customerNotes;
  if (!d.customer_notes && d.notes)   d.customer_notes = d.notes;
  if (!d.customer_notes && d.message) d.customer_notes = d.message;
  if (!d.nationality && d.citizenship)      d.nationality = d.citizenship;
  if (!d.country && d.countryOfResidence)   d.country = d.countryOfResidence;
  if (!d.country && d.residenceCountry)     d.country = d.residenceCountry;
  if (d.flexible_dates === undefined && d.flexibleDates !== undefined)
    d.flexible_dates = d.flexibleDates;

  // Compute total travelers from adults + children if missing
  if (
    (d.number_of_travelers === undefined || d.number_of_travelers === null) &&
    (d.number_of_adults !== undefined || d.number_of_children !== undefined)
  ) {
    const adults   = parseInt(d.number_of_adults   || 0, 10) || 0;
    const children = parseInt(d.number_of_children || 0, 10) || 0;
    d.number_of_travelers = adults + children || 1;
  }

  // Ensure booking_type default + normalise
  if (!d.booking_type) d.booking_type = "custom";
  const bt = String(d.booking_type || "").toLowerCase().trim();
  d.booking_type = BOOKING_TYPES.includes(bt) ? bt : "custom";

  return d;
};

/* ── validateBooking ─────────────────────────────────────────────────────── */
const validateBooking = (data, isUpdate = false) => {
  const errors = [];

  if (!isUpdate) {
    const name = (data.full_name || "").toString().trim();
    if (!name)
      errors.push({ field: "full_name", message: "Full name is required" });

    const email = (data.email || "").toString().trim();
    if (!email)
      errors.push({ field: "email", message: "Email is required" });
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.push({ field: "email", message: "Invalid email address" });
  }

  if (data.travel_date) {
    const td    = new Date(data.travel_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (isNaN(td.getTime()))
      errors.push({ field: "travel_date", message: "Invalid travel date format" });
    else if (td < today)
      errors.push({ field: "travel_date", message: "Travel date cannot be in the past" });
  }

  if (data.travel_date && data.return_date) {
    const td = new Date(data.travel_date);
    const rd = new Date(data.return_date);
    if (!isNaN(td.getTime()) && !isNaN(rd.getTime()) && rd < td)
      errors.push({ field: "return_date", message: "Return date must be after travel date" });
  }

  if (data.number_of_travelers !== undefined && data.number_of_travelers !== null) {
    const n = parseInt(data.number_of_travelers, 10);
    if (!Number.isFinite(n) || n < 1 || n > 500)
      errors.push({ field: "number_of_travelers", message: "Travelers must be between 1 and 500" });
  }

  return errors;
};

/* ── logActivity — never throws ─────────────────────────────────────────── */
const logActivity = async (bookingId, action, description, adminId = null) => {
  try {
    await query(
      `INSERT INTO activity_log
         (entity_type, entity_id, action, description, admin_id, metadata, created_at)
       VALUES ('booking', $1, $2, $3, $4, $5, NOW())`,
      [
        bookingId, action, description, adminId,
        JSON.stringify({ ts: new Date().toISOString() }),
      ],
    );
  } catch (err) {
    logger.warn("[Bookings] logActivity non-fatal:", err.message);
  }
};

/* ── getBookingDetail — single booking with all JOINs ───────────────────── */
const getBookingDetail = async (identifier, type = "id") => {
  const where = type === "id" ? "b.id = $1" : "b.booking_number = $1";
  try {
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
          p.title        AS package_name,
          u.full_name    AS user_name,
          u.email        AS user_email
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id = d.id
         LEFT JOIN countries    c ON d.country_id     = c.id
         LEFT JOIN services     s ON b.service_id     = s.id
         LEFT JOIN packages     p ON b.package_id     = p.id
         LEFT JOIN users        u ON b.user_id        = u.id
         WHERE ${where}`,
      [identifier],
    );
    return rows[0] || null;
  } catch (err) {
    logger.error("[Bookings] getBookingDetail failed:", err.message);
    return null;
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   OTP — SEND    POST /api/bookings/send-otp
═══════════════════════════════════════════════════════════════════════════════ */

exports.sendOtp = async (req, res, next) => {
  try {
    const rawEmail = (req.body.email || "").toString().toLowerCase().trim();

    /* ── Validate email ── */
    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return res.status(400).json({
        success: false,
        error:   "A valid email address is required.",
      });
    }

    /* ── Enforce per-email resend cooldown ── */
    const existing = OTP_STORE.get(rawEmail);
    if (existing) {
      const elapsed = Date.now() - existing.sentAt;
      if (elapsed < OTP_RESEND_MS) {
        const wait = Math.ceil((OTP_RESEND_MS - elapsed) / 1000);
        return res.status(429).json({
          success:    false,
          error:      `Please wait ${wait} second${wait !== 1 ? "s" : ""} before requesting a new code.`,
          retryAfter: wait,
        });
      }
    }

    /* ── Generate & store OTP ── */
    const code = String(crypto.randomInt(100000, 999999));
    OTP_STORE.set(rawEmail, {
      code,
      sentAt:    Date.now(),
      expiresAt: Date.now() + OTP_EXPIRY_MS,
      attempts:  0,
      verified:  false,
    });

    /* ── Send email — own try/catch so failures return clean 500 ── */
    try {
      await sendOtpEmail({
        to:            rawEmail,
        otp:           code,
        recipientName: "",
        purpose:       "booking",
        expiryMinutes: OTP_EXPIRY_MS / 60000,
      });
    } catch (emailErr) {
      /* Remove OTP so user can retry immediately */
      OTP_STORE.delete(rawEmail);
      logger.error("[Bookings/OTP] Email delivery failed:", {
        email:   rawEmail,
        error:   emailErr.message,
        code:    emailErr.originalError?.code,
      });
      return res.status(500).json({
        success: false,
        error:   "Failed to send verification code. Please check your email address and try again.",
        detail:  process.env.NODE_ENV === "development" ? emailErr.message : undefined,
      });
    }

    logger.info(`[Bookings/OTP] Code sent → ${rawEmail}`);
    return res.json({
      success:   true,
      message:   "Verification code sent. Please check your inbox (and spam folder).",
      expiresIn: OTP_EXPIRY_MS / 1000,
    });
  } catch (err) {
    logger.error("[Bookings/OTP] sendOtp unexpected error:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   OTP — VERIFY   POST /api/bookings/verify-otp
═══════════════════════════════════════════════════════════════════════════════ */

exports.verifyOtp = async (req, res, next) => {
  try {
    const rawEmail = (req.body.email || "").toString().toLowerCase().trim();
    const rawCode  = (req.body.code  || "").toString().trim();

    if (!rawEmail || !rawCode) {
      return res.status(400).json({
        success: false,
        error:   "Email and verification code are both required.",
      });
    }

    if (rawCode.length !== OTP_LENGTH || !/^\d+$/.test(rawCode)) {
      return res.status(400).json({
        success: false,
        error:   `Code must be exactly ${OTP_LENGTH} digits.`,
      });
    }

    const record = OTP_STORE.get(rawEmail);
    if (!record) {
      return res.status(400).json({
        success: false,
        error:   "No verification code found for this email. Please request a new one.",
      });
    }

    if (Date.now() > record.expiresAt) {
      OTP_STORE.delete(rawEmail);
      return res.status(400).json({
        success: false,
        error:   "Verification code has expired. Please request a new one.",
        expired: true,
      });
    }

    record.attempts += 1;

    if (record.attempts > OTP_MAX_ATTEMPTS) {
      OTP_STORE.delete(rawEmail);
      return res.status(429).json({
        success: false,
        error:   "Too many incorrect attempts. Please request a new verification code.",
        locked:  true,
      });
    }

    if (record.code !== rawCode) {
      const remaining = Math.max(0, OTP_MAX_ATTEMPTS - record.attempts);
      return res.status(400).json({
        success:           false,
        error:             remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
          : "No attempts remaining — please request a new code.",
        attemptsRemaining: remaining,
      });
    }

    OTP_STORE.delete(rawEmail);
    logger.info(`[Bookings/OTP] ✅ Email verified: ${rawEmail}`);
    return res.json({
      success:  true,
      verified: true,
      message:  "Email address verified successfully.",
    });
  } catch (err) {
    logger.error("[Bookings/OTP] verifyOtp error:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   CREATE BOOKING   POST /api/bookings
═══════════════════════════════════════════════════════════════════════════════ */

const _createBooking = async (req, res, next) => {
  try {
    const body = normalizeBookingData(req.body);

    const errors = validateBooking(body);
    if (errors.length) {
      return res.status(400).json({ success: false, errors });
    }

    const bookingNumber = generateBookingNumber();

    const { rows } = await query(
      `INSERT INTO bookings (
          booking_number, user_id, package_id, destination_id, service_id,
          booking_type, full_name, email, phone, whatsapp, nationality, country,
          travel_date, return_date, flexible_dates,
          number_of_travelers, number_of_adults, number_of_children,
          accommodation_type, dietary_requirements, special_requests,
          source, status, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
          $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW(),NOW()
        ) RETURNING *`,
      [
        bookingNumber,
        req.user?.id                    || null,
        body.package_id                 || null,
        body.destination_id             || null,
        body.service_id                 || null,
        body.booking_type               || "custom",
        body.full_name,
        body.email,
        body.phone                      || null,
        body.whatsapp                   || null,
        body.nationality                || null,
        body.country                    || null,
        body.travel_date                || null,
        body.return_date                || null,
        body.flexible_dates             || false,
        body.number_of_travelers        || 1,
        body.number_of_adults           || 1,
        body.number_of_children         || 0,
        body.accommodation_type         || null,
        body.dietary_requirements       || null,
        body.special_requests           || null,
        body.source                     || "website",
        "pending",
      ],
    );

    const booking = rows[0];

    /* ── Fire-and-forget: admin notification email ── */
    sendAdminBookingNotification(booking).catch((e) =>
      logger.warn("[Bookings] Admin notification email failed:", e.message)
    );

    /* ── Fire-and-forget: user notification (if logged in) ── */
    if (req.user?.id) {
      createNotificationInternal({
        userId:      req.user.id,
        userEmail:   req.user.email,
        type:        "booking_created",
        title:       "Booking Received!",
        message:     `Your booking ${bookingNumber} has been received and is pending review.`,
        actionUrl:   "/my-bookings",
        actionLabel: "Track Booking",
        category:    "booking",
      }).catch((e) => logger.warn("[Bookings] Notification failed:", e.message));
    }

    return res.status(201).json({ success: true, data: booking });
  } catch (err) {
    logger.error("[Bookings] create failed:", err.message);
    next(err);
  }
};

exports.create = _createBooking;

/* ═══════════════════════════════════════════════════════════════════════════════
   ADMIN CREATE BOOKING   POST /api/bookings/admin
═══════════════════════════════════════════════════════════════════════════════ */

exports.adminCreate = async (req, res, next) => {
  try {
    const adminId = req.admin?.id;
    const body    = normalizeBookingData(req.body);

    /* Resolve user_id from email if not provided */
    if (!body.user_id && body.email) {
      const { rows: u } = await query(
        "SELECT id FROM users WHERE email = $1",
        [body.email.toLowerCase().trim()],
      );
      if (u[0]) body.user_id = u[0].id;
    }

    const errors = validateBooking(body);
    if (errors.length) return res.status(400).json({ success: false, errors });

    const bookingNumber = generateBookingNumber();

    const { rows } = await query(
      `INSERT INTO bookings (
          booking_number, user_id, full_name, email, phone,
          travel_date, return_date, number_of_travelers,
          status, source, admin_notes, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed','admin_manual',$9,NOW(),NOW())
        RETURNING *`,
      [
        bookingNumber,
        body.user_id             || null,
        body.full_name,
        body.email,
        body.phone               || null,
        body.travel_date         || null,
        body.return_date         || null,
        body.number_of_travelers || 1,
        `Created by admin ID: ${adminId}`,
      ],
    );

    const booking = rows[0];

    /* Notify the user */
    if (body.user_id) {
      createNotificationInternal({
        userId:         body.user_id,
        userEmail:      body.email,
        type:           "booking_created",
        title:          "New Booking Created for You",
        message:        `An admin has created booking ${bookingNumber} on your behalf.`,
        actionUrl:      "/my-bookings",
        actionLabel:    "View Booking",
        priority:       "high",
        category:       "booking",
        senderType:     "admin",
        senderId:       adminId,
        sendEmailNotif: true,
      }).catch((e) => logger.warn("[Bookings] Admin-create notification failed:", e.message));
    }

    return res.status(201).json({ success: true, data: booking });
  } catch (err) {
    logger.error("[Bookings] adminCreate failed:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   GET ALL   GET /api/bookings   (admin)
═══════════════════════════════════════════════════════════════════════════════ */

exports.getAll = async (req, res, next) => {
  try {
    const {
      page             = 1,
      limit            = 20,
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
      sortBy           = "created_at",
      order            = "desc",
    } = req.query;

    const params = [];
    const conds  = ["1=1"];
    let   pi     = 1;

    const push = (cond, val) => {
      conds.push(cond.replace("?", `$${pi++}`));
      params.push(val);
    };

    if (status)           push("b.status = ?",         status);
    if (payment_status)   push("b.payment_status = ?", payment_status);
    if (booking_type)     push("b.booking_type = ?",   booking_type);
    if (destination_id)   push("b.destination_id = ?", parseInt(destination_id, 10));
    if (service_id)       push("b.service_id = ?",     parseInt(service_id, 10));
    if (date_from)        push("b.created_at >= ?",    date_from);
    if (date_to)          push("b.created_at <= ?",    date_to);
    if (travel_date_from) push("b.travel_date >= ?",   travel_date_from);
    if (travel_date_to)   push("b.travel_date <= ?",   travel_date_to);

    if (search) {
      const term = `%${search.trim()}%`;
      conds.push(`(
        b.full_name      ILIKE $${pi} OR
        b.email          ILIKE $${pi} OR
        b.booking_number ILIKE $${pi} OR
        b.phone          ILIKE $${pi}
      )`);
      params.push(term);
      pi++;
    }

    const where    = conds.join(" AND ");
    const sortCol  = ALLOWED_SORT_COL.has(sortBy) ? sortBy : "created_at";
    const sortDir  = order.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const limitNum = safeInt(limit, 20, 1, 100);
    const pageNum  = safeInt(page,  1,  1, 9999);
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
            p.title     AS package_name,
            u.full_name AS user_name,
            u.email     AS user_email
           FROM bookings b
           LEFT JOIN destinations d ON b.destination_id = d.id
           LEFT JOIN countries    c ON d.country_id     = c.id
           LEFT JOIN services     s ON b.service_id     = s.id
           LEFT JOIN packages     p ON b.package_id     = p.id
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
    logger.error("[Bookings] getAll failed:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   TRACK   GET /api/bookings/track/:bookingNumber
═══════════════════════════════════════════════════════════════════════════════ */

exports.track = async (req, res, next) => {
  try {
    const { bookingNumber } = req.params;
    if (!bookingNumber?.trim())
      return res.status(400).json({ success: false, error: "Booking number required" });

    const booking = await getBookingDetail(bookingNumber.trim().toUpperCase(), "booking_number");
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
        package:             booking.package_name,
        country:             booking.country_name,
        created_at:          booking.created_at,
        confirmed_at:        booking.confirmed_at,
        status_message:      getStatusMessage(booking.status),
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   MY BOOKINGS   GET /api/bookings/my-bookings
═══════════════════════════════════════════════════════════════════════════════ */

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
      conds.push(`b.status = $${pi++}`);
      params.push(status);
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
            b.special_requests, b.customer_notes,
            b.created_at, b.updated_at, b.confirmed_at,
            d.name      AS destination_name,
            d.slug      AS destination_slug,
            d.image_url AS destination_image,
            c.name      AS country_name,
            c.slug      AS country_slug,
            s.title     AS service_name,
            s.slug      AS service_slug,
            p.title     AS package_name
           FROM bookings b
           LEFT JOIN destinations d ON b.destination_id = d.id
           LEFT JOIN countries    c ON d.country_id     = c.id
           LEFT JOIN services     s ON b.service_id     = s.id
           LEFT JOIN packages     p ON b.package_id     = p.id
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
    logger.error("[Bookings] getMyBookings failed:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   STATS   GET /api/bookings/stats
═══════════════════════════════════════════════════════════════════════════════ */

exports.getStats = async (req, res, next) => {
  try {
    const period = req.query.period === "6months" ? "6 months" : "12 months";

    const [overview, monthly, topDest, bySrc, upcoming, conversion] =
      await Promise.all([
        query(`
          SELECT
            COUNT(*)                                                           AS total_bookings,
            COUNT(*) FILTER (WHERE status = 'pending')                        AS pending,
            COUNT(*) FILTER (WHERE status = 'confirmed')                      AS confirmed,
            COUNT(*) FILTER (WHERE status = 'completed')                      AS completed,
            COUNT(*) FILTER (WHERE status = 'cancelled')                      AS cancelled,
            COUNT(*) FILTER (WHERE status = 'on-hold')                        AS on_hold,
            COUNT(*) FILTER (WHERE payment_status = 'paid')                   AS paid,
            COALESCE(SUM(number_of_travelers),0)::INTEGER                     AS total_travelers,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS last_7_days,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')  AS last_30_days
          FROM bookings
        `),
        query(`
          SELECT
            TO_CHAR(created_at,'YYYY-MM')  AS month,
            TO_CHAR(created_at,'Mon YYYY') AS month_label,
            COUNT(*)                       AS total,
            COUNT(*) FILTER (WHERE status='confirmed') AS confirmed,
            COUNT(*) FILTER (WHERE status='completed') AS completed,
            COUNT(*) FILTER (WHERE status='cancelled') AS cancelled,
            COALESCE(SUM(number_of_travelers),0)::INTEGER AS travelers
          FROM bookings
          WHERE created_at >= NOW() - INTERVAL '${period}'
          GROUP BY month, month_label
          ORDER BY month ASC
        `),
        query(`
          SELECT
            d.id, d.name, d.slug, d.image_url,
            COUNT(b.id)::INTEGER                            AS booking_count,
            COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
          FROM bookings b
          JOIN destinations d ON b.destination_id = d.id
          WHERE b.created_at >= NOW() - INTERVAL '3 months'
          GROUP BY d.id,d.name,d.slug,d.image_url
          ORDER BY booking_count DESC
          LIMIT 10
        `),
        query(`
          SELECT
            COALESCE(source,'direct') AS source,
            COUNT(*)::INTEGER         AS count
          FROM bookings
          WHERE created_at >= NOW() - INTERVAL '3 months'
          GROUP BY source
          ORDER BY count DESC
        `),
        query(`
          SELECT
            COUNT(*)::INTEGER AS total,
            COUNT(*) FILTER (WHERE travel_date BETWEEN NOW() AND NOW() + INTERVAL '7 days')::INTEGER  AS next_7_days,
            COUNT(*) FILTER (WHERE travel_date BETWEEN NOW() AND NOW() + INTERVAL '30 days')::INTEGER AS next_30_days
          FROM bookings
          WHERE status IN ('confirmed','pending') AND travel_date >= NOW()
        `),
        query(`
          SELECT
            ROUND(
              COUNT(*) FILTER (WHERE status IN ('confirmed','completed')) * 100.0 /
              NULLIF(COUNT(*),0),
            2) AS conversion_rate
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
        conversion_rate:  parseFloat(conversion.rows[0]?.conversion_rate || 0),
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("[Bookings] getStats failed:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   GET ONE   GET /api/bookings/:id
═══════════════════════════════════════════════════════════════════════════════ */

exports.getOne = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1)
      return res.status(400).json({ success: false, error: "Invalid booking ID" });

    const booking = await getBookingDetail(id);
    if (!booking)
      return res.status(404).json({ success: false, error: "Booking not found" });

    let history = [];
    try {
      const h = await query(
        `SELECT action, description, created_at, admin_id
           FROM activity_log
           WHERE entity_type='booking' AND entity_id=$1
           ORDER BY created_at DESC LIMIT 30`,
        [id],
      );
      history = h.rows;
    } catch { /* non-fatal */ }

    return res.json({ success: true, data: { ...booking, activity_history: history } });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   UPDATE   PUT /api/bookings/:id
═══════════════════════════════════════════════════════════════════════════════ */

exports.update = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;

    const { rows: existing } = await query("SELECT id FROM bookings WHERE id=$1", [id]);
    if (!existing[0])
      return res.status(404).json({ success: false, error: "Booking not found" });

    const ALLOWED_FIELDS = [
      "full_name","email","phone","whatsapp","nationality","country",
      "travel_date","return_date","flexible_dates",
      "number_of_travelers","number_of_adults","number_of_children","children_ages",
      "accommodation_type","room_type","dietary_requirements",
      "special_requests","accessibility_needs",
      "travelers_details","emergency_contact",
      "admin_notes","internal_notes","customer_notes","payment_status",
    ];

    const updates = {};
    for (const f of ALLOWED_FIELDS) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    if (!Object.keys(updates).length)
      return res.status(400).json({ success: false, error: "No valid fields to update" });

    const errs = validateBooking(updates, true);
    if (errs.length)
      return res.status(400).json({ success: false, error: "Validation failed", details: errs });

    for (const f of ["travelers_details","emergency_contact","children_ages"]) {
      if (updates[f] && typeof updates[f] === "object")
        updates[f] = JSON.stringify(updates[f]);
    }

    const fields    = Object.keys(updates);
    const values    = Object.values(updates);
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");

    await query(
      `UPDATE bookings SET ${setClause}, updated_at=NOW() WHERE id=$${fields.length + 1}`,
      [...values, id],
    );

    logActivity(id, "updated", `Fields changed: ${fields.join(", ")}`, adminId);
    const updated = await getBookingDetail(id);
    return res.json({ success: true, message: "Booking updated", data: updated });
  } catch (err) {
    logger.error("[Bookings] update failed:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   UPDATE STATUS   PATCH /api/bookings/:id/status
═══════════════════════════════════════════════════════════════════════════════ */

exports.updateStatus = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;
    const { status, reason, notify_customer = true } = req.body;

    if (!status)
      return res.status(400).json({ success: false, error: "Status is required" });

    if (!Object.values(BOOKING_STATUS).includes(status))
      return res.status(400).json({ success: false, error: "Invalid status value" });

    const { rows: existing } = await query("SELECT * FROM bookings WHERE id=$1", [id]);
    if (!existing[0])
      return res.status(404).json({ success: false, error: "Booking not found" });

    const current = existing[0].status;
    if (!isValidTransition(current, status)) {
      return res.status(400).json({
        success:             false,
        error:               "Invalid status transition",
        current_status:      current,
        requested_status:    status,
        allowed_transitions: STATUS_TRANSITIONS[current] || [],
      });
    }

    const params    = [status];
    let   pi        = 2;
    let   setClause = "status=$1, updated_at=NOW()";

    if (status === "confirmed") {
      const code = generateConfirmationCode();
      setClause += `, confirmed_at=NOW(), confirmation_code=$${pi++}`;
      params.push(code);
    } else if (status === "cancelled") {
      setClause += `, cancelled_at=NOW()`;
      if (reason) { setClause += `, cancellation_reason=$${pi++}`; params.push(reason); }
    } else if (status === "completed") {
      setClause += `, completed_at=NOW()`;
    }

    params.push(id);
    await query(`UPDATE bookings SET ${setClause} WHERE id=$${pi} RETURNING *`, params);

    logActivity(
      id, `status_${status}`,
      `${current} → ${status}${reason ? `. Reason: ${reason}` : ""}`,
      adminId,
    );

    const full = await getBookingDetail(id);

    /* Email notification to customer */
    if (notify_customer && full?.email) {
      const emailFn =
        status === "confirmed" ? sendBookingConfirmation(full) :
        status === "cancelled" ? sendBookingCancellation(full, reason) :
                                 sendBookingStatusUpdate(full, current, status, reason);

      emailFn.catch((e) => logger.warn("[Bookings] Status email failed:", e.message));
    }

    /* In-app notification to user */
    if (full?.user_id) {
      createNotificationInternal({
        userId:      full.user_id,
        userEmail:   full.email,
        type:        `booking_${status}`,
        title:       `Booking ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        message:     getStatusMessage(status),
        actionUrl:   "/my-bookings",
        actionLabel: "View Booking",
        category:    "booking",
        priority:    status === "cancelled" ? "urgent" : "normal",
        senderType:  "admin",
        senderId:    adminId,
      }).catch((e) => logger.warn("[Bookings] Status notification failed:", e.message));
    }

    return res.json({ success: true, message: `Status updated to ${status}`, data: full });
  } catch (err) {
    logger.error("[Bookings] updateStatus failed:", err.message);
    next(err);
  }
};

exports.confirm = (req, res, next) => {
  req.body.status = "confirmed";
  return exports.updateStatus(req, res, next);
};

exports.cancel = (req, res, next) => {
  req.body.status = "cancelled";
  return exports.updateStatus(req, res, next);
};

/* ═══════════════════════════════════════════════════════════════════════════════
   DELETE   DELETE /api/bookings/:id
═══════════════════════════════════════════════════════════════════════════════ */

exports.remove = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;

    const { rows } = await query(
      "SELECT id, booking_number, user_id, email, full_name, destination_id, service_id FROM bookings WHERE id=$1",
      [id],
    );
    if (!rows[0])
      return res.status(404).json({ success: false, error: "Booking not found" });

    const b = rows[0];
    await query("DELETE FROM bookings WHERE id=$1", [id]);

    /* Decrement counters — fire-and-forget */
    if (b.destination_id) {
      query(
        "UPDATE destinations SET booking_count=GREATEST(0,booking_count-1) WHERE id=$1",
        [b.destination_id],
      ).catch(() => {});
    }
    if (b.service_id) {
      query(
        "UPDATE services SET booking_count=GREATEST(0,booking_count-1) WHERE id=$1",
        [b.service_id],
      ).catch(() => {});
    }

    /* Notify user */
    if (b.user_id) {
      createNotificationInternal({
        userId:      b.user_id,
        userEmail:   b.email,
        type:        "booking_deleted",
        title:       "Booking Removed",
        message:     `Your booking ${b.booking_number} has been removed by an administrator.`,
        priority:    "urgent",
        category:    "booking",
        senderType:  "admin",
        senderId:    adminId,
      }).catch((e) => logger.warn("[Bookings] Delete notification failed:", e.message));
    }

    logActivity(id, "deleted", `Booking ${b.booking_number} permanently deleted`, adminId);
    return res.json({ success: true, message: "Booking deleted successfully" });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   BULK STATUS UPDATE   POST /api/bookings/bulk-status
═══════════════════════════════════════════════════════════════════════════════ */

exports.bulkUpdateStatus = async (req, res, next) => {
  try {
    const { booking_ids, status } = req.body;
    const adminId = req.admin?.id || req.user?.id || null;

    if (!Array.isArray(booking_ids) || !booking_ids.length)
      return res.status(400).json({ success: false, error: "booking_ids must be a non-empty array" });

    if (!Object.values(BOOKING_STATUS).includes(status))
      return res.status(400).json({ success: false, error: "Invalid status" });

    const results = { success: [], failed: [] };

    for (const bid of booking_ids) {
      try {
        const { rows } = await query("SELECT status FROM bookings WHERE id=$1", [bid]);
        if (!rows[0]) { results.failed.push({ id: bid, reason: "Not found" }); continue; }
        if (!isValidTransition(rows[0].status, status)) {
          results.failed.push({ id: bid, reason: `Transition ${rows[0].status} → ${status} not allowed` });
          continue;
        }
        await query("UPDATE bookings SET status=$1, updated_at=NOW() WHERE id=$2", [status, bid]);
        logActivity(bid, `bulk_${status}`, `Bulk: ${rows[0].status} → ${status}`, adminId);
        results.success.push(bid);
      } catch (e) {
        results.failed.push({ id: bid, reason: e.message });
      }
    }

    return res.json({
      success: true,
      message: `Updated ${results.success.length} of ${booking_ids.length} bookings`,
      data:    results,
    });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   EXPORT   GET /api/bookings/export
═══════════════════════════════════════════════════════════════════════════════ */

exports.export = async (req, res, next) => {
  try {
    const { format = "json", status, date_from, date_to } = req.query;
    const params = [];
    const conds  = ["1=1"];
    let   pi     = 1;

    if (status)    { conds.push(`b.status=$${pi++}`);      params.push(status);    }
    if (date_from) { conds.push(`b.created_at>=$${pi++}`); params.push(date_from); }
    if (date_to)   { conds.push(`b.created_at<=$${pi++}`); params.push(date_to);   }

    const { rows } = await query(
      `SELECT
          b.booking_number, b.full_name, b.email, b.phone, b.nationality,
          b.travel_date, b.return_date, b.number_of_travelers,
          b.accommodation_type, b.special_requests,
          b.status, b.payment_status, b.source, b.created_at,
          d.name AS destination, c.name AS destination_country, s.title AS service
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id=d.id
         LEFT JOIN countries    c ON d.country_id=c.id
         LEFT JOIN services     s ON b.service_id=s.id
         WHERE ${conds.join(" AND ")}
         ORDER BY b.created_at DESC`,
      params,
    );

    if (format === "csv") {
      if (!rows.length) {
        res.setHeader("Content-Type", "text/csv");
        return res.status(200).send("");
      }
      const headers = Object.keys(rows[0]);
      let csv = headers.join(",") + "\n";
      for (const row of rows) {
        csv += headers.map((h) => {
          const v = row[h] == null ? "" : String(row[h]);
          return /[,"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        }).join(",") + "\n";
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="altuvera-bookings-${Date.now()}.csv"`,
      );
      return res.send(csv);
    }

    return res.json({
      success:     true,
      data:        rows,
      total:       rows.length,
      exported_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("[Bookings] export failed:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   ADD NOTES   POST /api/bookings/:id/notes
═══════════════════════════════════════════════════════════════════════════════ */

exports.addNotes = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;
    const { admin_notes, internal_notes } = req.body;

    if (!admin_notes && !internal_notes)
      return res.status(400).json({ success: false, error: "At least one note field is required" });

    const sets   = [];
    const params = [];
    let   pi     = 1;
    const TS     = "TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI')";

    if (admin_notes) {
      sets.push(`admin_notes = COALESCE(admin_notes,'') || E'\\n[' || ${TS} || '] ' || $${pi++}`);
      params.push(admin_notes);
    }
    if (internal_notes) {
      sets.push(`internal_notes = COALESCE(internal_notes,'') || E'\\n[' || ${TS} || '] ' || $${pi++}`);
      params.push(internal_notes);
    }

    params.push(id);
    const { rows } = await query(
      `UPDATE bookings SET ${sets.join(", ")}, updated_at=NOW() WHERE id=$${pi} RETURNING *`,
      params,
    );

    if (!rows[0])
      return res.status(404).json({ success: false, error: "Booking not found" });

    logActivity(id, "notes_added", "Admin notes updated", adminId);
    return res.json({ success: true, message: "Notes added", data: rows[0] });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   UPCOMING   GET /api/bookings/upcoming
═══════════════════════════════════════════════════════════════════════════════ */

exports.getUpcoming = async (req, res, next) => {
  try {
    const days  = safeInt(req.query.days,  30, 1, 365);
    const limit = safeInt(req.query.limit, 20, 1, 100);

    const { rows } = await query(
      `SELECT b.*, d.name AS destination_name, c.name AS country_name, s.title AS service_name
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id=d.id
         LEFT JOIN countries    c ON d.country_id=c.id
         LEFT JOIN services     s ON b.service_id=s.id
         WHERE b.status IN ('confirmed','pending')
           AND b.travel_date >= CURRENT_DATE
           AND b.travel_date <= CURRENT_DATE + $1
         ORDER BY b.travel_date ASC
         LIMIT $2`,
      [days, limit],
    );

    return res.json({ success: true, data: rows, period: `Next ${days} days` });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   RECENT   GET /api/bookings/recent
═══════════════════════════════════════════════════════════════════════════════ */

exports.getRecent = async (req, res, next) => {
  try {
    const limit = safeInt(req.query.limit, 10, 1, 100);

    const { rows } = await query(
      `SELECT
          b.id, b.booking_number, b.booking_type,
          b.full_name, b.email, b.status, b.payment_status,
          b.travel_date, b.number_of_travelers, b.created_at,
          d.name      AS destination_name,
          d.image_url AS destination_image,
          s.title     AS service_name,
          p.title     AS package_name
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id=d.id
         LEFT JOIN services     s ON b.service_id=s.id
         LEFT JOIN packages     p ON b.package_id=p.id
         ORDER BY b.created_at DESC
         LIMIT $1`,
      [limit],
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   MOST BOOKED DESTINATIONS   GET /api/bookings/most-booked
═══════════════════════════════════════════════════════════════════════════════ */

exports.getMostBookedDestinations = async (req, res, next) => {
  try {
    const limit  = safeInt(req.query.limit, 10, 1, 50);
    const period = req.query.period;

    const dateFilter =
      period === "month" ? "AND b.created_at >= NOW() - INTERVAL '30 days'"  :
      period === "year"  ? "AND b.created_at >= NOW() - INTERVAL '365 days'" :
      "";

    const { rows } = await query(
      `SELECT
          d.id, d.name, d.slug, d.image_url, d.short_description, d.difficulty,
          c.name AS country_name, c.slug AS country_slug,
          COUNT(b.id)::INTEGER                            AS booking_count,
          COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
         FROM destinations d
         LEFT JOIN bookings b ON b.destination_id=d.id ${dateFilter}
         LEFT JOIN countries c ON d.country_id=c.id
         WHERE d.is_active=true
         GROUP BY d.id,d.name,d.slug,d.image_url,d.short_description,d.difficulty,c.name,c.slug
         ORDER BY booking_count DESC, total_travelers DESC
         LIMIT $1`,
      [limit],
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   BY DESTINATION   GET /api/bookings/by-destination/:destinationId
═══════════════════════════════════════════════════════════════════════════════ */

exports.getBookingsByDestination = async (req, res, next) => {
  try {
    const destId = parseInt(req.params.destinationId, 10);
    if (!destId || destId < 1)
      return res.status(400).json({ success: false, error: "Invalid destination ID" });

    const period = req.query.period;
    const df =
      period === "month" ? "AND b.created_at >= NOW() - INTERVAL '30 days'"  :
      period === "year"  ? "AND b.created_at >= NOW() - INTERVAL '365 days'" :
      "";

    const [destRes, statsRes] = await Promise.all([
      query(
        `SELECT d.*, c.name AS country_name, c.slug AS country_slug
           FROM destinations d LEFT JOIN countries c ON d.country_id=c.id
           WHERE d.id=$1`,
        [destId],
      ),
      query(
        `SELECT
            COUNT(*)::INTEGER AS total_bookings,
            COUNT(*) FILTER (WHERE b.status='confirmed')::INTEGER AS confirmed,
            COUNT(*) FILTER (WHERE b.status='completed')::INTEGER AS completed,
            COUNT(*) FILTER (WHERE b.status='cancelled')::INTEGER AS cancelled,
            COALESCE(SUM(b.number_of_travelers),0)::INTEGER       AS total_travelers
           FROM bookings b WHERE b.destination_id=$1 ${df}`,
        [destId],
      ),
    ]);

    if (!destRes.rows[0])
      return res.status(404).json({ success: false, error: "Destination not found" });

    return res.json({
      success: true,
      data: { destination: destRes.rows[0], stats: statsRes.rows[0] },
    });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   BY COUNTRY   GET /api/bookings/by-country/:countryId
═══════════════════════════════════════════════════════════════════════════════ */

exports.getBookingsByCountry = async (req, res, next) => {
  try {
    const countryId = parseInt(req.params.countryId, 10);
    if (!countryId || countryId < 1)
      return res.status(400).json({ success: false, error: "Invalid country ID" });

    const period = req.query.period;
    const df =
      period === "month" ? "AND b.created_at >= NOW() - INTERVAL '30 days'"  :
      period === "year"  ? "AND b.created_at >= NOW() - INTERVAL '365 days'" :
      "";

    const [cRes, sRes] = await Promise.all([
      query(
        "SELECT id,name,slug,image_url,flag_url,continent FROM countries WHERE id=$1",
        [countryId],
      ),
      query(
        `SELECT
            COUNT(DISTINCT b.id)::INTEGER                   AS total_bookings,
            COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
           FROM bookings b
           JOIN destinations d ON b.destination_id=d.id
           WHERE d.country_id=$1 ${df}`,
        [countryId],
      ),
    ]);

    if (!cRes.rows[0])
      return res.status(404).json({ success: false, error: "Country not found" });

    return res.json({
      success: true,
      data: { country: cRes.rows[0], stats: sRes.rows[0] },
    });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   COUNTRIES BOOKING STATS   GET /api/bookings/countries-stats
═══════════════════════════════════════════════════════════════════════════════ */

exports.getCountriesBookingStats = async (req, res, next) => {
  try {
    const period = req.query.period;
    const df =
      period === "month" ? "AND b.created_at >= NOW() - INTERVAL '30 days'"  :
      period === "year"  ? "AND b.created_at >= NOW() - INTERVAL '365 days'" :
      "";

    const { rows } = await query(`
      SELECT
        c.id, c.name, c.slug, c.image_url, c.flag_url, c.continent,
        COUNT(DISTINCT b.id)::INTEGER                   AS total_bookings,
        COUNT(DISTINCT d.id)::INTEGER                   AS destinations_offered,
        COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
      FROM countries c
      LEFT JOIN destinations d ON d.country_id=c.id AND d.is_active=true
      LEFT JOIN bookings b ON b.destination_id=d.id ${df}
      WHERE c.is_active=true
      GROUP BY c.id,c.name,c.slug,c.image_url,c.flag_url,c.continent
      ORDER BY total_bookings DESC
    `);

    return res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   DESTINATIONS BOOKING STATS   GET /api/bookings/destinations-stats
═══════════════════════════════════════════════════════════════════════════════ */

exports.getDestinationsBookingStats = async (req, res, next) => {
  try {
    const { period, country_id, page = 1, limit = 20 } = req.query;

    const df =
      period === "month" ? "AND b.created_at >= NOW() - INTERVAL '30 days'"  :
      period === "year"  ? "AND b.created_at >= NOW() - INTERVAL '365 days'" :
      "";

    const params = [];
    const conds  = ["d.is_active=true"];
    let   pi     = 1;

    if (country_id) {
      conds.push(`d.country_id=$${pi++}`);
      params.push(parseInt(country_id, 10));
    }

    const where    = conds.join(" AND ");
    const limitNum = safeInt(limit, 20, 1, 100);
    const pageNum  = safeInt(page,  1,  1, 9999);
    const offset   = (pageNum - 1) * limitNum;

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT
            d.id, d.name, d.slug, d.image_url, d.difficulty, d.rating, d.review_count,
            c.id AS country_id, c.name AS country_name, c.slug AS country_slug,
            COUNT(b.id)::INTEGER                            AS total_bookings,
            COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
           FROM destinations d
           LEFT JOIN countries c ON d.country_id=c.id
           LEFT JOIN bookings  b ON b.destination_id=d.id ${df}
           WHERE ${where}
           GROUP BY d.id,d.name,d.slug,d.image_url,d.difficulty,d.rating,
                    d.review_count,c.id,c.name,c.slug
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
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   MODULE EXPORTS
═══════════════════════════════════════════════════════════════════════════════ */

module.exports = exports;