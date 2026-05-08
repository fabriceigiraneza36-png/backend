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