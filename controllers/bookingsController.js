// controllers/bookingsController.js
"use strict";

const crypto = require("crypto");
const { query } = require("../config/db");
const logger = require("../utils/logger");

/* ═════════════════════════════════════════════════════════════════════
   SAFE REQUIRE: HELPERS
═════════════════════════════════════════════════════════════════════ */
let generateBookingNumber;
let generateConfirmationCode;
let sanitizeInput;

try {
  ({
    generateBookingNumber,
    generateConfirmationCode,
    sanitizeInput,
  } = require("../utils/helpers"));
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

/* ═════════════════════════════════════════════════════════════════════
   EMAIL SERVICE
═════════════════════════════════════════════════════════════════════ */
let sendBookingVerificationLink = null;
let sendBookingReceivedEmail = null;
let sendAdminBookingNotification = null;
let sendBookingConfirmation = null;
let sendBookingStatusUpdate = null;
let sendBookingCancellation = null;
let sendTripCountdownEmail = null;
let sendCancellationRequestAck = null;

try {
  const bookingEmails = require("../utils/bookingEmails");

  sendBookingVerificationLink = bookingEmails.sendBookingVerificationLink || null;
  sendBookingReceivedEmail = bookingEmails.sendBookingReceivedEmail || null;
  sendAdminBookingNotification = bookingEmails.sendAdminBookingNotification || null;
  sendBookingConfirmation = bookingEmails.sendBookingConfirmation || null;
  sendBookingStatusUpdate = bookingEmails.sendBookingStatusUpdate || null;
  sendBookingCancellation = bookingEmails.sendBookingCancellation || null;
  sendTripCountdownEmail = bookingEmails.sendTripCountdownEmail || null;
  sendCancellationRequestAck = bookingEmails.sendCancellationRequestAck || null;

  logger.info("[Bookings] ✅ bookingEmails loaded from utils/bookingEmails");
} catch (err) {
  logger.warn("[Bookings] bookingEmails not available — trying legacy paths:", err.message);

  const LEGACY_PATHS = [
    "../services/emailService",
    "../utils/emailService",
    "../services/email",
    "../utils/email",
  ];

  for (const p of LEGACY_PATHS) {
    try {
      const mod = require(p);

      sendBookingVerificationLink =
        sendBookingVerificationLink || mod.sendBookingVerificationLink || null;
      sendBookingReceivedEmail =
        sendBookingReceivedEmail || mod.sendBookingReceivedEmail || null;
      sendAdminBookingNotification =
        sendAdminBookingNotification || mod.sendAdminBookingNotification || null;
      sendBookingConfirmation =
        sendBookingConfirmation || mod.sendBookingConfirmation || null;
      sendBookingStatusUpdate =
        sendBookingStatusUpdate || mod.sendBookingStatusUpdate || null;
      sendBookingCancellation =
        sendBookingCancellation || mod.sendBookingCancellation || null;
      sendTripCountdownEmail =
        sendTripCountdownEmail || mod.sendTripCountdownEmail || null;
      sendCancellationRequestAck =
        sendCancellationRequestAck || mod.sendCancellationRequestAck || null;

      logger.info(`[Bookings] Partial email functions loaded from legacy path: ${p}`);
      break;
    } catch {
      // try next
    }
  }

  if (!sendAdminBookingNotification) {
    logger.warn("[Bookings] No email service found — booking emails may be skipped");
  }
}

/* ═════════════════════════════════════════════════════════════════════
   SAFE REQUIRE: NOTIFICATIONS / MESSAGING / SOCKET
═════════════════════════════════════════════════════════════════════ */
let createNotificationInternal = async () => null;
try {
  ({ createNotificationInternal } = require("./notificationsController"));
} catch (err) {
  logger.warn("[Bookings] notificationsController not found:", err.message);
}

let startBookingConversation = async () => null;
try {
  ({ startBookingConversation } = require("../utils/messaging"));
} catch (err) {
  logger.warn("[Bookings] messaging util not found:", err.message);
}

let getIO = () => null;
try {
  const socketBus = require("../utils/socketBus");
  getIO = () => socketBus.getIO?.() || null;
} catch (err) {
  logger.warn("[Bookings] socketBus not found:", err.message);
}

/* ═════════════════════════════════════════════════════════════════════
   CONSTANTS
═════════════════════════════════════════════════════════════════════ */
const BOOKING_STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  ON_HOLD: "on-hold",
  REFUNDED: "refunded",
};

const STATUS_TRANSITIONS = {
  pending: ["confirmed", "cancelled", "on-hold"],
  confirmed: ["completed", "cancelled", "on-hold"],
  "on-hold": ["confirmed", "cancelled", "pending"],
  completed: ["refunded"],
  cancelled: ["pending"],
  refunded: [],
};

