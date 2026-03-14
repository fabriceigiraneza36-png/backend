/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TEAM CONTROLLER - Altuvera Travel
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const TeamMember = require("../models/TeamMember");
const AppError = require("../utils/AppError");
const catchAsync = require("../middleware/asyncHandler");
const { cloudinary } = require("../config/cloudinary");
const { Op } = require("sequelize");

/**
 * @desc    Get all team members
 * @route   GET /api/team
 * @access  Public
 */
exports.getAllTeamMembers = catchAsync(async (req, res) => {
  const {
    department,
    is_featured,
    is_active = "true",
    show_on_homepage,
    search,
    sort = "display_order",
    order = "ASC",
    page = 1,
    limit = 20,
  } = req.query;

  // Build filter conditions
  const where = {};

  if (is_active !== undefined) {
    where.is_active = is_active === "true";
  }

  if (department) {
    where.department = department;
  }

  if (is_featured !== undefined) {
    where.is_featured = is_featured === "true";
  }

  if (show_on_homepage !== undefined) {
    where.show_on_homepage = show_on_homepage === "true";
  }

  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { role: { [Op.iLike]: `%${search}%` } },
      { department: { [Op.iLike]: `%${search}%` } },
      { bio: { [Op.iLike]: `%${search}%` } },
    ];
  }

  // Pagination
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Validate sort field
  const validSortFields = ["display_order", "name", "created_at", "department"];
  const sortField = validSortFields.includes(sort) ? sort : "display_order";
  const sortOrder = order.toUpperCase() === "DESC" ? "DESC" : "ASC";

  const { count, rows: members } = await TeamMember.findAndCountAll({
    where,
    order: [[sortField, sortOrder]],
    limit: parseInt(limit),
    offset,
  });

  res.status(200).json({
    status: "success",
    results: members.length,
    totalCount: count,
    totalPages: Math.ceil(count / parseInt(limit)),
    currentPage: parseInt(page),
    data: members,
  });
});

/**
 * @desc    Get single team member by ID or slug
 * @route   GET /api/team/:identifier
 * @access  Public
 */
exports.getTeamMember = catchAsync(async (req, res, next) => {
  const { identifier } = req.params;

  let member;

  // Check if identifier is a number (ID) or string (slug)
  if (!isNaN(identifier)) {
    member = await TeamMember.findByPk(identifier);
  } else {
    member = await TeamMember.findOne({ where: { slug: identifier } });
  }

  if (!member) {
    return next(new AppError("Team member not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: member,
  });
});

/**
 * @desc    Get team members by department
 * @route   GET /api/team/department/:department
 * @access  Public
 */
exports.getTeamByDepartment = catchAsync(async (req, res) => {
  const { department } = req.params;

  const members = await TeamMember.findAll({
    where: {
      department: { [Op.iLike]: department },
      is_active: true,
    },
    order: [["display_order", "ASC"]],
  });

  res.status(200).json({
    status: "success",
    results: members.length,
    data: members,
  });
});

/**
 * @desc    Get featured team members
 * @route   GET /api/team/featured
 * @access  Public
 */
exports.getFeaturedTeamMembers = catchAsync(async (req, res) => {
  const limit = parseInt(req.query.limit) || 6;

  const members = await TeamMember.findAll({
    where: {
      is_featured: true,
      is_active: true,
    },
    order: [["display_order", "ASC"]],
    limit,
  });

  res.status(200).json({
    status: "success",
    results: members.length,
    data: members,
  });
});

/**
 * @desc    Get all departments
 * @route   GET /api/team/departments/list
 * @access  Public
 */
exports.getDepartments = catchAsync(async (req, res) => {
  const departments = await TeamMember.findAll({
    attributes: ["department"],
    where: {
      department: { [Op.ne]: null },
      is_active: true,
    },
    group: ["department"],
    order: [["department", "ASC"]],
  });

  const departmentList = departments.map((d) => d.department).filter(Boolean);

  res.status(200).json({
    status: "success",
    results: departmentList.length,
    data: departmentList,
  });
});

/**
 * @desc    Create new team member
 * @route   POST /api/team
 * @access  Private (Admin)
 */
exports.createTeamMember = catchAsync(async (req, res, next) => {
  const {
    name,
    role,
    department,
    bio,
    email,
    phone,
    linkedin_url,
    twitter_url,
    instagram_url,
    website_url,
    expertise,
    languages,
    certifications,
    years_experience,
    location,
    country,
    display_order,
    is_featured,
    is_active,
    show_on_homepage,
    meta_title,
    meta_description,
    joined_date,
  } = req.body;

  // Handle image upload
  let image_url = null;
  let image_public_id = null;

  if (req.file) {
    image_url = req.file.secure_url || req.file.path;
    image_public_id = req.file.cloudinary?.public_id || req.file.filename;
  } else if (req.body.image_url) {
    image_url = req.body.image_url;
  }

  // Parse arrays if they come as strings
  const parseArray = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value.split(",").map((s) => s.trim());
      }
    }
    return [];
  };

  const member = await TeamMember.create({
    name,
    role,
    department,
    bio,
    email,
    phone,
    image_url,
    image_public_id,
    linkedin_url,
    twitter_url,
    instagram_url,
    website_url,
    expertise: parseArray(expertise),
    languages: parseArray(languages),
    certifications: parseArray(certifications),
    years_experience: parseInt(years_experience) || 0,
    location,
    country,
    display_order: parseInt(display_order) || 0,
    is_featured: is_featured === true || is_featured === "true",
    is_active: is_active !== false && is_active !== "false",
    show_on_homepage: show_on_homepage === true || show_on_homepage === "true",
    meta_title,
    meta_description,
    joined_date,
  });

  res.status(201).json({
    status: "success",
    message: "Team member created successfully",
    data: member,
  });
});

