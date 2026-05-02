/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA TRAVEL - BOOKING ROUTES
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require("express");
const router = express.Router();
const bookingController = require("../controllers/bookingsController");
const { protect, adminOnly, optionalAuth } = require("../middleware/auth");
const rateLimit = require("express-rate-limit");

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: "Too many booking requests. Please try again later." },
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// (must all be defined before the /:id wildcard)
// ─────────────────────────────────────────────────────────────────────────────

// Create booking
router.post("/", bookingLimiter, optionalAuth, bookingController.create);

// Track booking by number
router.get("/track/:bookingNumber", bookingController.track);

// Most booked destinations
router.get("/most-booked", bookingController.getMostBookedDestinations);

// Booking stats by destination
router.get("/by-destination/:destinationId", bookingController.getBookingsByDestination);

// Booking stats by country
router.get("/by-country/:countryId", bookingController.getBookingsByCountry);

// All countries with booking stats
router.get("/countries-stats", bookingController.getCountriesBookingStats);

// All destinations with booking stats
router.get("/destinations-stats", bookingController.getDestinationsBookingStats);

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATED USER ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// IMPORTANT: Must be defined BEFORE /:id wildcard route
router.get("/my-bookings", protect, bookingController.getMyBookings);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES
// All defined BEFORE the /:id catch-all
// ─────────────────────────────────────────────────────────────────────────────

router.get("/stats",       adminOnly, bookingController.getStats);
router.get("/upcoming",    adminOnly, bookingController.getUpcoming);
router.get("/recent",      adminOnly, bookingController.getRecent);
router.get("/export",      adminOnly, bookingController.export);

// Bulk operations
router.post("/bulk-status", adminOnly, bookingController.bulkUpdateStatus);

// List all bookings
router.get("/", adminOnly, bookingController.getAll);

// ─────────────────────────────────────────────────────────────────────────────
// WILDCARD /:id ROUTES — MUST BE LAST
// ─────────────────────────────────────────────────────────────────────────────

router.get   ("/:id",             adminOnly, bookingController.getOne);
router.put   ("/:id",             adminOnly, bookingController.update);
router.delete("/:id",             adminOnly, bookingController.remove);
router.patch ("/:id/status",      adminOnly, bookingController.updateStatus);
router.post  ("/:id/confirm",     adminOnly, bookingController.confirm);
router.post  ("/:id/cancel",      adminOnly, bookingController.cancel);
router.post  ("/:id/notes",       adminOnly, bookingController.addNotes);

module.exports = router;