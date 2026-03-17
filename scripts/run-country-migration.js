/**
 * Run Professional Country Schema Migration
 * ==========================================
 * Uses Neon cloud database connection
 * 
 * Usage: node scripts/run-country-migration.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Connect to Neon cloud database using DATABASE_URL from .env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const MIGRATION_FILE = path.join(__dirname, '../db/migrations/professional-countries-schema.sql');

async function runMigration() {
  console.log('\n🗺️  PROFESSIONAL COUNTRY SCHEMA MIGRATION');
  console.log('==========================================');
  console.log('   Database: Neon Cloud');

  try {
    // Test connection first
    console.log('\n🔌 Testing database connection...');
    await pool.query('SELECT 1');
    console.log('✅ Connected to database!');

    // Read the migration SQL file
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
    console.log('\n📄 Loaded migration file:', MIGRATION_FILE);

    // Execute the migration
    console.log('\n⏳ Executing migration...');
    await pool.query(sql);
    console.log('✅ Migration executed successfully!');

    // Verify tables were created
    console.log('\n🔍 Verifying tables...');
    
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name IN ('countries', 'country_images', 'country_faqs', 'country_highlights')
      ORDER BY table_name
    `);

    console.log('\n📋 Created tables:');
    if (tablesResult.rows.length === 0) {
      console.log('   ⚠️ No country tables found!');
    } else {
      tablesResult.rows.forEach(row => {
        console.log(`   ✓ ${row.table_name}`);
      });
    }

    // Check row counts
    const countryCount = await pool.query('SELECT COUNT(*) FROM countries');
    const imageCount = await pool.query('SELECT COUNT(*) FROM country_images');
    const faqCount = await pool.query('SELECT COUNT(*) FROM country_faqs');
    const highlightCount = await pool.query('SELECT COUNT(*) FROM country_highlights');

    console.log('\n📊 Table counts:');
    console.log(`   • countries: ${countryCount.rows[0].count}`);
    console.log(`   • country_images: ${imageCount.rows[0].count}`);
    console.log(`   • country_faqs: ${faqCount.rows[0].count}`);
    console.log(`   • country_highlights: ${highlightCount.rows[0].count}`);

    // Show sample country data
    if (parseInt(countryCount.rows[0].count) > 0) {
      console.log('\n🌍 Sample countries:');
      const countries = await pool.query('SELECT name, slug, region, popularity_score FROM countries ORDER BY popularity_score DESC LIMIT 5');
      countries.rows.forEach(c => {
        console.log(`   • ${c.name} (${c.slug}) - ${c.region} - Score: ${c.popularity_score}`);
      });
    }

    // Show JSONB columns
    console.log('\n📝 Countries table structure:');
    const columns = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'countries'
      ORDER BY ordinal_position
      LIMIT 15
    `);
    columns.rows.forEach(c => {
      console.log(`   • ${c.column_name}: ${c.data_type}`);
    });

    console.log('\n🎉 MIGRATION COMPLETED SUCCESSFULLY!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the migration
runMigration();
