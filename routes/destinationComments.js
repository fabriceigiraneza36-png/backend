/**
 * Destination Comments Routes
 */
const express = require("express");
const router = express.Router();
const destinationCommentsController = require("../controllers/destinationCommentsController");
const { protect, admin } = require("../middleware/auth");

// Public routes
router.get("/:destinationId/comments", destinationCommentsController.getComments);
router.get("/:destinationId/comments/:commentId", destinationCommentsController.getComment);
router.get("/:destinationId/comments/count", destinationCommentsController.getCommentCount);

// Protected routes
router.post("/:destinationId/comments", protect, destinationCommentsController.createComment);
router.put("/:destinationId/comments/:commentId", protect, destinationCommentsController.updateComment);
router.delete("/:destinationId/comments/:commentId", protect, destinationCommentsController.deleteComment);

// Admin routes
router.patch("/:destinationId/comments/:commentId/approve", admin, destinationCommentsController.approveComment);

module.exports = router;
