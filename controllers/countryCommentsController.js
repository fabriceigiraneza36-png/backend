/**
 * Country Comments Controller
 */
const { CountryComment, Country } = require("../models");
const models = require("../models");
const { Op } = require("sequelize");

// Get all comments for a country
exports.getComments = async (req, res, next) => {
  try {
    const { countryId } = req.params;
    const { page = 1, limit = 20 } = req.query;

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

    // Never expose hidden comments through public query-string overrides.
    whereClause.isApproved = true;

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
              attributes: ["id", "fullName", "email", "avatarUrl"],
            },
          ],
        },
        {
          model: require("../models").User,
          as: "user",
          attributes: ["id", "fullName", "email", "avatarUrl"],
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
        isApproved: true,
      },
      include: [
        {
          model: CountryComment,
          as: "replies",
          include: [
            {
              model: require("../models").User,
              as: "user",
              attributes: ["id", "fullName", "email", "avatarUrl"],
            },
          ],
        },
        {
          model: require("../models").User,
          as: "user",
          attributes: ["id", "fullName", "email", "avatarUrl"],
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
    const userId = req.user?.userId ?? req.user?.id ?? req.user?.uid;
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

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Please sign in to comment." });
    }

    // Enforce one top-level country comment per signed-in account.
    if (!parentId) {
      const existingComment = await CountryComment.findOne({
        where: { countryId: parseInt(countryId, 10), userId: Number(userId), parentId: null },
      });
      if (existingComment) {
        return res.status(409).json({
          status: "error",
          code: "COMMENT_ALREADY_EXISTS",
          message: "You have already shared a comment for this country.",
        });
      }
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
          attributes: ["id", "fullName", "email", "avatarUrl"],
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


/* Admin moderation: country comments appear in the same dashboard as destination comments. */
exports.adminGetAllComments = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const where = { parentId: null };
    if (req.query.approved !== undefined) where.isApproved = req.query.approved === "true";
    const search = String(req.query.search || "").trim();
    if (search) {
      where[Op.or] = [
        { content: { [Op.iLike]: "%" + search + "%" } },
        { authorName: { [Op.iLike]: "%" + search + "%" } },
        { authorEmail: { [Op.iLike]: "%" + search + "%" } },
      ];
    }

    const { count, rows } = await CountryComment.findAndCountAll({
      where,
      include: [
        { model: models.User, as: "user", attributes: ["id", "fullName", "email", "avatarUrl"], required: false },
        { model: Country, as: "country", attributes: ["id", "name", "slug"], required: false },
      ],
      order: [["createdAt", "DESC"]],
      offset: (page - 1) * limit,
      limit,
      distinct: true,
    });

    const comments = rows.map((item) => {
      const row = item.toJSON();
      return {
        ...row,
        resourceType: "country",
        resourceId: row.countryId,
        isApproved: Boolean(row.isApproved),
        user: row.user
          ? { id: row.user.id, name: row.user.fullName || row.authorName || "Traveller", email: row.user.email || null, avatar: row.user.avatarUrl || null }
          : (row.authorName ? { id: null, name: row.authorName, email: row.authorEmail || null, avatar: null } : null),
        country: row.country ? { id: row.country.id, name: row.country.name, slug: row.country.slug } : null,
      };
    });

    res.json({
      status: "success",
      data: { comments, pagination: { total: count, page, limit, pages: Math.ceil(count / limit) } },
    });
  } catch (error) {
    next(error);
  }
};

exports.adminDeleteComment = async (req, res, next) => {
  try {
    const comment = await CountryComment.findByPk(parseInt(req.params.commentId, 10));
    if (!comment) return res.status(404).json({ status: "error", message: "Comment not found" });
    await comment.destroy();
    res.json({ status: "success", message: "Country comment deleted successfully" });
  } catch (error) {
    next(error);
  }
};

exports.adminApproveComment = async (req, res, next) => {
  try {
    const comment = await CountryComment.findByPk(parseInt(req.params.commentId, 10));
    if (!comment) return res.status(404).json({ status: "error", message: "Comment not found" });
    if (typeof req.body?.isApproved !== "boolean") {
      return res.status(400).json({ status: "error", message: "isApproved must be a boolean" });
    }
    await comment.update({ isApproved: req.body.isApproved });
    res.json({
      status: "success",
      message: req.body.isApproved ? "Country comment approved" : "Country comment hidden",
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
