// routes/reviews.js

"use strict";

const router     = require("express").Router();
const { query }  = require("../config/db");
const { protect, adminOnly } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════
// TABLE BOOTSTRAP
// ═══════════════════════════════════════════════════════════════

let tableReady = false;

const ensureReviewsTable = async () => {
  if (tableReady) return;

  await query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id           SERIAL        PRIMARY KEY,
      user_id      INTEGER       REFERENCES users(id) ON DELETE SET NULL,
      entity_type  VARCHAR(50)   NOT NULL DEFAULT 'general',
      entity_id    INTEGER,
      rating       NUMERIC(3,1)  NOT NULL CHECK (rating >= 1 AND rating <= 5),
      title        VARCHAR(200),
      body         TEXT,
      is_approved  BOOLEAN       NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);

  // Add indexes for faster aggregation — idempotent
  await query(`
    CREATE INDEX IF NOT EXISTS idx_reviews_is_approved
      ON reviews (is_approved);
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_reviews_rating
      ON reviews (rating);
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_reviews_created_at
      ON reviews (created_at DESC);
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_reviews_user_id
      ON reviews (user_id);
  `);

  tableReady = true;
  console.log("[Reviews] ✅ Table and indexes ready");
};

// ── Guarantee table exists before every request ────────────────
router.use(async (_req, _res, next) => {
  try {
    await ensureReviewsTable();
    next();
  } catch (err) {
    console.error("[Reviews] ❌ Table init failed:", err.message);
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Safe parseInt with fallback
 */
const toInt = (val, fallback = 0) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Safe parseFloat with fallback
 */
const toFloat = (val, fallback = 0) => {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Normalise rating distribution into a stable shape:
 * [ { star: 5, count: N }, ... { star: 1, count: N } ]
 * Fills missing stars with 0 so the frontend always gets all 5 entries.
 */
const normaliseDistribution = (rows = []) => {
  const map = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) {
    const star = toInt(row.star);
    if (star >= 1 && star <= 5) map[star] = toInt(row.count);
  }
  return [5, 4, 3, 2, 1].map((star) => ({
    star,
    count:      map[star],
    percentage: 0, // calculated below after we know total
  }));
};


router.get   ('/my',   protect, ctrl.getMyReviews);
router.delete('/my/:id', protect, ctrl.deleteMyReview);


// ═══════════════════════════════════════════════════════════════
// GET /api/reviews/stats
// ═══════════════════════════════════════════════════════════════


router.get("/stats", async (_req, res) => {
  try {
    const toInt   = (v) => parseInt(v,   10) || 0;
    const toFloat = (v) => parseFloat(v)     || 0;

    const [
      totalRes,
      approvedStatsRes,
      todayRes,
      monthRes,
      weekRes,
      distributionRes,
      categoryStatsRes,
      tripTypeRes,
      recentRes,
    ] = await Promise.all([

      // ── Total reviews (all statuses) ──────────────────────────
      query(`
        SELECT
          COUNT(*)                                          AS total,
          COUNT(*) FILTER (WHERE status = 'approved')       AS approved,
          COUNT(*) FILTER (WHERE status = 'pending')        AS pending,
          COUNT(*) FILTER (WHERE status = 'rejected')       AS rejected,
          COUNT(*) FILTER (WHERE status = 'spam')           AS spam,
          COUNT(*) FILTER (WHERE verified_booking = true)   AS verified,
          COUNT(*) FILTER (WHERE is_featured = true)        AS featured
        FROM reviews
      `),

      // ── Approved rating averages (all rating dimensions) ──────
      query(`
        SELECT
          COUNT(*)                                        AS approved_total,
          ROUND(AVG(overall_rating)::numeric,     2)      AS avg_overall,
          ROUND(AVG(cleanliness_rating)::numeric, 2)      AS avg_cleanliness,
          ROUND(AVG(value_rating)::numeric,       2)      AS avg_value,
          ROUND(AVG(service_rating)::numeric,     2)      AS avg_service,
          ROUND(AVG(location_rating)::numeric,    2)      AS avg_location,
          MIN(overall_rating)                             AS min_rating,
          MAX(overall_rating)                             AS max_rating
        FROM reviews
        WHERE status = 'approved'
          AND overall_rating IS NOT NULL
      `),

      // ── Reviews submitted today ───────────────────────────────
      query(`
        SELECT
          COUNT(*)                                              AS total_today,
          COUNT(*) FILTER (WHERE status = 'approved')           AS approved_today,
          COUNT(*) FILTER (WHERE status = 'pending')            AS pending_today
        FROM reviews
        WHERE created_at >= CURRENT_DATE
      `),

      // ── Reviews this calendar month ───────────────────────────
      query(`
        SELECT
          COUNT(*)                                              AS total_month,
          COUNT(*) FILTER (WHERE status = 'approved')           AS approved_month
        FROM reviews
        WHERE created_at >= DATE_TRUNC('month', NOW())
      `),

      // ── Reviews this week ─────────────────────────────────────
      query(`
        SELECT COUNT(*) AS total_week
        FROM reviews
        WHERE created_at >= DATE_TRUNC('week', NOW())
      `),

      // ── Rating distribution (approved, overall_rating 1–5) ───
      query(`
        SELECT
          FLOOR(overall_rating)::int  AS star,
          COUNT(*)                    AS count
        FROM reviews
        WHERE status = 'approved'
          AND overall_rating BETWEEN 1 AND 5
        GROUP BY FLOOR(overall_rating)
        ORDER BY star DESC
      `),

      // ── Sub-rating category averages breakdown ────────────────
      query(`
        SELECT
          ROUND(AVG(cleanliness_rating)::numeric, 2) AS cleanliness,
          ROUND(AVG(value_rating)::numeric,       2) AS value,
          ROUND(AVG(service_rating)::numeric,     2) AS service,
          ROUND(AVG(location_rating)::numeric,    2) AS location,
          COUNT(*) FILTER (WHERE cleanliness_rating IS NOT NULL) AS cleanliness_count,
          COUNT(*) FILTER (WHERE value_rating       IS NOT NULL) AS value_count,
          COUNT(*) FILTER (WHERE service_rating     IS NOT NULL) AS service_count,
          COUNT(*) FILTER (WHERE location_rating    IS NOT NULL) AS location_count
        FROM reviews
        WHERE status = 'approved'
      `),

      // ── Trip type breakdown ───────────────────────────────────
      query(`
        SELECT
          COALESCE(trip_type, 'unspecified')  AS trip_type,
          COUNT(*)                            AS count,
          ROUND(AVG(overall_rating)::numeric, 2) AS avg_rating
        FROM reviews
        WHERE status = 'approved'
        GROUP BY trip_type
        ORDER BY count DESC
        LIMIT 10
      `),

      // ── 5 most recent approved reviews (no JOIN needed) ───────
      query(`
        SELECT
          id,
          reviewer_name,
          reviewer_avatar,
          reviewer_location,
          title,
          review        AS body,
          overall_rating,
          trip_type,
          travel_date,
          verified_booking,
          is_featured,
          destination_id,
          booking_id,
          created_at
        FROM reviews
        WHERE status = 'approved'
        ORDER BY created_at DESC
        LIMIT 5
      `),
    ]);

    // ── Parse totals ───────────────────────────────────────────────────────
    const totalRow   = totalRes.rows[0]         || {};
    const statsRow   = approvedStatsRes.rows[0] || {};
    const todayRow   = todayRes.rows[0]         || {};
    const monthRow   = monthRes.rows[0]         || {};
    const weekRow    = weekRes.rows[0]           || {};
    const catRow     = categoryStatsRes.rows[0] || {};

    const totalReviews     = toInt(totalRow.total);
    const approvedTotal    = toInt(totalRow.approved);
    const pendingTotal     = toInt(totalRow.pending);
    const rejectedTotal    = toInt(totalRow.rejected);
    const spamTotal        = toInt(totalRow.spam);
    const verifiedTotal    = toInt(totalRow.verified);
    const featuredTotal    = toInt(totalRow.featured);

    const averageRating    = toFloat(statsRow.avg_overall);
    const minRating        = toFloat(statsRow.min_rating);
    const maxRating        = toFloat(statsRow.max_rating);

    const reviewsToday         = toInt(todayRow.total_today);
    const approvedToday        = toInt(todayRow.approved_today);
    const pendingToday         = toInt(todayRow.pending_today);
    const reviewsThisMonth     = toInt(monthRow.total_month);
    const approvedThisMonth    = toInt(monthRow.approved_month);
    const reviewsThisWeek      = toInt(weekRow.total_week);

    // ── Rating distribution — always return all 5 stars ───────────────────
    const starMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of distributionRes.rows) {
      const s = toInt(row.star);
      if (s >= 1 && s <= 5) starMap[s] = toInt(row.count);
    }

    const ratingDistribution = [5, 4, 3, 2, 1].map((star) => ({
      star,
      label:      `${star} Star${star !== 1 ? "s" : ""}`,
      count:      starMap[star],
      percentage: approvedTotal > 0
        ? Math.round((starMap[star] / approvedTotal) * 100)
        : 0,
    }));

    // ── Sub-rating category averages ──────────────────────────────────────
    const categoryAverages = {
      cleanliness: {
        average: toFloat(catRow.cleanliness),
        count:   toInt(catRow.cleanliness_count),
      },
      value: {
        average: toFloat(catRow.value),
        count:   toInt(catRow.value_count),
      },
      service: {
        average: toFloat(catRow.service),
        count:   toInt(catRow.service_count),
      },
      location: {
        average: toFloat(catRow.location),
        count:   toInt(catRow.location_count),
      },
    };

    // ── Build response ─────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      data: {

        // Counts
        totalReviews,
        approvedTotal,
        pendingTotal,
        rejectedTotal,
        spamTotal,
        verifiedTotal,
        featuredTotal,

        // Ratings
        averageRating,
        minRating,
        maxRating,

        // Time periods
        activity: {
          today: {
            total:    reviewsToday,
            approved: approvedToday,
            pending:  pendingToday,
          },
          thisWeek: {
            total: reviewsThisWeek,
          },
          thisMonth: {
            total:    reviewsThisMonth,
            approved: approvedThisMonth,
          },
        },

        // Distribution
        ratingDistribution,

        // Category breakdown
        categoryAverages,

        // Trip types
        tripTypeBreakdown: tripTypeRes.rows.map((r) => ({
          tripType:  r.trip_type,
          count:     toInt(r.count),
          avgRating: toFloat(r.avg_rating),
        })),

        // Recent reviews preview
        recentReviews: recentRes.rows.map((r) => ({
          id:              r.id,
          reviewerName:    r.reviewer_name    || "Anonymous",
          reviewerAvatar:  r.reviewer_avatar  || null,
          reviewerLocation: r.reviewer_location || null,
          title:           r.title            || null,
          body:            r.body             || null,
          rating:          toFloat(r.overall_rating),
          tripType:        r.trip_type        || null,
          travelDate:      r.travel_date      || null,
          verifiedBooking: r.verified_booking || false,
          isFeatured:      r.is_featured      || false,
          destinationId:   r.destination_id   || null,
          bookingId:       r.booking_id       || null,
          createdAt:       r.created_at,
        })),
      },
    });

  } catch (error) {
    console.error("[Reviews] ❌ /stats error:", error);
    return res.status(500).json({
      success:  false,
      message:  "Failed to fetch review stats",
      error:    error.message,
      code:     error.code,
      detail:   error.detail,
    });
  }
});


