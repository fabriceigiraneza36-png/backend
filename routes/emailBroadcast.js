/**
 * routes/emailBroadcast.js
 * ═══════════════════════════════════════════════════════════════════════════════
 * Admin-only global email broadcast with audience targeting.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

"use strict";

const router = require("express").Router();
const ctrl = require("../controllers/emailBroadcastController");
const { protect, adminOnly } = require("../middleware/auth");

let asyncHandler;
try {
  asyncHandler = require("../middleware/asyncHandler");
} catch {
  // Inline fallback if the middleware is not present
  asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}

// Saved email campaign templates and recent send history
router.get("/templates", protect, adminOnly, asyncHandler(ctrl.getTemplates));
router.post("/templates", protect, adminOnly, asyncHandler(ctrl.saveTemplate));
router.get("/history", protect, adminOnly, asyncHandler(ctrl.getHistory));

// Distinct nationalities (for the audience dropdown)
router.get("/nationalities", protect, adminOnly, asyncHandler(ctrl.getNationalities));

// Preview recipient count for a given audience
router.post("/preview", protect, adminOnly, asyncHandler(ctrl.preview));

// Send the broadcast
router.post("/send", protect, adminOnly, asyncHandler(ctrl.send));

module.exports = router;