const CANCEL_REQUEST_STATUS = {
  NONE: "none",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const BOOKING_TYPES = ["destination", "service", "custom", "package"];

const ALLOWED_SORT = new Set([
  "created_at",
  "travel_date",
  "full_name",
  "status",
  "booking_number",
]);

const VERIFY_EXPIRY_H = 24;

/* ═════════════════════════════════════════════════════════════════════
   SAFE VALUE HELPERS
═════════════════════════════════════════════════════════════════════ */
const isObj = (v) =>
  v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

const firstDefined = (...vals) => {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

/**
 * IMPORTANT:
 * This fixes the "[object Object]" issue.
 * If a frontend select sends { value, label }, we extract label/value instead
 * of letting JS convert the object into "[object Object]".
 */
const safe = (val, fallback = null) => {
  if (val === undefined || val === null) return fallback;

  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? fallback : val.toISOString();
  }

  if (Array.isArray(val)) {
    const joined = val
      .map((x) => safe(x, ""))
      .filter(Boolean)
      .join(", ");
    return joined || fallback;
  }

  if (isObj(val)) {
    const picked = firstDefined(
      val.label,
      val.name,
      val.title,
      val.text,
      val.value,
      val.id,
      val._id,
    );

    if (picked !== undefined) return safe(picked, fallback);

    try {
      const json = JSON.stringify(val);
      return json && json !== "{}" ? json : fallback;
    } catch {
      return fallback;
    }
  }

  const s = String(val).trim();
  if (!s) return fallback;

  try {
    const sanitized = sanitizeInput ? sanitizeInput(s) : s;
    return String(sanitized).trim() || fallback;
  } catch {
    return s || fallback;
  }
};

const safeText = (val, fallback = null) => safe(val, fallback);

const safeEmail = (val) => {
  const s = safe(val, null);
  return s ? s.toLowerCase().trim() : null;
};

const safeId = (val, fallback = null) => {
  if (isObj(val)) {
    val = firstDefined(val.value, val.id, val._id);
  }
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const safeInt = (v, def = null, min = 0, max = 500) => {
  if (isObj(v)) v = firstDefined(v.value, v.id, v.count, v.number);
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
};

const safeFloat = (v, def = null) => {
  if (isObj(v)) v = firstDefined(v.value, v.amount, v.price);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
};

const safeBool = (v, def = false) => {
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  const s = String(v).toLowerCase().trim();
  if (["true", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "off"].includes(s)) return false;
  return def;
};

const safeDate = (v, fallback = null) => {
  if (!v) return fallback;

  if (isObj(v)) {
    v = firstDefined(v.value, v.date, v.startDate, v.endDate, v.arrivalDate, v.departureDate);
  }

  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return fallback;

  // PostgreSQL DATE-friendly yyyy-mm-dd
  return d.toISOString().slice(0, 10);
};

const safeJson = (v, fallback = null) => {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return fallback;
  }
};

const asyncNoThrow = (promise, label) => {
  Promise.resolve(promise).catch((e) => {
    logger.warn(`[Bookings] ${label} failed:`, e.message);
  });
};

/* ═════════════════════════════════════════════════════════════════════
   BUSINESS HELPERS
═════════════════════════════════════════════════════════════════════ */
const isValidTransition = (from, to) =>
  (STATUS_TRANSITIONS[from] || []).includes(to);

const isEligibleForRequest = (booking, type) => {
  const s = booking.status;
  if (type === "cancellation") return ["pending", "confirmed", "on-hold"].includes(s);
  if (type === "refund") return ["confirmed", "completed"].includes(s);
  return false;
};

const getStatusMessage = (status) =>
  ({
    pending: "Your booking is being reviewed. We will contact you within 24 hours.",
    confirmed: "Your booking has been confirmed! Check your email for details.",
    "on-hold": "Your booking is on hold. Please contact us for more information.",
    completed: "Trip completed. Thank you for traveling with us!",
    cancelled: "This booking has been cancelled.",
    refunded: "This booking has been refunded.",
  }[status] || "Unknown status");

/* ═════════════════════════════════════════════════════════════════════
   NOTIFICATIONS
═════════════════════════════════════════════════════════════════════ */
const notifyUserBookingEvent = async ({
  user,
  booking,
  title,
  message,
  actionUrl,
  actionLabel,
  priority = "normal",
}) => {
  try {
    return await createNotificationInternal({
      userId: user?.id || null,
      userEmail: user?.email || null,
      type: "booking_created",
      category: "booking",
      title,
      message,
      actionUrl: actionUrl || "/my-bookings",
      actionLabel: actionLabel || "View Booking",
      priority,
      senderType: "admin",
      senderName: "Altuvera Team",
      metadata: { bookingNumber: booking?.booking_number || null },
    }).catch(() => null);
  } catch (err) {
    logger.warn("[Bookings] notifyUserBookingEvent:", err.message);
    return null;
  }
};

const pingAdminNewRequest = (booking) => {
  try {
    createNotificationInternal({
      targetScope: "admin",
      type: "booking_created",
      category: "booking",
      title: "🔔 New booking request",
      message: `Booking ${booking?.booking_number || ""} from ${booking?.full_name || "a traveller"}.`,
      actionUrl: "/bookings",
      actionLabel: "Review",
      priority: "high",
      metadata: { bookingNumber: booking?.booking_number || null },
    }).catch(() => {});
  } catch {
    // non-fatal
  }
};

/* ═════════════════════════════════════════════════════════════════════
   NORMALIZE BOOKING DATA
═════════════════════════════════════════════════════════════════════ */
const normalizeBookingData = (raw = {}) => {
  const d = { ...raw };

  const read = (...keys) => {
    for (const k of keys) {
      if (d[k] !== undefined && d[k] !== null && d[k] !== "") return d[k];
    }
    return undefined;
  };

  const firstName = safeText(read("firstName", "first_name"), "");
  const lastName = safeText(read("lastName", "last_name"), "");

  const fullName =
    safeText(read("full_name", "fullName", "name"), null) ||
    [firstName, lastName].filter(Boolean).join(" ").trim();

  const destinationObj = read("destination", "selectedDestination");
  const countryObj = read("country", "selectedCountry", "countryOfResidence", "residenceCountry");

  const destinationId = safeId(
    read("destination_id", "destinationId", "destinationID") ??
      (isObj(destinationObj) ? firstDefined(destinationObj.value, destinationObj.id, destinationObj._id) : undefined),
  );

  const countryId = safeId(
    read("country_id", "countryId", "countryID") ??
      (isObj(countryObj) ? firstDefined(countryObj.value, countryObj.id, countryObj._id) : undefined),
  );

  const serviceId = safeId(read("service_id", "serviceId", "service"));
  const packageId = safeId(read("package_id", "packageId", "package"));

  const destinationName =
    safeText(read("destination_name", "destinationName"), null) ||
    (isObj(destinationObj) ? safeText(destinationObj.label || destinationObj.name || destinationObj.title, null) : null) ||
    (!destinationId ? safeText(destinationObj, null) : null);

  const countryName =
    safeText(read("country_name", "countryName"), null) ||
    (isObj(countryObj) ? safeText(countryObj.label || countryObj.name || countryObj.title, null) : null) ||
    (!countryId ? safeText(countryObj, null) : null);

  // New frontend date fields:
  // arrivalDate = start/travel date
  // departureDate = return/end date
  const travelDate = safeDate(
    read("travel_date", "travelDate", "arrivalDate", "startDate", "date"),
  );

  const returnDate = safeDate(
    read("return_date", "returnDate", "departureDate", "endDate"),
  );

  const adults = safeInt(read("number_of_adults", "numberOfAdults", "adults"), 1, 0, 500);
  const children = safeInt(read("number_of_children", "numberOfChildren", "children"), 0, 0, 500);

  const travelerCount =
    safeInt(read("number_of_travelers", "numberOfTravelers", "travelers", "guests", "groupSize"), null, 1, 500) ||
    Math.max(1, adults + children);

  let bookingType = safeText(read("booking_type", "bookingType", "type"), "custom").toLowerCase();
  if (!BOOKING_TYPES.includes(bookingType)) bookingType = "custom";

  return {
    user_id: safeId(read("user_id", "userId")),
    package_id: packageId,
    destination_id: destinationId,
    service_id: serviceId,
    country_id: countryId,

    booking_type: bookingType,

    full_name: safeText(fullName, ""),
    email: safeEmail(read("email", "emailAddress")),
    phone: safeText(read("phone", "phoneNumber", "telephone"), null),
    whatsapp: safeText(read("whatsapp", "whatsappNumber"), null),

    nationality: safeText(read("nationality", "citizenship"), null),
    country: countryName,
    destination_name: destinationName,
    country_name: countryName,

    travel_date: travelDate,
    return_date: returnDate,

    flexible_dates: safeBool(read("flexible_dates", "flexibleDates", "isFlexible"), false),
    flexible_months: Array.isArray(d.flexibleMonths)
      ? JSON.stringify(d.flexibleMonths)
      : safeText(read("flexible_months", "flexibleMonths"), null),

    number_of_travelers: travelerCount,
    number_of_adults: adults,
    number_of_children: children,

    accommodation_type: safeText(read("accommodation_type", "accommodationType", "accommodation"), null),
    room_type: safeText(read("room_type", "roomType"), null),

    dietary_requirements: safeText(read("dietary_requirements", "dietaryRequirements", "dietary"), null),
    special_requests: safeText(read("special_requests", "specialRequests", "requests"), null),
    accessibility_needs: safeText(read("accessibility_needs", "accessibilityNeeds"), null),
    customer_notes: safeText(read("customer_notes", "customerNotes", "notes", "message"), null),

    group_type: safeText(read("group_type", "groupType", "tripType"), null),

    marketing_source: safeText(read("marketing_source", "marketingSource", "howHeard"), null),
    newsletter_opt_in: safeBool(read("newsletter_opt_in", "newsletterOptIn"), false),
    preferred_contact_method: safeText(read("preferred_contact_method", "preferredContactMethod", "contactMethod"), null),
    preferred_contact_time: safeText(read("preferred_contact_time", "preferredContactTime"), null),
    pickup_location: safeText(read("pickup_location", "pickupLocation"), null),

    source: safeText(read("source"), "website"),

    children_ages: safeJson(read("children_ages", "childrenAges"), null),
    travelers_details: safeJson(read("travelers_details", "travelersDetails"), null),
    emergency_contact: safeJson(read("emergency_contact", "emergencyContact"), null),
  };
};

/* ═════════════════════════════════════════════════════════════════════
   VALIDATION
═════════════════════════════════════════════════════════════════════ */
const validateBooking = (data, isUpdate = false) => {
  const errors = [];

  if (!isUpdate) {
    if (!safeText(data.full_name, "")) {
      errors.push({ field: "full_name", message: "Full name is required" });
    }

    const em = safeEmail(data.email);
    if (!em) {
      errors.push({ field: "email", message: "Email is required" });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      errors.push({ field: "email", message: "Invalid email address" });
    }
  }

  if (data.travel_date) {
    const td = new Date(data.travel_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (Number.isNaN(td.getTime())) {
      errors.push({ field: "travel_date", message: "Invalid arrival date" });
    } else if (td < today) {
      errors.push({ field: "travel_date", message: "Arrival date cannot be in the past" });
    }
  }

  if (data.travel_date && data.return_date) {
    const td = new Date(data.travel_date);
    const rd = new Date(data.return_date);

    if (!Number.isNaN(td.getTime()) && !Number.isNaN(rd.getTime()) && rd < td) {
      errors.push({ field: "return_date", message: "Departure date must be after arrival date" });
    }
  }

  if (data.number_of_travelers != null) {
    const n = parseInt(data.number_of_travelers, 10);
    if (!Number.isFinite(n) || n < 1 || n > 500) {
      errors.push({ field: "number_of_travelers", message: "Travelers must be between 1 and 500" });
    }
  }

  return errors;
};

/* ═════════════════════════════════════════════════════════════════════
   ACTIVITY LOG
═════════════════════════════════════════════════════════════════════ */
const logActivity = async (bookingId, action, description, adminId = null) => {
  try {
    await query(
      `INSERT INTO activity_log
         (entity_type, entity_id, action, description, admin_id, metadata, created_at)
       VALUES ('booking',$1,$2,$3,$4,$5,NOW())`,
      [
        bookingId,
        action,
        description,
        adminId,
        JSON.stringify({ ts: new Date().toISOString() }),
      ],
    );
  } catch (err) {
    logger.warn("[Bookings] logActivity non-fatal:", err.message);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   BOOKING DETAIL
═════════════════════════════════════════════════════════════════════ */
const getBookingDetail = async (identifier, type = "id") => {
  const where = type === "id" ? "b.id=$1" : "b.booking_number=$1";

  try {
    const { rows } = await query(
      `SELECT b.*,
              COALESCE(d.name, b.destination_name) AS destination_name,
              d.slug AS destination_slug,
              COALESCE(d.image_url, d.thumbnail_url) AS destination_image,
              COALESCE(c.name, b.country_name, b.country) AS country_name,
              c.slug AS country_slug,
              s.title AS service_name,
              s.slug AS service_slug,
              p.title AS package_name,
              u.full_name AS user_name,
              u.email AS user_email
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id = d.id
         LEFT JOIN countries c ON c.id = COALESCE(b.country_id, d.country_id)
         LEFT JOIN services s ON b.service_id = s.id
         LEFT JOIN packages p ON b.package_id = p.id
         LEFT JOIN users u ON b.user_id = u.id
        WHERE ${where}
        LIMIT 1`,
      [identifier],
    );

    return rows[0] || null;
  } catch (err) {
    logger.error("[Bookings] getBookingDetail:", err.message);
    return null;
  }
};

/* ═════════════════════════════════════════════════════════════════════
   SCHEMA
═════════════════════════════════════════════════════════════════════ */
const SCHEMA_COLUMNS = [
  "user_id INTEGER",
  "package_id INTEGER",
  "service_id INTEGER",
  "country_id INTEGER",
  "accommodation_id INTEGER",

  "booking_type VARCHAR(100) DEFAULT 'custom'",
  "booking_ref VARCHAR(100)",
  "confirmation_code VARCHAR(100)",

  "whatsapp VARCHAR(50)",
  "nationality VARCHAR(100)",
  "country VARCHAR(100)",
  "destination_name TEXT",
  "country_name TEXT",

  "travel_date DATE",
  "return_date DATE",
  "flexible_dates BOOLEAN DEFAULT false",
  "flexible_months TEXT",

  "number_of_travelers INTEGER DEFAULT 1",
  "number_of_adults INTEGER DEFAULT 1",
  "number_of_children INTEGER DEFAULT 0",
  "children_ages TEXT",

  "accommodation_type VARCHAR(100)",
  "room_type VARCHAR(100)",
  "dietary_requirements TEXT",
  "special_requests TEXT",
  "accessibility_needs TEXT",
  "customer_notes TEXT",
  "travelers_details TEXT",
  "emergency_contact TEXT",

  "group_type VARCHAR(50)",
  "marketing_source VARCHAR(100)",
  "newsletter_opt_in BOOLEAN DEFAULT false",
  "preferred_contact_method VARCHAR(50)",
  "preferred_contact_time VARCHAR(100)",
  "pickup_location TEXT",

  "email_verified BOOLEAN DEFAULT false",
  "email_verified_at TIMESTAMPTZ",
  "verification_token VARCHAR(128)",
  "verification_token_exp TIMESTAMPTZ",

  "cancel_request_type VARCHAR(20)",
  "cancel_request_reason TEXT",
  "cancel_requested_at TIMESTAMPTZ",
  "cancel_request_status VARCHAR(20) DEFAULT 'none'",
  "cancel_reviewed_at TIMESTAMPTZ",
  "cancel_reviewed_by INTEGER",
  "cancel_admin_response TEXT",

  "refund_amount NUMERIC(12,2)",
  "cancellation_reason TEXT",
  "cancelled_at TIMESTAMPTZ",
  "confirmed_at TIMESTAMPTZ",
  "completed_at TIMESTAMPTZ",

  "admin_notes TEXT",
  "internal_notes TEXT",

  "payment_status VARCHAR(50) DEFAULT 'pending'",
  "source VARCHAR(100) DEFAULT 'website'",
  "status VARCHAR(50) DEFAULT 'pending'",
  "is_active BOOLEAN DEFAULT true",
];

let _schemaReadyPromise = null;

const ensureSchemaColumns = async () => {
  if (_schemaReadyPromise) return _schemaReadyPromise;

  _schemaReadyPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        booking_number VARCHAR(50) UNIQUE NOT NULL,
        destination_id INTEGER,
        service_id INTEGER,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    for (const col of SCHEMA_COLUMNS) {
      await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    }

    await query(`
      UPDATE bookings
         SET cancel_request_status = 'none'
       WHERE cancel_request_status IS NULL
    `).catch(() => {});
  })().catch((err) => {
    _schemaReadyPromise = null;
    logger.warn("[Bookings] ensureSchemaColumns failed:", err.message);
  });

  return _schemaReadyPromise;
};

ensureSchemaColumns().catch((err) =>
  logger.warn("[Bookings] ensureSchemaColumns startup failed:", err.message),
);

/* ═════════════════════════════════════════════════════════════════════
   CREATE BOOKING — POST /api/bookings
═════════════════════════════════════════════════════════════════════ */
exports.create = async (req, res, next) => {
  try {
    await ensureSchemaColumns().catch((e) =>
      logger.warn("[Bookings] ensureSchemaColumns(create):", e.message),
    );

    const body = normalizeBookingData(req.body || {});
    const errors = validateBooking(body);

    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: errors[0]?.message || "Please check your booking details.",
        errors,
      });
    }

    const bookingNumber = generateBookingNumber();
    const verificationToken = crypto.randomBytes(48).toString("hex");
    const tokenExpiry = new Date(Date.now() + VERIFY_EXPIRY_H * 3600000);
    const emailVerified = !!req.user?.id;

    const { rows } = await query(
      `INSERT INTO bookings (
          booking_number,
          user_id, package_id, destination_id, service_id, country_id,
          booking_type,
          full_name, email, phone, whatsapp,
          nationality, country, destination_name, country_name,
          travel_date, return_date, flexible_dates, flexible_months,
          number_of_travelers, number_of_adults, number_of_children,
          accommodation_type, room_type,
          dietary_requirements, special_requests, accessibility_needs, customer_notes,
          children_ages, travelers_details, emergency_contact,
          group_type, marketing_source, newsletter_opt_in,
          preferred_contact_method, preferred_contact_time, pickup_location,
          source, status, payment_status,
          email_verified, verification_token, verification_token_exp,
          created_at, updated_at
        ) VALUES (
          $1,
          $2,$3,$4,$5,$6,
          $7,
          $8,$9,$10,$11,
          $12,$13,$14,$15,
          $16,$17,$18,$19,
          $20,$21,$22,
          $23,$24,
          $25,$26,$27,$28,
          $29,$30,$31,
          $32,$33,$34,
          $35,$36,$37,
          $38,'pending','pending',
          $39,$40,$41,
          NOW(),NOW()
        )
        RETURNING *`,
      [
        bookingNumber,

        req.user?.id || body.user_id || null,
        body.package_id,
        body.destination_id,
        body.service_id,
        body.country_id,

        body.booking_type || "custom",

        body.full_name,
        body.email,
        body.phone,
        body.whatsapp,

        body.nationality,
        body.country,
        body.destination_name,
        body.country_name,

        body.travel_date,
        body.return_date,
        body.flexible_dates,
        body.flexible_months,

        body.number_of_travelers || 1,
        body.number_of_adults ?? 1,
        body.number_of_children ?? 0,

        body.accommodation_type,
        body.room_type,

        body.dietary_requirements,
        body.special_requests,
        body.accessibility_needs,
        body.customer_notes,

        body.children_ages,
        body.travelers_details,
        body.emergency_contact,

        body.group_type,
        body.marketing_source,
        body.newsletter_opt_in,

        body.preferred_contact_method,
        body.preferred_contact_time,
        body.pickup_location,

        body.source || "website",

        emailVerified,
        emailVerified ? null : verificationToken,
        emailVerified ? null : tokenExpiry,
      ],
    );

    const booking = rows[0];
    const full = (await getBookingDetail(booking.id)) || booking;

    if (emailVerified) {
      if (sendBookingReceivedEmail) {
        asyncNoThrow(sendBookingReceivedEmail(full), "sendBookingReceivedEmail");
      }

      if (sendAdminBookingNotification) {
        asyncNoThrow(sendAdminBookingNotification(full), "sendAdminBookingNotification");
      }

      asyncNoThrow(
        notifyUserBookingEvent({
          user: { id: req.user.id, email: req.user.email || body.email },
          booking: full,
          title: "Booking Request Received! 🎉",
          message: `We've received your booking request ${bookingNumber}. We'll reply within 24 hours.`,
          actionUrl: "/my-bookings",
          actionLabel: "Track Booking",
        }),
        "notifyUserBookingEvent",
      );

      pingAdminNewRequest(full);

      if (startBookingConversation) {
        asyncNoThrow(
          startBookingConversation(full, {
            ipAddress: req.ip || req.headers["x-forwarded-for"],
          }),
          "startBookingConversation",
        );
      }
    } else {
      if (sendBookingVerificationLink) {
        asyncNoThrow(
          sendBookingVerificationLink(full, verificationToken),
          "sendBookingVerificationLink",
        );
      } else {
        logger.warn("[Bookings] sendBookingVerificationLink not available — skipped");
      }

      asyncNoThrow(
        notifyUserBookingEvent({
          user: { id: null, email: booking.email },
          booking: full,
          title: "Booking Request Received! 🎉",
          message: `Thanks ${safe(booking.full_name, "traveller")}! We've received your booking request ${bookingNumber}. Please confirm your email so our team can start planning.`,
          actionUrl: "/booking/verify",
          actionLabel: "Confirm Email",
        }),
        "notifyUserBookingEvent(guest)",
      );

      pingAdminNewRequest(full);

      if (startBookingConversation) {
        asyncNoThrow(
          startBookingConversation(full, {
            ipAddress: req.ip || req.headers["x-forwarded-for"],
          }),
          "startBookingConversation(guest)",
        );
      }
    }

    await logActivity(
      booking.id,
      "created",
      `Booking ${bookingNumber} created via ${body.source || "website"}`,
      req.admin?.id || req.user?.id || null,
    );

    logger.info(`[Bookings] ✅ Created: ${bookingNumber} | emailVerified=${emailVerified}`);

    return res.status(201).json({
      success: true,
      data: {
        id: booking.id,
        booking_number: bookingNumber,
        bookingRef: bookingNumber,
      },
      bookingRef: bookingNumber,
      emailVerified,
      message: emailVerified
        ? "Booking submitted successfully! We will contact you within 24 hours."
        : "Booking created! Please check your email and click the confirmation link.",
    });
  } catch (err) {
    logger.error("[Bookings] create:", err.message);
    next(err);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   VERIFY EMAIL
═════════════════════════════════════════════════════════════════════ */
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    const frontendUrl = process.env.FRONTEND_URL || "https://www.altuverasafaris.com";

    if (!token || token.length < 32) {
      return res.redirect(`${frontendUrl}/booking/verify?status=invalid`);
    }

    const { rows } = await query(
      `SELECT * FROM bookings
        WHERE verification_token = $1
          AND email_verified = false
          AND verification_token_exp > NOW()
        LIMIT 1`,
      [token],
    );

    if (!rows[0]) {
      const { rows: used } = await query(
        `SELECT id, email_verified FROM bookings WHERE verification_token = $1 LIMIT 1`,
        [token],
      );

      if (used[0]?.email_verified) {
        return res.redirect(`${frontendUrl}/booking/verify?status=already_verified`);
      }

      return res.redirect(`${frontendUrl}/booking/verify?status=expired`);
    }

    const booking = rows[0];

    await query(
      `UPDATE bookings
          SET email_verified = true,
              email_verified_at = NOW(),
              verification_token = NULL,
              verification_token_exp = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [booking.id],
    );

    logger.info(`[Bookings] ✅ Email verified: ${booking.booking_number}`);

    const full = (await getBookingDetail(booking.id)) || booking;

    if (sendBookingReceivedEmail) {
      asyncNoThrow(sendBookingReceivedEmail(full), "sendBookingReceivedEmail after verify");
    }

    if (sendAdminBookingNotification) {
      asyncNoThrow(sendAdminBookingNotification(full), "sendAdminBookingNotification after verify");
    }

    pingAdminNewRequest(full);

    if (startBookingConversation) {
      asyncNoThrow(
        startBookingConversation(full, {
          ipAddress: req.ip || req.headers["x-forwarded-for"],
        }),
        "startBookingConversation verify",
      );
    }

    await logActivity(booking.id, "email_verified", "Customer verified email address");

    return res.redirect(
      `${frontendUrl}/booking/verify?status=success&ref=${booking.booking_number}`,
    );
  } catch (err) {
    logger.error("[Bookings] verifyEmail:", err.message);
    const frontendUrl = process.env.FRONTEND_URL || "https://www.altuverasafaris.com";
    return res.redirect(`${frontendUrl}/booking/verify?status=error`);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   RESEND VERIFICATION
═════════════════════════════════════════════════════════════════════ */
exports.resendVerification = async (req, res, next) => {
  try {
    const id = safeId(req.params.id);

    const { rows } = await query(
      `SELECT * FROM bookings WHERE id = $1 AND email_verified = false`,
      [id],
    );

    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        error: "Booking not found or already verified",
      });
    }

    const newToken = crypto.randomBytes(48).toString("hex");
    const newExpiry = new Date(Date.now() + VERIFY_EXPIRY_H * 3600000);

    await query(
      `UPDATE bookings
          SET verification_token = $1,
              verification_token_exp = $2,
              updated_at = NOW()
        WHERE id = $3`,
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

/* ═════════════════════════════════════════════════════════════════════
   ADMIN CREATE
═════════════════════════════════════════════════════════════════════ */
exports.adminCreate = async (req, res, next) => {
  try {
    await ensureSchemaColumns();

    const adminId = req.admin?.id || req.user?.id || null;
    const body = normalizeBookingData(req.body || {});

    if (!body.user_id && body.email) {
      const { rows: u } = await query(
        "SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
        [body.email],
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
          destination_id, country_id, destination_name, country_name,
          status, source, admin_notes, email_verified,
          created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,
          $9,$10,$11,$12,
          'confirmed','admin_manual',$13,true,
          NOW(),NOW()
        )
        RETURNING *`,
      [
        bookingNumber,
        body.user_id || null,
        body.full_name,
        body.email,
        body.phone,
        body.travel_date,
        body.return_date,
        body.number_of_travelers || 1,
        body.destination_id,
        body.country_id,
        body.destination_name,
        body.country_name,
        `Created by admin ID: ${adminId || "unknown"}`,
      ],
    );

    const booking = rows[0];
    const full = (await getBookingDetail(booking.id)) || booking;

    if (sendBookingConfirmation) {
      asyncNoThrow(sendBookingConfirmation(full), "adminCreate sendBookingConfirmation");
    }

    if (body.user_id) {
      asyncNoThrow(
        createNotificationInternal({
          userId: body.user_id,
          userEmail: body.email,
          type: "booking_created",
          title: "New Booking Created for You",
          message: `An admin has created booking ${bookingNumber} on your behalf.`,
          actionUrl: "/my-bookings",
          actionLabel: "View Booking",
          priority: "high",
          category: "booking",
          senderType: "admin",
          senderId: adminId,
        }),
        "adminCreate createNotification",
      );
    }

    await logActivity(booking.id, "admin_created", `Admin created ${bookingNumber}`, adminId);

    logger.info(`[Bookings] Admin created: ${bookingNumber}`);

    return res.status(201).json({
      success: true,
      data: full,
      message: "Booking created successfully",
    });
  } catch (err) {
    logger.error("[Bookings] adminCreate:", err.message);
    next(err);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   GET ALL BOOKINGS
═════════════════════════════════════════════════════════════════════ */
exports.getAll = async (req, res, next) => {
  try {
    await ensureSchemaColumns();

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
      email_verified,
      cancel_request_status,
      sortBy = "created_at",
      order = "desc",
    } = req.query;

    const params = [];
    const conds = ["1=1"];
    let pi = 1;

    const push = (clause, value) => {
      conds.push(clause.replace("?", `$${pi++}`));
      params.push(value);
    };

    if (status) push("b.status=?", status);
    if (payment_status) push("b.payment_status=?", payment_status);
    if (booking_type) push("b.booking_type=?", booking_type);
    if (destination_id) push("b.destination_id=?", safeId(destination_id));
    if (service_id) push("b.service_id=?", safeId(service_id));
    if (date_from) push("b.created_at>=?", date_from);
    if (date_to) push("b.created_at<=?", date_to);
    if (travel_date_from) push("b.travel_date>=?", travel_date_from);
    if (travel_date_to) push("b.travel_date<=?", travel_date_to);
    if (email_verified !== undefined) push("b.email_verified=?", email_verified === "true");
    if (cancel_request_status) push("b.cancel_request_status=?", cancel_request_status);

    if (search) {
      const t = `%${String(search).trim()}%`;
      conds.push(
        `(b.full_name ILIKE $${pi}
          OR b.email ILIKE $${pi}
          OR b.booking_number ILIKE $${pi}
          OR b.phone ILIKE $${pi}
          OR b.destination_name ILIKE $${pi}
          OR b.country_name ILIKE $${pi})`,
      );
      params.push(t);
      pi++;
    }

    const where = conds.join(" AND ");
    const sortCol = ALLOWED_SORT.has(sortBy) ? sortBy : "created_at";
    const sortDir = String(order).toUpperCase() === "ASC" ? "ASC" : "DESC";
    const limitNum = safeInt(limit, 20, 1, 100);
    const pageNum = safeInt(page, 1, 1, 9999);
    const offset = (pageNum - 1) * limitNum;

    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM bookings b WHERE ${where}`, params),
      query(
        `SELECT b.*,
                COALESCE(d.name, b.destination_name) AS destination_name,
                d.slug AS destination_slug,
                COALESCE(d.image_url, d.thumbnail_url) AS destination_image,
                COALESCE(c.name, b.country_name, b.country) AS country_name,
                s.title AS service_name,
                p.title AS package_name,
                u.full_name AS user_name,
                u.email AS user_email
           FROM bookings b
           LEFT JOIN destinations d ON b.destination_id = d.id
           LEFT JOIN countries c ON c.id = COALESCE(b.country_id, d.country_id)
           LEFT JOIN services s ON b.service_id = s.id
           LEFT JOIN packages p ON b.package_id = p.id
           LEFT JOIN users u ON b.user_id = u.id
          WHERE ${where}
          ORDER BY b.${sortCol} ${sortDir}
          LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limitNum, offset],
      ),
    ]);

    const total = parseInt(countRes.rows[0].count, 10);

    return res.json({
      success: true,
      data: dataRes.rows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
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

/* ═════════════════════════════════════════════════════════════════════
   TRACK BOOKING
═════════════════════════════════════════════════════════════════════ */
exports.track = async (req, res, next) => {
  try {
    const bookingNumber = safeText(req.params.bookingNumber, "");

    if (!bookingNumber) {
      return res.status(400).json({
        success: false,
        error: "Booking number required",
      });
    }

    const booking = await getBookingDetail(
      bookingNumber.toUpperCase(),
      "booking_number",
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: "Booking not found",
      });
    }

    return res.json({
      success: true,
      data: {
        booking_number: booking.booking_number,
        status: booking.status,
        payment_status: booking.payment_status,
        email_verified: booking.email_verified,
        travel_date: booking.travel_date,
        return_date: booking.return_date,
        number_of_travelers: booking.number_of_travelers,
        destination: booking.destination_name,
        service: booking.service_name,
        package: booking.package_name,
        country: booking.country_name,
        created_at: booking.created_at,
        confirmed_at: booking.confirmed_at,
        status_message: getStatusMessage(booking.status),
      },
    });
  } catch (err) {
    next(err);
  }
};

