/**
 * config/db.js
 * ═══════════════════════════════════════════════════════════════════════════
 * Always-Ready, High-Performance PostgreSQL Connection Manager
 * ═══════════════════════════════════════════════════════════════════════════
 * - Pool pre-warmed with minimum connections
 * - Auto-reconnect on connection drop
 * - Health-check heartbeat keeps connections alive
 * - Sequelize compatibility maintained
 */

require("dotenv").config({
  path: require("path").resolve(process.cwd(), ".env"),
});
const { Pool } = require("pg");
const { Sequelize } = require("sequelize");
const logger = require("../utils/logger");

// ── Connection Configuration ─────────────────────────────────────────────────

// If a single DATABASE_URL is provided (e.g., Neon/Heroku), prefer it.
const connectionString = process.env.DATABASE_URL || null;

const dbConfig = connectionString
  ? { connectionString }
  : {
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      database: process.env.DB_NAME || "altuvera",
      user: process.env.DB_USER || "fabrice",
      password: process.env.DB_PASSWORD || "2004",
    };

// ── Pool Configuration (Always-Ready) ────────────────────────────────────────

const poolOptions = connectionString
  ? {
      connectionString,
      // If running against cloud providers, enable SSL by default
      ssl:
        process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
      max: parseInt(process.env.DB_POOL_MAX, 10) || 30,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_MS, 10) || 300000,
      connectionTimeoutMillis:
        parseInt(process.env.DB_CONN_TIMEOUT_MS, 10) || 10000,
      allowExitOnIdle: false,
    }
  : {
      ...dbConfig,
      max: parseInt(process.env.DB_POOL_MAX, 10) || 30,
      min: parseInt(process.env.DB_POOL_MIN, 10) || 5,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_MS, 10) || 300000,
      connectionTimeoutMillis:
        parseInt(process.env.DB_CONN_TIMEOUT_MS, 10) || 10000,
      allowExitOnIdle: false,
      statement_timeout:
        parseInt(process.env.DB_STATEMENT_TIMEOUT_MS, 10) || 30000,
    };

const pool = new Pool(poolOptions);

// ── Pool Event Handlers ──────────────────────────────────────────────────────

pool.on("connect", (client) => {
  logger.info("[DB] New client connected to PostgreSQL");
});

pool.on("error", (err, client) => {
  logger.error("[DB] Unexpected pool error:", { error: err.message });
  // Don't crash — the pool auto-recovers
});

pool.on("remove", () => {
  logger.debug("[DB] Client removed from pool");
});

// ── Heartbeat: Keep Connections Warm ─────────────────────────────────────────

let heartbeatInterval = null;

const startHeartbeat = () => {
  if (heartbeatInterval) return;

  heartbeatInterval = setInterval(async () => {
    try {
      await pool.query("SELECT 1");
    } catch (err) {
      logger.warn(
        "[DB] Heartbeat failed, pool will auto-reconnect:",
        err.message,
      );
    }
  }, 60000); // every 60 seconds

  // Don't prevent Node from exiting
  if (heartbeatInterval.unref) heartbeatInterval.unref();
};

// ── Query Wrapper with Auto-Retry ────────────────────────────────────────────

const query = async (text, params = []) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    // Log slow queries (>200ms) for debugging
    if (duration > 200) {
      logger.warn(
        `[DB] Slow query (${duration}ms): ${text.substring(0, 80)}...`,
      );
    }

    return result;
  } catch (err) {
    // Permission denied (insufficient_privilege)
    if (
      err.code === "42501" ||
      (typeof err.message === "string" &&
        err.message.toLowerCase().includes("permission denied"))
    ) {
      const tableMatch =
        typeof err.message === "string"
          ? err.message.match(
              /permission denied for (?:relation|table)\s+\"?([a-zA-Z0-9_]+)\"?/i,
            )
          : null;
      const table = tableMatch?.[1] || null;
      const user = dbConfig.user || process.env.DB_USER || "unknown";
      const database = dbConfig.database || process.env.DB_NAME || "unknown";

      const permissionError = new Error(
        `Database permission denied${table ? ` for table "${table}"` : ""}. ` +
          `Connected as "${user}" to database "${database}". ` +
          `Fix by granting privileges to this role (or run migrations as the table owner).`,
      );
      permissionError.statusCode = 403;
      permissionError.errorCode = "DB_PERMISSION_DENIED";
      permissionError.originalError = err.message;
      throw permissionError;
    }

    // Retry once on connection reset errors
    if (
      err.code === "ECONNRESET" ||
      err.code === "57P01" || // admin_shutdown
      err.code === "57P03" || // cannot_connect_now
      err.message?.includes("Connection terminated")
    ) {
      logger.warn("[DB] Connection dropped, retrying query...");
      const result = await pool.query(text, params);
      return result;
    }
    throw err;
  }
};

