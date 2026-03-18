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

require("dotenv").config();
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
      ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
      max: parseInt(process.env.DB_POOL_MAX, 10) || 30,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_MS, 10) || 300000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT_MS, 10) || 10000,
      allowExitOnIdle: false,
    }
  : {
      ...dbConfig,
      max: parseInt(process.env.DB_POOL_MAX, 10) || 30,
      min: parseInt(process.env.DB_POOL_MIN, 10) || 5,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_MS, 10) || 300000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT_MS, 10) || 10000,
      allowExitOnIdle: false,
      statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS, 10) || 30000,
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
          ? err.message.match(/permission denied for (?:relation|table)\s+\"?([a-zA-Z0-9_]+)\"?/i)
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

    logger.info("[DB] ✅ Users table schema verified & indexes ensured");
  } catch (err) {
    logger.warn(
      "[DB] Schema check skipped (table may not exist yet):",
      err.message,
    );
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
};
