const router = require("express").Router();
const ctrl = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimiter");

router.post("/login", authLimiter, ctrl.login);
router.get("/me", protect, ctrl.getMe);
router.put("/me", protect, ctrl.updateMe);
router.put("/change-password", protect, ctrl.changePassword);

module.exports = router;
