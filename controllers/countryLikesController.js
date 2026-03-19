/**
 * Country Likes Controller
 */
const { CountryLike, Country } = require("../models");
const { Op } = require("sequelize");

// Get all likes for a country
exports.getLikes = async (req, res, next) => {
  try {
    const { countryId } = req.params;

    const country = await Country.findByPk(countryId);
    if (!country) {
      return res.status(404).json({
        status: "error",
        message: "Country not found",
      });
    }

    const likes = await CountryLike.findAll({
      where: { countryId },
      include: [
        {
          model: require("../models").User,
          as: "user",
          attributes: ["id", "name", "email", "avatar"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const totalLikes = await CountryLike.count({ where: { countryId } });

    res.json({
      status: "success",
      data: {
        likes,
        totalLikes,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Toggle like on a country
exports.toggleLike = async (req, res, next) => {
  try {
    const { countryId } = req.params;
    const { userId } = req.user || {};
    const { sessionId } = req.body;

    const country = await Country.findByPk(countryId);
    if (!country) {
      return res.status(404).json({
        status: "error",
        message: "Country not found",
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

    const existingLike = await CountryLike.findOne({ where: whereClause });

    if (existingLike) {
      await existingLike.destroy();
      const totalLikes = await CountryLike.count({ where: { countryId } });

      return res.json({
        status: "success",
        message: "Like removed",
        data: {
          isLiked: false,
          totalLikes,
        },
      });
    }

    const newLike = await CountryLike.create({
      countryId: parseInt(countryId),
      userId: userId || null,
      sessionId: userId ? null : sessionId,
    });

    const totalLikes = await CountryLike.count({ where: { countryId } });

    res.status(201).json({
      status: "success",
      message: "Like added",
      data: {
        isLiked: true,
        totalLikes,
        like: newLike,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Check if user has liked a country
exports.checkLike = async (req, res, next) => {
  try {
    const { countryId } = req.params;
    const { userId } = req.user || {};
    const { sessionId } = req.query;

    if (!userId && !sessionId) {
      return res.json({
        status: "success",
        data: { isLiked: false },
      });
    }

    const whereClause = { countryId: parseInt(countryId) };
    if (userId) {
      whereClause.userId = userId;
    } else {
      whereClause.sessionId = sessionId;
    }

    const existingLike = await CountryLike.findOne({ where: whereClause });

    res.json({
      status: "success",
      data: {
        isLiked: !!existingLike,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get like stats for multiple countries
exports.getLikeStats = async (req, res, next) => {
  try {
    const { countryIds } = req.body;

    if (!countryIds || !Array.isArray(countryIds)) {
      return res.status(400).json({
        status: "error",
        message: "countryIds array is required",
      });
    }

    const likes = await CountryLike.findAll({
      where: {
        countryId: { [Op.in]: countryIds.map((id) => parseInt(id)) },
      },
      attributes: ["countryId"],
      group: ["countryId"],
    });

    const likeCounts = {};
    for (const like of likes) {
      likeCounts[like.countryId] = await CountryLike.count({
        where: { countryId: like.countryId },
      });
    }

    const result = countryIds.map((id) => ({
      countryId: parseInt(id),
      totalLikes: likeCounts[parseInt(id)] || 0,
    }));

    res.json({
      status: "success",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
