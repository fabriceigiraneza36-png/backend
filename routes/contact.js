// routes/contact.js
const router = require("express").Router();
const contact = require("../controllers/contactController");
const { protect, adminOnly } = require("../middleware/auth");
const rateLimit = require("express-rate-limit");

// ============================================
// RATE LIMITING FOR PUBLIC ENDPOINT
// ============================================

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: {
    error: "Too many contact requests. Please try again in 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.connection?.remoteAddress || 'unknown';
  },
});

// ============================================
// PUBLIC ROUTES
// ============================================

// Create new contact message (with rate limiting)
router.post("/", contactLimiter, contact.create);

// ============================================
// PROTECTED ADMIN ROUTES
// ============================================

// List & Search messages
router.get("/", protect, adminOnly, contact.getAll);

// Statistics & Analytics
router.get("/stats", protect, adminOnly, contact.getStats);

// Export messages
router.get("/export", protect, adminOnly, contact.export);

// Bulk operations
router.post("/bulk", protect, adminOnly, contact.bulkUpdate);

// Single message operations
router.get("/:id", protect, adminOnly, contact.getOne);
router.put("/:id", protect, adminOnly, contact.update);
router.delete("/:id", protect, adminOnly, contact.remove);

// Quick actions
router.patch("/:id/read", protect, adminOnly, contact.markRead);
router.patch("/:id/unread", protect, adminOnly, contact.markUnread);
router.patch("/:id/star", protect, adminOnly, contact.toggleStar);
router.patch("/:id/archive", protect, adminOnly, contact.archive);
router.patch("/:id/spam", protect, adminOnly, contact.markSpam);

// Reply to message
router.post("/:id/reply", protect, adminOnly, contact.reply);

module.exports = router;