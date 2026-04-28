const router = require("express").Router();
const chatController = require("../controllers/chatController");
const { protect, adminOnly } = require("../middleware/auth");

// Admin-only chat session management
router.get("/sessions", protect, adminOnly, chatController.getSessions);
router.get("/sessions/:sessionId/messages", protect, adminOnly, chatController.getMessages);
router.post("/sessions/:sessionId/messages", protect, adminOnly, chatController.sendAdminMessage);

// Public chat history for frontend widgets
router.get("/history/:sessionId", chatController.getHistory);

module.exports = router;
