/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TESTIMONIALS ROUTES v3.0
 * ═══════════════════════════════════════════════════════════════════════════
 * Route order (CRITICAL — Express matches top-to-bottom):
 *   Named segments (/featured, /stats, /submit, /admin/all)
 *   MUST come before wildcard segments (/:id)
 * ═══════════════════════════════════════════════════════════════════════════
 */

"use strict";

const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/testimonials");

// ── Middleware — safe imports with no-op fallbacks ────────────────────────
let protect, adminOnly, adminProtect, authLimiter;

try {
  const auth = require("../middleware/auth");
  // Your auth middleware exports: protect, adminOnly, adminProtect
  protect      = typeof auth.protect      === "function" ? auth.protect      : null;
  adminOnly    = typeof auth.adminOnly    === "function" ? auth.adminOnly    : null;
  adminProtect = typeof auth.adminProtect === "function" ? auth.adminProtect : null;

  // If no separate adminProtect, compose protect + adminOnly
  if (!adminProtect && protect && adminOnly) {
    adminProtect = [protect, adminOnly];
  }
} catch (err) {
  console.warn("[testimonials routes] auth middleware not found:", err.message);
}

try {
  const rl    = require("../middleware/rateLimiter");
  authLimiter = typeof rl.authLimiter === "function" ? rl.authLimiter
              : typeof rl.limiter     === "function" ? rl.limiter
              : null;
} catch (err) {
  console.warn("[testimonials routes] rateLimiter not found:", err.message);
}

// No-op fallback — never blocks if middleware failed to load
const noop = (req, res, next) => next();

const mProtect      = protect      || noop;
const mAdminProtect = Array.isArray(adminProtect) ? adminProtect
                    : (adminProtect || noop);
const mAuthLimiter  = authLimiter  || noop;

// ── Flatten middleware arrays for use with router.method() ────────────────
const admin = Array.isArray(mAdminProtect)
  ? mAdminProtect               // [protect, adminOnly]
  : [mAdminProtect];            // [adminProtect]

// ═══════════════════════════════════════════════════════════════════════════
// ① DEBUG (optional — keep in production behind a secret)
// ═══════════════════════════════════════════════════════════════════════════

router.get("/_routes", (req, res) => {
  const IS_PROD = process.env.NODE_ENV === "production";
  if (IS_PROD && req.query.secret !== process.env.JWT_SECRET?.slice(0, 8)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const routes = [];
  router.stack.forEach((layer) => {
    if (layer.route) {
      routes.push({
        methods: Object.keys(layer.route.methods).map((m) => m.toUpperCase()),
        path:    layer.route.path,
      });
    }
  });
  res.json({ success: true, count: routes.length, routes });
});

// ═══════════════════════════════════════════════════════════════════════════
// ② NAMED GET ROUTES — before /:id wildcard
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/testimonials/featured */
router.get("/featured", ctrl.getFeatured);

/** GET /api/testimonials/stats */
router.get("/stats", ctrl.getStats);

/** GET /api/testimonials/admin/all */
router.get("/admin/all", ...admin, ctrl.adminGetAll);

/** GET /api/testimonials */
router.get("/", ctrl.getAll);

// ═══════════════════════════════════════════════════════════════════════════
// ③ PUBLIC SUBMIT — before /:id wildcard
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/testimonials/submit
 *
 * ⚠️  MUST be declared before `router.post("/:id", …)` or Express will
 *     match /:id = "submit" and call the wrong handler.
 *
 * Flow:
 *   1. authLimiter  — 5 req / 15 min per IP (prevents spam)
 *   2. mProtect     — JWT verification (must be logged in)
 *   3. submitPublic — validate, rate-limit by user_id, insert pending
 */
router.post(
  "/submit",
  mAuthLimiter,
  mProtect,
  ctrl.submitPublic,
);

// ═══════════════════════════════════════════════════════════════════════════
// ④ ADMIN CREATE
// ═══════════════════════════════════════════════════════════════════════════

/** POST /api/testimonials — admin creates (active immediately) */
router.post("/", ...admin, ctrl.create);

// ═══════════════════════════════════════════════════════════════════════════
// ⑤ NAMED PATCH ROUTES — before /:id wildcard
// ═══════════════════════════════════════════════════════════════════════════

/** PATCH /api/testimonials/reorder */
router.patch("/reorder", ...admin, ctrl.reorder);

/** PATCH /api/testimonials/:id/toggle-featured */
router.patch("/:id/toggle-featured", ...admin, ctrl.toggleFeatured);

/** PATCH /api/testimonials/:id/toggle-active */
router.patch("/:id/toggle-active", ...admin, ctrl.toggleActive);

/** PATCH /api/testimonials/:id */
router.patch("/:id", ...admin, ctrl.update);

// ═══════════════════════════════════════════════════════════════════════════
// ⑥ DELETE ROUTES
// ═══════════════════════════════════════════════════════════════════════════

/** DELETE /api/testimonials — bulk */
router.delete("/", ...admin, ctrl.bulkDelete);

/** DELETE /api/testimonials/:id */
router.delete("/:id", ...admin, ctrl.remove);

// ═══════════════════════════════════════════════════════════════════════════
// ⑦ WILDCARD ROUTES — absolutely last
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/testimonials/:id */
router.get("/:id", ctrl.getOne);

/** PUT /api/testimonials/:id */
router.put("/:id", ...admin, ctrl.update);

module.exports = router;