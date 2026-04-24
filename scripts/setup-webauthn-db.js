#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WEBAUTHN DATABASE SETUP SCRIPT
 * ═══════════════════════════════════════════════════════════════════════════════
 * Initializes WebAuthn tables and migrations in PostgreSQL
 * 
 * Usage:
 *   node scripts/setup-webauthn-db.js
 * 
 * Environment Variables Required:
 *   - DATABASE_URL or (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
 */

require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') });
const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');
const logger = require('../utils/logger');

const SCHEMA_FILE = path.join(__dirname, '../db/migrations/webauthn-schema.sql');

/**
 * Read and execute SQL schema
 */
async function setupWebAuthnSchema() {
  try {
    logger.info('═══════════════════════════════════════════════════════════════════');
    logger.info('🔐 WEBAUTHN DATABASE SETUP');
    logger.info('═══════════════════════════════════════════════════════════════════');

    if (!fs.existsSync(SCHEMA_FILE)) {
      throw new Error(`Schema file not found: ${SCHEMA_FILE}`);
    }

    const schema = fs.readFileSync(SCHEMA_FILE, 'utf-8');

    logger.info('📝 Executing schema...');

    // Split by semicolon and execute each statement
    const statements = schema
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt && !stmt.startsWith('--'));

    for (const statement of statements) {
      try {
        await query(statement);
        logger.info(`✅ Executed: ${statement.substring(0, 60)}...`);
      } catch (error) {
        // Skip errors about existing objects
        if (error.message.includes('already exists') || error.message.includes('ALREADY EXISTS')) {
          logger.warn(`⚠️ ${error.message.substring(0, 80)}`);
        } else {
          throw error;
        }
      }
    }

    logger.info('═══════════════════════════════════════════════════════════════════');
    logger.info('✅ WebAuthn database setup completed successfully!');
    logger.info('═══════════════════════════════════════════════════════════════════');

    console.log('\n✨ Your WebAuthn backend is ready!\n');
    console.log('Next steps:');
    console.log('1. Configure environment variables in .env');
    console.log('2. Set WEBAUTHN_RP_ID to your domain');
    console.log('3. Set WEBAUTHN_ORIGIN to your frontend URL');
    console.log('4. Set JWT_SECRET to a secure random value');
    console.log('5. Start the server: npm start\n');

    process.exit(0);
  } catch (error) {
    logger.error('❌ Setup failed:', error);
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

/**
 * Check database connection and schema
 */
async function verifySetup() {
  try {
    logger.info('🔍 Verifying setup...');

    const tables = ['webauthn_users', 'webauthn_credentials', 'webauthn_challenges', 'webauthn_sessions'];

    for (const table of tables) {
      const result = await query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = $1
        ) as exists`,
        [table]
      );

      if (result.rows[0].exists) {
        logger.info(`✅ Table exists: ${table}`);
      } else {
        logger.warn(`⚠️ Table missing: ${table}`);
      }
    }

    logger.info('🔍 Verification complete!');
  } catch (error) {
    logger.error('Verification failed:', error);
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    // Test database connection
    logger.info('Testing database connection...');
    await query('SELECT NOW()');
    logger.info('✅ Database connection successful');

    // Setup schema
    await setupWebAuthnSchema();

    // Verify
    await verifySetup();
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { setupWebAuthnSchema, verifySetup };
