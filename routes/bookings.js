/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA TRAVEL - BOOKING ROUTES
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { authenticate, authenticateAdmin, optionalAuth } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const rateLimit = require('express-rate-limit');

// Rate limiting for booking creation
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 bookings per window
  message: { error: 'Too many booking requests. Please try again later.' }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Create booking (public, with optional auth)
router.post('/', bookingLimiter, optionalAuth, bookingController.create);

// Track booking by number (public)
router.get('/track/:bookingNumber', bookingController.track);

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHENTICATED USER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Get user's own bookings
router.get('/my-bookings', authenticate, bookingController.getMyBookings);

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Dashboard endpoints
router.get('/stats', authenticateAdmin, bookingController.getStats);
router.get('/upcoming', authenticateAdmin, bookingController.getUpcoming);
router.get('/recent', authenticateAdmin, bookingController.getRecent);
router.get('/export', authenticateAdmin, bookingController.export);

// Bulk operations
router.post('/bulk-status', authenticateAdmin, bookingController.bulkUpdateStatus);

// List all bookings
router.get('/', authenticateAdmin, bookingController.getAll);

// Single booking operations
router.get('/:id', authenticateAdmin, bookingController.getOne);
router.put('/:id', authenticateAdmin, bookingController.update);
router.delete('/:id', authenticateAdmin, bookingController.remove);

// Status updates
router.patch('/:id/status', authenticateAdmin, bookingController.updateStatus);
router.post('/:id/confirm', authenticateAdmin, bookingController.confirm);
router.post('/:id/cancel', authenticateAdmin, bookingController.cancel);

// Notes
router.post('/:id/notes', authenticateAdmin, bookingController.addNotes);

module.exports = router;