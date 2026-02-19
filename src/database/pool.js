// src/database/pool.js
const { Pool } = require('pg');
const env = require('../config/env');
const logger = require('../utils/logger');

const poolConfig = {
  host: env.database.host,
  port: env.database.port,
  database: env.database.name,
  user: env.database.user,
  password: env.database.password,
  min: env.database.poolMin,
  max: env.database.poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: env.database.ssl ? { rejectUnauthorized: false } : false,
};

// Use DATABASE_URL if available (for production/Heroku)
if (env.database.url) {
  poolConfig.connectionString = env.database.url;
}

const pool = new Pool(poolConfig);

// Connection event handlers
pool.on('connect', () => {
  logger.debug('New database connection established');
});

pool.on('error', (err) => {
  logger.error('Unexpected database error:', err);
  process.exit(-1);
});

pool.on('remove', () => {
  logger.debug('Database connection removed from pool');
});

// Helper function for transactions
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Query helper with logging
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query executed', { 
      text: text.substring(0, 100), 
      duration, 
      rows: result.rowCount 
    });
    return result;
  } catch (error) {
    logger.error('Query error:', { text: text.substring(0, 100), error: error.message });
    throw error;
  }
};

// Get single row
const queryOne = async (text, params) => {
  const result = await query(text, params);
  return result.rows[0] || null;
};

// Get all rows
const queryAll = async (text, params) => {
  const result = await query(text, params);
  return result.rows;
};

// Check database health
const healthCheck = async () => {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
};

module.exports = {
  pool,
  query,
  queryOne,
  queryAll,
  withTransaction,
  healthCheck,
};