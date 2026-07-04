// routes/bookings.js
"use strict";

const express   = require("express");
const rateLimit = require("express-rate-limit");
const router    = express.Router();
const ctrl      = require("../controllers/bookingsController");
const { protect, adminOnly, optionalAuth } = require("../middleware/auth");
const logger    = require("../utils/logger");

/* ── Schema init ─────────────────────────────────────────────────────────── */
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
      _schemaReady = true;
      logger.error("[Bookings] Schema init failed:", err.message);
    }
  })();
}

router.use(async (_req, _res, next) => {
  if (_schemaReady) return next();
  try { if (ensureBookingsSchema) await ensureBookingsSchema(); }
  catch (e) { logger.warn("[Bookings] Schema ensure:", e.message); }
  finally { _schemaReady = true; next(); }
});

/* ── Rate limiters ───────────────────────────────────────────────────────── */
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message:  { success: false, error: "Too many booking requests. Please try again later." },
  standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.method === "GET",
});

/* ══════════════════════════════════════════════════════════════════════════
   PUBLIC ROUTES
══════════════════════════════════════════════════════════════════════════ */

/* ── Email verification link — GET so it works from email client click ── */
router.get("/verify-email/:token", ctrl.verifyEmail);

/* ── Create booking (public, optionally authenticated) ── */
router.post("/", bookingLimiter, optionalAuth, ctrl.create);

/* ── Resend verification link ── */
router.post("/:id/resend-verification", bookingLimiter, ctrl.resendVerification);

/* ── Public tracking ── */
router.get("/track/:bookingNumber", ctrl.track);

/* ── Public stats ── */
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
   ADMIN — named routes before /:id wildcard
══════════════════════════════════════════════════════════════════════════ */
router.get ("/stats",            adminOnly, ctrl.getStats);
router.get ("/upcoming",         adminOnly, ctrl.getUpcoming);
router.get ("/recent",           adminOnly, ctrl.getRecent);
router.get ("/export",           adminOnly, ctrl.export);
router.get ("/",                 adminOnly, ctrl.getAll);
router.post("/admin",            adminOnly, ctrl.adminCreate);
router.post("/bulk-status",      adminOnly, ctrl.bulkUpdateStatus);
router.post("/send-countdowns",  adminOnly, ctrl.sendCountdownEmails);

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