// controllers/bookingsController.js — getMyBookings
// ═══════════════════════════════════════════════════════════════════════════════
// Fixes in this version:
//  ✓ Matches bookings by user_id (int cast) OR email (covers guest bookings
//    that were later linked to an account)
//  ✓ Robust JOIN with COALESCE fallbacks for every name column
//  ✓ Status filter supports comma-separated values
//  ✓ Safe fallback query if main query fails (schema differences)
//  ✓ Count query mirrors the same WHERE clause as the data query
//  ✓ Returns both `data` and `bookings` keys for frontend compatibility
//  ✓ Extended stats block
// ═══════════════════════════════════════════════════════════════════════════════

exports.getMyBookings = async (req, res) => {
  try {
    /* ── Auth ──────────────────────────────────────────────────────────────── */
    const userId    = req.user?.id    ? parseInt(req.user.id, 10) : null;
    const userEmail = req.user?.email ? String(req.user.email).trim().toLowerCase() : null;

    if (!userId && !userEmail) {
      return res.status(401).json({
        success: false,
        message: "Authentication required — no user identity found in token.",
      });
    }

    /* ── Pagination ────────────────────────────────────────────────────────── */
    const page   = Math.max(1, parseInt(req.query.page  || "1",  10));
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const offset = (page - 1) * limit;

    /* ── Status filter ─────────────────────────────────────────────────────── */
    const rawStatus = req.query.status || null;
    const statuses  = rawStatus
      ? String(rawStatus).split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    /* ── Build a reusable WHERE clause ─────────────────────────────────────── */
    //
    // Strategy: match on user_id OR email so that:
    //   (a) bookings created while logged in (have user_id) are found, AND
    //   (b) bookings created as a guest but with the same email are also found.
    //
    // We always cast $1 to integer to avoid type-mismatch on strict DBs.
    //
    const buildWhere = (startAt = 1) => {
      const parts  = [];
      const params = [];
      let   p      = startAt;

      if (userId && userEmail) {
        parts.push(`(b.user_id = $${p}::integer OR LOWER(b.email) = $${p + 1})`);
        params.push(userId, userEmail);
        p += 2;
      } else if (userId) {
        parts.push(`b.user_id = $${p}::integer`);
        params.push(userId);
        p += 1;
      } else {
        parts.push(`LOWER(b.email) = $${p}`);
        params.push(userEmail);
        p += 1;
      }

      if (statuses?.length) {
        parts.push(`b.status = ANY($${p}::text[])`);
        params.push(statuses);
        p += 1;
      }

      return { clause: `WHERE ${parts.join(" AND ")}`, params, nextP: p };
    };

    /* ── Count ─────────────────────────────────────────────────────────────── */
    const { clause: countClause, params: countParams } = buildWhere(1);

    const countResult = await query(
      `SELECT COUNT(*)::INT AS total
         FROM bookings b
        ${countClause}`,
      countParams,
    ).catch(() =>
      // Ultra-safe fallback — no JOINs, no status filter
      query(
        `SELECT COUNT(*)::INT AS total
           FROM bookings
          WHERE user_id = $1::integer`,
        [userId || 0],
      ),
    );

    const total      = countResult.rows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    /* ── Data ──────────────────────────────────────────────────────────────── */
    const { clause: dataClause, params: baseParams, nextP } = buildWhere(1);
    const dataParams = [...baseParams, limit, offset];
    const limitIdx   = nextP;
    const offsetIdx  = nextP + 1;

    let rows = [];

    try {
      const result = await query(
        `SELECT
           b.*,

           -- Destination
           COALESCE(d.name,          b.destination_name, b.destination, '')   AS destination_name,
           COALESCE(d.thumbnail_url, d.image_url,        b.image_url,   '')   AS destination_image,
           COALESCE(d.slug,          '')                                       AS destination_slug,

           -- Country
           COALESCE(c.name,          b.country_name, b.country, '')           AS country_name,

           -- Service
           COALESCE(s.title,         s.name, b.service_name, '')              AS service_name,

           -- Cancellation / refund request (if columns exist)
           COALESCE(b.cancel_request_status, 'none')                          AS cancel_request_status,
           COALESCE(b.cancel_request_type,   '')                              AS cancel_request_type,
           b.cancel_request_reason,
           b.cancel_admin_response,
           b.refund_amount

         FROM bookings b
         LEFT JOIN destinations d ON d.id = b.destination_id
         LEFT JOIN countries    c ON c.id = COALESCE(b.country_id, d.country_id)
         LEFT JOIN services     s ON s.id = b.service_id

         ${dataClause}

         ORDER BY
           /* Confirmed + upcoming first */
           CASE
             WHEN b.status = 'confirmed'
                  AND b.travel_date >= CURRENT_DATE THEN 0
             WHEN b.status = 'pending'              THEN 1
             WHEN b.status = 'confirmed'            THEN 2
             ELSE 3
           END,
           b.travel_date ASC NULLS LAST,
           b.created_at  DESC

         LIMIT  $${limitIdx}
         OFFSET $${offsetIdx}`,
        dataParams,
      );

      rows = result.rows;
    } catch (joinErr) {
      logger.warn("[getMyBookings] Full JOIN query failed, using fallback:", joinErr.message);

      // Fallback — raw bookings only, no JOINs
      const fallbackWhere = userId
        ? `WHERE (user_id = $1::integer${userEmail ? ` OR LOWER(email) = $2` : ""})`
        : `WHERE LOWER(email) = $1`;

      const fallbackParams = userId && userEmail
        ? [userId, userEmail, limit, offset]
        : userId
        ? [userId, limit, offset]
        : [userEmail, limit, offset];

      const lIdx = fallbackParams.length - 1;
      const oIdx = fallbackParams.length;

      const fallback = await query(
        `SELECT *
           FROM bookings
          ${fallbackWhere}
          ORDER BY created_at DESC
          LIMIT  $${lIdx}
          OFFSET $${oIdx}`,
        fallbackParams,
      );

      rows = fallback.rows.map((r) => ({
        ...r,
        destination_name:        r.destination_name  || r.destination || "",
        destination_image:       r.image_url         || "",
        destination_slug:        "",
        country_name:            r.country_name      || r.country     || "",
        service_name:            r.service_name      || "",
        cancel_request_status:   r.cancel_request_status || "none",
        cancel_request_type:     r.cancel_request_type  || "",
        cancel_request_reason:   r.cancel_request_reason   || null,
        cancel_admin_response:   r.cancel_admin_response   || null,
        refund_amount:           r.refund_amount            || null,
      }));
    }

    /* ── Stats ─────────────────────────────────────────────────────────────── */
    const uniqueCountries = [
      ...new Set(rows.map((b) => b.country_name).filter(Boolean)),
    ];

    const stats = {
      total,
      shown:             rows.length,
      confirmed:         rows.filter((b) => b.status === "confirmed").length,
      pending:           rows.filter((b) => b.status === "pending").length,
      completed:         rows.filter((b) => b.status === "completed").length,
      cancelled:         rows.filter((b) => b.status === "cancelled").length,
      on_hold:           rows.filter((b) => b.status === "on-hold").length,
      paid:              rows.filter((b) => b.payment_status === "paid").length,
      unpaid:            rows.filter((b) => ["unpaid", "pending"].includes(b.payment_status ?? "")).length,
      countries_visited: uniqueCountries.length,
      upcoming:          rows.filter((b) => {
        const d = b.travel_date ? new Date(b.travel_date) : null;
        return d && d >= new Date() && b.status === "confirmed";
      }).length,
      has_cancellation_request: rows.some(
        (b) => b.cancel_request_status && b.cancel_request_status !== "none",
      ),
    };

    /* ── Response ──────────────────────────────────────────────────────────── */
    return res.json({
      success:  true,
      data:     rows,      // primary key (new frontend)
      bookings: rows,      // legacy key (old frontend compatibility)
      stats,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
        has_next:    page < totalPages,
        has_prev:    page > 1,
      },
    });
  } catch (err) {
    logger.error("[getMyBookings] Unhandled error:", err.message, err.stack);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load bookings.",
    });
  }
};

