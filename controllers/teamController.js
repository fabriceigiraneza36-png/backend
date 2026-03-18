/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TEAM CONTROLLER - Altuvera Travel
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Full CRUD operations for team members.
 * Frontend TeamCard expects:
 *   id, name, role, department, image_url, bio, expertise[],
 *   location, linkedin_url, twitter_url, email, is_featured, is_active
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const TeamMember = require("../models/TeamMember");
const AppError = require("../utils/AppError");
const catchAsync = require("../middleware/asyncHandler");
const { cloudinary } = require("../config/cloudinary");
const { Op } = require("sequelize");

// ─── Helper: Parse string or array into a clean JS array ───────────────────
const parseArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v.trim() : v));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
};

// ─── Helper: Convert various truthy/falsy inputs to boolean ────────────────
const parseBool = (value, defaultVal = false) => {
  if (value === undefined || value === null) return defaultVal;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
};

// ─── Helper: Extract image info from multer/cloudinary upload ──────────────
const extractImageData = (file) => {
  if (!file) return { image_url: null, image_public_id: null };
  return {
    image_url: file.secure_url || file.path || file.location || null,
    image_public_id: file.public_id || file.filename || (file.cloudinary && file.cloudinary.public_id) || null,
  };
};

// ─── Helper: Delete image from Cloudinary silently ─────────────────────────
const deleteCloudinaryImage = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error(`[Cloudinary] Failed to delete image ${publicId}:`, err.message);
  }
};

// ─── Helper: Build the response shape the frontend expects ─────────────────
const formatMemberResponse = (member) => {
  const json = member.toJSON ? member.toJSON() : { ...member };

  // Guarantee the "image" alias exists for backward compat
  if (!json.image) {
    json.image = json.image_url || null;
  }

  // Guarantee arrays
  json.expertise = Array.isArray(json.expertise) ? json.expertise : [];
  json.languages = Array.isArray(json.languages) ? json.languages : [];
  json.certifications = Array.isArray(json.certifications) ? json.certifications : [];

  return json;
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @desc    Get all team members (with filters, search, sort, pagination)
 * @route   GET /api/team
 * @access  Public
 */
exports.getAllTeamMembers = catchAsync(async (req, res) => {
  const {
    department,
    is_featured,
    is_active,
    show_on_homepage,
    search,
    sort = "display_order",
    order = "ASC",
    page = 1,
    limit = 50,
  } = req.query;

  // Build WHERE clause
  const where = {};

  // Default: only show active members on public requests
  // If is_active is not explicitly set, default to true for public
  if (is_active !== undefined) {
    where.is_active = parseBool(is_active, true);
  } else {
    // For public requests, default to active only
    where.is_active = true;
  }

  if (department) {
    where.department = { [Op.iLike]: department };
  }

  if (is_featured !== undefined) {
    where.is_featured = parseBool(is_featured);
  }

  if (show_on_homepage !== undefined) {
    where.show_on_homepage = parseBool(show_on_homepage);
  }

  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { role: { [Op.iLike]: `%${search}%` } },
      { department: { [Op.iLike]: `%${search}%` } },
      { bio: { [Op.iLike]: `%${search}%` } },
      { location: { [Op.iLike]: `%${search}%` } },
    ];
  }

  // Pagination
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  // Sort
  const validSortFields = [
    "display_order",
    "name",
    "created_at",
    "department",
    "role",
    "joined_date",
  ];
  const sortField = validSortFields.includes(sort) ? sort : "display_order";
  const sortOrder = order.toUpperCase() === "DESC" ? "DESC" : "ASC";

  const { count, rows: members } = await TeamMember.findAndCountAll({
    where,
    order: [
      [sortField, sortOrder],
      ["name", "ASC"], // secondary sort
    ],
    limit: limitNum,
    offset,
  });

  res.status(200).json({
    status: "success",
    results: members.length,
    totalCount: count,
    totalPages: Math.ceil(count / limitNum),
    currentPage: pageNum,
    data: members.map(formatMemberResponse),
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

  // Numeric = ID, otherwise treat as slug
  if (/^\d+$/.test(identifier)) {
    member = await TeamMember.findByPk(identifier);
  } else {
    member = await TeamMember.findOne({ where: { slug: identifier } });
  }

  if (!member) {
    return next(new AppError("Team member not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: formatMemberResponse(member),
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
    order: [
      ["display_order", "ASC"],
      ["name", "ASC"],
    ],
  });

  res.status(200).json({
    status: "success",
    results: members.length,
    data: members.map(formatMemberResponse),
  });
});

/**
 * @desc    Get featured team members
 * @route   GET /api/team/featured
 * @access  Public
 */
exports.getFeaturedTeamMembers = catchAsync(async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 6));

  const members = await TeamMember.findAll({
    where: {
      is_featured: true,
      is_active: true,
    },
    order: [
      ["display_order", "ASC"],
      ["name", "ASC"],
    ],
    limit,
  });

  res.status(200).json({
    status: "success",
    results: members.length,
    data: members.map(formatMemberResponse),
  });
});