// ═══════════════════════════════════════════════════════════════
// GET /api/reviews — Paginated list (public)
// ═══════════════════════════════════════════════════════════════

router.get("/", async (req, res) => {
  try {
    const page        = Math.max(1, toInt(req.query.page,  1));
    const limit       = Math.min(50, toInt(req.query.limit, 10));
    const offset      = (page - 1) * limit;
    const entityType  = req.query.entity_type || null;
    const entityId    = req.query.entity_id   || null;
    const minRating   = toFloat(req.query.min_rating, 1);
    const sortBy      = ["created_at", "rating"].includes(req.query.sort_by)
                          ? req.query.sort_by
                          : "created_at";
    const sortDir     = req.query.sort_dir === "asc" ? "ASC" : "DESC";

    // Build dynamic WHERE clauses
    const conditions  = ["r.is_approved = true"];
    const params      = [];

    if (entityType) {
      params.push(entityType);
      conditions.push(`r.entity_type = $${params.length}`);
    }
    if (entityId) {
      params.push(toInt(entityId));
      conditions.push(`r.entity_id = $${params.length}`);
    }
    if (minRating > 1) {
      params.push(minRating);
      conditions.push(`r.rating >= $${params.length}`);
    }

    const whereClause = conditions.join(" AND ");

    // Data + count in parallel
    const dataParams  = [...params, limit, offset];
    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT
           r.id,
           r.rating,
           r.title,
           r.body,
           r.entity_type,
           r.entity_id,
           r.created_at,
           r.updated_at,
           u.full_name  AS user_name,
           u.avatar_url AS user_avatar
         FROM   reviews r
         LEFT   JOIN users u ON u.id = r.user_id
         WHERE  ${whereClause}
         ORDER  BY r.${sortBy} ${sortDir}
         LIMIT  $${params.length + 1}
         OFFSET $${params.length + 2}`,
        dataParams
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM   reviews r
         WHERE  ${whereClause}`,
        params
      ),
    ]);

    const total      = toInt(countRes.rows[0]?.total);
    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      data:    dataRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });

  } catch (error) {
    console.error("[Reviews] ❌ GET / error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reviews",
      ...(process.env.NODE_ENV !== "production" && {
        error: error.message,
      }),
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/reviews/:id — Single review (public)
// ═══════════════════════════════════════════════════════════════

router.get("/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid review ID",
      });
    }

    const { rows } = await query(
      `SELECT
         r.*,
         u.full_name  AS user_name,
         u.avatar_url AS user_avatar
       FROM   reviews r
       LEFT   JOIN users u ON u.id = r.user_id
       WHERE  r.id = $1
         AND  r.is_approved = true`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    return res.status(200).json({ success: true, data: rows[0] });

  } catch (error) {
    console.error("[Reviews] ❌ GET /:id error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch review",
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/reviews — Submit a review (protected)
// ═══════════════════════════════════════════════════════════════

router.post("/", protect, async (req, res) => {
  try {
    const {
      rating,
      title       = null,
      body        = null,
      entity_type = "general",
      entity_id   = null,
    } = req.body;

    // ── Validate ───────────────────────────────────────────────
    const parsedRating = toFloat(rating);
    if (!parsedRating || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be a number between 1 and 5",
      });
    }

    if (title && title.length > 200) {
      return res.status(400).json({
        success: false,
        message: "Title must be 200 characters or fewer",
      });
    }

    // ── Prevent duplicate review for same entity ───────────────
    if (entity_id) {
      const dupCheck = await query(
        `SELECT id FROM reviews
         WHERE user_id     = $1
           AND entity_type = $2
           AND entity_id   = $3
         LIMIT 1`,
        [req.user.id, entity_type, toInt(entity_id)]
      );
      if (dupCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: "You have already reviewed this item",
        });
      }
    }

    // ── Insert ─────────────────────────────────────────────────
    const { rows } = await query(
      `INSERT INTO reviews
         (user_id, entity_type, entity_id, rating, title, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.user.id,
        entity_type,
        entity_id ? toInt(entity_id) : null,
        parsedRating,
        title  || null,
        body   || null,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Review submitted successfully",
      data:    rows[0],
    });

  } catch (error) {
    console.error("[Reviews] ❌ POST / error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit review",
      ...(process.env.NODE_ENV !== "production" && {
        error: error.message,
      }),
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// PATCH /api/reviews/:id — Edit own review (protected)
// ═══════════════════════════════════════════════════════════════

router.patch("/:id", protect, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid review ID" });
    }

    const { rating, title, body } = req.body;
    const fields  = [];
    const params  = [];

    if (rating !== undefined) {
      const r = toFloat(rating);
      if (r < 1 || r > 5) {
        return res.status(400).json({
          success: false,
          message: "Rating must be between 1 and 5",
        });
      }
      params.push(r);
      fields.push(`rating = $${params.length}`);
    }

    if (title !== undefined) {
      params.push(title || null);
      fields.push(`title = $${params.length}`);
    }

    if (body !== undefined) {
      params.push(body || null);
      fields.push(`body = $${params.length}`);
    }

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields provided to update",
      });
    }

    params.push(id, req.user.id);
    fields.push(`updated_at = NOW()`);

    const { rows } = await query(
      `UPDATE reviews
       SET    ${fields.join(", ")}
       WHERE  id      = $${params.length - 1}
         AND  user_id = $${params.length}
       RETURNING *`,
      params
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Review not found or you do not own it",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Review updated",
      data:    rows[0],
    });

  } catch (error) {
    console.error("[Reviews] ❌ PATCH /:id error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update review",
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/reviews/:id — Delete own review (protected)
// ═══════════════════════════════════════════════════════════════

router.delete("/:id", protect, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid review ID" });
    }

    const { rows } = await query(
      `DELETE FROM reviews
       WHERE  id      = $1
         AND  user_id = $2
       RETURNING id`,
      [id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Review not found or you do not own it",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Review deleted successfully",
    });

  } catch (error) {
    console.error("[Reviews] ❌ DELETE /:id error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete review",
    });
  }
});

module.exports = router;