/* ═════════════════════════════════════════════════════════════════════
   STATS
═════════════════════════════════════════════════════════════════════ */
exports.getStats = async (req, res, next) => {
  try {
    const period = req.query.period === "6months" ? "6 months" : "12 months";

    const [overview, monthly, topDest, bySrc, upcoming, conversion] =
      await Promise.all([
        query(`
          SELECT
            COUNT(*)::INTEGER AS total_bookings,
            COUNT(*) FILTER (WHERE status='pending')::INTEGER AS pending,
            COUNT(*) FILTER (WHERE status='confirmed')::INTEGER AS confirmed,
            COUNT(*) FILTER (WHERE status='completed')::INTEGER AS completed,
            COUNT(*) FILTER (WHERE status='cancelled')::INTEGER AS cancelled,
            COUNT(*) FILTER (WHERE status='on-hold')::INTEGER AS on_hold,
            COUNT(*) FILTER (WHERE email_verified=true)::INTEGER AS email_verified,
            COUNT(*) FILTER (WHERE email_verified=false)::INTEGER AS awaiting_verification,
            COUNT(*) FILTER (WHERE payment_status='paid')::INTEGER AS paid,
            COALESCE(SUM(number_of_travelers),0)::INTEGER AS total_travelers,
            COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '24 hours')::INTEGER AS last_24h,
            COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '7 days')::INTEGER AS last_7_days,
            COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '30 days')::INTEGER AS last_30_days
          FROM bookings
        `),
        query(`
          SELECT
            TO_CHAR(created_at,'YYYY-MM') AS month,
            TO_CHAR(created_at,'Mon YYYY') AS month_label,
            COUNT(*)::INTEGER AS total,
            COUNT(*) FILTER (WHERE status='confirmed')::INTEGER AS confirmed,
            COUNT(*) FILTER (WHERE status='completed')::INTEGER AS completed,
            COUNT(*) FILTER (WHERE status='cancelled')::INTEGER AS cancelled,
            COALESCE(SUM(number_of_travelers),0)::INTEGER AS travelers
          FROM bookings
          WHERE created_at >= NOW() - INTERVAL '${period}'
          GROUP BY month, month_label
          ORDER BY month ASC
        `),
        query(`
          SELECT d.id, d.name, d.slug, d.image_url,
                 COUNT(b.id)::INTEGER AS booking_count,
                 COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
            FROM bookings b
            JOIN destinations d ON b.destination_id = d.id
           WHERE b.created_at >= NOW() - INTERVAL '3 months'
           GROUP BY d.id, d.name, d.slug, d.image_url
           ORDER BY booking_count DESC
           LIMIT 10
        `),
        query(`
          SELECT COALESCE(source,'direct') AS source,
                 COUNT(*)::INTEGER AS count
            FROM bookings
           WHERE created_at >= NOW() - INTERVAL '3 months'
           GROUP BY source
           ORDER BY count DESC
        `),
        query(`
          SELECT
            COUNT(*)::INTEGER AS total,
            COUNT(*) FILTER (WHERE travel_date BETWEEN NOW() AND NOW()+INTERVAL '7 days')::INTEGER AS next_7_days,
            COUNT(*) FILTER (WHERE travel_date BETWEEN NOW() AND NOW()+INTERVAL '30 days')::INTEGER AS next_30_days
          FROM bookings
          WHERE status IN ('confirmed','pending')
            AND travel_date >= NOW()
        `),
        query(`
          SELECT ROUND(
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
        overview: overview.rows[0],
        monthly_trends: monthly.rows,
        top_destinations: topDest.rows,
        by_source: bySrc.rows,
        upcoming: upcoming.rows[0],
        conversion_rate: parseFloat(conversion.rows[0]?.conversion_rate || 0),
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("[Bookings] getStats:", err.message);
    next(err);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   GET ONE
═════════════════════════════════════════════════════════════════════ */
exports.getOne = async (req, res, next) => {
  try {
    const id = safeId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Invalid booking ID",
      });
    }

    const booking = await getBookingDetail(id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: "Booking not found",
      });
    }

    let history = [];
    try {
      const h = await query(
        `SELECT action, description, created_at, admin_id
           FROM activity_log
          WHERE entity_type = 'booking'
            AND entity_id = $1
          ORDER BY created_at DESC
          LIMIT 30`,
        [id],
      );
      history = h.rows;
    } catch {
      // non-fatal
    }

    return res.json({
      success: true,
      data: { ...booking, activity_history: history },
    });
  } catch (err) {
    next(err);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   UPDATE
═════════════════════════════════════════════════════════════════════ */
exports.update = async (req, res, next) => {
  try {
    const id = safeId(req.params.id);
    const adminId = req.admin?.id || req.user?.id || null;

    const { rows: ex } = await query("SELECT id FROM bookings WHERE id=$1", [id]);
    if (!ex[0]) {
      return res.status(404).json({
        success: false,
        error: "Booking not found",
      });
    }

    const normalized = normalizeBookingData(req.body || {});

    const ALLOWED_FIELDS = [
      "full_name",
      "email",
      "phone",
      "whatsapp",
      "nationality",
      "country",
      "country_id",
      "destination_id",
      "destination_name",
      "country_name",
      "travel_date",
      "return_date",
      "flexible_dates",
      "number_of_travelers",
      "number_of_adults",
      "number_of_children",
      "children_ages",
      "accommodation_type",
      "room_type",
      "dietary_requirements",
      "special_requests",
      "accessibility_needs",
      "travelers_details",
      "emergency_contact",
      "admin_notes",
      "internal_notes",
      "customer_notes",
      "payment_status",
      "marketing_source",
      "preferred_contact_method",
      "preferred_contact_time",
      "pickup_location",
    ];

    const updates = {};
    for (const f of ALLOWED_FIELDS) {
      if (normalized[f] !== undefined) updates[f] = normalized[f];
      else if (req.body[f] !== undefined) updates[f] = safe(req.body[f], null);
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({
        success: false,
        error: "No valid fields to update",
      });
    }

    const errs = validateBooking(updates, true);
    if (errs.length) return res.status(400).json({ success: false, errors: errs });

    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map((f, i) => `${f}=$${i + 1}`).join(", ");

    await query(
      `UPDATE bookings
          SET ${setClause}, updated_at=NOW()
        WHERE id=$${fields.length + 1}`,
      [...values, id],
    );

    await logActivity(id, "updated", `Fields: ${fields.join(", ")}`, adminId);

    const updated = await getBookingDetail(id);

    return res.json({
      success: true,
      message: "Booking updated",
      data: updated,
    });
  } catch (err) {
    logger.error("[Bookings] update:", err.message);
    next(err);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   UPDATE STATUS
═════════════════════════════════════════════════════════════════════ */
exports.updateStatus = async (req, res, next) => {
  try {
    const id = safeId(req.params.id);
    const adminId = req.admin?.id || req.user?.id || null;
    const status = safeText(req.body.status, null);
    const reason = safeText(req.body.reason, null);
    const notify_customer = safeBool(req.body.notify_customer, true);

    if (!status) {
      return res.status(400).json({
        success: false,
        error: "Status is required",
      });
    }

    if (!Object.values(BOOKING_STATUS).includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status value",
      });
    }

    const { rows: ex } = await query("SELECT * FROM bookings WHERE id=$1", [id]);
    if (!ex[0]) {
      return res.status(404).json({
        success: false,
        error: "Booking not found",
      });
    }

    const current = ex[0].status;

    if (!isValidTransition(current, status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status transition",
        current_status: current,
        requested_status: status,
        allowed_transitions: STATUS_TRANSITIONS[current] || [],
      });
    }

    const params = [status];
    let pi = 2;
    let setClause = "status=$1, updated_at=NOW()";

    if (status === "confirmed") {
      const code = generateConfirmationCode();
      setClause += `, confirmed_at=NOW(), confirmation_code=$${pi++}`;
      params.push(code);
    }

    if (status === "cancelled") {
      setClause += `, cancelled_at=NOW()`;
      if (reason) {
        setClause += `, cancellation_reason=$${pi++}`;
        params.push(reason);
      }
    }

    if (status === "completed") {
      setClause += `, completed_at=NOW()`;
    }

    params.push(id);

    await query(
      `UPDATE bookings
          SET ${setClause}
        WHERE id=$${pi}
        RETURNING *`,
      params,
    );

    await logActivity(
      id,
      `status_${status}`,
      `${current} → ${status}${reason ? `. Reason: ${reason}` : ""}`,
      adminId,
    );

    const full = await getBookingDetail(id);

    if (notify_customer && full?.email) {
      if (status === "confirmed" && sendBookingConfirmation) {
        asyncNoThrow(sendBookingConfirmation(full), "sendBookingConfirmation");
      } else if (status === "cancelled" && sendBookingCancellation) {
        asyncNoThrow(sendBookingCancellation(full, reason), "sendBookingCancellation");
      } else if (sendBookingStatusUpdate) {
        asyncNoThrow(sendBookingStatusUpdate(full, current, status, reason), "sendBookingStatusUpdate");
      }
    }

    if (full?.user_id) {
      asyncNoThrow(
        createNotificationInternal({
          userId: full.user_id,
          userEmail: full.email,
          type: `booking_${status}`,
          title: `Booking ${status.charAt(0).toUpperCase() + status.slice(1)}`,
          message: getStatusMessage(status),
          actionUrl: "/my-bookings",
          actionLabel: "View Booking",
          category: "booking",
          priority: status === "cancelled" ? "urgent" : "normal",
          senderType: "admin",
          senderId: adminId,
        }),
        "updateStatus notification",
      );
    }

    return res.json({
      success: true,
      message: `Status updated to ${status}`,
      data: full,
    });
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

/* ═════════════════════════════════════════════════════════════════════
   COUNTDOWN EMAILS
═════════════════════════════════════════════════════════════════════ */
exports.sendCountdownEmails = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.*,
              COALESCE(d.name, b.destination_name) AS destination_name,
              COALESCE(c.name, b.country_name, b.country) AS country_name,
              s.title AS service_name,
              p.title AS package_name
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id = d.id
         LEFT JOIN countries c ON c.id = COALESCE(b.country_id, d.country_id)
         LEFT JOIN services s ON b.service_id = s.id
         LEFT JOIN packages p ON b.package_id = p.id
        WHERE b.status = 'confirmed'
          AND b.travel_date >= CURRENT_DATE
          AND b.email IS NOT NULL`,
    );

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const booking of rows) {
      if (!sendTripCountdownEmail) {
        skipped++;
        continue;
      }

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
        message: "Countdown emails processed",
        stats: { total: rows.length, sent, skipped, failed },
      });
    }
  } catch (err) {
    logger.error("[Bookings] sendCountdownEmails:", err.message);
    if (next) next(err);
  }
};

