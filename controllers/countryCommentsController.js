/**
 * Country Comments Controller
 */
const { CountryComment, Country } = require("../models");
const { Op } = require("sequelize");

// Get all comments for a country
exports.getComments = async (req, res, next) => {
  try {
    const { countryId } = req.params;
    const { page = 1, limit = 20, approved } = req.query;

    const country = await Country.findByPk(countryId);
    if (!country) {
      return res.status(404).json({
        status: "error",
        message: "Country not found",
      });
    }

    const whereClause = { 
      countryId: parseInt(countryId),
      parentId: null, // Only get top-level comments
    };

    if (approved !== undefined) {
      whereClause.isApproved = approved === "true";
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: comments } = await CountryComment.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: CountryComment,
          as: "replies",
          include: [
            {
              model: require("../models").User,
              as: "user",
              attributes: ["id", "name", "email", "avatar"],
            },
          ],
        },
        {
          model: require("../models").User,
          as: "user",
          attributes: ["id", "name", "email", "avatar"],
        },
      ],
      order: [
        ["createdAt", "DESC"],
        [{ model: CountryComment, as: "replies" }, "createdAt", "ASC"],
      ],
      limit: parseInt(limit),
      offset,
      distinct: true,
    });

    res.json({
      status: "success",
      data: {
        comments,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / parseInt(limit)),
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
    const { countryId, commentId } = req.params;

    const comment = await CountryComment.findOne({
      where: {
        id: parseInt(commentId),
        countryId: parseInt(countryId),
      },
      include: [
        {
          model: CountryComment,
          as: "replies",
          include: [
            {
              model: require("../models").User,
              as: "user",
              attributes: ["id", "name", "email", "avatar"],
            },
          ],
        },
        {
          model: require("../models").User,
          as: "user",
          attributes: ["id", "name", "email", "avatar"],
        },
      ],
      order: [
        [{ model: CountryComment, as: "replies" }, "createdAt", "ASC"],
      ],
    });

    if (!comment) {
      return res.status(404).json({
        status: "error",
        message: "Comment not found",
      });
    }

    res.json({
      status: "success",
      data: comment,
    });
  } catch (error) {
    next(error);
  }
};

// Create comment
exports.createComment = async (req, res, next) => {
  try {
    const { countryId } = req.params;
    const { userId } = req.user || {};
    const { content, parentId, authorName, authorEmail } = req.body;

    const country = await Country.findByPk(countryId);
    if (!country) {
      return res.status(404).json({
        status: "error",
        message: "Country not found",
      });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Comment content is required",
      });
    }

    if (parentId) {
      const parentComment = await CountryComment.findOne({
        where: {
          id: parseInt(parentId),
          countryId: parseInt(countryId),
        },
      });

      if (!parentComment) {
        return res.status(404).json({
          status: "error",
          message: "Parent comment not found",
        });
      }
    }

    const comment = await CountryComment.create({
      countryId: parseInt(countryId),
      userId: userId || null,
      content: content.trim(),
      parentId: parentId ? parseInt(parentId) : null,
      authorName: userId ? null : (authorName || "Anonymous"),
      authorEmail: userId ? null : authorEmail,
      isApproved: true, // Auto-approve for now, can be changed based on moderation
    });

    const fullComment = await CountryComment.findByPk(comment.id, {
      include: [
        {
          model: require("../models").User,
          as: "user",
          attributes: ["id", "name", "email", "avatar"],
        },
      ],
    });

    res.status(201).json({
      status: "success",
      message: "Comment created successfully",
      data: fullComment,
    });
  } catch (error) {
    next(error);
  }
};

// Update comment
exports.updateComment = async (req, res, next) => {
  try {
    const { countryId, commentId } = req.params;
    const { userId, role } = req.user || {};
    const { content } = req.body;

    const comment = await CountryComment.findOne({
      where: {
        id: parseInt(commentId),
        countryId: parseInt(countryId),
      },
    });

    if (!comment) {
      return res.status(404).json({
        status: "error",
        message: "Comment not found",
      });
    }

    // Check if user owns the comment or is admin
    const isOwner = userId && comment.userId === userId;
    const isAdmin = role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        status: "error",
        message: "You are not authorized to update this comment",
      });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Comment content is required",
      });
    }

    await comment.update({ content: content.trim() });

    res.json({
      status: "success",
      message: "Comment updated successfully",
      data: comment,
    });
  } catch (error) {
    next(error);
  }
};

// Delete comment
exports.deleteComment = async (req, res, next) => {
  try {
    const { countryId, commentId } = req.params;
    const { userId, role } = req.user || {};

    const comment = await CountryComment.findOne({
      where: {
        id: parseInt(commentId),
        countryId: parseInt(countryId),
      },
      include: [{ model: CountryComment, as: "replies" }],
    });

    if (!comment) {
      return res.status(404).json({
        status: "error",
        message: "Comment not found",
      });
    }

    // Check if user owns the comment or is admin
    const isOwner = userId && comment.userId === userId;
    const isAdmin = role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        status: "error",
        message: "You are not authorized to delete this comment",
      });
    }

    await comment.destroy();

    res.json({
      status: "success",
      message: "Comment deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Approve/Unapprove comment (admin only)
exports.approveComment = async (req, res, next) => {
  try {
    const { countryId, commentId } = req.params;
    const { isApproved } = req.body;

    const comment = await CountryComment.findOne({
      where: {
        id: parseInt(commentId),
        countryId: parseInt(countryId),
      },
    });

    if (!comment) {
      return res.status(404).json({
        status: "error",
        message: "Comment not found",
      });
    }

    await comment.update({ isApproved });

    res.json({
      status: "success",
      message: `Comment ${isApproved ? "approved" : "unapproved"} successfully`,
      data: comment,
    });
  } catch (error) {
    next(error);
  }
};

// Get comment count
exports.getCommentCount = async (req, res, next) => {
  try {
    const { countryId } = req.params;

    const totalComments = await CountryComment.count({
      where: { 
        countryId: parseInt(countryId),
        isApproved: true,
      },
    });

    const topLevelComments = await CountryComment.count({
      where: { 
        countryId: parseInt(countryId),
        parentId: null,
        isApproved: true,
      },
    });

    res.json({
      status: "success",
      data: {
        totalComments,
        topLevelComments,
      },
    });
  } catch (error) {
    next(error);
  }
};
