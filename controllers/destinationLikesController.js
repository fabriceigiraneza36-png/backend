/**
 * Destination Likes Controller
 */
const { DestinationLike, Destination, User } = require("../models");
const { Op } = require("sequelize");
const { query: db } = require("../config/db");
const logger = require("../utils/logger");

// Get all likes for a destination
exports.getLikes = async (req, res, next) => {
  const { destinationId } = req.params;
  
  try {
    const destination = await Destination.findByPk(destinationId);
    if (!destination) {
      return res.status(404).json({
        status: "error",
        message: "Destination not found",
      });
    }

    // Explicitly select existing columns to resolve column user.name does not exist errors
    const likes = await DestinationLike.findAll({
      where: { destinationId },
      include: [
        {
          model: User,
          as: "user",
          attributes: [
            "id", 
            ["full_name", "name"],    // Map the database column to the API response name
            "email", 
            ["avatar_url", "avatar"]  // Map the database column to the API response name
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const totalLikes = await DestinationLike.count({ where: { destinationId } });

    return res.json({
      status: "success",
      data: {
        likes,
        totalLikes,
      },
    });
  } catch (error) {
    logger.warn(`[DestinationLikes] Sequelize mapped fetch failed (${error.message}). Running raw query fallback...`);

    // Safe direct query fallback routing
    try {
      const rawLikes = await db(`
        SELECT dl.id, dl.destination_id, dl.user_id, dl.session_id, dl.created_at,
               u.id AS user_id_val, 
               u.full_name AS user_full_name, 
               u.avatar_url AS user_avatar_url,
               u.email AS user_email
        FROM destination_likes dl
        LEFT JOIN users u ON u.id = dl.user_id
        WHERE dl.destination_id = $1
        ORDER BY dl.created_at DESC
      `, [destinationId]);

      const totalLikesRes = await db(
        `SELECT COUNT(*)::INTEGER as cnt FROM destination_likes WHERE destination_id = $1`, 
        [destinationId]
      );

      const formatted = rawLikes.rows.map(row => ({
        id: row.id,
        destinationId: row.destination_id,
        userId: row.user_id,
        sessionId: row.session_id,
        createdAt: row.created_at,
        user: row.user_id_val ? {
          id: row.user_id_val,
          name: row.user_full_name || 'Anonymous Explorer',
          avatar: row.user_avatar_url || null,
          email: row.user_email
        } : null
      }));

      return res.json({
        status: "success",
        data: {
          likes: formatted,
          totalLikes: parseInt(totalLikesRes.rows[0]?.cnt || 0, 10),
        },
      });
    } catch (rawError) {
      logger.error("[DestinationLikes] Fallback execution failed:", rawError.message);
      next(rawError);
    }
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

    const whereClause = { destinationId: parseInt(destinationId, 10) };
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
      destinationId: parseInt(destinationId, 10),
      userId: userId || null,
      sessionId: userId ? null : sessionId,
    });

    const totalLikes = await DestinationLike.count({ where: { destinationId } });

    return res.status(201).json({
      status: "success",
      message: "Like added",
      data: {
        isLiked: true,
        totalLikes,
        like: newLike,
      },
    });
  } catch (error) {
    logger.error("[DestinationLikes] toggleLike failure:", error.message);
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

    const whereClause = { destinationId: parseInt(destinationId, 10) };
    if (userId) {
      whereClause.userId = userId;
    } else {
      whereClause.sessionId = sessionId;
    }

    const existingLike = await DestinationLike.findOne({ where: whereClause });

    return res.json({
      status: "success",
      data: {
        isLiked: !!existingLike,
      },
    });
  } catch (error) {
    logger.error("[DestinationLikes] checkLike failure:", error.message);
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

    const cleanedIds = destinationIds.map((id) => parseInt(id, 10)).filter(id => !isNaN(id));
    if (cleanedIds.length === 0) {
      return res.json({
        status: "success",
        data: []
      });
    }

    const likes = await DestinationLike.findAll({
      where: {
        destinationId: { [Op.in]: cleanedIds },
      },
      attributes: ["destinationId"],
      group: ["destinationId"],
    });

    const result = [];
    for (const id of cleanedIds) {
      const count = await DestinationLike.count({
        where: { destinationId: id },
      });
      result.push({
        destinationId: id,
        totalLikes: count
      });
    }

    return res.json({
      status: "success",
      data: result,
    });
  } catch (error) {
    logger.error("[DestinationLikes] getLikeStats failure:", error.message);
    next(error);
  }
};