// ── Sequelize Instance (for models that still need it) ───────────────────────

const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.user,
  dbConfig.password,
  {
    host: dbConfig.host,
    port: dbConfig.port,
    dialect: "postgres",
    logging: false,
    pool: {
      max: 20,
      min: 3,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
    },
    retry: {
      max: 3, // auto-retry failed queries 3 times
    },
  },
);

// ── Connection Test & Warm-Up ────────────────────────────────────────────────

const testConnection = async () => {
  await pool.query("SELECT 1");
  await sequelize.authenticate();
  startHeartbeat();
  logger.info(
    "[DB] ✅ Connected to PostgreSQL — pool warmed and heartbeat started",
  );
  return true;
};


const ensurePostsSchema = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id            SERIAL PRIMARY KEY,
        title         VARCHAR(500) NOT NULL,
        slug          VARCHAR(500) UNIQUE,
        excerpt       TEXT,
        content       TEXT,
        featured_image VARCHAR(1000),
        category      VARCHAR(100),
        tags          TEXT[]    DEFAULT '{}'::TEXT[],
        status        VARCHAR(50)  DEFAULT 'draft',
        is_featured   BOOLEAN      DEFAULT false,
        is_active     BOOLEAN      DEFAULT true,
        author_id     INTEGER,
        author_name   VARCHAR(255),
        view_count    INTEGER      DEFAULT 0,
        like_count    INTEGER      DEFAULT 0,
        comment_count INTEGER      DEFAULT 0,
        read_time     INTEGER,
        meta_title    VARCHAR(500),
        meta_desc     TEXT,
        published_at  TIMESTAMP,
        created_at    TIMESTAMP    DEFAULT NOW(),
        updated_at    TIMESTAMP    DEFAULT NOW()
      )
    `);

    // Add any missing columns to existing table
    const postColumns = [
      { name: 'slug',          type: 'VARCHAR(500)' },
      { name: 'excerpt',       type: 'TEXT' },
      { name: 'is_featured',   type: 'BOOLEAN DEFAULT false' },
      { name: 'is_active',     type: 'BOOLEAN DEFAULT true' },
      { name: 'author_name',   type: 'VARCHAR(255)' },
      { name: 'view_count',    type: 'INTEGER DEFAULT 0' },
      { name: 'like_count',    type: 'INTEGER DEFAULT 0' },
      { name: 'comment_count', type: 'INTEGER DEFAULT 0' },
      { name: 'read_time',     type: 'INTEGER' },
      { name: 'meta_title',    type: 'VARCHAR(500)' },
      { name: 'meta_desc',     type: 'TEXT' },
      { name: 'published_at',  type: 'TIMESTAMP' },
      { name: 'updated_at',    type: 'TIMESTAMP DEFAULT NOW()' },
    ];

    for (const col of postColumns) {
      await pool
        .query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`)
        .catch(() => {});
    }

    // Indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_status     ON posts(status)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_slug       ON posts(slug)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_is_active  ON posts(is_active)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_category   ON posts(category)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_author_id  ON posts(author_id)`).catch(() => {});

    logger.info('[DB] ✅ Posts schema verified & ensured');
  } catch (err) {
    logger.warn('[DB] Posts schema ensure failed:', err.message);
  }
};

