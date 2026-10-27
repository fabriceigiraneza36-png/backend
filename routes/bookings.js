// routes/bookings.js
const express = require('express')
const router = express.Router()
const { optionalAuth, protect, adminOnly } = require('../middleware/auth')
const bookingsController = require('../controllers/bookingsController')

// ── 1. PUBLIC / GUEST & USER ROUTES ──────────────────────────────────────────

// Create a new booking (Sends verification email or booking received email)
router.post('/', protect, bookingsController.create)

// Verify guest email via link in email
router.get('/verify-email/:token', bookingsController.verifyEmail)

// Resend email verification link
router.post('/resend-verification/:id', bookingsController.resendVerification)

// Track booking status publicly using booking number (e.g. /api/bookings/track/BK12345678)
router.get('/track/:bookingNumber', bookingsController.track)

// Get logged-in user's bookings (matched by user_id or email)
router.get('/my', optionalAuth, bookingsController.getMyBookings)

// Customer requests a cancellation or refund
router.post('/:id/cancel-request', optionalAuth, bookingsController.requestCancellation)


// ── 2. ADMIN STATS & AGGREGATE ROUTES ────────────────────────────────────────
// (Placed BEFORE /:id to avoid router matching "stats", "export", etc. as IDs)

// General stats, trends & conversion rates
router.get('/stats', adminOnly, bookingsController.getStats)

// Country booking statistics
router.get('/stats/countries', adminOnly, bookingsController.getCountriesBookingStats)

// Destination booking statistics
router.get('/stats/destinations', adminOnly, bookingsController.getDestinationsBookingStats)

// List of cancellation and refund requests
router.get('/cancel-requests', adminOnly, bookingsController.getCancellationRequests)

// Upcoming bookings countdown list
router.get('/upcoming', adminOnly, bookingsController.getUpcoming)

// Recent bookings list
router.get('/recent', adminOnly, bookingsController.getRecent)

// Most booked destinations list
router.get('/destinations/most-booked', bookingsController.getMostBookedDestinations)

// Bookings filtered by destination ID
router.get('/destinations/:destinationId', bookingsController.getBookingsByDestination)

// Bookings filtered by country ID
router.get('/countries/:countryId', bookingsController.getBookingsByCountry)

// Export bookings data (JSON / CSV)
router.get('/export', adminOnly, bookingsController.export)

// Bulk update booking statuses
router.post('/bulk-status', adminOnly, bookingsController.bulkUpdateStatus)

// Manually trigger countdown notification emails
router.post('/send-countdown-emails', adminOnly, bookingsController.sendCountdownEmails)


// ── 3. GENERAL & ADMIN MANAGEMENT ROUTES ─────────────────────────────────────

// Get all bookings with pagination, search, and status filters
router.get('/', adminOnly, bookingsController.getAll)

// Create a booking manually as admin (auto-confirms and sends confirmation email)
router.post('/admin', adminOnly, bookingsController.adminCreate)

// Get single booking details with activity history
router.get('/:id', adminOnly, bookingsController.getOne)

// Update booking information
router.put('/:id', adminOnly, bookingsController.update)

// Update booking status (Sends status change/cancellation/confirmation emails)
router.patch('/:id/status', adminOnly, bookingsController.updateStatus)

// Approve or reject a cancellation / refund request
router.post('/:id/cancel-review', adminOnly, bookingsController.reviewCancellation)

// Add administrative or internal notes to a booking
router.post('/:id/notes', adminOnly, bookingsController.addNotes)

// Delete a booking record
router.delete('/:id', adminOnly, bookingsController.remove)

module.exports = router