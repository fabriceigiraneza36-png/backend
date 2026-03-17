/**
 * Verify Country Schema
 * Simple verification script
 */

require('dotenv').config();
const { pool } = require('../config/db');

async function verify() {
  try {
    // Test connection
    const test = await pool.query('SELECT 1 as test');
    console.log('✓ Database connection OK');

    // Check tables
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name LIKE 'country%'
      ORDER BY table_name
    `);
    
    console.log('\n📋 Country Tables:');
    if (tables.rows.length === 0) {
      console.log('   No country tables found!');
    } else {
      tables.rows.forEach(t => console.log(`   ✓ ${t.table_name}`));
    }

    // Check countries data
    const countries = await pool.query('SELECT COUNT(*) as count FROM countries');
    console.log(`\n📊 Countries count: ${countries.rows[0].count}`);

    // Show sample
    const sample = await pool.query('SELECT id, name, slug, region, popularity_score FROM countries LIMIT 5');
    console.log('\n🌍 Sample Countries:');
    sample.rows.forEach(c => {
      console.log(`   • ${c.name} (${c.slug}) - ${c.region} - Score: ${c.popularity_score}`);
    });

    // Check columns
    const columns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'countries'
      ORDER BY ordinal_position
    `);
    console.log('\n📝 Countries Table Columns:');
    columns.rows.forEach(c => console.log(`   • ${c.column_name}: ${c.data_type}`));

    console.log('\n✅ Verification complete!');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

verify();
