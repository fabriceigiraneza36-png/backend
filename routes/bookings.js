/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BOOKING ROUTES v2.1
 * ═══════════════════════════════════════════════════════════════════════════════
 */

"use strict";

const express   = require("express");
const rateLimit = require("express-rate-limit");
const router    = express.Router();
const ctrl      = require("../controllers/bookingsController");
const { protect, adminOnly, optionalAuth } = require("../middleware/auth");
const logger    = require("../utils/logger");

// ── Try to import ensureBookingsSchema (non-fatal if missing) ─────────────────
let ensureBookingsSchema = null;
try {
  const db = require("../config/db");
  if (typeof db.ensureBookingsSchema === "function")
    ensureBookingsSchema = db.ensureBookingsSchema;
} catch (_) {}

let _schemaReady = false;

if (ensureBookingsSchema) {
  (async () => {
    try {
      await ensureBookingsSchema();
      _schemaReady = true;
      logger.info("[Bookings] Schema ready");
    } catch (err) {
      logger.error("[Bookings] Schema init failed:", err.message);
      _schemaReady = true; // Don't block requests on schema failure
    }
  })();
} else {
  _schemaReady = true;
}

// Schema middleware — non-blocking
router.use(async (_req, _res, next) => {
  if (_schemaReady || !ensureBookingsSchema) return next();
  try {
    await ensureBookingsSchema();
    _schemaReady = true;
    next();
  } catch (err) {
    logger.error("[Bookings] Schema ensure failed:", err.message);
    _schemaReady = true; // Don't block forever
    next();
  }
});

// ── Rate limiters ─────────────────────────────────────────────────────────────

const bookingLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  message:         { success: false, error: "Too many booking requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders:   false,
  skip:            (req) => req.method === "GET",
});

const otpLimiter = rateLimit({
  windowMs:        5 * 60 * 1000,
  max:             5,
  message:         { success: false, error: "Too many OTP requests. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES — named routes BEFORE /:id wildcard
// ═══════════════════════════════════════════════════════════════════════════════

// OTP
router.post("/send-otp",    otpLimiter,     ctrl.sendOtp);
router.post("/verify-otp",  otpLimiter,     ctrl.verifyOtp);

// Create booking
router.post("/",            bookingLimiter, optionalAuth, ctrl.create);

// Tracking (public)
router.get("/track/:bookingNumber", ctrl.track);

// Public stats
router.get("/most-booked",                   ctrl.getMostBookedDestinations);
router.get("/countries-stats",               ctrl.getCountriesBookingStats);
router.get("/destinations-stats",            ctrl.getDestinationsBookingStats);
router.get("/by-destination/:destinationId", ctrl.getBookingsByDestination);
router.get("/by-country/:countryId",         ctrl.getBookingsByCountry);

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHENTICATED USER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/my-bookings", protect, ctrl.getMyBookings);

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES — named, before /:id
// ═══════════════════════════════════════════════════════════════════════════════

router.get ("/stats",       adminOnly, ctrl.getStats);
router.get ("/upcoming",    adminOnly, ctrl.getUpcoming);
router.get ("/recent",      adminOnly, ctrl.getRecent);
router.get ("/export",      adminOnly, ctrl.export);
router.get ("/",            adminOnly, ctrl.getAll);

router.post("/bulk-status", adminOnly, ctrl.bulkUpdateStatus);

// ═══════════════════════════════════════════════════════════════════════════════
// WILDCARD /:id — MUST be last
// ═══════════════════════════════════════════════════════════════════════════════

router.get   ("/:id",         adminOnly, ctrl.getOne);
router.put   ("/:id",         adminOnly, ctrl.update);
router.delete("/:id",         adminOnly, ctrl.remove);
router.patch ("/:id/status",  adminOnly, ctrl.updateStatus);
router.post  ("/:id/confirm", adminOnly, ctrl.confirm);
router.post  ("/:id/cancel",  adminOnly, ctrl.cancel);
router.post  ("/:id/notes",   adminOnly, ctrl.addNotes);

module.exports = router;