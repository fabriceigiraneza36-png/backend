/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BOOKING ROUTES v2.0
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Fix: ensureBookingsSchema() called once on startup so 500 errors caused by
 * missing columns (e.g. booking_ref, whatsapp, etc.) never reach route handlers.
 */

"use strict";

const express    = require("express");
const rateLimit  = require("express-rate-limit");
const router     = express.Router();
const ctrl       = require("../controllers/bookingsController");
const { protect, adminOnly, optionalAuth } = require("../middleware/auth");
const { ensureBookingsSchema } = require("../config/db");
const logger     = require("../utils/logger");

// ── Schema guard: run once, non-blocking ──────────────────────────────────────

let _schemaReady = false;

(async () => {
  try {
    await ensureBookingsSchema();
    _schemaReady = true;
    logger.info("[Bookings] Schema ready");
  } catch (err) {
    logger.error("[Bookings] Schema init failed:", err.message);
  }
})();

// Middleware: ensure schema before any request is processed
router.use(async (_req, _res, next) => {
  if (_schemaReady) return next();
  try {
    await ensureBookingsSchema();
    _schemaReady = true;
    next();
  } catch (err) {
    logger.error("[Bookings] Schema ensure failed on request:", err.message);
    next(err);
  }
});

// ── Rate limiter ──────────────────────────────────────────────────────────────

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max:      10,
  message:  {
    success: false,
    error:   "Too many booking requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES  (no auth required)
// ─── All named routes MUST appear before /:id wildcard ───────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// Create a booking
router.post("/",                              bookingLimiter, optionalAuth, ctrl.create);

// Track by booking number
router.get("/track/:bookingNumber",           ctrl.track);

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
// ADMIN ROUTES  (named — must come before /:id wildcard)
// ═══════════════════════════════════════════════════════════════════════════════

router.get ("/stats",       adminOnly, ctrl.getStats);
router.get ("/upcoming",    adminOnly, ctrl.getUpcoming);
router.get ("/recent",      adminOnly, ctrl.getRecent);
router.get ("/export",      adminOnly, ctrl.export);
router.get ("/",            adminOnly, ctrl.getAll);

router.post("/bulk-status", adminOnly, ctrl.bulkUpdateStatus);

// ═══════════════════════════════════════════════════════════════════════════════
// WILDCARD /:id  — MUST be last
// ═══════════════════════════════════════════════════════════════════════════════

router.get   ("/:id",          adminOnly, ctrl.getOne);
router.put   ("/:id",          adminOnly, ctrl.update);
router.delete("/:id",          adminOnly, ctrl.remove);
router.patch ("/:id/status",   adminOnly, ctrl.updateStatus);
router.post  ("/:id/confirm",  adminOnly, ctrl.confirm);
router.post  ("/:id/cancel",   adminOnly, ctrl.cancel);
router.post  ("/:id/notes",    adminOnly, ctrl.addNotes);

module.exports = router;