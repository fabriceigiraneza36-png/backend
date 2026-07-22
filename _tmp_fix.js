const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await pool.query(
      `UPDATE notifications
          SET expires_at = NULL, updated_at = NOW()
        WHERE target_scope IN ('all','role')
          AND expires_at IS NOT NULL
          AND expires_at <= NOW()
        RETURNING id, title`
    );
    console.log('Cleared past expiry on broadcast rows:', r.rowCount);
    r.rows.forEach(x => console.log('  -', x.id, x.title));
  } catch (e) { console.error('ERR', e.message); }
  await pool.end();
})();
