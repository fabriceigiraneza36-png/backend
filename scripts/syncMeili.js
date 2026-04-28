// scripts/syncMeili.js
// Sync tours from PostgreSQL to Meilisearch

require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') });
const { query } = require('../config/db');
const { syncAllToursToIndex } = require('../services/searchSync.service');

async function main() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Altuvera - Meilisearch Sync Tool');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    // Test database connection
    console.log('Testing database connection...');
    await query('SELECT NOW()');
    console.log('✅ Database connected');
    console.log('');

    // Sync tours to Meilisearch
    console.log('Starting sync to Meilisearch...');
    const result = await syncAllToursToIndex();
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  ✅ Sync completed: ${result.synced} tours indexed`);
    console.log('═══════════════════════════════════════════════════════════');

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('❌ Sync failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
