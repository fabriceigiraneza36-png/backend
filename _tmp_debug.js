const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const a = await pool.query("SELECT id, title, target_scope FROM notifications WHERE target_scope = 'all'");
    console.log("A) target_scope='all' rows:", a.rows.length, JSON.stringify(a.rows));

    const b = await pool.query("SELECT id, target_scope, deleted_at, expires_at FROM notifications WHERE id = 54");
    console.log("B) row 54 detail:", JSON.stringify(b.rows));

    const c = await pool.query("SELECT id FROM notifications WHERE target_scope = 'all' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())");
    console.log("C) all + not deleted + not expired:", c.rows.length);

    // exact userScopeSQL with user 12
    const sw = `deleted_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) AND (user_id = $1 OR user_email = $2 OR target_scope = 'all' OR (target_scope = 'role' AND target_role = $3))`;
    const d = await pool.query(`SELECT id, target_scope FROM notifications WHERE ${sw}`, [12, '', 'user']);
    console.log("D) full scope query user12:", d.rows.length, JSON.stringify(d.rows));

    const e = await pool.query(`SELECT id, target_scope FROM notifications WHERE ${sw}`, [12, null, 'user']);
    console.log("E) full scope query user12 (email null):", e.rows.length);
  } catch (err) { console.error('ERR', err.message); }
  await pool.end();
})();
