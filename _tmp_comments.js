const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='destination_comments' ORDER BY ordinal_position");
    console.log('=== destination_comments columns ===');
    cols.rows.forEach(c => console.log(' ', c.column_name, c.data_type));
    const cnt = await pool.query("SELECT COUNT(*)::int AS c FROM destination_comments");
    console.log('=== row count ===', cnt.rows[0].c);
    const rows = await pool.query("SELECT id, destination_id, user_id, LEFT(content,40) AS content, is_approved, created_at FROM destination_comments ORDER BY created_at DESC LIMIT 10");
    rows.rows.forEach(r => console.log(JSON.stringify(r)));
  } catch (e) { console.error('ERR', e.message); }
  await pool.end();
})();
