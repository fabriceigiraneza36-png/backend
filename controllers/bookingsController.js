// controllers/bookingsController.js
"use strict";

const crypto    = require("crypto");
const { query } = require("../config/db");
const logger    = require("../utils/logger");

/* ── Safe require: helpers ─────────────────────────────────────────────────── */
let generateBookingNumber, generateConfirmationCode, sanitizeInput;
try {
  ({ generateBookingNumber, generateConfirmationCode, sanitizeInput } =
    require("../utils/helpers"));
} catch (err) {
  logger.warn("[Bookings] helpers fallback active:", err.message);
  generateBookingNumber = () =>
    "BK-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).slice(2, 6).toUpperCase();
  generateConfirmationCode = () =>
    crypto.randomBytes(4).toString("hex").toUpperCase();
  sanitizeInput = (v) => v;
}

/* ── Safe require: email service ───────────────────────────────────────────── */
let sendBookingVerificationLink  = null;
let sendAdminBookingNotification = null;
let sendBookingConfirmation      = null;
let sendBookingStatusUpdate      = null;
let sendBookingCancellation      = null;
let sendTripCountdownEmail       = null;

const EMAIL_PATHS = [
  "../services/emailService",
  "../utils/emailService",
  "../services/email",
  "../utils/email",
];

let _emailLoaded = false;
for (const p of EMAIL_PATHS) {
  try {
    const mod = require(p);
    sendBookingVerificationLink  = mod.sendBookingVerificationLink  || null;
    sendAdminBookingNotification = mod.sendAdminBookingNotification || null;
    sendBookingConfirmation      = mod.sendBookingConfirmation      || null;
    sendBookingStatusUpdate      = mod.sendBookingStatusUpdate      || null;
    sendBookingCancellation      = mod.sendBookingCancellation      || null;
    sendTripCountdownEmail       = mod.sendTripCountdownEmail       || null;
    _emailLoaded = true;
    logger.info(`[Bookings] Email service loaded from: ${p}`);
    break;
  } catch { /* try next */ }
}
if (!_emailLoaded) {
  logger.warn("[Bookings] No email service found — emails will be skipped");
}

/* ── Safe require: notifications ───────────────────────────────────────────── */
let createNotificationInternal = async () => {};
try {
  ({ createNotificationInternal } = require("./notificationsController"));
} catch (err) {
  logger.warn("[Bookings] notificationsController not found:", err.message);
}

/* ── Safe require: socket bus (live notifications) ────────────────────────── */
let getIO = () => null;
try {
  const socketBus = require("../utils/socketBus");
  getIO = () => socketBus.getIO?.() || null;
} catch (err) {
  logger.warn("[Bookings] socketBus not found:", err.message);
}

/* ══════════════════════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════════════════════ */
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

const BOOKING_TYPES   = ["destination", "service", "custom", "package"];
const ALLOWED_SORT    = new Set(["created_at", "travel_date", "full_name", "status", "booking_number"]);
const VERIFY_EXPIRY_H = 24; // hours

/* ══════════════════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════════════════ */
const safeInt = (v, def, min = 1, max = 500) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

const isValidTransition = (from, to) =>
  (STATUS_TRANSITIONS[from] || []).includes(to);

const getStatusMessage = (status) => ({
  pending:   "Your booking is being reviewed. We will contact you within 24 hours.",
  confirmed: "Your booking has been confirmed! Check your email for details.",
  "on-hold": "Your booking is on hold. Please contact us for more information.",
  completed: "Trip completed. Thank you for traveling with us!",
  cancelled: "This booking has been cancelled.",
  refunded:  "This booking has been refunded.",
}[status] || "Unknown status");

/* ── normalizeBookingData ──────────────────────────────────────────────────── */
const normalizeBookingData = (raw) => {
  const d = { ...raw };
  const alias = (target, ...sources) => {
    if (!d[target]) for (const s of sources) if (d[s]) { d[target] = d[s]; break; }
  };

  alias("full_name",    "fullName",    "name");
  alias("email",        "emailAddress");
  alias("phone",        "phoneNumber", "telephone");
  alias("whatsapp",     "whatsappNumber");
  alias("destination_id", "destinationId", "destination");
  alias("service_id",   "serviceId",   "service");
  alias("package_id",   "packageId");
  alias("booking_type", "bookingType", "type");
  alias("travel_date",  "travelDate",  "startDate", "departureDate");
  alias("return_date",  "returnDate",  "endDate");
  alias("accommodation_type", "accommodationType", "accommodation");
  alias("room_type",    "roomType");
  alias("special_requests",    "specialRequests",   "requests");
  alias("dietary_requirements","dietaryRequirements","dietary");
  alias("accessibility_needs", "accessibilityNeeds");
  alias("customer_notes",      "customerNotes",     "notes", "message");
  alias("nationality",  "citizenship");
  alias("country",      "countryOfResidence", "residenceCountry");

  if (d.number_of_travelers === undefined) {
    for (const k of ["numberOfTravelers","travelers","guests","groupSize"])
      if (d[k] !== undefined) { d.number_of_travelers = d[k]; break; }
  }
  if (d.number_of_adults === undefined) {
    for (const k of ["numberOfAdults","adults"])
      if (d[k] !== undefined) { d.number_of_adults = d[k]; break; }
  }
  if (d.number_of_children === undefined) {
    for (const k of ["numberOfChildren","children"])
      if (d[k] !== undefined) { d.number_of_children = d[k]; break; }
  }
  if (d.flexible_dates === undefined && d.flexibleDates !== undefined)
    d.flexible_dates = d.flexibleDates;

  /* compute total from adults + children if still missing */
  if (d.number_of_travelers == null &&
      (d.number_of_adults != null || d.number_of_children != null)) {
    d.number_of_travelers =
      (parseInt(d.number_of_adults || 0, 10) || 0) +
      (parseInt(d.number_of_children || 0, 10) || 0) || 1;
  }

  if (!d.booking_type) d.booking_type = "custom";
  const bt = String(d.booking_type).toLowerCase().trim();
  d.booking_type = BOOKING_TYPES.includes(bt) ? bt : "custom";

  return d;
};

/* ── validateBooking ───────────────────────────────────────────────────────── */
const validateBooking = (data, isUpdate = false) => {
  const errors = [];
  if (!isUpdate) {
    if (!String(data.full_name || "").trim())
      errors.push({ field: "full_name", message: "Full name is required" });
    const em = String(data.email || "").trim();
    if (!em)
      errors.push({ field: "email", message: "Email is required" });
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em))
      errors.push({ field: "email", message: "Invalid email address" });
  }
  if (data.travel_date) {
    const td = new Date(data.travel_date);
    const today = new Date(); today.setHours(0,0,0,0);
    if (isNaN(td.getTime()))
      errors.push({ field: "travel_date", message: "Invalid travel date" });
    else if (td < today)
      errors.push({ field: "travel_date", message: "Travel date cannot be in the past" });
  }
  if (data.travel_date && data.return_date) {
    const td = new Date(data.travel_date), rd = new Date(data.return_date);
    if (!isNaN(td.getTime()) && !isNaN(rd.getTime()) && rd < td)
      errors.push({ field: "return_date", message: "Return date must be after travel date" });
  }
  if (data.number_of_travelers != null) {
    const n = parseInt(data.number_of_travelers, 10);
    if (!Number.isFinite(n) || n < 1 || n > 500)
      errors.push({ field: "number_of_travelers", message: "Travelers: 1–500" });
  }
  return errors;
};

