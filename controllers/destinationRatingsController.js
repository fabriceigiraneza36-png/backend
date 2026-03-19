/**
 * Destination Ratings Controller
 */
const { DestinationRating, Destination } = require("../models");
const { Op } = require("sequelize");

// Get all ratings for a destination
exports.getRatings = async (req, res, next) => {
  try {
    const { destinationId } = req.params;
    const { page = 1, limit = 20, approved, sortBy = "createdAt" } = req.query;

    const destination = await Destination.findByPk(destinationId);
    if (!destination) {
      return res.status(404).json({
        status: "error",
        message: "Destination not found",
      });
    }

    const whereClause = { destinationId: parseInt(destinationId) };
    if (approved !== undefined) {
      whereClause.isApproved = approved === "true";
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const order = sortBy === "rating" ? [["rating", "DESC"]] : [["createdAt", "DESC"]];

    const { count, rows: ratings } = await DestinationRating.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: require("../models").User,
          as: "user",
          attributes: ["id", "name", "email", "avatar"],
        },
      ],
      order,
      limit: parseInt(limit),
      offset,
      distinct: true,
    });

    res.json({
      status: "success",
      data: {
        ratings,
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

// Get rating statistics for a destination
exports.getRatingStats = async (req, res, next) => {
  try {
    const { destinationId } = req.params;

    const destination = await Destination.findByPk(destinationId);
    if (!destination) {
      return res.status(404).json({
        status: "error",
        message: "Destination not found",
      });
    }

    const ratings = await DestinationRating.findAll({
      where: { 
        destinationId: parseInt(destinationId),
        isApproved: true,
      },
      attributes: ["rating"],
    });

    const totalRatings = ratings.length;
    const averageRating = totalRatings > 0
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / totalRatings
      : 0;

    // Count ratings by stars
    const ratingDistribution = {
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0,
    };

    ratings.forEach((r) => {
      if (r.rating >= 1 && r.rating <= 5) {
        ratingDistribution[r.rating]++;
      }
    });

    res.json({
      status: "success",
      data: {
        totalRatings,
        averageRating: parseFloat(averageRating.toFixed(2)),
        ratingDistribution,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get single rating
exports.getRating = async (req, res, next) => {
  try {
    const { destinationId, ratingId } = req.params;

    const rating = await DestinationRating.findOne({
      where: {
        id: parseInt(ratingId),
        destinationId: parseInt(destinationId),
      },
      include: [
        {
          model: require("../models").User,
          as: "user",
          attributes: ["id", "name", "email", "avatar"],
        },
      ],
    });

    if (!rating) {
      return res.status(404).json({
        status: "error",
        message: "Rating not found",
      });
    }

    res.json({
      status: "success",
      data: rating,
    });
  } catch (error) {
    next(error);
  }
};

// Create or update rating
exports.createOrUpdateRating = async (req, res, next) => {
  try {
    const { destinationId } = req.params;
    const { userId } = req.user || {};
    const { sessionId, rating, review } = req.body;

    const destination = await Destination.findByPk(destinationId);
    if (!destination) {
      return res.status(404).json({
        status: "error",
        message: "Destination not found",
      });
    }

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        status: "error",
        message: "Rating must be between 1 and 5",
      });
    }

    if (!userId && !sessionId) {
      return res.status(400).json({
        status: "error",
        message: "User ID or session ID is required",
      });
    }

    const whereClause = { destinationId: parseInt(destinationId) };
    if (userId) {
      whereClause.userId = userId;
    } else {
      whereClause.sessionId = sessionId;
      whereClause.userId = null;
    }

    const existingRating = await DestinationRating.findOne({ where: whereClause });

    if (existingRating) {
      await existingRating.update({
        rating,
        review: review || existingRating.review,
      });

      // Get updated stats
      const stats = await this.getStatsForDestination(destinationId);

      return res.json({
        status: "success",
        message: "Rating updated successfully",
        data: {
          rating: existingRating,
          stats,
        },
      });
    }

    const newRating = await DestinationRating.create({
      destinationId: parseInt(destinationId),
      userId: userId || null,
      sessionId: userId ? null : sessionId,
      rating,
      review,
      isApproved: true,
    });

    const stats = await this.getStatsForDestination(destinationId);

    res.status(201).json({
      status: "success",
      message: "Rating created successfully",
      data: {
        rating: newRating,
        stats,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Helper method to get stats
exports.getStatsForDestination = async (destinationId) => {
  const ratings = await DestinationRating.findAll({
    where: { 
      destinationId: parseInt(destinationId),
      isApproved: true,
    },
    attributes: ["rating"],
  });

  const totalRatings = ratings.length;
  const averageRating = totalRatings > 0
    ? ratings.reduce((sum, r) => sum + r.rating, 0) / totalRatings
    : 0;

  return {
    totalRatings,
    averageRating: parseFloat(averageRating.toFixed(2)),
  };
};

// Delete rating
exports.deleteRating = async (req, res, next) => {
  try {
    const { destinationId, ratingId } = req.params;
    const { userId, role } = req.user || {};

    const rating = await DestinationRating.findOne({
      where: {
        id: parseInt(ratingId),
        destinationId: parseInt(destinationId),
      },
    });

    if (!rating) {
      return res.status(404).json({
        status: "error",
        message: "Rating not found",
      });
    }

    // Check if user owns the rating or is admin
    const isOwner = userId && rating.userId === userId;
    const isAdmin = role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        status: "error",
        message: "You are not authorized to delete this rating",
      });
    }

    await rating.destroy();

    res.json({
      status: "success",
      message: "Rating deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Get user's rating for a destination
exports.getUserRating = async (req, res, next) => {
  try {
    const { destinationId } = req.params;
    const { userId } = req.user || {};
    const { sessionId } = req.query;

    if (!userId && !sessionId) {
      return res.json({
        status: "success",
        data: { rating: null },
      });
    }

    const whereClause = { destinationId: parseInt(destinationId) };
    if (userId) {
      whereClause.userId = userId;
    } else {
      whereClause.sessionId = sessionId;
    }

    const rating = await DestinationRating.findOne({ where: whereClause });

    res.json({
      status: "success",
      data: { rating },
    });
  } catch (error) {
    next(error);
  }
};

// Approve/Unapprove rating (admin only)
exports.approveRating = async (req, res, next) => {
  try {
    const { destinationId, ratingId } = req.params;
    const { isApproved } = req.body;

    const rating = await DestinationRating.findOne({
      where: {
        id: parseInt(ratingId),
        destinationId: parseInt(destinationId),
      },
    });

    if (!rating) {
      return res.status(404).json({
        status: "error",
        message: "Rating not found",
      });
    }

    await rating.update({ isApproved });

    res.json({
      status: "success",
      message: `Rating ${isApproved ? "approved" : "unapproved"} successfully`,
      data: rating,
    });
  } catch (error) {
    next(error);
  }
};
