/**
 * Country Comments Routes
 */
const express = require("express");
const router = express.Router();
const countryCommentsController = require("../controllers/countryCommentsController");
const { protect, adminOnly } = require("../middleware/auth");

// Public routes
router.get("/:countryId/comments", countryCommentsController.getComments);
router.get("/:countryId/comments/:commentId", countryCommentsController.getComment);
router.get("/:countryId/comments/count", countryCommentsController.getCommentCount);

// Protected routes
router.post("/:countryId/comments", protect, countryCommentsController.createComment);
router.put("/:countryId/comments/:commentId", protect, countryCommentsController.updateComment);
router.delete("/:countryId/comments/:commentId", protect, countryCommentsController.deleteComment);

// Admin routes
router.patch("/:countryId/comments/:commentId/approve", adminOnly, countryCommentsController.approveComment);

module.exports = router;