/**
 * @desc    Update team member
 * @route   PUT /api/team/:id
 * @access  Private (Admin)
 */
exports.updateTeamMember = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const member = await TeamMember.findByPk(id);

  if (!member) {
    return next(new AppError("Team member not found", 404));
  }

  // Prepare update data
  const updateData = { ...req.body };

  if (req.file) {
    // Delete old image from Cloudinary
    if (member.image_public_id) {
      await cloudinary.uploader.destroy(member.image_public_id).catch((err) => {
        console.error("Error deleting image from Cloudinary:", err);
      });
    }

    updateData.image_url = req.file.secure_url || req.file.path;
    updateData.image_public_id =
      req.file.cloudinary?.public_id || req.file.filename;
  }

  // Parse arrays if they come as strings
  const parseArray = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value.split(",").map((s) => s.trim());
      }
    }
    return undefined;
  };

  if (updateData.expertise) {
    updateData.expertise = parseArray(updateData.expertise);
  }
  if (updateData.languages) {
    updateData.languages = parseArray(updateData.languages);
  }
  if (updateData.certifications) {
    updateData.certifications = parseArray(updateData.certifications);
  }
  if (updateData.years_experience) {
    updateData.years_experience = parseInt(updateData.years_experience);
  }
  if (updateData.display_order) {
    updateData.display_order = parseInt(updateData.display_order);
  }

  // Boolean conversions
  if (updateData.is_featured !== undefined) {
    updateData.is_featured =
      updateData.is_featured === true || updateData.is_featured === "true";
  }
  if (updateData.is_active !== undefined) {
    updateData.is_active =
      updateData.is_active === true || updateData.is_active === "true";
  }
  if (updateData.show_on_homepage !== undefined) {
    updateData.show_on_homepage =
      updateData.show_on_homepage === true ||
      updateData.show_on_homepage === "true";
  }

  await member.update(updateData);

  res.status(200).json({
    status: "success",
    message: "Team member updated successfully",
    data: member,
  });
});

/**
 * @desc    Delete team member
 * @route   DELETE /api/team/:id
 * @access  Private (Admin)
 */
exports.deleteTeamMember = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const member = await TeamMember.findByPk(id);

  if (!member) {
    return next(new AppError("Team member not found", 404));
  }

  if (member.image_public_id) {
    await cloudinary.uploader.destroy(member.image_public_id).catch((err) => {
      console.error("Error deleting image from Cloudinary:", err);
    });
  }

  await member.destroy();

  res.status(200).json({
    status: "success",
    message: "Team member deleted successfully",
    data: null,
  });
});

/**
 * @desc    Reorder team members
 * @route   PATCH /api/team/reorder
 * @access  Private (Admin)
 */
exports.reorderTeamMembers = catchAsync(async (req, res, next) => {
  const { orderedIds } = req.body;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return next(new AppError("Please provide an array of ordered IDs", 400));
  }

  // Update display_order for each member
  const updates = orderedIds.map((id, index) =>
    TeamMember.update({ display_order: index + 1 }, { where: { id } }),
  );

  await Promise.all(updates);

  res.status(200).json({
    status: "success",
    message: "Team members reordered successfully",
  });
});

/**
 * @desc    Toggle team member status
 * @route   PATCH /api/team/:id/toggle-status
 * @access  Private (Admin)
 */
exports.toggleStatus = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { field } = req.body; // 'is_active', 'is_featured', 'show_on_homepage'

  const validFields = ["is_active", "is_featured", "show_on_homepage"];

  if (!validFields.includes(field)) {
    return next(
      new AppError(
        "Invalid field. Use: is_active, is_featured, or show_on_homepage",
        400,
      ),
    );
  }

  const member = await TeamMember.findByPk(id);

  if (!member) {
    return next(new AppError("Team member not found", 404));
  }

  member[field] = !member[field];
  await member.save();

  res.status(200).json({
    status: "success",
    message: `${field} toggled successfully`,
    data: { [field]: member[field] },
  });
});
