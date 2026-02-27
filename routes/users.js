/**
 * routes/users.js - User routes
 */

const router = require("express").Router();
const ctrl = require("../controllers/usersController");
const { authenticateUser } = require("../middleware/userAuth");
const { authLimiter, verifyLimiter } = require("../middleware/rateLimiter");

// Public routes
router.post("/register", authLimiter, ctrl.register);
router.post("/login", authLimiter, ctrl.login);
router.post("/verify-code", verifyLimiter, ctrl.verifyCode);
router.post("/resend-code", authLimiter, ctrl.resendCode);
router.post("/google", authLimiter, ctrl.googleAuth);
router.post("/github", authLimiter, ctrl.githubAuth);
router.post("/forgot-password", authLimiter, ctrl.forgotPassword);
router.post("/reset-password", authLimiter, ctrl.resetPassword);
router.get("/verify/:token", ctrl.verifyEmail);
router.post("/check-email", ctrl.checkEmail);

// Protected routes (require authentication)
router.get("/me", authenticateUser, ctrl.getMe);
router.put("/me", authenticateUser, ctrl.updateMe);
router.put("/change-password", authenticateUser, ctrl.changePassword);
router.post("/logout", authenticateUser, ctrl.logout);
router.delete("/me", authenticateUser, ctrl.deleteAccount);

module.exports = router;