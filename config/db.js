require("dotenv").config();
const { Pool } = require("pg");
const { Sequelize } = require("sequelize");
const logger = require("../utils/logger");

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || "altuvera",
  user: process.env.DB_USER || "fabrice",
  password: process.env.DB_PASSWORD || "2004",
};

const pool = new Pool(dbConfig);

pool.on("error", (error) => {
  logger.error("Unexpected PostgreSQL pool error", { error: error.message });
});

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
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
    },
  }
);

const query = async (text, params = []) => pool.query(text, params);

const testConnection = async () => {
  await pool.query("SELECT 1");
  await sequelize.authenticate();
  logger.info("Connected to PostgreSQL (pg + sequelize)");
  return true;
};

const closeConnections = async () => {
  await Promise.allSettled([pool.end(), sequelize.close()]);
};

module.exports = {
  query,
  pool,
  sequelize,
  Sequelize,
  testConnection,
  closeConnections,
};
