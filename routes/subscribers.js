/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SUBSCRIBERS ROUTES v2.0
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Fix: ensureSubscribersSchema() called once at startup so 500 errors caused by
 * missing columns (welcome_sent_at, welcome_error, tags, etc.) never fire.
 */

"use strict";

const router       = require("express").Router();
const ctrl         = require("../controllers/subscribersController");
const { protect, adminOnly } = require("../middleware/auth");
const { contactLimiter }     = require("../middleware/rateLimiter");
const asyncHandler           = require("../middleware/asyncHandler");
const { ensureSubscribersSchema } = require("../config/db");
const logger                 = require("../utils/logger");

// ── Schema guard: run once at cold-start ──────────────────────────────────────

let _schemaReady = false;

(async () => {
  try {
    await ensureSubscribersSchema();
    _schemaReady = true;
    logger.info("[Subscribers] Schema ready");
  } catch (err) {
    logger.error("[Subscribers] Schema init failed:", err.message);
  }
})();

// Per-request guard in case the IIFE hasn't resolved yet
router.use(async (_req, _res, next) => {
  if (_schemaReady) return next();
  try {
    await ensureSubscribersSchema();
    _schemaReady = true;
    next();
  } catch (err) {
    logger.error("[Subscribers] Schema ensure failed on request:", err.message);
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Subscribe
router.post(
  "/",
  contactLimiter,
  asyncHandler(ctrl.subscribe),
);

// Unsubscribe via email link (GET) or API call (DELETE)
router.get   ("/unsubscribe/:email", asyncHandler(ctrl.unsubscribe));
router.delete("/unsubscribe/:email", asyncHandler(ctrl.unsubscribe));

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/",
  protect, adminOnly,
  asyncHandler(ctrl.getAll),
);

router.get(
  "/stats",
  protect, adminOnly,
  asyncHandler(ctrl.getStats),
);

router.post(
  "/resend-welcome/:id",
  protect, adminOnly,
  asyncHandler(ctrl.resendWelcome),
);

router.delete(
  "/:id",
  protect, adminOnly,
  asyncHandler(ctrl.remove),
);

module.exports = router;