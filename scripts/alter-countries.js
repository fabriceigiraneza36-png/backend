const { pool } = require('../config/db');

async function run() {
  try {
    const stmts = [
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS slug VARCHAR(255) UNIQUE;`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS short_description TEXT;`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(500);`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS flag_url VARCHAR(500);`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS continent VARCHAR(100);`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS capital VARCHAR(255);`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS currency VARCHAR(100);`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS language VARCHAR(255);`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS timezone VARCHAR(100);`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS best_time_to_visit VARCHAR(255);`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS visa_info TEXT;`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`,
      `ALTER TABLE countries ADD COLUMN IF NOT EXISTS destination_count INTEGER DEFAULT 0;`,
    ];

    for (const s of stmts) {
      try {
        await pool.query(s);
        console.log('OK:', s.split('\n')[0]);
      } catch (err) {
        console.warn('WARN:', err.message);
      }
    }

    console.log('Done altering countries table');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

run();
