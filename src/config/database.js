'use strict';

const knex = require('knex');
const knexConfig = require('../../knexfile');

const environment = process.env.NODE_ENV || 'development';
const config = knexConfig[environment];

const db = knex(config);

// Connection pool monitoring
db.on('query', (queryData) => {
  if (process.env.NODE_ENV === 'development' && process.env.LOG_QUERIES === 'true') {
    console.log(`📝 SQL: ${queryData.sql}`);
  }
});

db.on('query-error', (error, obj) => {
  console.error('❌ Query Error:', error.message);
  console.error('Query:', obj.sql);
});

module.exports = { db };