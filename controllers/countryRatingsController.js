/**
 * Country Ratings Controller
 */
const { CountryRating, Country } = require("../models");
const { Op } = require("sequelize");

// Get all ratings for a country
exports.getRatings = async (req, res, next) => {
  try {
    const { countryId } = req.params;
    const { page = 1, limit = 20, approved, sortBy = "createdAt" } = req.query;

    const country = await Country.findByPk(countryId);
    if (!country) {
      return res.status(404).json({
        status: "error",
        message: "Country not found",
      });
    }

    // Public feedback endpoints must never expose hidden/unapproved submissions.
    const whereClause = { countryId: parseInt(countryId), isApproved: true };

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const order = sortBy === "rating" ? [["rating", "DESC"]] : [["createdAt", "DESC"]];

    const { count, rows: ratings } = await CountryRating.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: require("../models").User,
          as: "user",
          attributes: ["id", ["full_name", "name"], "email", ["avatar_url", "avatar"]],
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

// Get rating statistics for a country
exports.getRatingStats = async (req, res, next) => {
  try {
    const { countryId } = req.params;

    const country = await Country.findByPk(countryId);
    if (!country) {
      return res.status(404).json({
        status: "error",
        message: "Country not found",
      });
    }

    const ratings = await CountryRating.findAll({
      where: { 
        countryId: parseInt(countryId),
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
    const { countryId, ratingId } = req.params;

    const rating = await CountryRating.findOne({
      where: {
        id: parseInt(ratingId),
        countryId: parseInt(countryId),
      },
      include: [
        {
          model: require("../models").User,
          as: "user",
          attributes: ["id", ["full_name", "name"], "email", ["avatar_url", "avatar"]],
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
    const { countryId } = req.params;
    const { userId } = req.user || {};
    const { sessionId, rating, review } = req.body;

    const country = await Country.findByPk(countryId);
    if (!country) {
      return res.status(404).json({
        status: "error",
        message: "Country not found",
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

    const whereClause = { countryId: parseInt(countryId) };
    if (userId) {
      whereClause.userId = userId;
    } else {
      whereClause.sessionId = sessionId;
      whereClause.userId = null;
    }

    const existingRating = await CountryRating.findOne({ where: whereClause });

    // Ratings are immutable one-time votes per country/account (or anonymous session).
    if (existingRating) {
      return res.status(409).json({
        status: "error",
        code: "COUNTRY_ALREADY_RATED",
        message: "You have already rated this country. Each account can rate a country only once.",
        data: { rating: existingRating },
      });
    }

    const safeRating = Number(rating);
    const safeReview = typeof review === "string" ? review.trim().slice(0, 4000) : null;
    if (!Number.isInteger(safeRating) || safeRating < 1 || safeRating > 5) {
      return res.status(400).json({ status: "error", message: "Rating must be a whole number from 1 to 5" });
    }
    const newRating = await CountryRating.create({
      countryId: parseInt(countryId),
      userId: userId || null,
      sessionId: userId ? null : sessionId,
      rating: safeRating,
      review: safeReview,
      isApproved: true,
    });

    const stats = await this.getStatsForCountry(countryId);

    res.status(201).json({
      status: "success",
      message: "Rating created successfully",
      data: {
        rating: newRating,
        stats,
      },
    });
  } catch (error) {
    if (error?.name === "SequelizeUniqueConstraintError" || error?.original?.code === "23505") {
      return res.status(409).json({
        status: "error",
        code: "COUNTRY_ALREADY_RATED",
        message: "You have already rated this country. Each account can rate a country only once.",
      });
    }
    next(error);
  }
};

// Helper method to get stats
exports.getStatsForCountry = async (countryId) => {
  const ratings = await CountryRating.findAll({
    where: { 
      countryId: parseInt(countryId),
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
    const { countryId, ratingId } = req.params;
    const { userId, role } = req.user || {};

    const rating = await CountryRating.findOne({
      where: {
        id: parseInt(ratingId),
        countryId: parseInt(countryId),
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

// Get user's rating for a country
exports.getUserRating = async (req, res, next) => {
  try {
    const { countryId } = req.params;
    const { userId } = req.user || {};
    const { sessionId } = req.query;

    if (!userId && !sessionId) {
      return res.json({
        status: "success",
        data: { rating: null },
      });
    }

    const whereClause = { countryId: parseInt(countryId) };
    if (userId) {
      whereClause.userId = userId;
    } else {
      whereClause.sessionId = sessionId;
    }

    const rating = await CountryRating.findOne({ where: whereClause });

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
    const { countryId, ratingId } = req.params;
    const { isApproved } = req.body;

    const rating = await CountryRating.findOne({
      where: {
        id: parseInt(ratingId),
        countryId: parseInt(countryId),
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
