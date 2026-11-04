/**
 * routes/emailBroadcast.js
 * ═══════════════════════════════════════════════════════════════════════════════
 * Admin-only global email broadcast with audience targeting.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

"use strict";

const router = require("express").Router();
const ctrl = require("../controllers/emailBroadcastController");
const contentCampaign = require("../controllers/contentCampaignController");
const upload = require("../middleware/upload");
const { protect, adminOnly } = require("../middleware/auth");

let asyncHandler;
try {
  asyncHandler = require("../middleware/asyncHandler");
} catch {
  // Inline fallback if the middleware is not present
  asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}

// Content-aware campaign studio: real records, media, saved recipient audiences.
router.get("/content/library", protect, adminOnly, asyncHandler(contentCampaign.getContentLibrary));
router.post("/content/:type/:id/images", protect, adminOnly, upload.array("images", 8), asyncHandler(contentCampaign.uploadContentImages));
router.post("/assets/upload", protect, adminOnly, upload.array("images", 8), asyncHandler(contentCampaign.uploadGalleryAssets));
router.get("/recipients", protect, adminOnly, asyncHandler(contentCampaign.getRecipients));
router.get("/audience-settings", protect, adminOnly, asyncHandler(contentCampaign.getAudienceSettings));
router.put("/audience-settings", protect, adminOnly, asyncHandler(contentCampaign.updateAudienceSettings));
router.post("/audiences", protect, adminOnly, asyncHandler(contentCampaign.saveAudienceList));
router.delete("/audiences/:id", protect, adminOnly, asyncHandler(contentCampaign.deleteAudienceList));
router.post("/content-preview", protect, adminOnly, asyncHandler(contentCampaign.preview));
router.post("/content-send", protect, adminOnly, asyncHandler(contentCampaign.send));

// Automatic contextual email queue: pending preview, retouch, or immediate send
router.get("/queue/pending", protect, adminOnly, asyncHandler(ctrl.getPendingQueue));
router.put("/queue/:id/template", protect, adminOnly, asyncHandler(ctrl.updateQueuedTemplate));
router.post("/queue/:id/send-now", protect, adminOnly, asyncHandler(ctrl.sendQueuedNow));

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
