const { pool, sequelize } = require('../config/db');

async function inspect() {
  try {
    console.log('Pool options:', pool.options || pool);
    const res = await pool.query("SELECT current_database() as db, current_schema() as schema");
    console.log('Current DB/schema:', res.rows[0]);
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    console.log('Public tables:', tables.rows.map(r => r.tablename).slice(0,50));
  } catch (err) {
    console.error('Error inspecting DB:', err.message);
  } finally {
    await pool.end();
    await sequelize.close();
  }
}

inspect();