const ensureBookingsSchema = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id                SERIAL PRIMARY KEY,
        booking_ref       VARCHAR(50) UNIQUE,
        user_id           INTEGER,
        destination_id    INTEGER,
        country_id        INTEGER,
        service_id        INTEGER,
        full_name         VARCHAR(255) NOT NULL,
        email             VARCHAR(255) NOT NULL,
        phone             VARCHAR(50),
        whatsapp          VARCHAR(50),
        nationality       VARCHAR(100),
        travelers         INTEGER      DEFAULT 1,
        adults            INTEGER      DEFAULT 1,
        children          INTEGER      DEFAULT 0,
        infants           INTEGER      DEFAULT 0,
        travel_date       DATE,
        end_date          DATE,
        duration_days     INTEGER,
        trip_type         VARCHAR(100),
        accommodation     VARCHAR(100),
        budget            DECIMAL(12,2),
        currency          VARCHAR(10)  DEFAULT 'USD',
        total_price       DECIMAL(12,2),
        deposit_paid      DECIMAL(12,2) DEFAULT 0,
        payment_status    VARCHAR(50)  DEFAULT 'pending',
        payment_method    VARCHAR(100),
        status            VARCHAR(50)  DEFAULT 'pending',
        priority          VARCHAR(20)  DEFAULT 'normal',
        special_requests  TEXT,
        dietary_needs     TEXT,
        medical_notes     TEXT,
        pickup_location   VARCHAR(500),
        notes             TEXT,
        admin_notes       TEXT,
        source            VARCHAR(100) DEFAULT 'website',
        ip_address        VARCHAR(50),
        user_agent        TEXT,
        assigned_to       INTEGER,
        confirmed_at      TIMESTAMP,
        cancelled_at      TIMESTAMP,
        completed_at      TIMESTAMP,
        created_at        TIMESTAMP    DEFAULT NOW(),
        updated_at        TIMESTAMP    DEFAULT NOW()
      )
    `);

    // Add missing columns to existing table
    const bookingColumns = [
      { name: 'booking_ref',    type: "VARCHAR(50) DEFAULT CONCAT('BK-', TO_CHAR(NOW(), 'YYYYMMDD'), '-', LPAD(NEXTVAL(\'booking_ref_seq\')::TEXT, 4, \'0\'))" },
      { name: 'country_id',     type: 'INTEGER' },
      { name: 'service_id',     type: 'INTEGER' },
      { name: 'whatsapp',       type: 'VARCHAR(50)' },
      { name: 'nationality',    type: 'VARCHAR(100)' },
      { name: 'adults',         type: 'INTEGER DEFAULT 1' },
      { name: 'children',       type: 'INTEGER DEFAULT 0' },
      { name: 'infants',        type: 'INTEGER DEFAULT 0' },
      { name: 'end_date',       type: 'DATE' },
      { name: 'duration_days',  type: 'INTEGER' },
      { name: 'accommodation',  type: 'VARCHAR(100)' },
      { name: 'currency',       type: "VARCHAR(10) DEFAULT 'USD'" },
      { name: 'total_price',    type: 'DECIMAL(12,2)' },
      { name: 'deposit_paid',   type: 'DECIMAL(12,2) DEFAULT 0' },
      { name: 'payment_status', type: "VARCHAR(50) DEFAULT 'pending'" },
      { name: 'payment_method', type: 'VARCHAR(100)' },
      { name: 'priority',       type: "VARCHAR(20) DEFAULT 'normal'" },
      { name: 'dietary_needs',  type: 'TEXT' },
      { name: 'medical_notes',  type: 'TEXT' },
      { name: 'pickup_location',type: 'VARCHAR(500)' },
      { name: 'admin_notes',    type: 'TEXT' },
      { name: 'source',         type: "VARCHAR(100) DEFAULT 'website'" },
      { name: 'ip_address',     type: 'VARCHAR(50)' },
      { name: 'user_agent',     type: 'TEXT' },
      { name: 'assigned_to',    type: 'INTEGER' },
      { name: 'confirmed_at',   type: 'TIMESTAMP' },
      { name: 'cancelled_at',   type: 'TIMESTAMP' },
      { name: 'completed_at',   type: 'TIMESTAMP' },
      { name: 'updated_at',     type: 'TIMESTAMP DEFAULT NOW()' },
    ];

    for (const col of bookingColumns) {
      await pool
        .query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`)
        .catch(() => {});
    }

    // Auto-generate booking_ref if empty
    await pool.query(`
      UPDATE bookings 
      SET booking_ref = CONCAT('BK-', TO_CHAR(created_at, 'YYYYMMDD'), '-', LPAD(id::TEXT, 4, '0'))
      WHERE booking_ref IS NULL
    `).catch(() => {});

    // Indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_status      ON bookings(status)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_email       ON bookings(email)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_user_id     ON bookings(user_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_created_at  ON bookings(created_at DESC)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_travel_date ON bookings(travel_date)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_booking_ref ON bookings(booking_ref)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_payment     ON bookings(payment_status)`).catch(() => {});

    logger.info('[DB] ✅ Bookings schema verified & ensured');
  } catch (err) {
    logger.warn('[DB] Bookings schema ensure failed:', err.message);
  }
};