/* ── logActivity ───────────────────────────────────────────────────────────── */
const logActivity = async (bookingId, action, description, adminId = null) => {
  try {
    await query(
      `INSERT INTO activity_log
         (entity_type, entity_id, action, description, admin_id, metadata, created_at)
       VALUES ('booking',$1,$2,$3,$4,$5,NOW())`,
      [bookingId, action, description, adminId,
       JSON.stringify({ ts: new Date().toISOString() })],
    );
  } catch (err) {
    logger.warn("[Bookings] logActivity non-fatal:", err.message);
  }
};

/* ── getBookingDetail ──────────────────────────────────────────────────────── */
const getBookingDetail = async (identifier, type = "id") => {
  const where = type === "id" ? "b.id=$1" : "b.booking_number=$1";
  try {
    const { rows } = await query(
      `SELECT b.*,
              d.name      AS destination_name, d.slug AS destination_slug,
              d.image_url AS destination_image,
              c.name      AS country_name,     c.slug AS country_slug,
              s.title     AS service_name,     s.slug AS service_slug,
              p.title     AS package_name,
              u.full_name AS user_name,        u.email AS user_email
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id=d.id
         LEFT JOIN countries    c ON d.country_id=c.id
         LEFT JOIN services     s ON b.service_id=s.id
         LEFT JOIN packages     p ON b.package_id=p.id
         LEFT JOIN users        u ON b.user_id=u.id
         WHERE ${where}`,
      [identifier],
    );
    return rows[0] || null;
  } catch (err) {
    logger.error("[Bookings] getBookingDetail:", err.message);
    return null;
  }
};

