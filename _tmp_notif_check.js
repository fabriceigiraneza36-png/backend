const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await pool.query("SELECT id, target_scope, target_role, user_id, title, sender_type, created_at FROM notifications ORDER BY created_at DESC LIMIT 15");
    console.log('=== recent notifications ===');
    r.rows.forEach(x => console.log(JSON.stringify(x)));
    const s = await pool.query("SELECT target_scope, COUNT(*)::int AS c FROM notifications GROUP BY target_scope");
    console.log('=== scope counts ===', JSON.stringify(s.rows));
    const t = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('comments','destination_comments','reviews','destination_reviews')");
    console.log('=== comment-ish tables ===', t.rows.map(c=>c.table_name).join(','));
  } catch (e) { console.error('ERR', e.message); }
  await pool.end();
})();
