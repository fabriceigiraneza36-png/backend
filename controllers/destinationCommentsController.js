/**
 * Destination Comments Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * - Public: read comments (only 3 are rotated on the client UI)
 * - Authenticated users: create / edit / delete their own comments
 * - Admin: view ALL comments across every destination, approve, delete
 *
 * NOTE: `req.user` is the full DB record attached by middleware/auth.js,
 *       so the primary key is `req.user.id` (NOT `req.user.userId`).
 */
const { DestinationComment, Destination, User } = require("../models");

// ── User attributes actually defined on the Sequelize model ──────────────────
// The users table columns are full_name / avatar_url, mapped to fullName / avatarUrl.
const USER_ATTRS = ["id", "fullName", "email", "avatarUrl"];

const USER_INCLUDE = {
  model: User,
  as: "user",
  attributes: USER_ATTRS,
  required: false,
};

// ── Serializers — normalize output to a stable shape the frontend expects ────
const serializeUser = (u) => {
  if (!u) return null;
  const j = typeof u.toJSON === "function" ? u.toJSON() : u;
  return {
    id: j.id,
    name: j.fullName || j.full_name || j.name || "Traveller",
    email: j.email || null,
    avatar: j.avatarUrl || j.avatar_url || j.avatar || null,
  };
};

const serializeComment = (c) => {
  if (!c) return null;
  const j = typeof c.toJSON === "function" ? c.toJSON() : c;
  return {
    id: j.id,
    destinationId: j.destinationId ?? j.destination_id,
    content: j.content,
    parentId: j.parentId ?? j.parent_id ?? null,
    isApproved: j.isApproved ?? j.is_approved ?? true,
    authorName: j.authorName ?? j.author_name ?? null,
    createdAt: j.createdAt ?? j.created_at,
    updatedAt: j.updatedAt ?? j.updated_at,
    user: serializeUser(j.user),
    replies: Array.isArray(j.replies) ? j.replies.map(serializeComment) : [],
  };
};

const isAdminReq = (req) =>
  req.userType === "admin" ||
  ["admin", "superadmin", "super_admin", "moderator", "editor"].includes(
    req.user?.role || ""
  );

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC / USER ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

// Get all comments for a destination (top-level + replies)
exports.getComments = async (req, res, next) => {
  try {
    const { destinationId } = req.params;
    const { page = 1, limit = 50, approved } = req.query;

    const destination = await Destination.findByPk(destinationId);
    if (!destination) {
      return res.status(404).json({ status: "error", message: "Destination not found" });
    }

    const whereClause = {
      destinationId: parseInt(destinationId, 10),
      parentId: null, // Only top-level comments; replies come nested
    };

    // Public consumers see approved comments only; admins may pass ?approved=false
    if (approved !== undefined) {
      whereClause.isApproved = approved === "true";
    } else if (!isAdminReq(req)) {
      whereClause.isApproved = true;
    }

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const { count, rows: comments } = await DestinationComment.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: DestinationComment,
          as: "replies",
          include: [USER_INCLUDE],
        },
        USER_INCLUDE,
      ],
      order: [
        ["createdAt", "DESC"],
        [{ model: DestinationComment, as: "replies" }, "createdAt", "ASC"],
      ],
      limit: parseInt(limit, 10),
      offset,
      distinct: true,
    });

    res.json({
      status: "success",
      data: {
        comments: comments.map(serializeComment),
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          pages: Math.ceil(count / parseInt(limit, 10)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get single comment
exports.getComment = async (req, res, next) => {
  try {
    const { destinationId, commentId } = req.params;

    const comment = await DestinationComment.findOne({
      where: {
        id: parseInt(commentId, 10),
        destinationId: parseInt(destinationId, 10),
      },
      include: [
        {
          model: DestinationComment,
          as: "replies",
          include: [USER_INCLUDE],
        },
        USER_INCLUDE,
      ],
      order: [[{ model: DestinationComment, as: "replies" }, "createdAt", "ASC"]],
    });

    if (!comment) {
      return res.status(404).json({ status: "error", message: "Comment not found" });
    }

    res.json({ status: "success", data: serializeComment(comment) });
  } catch (error) {
    next(error);
  }
};

// Create comment (authenticated users — each user may comment freely)
exports.createComment = async (req, res, next) => {
  try {
    const { destinationId } = req.params;
    const userId = req.user?.id || null;
    const { content, parentId } = req.body;

    const destination = await Destination.findByPk(destinationId);
    if (!destination) {
      return res.status(404).json({ status: "error", message: "Destination not found" });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ status: "error", message: "Comment content is required" });
    }

    if (content.trim().length > 2000) {
      return res.status(400).json({ status: "error", message: "Comment is too long (max 2000 characters)" });
    }

    if (parentId) {
      const parentComment = await DestinationComment.findOne({
        where: {
          id: parseInt(parentId, 10),
          destinationId: parseInt(destinationId, 10),
        },
      });
      if (!parentComment) {
        return res.status(404).json({ status: "error", message: "Parent comment not found" });
      }
    }

    const created = await DestinationComment.create({
      destinationId: parseInt(destinationId, 10),
      userId: userId || null,
      content: content.trim(),
      parentId: parentId ? parseInt(parentId, 10) : null,
      // Fall back to the authenticated user's name when available
      authorName: userId ? null : (req.body.authorName || "Anonymous"),
      authorEmail: userId ? null : (req.body.authorEmail || null),
      isApproved: true,
    });

    const fullComment = await DestinationComment.findByPk(created.id, {
      include: [USER_INCLUDE],
    });

    res.status(201).json({
      status: "success",
      message: "Comment created successfully",
      data: serializeComment(fullComment),
    });
  } catch (error) {
    next(error);
  }
};

// Update comment (owner or admin)
exports.updateComment = async (req, res, next) => {
  try {
    const { destinationId, commentId } = req.params;
    const userId = req.user?.id || null;
    const { content } = req.body;

    const comment = await DestinationComment.findOne({
      where: {
        id: parseInt(commentId, 10),
        destinationId: parseInt(destinationId, 10),
      },
    });

    if (!comment) {
      return res.status(404).json({ status: "error", message: "Comment not found" });
    }

    const isOwner = userId && comment.userId === userId;
    if (!isOwner && !isAdminReq(req)) {
      return res.status(403).json({
        status: "error",
        message: "You are not authorized to update this comment",
      });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ status: "error", message: "Comment content is required" });
    }

    await comment.update({ content: content.trim() });

    const updated = await DestinationComment.findByPk(comment.id, { include: [USER_INCLUDE] });

    res.json({
      status: "success",
      message: "Comment updated successfully",
      data: serializeComment(updated),
    });
  } catch (error) {
    next(error);
  }
};

