// scripts/migrate-contact.js
require("dotenv").config();
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function runMigration() {
  try {
    console.log("🚀 Starting contact table migration...");
    const migrationSql = fs.readFileSync(
      path.join(__dirname, "../db/update_contact.sql"),
      "utf8",
    );

    await pool.query(migrationSql);
    console.log("✅ Migration completed successfully!");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