/* ── ensureSchemaColumns (verification + cancellation requests) ─────────────── */
const ensureSchemaColumns = async () => {
  const cols = [
    "email_verified          BOOLEAN     DEFAULT false",
    "email_verified_at       TIMESTAMPTZ",
    "verification_token      VARCHAR(128)",
    "verification_token_exp  TIMESTAMPTZ",
    /* ── Cancellation / refund requests ── */
    "cancel_request_type      VARCHAR(20)",
    "cancel_request_reason    TEXT",
    "cancel_requested_at      TIMESTAMPTZ",
    "cancel_request_status    VARCHAR(20) DEFAULT 'none'",
    "cancel_reviewed_at       TIMESTAMPTZ",
    "cancel_reviewed_by       INTEGER",
    "cancel_admin_response    TEXT",
    "refund_amount            NUMERIC(12,2)",
  ];
  for (const col of cols) {
    await query(
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ${col}`
    ).catch(() => {});
  }
  // Keep the request-status enum-like value valid
  await query(
    `UPDATE bookings SET cancel_request_status='none'
      WHERE cancel_request_status IS NULL`
  ).catch(() => {});
};
ensureSchemaColumns();

/* ══════════════════════════════════════════════════════════════════════════════
   CREATE BOOKING   POST /api/bookings
   ─ Saves booking as unverified, then emails a verification link.
   ─ Admin is NOT notified until user clicks the link.
══════════════════════════════════════════════════════════════════════════════ */
exports.create = async (req, res, next) => {
  try {
    const body   = normalizeBookingData(req.body);
    const errors = validateBooking(body);
    if (errors.length)
      return res.status(400).json({ success: false, errors });

    const bookingNumber     = generateBookingNumber();
    const verificationToken = crypto.randomBytes(48).toString("hex");
    const tokenExpiry       = new Date(Date.now() + VERIFY_EXPIRY_H * 60 * 60 * 1000);

    /* Authenticated users skip email verification */
    const emailVerified = !!req.user?.id;

    const { rows } = await query(
      `INSERT INTO bookings (
          booking_number, user_id, package_id, destination_id, service_id,
          booking_type, full_name, email, phone, whatsapp, nationality, country,
          travel_date, return_date, flexible_dates,
          number_of_travelers, number_of_adults, number_of_children,
          accommodation_type, dietary_requirements, special_requests,
          source, status,
          email_verified, verification_token, verification_token_exp,
          created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
          $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
          'pending',$23,$24,$25,NOW(),NOW()
        ) RETURNING *`,
      [
        bookingNumber,
        req.user?.id               || null,
        body.package_id            || null,
        body.destination_id        || null,
        body.service_id            || null,
        body.booking_type          || "custom",
        body.full_name,
        body.email,
        body.phone                 || null,
        body.whatsapp              || null,
        body.nationality           || null,
        body.country               || null,
        body.travel_date           || null,
        body.return_date           || null,
        body.flexible_dates        || false,
        body.number_of_travelers   || 1,
        body.number_of_adults      || 1,
        body.number_of_children    || 0,
        body.accommodation_type    || null,
        body.dietary_requirements  || null,
        body.special_requests      || null,
        body.source                || "website",
        emailVerified,
        emailVerified ? null : verificationToken,
        emailVerified ? null : tokenExpiry,
      ],
    );

    const booking = rows[0];

    if (emailVerified) {
      /* Authenticated — notify admin immediately */
      const full = await getBookingDetail(booking.id);
      if (sendAdminBookingNotification) {
        sendAdminBookingNotification(full).catch(e =>
          logger.warn("[Bookings] Admin email failed:", e.message)
        );
      }
      createNotificationInternal({
        userId:      req.user.id,
        userEmail:   req.user.email,
        type:        "booking_created",
        title:       "Booking Received! 🎉",
        message:     `Your booking ${bookingNumber} is pending review.`,
        actionUrl:   "/my-bookings",
        actionLabel: "Track Booking",
        category:    "booking",
      }).catch(() => {});
    } else {
      /* Anonymous — send verification link */
      const full = await getBookingDetail(booking.id);
      if (sendBookingVerificationLink) {
        sendBookingVerificationLink(full, verificationToken).catch(e =>
          logger.error("[Bookings] Verification link email failed:", e.message)
        );
      }
    }

    logger.info(`[Bookings] ✅ Created: ${bookingNumber} | verified=${emailVerified}`);

    return res.status(201).json({
      success:       true,
      data:          { id: booking.id, booking_number: bookingNumber },
      emailVerified,
      message:       emailVerified
        ? "Booking submitted successfully! We will contact you within 24 hours."
        : "Booking created! Please check your email and click the confirmation link to send your request to our team.",
    });
  } catch (err) {
    logger.error("[Bookings] create:", err.message);
    next(err);
  }
};

/* ══════════════════════════════════════════════════════════════════════════════
   VERIFY EMAIL   GET /api/bookings/verify-email/:token
   ─ User clicks the link in their email.
   ─ Marks booking as verified, then notifies admin.
══════════════════════════════════════════════════════════════════════════════ */
exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;
    const frontendUrl = process.env.FRONTEND_URL || "https://www.altuverasafaris.com";

    if (!token || token.length < 32) {
      return res.redirect(
        `${frontendUrl}/booking/verify?status=invalid`
      );
    }

    /* Find booking by token */
    const { rows } = await query(
      `SELECT * FROM bookings
       WHERE verification_token = $1
         AND email_verified = false
         AND verification_token_exp > NOW()
       LIMIT 1`,
      [token],
    );

    if (!rows[0]) {
      /* Could be already verified OR expired */
      const { rows: used } = await query(
        `SELECT id, email_verified FROM bookings
         WHERE verification_token = $1 LIMIT 1`,
        [token],
      );
      if (used[0]?.email_verified) {
        return res.redirect(`${frontendUrl}/booking/verify?status=already_verified`);
      }
      return res.redirect(`${frontendUrl}/booking/verify?status=expired`);
    }

    const booking = rows[0];

    /* Mark as verified */
    await query(
      `UPDATE bookings
         SET email_verified         = true,
             email_verified_at      = NOW(),
             verification_token     = NULL,
             verification_token_exp = NULL,
             updated_at             = NOW()
       WHERE id = $1`,
      [booking.id],
    );

    logger.info(`[Bookings] ✅ Email verified for booking ${booking.booking_number}`);

    /* Notify admin */
    const full = await getBookingDetail(booking.id);
    if (sendAdminBookingNotification && full) {
      sendAdminBookingNotification(full).catch(e =>
        logger.warn("[Bookings] Admin notification after verify failed:", e.message)
      );
    }

    logActivity(booking.id, "email_verified", "Customer verified email address");

    /* Redirect to success page */
    return res.redirect(
      `${frontendUrl}/booking/verify?status=success&ref=${booking.booking_number}`
    );
  } catch (err) {
    logger.error("[Bookings] verifyEmail:", err.message);
    const frontendUrl = process.env.FRONTEND_URL || "https://www.altuverasafaris.com";
    return res.redirect(`${frontendUrl}/booking/verify?status=error`);
  }
};

/* ══════════════════════════════════════════════════════════════════════════════
   RESEND VERIFICATION   POST /api/bookings/:id/resend-verification
══════════════════════════════════════════════════════════════════════════════ */
exports.resendVerification = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await query(
      `SELECT * FROM bookings WHERE id=$1 AND email_verified=false`,
      [id],
    );
    if (!rows[0])
      return res.status(404).json({
        success: false,
        error:   "Booking not found or already verified",
      });

    const newToken  = crypto.randomBytes(48).toString("hex");
    const newExpiry = new Date(Date.now() + VERIFY_EXPIRY_H * 60 * 60 * 1000);

    await query(
      `UPDATE bookings
         SET verification_token=$1, verification_token_exp=$2, updated_at=NOW()
       WHERE id=$3`,
      [newToken, newExpiry, id],
    );

    const full = await getBookingDetail(id);
    if (sendBookingVerificationLink && full) {
      await sendBookingVerificationLink(full, newToken);
    }

    return res.json({
      success: true,
      message: "Verification link resent. Please check your email.",
    });
  } catch (err) {
    logger.error("[Bookings] resendVerification:", err.message);
    next(err);
  }
};

/* ══════════════════════════════════════════════════════════════════════════════
   ADMIN CREATE   POST /api/bookings/admin
══════════════════════════════════════════════════════════════════════════════ */
exports.adminCreate = async (req, res, next) => {
  try {
    const adminId = req.admin?.id;
    const body    = normalizeBookingData(req.body);

    if (!body.user_id && body.email) {
      const { rows: u } = await query(
        "SELECT id FROM users WHERE email=$1",
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
          status, source, admin_notes,
          email_verified, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed','admin_manual',$9,true,NOW(),NOW())
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

    if (body.user_id) {
      createNotificationInternal({
        userId:      body.user_id,
        userEmail:   body.email,
        type:        "booking_created",
        title:       "New Booking Created for You",
        message:     `An admin has created booking ${bookingNumber} on your behalf.`,
        actionUrl:   "/my-bookings",
        actionLabel: "View Booking",
        priority:    "high",
        category:    "booking",
        senderType:  "admin",
        senderId:    adminId,
      }).catch(() => {});
    }

    logger.info(`[Bookings] Admin created: ${bookingNumber}`);
    return res.status(201).json({ success: true, data: booking });
  } catch (err) {
    logger.error("[Bookings] adminCreate:", err.message);
    next(err);
  }
};

/* ══════════════════════════════════════════════════════════════════════════════
   GET ALL   GET /api/bookings  (admin)
══════════════════════════════════════════════════════════════════════════════ */
exports.getAll = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 20, status, payment_status, booking_type,
      destination_id, service_id, search, date_from, date_to,
      travel_date_from, travel_date_to, email_verified,
      cancel_request_status,
      sortBy = "created_at", order = "desc",
    } = req.query;

    const params = [], conds = ["1=1"];
    let pi = 1;
    const push = (c, v) => { conds.push(c.replace("?", `$${pi++}`)); params.push(v); };

    if (status)           push("b.status=?",           status);
    if (payment_status)   push("b.payment_status=?",   payment_status);
    if (booking_type)     push("b.booking_type=?",     booking_type);
    if (destination_id)   push("b.destination_id=?",   parseInt(destination_id, 10));
    if (service_id)       push("b.service_id=?",       parseInt(service_id, 10));
    if (date_from)        push("b.created_at>=?",      date_from);
    if (date_to)          push("b.created_at<=?",      date_to);
    if (travel_date_from) push("b.travel_date>=?",     travel_date_from);
    if (travel_date_to)   push("b.travel_date<=?",     travel_date_to);
    if (email_verified !== undefined)
      push("b.email_verified=?", email_verified === "true");
    if (cancel_request_status)
      push("b.cancel_request_status=?", cancel_request_status);
    if (search) {
      const t = `%${search.trim()}%`;
      conds.push(`(b.full_name ILIKE $${pi} OR b.email ILIKE $${pi} OR b.booking_number ILIKE $${pi} OR b.phone ILIKE $${pi})`);
      params.push(t); pi++;
    }

    const where    = conds.join(" AND ");
    const sortCol  = ALLOWED_SORT.has(sortBy) ? sortBy : "created_at";
    const sortDir  = order.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const limitNum = safeInt(limit, 20, 1, 100);
    const pageNum  = safeInt(page, 1, 1, 9999);
    const offset   = (pageNum - 1) * limitNum;

    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM bookings b WHERE ${where}`, params),
      query(
        `SELECT b.*,
                d.name      AS destination_name, d.slug AS destination_slug,
                d.image_url AS destination_image,
                c.name      AS country_name,
                s.title     AS service_name,
                p.title     AS package_name,
                u.full_name AS user_name,   u.email AS user_email
           FROM bookings b
           LEFT JOIN destinations d ON b.destination_id=d.id
           LEFT JOIN countries    c ON d.country_id=c.id
           LEFT JOIN services     s ON b.service_id=s.id
           LEFT JOIN packages     p ON b.package_id=p.id
           LEFT JOIN users        u ON b.user_id=u.id
           WHERE ${where}
           ORDER BY b.${sortCol} ${sortDir}
           LIMIT $${pi} OFFSET $${pi+1}`,
        [...params, limitNum, offset],
      ),
    ]);

    const total = parseInt(countRes.rows[0].count, 10);
    return res.json({
      success: true, data: dataRes.rows,
      pagination: {
        total, page: pageNum, limit: limitNum,
        total_pages: Math.ceil(total / limitNum),
        has_next: pageNum < Math.ceil(total / limitNum),
        has_prev: pageNum > 1,
      },
    });
  } catch (err) {
    logger.error("[Bookings] getAll:", err.message);
    next(err);
  }
};

