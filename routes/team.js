/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TEAM ROUTES - Altuvera Travel
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require("express");
const router = express.Router();
const teamController = require("../controllers/teamController");
const { protect, adminOnly } = require("../middleware/auth");
const upload = require("../middleware/upload");

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/team
 * @desc    Get all active team members with filtering, sorting, pagination
 * @access  Public
 */
router.get("/", teamController.getAllTeamMembers);

/**
 * @route   GET /api/team/featured
 * @desc    Get featured team members
 * @access  Public
 */
router.get("/featured", teamController.getFeaturedTeamMembers);

/**
 * @route   GET /api/team/departments/list
 * @desc    Get all unique departments
 * @access  Public
 */
router.get("/departments/list", teamController.getDepartments);

/**
 * @route   GET /api/team/stats
 * @desc    Get team statistics for the StatsSection component
 * @access  Public
 */
router.get("/stats", teamController.getTeamStats);

/**
 * @route   GET /api/team/department/:department
 * @desc    Get team members by department
 * @access  Public
 */
router.get("/department/:department", teamController.getTeamByDepartment);

/**
 * @route   GET /api/team/:identifier
 * @desc    Get single team member by ID or slug
 * @access  Public
 */
router.get("/:identifier", teamController.getTeamMember);

// ═══════════════════════════════════════════════════════════════════════════════
// PROTECTED ROUTES (Admin Only)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/team/admin/all
 * @desc    Get ALL team members (including inactive) for admin dashboard
 * @access  Private (Admin)
 */
router.get("/admin/all", protect, adminOnly, teamController.getAllTeamMembersAdmin);

/**
 * @route   POST /api/team
 * @desc    Create new team member
 * @access  Private (Admin)
 */
router.post(
  "/",
  protect,
  adminOnly,
  upload.single("image"),
  teamController.createTeamMember
);

/**
 * @route   PUT /api/team/:id
 * @desc    Update team member
 * @access  Private (Admin)
 */
router.put(
  "/:id",
  protect,
  adminOnly,
  upload.single("image"),
  teamController.updateTeamMember
);

/**
 * @route   DELETE /api/team/bulk-delete
 * @desc    Bulk delete team members
 * @access  Private (Admin)
 */
router.delete("/bulk-delete", protect, adminOnly, teamController.bulkDeleteTeamMembers);

/**
 * @route   DELETE /api/team/:id
 * @desc    Delete team member
 * @access  Private (Admin)
 */
router.delete("/:id", protect, adminOnly, teamController.deleteTeamMember);

/**
 * @route   PATCH /api/team/reorder
 * @desc    Reorder team members
 * @access  Private (Admin)
 */
router.patch("/reorder", protect, adminOnly, teamController.reorderTeamMembers);

/**
 * @route   PATCH /api/team/:id/toggle-status
 * @desc    Toggle team member boolean status field
 * @access  Private (Admin)
 */
router.patch("/:id/toggle-status", protect, adminOnly, teamController.toggleStatus);

/**
 * @route   POST /api/team/:id/duplicate
 * @desc    Duplicate a team member
 * @access  Private (Admin)
 */
router.post("/:id/duplicate", protect, adminOnly, teamController.duplicateTeamMember);

module.exports = router;