const router = require("express").Router();
const { apiLimiter } = require("../middleware/rateLimiter");

router.use(apiLimiter);

// Use users router for authentication (you can keep auth.js for backward compatibility)
router.use("/users", require("./users"));
router.use("/auth", require("./auth")); // Keep for backward compatibility

router.use("/countries", require("./countries"));
router.use("/destinations", require("./destinations"));
router.use("/posts", require("./posts"));
router.use("/tips", require("./tips"));
router.use("/services", require("./services"));
router.use("/team", require("./team"));
router.use("/gallery", require("./gallery"));
router.use("/bookings", require("./bookings"));
router.use("/faqs", require("./faqs"));
router.use("/contact", require("./contact"));
router.use("/pages", require("./pages"));
router.use("/virtual-tours", require("./virtualTours"));
router.use("/subscribers", require("./subscribers"));
router.use("/settings", require("./settings"));

module.exports = router;