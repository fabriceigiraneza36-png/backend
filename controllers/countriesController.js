// controllers/countriesController.js
"use strict";

const crypto = require("crypto");
const { query } = require("../config/db");
const logger = require("../utils/logger");

/* ═══════════════════════════════════════════════════════════════════════════════════════
    SAFE REQUIRE: HELPERS
════════════════════════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════════════════════
    EMAIL SERVICE
══════════════════════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════════════════════
    SAFE REQUIRE: NOTIFICATIONS / MESSAGING / SOCKET
═══════════════════════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════════════════════
    CONSTANTS
═══════════════════════════════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════════════════════════════
    SAFE VALUE HELPERS
════════════════════════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════════════════════
    BUSINESS HELPERS
════════════════════════════════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════════════════════════════
    NOTIFICATIONS
══════════════════════════════════════════════════════════════════════════════════════ */
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
    const bookingType = booking.booking_type || "booking";
    return await createNotificationInternal({
      userId: user?.id || null,
      userEmail: user?.email || null,
      type: "booking_created",
      category: bookingType,
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
    // Determine category based on booking type, fallback to 'booking'
    const bookingType = booking.booking_type || 'custom';
    const validCategories = ['destination', 'service', 'package', 'custom'];
    const category = validCategories.includes(bookingType) ? bookingType : 'booking';
    
    createNotificationInternal({
      targetScope: "role",
      targetRole: "admin",
      type: "booking_created",
      category: category,
      title: "🔔 New booking request",
      message: `Booking ${booking?.booking_number || ""} from ${booking?.full_name || "a traveller"}.`,
      actionUrl: "/bookings",
      actionLabel: "Review",
      priority: "high",
      metadata: { bookingNumber: booking?.booking_number || null, bookingType },
    }).catch(() => {});
  } catch {
    // non-fatal
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════════════
    NORMALIZE BOOKING DATA
═══════════════════════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════════════════════
    VALIDATION
═══════════════════════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════════════════════
    ACTIVITY LOG
════════════════════════════════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════════════════════════════
    BOOKING DETAIL
═══════════════════════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════════════════════
    SCHEMA
═══════════════════════════════════════════════════════════════════════════════════════ */
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
        user_id INTEGER,
        package_id INTEGER,
        service_id INTEGER,
        country_id INTEGER,
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

/* ═══════════════════════════════════════════════════════════════════════════════════════
    CREATE BOOKING — POST /api/bookings
════════════════════════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════════════════════
    VERIFY EMAIL
════════════════════════════════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════════════════════════════
    RESEND VERIFICATION
════════════════════════════════════════════════════════════════════════════════════════ */
exports.resendVerification = async (req, res, next) => {
  try {
    const id = safeId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, error: "Invalid booking ID" });
    }

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

/* ══════════════════════════════════════════════════════════════════════════════════════
    ADMIN CREATE
══════════════════════════════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════════════════════════════
    GET ALL BOOKINGS
═══════════════════════════════════════════════════════════════════════════════════════ */
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

/* ═