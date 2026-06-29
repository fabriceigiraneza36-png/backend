// routes/bookingRoutes.js — OTP rate limiter adjusted
"use strict";

const express   = require("express");
const rateLimit = require("express-rate-limit");
const router    = express.Router();
const ctrl      = require("../controllers/bookingsController");
const { protect, adminOnly, optionalAuth } = require("../middleware/auth");
const logger    = require("../utils/logger");

/* ── Schema init (non-blocking) ─────────────────────────────────────────── */
let ensureBookingsSchema = null;
try {
  const db = require("../config/db");
  if (typeof db.ensureBookingsSchema === "function")
    ensureBookingsSchema = db.ensureBookingsSchema;
} catch (_) {}

let _schemaReady = !ensureBookingsSchema;

if (ensureBookingsSchema) {
  (async () => {
    try {
      await ensureBookingsSchema();
      _schemaReady = true;
      logger.info("[Bookings] Schema ready");
    } catch (err) {
      logger.error("[Bookings] Schema init failed:", err.message);
      _schemaReady = true;
    }
  })();
}

router.use(async (_req, _res, next) => {
  if (_schemaReady) return next();
  try {
    if (ensureBookingsSchema) await ensureBookingsSchema();
  } catch (err) {
    logger.warn("[Bookings] Schema ensure:", err.message);
  } finally {
    _schemaReady = true;
    next();
  }
});

/* ── Rate limiters ───────────────────────────────────────────────────────── */

const bookingLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,   // 15 min
  max:             10,
  message:         { success: false, error: "Too many booking requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders:   false,
  skip:            (req) => req.method === "GET",
});

/* ── OTP limiter — generous enough for real users ──
   Max 5 send-otp calls per IP per 5 minutes.
   The controller itself enforces the 60-second per-email cooldown.         ── */
const otpSendLimiter = rateLimit({
  windowMs:        5 * 60 * 1000,    // 5 min window
  max:             5,                 // 5 requests per IP per window
  message:         { success: false, error: "Too many verification code requests. Please wait a few minutes." },
  standardHeaders: true,
  legacyHeaders:   false,
  // Skip rate-limit for authenticated users (they skip OTP entirely)
  skip: (req) => !!req.headers.authorization,
  keyGenerator: (req) => {
    // Key by IP + email so one IP can help multiple users
    const email = (req.body?.email || "").toLowerCase().trim();
    return `${req.ip}:${email}`;
  },
});

const otpVerifyLimiter = rateLimit({
  windowMs:        5 * 60 * 1000,
  max:             10,               // more generous — user may mis-type
  message:         { success: false, error: "Too many verification attempts. Please wait." },
  standardHeaders: true,
  legacyHeaders:   false,
});

/* ══════════════════════════════════════════════════════════════════════════
   PUBLIC — named routes BEFORE /:id wildcard
   ══════════════════════════════════════════════════════════════════════════ */

// OTP
router.post("/send-otp",   otpSendLimiter,   ctrl.sendOtp);
router.post("/verify-otp", otpVerifyLimiter, ctrl.verifyOtp);

// Create booking (public + optional auth)
router.post("/", bookingLimiter, optionalAuth, ctrl.create);

// Tracking (public)
router.get("/track/:bookingNumber", ctrl.track);

// Public stats
router.get("/most-booked",                   ctrl.getMostBookedDestinations);
router.get("/countries-stats",               ctrl.getCountriesBookingStats);
router.get("/destinations-stats",            ctrl.getDestinationsBookingStats);
router.get("/by-destination/:destinationId", ctrl.getBookingsByDestination);
router.get("/by-country/:countryId",         ctrl.getBookingsByCountry);

/* ══════════════════════════════════════════════════════════════════════════
   AUTHENTICATED USER
   ══════════════════════════════════════════════════════════════════════════ */
router.get("/my-bookings", protect, ctrl.getMyBookings);

/* ══════════════════════════════════════════════════════════════════════════
   ADMIN — named, before /:id wildcard
   ══════════════════════════════════════════════════════════════════════════ */
router.get ("/stats",       adminOnly, ctrl.getStats);
router.get ("/upcoming",    adminOnly, ctrl.getUpcoming);
router.get ("/recent",      adminOnly, ctrl.getRecent);
router.get ("/export",      adminOnly, ctrl.export);
router.get ("/",            adminOnly, ctrl.getAll);
router.post("/admin",       adminOnly, ctrl.adminCreate);
router.post("/bulk-status", adminOnly, ctrl.bulkUpdateStatus);

/* ══════════════════════════════════════════════════════════════════════════
   WILDCARD /:id — MUST be last
   ══════════════════════════════════════════════════════════════════════════ */
router.get   ("/:id",         adminOnly, ctrl.getOne);
router.put   ("/:id",         adminOnly, ctrl.update);
router.delete("/:id",         adminOnly, ctrl.remove);
router.patch ("/:id/status",  adminOnly, ctrl.updateStatus);
router.post  ("/:id/confirm", adminOnly, ctrl.confirm);
router.post  ("/:id/cancel",  adminOnly, ctrl.cancel);
router.post  ("/:id/notes",   adminOnly, ctrl.addNotes);

module.exports = router;