/* ══════════════════════════════════════════════════════════════════════════════
   TRACK   GET /api/bookings/track/:bookingNumber
══════════════════════════════════════════════════════════════════════════════ */
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
        email_verified:      booking.email_verified,
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
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════════
   MY BOOKINGS   GET /api/bookings/my-bookings
══════════════════════════════════════════════════════════════════════════════ */
// Replace your existing getMyBookings in backend/controllers/bookingsController.js

exports.getMyBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(100, parseInt(req.query.limit || '10', 10));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;

    let statusFilter = '';
    const params = [userId];
    let p = 2;

    if (status) {
      const statuses = status.split(',').map(s => s.trim());
      statusFilter = ` AND b.status = ANY($${p}::text[])`;
      params.push(statuses);
      p++;
    }

    params.push(limit, offset);

    const { rows } = await query(
      `SELECT
         b.*,
         COALESCE(d.name, b.destination_name)     AS destination_name,
         COALESCE(d.thumbnail_url, '')             AS destination_image,
         COALESCE(d.slug, '')                      AS destination_slug,
         COALESCE(c.name, b.country_name, '')      AS country_name,
         s.name                                    AS service_name,
         a.name                                    AS accommodation_type
       FROM bookings b
       LEFT JOIN destinations d  ON d.id  = b.destination_id
       LEFT JOIN countries    c  ON c.id  = b.country_id
                                 OR c.id  = d.country_id
       LEFT JOIN services     s  ON s.id  = b.service_id
       LEFT JOIN accommodations a ON a.id = b.accommodation_id
       WHERE b.user_id = $1
         ${statusFilter}
       ORDER BY
         CASE WHEN b.status = 'confirmed' THEN 0 ELSE 1 END,
         b.travel_date ASC NULLS LAST,
         b.created_at DESC
       LIMIT $${p++} OFFSET $${p++}`,
      params,
    ).catch(async () => {
      // Fallback without joins if tables differ
      return query(
        `SELECT * FROM bookings WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      );
    });

    const countRes = await query(
      `SELECT COUNT(*) FROM bookings WHERE user_id = $1`,
      [userId],
    );

    const total = parseInt(countRes.rows[0].count, 10);

    // Stats for dashboard
    const completed  = rows.filter(b => b.status === 'completed');
    const countries  = [...new Set(rows.map(b => b.country_name).filter(Boolean))];

    res.json({
      success:  true,
      data:     rows,
      bookings: rows,
      stats: {
        total,
        completed:        completed.length,
        countries_visited: countries.length,
        paid:   rows.filter(b => b.payment_status === 'paid').length,
        unpaid: rows.filter(b => ['unpaid','pending'].includes(b.payment_status)).length,
      },
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════════
   STATS   GET /api/bookings/stats
══════════════════════════════════════════════════════════════════════════════ */
exports.getStats = async (req, res, next) => {
  try {
    const period = req.query.period === "6months" ? "6 months" : "12 months";
    const [overview, monthly, topDest, bySrc, upcoming, conversion] =
      await Promise.all([
        query(`
          SELECT
            COUNT(*)::INTEGER                                                       AS total_bookings,
            COUNT(*) FILTER (WHERE status='pending')::INTEGER                      AS pending,
            COUNT(*) FILTER (WHERE status='confirmed')::INTEGER                    AS confirmed,
            COUNT(*) FILTER (WHERE status='completed')::INTEGER                    AS completed,
            COUNT(*) FILTER (WHERE status='cancelled')::INTEGER                    AS cancelled,
            COUNT(*) FILTER (WHERE status='on-hold')::INTEGER                      AS on_hold,
            COUNT(*) FILTER (WHERE email_verified=true)::INTEGER                   AS email_verified,
            COUNT(*) FILTER (WHERE email_verified=false)::INTEGER                  AS awaiting_verification,
            COUNT(*) FILTER (WHERE payment_status='paid')::INTEGER                 AS paid,
            COALESCE(SUM(number_of_travelers),0)::INTEGER                          AS total_travelers,
            COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '24 hours')::INTEGER AS last_24h,
            COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '7 days')::INTEGER   AS last_7_days,
            COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '30 days')::INTEGER  AS last_30_days
          FROM bookings
        `),
        query(`
          SELECT
            TO_CHAR(created_at,'YYYY-MM')  AS month,
            TO_CHAR(created_at,'Mon YYYY') AS month_label,
            COUNT(*)::INTEGER              AS total,
            COUNT(*) FILTER (WHERE status='confirmed')::INTEGER AS confirmed,
            COUNT(*) FILTER (WHERE status='completed')::INTEGER AS completed,
            COUNT(*) FILTER (WHERE status='cancelled')::INTEGER AS cancelled,
            COALESCE(SUM(number_of_travelers),0)::INTEGER       AS travelers
          FROM bookings
          WHERE created_at >= NOW() - INTERVAL '${period}'
          GROUP BY month, month_label ORDER BY month ASC
        `),
        query(`
          SELECT d.id, d.name, d.slug, d.image_url,
                 COUNT(b.id)::INTEGER                            AS booking_count,
                 COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
            FROM bookings b JOIN destinations d ON b.destination_id=d.id
            WHERE b.created_at>=NOW()-INTERVAL '3 months'
            GROUP BY d.id,d.name,d.slug,d.image_url
            ORDER BY booking_count DESC LIMIT 10
        `),
        query(`
          SELECT COALESCE(source,'direct') AS source, COUNT(*)::INTEGER AS count
            FROM bookings WHERE created_at>=NOW()-INTERVAL '3 months'
            GROUP BY source ORDER BY count DESC
        `),
        query(`
          SELECT
            COUNT(*)::INTEGER AS total,
            COUNT(*) FILTER (WHERE travel_date BETWEEN NOW() AND NOW()+INTERVAL '7 days')::INTEGER  AS next_7_days,
            COUNT(*) FILTER (WHERE travel_date BETWEEN NOW() AND NOW()+INTERVAL '30 days')::INTEGER AS next_30_days
          FROM bookings WHERE status IN ('confirmed','pending') AND travel_date>=NOW()
        `),
        query(`
          SELECT ROUND(
            COUNT(*) FILTER (WHERE status IN ('confirmed','completed')) * 100.0 /
            NULLIF(COUNT(*),0),2
          ) AS conversion_rate
          FROM bookings WHERE created_at>=NOW()-INTERVAL '3 months'
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
    logger.error("[Bookings] getStats:", err.message);
    next(err);
  }
};

