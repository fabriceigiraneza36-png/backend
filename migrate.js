const { query } = require("./config/db");

async function run() {
  try {
    console.log("Connecting to database...");

    await query("SELECT NOW()");
    console.log("SUCCESS: Database connected!");

    await query("CREATE TABLE IF NOT EXISTS reviews (id SERIAL PRIMARY KEY, user_id INTEGER, entity_type VARCHAR(50) DEFAULT 'general', entity_id INTEGER, rating NUMERIC(3,1) CHECK (rating >= 1 AND rating <= 5), title VARCHAR(200), body TEXT, is_approved BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())");
    console.log("SUCCESS: reviews table ready!");

    await query("CREATE TABLE IF NOT EXISTS team (id SERIAL PRIMARY KEY, name VARCHAR(150) NOT NULL, role VARCHAR(150), department VARCHAR(100) DEFAULT 'General', bio TEXT, avatar_url TEXT, email VARCHAR(255), phone VARCHAR(50), linkedin_url TEXT, twitter_url TEXT, instagram_url TEXT, facebook_url TEXT, display_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, is_featured BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())");
    console.log("SUCCESS: team table ready!");

    var cols = ["department VARCHAR(100) DEFAULT 'General'","display_order INTEGER DEFAULT 0","is_active BOOLEAN DEFAULT true","is_featured BOOLEAN DEFAULT false","linkedin_url TEXT","twitter_url TEXT","instagram_url TEXT","facebook_url TEXT","phone VARCHAR(50)","email VARCHAR(255)","bio TEXT","avatar_url TEXT","role VARCHAR(150)"];

    for (var i = 0; i < cols.length; i++) {
      try {
        await query("ALTER TABLE team ADD COLUMN IF NOT EXISTS " + cols[i]);
        console.log("SUCCESS: column ok: " + cols[i].split(" ")[0]);
      } catch (colErr) {
        console.log("SKIP: " + cols[i].split(" ")[0] + " - " + colErr.message);
      }
    }

    var tables = await query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    console.log("ALL TABLES IN DB: " + tables.rows.map(function(r){ return r.table_name; }).join(", "));
    console.log("ALL DONE - Database is ready!");

  } catch (err) {
    console.error("FATAL ERROR:", err.message);
    console.error("FULL ERROR:", err);
  }
  process.exit(0);
}

run();
