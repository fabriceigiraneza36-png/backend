const router = require("express").Router();
const ctrl = require("../controllers/bookingsController");
const { authenticate, authorize } = require("../middleware/auth");
const { bookingLimiter } = require("../middleware/rateLimiter");
const asyncHandler = require("../middleware/asyncHandler");
const { validateBookingNumber } = require("../utils/validators");

// ═══════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════

// Create booking
router.post("/", bookingLimiter, asyncHandler(ctrl.create));

// Track booking by booking number
router.get(
  "/track/:bookingNumber",
  asyncHandler(async (req, res, next) => {
    const { bookingNumber } = req.params;

    if (!validateBookingNumber(bookingNumber)) {
      return res.status(400).json({
        success: false,
        error: "Invalid booking number format.",
      });
    }

    return ctrl.track(req, res, next);
  })
);

// ═══════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════

// Get all bookings (admin only)
router.get("/", authenticate, authorize("admin"), asyncHandler(ctrl.getAll));

// Get booking statistics
router.get("/stats", authenticate, authorize("admin"), asyncHandler(ctrl.getStats));

// Get single booking
router.get("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.getOne));

// Update booking
router.put("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.update));

// Delete booking
router.delete("/:id", authenticate, authorize("admin"), asyncHandler(ctrl.remove));

module.exports = router;