/**
 * Migration: Add hero_images and other missing columns to countries table
 * 
 * Run this script to add the necessary columns for full country functionality
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
  console.log("âœ… Loaded environment variables from .env");
}

const { sequelize } = require("../config/database");

const migrationSQL = `
-- ================================================
-- ADD MISSING COLUMNS TO COUNTRIES TABLE
-- ================================================

ALTER TABLE countries 
ADD COLUMN IF NOT EXISTS official_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS flag VARCHAR(255),
ADD COLUMN IF NOT EXISTS flag_url VARCHAR(255),
ADD COLUMN IF NOT EXISTS tagline TEXT,
ADD COLUMN IF NOT EXISTS motto TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS full_description TEXT,
ADD COLUMN IF NOT EXISTS hero_images TEXT,
ADD COLUMN IF NOT EXISTS short_notes TEXT,
ADD COLUMN IF NOT EXISTS destination_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS activities TEXT,
ADD COLUMN IF NOT EXISTS faqs TEXT,
ADD COLUMN IF NOT EXISTS extra_info TEXT,
ADD COLUMN IF NOT EXISTS language VARCHAR(100),
ADD COLUMN IF NOT EXISTS timezone VARCHAR(100),
ADD COLUMN IF NOT EXISTS currency VARCHAR(50),
ADD COLUMN IF NOT EXISTS climate VARCHAR(100),
ADD COLUMN IF NOT EXISTS best_time_to_visit VARCHAR(255),
ADD COLUMN IF NOT EXISTS visa_info TEXT,
ADD COLUMN IF NOT EXISTS key_facts TEXT,
ADD COLUMN IF NOT EXISTS government TEXT,
ADD COLUMN IF NOT EXISTS languages TEXT,
ADD COLUMN IF NOT EXISTS climate_detail TEXT,
ADD COLUMN IF NOT EXISTS geography TEXT,
ADD COLUMN IF NOT EXISTS practical_info TEXT,
ADD COLUMN IF NOT EXISTS wildlife TEXT,
ADD COLUMN IF NOT EXISTS cuisine TEXT,
ADD COLUMN IF NOT EXISTS ratings TEXT,
ADD COLUMN IF NOT EXISTS highlights TEXT,
ADD COLUMN IF NOT EXISTS experiences TEXT,
ADD COLUMN IF NOT EXISTS travel_tips TEXT,
ADD COLUMN IF NOT EXISTS neighboring_countries TEXT,
ADD COLUMN IF NOT EXISTS demonym VARCHAR(100),
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Update table comment
COMMENT ON TABLE countries IS 'Stores country information for the Altuvera travel platform';

DO $$ 
BEGIN
   IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                  WHERE constraint_name = 'countries_slug_key' AND table_name = 'countries') THEN
      ALTER TABLE countries ADD CONSTRAINT countries_slug_key UNIQUE (slug);
   END IF;
END $$;
`;

sequelize.query(migrationSQL)
  .then(() => {
    console.log("âœ… Successfully added hero_images and other columns to countries table");
    process.exit(0);
  })
  .catch((err) => {
    console.error("â��Œ Error adding columns to countries table:", err);
    process.exit(1);
  });