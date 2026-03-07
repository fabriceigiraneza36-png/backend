/**
 * routes/adminAuth.js - Admin Auth Routes
 */

const router = require("express").Router();
const ctrl = require("../controllers/authController");
const { protect, adminOnly } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");

router.post("/login", asyncHandler(ctrl.adminLogin));
router.post("/refresh-token", asyncHandler(ctrl.refreshToken));
router.post("/register", protect, adminOnly, asyncHandler(ctrl.adminRegister));
router.get("/me", protect, adminOnly, asyncHandler(ctrl.getMe));
router.put("/me", protect, adminOnly, asyncHandler(ctrl.updateProfile));
router.put("/profile", protect, adminOnly, asyncHandler(ctrl.updateProfile));
router.put("/change-password", protect, adminOnly, asyncHandler(ctrl.changePassword));
router.post("/logout", protect, adminOnly, asyncHandler(ctrl.logout));
router.delete("/me", protect, adminOnly, asyncHandler(ctrl.deleteAccount));

module.exports = router;
