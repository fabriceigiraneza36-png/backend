// controllers/reviewsController.js
// ============================================================
// Reviews Controller — Global Reviews Stats
// ============================================================

const { query } = require("../config/db");

/* ═══════════════════════════════════════════════════════════════
   STATS
   ═══════════════════════════════════════════════════════════════ */

exports.getStats = async (req, res, next) => {
  try {
    const stats = await query(`
      SELECT
        COUNT(*) AS total_reviews,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved_reviews,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_reviews,
        AVG(overall_rating) AS avg_rating,
        MIN(overall_rating) AS min_rating,
        MAX(overall_rating) AS max_rating,
        COUNT(DISTINCT destination_id) AS destinations_with_reviews
      FROM destination_reviews
    `);

    const ratingDistribution = await query(`
      SELECT overall_rating, COUNT(*) AS count
      FROM destination_reviews
      WHERE status = 'approved'
      GROUP BY overall_rating
      ORDER BY overall_rating DESC
    `);

    const recentReviews = await query(`
      SELECT COUNT(*) AS count
      FROM destination_reviews
      WHERE created_at >= NOW() - INTERVAL '30 days'
      AND status = 'approved'
    `);

    res.json({
      success: true,
      data: {
        overview: {
          totalReviews: parseInt(stats.rows[0].total_reviews) || 0,
          approvedReviews: parseInt(stats.rows[0].approved_reviews) || 0,
          pendingReviews: parseInt(stats.rows[0].pending_reviews) || 0,
          avgRating: parseFloat(stats.rows[0].avg_rating) || 0,
          minRating: parseFloat(stats.rows[0].min_rating) || 0,
          maxRating: parseFloat(stats.rows[0].max_rating) || 0,
          destinationsWithReviews: parseInt(stats.rows[0].destinations_with_reviews) || 0,
          recentReviews: parseInt(recentReviews.rows[0].count) || 0,
        },
        ratingDistribution: ratingDistribution.rows.map(r => ({
          rating: parseFloat(r.overall_rating),
          count: parseInt(r.count)
        }))
      }
    });
  } catch (err) {
    next(err);
  }
};

// Add this method to your existing backend/controllers/reviewsController.js

/**
 * GET /api/reviews/my
 * Returns all reviews written by the currently authenticated user
 */
exports.getMyReviews = async (req, res) => {
  try {
    const userId = req.user.id;
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(50, parseInt(req.query.limit || '20', 10));
    const offset = (page - 1) * limit;

    const { rows } = await query(
      `SELECT r.*,
              d.name          AS destination_name,
              d.thumbnail_url AS destination_image,
              d.slug          AS destination_slug
         FROM reviews r
         LEFT JOIN destinations d ON d.id = r.destination_id
        WHERE r.user_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    const countRes = await query(
      `SELECT COUNT(*) FROM reviews WHERE user_id = $1`,
      [userId],
    );

    res.json({
      success: true,
      data:    rows,
      reviews: rows,
      pagination: {
        page,
        limit,
        total:       parseInt(countRes.rows[0].count, 10),
        total_pages: Math.ceil(parseInt(countRes.rows[0].count, 10) / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/reviews/:id
 * User deletes their own review
 */
exports.deleteMyReview = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { rows } = await query(
      `DELETE FROM reviews WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId],
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Review not found or not yours.' });
    }

    res.json({ success: true, message: 'Review deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};