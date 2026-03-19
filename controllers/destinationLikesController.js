/**
 * Destination Likes Controller
 */
const { DestinationLike, Destination } = require("../models");
const { Op } = require("sequelize");

// Get all likes for a destination
exports.getLikes = async (req, res, next) => {
  try {
    const { destinationId } = req.params;

    const destination = await Destination.findByPk(destinationId);
    if (!destination) {
      return res.status(404).json({
        status: "error",
        message: "Destination not found",
      });
    }

    const likes = await DestinationLike.findAll({
      where: { destinationId },
      include: [
        {
          model: require("../models").User,
          as: "user",
          attributes: ["id", "name", "email", "avatar"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const totalLikes = await DestinationLike.count({ where: { destinationId } });

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

// Toggle like on a destination
exports.toggleLike = async (req, res, next) => {
  try {
    const { destinationId } = req.params;
    const { userId } = req.user || {};
    const { sessionId } = req.body;

    const destination = await Destination.findByPk(destinationId);
    if (!destination) {
      return res.status(404).json({
        status: "error",
        message: "Destination not found",
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

    const existingLike = await DestinationLike.findOne({ where: whereClause });

    if (existingLike) {
      await existingLike.destroy();
      const totalLikes = await DestinationLike.count({ where: { destinationId } });

      return res.json({
        status: "success",
        message: "Like removed",
        data: {
          isLiked: false,
          totalLikes,
        },
      });
    }

    const newLike = await DestinationLike.create({
      destinationId: parseInt(destinationId),
      userId: userId || null,
      sessionId: userId ? null : sessionId,
    });

    const totalLikes = await DestinationLike.count({ where: { destinationId } });

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

// Check if user has liked a destination
exports.checkLike = async (req, res, next) => {
  try {
    const { destinationId } = req.params;
    const { userId } = req.user || {};
    const { sessionId } = req.query;

    if (!userId && !sessionId) {
      return res.json({
        status: "success",
        data: { isLiked: false },
      });
    }

    const whereClause = { destinationId: parseInt(destinationId) };
    if (userId) {
      whereClause.userId = userId;
    } else {
      whereClause.sessionId = sessionId;
    }

    const existingLike = await DestinationLike.findOne({ where: whereClause });

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

// Get like stats for multiple destinations
exports.getLikeStats = async (req, res, next) => {
  try {
    const { destinationIds } = req.body;

    if (!destinationIds || !Array.isArray(destinationIds)) {
      return res.status(400).json({
        status: "error",
        message: "destinationIds array is required",
      });
    }

    const likes = await DestinationLike.findAll({
      where: {
        destinationId: { [Op.in]: destinationIds.map((id) => parseInt(id)) },
      },
      attributes: ["destinationId"],
      group: ["destinationId"],
    });

    const likeCounts = {};
    for (const like of likes) {
      likeCounts[like.destinationId] = await DestinationLike.count({
        where: { destinationId: like.destinationId },
      });
    }

    const result = destinationIds.map((id) => ({
      destinationId: parseInt(id),
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
