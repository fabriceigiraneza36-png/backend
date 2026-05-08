// routes/team.js
const express   = require("express");
const router    = express.Router();
const { query } = require("../config/db");
const logger    = require("../utils/logger");

// ═══════════════════════════════════════════════════════════════
// AUTO-CREATE team table + add missing columns safely
// ═══════════════════════════════════════════════════════════════
const ensureTeamTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS team (
      id              SERIAL PRIMARY KEY,
      name            VARCHAR(150)  NOT NULL,
      role            VARCHAR(150),
      department      VARCHAR(100)  DEFAULT 'General',
      bio             TEXT,
      avatar_url      TEXT,
      email           VARCHAR(255),
      phone           VARCHAR(50),
      linkedin_url    TEXT,
      twitter_url     TEXT,
      instagram_url   TEXT,
      facebook_url    TEXT,
      display_order   INTEGER       DEFAULT 0,
      is_active       BOOLEAN       DEFAULT true,
      is_featured     BOOLEAN       DEFAULT false,
      created_at      TIMESTAMPTZ   DEFAULT NOW(),
      updated_at      TIMESTAMPTZ   DEFAULT NOW()
    )
  `);

  const cols = [
    ["department",    "VARCHAR(100) DEFAULT 'General'"],
    ["display_order", "INTEGER DEFAULT 0"],
    ["is_active",     "BOOLEAN DEFAULT true"],
    ["is_featured",   "BOOLEAN DEFAULT false"],
    ["linkedin_url",  "TEXT"],
    ["twitter_url",   "TEXT"],
    ["instagram_url", "TEXT"],
    ["facebook_url",  "TEXT"],
    ["phone",         "VARCHAR(50)"],
    ["email",         "VARCHAR(255)"],
    ["bio",           "TEXT"],
    ["avatar_url",    "TEXT"],
    ["role",          "VARCHAR(150)"],
  ];

  for (const [col, def] of cols) {
    try {
      await query(`ALTER TABLE team ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    } catch (e) {
      logger.warn(`[Team] Could not add column ${col}: ${e.message}`);
    }
  }
};

ensureTeamTable()
  .then(() => logger.info("✅ Team table ready"))
  .catch((e) => logger.warn("⚠️  Team table init warning:", e.message));

// ═══════════════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════════════
const handleError = (res, err, message = "Operation failed") => {
  logger.error(`[Team] ${message}: ${err.message}`);
  return res.status(500).json({ success: false, message, error: err.message });
};

