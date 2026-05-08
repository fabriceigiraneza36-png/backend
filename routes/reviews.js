// routes/reviews.js
// ============================================================
// Reviews Routes — Global Reviews Endpoints
// ============================================================

const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/reviewsController");

/* ═══════════════════════════════════════════════════════════════
   PUBLIC ROUTES
   ═══════════════════════════════════════════════════════════════ */

router.get("/stats", ctrl.getStats);

module.exports = router;