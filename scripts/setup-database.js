/**
 * Database Setup Script
 * Run: node scripts/setup-database.js
 */

require("dotenv").config();
const { Sequelize } = require("sequelize");
const fs = require("fs");
const path = require("path");

let sequelize;
if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: console.log,
    dialectOptions:
      process.env.DB_SSL === "false"
        ? {}
        : { ssl: { rejectUnauthorized: false } },
  });
} else {
  sequelize = new Sequelize(
    process.env.DB_NAME || "altuvera",
    process.env.DB_USER || "fabrice",
    process.env.DB_PASSWORD || "2004",
    {
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      dialect: "postgres",
      logging: console.log,
    }
  );
}

async function setupDatabase() {
  try {
    console.log("🔄 Connecting to database...");
    await sequelize.authenticate();
    console.log("✅ Connected!");

	    const schemaFile = path.join(__dirname, "..", "db", "schema.sql");
	    if (fs.existsSync(schemaFile)) {
	      console.log("\n📄 Found db/schema.sql — applying full schema (this will recreate tables)...");
	      const sql = fs.readFileSync(schemaFile, "utf8");
	      await sequelize.query(sql);
	      console.log("✅ Full schema applied from db/schema.sql");
	    } else {
	      console.log("\n📊 Creating tables...");

	      // (fallback) previous manual table creation will be executed below
	    }
    
    // Users table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        avatar TEXT,
        phone VARCHAR(50),
        bio TEXT,
        role VARCHAR(50) DEFAULT 'user',
        is_verified BOOLEAN DEFAULT false,
        verification_code VARCHAR(10),
        code_expiry TIMESTAMP,
        code_attempts INTEGER DEFAULT 0,
        last_code_sent_at TIMESTAMP,
        reset_password_token VARCHAR(255),
        reset_password_expire TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Users table created");

    // Countries table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS countries (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(10) UNIQUE NOT NULL,
        description TEXT,
        image TEXT,
        is_featured BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Countries table created");

    // Destinations table
	    await sequelize.query(`
	      CREATE TABLE IF NOT EXISTS destinations (
	        id SERIAL PRIMARY KEY,
	        country_id INTEGER REFERENCES countries(id) ON DELETE CASCADE,
	        name VARCHAR(255) NOT NULL,
	        description TEXT,
	        images JSONB DEFAULT '[]',
	        duration VARCHAR(100),
	        rating DECIMAL(3, 2) DEFAULT 0,
	        reviews_count INTEGER DEFAULT 0,
	        is_featured BOOLEAN DEFAULT false,
	        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	      );
	    `);
	    console.log("✅ Destinations table created");

    // Posts table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        content TEXT,
        excerpt TEXT,
        featured_image TEXT,
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        category VARCHAR(100),
        tags JSONB DEFAULT '[]',
        is_published BOOLEAN DEFAULT false,
        published_at TIMESTAMP,
        views_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Posts table created");

    // Tips table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS tips (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        category VARCHAR(100),
        icon VARCHAR(100),
        order_index INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Tips table created");

    // Services table
	    await sequelize.query(`
	      CREATE TABLE IF NOT EXISTS services (
	        id SERIAL PRIMARY KEY,
	        name VARCHAR(255) NOT NULL,
	        description TEXT,
	        icon VARCHAR(100),
	        price DECIMAL(10, 2),
	        is_active BOOLEAN DEFAULT true,
	        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	      );
	    `);
	    console.log("✅ Services table created");

	    // Ensure legacy destination price column is removed (destinations are price-less).
	    await sequelize.query(`ALTER TABLE IF EXISTS destinations DROP COLUMN IF EXISTS price;`);

	    // Team table
	    await sequelize.query(`
	      CREATE TABLE IF NOT EXISTS team (
	        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        position VARCHAR(255),
        bio TEXT,
        avatar TEXT,
        email VARCHAR(255),
        phone VARCHAR(50),
        social_links JSONB DEFAULT '{}',
        order_index INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Team table created");

    // Gallery table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS gallery (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255),
        description TEXT,
        image_url TEXT NOT NULL,
        thumbnail_url TEXT,
        category VARCHAR(100),
        tags JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Gallery table created");

    // Bookings table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        destination_id INTEGER REFERENCES destinations(id) ON DELETE SET NULL,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        travelers_count INTEGER DEFAULT 1,
        travel_date DATE,
        message TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        total_price DECIMAL(10, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Bookings table created");

    // FAQs table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS faqs (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        category VARCHAR(100),
        order_index INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ FAQs table created");

    // Contact messages table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        whatsapp VARCHAR(50),
        subject VARCHAR(255),
        message TEXT NOT NULL,
        trip_type VARCHAR(100),
        travel_date DATE,
        number_of_travelers INTEGER,
        source VARCHAR(100) DEFAULT 'website',
        ip_address VARCHAR(50),
        user_agent TEXT,
        referrer_url TEXT,
        status VARCHAR(20) DEFAULT 'new',
        is_read BOOLEAN DEFAULT false,
        is_starred BOOLEAN DEFAULT false,
        priority VARCHAR(20) DEFAULT 'normal',
        assigned_to INTEGER,
        assigned_at TIMESTAMP,
        responded_at TIMESTAMP,
        response_notes TEXT,
        tags TEXT[] DEFAULT '{}'::TEXT[],
        read_at TIMESTAMP,
        archived_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Contact messages table created");

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS contact_replies (
        id SERIAL PRIMARY KEY,
        message_id INTEGER NOT NULL,
        subject VARCHAR(255),
        body TEXT NOT NULL,
        sent_by INTEGER,
        sent_by_name VARCHAR(255),
        sent_by_email VARCHAR(255),
        status VARCHAR(50) DEFAULT 'sent',
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Contact replies table created");

    await sequelize.query(`
      CREATE OR REPLACE VIEW v_contact_stats AS
      SELECT
        COUNT(*) AS total_messages,
        COUNT(*) FILTER (WHERE status = 'new') AS new_messages,
        COUNT(*) FILTER (WHERE is_read = false) AS unread_messages,
        COUNT(*) FILTER (WHERE status = 'replied') AS replied_messages,
        COUNT(*) FILTER (WHERE status = 'archived') AS archived_messages,
        COUNT(*) FILTER (WHERE status = 'spam') AS spam_messages,
        COUNT(*) FILTER (WHERE priority = 'urgent') AS urgent_messages,
        COUNT(*) FILTER (WHERE priority = 'high') AS high_priority_messages,
        COUNT(*) FILTER (WHERE is_starred = true) AS starred_messages,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today_messages,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') AS week_messages,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') AS month_messages
      FROM contact_messages;
    `);
    console.log("✅ Contact stats view created");

    // Pages table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS pages (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        content TEXT,
        meta_title VARCHAR(255),
        meta_description TEXT,
        is_published BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Pages table created");

    // Virtual tours table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS virtual_tours (
        id SERIAL PRIMARY KEY,
        destination_id INTEGER REFERENCES destinations(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        video_url TEXT,
        iframe_url TEXT,
        thumbnail TEXT,
        duration VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Virtual tours table created");

    // Subscribers table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Subscribers table created");

    // Settings table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        value TEXT,
        type VARCHAR(50) DEFAULT 'text',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Settings table created");

    // Create indexes for performance
    console.log("\n🔧 Creating indexes...");
    const indexStatements = [
      `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`,
      `CREATE INDEX IF NOT EXISTS idx_destinations_country ON destinations(country_id);`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_destination ON bookings(destination_id);`,
      `CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);`,
      `CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);`,
    ];

    for (const stmt of indexStatements) {
      try {
        await sequelize.query(stmt);
      } catch (err) {
        console.warn('⚠️ Index creation warning:', err.message);
      }
    }

    console.log("✅ Indexes created (or skipped if already present)");

    console.log("\n🎉 Database setup complete!");
    
  } catch (error) {
    console.error("\n❌ Error setting up database:", error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await sequelize.close();
    process.exit(0);
  }
}

setupDatabase();
