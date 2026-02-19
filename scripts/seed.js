// scripts/seed.js
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/database/pool');

const seedsPath = path.join(__dirname, '../src/database/seeds');

async function runSeeds() {
  try {
    console.log('🌱 Starting seeds...\n');
    
    const seedFiles = fs.readdirSync(seedsPath)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    for (const file of seedFiles) {
      console.log(`📄 Running ${file}...`);
      const sql = fs.readFileSync(path.join(seedsPath, file), 'utf8');
      await pool.query(sql);
      console.log(`✅ Completed ${file}`);
    }
    
    console.log('\n✨ All seeds completed successfully!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runSeeds();