/* ══════════════════════════════════════════════════════════════════════════════
   GET ONE   GET /api/bookings/:id
══════════════════════════════════════════════════════════════════════════════ */
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
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════════
   UPDATE   PUT /api/bookings/:id
══════════════════════════════════════════════════════════════════════════════ */
exports.update = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;

    const { rows: ex } = await query("SELECT id FROM bookings WHERE id=$1", [id]);
    if (!ex[0]) return res.status(404).json({ success: false, error: "Booking not found" });

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
    for (const f of ALLOWED) if (req.body[f] !== undefined) updates[f] = req.body[f];
    if (!Object.keys(updates).length)
      return res.status(400).json({ success: false, error: "No valid fields to update" });

    const errs = validateBooking(updates, true);
    if (errs.length)
      return res.status(400).json({ success: false, errors: errs });

    for (const f of ["travelers_details","emergency_contact","children_ages"]) {
      if (updates[f] && typeof updates[f] === "object")
        updates[f] = JSON.stringify(updates[f]);
    }

    const fields    = Object.keys(updates);
    const values    = Object.values(updates);
    const setClause = fields.map((f, i) => `${f}=$${i+1}`).join(", ");

    await query(
      `UPDATE bookings SET ${setClause}, updated_at=NOW() WHERE id=$${fields.length+1}`,
      [...values, id],
    );

    logActivity(id, "updated", `Fields: ${fields.join(", ")}`, adminId);
    const updated = await getBookingDetail(id);
    return res.json({ success: true, message: "Booking updated", data: updated });
  } catch (err) {
    logger.error("[Bookings] update:", err.message);
    next(err);
  }
};

/* ══════════════════════════════════════════════════════════════════════════════
   UPDATE STATUS   PATCH /api/bookings/:id/status
══════════════════════════════════════════════════════════════════════════════ */
exports.updateStatus = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;
    const { status, reason, notify_customer = true } = req.body;

    if (!status)
      return res.status(400).json({ success: false, error: "Status is required" });
    if (!Object.values(BOOKING_STATUS).includes(status))
      return res.status(400).json({ success: false, error: "Invalid status value" });

    const { rows: ex } = await query("SELECT * FROM bookings WHERE id=$1", [id]);
    if (!ex[0]) return res.status(404).json({ success: false, error: "Booking not found" });

    const current = ex[0].status;
    if (!isValidTransition(current, status)) {
      return res.status(400).json({
        success: false, error: "Invalid status transition",
        current_status: current, requested_status: status,
        allowed_transitions: STATUS_TRANSITIONS[current] || [],
      });
    }

    const params = [status];
    let pi = 2, setClause = "status=$1, updated_at=NOW()";

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

    logActivity(id, `status_${status}`,
      `${current} → ${status}${reason ? `. Reason: ${reason}` : ""}`, adminId);

    const full = await getBookingDetail(id);

    /* Customer email */
    if (notify_customer && full?.email) {
      const emailFn =
        status === "confirmed" ? sendBookingConfirmation?.(full) :
        status === "cancelled" ? sendBookingCancellation?.(full, reason) :
        sendBookingStatusUpdate?.(full, current, status, reason);

      if (emailFn) emailFn.catch(e =>
        logger.warn("[Bookings] Status email failed:", e.message)
      );
    }

    /* In-app notification */
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
      }).catch(() => {});
    }

    return res.json({ success: true, message: `Status updated to ${status}`, data: full });
  } catch (err) {
    logger.error("[Bookings] updateStatus:", err.message);
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

/* ══════════════════════════════════════════════════════════════════════════════
   DAILY COUNTDOWN SCHEDULER
   Call this once from server.js: bookingsController.startCountdownScheduler()
   Or run it via a CRON job hitting POST /api/bookings/send-countdowns (admin).
══════════════════════════════════════════════════════════════════════════════ */
exports.sendCountdownEmails = async (req, res, next) => {
  try {
    /* Find all confirmed bookings with a future travel date */
    const { rows } = await query(
      `SELECT b.*,
              d.name AS destination_name,
              c.name AS country_name,
              s.title AS service_name,
              p.title AS package_name
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id=d.id
         LEFT JOIN countries    c ON d.country_id=c.id
         LEFT JOIN services     s ON b.service_id=s.id
         LEFT JOIN packages     p ON b.package_id=p.id
         WHERE b.status='confirmed'
           AND b.travel_date >= CURRENT_DATE
           AND b.email IS NOT NULL`,
    );

    let sent = 0, skipped = 0, failed = 0;

    for (const booking of rows) {
      if (!sendTripCountdownEmail) { skipped++; continue; }
      try {
        const result = await sendTripCountdownEmail(booking);
        if (result?.success) sent++;
        else skipped++;
      } catch (e) {
        failed++;
        logger.warn(`[Bookings] Countdown email failed for ${booking.booking_number}:`, e.message);
      }
    }

    logger.info(`[Bookings] Countdown run: sent=${sent} skipped=${skipped} failed=${failed}`);

    if (res) {
      return res.json({
        success: true,
        message: `Countdown emails processed`,
        stats:   { total: rows.length, sent, skipped, failed },
      });
    }
  } catch (err) {
    logger.error("[Bookings] sendCountdownEmails:", err.message);
    if (next) next(err);
  }
};

/* Auto-start daily scheduler if running in production */
if (process.env.NODE_ENV === "production") {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  /* Run once at server start (after a 5-min warm-up), then every 24h */
  setTimeout(() => {
    exports.sendCountdownEmails(null, null, (err) => {
      if (err) logger.warn("[Bookings] Startup countdown run failed:", err.message);
    });
    setInterval(() => {
      exports.sendCountdownEmails(null, null, (err) => {
        if (err) logger.warn("[Bookings] Daily countdown run failed:", err.message);
      });
    }, TWENTY_FOUR_HOURS).unref();
  }, 5 * 60 * 1000).unref();
}

/* ══════════════════════════════════════════════════════════════════════════════
   DELETE   DELETE /api/bookings/:id
══════════════════════════════════════════════════════════════════════════════ */
exports.remove = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;

    const { rows } = await query(
      `SELECT id, booking_number, user_id, email, destination_id, service_id
         FROM bookings WHERE id=$1`,
      [id],
    );
    if (!rows[0])
      return res.status(404).json({ success: false, error: "Booking not found" });

    const b = rows[0];
    await query("DELETE FROM bookings WHERE id=$1", [id]);

    if (b.destination_id)
      query("UPDATE destinations SET booking_count=GREATEST(0,booking_count-1) WHERE id=$1",
        [b.destination_id]).catch(() => {});
    if (b.service_id)
      query("UPDATE services SET booking_count=GREATEST(0,booking_count-1) WHERE id=$1",
        [b.service_id]).catch(() => {});

    if (b.user_id) {
      createNotificationInternal({
        userId:     b.user_id,
        userEmail:  b.email,
        type:       "booking_deleted",
        title:      "Booking Removed",
        message:    `Your booking ${b.booking_number} has been removed.`,
        priority:   "urgent",
        category:   "booking",
        senderType: "admin",
        senderId:   adminId,
      }).catch(() => {});
    }

    logActivity(id, "deleted", `Booking ${b.booking_number} deleted`, adminId);
    return res.json({ success: true, message: "Booking deleted successfully" });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════════
   BULK STATUS UPDATE   POST /api/bookings/bulk-status
══════════════════════════════════════════════════════════════════════════════ */
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
          results.failed.push({ id: bid, reason: `Transition ${rows[0].status}→${status} not allowed` });
          continue;
        }
        await query("UPDATE bookings SET status=$1, updated_at=NOW() WHERE id=$2", [status, bid]);
        logActivity(bid, `bulk_${status}`, `Bulk: ${rows[0].status}→${status}`, adminId);
        results.success.push(bid);
      } catch (e) { results.failed.push({ id: bid, reason: e.message }); }
    }

    return res.json({
      success: true,
      message: `Updated ${results.success.length} of ${booking_ids.length} bookings`,
      data:    results,
    });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════════
   EXPORT   GET /api/bookings/export