if (process.env.NODE_ENV === "production") {
  const DAY = 24 * 60 * 60 * 1000;

  setTimeout(() => {
    exports.sendCountdownEmails(null, null, (err) => {
      if (err) logger.warn("[Bookings] Startup countdown run failed:", err.message);
    });

    setInterval(() => {
      exports.sendCountdownEmails(null, null, (err) => {
        if (err) logger.warn("[Bookings] Daily countdown run failed:", err.message);
      });
    }, DAY).unref();
  }, 5 * 60 * 1000).unref();
}

/* ═════════════════════════════════════════════════════════════════════
   DELETE
═════════════════════════════════════════════════════════════════════ */
exports.remove = async (req, res, next) => {
  try {
    const id = safeId(req.params.id);
    const adminId = req.admin?.id || req.user?.id || null;

    const { rows } = await query(
      `SELECT id, booking_number, user_id, email, destination_id, service_id
         FROM bookings
        WHERE id=$1`,
      [id],
    );

    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        error: "Booking not found",
      });
    }

    const b = rows[0];

    await query("DELETE FROM bookings WHERE id=$1", [id]);

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

    if (b.user_id) {
      asyncNoThrow(
        createNotificationInternal({
          userId: b.user_id,
          userEmail: b.email,
          type: "booking_deleted",
          title: "Booking Removed",
          message: `Your booking ${b.booking_number} has been removed.`,
          priority: "urgent",
          category: "booking",
          senderType: "admin",
          senderId: adminId,
        }),
        "remove notification",
      );
    }

    await logActivity(id, "deleted", `Booking ${b.booking_number} deleted`, adminId);

    return res.json({
      success: true,
      message: "Booking deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   BULK STATUS
═════════════════════════════════════════════════════════════════════ */
exports.bulkUpdateStatus = async (req, res, next) => {
  try {
    const bookingIds = req.body.booking_ids;
    const status = safeText(req.body.status, null);
    const adminId = req.admin?.id || req.user?.id || null;

    if (!Array.isArray(bookingIds) || !bookingIds.length) {
      return res.status(400).json({
        success: false,
        error: "booking_ids must be a non-empty array",
      });
    }

    if (!Object.values(BOOKING_STATUS).includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status",
      });
    }

    const results = { success: [], failed: [] };

    for (const rawId of bookingIds) {
      const bid = safeId(rawId);

      try {
        const { rows } = await query("SELECT status FROM bookings WHERE id=$1", [bid]);

        if (!rows[0]) {
          results.failed.push({ id: rawId, reason: "Not found" });
          continue;
        }

        if (!isValidTransition(rows[0].status, status)) {
          results.failed.push({
            id: bid,
            reason: `Transition ${rows[0].status}→${status} not allowed`,
          });
          continue;
        }

        await query(
          "UPDATE bookings SET status=$1, updated_at=NOW() WHERE id=$2",
          [status, bid],
        );

        await logActivity(
          bid,
          `bulk_${status}`,
          `Bulk: ${rows[0].status}→${status}`,
          adminId,
        );

        results.success.push(bid);
      } catch (e) {
        results.failed.push({ id: rawId, reason: e.message });
      }
    }

    return res.json({
      success: true,
      message: `Updated ${results.success.length} of ${bookingIds.length} bookings`,
      data: results,
    });
  } catch (err) {
    next(err);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   EXPORT
═════════════════════════════════════════════════════════════════════ */
exports.export = async (req, res, next) => {
  try {
    const { format = "json", status, date_from, date_to } = req.query;

    const params = [];
    const conds = ["1=1"];
    let pi = 1;

    if (status) {
      conds.push(`b.status=$${pi++}`);
      params.push(status);
    }

    if (date_from) {
      conds.push(`b.created_at>=$${pi++}`);
      params.push(date_from);
    }

    if (date_to) {
      conds.push(`b.created_at<=$${pi++}`);
      params.push(date_to);
    }

    const { rows } = await query(
      `SELECT b.booking_number,
              b.full_name,
              b.email,
              b.phone,
              b.nationality,
              b.travel_date,
              b.return_date,
              b.number_of_travelers,
              b.accommodation_type,
              b.special_requests,
              b.email_verified,
              b.status,
              b.payment_status,
              b.source,
              b.created_at,
              COALESCE(d.name, b.destination_name) AS destination,
              COALESCE(c.name, b.country_name, b.country) AS destination_country,
              s.title AS service
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id = d.id
         LEFT JOIN countries c ON c.id = COALESCE(b.country_id, d.country_id)
         LEFT JOIN services s ON b.service_id = s.id
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
        csv += headers
          .map((h) => {
            const v = row[h] == null ? "" : String(row[h]);
            return /[,"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
          })
          .join(",") + "\n";
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="altuvera-bookings-${Date.now()}.csv"`,
      );

      return res.send(csv);
    }

    return res.json({
      success: true,
      data: rows,
      total: rows.length,
      exported_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("[Bookings] export:", err.message);
    next(err);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   ADD NOTES
═════════════════════════════════════════════════════════════════════ */
exports.addNotes = async (req, res, next) => {
  try {
    const id = safeId(req.params.id);
    const adminId = req.admin?.id || req.user?.id || null;

    const admin_notes = safeText(req.body.admin_notes, null);
    const internal_notes = safeText(req.body.internal_notes, null);

    if (!admin_notes && !internal_notes) {
      return res.status(400).json({
        success: false,
        error: "At least one note field required",
      });
    }

    const sets = [];
    const params = [];
    let pi = 1;
    const TS = "TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI')";

    if (admin_notes) {
      sets.push(
        `admin_notes = COALESCE(admin_notes,'') || E'\\n[' || ${TS} || '] ' || $${pi++}`,
      );
      params.push(admin_notes);
    }

    if (internal_notes) {
      sets.push(
        `internal_notes = COALESCE(internal_notes,'') || E'\\n[' || ${TS} || '] ' || $${pi++}`,
      );
      params.push(internal_notes);
    }

    params.push(id);

    const { rows } = await query(
      `UPDATE bookings
          SET ${sets.join(", ")}, updated_at=NOW()
        WHERE id=$${pi}
        RETURNING *`,
      params,
    );

    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        error: "Booking not found",
      });
    }

    await logActivity(id, "notes_added", "Notes updated", adminId);

    return res.json({
      success: true,
      message: "Notes added",
      data: rows[0],
    });
  } catch (err) {
    next(err);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   UPCOMING / RECENT / MOST BOOKED
═════════════════════════════════════════════════════════════════════ */
exports.getUpcoming = async (req, res, next) => {
  try {
    const days = safeInt(req.query.days, 30, 1, 365);
    const limit = safeInt(req.query.limit, 20, 1, 100);

    const { rows } = await query(
      `SELECT b.*,
              COALESCE(d.name, b.destination_name) AS destination_name,
              COALESCE(c.name, b.country_name, b.country) AS country_name,
              s.title AS service_name
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id = d.id
         LEFT JOIN countries c ON c.id = COALESCE(b.country_id, d.country_id)
         LEFT JOIN services s ON b.service_id = s.id
        WHERE b.status IN ('confirmed','pending')
          AND b.travel_date >= CURRENT_DATE
          AND b.travel_date <= CURRENT_DATE + $1
        ORDER BY b.travel_date ASC
        LIMIT $2`,
      [days, limit],
    );

    return res.json({
      success: true,
      data: rows,
      period: `Next ${days} days`,
    });
  } catch (err) {
    next(err);
  }
};

exports.getRecent = async (req, res, next) => {
  try {
    const limit = safeInt(req.query.limit, 10, 1, 100);

    const { rows } = await query(
      `SELECT b.id,
              b.booking_number,
              b.booking_type,
              b.full_name,
              b.email,
              b.status,
              b.payment_status,
              b.email_verified,
              b.travel_date,
              b.return_date,
              b.number_of_travelers,
              b.created_at,
              COALESCE(d.name, b.destination_name) AS destination_name,
              COALESCE(d.image_url, d.thumbnail_url) AS destination_image,
              s.title AS service_name,
              p.title AS package_name
         FROM bookings b
         LEFT JOIN destinations d ON b.destination_id = d.id
         LEFT JOIN services s ON b.service_id = s.id
         LEFT JOIN packages p ON b.package_id = p.id
        ORDER BY b.created_at DESC
        LIMIT $1`,
      [limit],
    );

    return res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    next(err);
  }
};

exports.getMostBookedDestinations = async (req, res, next) => {
  try {
    const limit = safeInt(req.query.limit, 10, 1, 50);
    const period = req.query.period;

    const df =
      period === "month"
        ? "AND b.created_at>=NOW()-INTERVAL '30 days'"
        : period === "year"
          ? "AND b.created_at>=NOW()-INTERVAL '365 days'"
          : "";

    const { rows } = await query(
      `SELECT d.id,
              d.name,
              d.slug,
              d.image_url,
              d.short_description,
              d.difficulty,
              c.name AS country_name,
              c.slug AS country_slug,
              COUNT(b.id)::INTEGER AS booking_count,
              COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
         FROM destinations d
         LEFT JOIN bookings b ON b.destination_id = d.id ${df}
         LEFT JOIN countries c ON d.country_id = c.id
        WHERE d.is_active = true
        GROUP BY d.id, d.name, d.slug, d.image_url,
                 d.short_description, d.difficulty, c.name, c.slug
        ORDER BY booking_count DESC, total_travelers DESC
        LIMIT $1`,
      [limit],
    );

    return res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    next(err);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   DESTINATION / COUNTRY STATS
═════════════════════════════════════════════════════════════════════ */
exports.getBookingsByDestination = async (req, res, next) => {
  try {
    const destId = safeId(req.params.destinationId);

    if (!destId) {
      return res.status(400).json({
        success: false,
        error: "Invalid destination ID",
      });
    }

    const period = req.query.period;
    const df =
      period === "month"
        ? "AND b.created_at>=NOW()-INTERVAL '30 days'"
        : period === "year"
          ? "AND b.created_at>=NOW()-INTERVAL '365 days'"
          : "";

    const [destRes, statsRes] = await Promise.all([
      query(
        `SELECT d.*, c.name AS country_name, c.slug AS country_slug
           FROM destinations d
           LEFT JOIN countries c ON d.country_id = c.id
          WHERE d.id = $1`,
        [destId],
      ),
      query(
        `SELECT COUNT(*)::INTEGER AS total_bookings,
                COUNT(*) FILTER (WHERE b.status='confirmed')::INTEGER AS confirmed,
                COUNT(*) FILTER (WHERE b.status='completed')::INTEGER AS completed,
                COUNT(*) FILTER (WHERE b.status='cancelled')::INTEGER AS cancelled,
                COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
           FROM bookings b
          WHERE b.destination_id = $1 ${df}`,
        [destId],
      ),
    ]);

    if (!destRes.rows[0]) {
      return res.status(404).json({
        success: false,
        error: "Destination not found",
      });
    }

    return res.json({
      success: true,
      data: {
        destination: destRes.rows[0],
        stats: statsRes.rows[0],
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getBookingsByCountry = async (req, res, next) => {
  try {
    const countryId = safeId(req.params.countryId);

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "Invalid country ID",
      });
    }

    const period = req.query.period;
    const df =
      period === "month"
        ? "AND b.created_at>=NOW()-INTERVAL '30 days'"
        : period === "year"
          ? "AND b.created_at>=NOW()-INTERVAL '365 days'"
          : "";

    const [cRes, sRes] = await Promise.all([
      query(
        `SELECT id, name, slug, image_url, flag_url, continent
           FROM countries
          WHERE id=$1`,
        [countryId],
      ),
      query(
        `SELECT COUNT(DISTINCT b.id)::INTEGER AS total_bookings,
                COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
           FROM bookings b
           LEFT JOIN destinations d ON b.destination_id = d.id
          WHERE COALESCE(b.country_id, d.country_id) = $1 ${df}`,
        [countryId],
      ),
    ]);

    if (!cRes.rows[0]) {
      return res.status(404).json({
        success: false,
        error: "Country not found",
      });
    }

    return res.json({
      success: true,
      data: {
        country: cRes.rows[0],
        stats: sRes.rows[0],
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getCountriesBookingStats = async (req, res, next) => {
  try {
    const period = req.query.period;

    const df =
      period === "month"
        ? "AND b.created_at>=NOW()-INTERVAL '30 days'"
        : period === "year"
          ? "AND b.created_at>=NOW()-INTERVAL '365 days'"
          : "";

    const { rows } = await query(`
      SELECT c.id,
             c.name,
             c.slug,
             c.image_url,
             c.flag_url,
             c.continent,
             COUNT(DISTINCT b.id)::INTEGER AS total_bookings,
             COUNT(DISTINCT d.id)::INTEGER AS destinations_offered,
             COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
        FROM countries c
        LEFT JOIN destinations d ON d.country_id = c.id AND d.is_active = true
        LEFT JOIN bookings b ON COALESCE(b.country_id, d.country_id) = c.id ${df}
       WHERE c.is_active = true
       GROUP BY c.id, c.name, c.slug, c.image_url, c.flag_url, c.continent
       ORDER BY total_bookings DESC
    `);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    next(err);
  }
};

exports.getDestinationsBookingStats = async (req, res, next) => {
  try {
    const { period, country_id, page = 1, limit = 20 } = req.query;

    const df =
      period === "month"
        ? "AND b.created_at>=NOW()-INTERVAL '30 days'"
        : period === "year"
          ? "AND b.created_at>=NOW()-INTERVAL '365 days'"
          : "";

    const params = [];
    const conds = ["d.is_active=true"];
    let pi = 1;

    if (country_id) {
      conds.push(`d.country_id=$${pi++}`);
      params.push(safeId(country_id));
    }

    const where = conds.join(" AND ");
    const limitNum = safeInt(limit, 20, 1, 100);
    const pageNum = safeInt(page, 1, 1, 9999);
    const offset = (pageNum - 1) * limitNum;

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT d.id,
                d.name,
                d.slug,
                d.image_url,
                d.difficulty,
                d.rating,
                d.review_count,
                c.id AS country_id,
                c.name AS country_name,
                c.slug AS country_slug,
                COUNT(b.id)::INTEGER AS total_bookings,
                COALESCE(SUM(b.number_of_travelers),0)::INTEGER AS total_travelers
           FROM destinations d
           LEFT JOIN countries c ON d.country_id = c.id
           LEFT JOIN bookings b ON b.destination_id = d.id ${df}
          WHERE ${where}
          GROUP BY d.id, d.name, d.slug, d.image_url,
                   d.difficulty, d.rating, d.review_count,
                   c.id, c.name, c.slug
          ORDER BY total_bookings DESC
          LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limitNum, offset],
      ),
      query(`SELECT COUNT(*) FROM destinations d WHERE ${where}`, params),
    ]);

    const total = parseInt(countRes.rows[0].count, 10);

    return res.json({
      success: true,
      data: dataRes.rows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(total / limitNum),
        has_next: pageNum < Math.ceil(total / limitNum),
        has_prev: pageNum > 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ═════════════════════════════════════════════════════════════════════
   CANCELLATION / REFUND REQUESTS
═════════════════════════════════════════════════════════════════════ */
exports.requestCancellation = async (req, res, next) => {
  try {
    const id = safeId(req.params.id);
    const user = req.user;
    const type = safeText(req.body?.type, "cancellation");
    const reason = safeText(req.body?.reason, "");

    if (!["cancellation", "refund"].includes(type)) {
      return res.status(400).json({
        success: false,
        error: "type must be 'cancellation' or 'refund'",
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: "Please provide a reason for your request.",
      });
    }

    const { rows } = await query("SELECT * FROM bookings WHERE id=$1", [id]);

    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        error: "Booking not found",
      });
    }

    const booking = rows[0];

    if (booking.user_id && user?.id && booking.user_id !== user.id) {
      return res.status(403).json({
        success: false,
        error: "This booking does not belong to your account.",
      });
    }

    if (booking.cancel_request_status === CANCEL_REQUEST_STATUS.PENDING) {
      return res.status(409).json({
        success: false,
        error: "You already have a pending request for this booking.",
        data: booking,
      });
    }

    if (!isEligibleForRequest(booking, type)) {
      return res.status(409).json({
        success: false,
        error: `This booking (status: ${booking.status}) is not eligible for a ${type} request.`,
      });
    }

    const updated = await query(
      `UPDATE bookings
          SET cancel_request_type = $2,
              cancel_request_reason = $3,
              cancel_requested_at = NOW(),
              cancel_request_status = $4,
              cancel_admin_response = NULL,
              cancel_reviewed_at = NULL,
              cancel_reviewed_by = NULL,
              refund_amount = NULL
        WHERE id = $1
        RETURNING *`,
      [id, type, reason, CANCEL_REQUEST_STATUS.PENDING],
    );

    const full = await getBookingDetail(id);

    await logActivity(
      id,
      `cancel_request_${type}`,
      `User requested ${type}. Reason: ${reason}`,
      user?.id || null,
    );

    if (sendCancellationRequestAck && (full || booking)) {
      asyncNoThrow(
        sendCancellationRequestAck(full || booking, type),
        "sendCancellationRequestAck",
      );
    }

    const io = getIO();

    asyncNoThrow(
      createNotificationInternal({
        targetScope: "role",
        targetRole: "admin",
        type: "booking_cancel_request",
        title: `New ${type} request — ${booking.booking_number}`,
        message: `${booking.full_name || "A user"} requested a ${type} for booking ${booking.booking_number}.`,
        actionUrl: "/bookings",
        actionLabel: "Review Request",
        category: "booking",
        priority: "high",
        senderType: "user",
        senderId: user?.id || null,
        io,
      }),
      "requestCancellation admin notification",
    );

    return res.json({
      success: true,
      message: `Your ${type} request has been submitted for review.`,
      data: full || updated.rows[0],
    });
  } catch (err) {
    logger.error("[Bookings] requestCancellation:", err.message);
    next(err);
  }
};

exports.reviewCancellation = async (req, res, next) => {
  try {
    const id = safeId(req.params.id);
    const adminId = req.admin?.id || req.user?.id || null;

    const decision = safeText(req.body?.decision, null);
    const adminResponse = safeText(req.body?.admin_response, null);
    const refundAmount = safeFloat(req.body?.refund_amount, null);

    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({
        success: false,
        error: "decision must be 'approved' or 'rejected'",
      });
    }

    const { rows } = await query("SELECT * FROM bookings WHERE id=$1", [id]);

    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        error: "Booking not found",
      });
    }

    const booking = rows[0];
    const requestType = booking.cancel_request_type || "cancellation";

    if (booking.cancel_request_status !== CANCEL_REQUEST_STATUS.PENDING) {
      return res.status(409).json({
        success: false,
        error: "No pending request to review for this booking.",
      });
    }

    if (decision === "rejected") {
      await query(
        `UPDATE bookings
            SET cancel_request_status = $2,
                cancel_reviewed_at = NOW(),
                cancel_reviewed_by = $3,
                cancel_admin_response = $4,
                updated_at = NOW()
          WHERE id = $1`,
        [id, CANCEL_REQUEST_STATUS.REJECTED, adminId, adminResponse],
      );

      await logActivity(
        id,
        "cancel_request_rejected",
        `Admin rejected ${requestType} request${adminResponse ? `. Response: ${adminResponse}` : ""}`,
        adminId,
      );
    } else {
      const newStatus =
        requestType === "refund"
          ? booking.status === "completed"
            ? "refunded"
            : "cancelled"
          : "cancelled";

      const sets = [
        "status=$1",
        "cancel_request_status=$2",
        "cancel_reviewed_at=NOW()",
        "cancel_reviewed_by=$3",
        "cancel_admin_response=$4",
        "updated_at=NOW()",
      ];

      const params = [
        newStatus,
        CANCEL_REQUEST_STATUS.APPROVED,
        adminId,
        adminResponse,
      ];

      let pi = 5;

      if (newStatus === "cancelled") {
        sets.push("cancelled_at=NOW()");
        sets.push(`cancellation_reason=$${pi++}`);
        params.push(booking.cancel_request_reason || `Approved ${requestType} request`);
      }

      if (requestType === "refund" && refundAmount != null) {
        sets.push(`refund_amount=$${pi++}`);
        params.push(refundAmount);
      }

      params.push(id);

      await query(
        `UPDATE bookings
            SET ${sets.join(", ")}
          WHERE id=$${pi}`,
        params,
      );

      await logActivity(
        id,
        "cancel_request_approved",
        `Admin approved ${requestType} → ${newStatus}${adminResponse ? `. Response: ${adminResponse}` : ""}`,
        adminId,
      );
    }

    const full = await getBookingDetail(id);
    const approved = decision === "approved";
    const io = getIO();

    asyncNoThrow(
      createNotificationInternal({
        userId: booking.user_id,
        userEmail: booking.email,
        targetScope: "individual",
        type: approved ? "booking_cancel_approved" : "booking_cancel_rejected",
        title: approved
          ? `Your ${requestType} request was approved`
          : `Your ${requestType} request was declined`,
        message: approved
          ? `Your ${requestType} request for booking ${booking.booking_number} has been approved.`
          : `Your ${requestType} request for booking ${booking.booking_number} was declined.${adminResponse ? " Note: " + adminResponse : ""}`,
        actionUrl: "/my-bookings",
        actionLabel: "View Booking",
        category: "booking",
        priority: "urgent",
        senderType: "admin",
        senderId: adminId,
        io,
      }),
      "reviewCancellation user notification",
    );

    if (sendBookingStatusUpdate && full?.email) {
      const currentStatus = full.status;
      const targetStatus = approved
        ? requestType === "refund"
          ? "refunded"
          : "cancelled"
        : full.status;

      const reason =
        adminResponse ||
        (approved
          ? `Your ${requestType} request was approved.`
          : `Your ${requestType} request was declined.`);

      asyncNoThrow(
        sendBookingStatusUpdate(full, currentStatus, targetStatus, reason),
        "reviewCancellation status email",
      );
    }

    return res.json({
      success: true,
      message: `Request ${decision}.`,
      data: full,
    });
  } catch (err) {
    logger.error("[Bookings] reviewCancellation:", err.message);
    next(err);
  }
};

exports.getCancellationRequests = async (req, res, next) => {
  try {
    const status = req.query.status || CANCEL_REQUEST_STATUS.PENDING;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, parseInt(req.query.limit || "20", 10));
    const offset = (page - 1) * limit;

    const { rows } = await query(
      `SELECT b.*,
              COALESCE(d.name, b.destination_name) AS destination_name,
              COALESCE(u.full_name, b.full_name) AS user_name,
              u.email AS user_email
         FROM bookings b
         LEFT JOIN destinations d ON d.id = b.destination_id
         LEFT JOIN users u ON u.id = b.user_id
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

    return res.json({
      success: true,
      data: rows,
      bookings: rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
        has_next: page < Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = exports;