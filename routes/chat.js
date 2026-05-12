const router = require("express").Router();
const chatController = require("../controllers/chatController");
const { protect, adminOnly } = require("../middleware/auth");

// ── Admin: list all sessions ───────────────────────────────────────────────────
router.get("/sessions", protect, adminOnly, chatController.getSessions);

// ── Admin: create/open a session with a registered user ───────────────────────
router.post("/sessions", protect, adminOnly, chatController.createSession);

// ── Admin: get messages in a session ──────────────────────────────────────────
router.get("/sessions/:sessionId/messages", protect, adminOnly, chatController.getMessages);

// ── Admin: send a message into a session ──────────────────────────────────────
router.post("/sessions/:sessionId/messages", protect, adminOnly, chatController.sendAdminMessage);

// ── Admin: mark all messages in a session as read ─────────────────────────────
router.patch("/sessions/:sessionId/read", protect, adminOnly, chatController.markSessionRead);

// ── Admin: update session status (open / closed) ──────────────────────────────
router.patch("/sessions/:sessionId/status", protect, adminOnly, chatController.updateSessionStatus);

// ── Public: chat history for the frontend widget ──────────────────────────────
router.get("/history/:sessionId", chatController.getHistory);

// ── Public: get session by ID (alias for history, used by widget) ─────────────
router.get("/sessions/:sessionId", chatController.getHistory);

module.exports = router;