// Delete comment (owner or admin)
exports.deleteComment = async (req, res, next) => {
  try {
    const { destinationId, commentId } = req.params;
    const userId = req.user?.id || null;

    const comment = await DestinationComment.findOne({
      where: {
        id: parseInt(commentId, 10),
        destinationId: parseInt(destinationId, 10),
      },
      include: [{ model: DestinationComment, as: "replies" }],
    });

    if (!comment) {
      return res.status(404).json({ status: "error", message: "Comment not found" });
    }

    const isOwner = userId && comment.userId === userId;
    if (!isOwner && !isAdminReq(req)) {
      return res.status(403).json({
        status: "error",
        message: "You are not authorized to delete this comment",
      });
    }

    await comment.destroy();

    res.json({ status: "success", message: "Comment deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// Approve/Unapprove comment (admin only) — scoped to a destination
exports.approveComment = async (req, res, next) => {
  try {
    const { destinationId, commentId } = req.params;
    const { isApproved } = req.body;

    const comment = await DestinationComment.findOne({
      where: {
        id: parseInt(commentId, 10),
        destinationId: parseInt(destinationId, 10),
      },
    });

    if (!comment) {
      return res.status(404).json({ status: "error", message: "Comment not found" });
    }

    await comment.update({ isApproved: isApproved !== false });

    res.json({
      status: "success",
      message: `Comment ${comment.isApproved ? "approved" : "unapproved"} successfully`,
      data: serializeComment(comment),
    });
  } catch (error) {
    next(error);
  }
};

// Get comment count for a destination
exports.getCommentCount = async (req, res, next) => {
  try {
    const { destinationId } = req.params;

    const totalComments = await DestinationComment.count({
      where: { destinationId: parseInt(destinationId, 10), isApproved: true },
    });

    const topLevelComments = await DestinationComment.count({
      where: {
        destinationId: parseInt(destinationId, 10),
        parentId: null,
        isApproved: true,
      },
    });

    res.json({
      status: "success",
      data: { totalComments, topLevelComments },
    });
  } catch (error) {
    next(error);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS — every comment across every destination
// ═════════════════════════════════════════════════════════════════════════════

// GET /destination-comments/admin/all
exports.adminGetAllComments = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, approved, destinationId, search } = req.query;

    const where = {};
    if (approved !== undefined) where.isApproved = approved === "true";
    if (destinationId) where.destinationId = parseInt(destinationId, 10);
    if (search && search.trim()) {
      const { Op } = require("sequelize");
      where.content = { [Op.iLike]: `%${search.trim()}%` };
    }

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const { count, rows } = await DestinationComment.findAndCountAll({
      where,
      include: [
        USER_INCLUDE,
        { model: Destination, as: "destination", attributes: ["id", "name", "slug"], required: false },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit, 10),
      offset,
      distinct: true,
    });

    const comments = rows.map((c) => {
      const base = serializeComment(c);
      const j = typeof c.toJSON === "function" ? c.toJSON() : c;
      base.destination = j.destination
        ? { id: j.destination.id, name: j.destination.name, slug: j.destination.slug }
        : null;
      return base;
    });

    res.json({
      status: "success",
      data: {
        comments,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          pages: Math.ceil(count / parseInt(limit, 10)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /destination-comments/admin/:commentId
exports.adminDeleteComment = async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const comment = await DestinationComment.findByPk(parseInt(commentId, 10));
    if (!comment) {
      return res.status(404).json({ status: "error", message: "Comment not found" });
    }
    await comment.destroy();
    res.json({ status: "success", message: "Comment deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// PATCH /destination-comments/admin/:commentId/approve
exports.adminApproveComment = async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const { isApproved } = req.body;
    const comment = await DestinationComment.findByPk(parseInt(commentId, 10));
    if (!comment) {
      return res.status(404).json({ status: "error", message: "Comment not found" });
    }
    await comment.update({ isApproved: isApproved !== false });
    res.json({
      status: "success",
      message: `Comment ${comment.isApproved ? "approved" : "unapproved"} successfully`,
      data: serializeComment(comment),
    });
  } catch (error) {
    next(error);
  }
};
