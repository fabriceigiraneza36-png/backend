// routes/users.js — CRITICAL: specific routes MUST come before /:id wildcard
// Current order is BROKEN — /me, /export get swallowed by /:id (adminProtect)

const router = require("express").Router();
const auth = require("../controllers/authController");
const { protect, adminOnly, adminProtect } = require("../middleware/auth");
const { authLimiter, verifyLimiter } = require("../middleware/rateLimiter");
const { query } = require("../config/db");

// ═══════════════════════════════════════════════════════════════
// PUBLIC — Stats (no auth)
// ═══════════════════════════════════════════════════════════════
router.get("/stats", async (req, res) => {
  try {
    const [totalRes, todayRes, weekRes, monthRes, verifiedRes] =
      await Promise.all([
        query(`SELECT COUNT(*) AS total FROM users`),
        query(`SELECT COUNT(*) AS count FROM users WHERE created_at >= CURRENT_DATE`),
        query(`SELECT COUNT(*) AS count FROM users WHERE created_at >= NOW() - INTERVAL '7 days'`),
        query(`SELECT COUNT(*) AS count FROM users WHERE created_at >= NOW() - INTERVAL '30 days'`),
        query(`SELECT COUNT(*) AS count FROM users WHERE is_verified = true`),
      ]);

    return res.status(200).json({
      success: true,
      data: {
        totalUsers:        parseInt(totalRes.rows[0]?.total   || 0),
        newUsersToday:     parseInt(todayRes.rows[0]?.count   || 0),
        newUsersThisWeek:  parseInt(weekRes.rows[0]?.count    || 0),
        newUsersThisMonth: parseInt(monthRes.rows[0]?.count   || 0),
        verifiedUsers:     parseInt(verifiedRes.rows[0]?.count || 0),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user stats",
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// PUBLIC — OTP Auth flow
// MUST be before /:id to avoid wildcard capture
// ═══════════════════════════════════════════════════════════════
router.post("/register",    authLimiter,   auth.register);
router.post("/login",       authLimiter,   auth.login);
router.post("/verify-code", verifyLimiter, auth.verifyCode);
router.post("/verify",      verifyLimiter, auth.verifyCode);
router.post("/resend-code", authLimiter,   auth.resendCode);
router.post("/check-email",                auth.checkEmail);

// ═══════════════════════════════════════════════════════════════
// PUBLIC — Social Auth
// ═══════════════════════════════════════════════════════════════
router.post("/google", authLimiter, auth.googleAuth);
router.post("/google/signin", authLimiter, auth.googleAuth);
router.post("/google/signup-init", authLimiter, auth.googleAuth);
router.post("/google/signup-complete", authLimiter, auth.completeGoogleSignUp);
router.post("/github", authLimiter, auth.githubAuth);
router.get("/github/signin", authLimiter, auth.githubSignInInit);
router.get("/github/signup", authLimiter, auth.githubSignUpInit);
router.get("/github/callback", authLimiter, auth.githubCallback);

// ═══════════════════════════════════════════════════════════════
// PUBLIC — Token refresh
// ═══════════════════════════════════════════════════════════════
router.post("/refresh-token", auth.refreshToken);

// ═══════════════════════════════════════════════════════════════
// PROTECTED — Authenticated user routes
// MUST be before /:id wildcard
// ═══════════════════════════════════════════════════════════════
router.get("/me",        protect, auth.getMe);
router.get("/profile",   protect, auth.getMe);
router.put("/profile",   protect, auth.updateProfile);
router.post("/logout",   protect, auth.logout);
router.delete("/me",     protect, auth.deleteAccount);

// ═══════════════════════════════════════════════════════════════
// ADMIN — Export (before /:id wildcard)
// ═══════════════════════════════════════════════════════════════
router.get("/export", adminProtect, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, full_name, phone, nationality,
              auth_provider, is_verified, is_active, created_at
         FROM users ORDER BY created_at DESC`,
    );

    const csv = [
      "ID,Email,Full Name,Phone,Nationality,Provider,Verified,Active,Created",
      ...result.rows.map((r) =>
        [
          r.id,
          r.email,
          r.full_name  || "",
          r.phone      || "",
          r.nationality || "",
          r.auth_provider || "",
          r.is_verified,
          r.is_active,
          r.created_at?.toISOString?.() || "",
        ].join(","),
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=users-${Date.now()}.csv`,
    );
    return res.send(csv);
  } catch (error) {
    return res.status(500).json({
      success: false, message: "Failed to export users", error: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN — List all users
// ═══════════════════════════════════════════════════════════════
router.get("/", adminProtect, async (req, res) => {
  try {
    const {
      page = 1, limit = 20, search, status,
      sortBy = "created_at", order = "desc",
    } = req.query;

    const offset     = (parseInt(page) - 1) * parseInt(limit);
    const conditions = ["1=1"];
    const params     = [];
    let p = 1;

    if (search) {
      conditions.push(
        `(full_name ILIKE $${p} OR email ILIKE $${p} OR phone ILIKE $${p})`,
      );
      params.push(`%${search}%`);
      p++;
    }

    if (status === "active")   conditions.push(`is_active = true`);
    if (status === "inactive") conditions.push(`is_active = false`);
    if (status === "verified") conditions.push(`is_verified = true`);

    const allowedSort = ["created_at","updated_at","email","full_name","last_login"];
    const col  = allowedSort.includes(sortBy) ? sortBy : "created_at";
    const dir  = order === "asc" ? "ASC" : "DESC";
    const where = conditions.join(" AND ");

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT id, email, full_name, avatar_url, phone, nationality,
                auth_provider, is_verified, is_active,
                last_login, created_at, updated_at
           FROM users
          WHERE ${where}
          ORDER BY ${col} ${dir}
          LIMIT $${p} OFFSET $${p + 1}`,
        [...params, parseInt(limit), offset],
      ),
      query(
        `SELECT COUNT(*) AS total FROM users WHERE ${where}`, params,
      ),
    ]);

    const total = parseInt(countRes.rows[0]?.total || 0);

    return res.json({
      success: true,
      data: dataRes.rows,
      pagination: {
        page:    parseInt(page),
        limit:   parseInt(limit),
        total,
        pages:   Math.ceil(total / parseInt(limit)),
        hasMore: parseInt(page) * parseInt(limit) < total,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false, message: "Failed to fetch users", error: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN — Single user, update, activate, deactivate, delete
// /:id MUST be last — it's the wildcard catch-all
// ═══════════════════════════════════════════════════════════════
router.get("/:id", adminProtect, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, full_name, avatar_url, phone, nationality,
              auth_provider, is_verified, is_active,
              last_login, created_at, updated_at
         FROM users WHERE id = $1`,
      [req.params.id],
    );
    if (!result.rows[0])
      return res.status(404).json({ success: false, message: "User not found" });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/:id", adminProtect, async (req, res) => {
  try {
    const { full_name, phone, nationality, is_active, is_verified } = req.body;
    const result = await query(
      `UPDATE users SET
         full_name   = COALESCE($1, full_name),
         phone       = COALESCE($2, phone),
         nationality = COALESCE($3, nationality),
         is_active   = COALESCE($4, is_active),
         is_verified = COALESCE($5, is_verified),
         updated_at  = NOW()
       WHERE id = $6
       RETURNING id, email, full_name, phone, nationality,
                 is_active, is_verified, created_at, updated_at`,
      [
        full_name   || null,
        phone       || null,
        nationality || null,
        is_active   !== undefined ? is_active   : null,
        is_verified !== undefined ? is_verified : null,
        req.params.id,
      ],
    );
    if (!result.rows[0])
      return res.status(404).json({ success: false, message: "User not found" });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/:id/activate", adminProtect, async (req, res) => {
  try {
    await query(
      `UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1`,
      [req.params.id],
    );
    return res.json({ success: true, message: "User activated" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/:id/deactivate", adminProtect, async (req, res) => {
  try {
    await query(
      `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [req.params.id],
    );
    return res.json({ success: true, message: "User deactivated" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete("/:id", adminProtect, async (req, res) => {
  try {
    await query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
    return res.json({ success: true, message: "User deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;