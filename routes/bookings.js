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

// Rate limiting for booking creation
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 bookings per window
  message: { error: "Too many booking requests. Please try again later." },
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Rate limiting for booking creation
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 bookings per window
  message: { error: "Too many booking requests. Please try again later." },
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Create booking (public, with optional auth)
router.post("/", bookingLimiter, optionalAuth, bookingController.create);

// Track booking by number (public)
router.get("/track/:bookingNumber", bookingController.track);

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHENTICATED USER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Get user's own bookings
router.get("/my-bookings", protect, bookingController.getMyBookings);

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Dashboard endpoints
router.get("/stats", adminOnly, bookingController.getStats);
router.get("/upcoming", adminOnly, bookingController.getUpcoming);
router.get("/recent", adminOnly, bookingController.getRecent);
router.get("/export", adminOnly, bookingController.export);

// Bulk operations
router.post("/bulk-status", adminOnly, bookingController.bulkUpdateStatus);

// List all bookings
router.get("/", adminOnly, bookingController.getAll);

// Single booking operations
router.get("/:id", adminOnly, bookingController.getOne);
router.put("/:id", adminOnly, bookingController.update);
router.delete("/:id", adminOnly, bookingController.remove);

// Status updates
router.patch("/:id/status", adminOnly, bookingController.updateStatus);
router.post("/:id/confirm", adminOnly, bookingController.confirm);
router.post("/:id/cancel", adminOnly, bookingController.cancel);

// Notes
router.post("/:id/notes", adminOnly, bookingController.addNotes);

module.exports = router;