// ═══════════════════════════════════════════════════════════════
// GET /api/team/departments/list
// ═══════════════════════════════════════════════════════════════
router.get("/departments/list", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        COALESCE(NULLIF(TRIM(department), ''), 'General') AS department,
        COUNT(*) AS member_count
      FROM team
      WHERE is_active = true
      GROUP BY COALESCE(NULLIF(TRIM(department), ''), 'General')
      ORDER BY department ASC
    `);

    const departments = rows.map((r) => ({
      name:        r.department,
      memberCount: parseInt(r.member_count || 0),
    }));

    return res.status(200).json({
      success: true,
      data: [
        {
          name: "All",
          memberCount: departments.reduce((s, d) => s + d.memberCount, 0),
        },
        ...departments,
      ],
    });
  } catch (err) {
    return handleError(res, err, "Failed to fetch departments");
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/team/stats
// ═══════════════════════════════════════════════════════════════
router.get("/stats", async (req, res) => {
  try {
    const [totalRes, activeRes, featuredRes, deptRes] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM team`),
      query(`SELECT COUNT(*) AS count FROM team WHERE is_active   = true`),
      query(`SELECT COUNT(*) AS count FROM team WHERE is_featured = true`),
      query(`
        SELECT COUNT(DISTINCT COALESCE(NULLIF(TRIM(department),''),'General')) AS count
        FROM team
      `),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalMembers:     parseInt(totalRes.rows[0]?.total   || 0),
        activeMembers:    parseInt(activeRes.rows[0]?.count  || 0),
        featuredMembers:  parseInt(featuredRes.rows[0]?.count || 0),
        totalDepartments: parseInt(deptRes.rows[0]?.count    || 0),
      },
    });
  } catch (err) {
    return handleError(res, err, "Failed to fetch team stats");
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/team/featured
// ═══════════════════════════════════════════════════════════════
router.get("/featured", async (req, res) => {
  try {
    const limit = Math.min(20, parseInt(req.query.limit || "6"));

    const { rows } = await query(
      `SELECT
         id, name, role, department, bio,
         avatar_url, email, phone,
         linkedin_url, twitter_url, instagram_url, facebook_url,
         display_order, is_active, is_featured,
         created_at, updated_at
       FROM team
       WHERE is_active = true AND is_featured = true
       ORDER BY display_order ASC, name ASC
       LIMIT $1`,
      [limit]
    );

    return res.status(200).json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    return handleError(res, err, "Failed to fetch featured members");
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/team
// ═══════════════════════════════════════════════════════════════
router.get("/", async (req, res) => {
  try {
    const {
      sort       = "display_order",
      order      = "ASC",
      limit      = "100",
      page       = "1",
      department,
      featured,
      active     = "true",
    } = req.query;

    const allowedSorts = ["display_order","name","role","department","created_at","updated_at"];
    const safeSort  = allowedSorts.includes(sort) ? sort : "display_order";
    const safeOrder = order.toUpperCase() === "DESC" ? "DESC" : "ASC";
    const safeLimit = Math.min(200, Math.max(1, parseInt(limit) || 100));
    const safePage  = Math.max(1, parseInt(page) || 1);
    const offset    = (safePage - 1) * safeLimit;

    const conditions = [];
    const params     = [];

    if (active !== "all") {
      params.push(active !== "false");
      conditions.push(`is_active = $${params.length}`);
    }

    if (department && department !== "All" && department !== "all") {
      params.push(department);
      conditions.push(`COALESCE(NULLIF(TRIM(department),''),'General') = $${params.length}`);
    }

    if (featured === "true") {
      conditions.push(`is_featured = true`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRes = await query(
      `SELECT COUNT(*) AS total FROM team ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.total || 0);

    params.push(safeLimit, offset);
    const { rows } = await query(
      `SELECT
         id, name, role, department, bio,
         avatar_url, email, phone,
         linkedin_url, twitter_url, instagram_url, facebook_url,
         display_order, is_active, is_featured,
         created_at, updated_at
       FROM team
       ${whereClause}
       ORDER BY ${safeSort} ${safeOrder}, name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        page:       safePage,
        limit:      safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    });
  } catch (err) {
    return handleError(res, err, "Failed to fetch team members");
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/team/:id
// ═══════════════════════════════════════════════════════════════
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id))
      return res.status(400).json({ success: false, message: "Invalid ID" });

    const { rows } = await query(`SELECT * FROM team WHERE id = $1`, [id]);

    if (rows.length === 0)
      return res.status(404).json({ success: false, message: "Team member not found" });

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    return handleError(res, err, "Failed to fetch team member");
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/team
// ═══════════════════════════════════════════════════════════════
router.post("/", async (req, res) => {
  try {
    const {
      name, role, department, bio,
      avatar_url, email, phone,
      linkedin_url, twitter_url, instagram_url, facebook_url,
      display_order, is_active, is_featured,
    } = req.body;

    if (!name || !name.trim())
      return res.status(400).json({ success: false, message: "Name is required" });

    const { rows } = await query(
      `INSERT INTO team (
         name, role, department, bio, avatar_url, email, phone,
         linkedin_url, twitter_url, instagram_url, facebook_url,
         display_order, is_active, is_featured
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        name.trim(),
        role          || null,
        department    || "General",
        bio           || null,
        avatar_url    || null,
        email         || null,
        phone         || null,
        linkedin_url  || null,
        twitter_url   || null,
        instagram_url || null,
        facebook_url  || null,
        display_order ?? 0,
        is_active     ?? true,
        is_featured   ?? false,
      ]
    );

    return res.status(201).json({ success: true, message: "Team member created", data: rows[0] });
  } catch (err) {
    return handleError(res, err, "Failed to create team member");
  }
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/team/:id
// ═══════════════════════════════════════════════════════════════
router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id))
      return res.status(400).json({ success: false, message: "Invalid ID" });

    const {
      name, role, department, bio,
      avatar_url, email, phone,
      linkedin_url, twitter_url, instagram_url, facebook_url,
      display_order, is_active, is_featured,
    } = req.body;

    const { rows } = await query(
      `UPDATE team SET
         name          = COALESCE(NULLIF($1,''),  name),
         role          = COALESCE($2,  role),
         department    = COALESCE($3,  department),
         bio           = COALESCE($4,  bio),
         avatar_url    = COALESCE($5,  avatar_url),
         email         = COALESCE($6,  email),
         phone         = COALESCE($7,  phone),
         linkedin_url  = COALESCE($8,  linkedin_url),
         twitter_url   = COALESCE($9,  twitter_url),
         instagram_url = COALESCE($10, instagram_url),
         facebook_url  = COALESCE($11, facebook_url),
         display_order = COALESCE($12, display_order),
         is_active     = COALESCE($13, is_active),
         is_featured   = COALESCE($14, is_featured),
         updated_at    = NOW()
       WHERE id = $15
       RETURNING *`,
      [
        name          || null,
        role          || null,
        department    || null,
        bio           || null,
        avatar_url    || null,
        email         || null,
        phone         || null,
        linkedin_url  || null,
        twitter_url   || null,
        instagram_url || null,
        facebook_url  || null,
        display_order ?? null,
        is_active     ?? null,
        is_featured   ?? null,
        id,
      ]
    );

    if (rows.length === 0)
      return res.status(404).json({ success: false, message: "Team member not found" });

    return res.status(200).json({ success: true, message: "Team member updated", data: rows[0] });
  } catch (err) {
    return handleError(res, err, "Failed to update team member");
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/team/:id
// ═══════════════════════════════════════════════════════════════
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id))
      return res.status(400).json({ success: false, message: "Invalid ID" });

    const { rows } = await query(
      `DELETE FROM team WHERE id = $1 RETURNING id, name`,
      [id]
    );

    if (rows.length === 0)
      return res.status(404).json({ success: false, message: "Team member not found" });

    return res.status(200).json({
      success: true,
      message: `Team member "${rows[0].name}" deleted`,
    });
  } catch (err) {
    return handleError(res, err, "Failed to delete team member");
  }
});

module.exports = router;
