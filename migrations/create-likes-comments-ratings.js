/**
 * Migration: Create Likes, Comments, and Ratings Tables
 * 
 * Run this script to create the necessary tables for:
 * - Country Likes, Comments, Ratings
 * - Destination Likes, Comments, Ratings
 */

// Load environment variables from .env file
const path = require("path");
const fs = require("fs");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=").trim();
      if (key && value) {
        process.env[key.trim()] = value;
      }
    }
  });
  console.log("✅ Loaded environment variables from .env");
}

const { sequelize } = require("../config/database");

const migrationSQL = `
-- ================================================
-- COUNTRY LIKES TABLE
-- ================================================
CREATE TABLE IF NOT EXISTS country_likes (
    id SERIAL PRIMARY KEY,
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT country_likes_unique_user UNIQUE (country_id, user_id),
    CONSTRAINT country_likes_unique_session UNIQUE (country_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_country_likes_country_id ON country_likes(country_id);
CREATE INDEX IF NOT EXISTS idx_country_likes_user_id ON country_likes(user_id);

-- ================================================
-- COUNTRY COMMENTS TABLE
-- ================================================
CREATE TABLE IF NOT EXISTS country_comments (
    id SERIAL PRIMARY KEY,
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name VARCHAR(255),
    author_email VARCHAR(255),
    content TEXT NOT NULL,
    parent_id INTEGER REFERENCES country_comments(id) ON DELETE CASCADE,
    is_approved BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_country_comments_country_id ON country_comments(country_id);
CREATE INDEX IF NOT EXISTS idx_country_comments_user_id ON country_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_country_comments_parent_id ON country_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_country_comments_created_at ON country_comments(created_at);

-- ================================================
-- COUNTRY RATINGS TABLE
-- ================================================
CREATE TABLE IF NOT EXISTS country_ratings (
    id SERIAL PRIMARY KEY,
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(255),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT,
    is_approved BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT country_ratings_unique_user UNIQUE (country_id, user_id),
    CONSTRAINT country_ratings_unique_session UNIQUE (country_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_country_ratings_country_id ON country_ratings(country_id);
CREATE INDEX IF NOT EXISTS idx_country_ratings_user_id ON country_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_country_ratings_rating ON country_ratings(rating);

-- ================================================
-- DESTINATION LIKES TABLE
-- ================================================
CREATE TABLE IF NOT EXISTS destination_likes (
    id SERIAL PRIMARY KEY,
    destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT destination_likes_unique_user UNIQUE (destination_id, user_id),
    CONSTRAINT destination_likes_unique_session UNIQUE (destination_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_destination_likes_destination_id ON destination_likes(destination_id);
CREATE INDEX IF NOT EXISTS idx_destination_likes_user_id ON destination_likes(user_id);

-- ================================================
-- DESTINATION COMMENTS TABLE
-- ================================================
CREATE TABLE IF NOT EXISTS destination_comments (
    id SERIAL PRIMARY KEY,
    destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name VARCHAR(255),
    author_email VARCHAR(255),
    content TEXT NOT NULL,
    parent_id INTEGER REFERENCES destination_comments(id) ON DELETE CASCADE,
    is_approved BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_destination_comments_destination_id ON destination_comments(destination_id);
CREATE INDEX IF NOT EXISTS idx_destination_comments_user_id ON destination_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_destination_comments_parent_id ON destination_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_destination_comments_created_at ON destination_comments(created_at);

-- ================================================
-- DESTINATION RATINGS TABLE
-- ================================================
CREATE TABLE IF NOT EXISTS destination_ratings (
    id SERIAL PRIMARY KEY,
    destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(255),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT,
    is_approved BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT destination_ratings_unique_user UNIQUE (destination_id, user_id),
    CONSTRAINT destination_ratings_unique_session UNIQUE (destination_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_destination_ratings_destination_id ON destination_ratings(destination_id);
CREATE INDEX IF NOT EXISTS idx_destination_ratings_user_id ON destination_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_destination_ratings_rating ON destination_ratings(rating);
`;

async function runMigration() {
  try {
    console.log("🚀 Starting likes/comments/ratings migration...\n");
    
    // Test connection
    await sequelize.authenticate();
    console.log("✅ Database connection established\n");
    
    // Run migration
    console.log("📦 Creating tables...\n");
    await sequelize.query(migrationSQL);
    
    console.log("✅ Migration completed successfully!");
    console.log("\nCreated tables:");
    console.log("  - country_likes");
    console.log("  - country_comments");
    console.log("  - country_ratings");
    console.log("  - destination_likes");
    console.log("  - destination_comments");
    console.log("  - destination_ratings");
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  }
}

// Run migration if executed directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
