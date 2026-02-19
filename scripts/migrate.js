// scripts/migrate.js
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/database/pool');

const migrationsPath = path.join(__dirname, '../src/database/migrations');

async function createMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getExecutedMigrations() {
  const result = await pool.query('SELECT name FROM migrations ORDER BY id');
  return result.rows.map(row => row.name);
}

async function runMigrations() {
  try {
    console.log('🚀 Starting migrations...\n');
    
    await createMigrationsTable();
    const executedMigrations = await getExecutedMigrations();
    
    const migrationFiles = fs.readdirSync(migrationsPath)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    for (const file of migrationFiles) {
      if (executedMigrations.includes(file)) {
        console.log(`⏭️  Skipping ${file} (already executed)`);
        continue;
      }
      
      console.log(`📄 Running ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsPath, file), 'utf8');
      
      await pool.query(sql);
      await pool.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
      
      console.log(`✅ Completed ${file}`);
    }
    
    console.log('\n✨ All migrations completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function rollbackMigrations() {
  console.log('⚠️  Rolling back migrations...');
  // Add rollback logic here if needed
  await pool.end();
}

const command = process.argv[2];

if (command === 'down') {
  rollbackMigrations();
} else {
  runMigrations();
}