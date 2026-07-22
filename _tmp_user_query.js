const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const userId = 12, userEmail = '', userRole = 'user';
    const sw = `
      deleted_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (
        user_id = $1
        OR user_email = $2
        OR target_scope = 'all'
        OR (target_scope = 'role' AND target_role = $3)
      )`;
    const r = await pool.query(
      `SELECT id, title, target_scope, is_read FROM notifications WHERE ${sw} ORDER BY created_at DESC LIMIT 20`,
      [userId, userEmail, userRole]
    );
    console.log('=== what user 12 would see ===');
    r.rows.forEach(x => console.log(JSON.stringify(x)));
    console.log('total rows:', r.rows.length);
  } catch (e) { console.error('ERR', e.message); }
  await pool.end();
})();