══════════════════════════════════════════════════════════════════════════════ */
exports.export = async (req, res, next) => {
  try {
    const { format = "json", status, date_from, date_to } = req.query;
    const params = [], conds = ["1=1"];
    let pi = 1;
    if (status)    { conds.push(`b.status=$${pi++}`);      params.push(status);    }
    if (date_from) { conds.push(`b.created_at>=$${pi++}`); params.push(date_from); }
    if (date_to)   { conds.push(`b.created_at<=$${pi++}`); params.push(date_to);   }

    const { rows } = await query(
      `SELECT b.booking_number, b.full_name, b.email, b.phone, b.nationality,
              b.travel_date, b.return_date, b.number_of_travelers,
              b.accommodation_type, b.special_requests, b.email_verified,
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
      if (!rows.length) { res.setHeader("Content-Type","text/csv"); return res.status(200).send(""); }
      const headers = Object.keys(rows[0]);
      let csv = headers.join(",") + "\n";
      for (const row of rows) {
        csv += headers.map(h => {
          const v = row[h] == null ? "" : String(row[h]);
          return /[,"\n\r]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v;
        }).join(",") + "\n";
      }
      res.setHeader("Content-Type","text/csv; charset=utf-8");
      res.setHeader("Content-Disposition",`attachment; filename="altuvera-bookings-${Date.now()}.csv"`);
      return res.send(csv);
    }

    return res.json({ success: true, data: rows, total: rows.length, exported_at: new Date().toISOString() });
  } catch (err) {
    logger.error("[Bookings] export:", err.message);
    next(err);
  }
};

/* ══════════════════════════════════════════════════════════════════════════════
   ADD NOTES   POST /api/bookings/:id/notes
══════════════════════════════════════════════════════════════════════════════ */
exports.addNotes = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;
    const { admin_notes, internal_notes } = req.body;

    if (!admin_notes && !internal_notes)
      return res.status(400).json({ success: false, error: "At least one note field required" });

    const sets = [], params = [];
    let pi = 1;
    const TS = "TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI')";

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

    if (!rows[0]) return res.status(404).json({ success: false, error: "Booking not found" });
    logActivity(id, "notes_added", "Notes updated", adminId);
    return res.json({ success: true, message: "Notes added", data: rows[0] });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════════
   UPCOMING / RECENT / MOST-BOOKED / BY-DEST / BY-COUNTRY / STATS
══════════════════════════════════════════════════════════════════════════════ */
exports.getUpcoming = async (req, res, next) => {
  try {
    const days  = safeInt(req.query.days, 30, 1, 365);
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
         ORDER BY b.travel_date ASC LIMIT $2`,
      [days, limit],
    );
    return res.json({ success: true, data: rows, period: `Next ${days} days` });
  } catch (err) { next(err); }
};

