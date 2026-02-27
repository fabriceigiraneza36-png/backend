const { Sequelize } = require("sequelize");
const logger = require("../utils/logger");

// ═══════════════════════════════════════════════════
// DATABASE CONFIGURATION
// ═══════════════════════════════════════════════════

const sequelize = new Sequelize(
  process.env.DB_NAME || "altuvera",
  process.env.DB_USER || "fabrice",
  process.env.DB_PASSWORD || "2004",
  {
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5432,
    dialect: "postgres",
    logging: process.env.NODE_ENV === "development" ? (msg) => logger.debug(msg) : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    dialectOptions: {
      statement_timeout: 30000,
      idle_in_transaction_session_timeout: 30000,
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
    },
  }
);

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