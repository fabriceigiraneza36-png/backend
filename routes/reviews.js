// routes/reviews.js
const router     = require("express").Router();
const { query }  = require("../config/db");
const { protect } = require("../middleware/auth");

// ═══════════════════════════════════════════════════════════════
// ENSURE reviews table exists (auto-create if missing)
// ═══════════════════════════════════════════════════════════════
const ensureReviewsTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      entity_type VARCHAR(50)  NOT NULL DEFAULT 'general',
      entity_id   INTEGER,
      rating      NUMERIC(3,1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
      title       VARCHAR(200),
      body        TEXT,
      is_approved BOOLEAN      NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
};

// Auto-create table when this route file loads
ensureReviewsTable().catch((err) =>
  console.warn("[Reviews] Table init warning:", err.message)
);

// ═══════════════════════════════════════════════════════════════
// GET /api/reviews/stats
// ═══════════════════════════════════════════════════════════════
router.get("/stats", async (req, res) => {
  try {
    const [totalRes, avgRes, todayRes, distributionRes, recentRes] =
      await Promise.all([

        // Total reviews
        query(`SELECT COUNT(*) AS total FROM reviews`),

        // Average rating
        query(
          `SELECT ROUND(AVG(rating)::numeric, 2) AS average
           FROM reviews
           WHERE is_approved = true`
        ),

        // Reviews submitted today
        query(
          `SELECT COUNT(*) AS count
           FROM reviews
           WHERE created_at >= CURRENT_DATE`
        ),

        // Rating distribution (1★ to 5★)
        query(
          `SELECT
             FLOOR(rating)::int AS star,
             COUNT(*)           AS count
           FROM reviews
           WHERE is_approved = true
           GROUP BY FLOOR(rating)
           ORDER BY star DESC`
        ),

        // Reviews this month
        query(
          `SELECT COUNT(*) AS count
           FROM reviews
           WHERE created_at >= NOW() - INTERVAL '30 days'`
        ),
      ]);

    return res.status(200).json({
      success: true,
      data: {
        totalReviews:        parseInt(totalRes.rows[0]?.total     || 0),
        averageRating:       parseFloat(avgRes.rows[0]?.average   || 0),
        reviewsToday:        parseInt(todayRes.rows[0]?.count     || 0),
        reviewsThisMonth:    parseInt(recentRes.rows[0]?.count    || 0),
        ratingDistribution:  distributionRes.rows,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch review stats",
      error:   error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/reviews — Get all reviews (with pagination)
// ═══════════════════════════════════════════════════════════════
router.get("/", async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || "1"));
    const limit = Math.min(50, parseInt(req.query.limit || "10"));
    const offset = (page - 1) * limit;

    const { rows } = await query(
      `SELECT
         r.*,
         u.full_name  AS user_name,
         u.avatar_url AS user_avatar
       FROM reviews r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.is_approved = true
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countRes = await query(
      `SELECT COUNT(*) AS total FROM reviews WHERE is_approved = true`
    );

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total:      parseInt(countRes.rows[0]?.total || 0),
        totalPages: Math.ceil(countRes.rows[0]?.total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reviews",
      error:   error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/reviews — Submit a review (protected)
// ═══════════════════════════════════════════════════════════════
router.post("/", protect, async (req, res) => {
  try {
    const { rating, title, body, entity_type, entity_id } = req.body;

    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
      });

    const { rows } = await query(
      `INSERT INTO reviews
         (user_id, entity_type, entity_id, rating, title, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.user.id,
        entity_type || "general",
        entity_id   || null,
        rating,
        title       || null,
        body        || null,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Review submitted successfully",
      data:    rows[0],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to submit review",
      error:   error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/reviews/:id — Delete own review (protected)
// ═══════════════════════════════════════════════════════════════
router.delete("/:id", protect, async (req, res) => {
  try {
    const { rows } = await query(
      `DELETE FROM reviews
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.id, req.user.id]
    );

    if (rows.length === 0)
      return res.status(404).json({
        success: false,
        message: "Review not found or not yours",
      });

    return res.json({ success: true, message: "Review deleted" });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete review",
      error:   error.message,
    });
  }
});

module.exports = router;