exports.getRecent = async (req, res, next) => {
  try {
    const limit = safeInt(req.query.limit, 10, 1, 100);
    const { rows } = await query(
      `SELECT b.id, b.booking_number, b.booking_type, b.full_name, b.email,
              b.status, b.payment_status, b.email_verified,
              b.travel_date, b.number_of_travelers, b.created_at,
              d.name AS destination_name, d.image_url AS destination_image,
              s.title AS service_name, p.title AS package_name
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id=d.id
         LEFT JOIN services     s ON b.service_id=s.id
         LEFT JOIN packages     p ON b.package_id=p.id
         ORDER BY b.created_at DESC LIMIT $1`,
      [limit],
    );
    return res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

exports.getMostBookedDestinations = async (req, res, next) => {
  try {
    const limit  = safeInt(req.query.limit, 10, 1, 50);
    const period = req.query.period;
    const df = period === "month" ? "AND b.created_at>=NOW()-INTERVAL '30 days'" :
               period === "year"  ? "AND b.created_at>=NOW()-INTERVAL '365 days'" : "";
    const { rows } = await query(
      `SELECT d.id, d.name, d.slug, d.image_url, d.short_description, d.difficulty,
              c.name AS country_name, c.slug AS country_slug,
              COUNT(b.id)::INTEGER                            AS booking_count,
              COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
         FROM destinations d
         LEFT JOIN bookings b ON b.destination_id=d.id ${df}
         LEFT JOIN countries c ON d.country_id=c.id
         WHERE d.is_active=true
         GROUP BY d.id,d.name,d.slug,d.image_url,d.short_description,d.difficulty,c.name,c.slug
         ORDER BY booking_count DESC, total_travelers DESC LIMIT $1`,
      [limit],
    );
    return res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

exports.getBookingsByDestination = async (req, res, next) => {
  try {
    const destId = parseInt(req.params.destinationId, 10);
    if (!destId || destId < 1)
      return res.status(400).json({ success: false, error: "Invalid destination ID" });
    const period = req.query.period;
    const df = period === "month" ? "AND b.created_at>=NOW()-INTERVAL '30 days'" :
               period === "year"  ? "AND b.created_at>=NOW()-INTERVAL '365 days'" : "";
    const [destRes, statsRes] = await Promise.all([
      query(`SELECT d.*,c.name AS country_name,c.slug AS country_slug
               FROM destinations d LEFT JOIN countries c ON d.country_id=c.id WHERE d.id=$1`, [destId]),
      query(`SELECT COUNT(*)::INTEGER AS total_bookings,
                    COUNT(*) FILTER (WHERE b.status='confirmed')::INTEGER AS confirmed,
                    COUNT(*) FILTER (WHERE b.status='completed')::INTEGER AS completed,
                    COUNT(*) FILTER (WHERE b.status='cancelled')::INTEGER AS cancelled,
                    COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
               FROM bookings b WHERE b.destination_id=$1 ${df}`, [destId]),
    ]);
    if (!destRes.rows[0])
      return res.status(404).json({ success: false, error: "Destination not found" });
    return res.json({ success: true, data: { destination: destRes.rows[0], stats: statsRes.rows[0] } });
  } catch (err) { next(err); }
};

exports.getBookingsByCountry = async (req, res, next) => {
  try {
    const countryId = parseInt(req.params.countryId, 10);
    if (!countryId || countryId < 1)
      return res.status(400).json({ success: false, error: "Invalid country ID" });
    const period = req.query.period;
    const df = period === "month" ? "AND b.created_at>=NOW()-INTERVAL '30 days'" :
               period === "year"  ? "AND b.created_at>=NOW()-INTERVAL '365 days'" : "";
    const [cRes, sRes] = await Promise.all([
      query(`SELECT id,name,slug,image_url,flag_url,continent FROM countries WHERE id=$1`, [countryId]),
      query(`SELECT COUNT(DISTINCT b.id)::INTEGER AS total_bookings,
                    COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
               FROM bookings b JOIN destinations d ON b.destination_id=d.id
               WHERE d.country_id=$1 ${df}`, [countryId]),
    ]);
    if (!cRes.rows[0])
      return res.status(404).json({ success: false, error: "Country not found" });
    return res.json({ success: true, data: { country: cRes.rows[0], stats: sRes.rows[0] } });
  } catch (err) { next(err); }
};

exports.getCountriesBookingStats = async (req, res, next) => {
  try {
    const period = req.query.period;
    const df = period === "month" ? "AND b.created_at>=NOW()-INTERVAL '30 days'" :
               period === "year"  ? "AND b.created_at>=NOW()-INTERVAL '365 days'" : "";
    const { rows } = await query(`
      SELECT c.id,c.name,c.slug,c.image_url,c.flag_url,c.continent,
             COUNT(DISTINCT b.id)::INTEGER AS total_bookings,
             COUNT(DISTINCT d.id)::INTEGER AS destinations_offered,
             COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
        FROM countries c
        LEFT JOIN destinations d ON d.country_id=c.id AND d.is_active=true
        LEFT JOIN bookings b ON b.destination_id=d.id ${df}
        WHERE c.is_active=true
        GROUP BY c.id,c.name,c.slug,c.image_url,c.flag_url,c.continent
        ORDER BY total_bookings DESC
    `);
    return res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

exports.getDestinationsBookingStats = async (req, res, next) => {
  try {
    const { period, country_id, page = 1, limit = 20 } = req.query;
    const df = period === "month" ? "AND b.created_at>=NOW()-INTERVAL '30 days'" :
               period === "year"  ? "AND b.created_at>=NOW()-INTERVAL '365 days'" : "";
    const params = [], conds = ["d.is_active=true"];
    let pi = 1;
    if (country_id) { conds.push(`d.country_id=$${pi++}`); params.push(parseInt(country_id,10)); }
    const where    = conds.join(" AND ");
    const limitNum = safeInt(limit, 20, 1, 100);
    const pageNum  = safeInt(page, 1, 1, 9999);
    const offset   = (pageNum - 1) * limitNum;

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT d.id,d.name,d.slug,d.image_url,d.difficulty,d.rating,d.review_count,
                c.id AS country_id,c.name AS country_name,c.slug AS country_slug,
                COUNT(b.id)::INTEGER AS total_bookings,
                COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
           FROM destinations d
           LEFT JOIN countries c ON d.country_id=c.id
           LEFT JOIN bookings  b ON b.destination_id=d.id ${df}
           WHERE ${where}
           GROUP BY d.id,d.name,d.slug,d.image_url,d.difficulty,d.rating,d.review_count,c.id,c.name,c.slug
           ORDER BY total_bookings DESC
           LIMIT $${pi} OFFSET $${pi+1}`,
        [...params, limitNum, offset],
      ),
      query(`SELECT COUNT(*) FROM destinations d WHERE ${where}`, params),
    ]);

    const total = parseInt(countRes.rows[0].count, 10);
    return res.json({
      success: true, data: dataRes.rows,
      pagination: {
        total, page: pageNum, limit: limitNum,
        total_pages: Math.ceil(total / limitNum),
        has_next: pageNum < Math.ceil(total / limitNum),
        has_prev: pageNum > 1,
      },
    });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════════
   CANCELLATION / REFUND REQUESTS
   ─ Users request cancellation or refund on an eligible booking.
   ─ Admins review (approve / reject) with an optional response + refund amount.
   ══════════════════════════════════════════════════════════════════════════════ */
const CANCEL_REQUEST_STATUS = {
  NONE:     "none",
  PENDING:  "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const isEligibleForRequest = (booking, type) => {
  const status = booking.status;
  if (type === "cancellation")
    return ["pending", "confirmed", "on-hold"].includes(status);
  if (type === "refund")
    return ["confirmed", "completed"].includes(status);
  return false;
};

exports.requestCancellation = async (req, res, next) => {
  try {
    const id   = parseInt(req.params.id, 10);
    const user = req.user;
    const { type = "cancellation", reason = "" } = req.body || {};

    if (!["cancellation", "refund"].includes(type))
      return res.status(400).json({
        success: false, error: "type must be 'cancellation' or 'refund'",
      });
    if (!String(reason || "").trim())
      return res.status(400).json({
        success: false, error: "Please provide a reason for your request.",
      });

    const { rows } = await query("SELECT * FROM bookings WHERE id=$1", [id]);
    if (!rows[0])
      return res.status(404).json({ success: false, error: "Booking not found" });

    const booking = rows[0];
    if (booking.user_id && booking.user_id !== user.id)
      return res.status(403).json({
        success: false, error: "This booking does not belong to your account.",
      });

    if (booking.cancel_request_status === CANCEL_REQUEST_STATUS.PENDING)
      return res.status(409).json({
        success: false,
        error: "You already have a pending request for this booking.",
        data: booking,
      });

    if (!isEligibleForRequest(booking, type))
      return res.status(409).json({
        success: false,
        error: `This booking (status: ${booking.status}) is not eligible for a ${type} request.`,
      });

    const updated = await query(
      `UPDATE bookings
         SET cancel_request_type    = $2,
             cancel_request_reason  = $3,
             cancel_requested_at    = NOW(),
             cancel_request_status  = $4,
             cancel_admin_response  = NULL,
             cancel_reviewed_at     = NULL,
             cancel_reviewed_by     = NULL,
             refund_amount          = NULL
       WHERE id = $1
       RETURNING *`,
      [id, type, reason.trim(), CANCEL_REQUEST_STATUS.PENDING],
    );

    const full = await getBookingDetail(id);

    logActivity(id, `cancel_request_${type}`,
      `User requested ${type}. Reason: ${reason.trim()}`, user.id);

    /* Notify all admins */
    const io = getIO();
    createNotificationInternal({
      targetScope: "role",
      targetRole:  "admin",
      type:        "booking_cancel_request",
      title:       `New ${type} request — ${booking.booking_number}`,
      message:     `${booking.full_name || "A user"} requested a ${type} for booking ${booking.booking_number}.`,
      actionUrl:   `/bookings`,
      actionLabel: "Review Request",
      category:    "booking",
      priority:    "high",
      senderType:  "user",
      senderId:    user.id,
      io,
    }).catch(() => {});

    return res.json({
      success: true,
      message: `Your ${type} request has been submitted for review.`,
      data:    full || updated.rows[0],
    });
  } catch (err) {
    logger.error("[Bookings] requestCancellation:", err.message);
    next(err);
  }
};

exports.reviewCancellation = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id || null;
    const { decision, admin_response = "", refund_amount = null } = req.body || {};

    if (!["approved", "rejected"].includes(decision))
      return res.status(400).json({
        success: false, error: "decision must be 'approved' or 'rejected'",
      });

    const { rows } = await query("SELECT * FROM bookings WHERE id=$1", [id]);
    if (!rows[0])
      return res.status(404).json({ success: false, error: "Booking not found" });

    const booking = rows[0];
    if (booking.cancel_request_status !== CANCEL_REQUEST_STATUS.PENDING)
      return res.status(409).json({
        success: false, error: "No pending request to review for this booking.",
      });

    const requestType = booking.cancel_request_type || "cancellation";

    if (decision === "rejected") {
      await query(
        `UPDATE bookings
           SET cancel_request_status = $2,
               cancel_reviewed_at    = NOW(),
               cancel_reviewed_by    = $3,
               cancel_admin_response = $4
         WHERE id = $1`,
        [id, CANCEL_REQUEST_STATUS.REJECTED, adminId, admin_response.trim() || null],
      );
      logActivity(id, "cancel_request_rejected",
        `Admin rejected ${requestType} request.${admin_response ? " Response: " + admin_response.trim() : ""}`, adminId);
    } else {
      let newStatus;
      if (requestType === "refund")
        newStatus = booking.status === "completed" ? "refunded" : "cancelled";
      else
        newStatus = "cancelled";

      const params = [newStatus, CANCEL_REQUEST_STATUS.APPROVED, adminId,
        admin_response.trim() || null, id];
      let pi = 6;
      let setClause = `status=$1, cancel_request_status=$2, cancel_reviewed_at=NOW(),
                       cancel_reviewed_by=$3, cancel_admin_response=$4, updated_at=NOW()`;
      if (newStatus === "cancelled") {
        setClause += `, cancelled_at=NOW(), cancellation_reason=$${pi++}`;
        params.splice(4, 0, booking.cancel_request_reason || `Approved ${requestType} request`);
      }
      if (requestType === "refund" && refund_amount != null) {
        setClause += `, refund_amount=$${pi++}`;
        params.push(parseFloat(refund_amount) || null);
      }
      await query(`UPDATE bookings SET ${setClause} WHERE id=$${pi}`, params);

      logActivity(id, "cancel_request_approved",
        `Admin approved ${requestType} request → ${newStatus}.${admin_response ? " Response: " + admin_response.trim() : ""}`, adminId);
    }

    const full = await getBookingDetail(id);

    /* Notify the user */
    const io = getIO();
    const approved = decision === "approved";
    createNotificationInternal({
      userId:      booking.user_id,
      userEmail:   booking.email,
      targetScope: "individual",
      type:        approved ? "booking_cancel_approved" : "booking_cancel_rejected",
      title:       approved
        ? `Your ${requestType} request was approved`
        : `Your ${requestType} request was declined`,
      message:     approved
        ? `Your ${requestType} request for booking ${booking.booking_number} has been approved.`
        : `Your ${requestType} request for booking ${booking.booking_number} was declined.${admin_response ? " Note: " + admin_response.trim() : ""}`,
      actionUrl:   "/my-bookings",
      actionLabel: "View Booking",
      category:    "booking",
      priority:    "urgent",
      senderType:  "admin",
      senderId:    adminId,
      io,
    }).catch(() => {});

    return res.json({
      success: true,
      message: `Request ${decision}.`,
      data:    full,
    });
  } catch (err) {
    logger.error("[Bookings] reviewCancellation:", err.message);
    next(err);
  }
};

exports.getCancellationRequests = async (req, res, next) => {
  try {
    const status  = req.query.status || CANCEL_REQUEST_STATUS.PENDING;
    const page    = Math.max(1, parseInt(req.query.page  || "1",  10));
    const limit   = Math.min(100, parseInt(req.query.limit || "20", 10));
    const offset  = (page - 1) * limit;

    const { rows } = await query(
      `SELECT
          b.*,
          COALESCE(d.name, b.destination_name) AS destination_name,
          COALESCE(u.full_name, b.full_name)   AS user_name,
          u.email                              AS user_email
        FROM bookings b
        LEFT JOIN destinations d ON d.id = b.destination_id
        LEFT JOIN users        u ON u.id = b.user_id
        WHERE b.cancel_request_status = $1
        ORDER BY b.cancel_requested_at ASC NULLS LAST, b.created_at DESC
        LIMIT $2 OFFSET $3`,
      [status, limit, offset],
    );

    const countRes = await query(
      `SELECT COUNT(*) FROM bookings WHERE cancel_request_status=$1`,
      [status],
    );
    const total = parseInt(countRes.rows[0].count, 10);

    res.json({
      success:  true,
      data:     rows,
      bookings: rows,
      pagination: {
        page, limit, total,
        total_pages: Math.ceil(total / limit),
        has_next: page < Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = exports;