// ── Ensure Users Table Schema is Complete ────────────────────────────────────

const ensureUserSchema = async () => {
  try {
    // Ensure the users table has all needed columns for auth
    const columnsToEnsure = [
      { name: "google_id", type: "VARCHAR(255)" },
      { name: "github_id", type: "VARCHAR(255)" },
      { name: "auth_provider", type: "VARCHAR(50) DEFAULT 'email'" },
      { name: "is_active", type: "BOOLEAN DEFAULT true" },
      { name: "is_verified", type: "BOOLEAN DEFAULT false" },
      { name: "full_name", type: "VARCHAR(255)" },
      { name: "phone", type: "VARCHAR(50)" },
      { name: "bio", type: "TEXT" },
      { name: "avatar_url", type: "TEXT" },
      { name: "role", type: "VARCHAR(50) DEFAULT 'user'" },
      { name: "last_login", type: "TIMESTAMPTZ" },
      { name: "login_counter", type: "INTEGER DEFAULT 0" },
      { name: "verification_code", type: "VARCHAR(10)" },
      { name: "code_expiry", type: "TIMESTAMPTZ" },
      { name: "code_attempts", type: "INTEGER DEFAULT 0" },
      { name: "last_code_sent_at", type: "TIMESTAMPTZ" },
      { name: "verification_token", type: "VARCHAR(255)" },
      { name: "reset_token", type: "VARCHAR(255)" },
      { name: "reset_token_expires", type: "TIMESTAMPTZ" },
      { name: "preferences", type: "JSONB" },
      { name: "password_hash", type: "VARCHAR(255)" },
    ];

    for (const col of columnsToEnsure) {
      try {
        await pool.query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`,
        );
      } catch (e) {
        // Column may already exist — ignore
      }
    }

    // Ensure indexes for fast auth lookups
    await pool
      .query("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
      .catch(() => {});
    await pool
      .query(
        "CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)",
      )
      .catch(() => {});
    await pool
      .query(
        "CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id)",
      )
      .catch(() => {});
    await pool
      .query(
        "CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)",
      )
      .catch(() => {});
    await pool
      .query(
        "CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token)",
      )
      .catch(() => {});
    await pool
      .query(
        "CREATE INDEX IF NOT EXISTS idx_users_login_counter ON users(login_counter)",
      )
      .catch(() => {});

    logger.info("[DB] ✅ Users table schema verified & indexes ensured");
  } catch (err) {
    logger.warn(
      "[DB] Schema check skipped (table may not exist yet):",
      err.message,
    );
  }
};


const ensureGallerySchema = async () => {
  try {
    // Add missing columns
    await pool.query(`ALTER TABLE gallery ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`).catch(() => {});
    await pool.query(`ALTER TABLE gallery ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::TEXT[]`).catch(() => {});

    // Backfill updated_at where null
    await pool.query(`UPDATE gallery SET updated_at = created_at WHERE updated_at IS NULL`).catch(() => {});

    // Performance indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gallery_is_active   ON gallery(is_active)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gallery_is_featured ON gallery(is_featured)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gallery_category    ON gallery(category)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gallery_country_id  ON gallery(country_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gallery_created_at  ON gallery(created_at DESC)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gallery_sort_order  ON gallery(sort_order)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gallery_active_featured ON gallery(is_active, is_featured, sort_order)`).catch(() => {});

    // gallery_increment_views function
    await pool.query(`
      CREATE OR REPLACE FUNCTION gallery_increment_views(gallery_id INTEGER)
      RETURNS void AS $$
        UPDATE gallery SET view_count = COALESCE(view_count, 0) + 1 WHERE id = gallery_id;
      $$ LANGUAGE sql;
    `).catch(() => {});

    logger.info("[DB] ✅ Gallery schema verified & indexes ensured");
  } catch (err) {
    logger.warn("[DB] Gallery schema ensure failed:", err.message);
  }
};

// ── Ensure Destinations Table Schema is Complete ─────────────────────────────

const ensureDestinationsSchema = async () => {
  try {
    await pool.query(
      "ALTER TABLE destinations ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true",
    );
    logger.info("[DB] ✅ Destinations table schema verified & updated");
  } catch (err) {
    logger.warn(
      "[DB] Destinations schema check skipped (table may not exist yet):",
      err.message,
    );
  }
};

const ensureContactSchema = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        whatsapp VARCHAR(50),
        subject VARCHAR(255),
        message TEXT NOT NULL,
        trip_type VARCHAR(100),
        travel_date DATE,
        number_of_travelers INTEGER,
        source VARCHAR(100) DEFAULT 'website',
        ip_address VARCHAR(50),
        user_agent TEXT,
        referrer_url TEXT,
        status VARCHAR(20) DEFAULT 'new',
        is_read BOOLEAN DEFAULT false,
        is_starred BOOLEAN DEFAULT false,
        priority VARCHAR(20) DEFAULT 'normal',
        assigned_to INTEGER,
        assigned_at TIMESTAMP,
        responded_at TIMESTAMP,
        response_notes TEXT,
        tags TEXT[] DEFAULT '{}'::TEXT[],
        read_at TIMESTAMP,
        archived_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_replies (
        id SERIAL PRIMARY KEY,
        message_id INTEGER NOT NULL,
        subject VARCHAR(255),
        body TEXT NOT NULL,
        sent_by INTEGER,
        sent_by_name VARCHAR(255),
        sent_by_email VARCHAR(255),
        status VARCHAR(50) DEFAULT 'sent',
        sent_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE OR REPLACE VIEW v_contact_stats AS
      SELECT
        COUNT(*) AS total_messages,
        COUNT(*) FILTER (WHERE status = 'new') AS new_messages,
        COUNT(*) FILTER (WHERE is_read = false) AS unread_messages,
        COUNT(*) FILTER (WHERE status = 'replied') AS replied_messages,
        COUNT(*) FILTER (WHERE status = 'archived') AS archived_messages,
        COUNT(*) FILTER (WHERE status = 'spam') AS spam_messages,
        COUNT(*) FILTER (WHERE priority = 'urgent') AS urgent_messages,
        COUNT(*) FILTER (WHERE priority = 'high') AS high_priority_messages,
        COUNT(*) FILTER (WHERE is_starred = true) AS starred_messages,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today_messages,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') AS week_messages,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') AS month_messages
      FROM contact_messages;
    `);

    logger.info("[DB] ✅ Contact messaging schema verified & ensured");
  } catch (err) {
    logger.warn("[DB] Contact schema ensure failed:", err.message);
  }
};

const ensureChatSchema = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        user_id INTEGER,
        email VARCHAR(255),
        full_name VARCHAR(255),
        source VARCHAR(50) DEFAULT 'frontend',
        status VARCHAR(20) DEFAULT 'active',
        last_active TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        sender_type VARCHAR(50) NOT NULL,
        sender_id INTEGER,
        sender_name VARCHAR(255),
        sender_email VARCHAR(255),
        body TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::JSONB,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_session_id ON chat_sessions(session_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);
    `);

    logger.info("[DB] ✅ Chat schema verified & ensured");
  } catch (err) {
    logger.warn("[DB] Chat schema ensure failed:", err.message);
  }
};

// ── Graceful Close ───────────────────────────────────────────────────────────

const closeConnections = async () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  await Promise.allSettled([pool.end(), sequelize.close()]);
  logger.info("[DB] All connections closed");
};

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  query,
  pool,
  sequelize,
  Sequelize,
  testConnection,
  closeConnections,
  ensureUserSchema,
  ensureDestinationsSchema,
  ensureContactSchema,
  ensureChatSchema,
  ensureGallerySchema,
  ensurePostsSchema,      // ← ADD
  ensureBookingsSchema,   // ← ADD
};