const { Sequelize } = require("sequelize");
const logger = require("../utils/logger");

// ═══════════════════════════════════════════════════
// DATABASE CONFIGURATION (Neon-ready for Render)
// ═══════════════════════════════════════════════════

const getSslModeFromUrl = (databaseUrl) => {
  try {
    const url = new URL(databaseUrl);
    const sslmode = (url.searchParams.get("sslmode") || "").toLowerCase();
    return sslmode || null;
  } catch {
    return null;
  }
};

const toBool = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return null;
};

const buildDatabaseUrlFromParts = () => {
  const host = process.env.DB_HOST || "localhost";
  const port = process.env.DB_PORT || "5432";
  const name = process.env.DB_NAME || "altuvera";
  const user = process.env.DB_USER || "";
  const password = process.env.DB_PASSWORD || "";

  // Encode to safely support special chars.
  const auth =
    user || password
      ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
      : "";
  return `postgres://${auth}${host}:${port}/${name}`;
};

const isValidDbUrl = (value) => {
  if (value === undefined || value === null) return false;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower === "null" || lower === "undefined") return false;
  return true;
};

const isLocalDbUrl = (value) =>
  typeof value === "string" &&
  (value.includes("localhost") || value.includes("127.0.0.1"));

// Prefer DB_* in local dev when provided, so a bad DATABASE_URL password
// doesn’t brick the app.
const databaseUrl = (() => {
  const explicitUrl = isValidDbUrl(process.env.DATABASE_URL)
    ? process.env.DATABASE_URL.trim()
    : null;

  const useDbParts =
    (process.env.DB_PASSWORD || process.env.DB_USER || process.env.DB_HOST) &&
    isLocalDbUrl(explicitUrl);

  if (useDbParts) return buildDatabaseUrlFromParts();
  if (explicitUrl) return explicitUrl;
  return buildDatabaseUrlFromParts();
})();

const sslmode = getSslModeFromUrl(databaseUrl);

// Default: production uses SSL, dev uses non-SSL (unless overridden).
const envWantsSsl = toBool(process.env.DB_SSL);
const useSsl =
  envWantsSsl !== null
    ? envWantsSsl
    : sslmode
      ? sslmode !== "disable"
      : process.env.NODE_ENV === "production";

const sequelize = new Sequelize(databaseUrl, {
  dialect: "postgres",
  protocol: "postgres",
  logging:
    process.env.NODE_ENV === "development" ? (msg) => logger.debug(msg) : false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  dialectOptions: {
    ...(useSsl
      ? {
          ssl: {
            require: true,
            rejectUnauthorized: false, // required for some hosted Postgres providers
          },
        }
      : { ssl: false }),
    statement_timeout: 30000,
    idle_in_transaction_session_timeout: 30000,
  },
  define: {
    timestamps: true,
    underscored: true,
    freezeTableName: true,
  },
});

// ═══════════════════════════════════════════════════
// TEST CONNECTION FUNCTION
// ═══════════════════════════════════════════════════

const testConnection = async () => {
  try {
    await sequelize.authenticate();
    logger.info("✅ PostgreSQL connection established successfully");
    return true;
  } catch (error) {
    logger.error("❌ Unable to connect to database:", error.message);
    throw error;
  }
};

// ═══════════════════════════════════════════════════
// QUERY WRAPPER
// ═══════════════════════════════════════════════════

const query = async (sql, options = {}) => {
  try {
    return await sequelize.query(sql, {
      type: Sequelize.QueryTypes.SELECT,
      ...options,
    });
  } catch (error) {
    logger.error("Database query error:", error);
    throw error;
  }
};

// ═══════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════

module.exports = {
  sequelize,
  query,
  testConnection,
  Sequelize,
};
