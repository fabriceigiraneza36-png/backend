// routes/reviews.js

"use strict";

const router     = require("express").Router();
const { query }  = require("../config/db");
const { protect, adminOnly } = require('../middleware/auth');
const reviewsController = require("../controllers/reviewsController");
const { notifyReviewPosted } = require("../controllers/notificationsController");

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

  // Keep the runtime review model compatible with databases created by older
  // versions of the site. Additive changes preserve existing review records.
  await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50) NOT NULL DEFAULT 'general'`);
  await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS entity_id INTEGER`);
  await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS rating NUMERIC(3,1)`);
  await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS title VARCHAR(200)`);
  await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS body TEXT`);
  await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT true`);
  await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

  // Backfill compatible legacy fields only when they exist in this database.
  await query(`
    DO $review_migration$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'reviews' AND column_name = 'overall_rating') THEN
        EXECUTE 'UPDATE reviews SET rating = overall_rating WHERE rating IS NULL AND overall_rating BETWEEN 1 AND 5';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'reviews' AND column_name = 'review') THEN
        EXECUTE 'UPDATE reviews SET body = review WHERE body IS NULL';
      ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'reviews' AND column_name = 'content') THEN
        EXECUTE 'UPDATE reviews SET body = content WHERE body IS NULL';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'reviews' AND column_name = 'status') THEN
        EXECUTE 'UPDATE reviews SET is_approved = (status = ''approved'')';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'reviews' AND column_name = 'destination_id') THEN
        EXECUTE 'UPDATE reviews SET entity_id = destination_id, entity_type = ''destination'' WHERE entity_id IS NULL AND destination_id IS NOT NULL';
      END IF;
    END $review_migration$
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


router.get   ('/my',   protect, reviewsController.getMyReviews);
router.delete('/my/:id', protect, reviewsController.deleteMyReview);


// ═══════════════════════════════════════════════════════════════
// GET /api/reviews/stats
// ═══════════════════════════════════════════════════════════════


router.get("/stats", async (_req, res) => {
  try {
    const [totalsRes, ratingsRes, distributionRes, activityRes, recentRes] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::INTEGER AS total,
          COUNT(*) FILTER (WHERE is_approved = true)::INTEGER AS approved,
          COUNT(*) FILTER (WHERE is_approved = false)::INTEGER AS pending
        FROM reviews
      `),
      query(`
        SELECT
          COUNT(*)::INTEGER AS total,
          ROUND(AVG(rating)::numeric, 2) AS average,
          MIN(rating) AS minimum,
          MAX(rating) AS maximum
        FROM reviews
        WHERE is_approved = true AND rating BETWEEN 1 AND 5
      `),
      query(`
        SELECT FLOOR(rating)::INTEGER AS star, COUNT(*)::INTEGER AS count
        FROM reviews
        WHERE is_approved = true AND rating BETWEEN 1 AND 5
        GROUP BY FLOOR(rating)
        ORDER BY star DESC
      `),
      query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::INTEGER AS today,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND is_approved = true)::INTEGER AS approved_today,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND is_approved = false)::INTEGER AS pending_today,
          COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('week', NOW()))::INTEGER AS this_week,
          COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()))::INTEGER AS this_month,
          COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()) AND is_approved = true)::INTEGER AS approved_month
        FROM reviews
      `),
      query(`
        SELECT
          r.id, r.title, r.body, r.rating, r.entity_type, r.entity_id, r.created_at,
          COALESCE(NULLIF(u.full_name, ''), 'Anonymous') AS reviewer_name,
          u.avatar_url AS reviewer_avatar,
          d.name AS destination_name
        FROM reviews r
        LEFT JOIN users u ON u.id = r.user_id
        LEFT JOIN destinations d ON d.id = r.entity_id AND r.entity_type = 'destination'
        WHERE r.is_approved = true
        ORDER BY r.created_at DESC
        LIMIT 5
      `),
    ]);

    const totals = totalsRes.rows[0] || {};
    const ratings = ratingsRes.rows[0] || {};
    const activity = activityRes.rows[0] || {};
    const approvedTotal = Number(totals.approved) || 0;
    const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of distributionRes.rows) {
      const star = Number(row.star);
      if (star >= 1 && star <= 5) stars[star] = Number(row.count) || 0;
    }

    return res.status(200).json({
      success: true,
      data: {
        totalReviews: Number(totals.total) || 0,
        approvedTotal,
        pendingTotal: Number(totals.pending) || 0,
        rejectedTotal: 0,
        spamTotal: 0,
        verifiedTotal: 0,
        featuredTotal: 0,
        averageRating: Number(ratings.average) || 0,
        minRating: Number(ratings.minimum) || 0,
        maxRating: Number(ratings.maximum) || 0,
        activity: {
          today: { total: Number(activity.today) || 0, approved: Number(activity.approved_today) || 0, pending: Number(activity.pending_today) || 0 },
          thisWeek: { total: Number(activity.this_week) || 0 },
          thisMonth: { total: Number(activity.this_month) || 0, approved: Number(activity.approved_month) || 0 },
        },
        ratingDistribution: [5, 4, 3, 2, 1].map(star => ({
          star,
          label: `${star} Star${star === 1 ? "" : "s"}`,
          count: stars[star],
          percentage: approvedTotal ? Math.round(stars[star] * 100 / approvedTotal) : 0,
        })),
        categoryAverages: {
          cleanliness: { average: 0, count: 0 },
          value: { average: 0, count: 0 },
          service: { average: 0, count: 0 },
          location: { average: 0, count: 0 },
        },
        tripTypeBreakdown: [],
        recentReviews: recentRes.rows.map(row => ({
          id: row.id,
          reviewerName: row.reviewer_name || "Anonymous",
          reviewerAvatar: row.reviewer_avatar || null,
          reviewerLocation: null,
          title: row.title || null,
          body: row.body || null,
          rating: Number(row.rating) || 0,
          tripType: null,
          travelDate: null,
          verifiedBooking: false,
          isFeatured: false,
          destinationId: row.entity_type === "destination" ? row.entity_id : null,
          bookingId: null,
          destinationName: row.destination_name || null,
          entityType: row.entity_type,
          createdAt: row.created_at,
        })),
      },
    });
  } catch (error) {
    console.error("[Reviews] /stats error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch review stats",
      error: error.message,
      code: error.code,
    });
  }
});


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

    // ── Notify user + aggregate to admins ──────────────────────
    notifyReviewPosted(
      { title, rating: parsedRating },
      { id: req.user.id, email: req.user.email, name: req.user.full_name || req.user.email },
    ).catch(() => {});

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