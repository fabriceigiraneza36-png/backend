// routes/auth.js
const router = require("express").Router();
const auth = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const { authLimiter, verifyLimiter } = require("../middleware/rateLimiter");

// Public — OTP flow
router.post("/register",    authLimiter,   auth.register);
router.post("/login",       authLimiter,   auth.login);
router.post("/verify-code", verifyLimiter, auth.verifyCode);
router.post("/resend-code", authLimiter,   auth.resendCode);
router.post("/check-email",               auth.checkEmail);

// Public — Social
router.post("/google", authLimiter, auth.googleAuth);
router.post("/github", authLimiter, auth.githubAuth);

// Public — Token
router.post("/refresh-token", auth.refreshToken);

// Protected — Session
router.get("/me",       protect, auth.getMe);
router.put("/profile",  protect, auth.updateProfile);
router.post("/logout",  protect, auth.logout);
router.delete("/me",    protect, auth.deleteAccount);

module.exports = router;