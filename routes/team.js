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
const { validateTeamMember } = require("../validators/teamValidator");

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/team
 * @desc    Get all team members with filtering, sorting, and pagination
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
 * @route   POST /api/team
 * @desc    Create new team member
 * @access  Private (Admin)
 */
router.post(
  "/",
  protect,
  adminOnly,
  upload.single("image"),
  validateTeamMember,
  teamController.createTeamMember,
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
  validateTeamMember,
  teamController.updateTeamMember,
);

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
 * @desc    Toggle team member status (is_active, is_featured, show_on_homepage)
 * @access  Private (Admin)
 */
router.patch(
  "/:id/toggle-status",
  protect,
  adminOnly,
  teamController.toggleStatus,
);

module.exports = router;
