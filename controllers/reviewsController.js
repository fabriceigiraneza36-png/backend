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
        COUNT(*)::INTEGER AS total_reviews,
        COUNT(*) FILTER (WHERE is_approved = true)::INTEGER AS approved_reviews,
        COUNT(*) FILTER (WHERE is_approved = false)::INTEGER AS pending_reviews,
        AVG(rating) FILTER (WHERE is_approved = true AND rating BETWEEN 1 AND 5) AS avg_rating,
        MIN(rating) FILTER (WHERE is_approved = true AND rating BETWEEN 1 AND 5) AS min_rating,
        MAX(rating) FILTER (WHERE is_approved = true AND rating BETWEEN 1 AND 5) AS max_rating,
        COUNT(DISTINCT entity_id) FILTER (WHERE entity_type = 'destination' AND is_approved = true)::INTEGER AS destinations_with_reviews
      FROM reviews
    `);

    const ratingDistribution = await query(`
      SELECT FLOOR(rating)::INTEGER AS rating, COUNT(*)::INTEGER AS count
      FROM reviews
      WHERE is_approved = true AND rating BETWEEN 1 AND 5
      GROUP BY FLOOR(rating)
      ORDER BY rating DESC
    `);

    const recentReviews = await query(`
      SELECT COUNT(*)::INTEGER AS count
      FROM reviews
      WHERE created_at >= NOW() - INTERVAL '30 days' AND is_approved = true
    `);

    const row = stats.rows[0] || {};
    res.json({
      success: true,
      data: {
        overview: {
          totalReviews: Number(row.total_reviews) || 0,
          approvedReviews: Number(row.approved_reviews) || 0,
          pendingReviews: Number(row.pending_reviews) || 0,
          avgRating: Number(row.avg_rating) || 0,
          minRating: Number(row.min_rating) || 0,
          maxRating: Number(row.max_rating) || 0,
          destinationsWithReviews: Number(row.destinations_with_reviews) || 0,
          recentReviews: Number(recentReviews.rows[0]?.count) || 0,
        },
        ratingDistribution: ratingDistribution.rows.map(r => ({
          rating: Number(r.rating) || 0,
          count: Number(r.count) || 0,
        })),
      },
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
         LEFT JOIN destinations d ON d.id = r.entity_id AND r.entity_type = 'destination'
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