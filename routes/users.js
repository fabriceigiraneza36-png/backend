// routes/users.js
const router = require("express").Router();
const auth   = require("../controllers/authController");
const { protect }                    = require("../middleware/auth");
const { authLimiter, verifyLimiter } = require("../middleware/rateLimiter");
const { query }                      = require("../config/db");

// ═══════════════════════════════════════════════════════════════
// PUBLIC — Stats (called by frontend dashboard/homepage)
// GET /api/users/stats
// ═══════════════════════════════════════════════════════════════
router.get("/stats", async (req, res) => {
  try {
    const [totalRes, todayRes, weekRes, monthRes, verifiedRes] =
      await Promise.all([
        // Total registered users
        query(`SELECT COUNT(*) AS total FROM users`),

        // New users today
        query(
          `SELECT COUNT(*) AS count
           FROM users
           WHERE created_at >= CURRENT_DATE`
        ),

        // New users this week
        query(
          `SELECT COUNT(*) AS count
           FROM users
           WHERE created_at >= NOW() - INTERVAL '7 days'`
        ),

        // New users this month
        query(
          `SELECT COUNT(*) AS count
           FROM users
           WHERE created_at >= NOW() - INTERVAL '30 days'`
        ),

        // Verified users count
        query(
          `SELECT COUNT(*) AS count
           FROM users
           WHERE is_verified = true`
        ),
      ]);

    return res.status(200).json({
      success: true,
      data: {
        totalUsers:        parseInt(totalRes.rows[0]?.total    || 0),
        newUsersToday:     parseInt(todayRes.rows[0]?.count    || 0),
        newUsersThisWeek:  parseInt(weekRes.rows[0]?.count     || 0),
        newUsersThisMonth: parseInt(monthRes.rows[0]?.count    || 0),
        verifiedUsers:     parseInt(verifiedRes.rows[0]?.count || 0),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user stats",
      error:   error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// PUBLIC — OTP flow
// ═══════════════════════════════════════════════════════════════
router.post("/register",     authLimiter,   auth.register);
router.post("/login",        authLimiter,   auth.login);
router.post("/verify-code",  verifyLimiter, auth.verifyCode);
router.post("/resend-code",  authLimiter,   auth.resendCode);
router.post("/check-email",                 auth.checkEmail);

// ═══════════════════════════════════════════════════════════════
// PUBLIC — Social Auth
// ═══════════════════════════════════════════════════════════════
router.post("/google", authLimiter, auth.googleAuth);
router.post("/github", authLimiter, auth.githubAuth);

// ═══════════════════════════════════════════════════════════════
// PUBLIC — Token refresh
// ═══════════════════════════════════════════════════════════════
router.post("/refresh-token", auth.refreshToken);

// ═══════════════════════════════════════════════════════════════
// PROTECTED — User routes
// ═══════════════════════════════════════════════════════════════
router.get("/me",       protect, auth.getMe);
router.put("/profile",  protect, auth.updateProfile);
router.post("/logout",  protect, auth.logout);
router.delete("/me",    protect, auth.deleteAccount);

module.exports = router;