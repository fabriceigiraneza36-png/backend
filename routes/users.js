/**
 * routes/users.js - User Auth & Profile Routes
 * Rate limiting DISABLED for smooth dev/production flow.
 */

const router = require("express").Router();
const ctrl = require("../controllers/usersController");
const { authenticateUser } = require("../middleware/userAuth");

// ── Public Auth Routes (No Rate Limits) ──────────────────────────────────────
router.post("/register", ctrl.register);
router.post("/login", ctrl.login);
router.post("/verify-code", ctrl.verifyCode);
router.post("/resend-code", ctrl.resendCode);
router.post("/google", ctrl.googleAuth);
router.post("/google/complete", ctrl.googleAuth); // Profile completion reuses same handler
router.post("/github", ctrl.githubAuth);
router.post("/forgot-password", ctrl.forgotPassword);
router.post("/reset-password", ctrl.resetPassword);
router.get("/verify/:token", ctrl.verifyEmail);
router.post("/check-email", ctrl.checkEmail);
router.post("/refresh-token", ctrl.refreshToken);

// ── Protected Routes (Require JWT) ───────────────────────────────────────────
router.get("/me", authenticateUser, ctrl.getMe);
router.put("/me", authenticateUser, ctrl.updateProfile);
router.put("/change-password", authenticateUser, ctrl.changePassword);
router.post("/logout", authenticateUser, ctrl.logout);
router.delete("/me", authenticateUser, ctrl.deleteAccount);

module.exports = router;
