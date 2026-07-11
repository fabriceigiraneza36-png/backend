/**
 * Destination Comments Routes
 */
const express = require("express");
const router = express.Router();
const destinationCommentsController = require("../controllers/destinationCommentsController");
const { protect, adminOnly } = require("../middleware/auth");

// ── Admin routes (must be declared before the /:destinationId matcher) ────────
router.get("/admin/all", adminOnly, destinationCommentsController.adminGetAllComments);
router.delete("/admin/:commentId", adminOnly, destinationCommentsController.adminDeleteComment);
router.patch("/admin/:commentId/approve", adminOnly, destinationCommentsController.adminApproveComment);

// ── Public routes ────────────────────────────────────────────────────────────
router.get("/:destinationId/comments", destinationCommentsController.getComments);
router.get("/:destinationId/comments/count", destinationCommentsController.getCommentCount);
router.get("/:destinationId/comments/:commentId", destinationCommentsController.getComment);

// ── Protected routes (authenticated users) ───────────────────────────────────
router.post("/:destinationId/comments", protect, destinationCommentsController.createComment);
router.put("/:destinationId/comments/:commentId", protect, destinationCommentsController.updateComment);
router.delete("/:destinationId/comments/:commentId", protect, destinationCommentsController.deleteComment);

// ── Admin route (scoped) ─────────────────────────────────────────────────────
router.patch("/:destinationId/comments/:commentId/approve", adminOnly, destinationCommentsController.approveComment);

module.exports = router;