/**
 * @desc    Get all unique departments
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

  const departmentList = departments
    .map((d) => d.department)
    .filter(Boolean)
    .sort();

  res.status(200).json({
    status: "success",
    results: departmentList.length,
    data: departmentList,
  });
});

/**
 * @desc    Get team stats (for the StatsSection component)
 * @route   GET /api/team/stats
 * @access  Public
 */
exports.getTeamStats = catchAsync(async (req, res) => {
  const [totalMembers, totalDepartments, totalCountries, totalExperience] =
    await Promise.all([
      TeamMember.count({ where: { is_active: true } }),
      TeamMember.count({
        where: { is_active: true, department: { [Op.ne]: null } },
        distinct: true,
        col: "department",
      }),
      TeamMember.count({
        where: { is_active: true, country: { [Op.ne]: null } },
        distinct: true,
        col: "country",
      }),
      TeamMember.sum("years_experience", { where: { is_active: true } }),
    ]);

  res.status(200).json({
    status: "success",
    data: {
      total_members: totalMembers || 0,
      total_departments: totalDepartments || 0,
      countries_covered: totalCountries || 0,
      combined_experience: totalExperience || 0,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS (CRUD)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @desc    Get ALL team members (including inactive) for admin dashboard
 * @route   GET /api/team/admin/all
 * @access  Private (Admin)
 */
exports.getAllTeamMembersAdmin = catchAsync(async (req, res) => {
  const {
    department,
    is_featured,
    is_active,
    show_on_homepage,
    search,
    sort = "display_order",
    order = "ASC",
    page = 1,
    limit = 50,
  } = req.query;

  const where = {};

  // Admin can see both active and inactive
  if (is_active !== undefined) {
    where.is_active = parseBool(is_active);
  }

  if (department) {
    where.department = { [Op.iLike]: department };
  }

  if (is_featured !== undefined) {
    where.is_featured = parseBool(is_featured);
  }

  if (show_on_homepage !== undefined) {
    where.show_on_homepage = parseBool(show_on_homepage);
  }

  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { role: { [Op.iLike]: `%${search}%` } },
      { department: { [Op.iLike]: `%${search}%` } },
      { bio: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { location: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const validSortFields = [
    "display_order",
    "name",
    "created_at",
    "department",
    "role",
    "is_active",
    "is_featured",
    "joined_date",
  ];
  const sortField = validSortFields.includes(sort) ? sort : "display_order";
  const sortOrder = order.toUpperCase() === "DESC" ? "DESC" : "ASC";

  const { count, rows: members } = await TeamMember.findAndCountAll({
    where,
    order: [
      [sortField, sortOrder],
      ["name", "ASC"],
    ],
    limit: limitNum,
    offset,
  });

  res.status(200).json({
    status: "success",
    results: members.length,
    totalCount: count,
    totalPages: Math.ceil(count / limitNum),
    currentPage: pageNum,
    data: members.map(formatMemberResponse),
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

  // Validate required fields
  if (!name || !name.trim()) {
    return next(new AppError("Name is required", 400));
  }
  if (!role || !role.trim()) {
    return next(new AppError("Role is required", 400));
  }

  // Handle image from file upload or URL in body
  let imageData = { image_url: null, image_public_id: null };

  if (req.file) {
    imageData = extractImageData(req.file);
  } else if (req.body.image_url) {
    imageData.image_url = req.body.image_url;
  } else if (req.body.image) {
    // Support "image" field name from frontend fallback
    imageData.image_url = req.body.image;
  }

  // Auto-assign display_order if not provided
  let orderValue = parseInt(display_order);
  if (isNaN(orderValue)) {
    const maxOrder = await TeamMember.max("display_order");
    orderValue = (maxOrder || 0) + 1;
  }

  const member = await TeamMember.create({
    name: name.trim(),
    role: role.trim(),
    department: department ? department.trim() : null,
    bio: bio ? bio.trim() : null,
    email: email ? email.trim().toLowerCase() : null,
    phone: phone ? phone.trim() : null,
    image_url: imageData.image_url,
    image_public_id: imageData.image_public_id,
    linkedin_url: linkedin_url || null,
    twitter_url: twitter_url || null,
    instagram_url: instagram_url || null,
    website_url: website_url || null,
    expertise: parseArray(expertise),
    languages: parseArray(languages),
    certifications: parseArray(certifications),
    years_experience: parseInt(years_experience) || 0,
    location: location ? location.trim() : null,
    country: country ? country.trim() : null,
    display_order: orderValue,
    is_featured: parseBool(is_featured, false),
    is_active: parseBool(is_active, true),
    show_on_homepage: parseBool(show_on_homepage, false),
    meta_title: meta_title || null,
    meta_description: meta_description || null,
    joined_date: joined_date || null,
  });

  res.status(201).json({
    status: "success",
    message: "Team member created successfully",
    data: formatMemberResponse(member),
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

  // Build update object — only include fields that were actually sent
  const updateData = {};

  // String fields
  const stringFields = [
    "name",
    "role",
    "department",
    "bio",
    "phone",
    "linkedin_url",
    "twitter_url",
    "instagram_url",
    "website_url",
    "location",
    "country",
    "meta_title",
    "meta_description",
    "joined_date",
  ];

  stringFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field] ? req.body[field].toString().trim() : null;
    }
  });

  // Email (lowercase)
  if (req.body.email !== undefined) {
    updateData.email = req.body.email ? req.body.email.trim().toLowerCase() : null;
  }

  // Image handling
  if (req.file) {
    // Delete old image from Cloudinary
    await deleteCloudinaryImage(member.image_public_id);

    const imageData = extractImageData(req.file);
    updateData.image_url = imageData.image_url;
    updateData.image_public_id = imageData.image_public_id;
  } else if (req.body.image_url !== undefined) {
    // If URL changed and old was cloudinary, clean up
    if (req.body.image_url !== member.image_url && member.image_public_id) {
      await deleteCloudinaryImage(member.image_public_id);
      updateData.image_public_id = null;
    }
    updateData.image_url = req.body.image_url || null;
  } else if (req.body.image !== undefined) {
    // Support "image" field name
    if (req.body.image !== member.image_url && member.image_public_id) {
      await deleteCloudinaryImage(member.image_public_id);
      updateData.image_public_id = null;
    }
    updateData.image_url = req.body.image || null;
  }

  // Remove image explicitly
  if (req.body.remove_image === true || req.body.remove_image === "true") {
    await deleteCloudinaryImage(member.image_public_id);
    updateData.image_url = null;
    updateData.image_public_id = null;
  }

  // Array fields
  const arrayFields = ["expertise", "languages", "certifications"];
  arrayFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = parseArray(req.body[field]);
    }
  });

  // Numeric fields
  if (req.body.years_experience !== undefined) {
    updateData.years_experience = Math.max(0, parseInt(req.body.years_experience) || 0);
  }
  if (req.body.display_order !== undefined) {
    updateData.display_order = parseInt(req.body.display_order) || 0;
  }

  // Boolean fields
  const boolFields = ["is_featured", "is_active", "show_on_homepage"];
  boolFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = parseBool(req.body[field]);
    }
  });

  await member.update(updateData);

  // Reload to get updated slug and computed fields
  await member.reload();

  res.status(200).json({
    status: "success",
    message: "Team member updated successfully",
    data: formatMemberResponse(member),
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

  // Clean up Cloudinary image
  await deleteCloudinaryImage(member.image_public_id);

  const memberName = member.name;
  await member.destroy();

  res.status(200).json({
    status: "success",
    message: `Team member "${memberName}" deleted successfully`,
    data: null,
  });
});

/**
 * @desc    Bulk delete team members
 * @route   DELETE /api/team/bulk-delete
 * @access  Private (Admin)
 */
exports.bulkDeleteTeamMembers = catchAsync(async (req, res, next) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return next(new AppError("Please provide an array of IDs to delete", 400));
  }

  // Find all members to delete their images
  const members = await TeamMember.findAll({ where: { id: { [Op.in]: ids } } });

  // Delete Cloudinary images
  const deletePromises = members
    .filter((m) => m.image_public_id)
    .map((m) => deleteCloudinaryImage(m.image_public_id));
  await Promise.all(deletePromises);

  const deletedCount = await TeamMember.destroy({ where: { id: { [Op.in]: ids } } });

  res.status(200).json({
    status: "success",
    message: `${deletedCount} team member(s) deleted successfully`,
    data: { deletedCount },
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

  // Use a transaction for atomicity
  const sequelize = TeamMember.sequelize;
  await sequelize.transaction(async (t) => {
    const updates = orderedIds.map((id, index) =>
      TeamMember.update(
        { display_order: index + 1 },
        { where: { id }, transaction: t }
      )
    );
    await Promise.all(updates);
  });

  res.status(200).json({
    status: "success",
    message: "Team members reordered successfully",
  });
});

/**
 * @desc    Toggle team member boolean field
 * @route   PATCH /api/team/:id/toggle-status
 * @access  Private (Admin)
 */
exports.toggleStatus = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { field } = req.body;

  const validFields = ["is_active", "is_featured", "show_on_homepage"];

  if (!field || !validFields.includes(field)) {
    return next(
      new AppError(
        `Invalid field. Must be one of: ${validFields.join(", ")}`,
        400
      )
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
    message: `${field} toggled to ${member[field]}`,
    data: formatMemberResponse(member),
  });
});

/**
 * @desc    Duplicate a team member
 * @route   POST /api/team/:id/duplicate
 * @access  Private (Admin)
 */
exports.duplicateTeamMember = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const original = await TeamMember.findByPk(id);
  if (!original) {
    return next(new AppError("Team member not found", 404));
  }

  const data = original.toJSON();

  // Remove unique fields
  delete data.id;
  delete data.slug;
  delete data.created_at;
  delete data.updated_at;

  // Mark as draft
  data.name = `${data.name} (Copy)`;
  data.is_active = false;
  data.is_featured = false;
  data.show_on_homepage = false;
  data.image_public_id = null; // Don't reference same cloudinary asset

  // Auto display_order
  const maxOrder = await TeamMember.max("display_order");
  data.display_order = (maxOrder || 0) + 1;

  const duplicate = await TeamMember.create(data);

  res.status(201).json({
    status: "success",
    message: "Team member duplicated successfully",
    data: formatMemberResponse(duplicate),
  });
});