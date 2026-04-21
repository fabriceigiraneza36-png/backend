/**
 * scripts/createAdmin.js
 * Run: node scripts/createAdmin.js
 */

require("dotenv").config();
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || "altuvera",
  user: process.env.DB_USER || "fabrice",
  password: process.env.DB_PASSWORD || "2004",
});

async function createAdmin() {
  try {
    console.log("🔧 Creating admin user...\n");

    const email = "admin@altuvera.com";
    const password = "altuvera"; // Your password
    const username = "admin";
    const fullName = "Administrator";

    // Check if admin_users table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'admin_users'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log("📋 Creating admin_users table...");
      await pool.query(`
        CREATE TABLE admin_users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          full_name VARCHAR(255),
          role VARCHAR(50) DEFAULT 'admin',
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          last_login TIMESTAMP
        );
      `);
      console.log("✅ Table created\n");
    }

    // Check if admin exists
    const existing = await pool.query(
      "SELECT id FROM admin_users WHERE email = $1 OR username = $2",
      [email, username]
    );

    if (existing.rows.length > 0) {
      console.log("⚠️  Admin user already exists!");
      console.log("    Email:", email);
      console.log("    Password: 123\n");
      
      // Update password anyway
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query(
        "UPDATE admin_users SET password_hash = $1 WHERE email = $2",
        [passwordHash, email]
      );
      console.log("✅ Password updated to '123'\n");
      
      await pool.end();
      process.exit(0);
    }

    // Hash password
    console.log("🔐 Hashing password...");
    const passwordHash = await bcrypt.hash(password, 12);

    // Create admin
    console.log("💾 Inserting admin user...");
    const result = await pool.query(
      `INSERT INTO admin_users 
       (username, email, password_hash, full_name, role, is_active) 
       VALUES ($1, $2, $3, $4, $5, true) 
       RETURNING id, username, email, full_name, role`,
      [username, email, passwordHash, fullName, "admin"]
    );

    const admin = result.rows[0];

    console.log("✅ Admin user created successfully!\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📧 Email:    ", admin.email);
    console.log("👤 Username: ", admin.username);
    console.log("🔑 Password: ", password);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error creating admin:", error.message);
    console.error(error);
    await pool.end();
    process.exit(1);
  }
}

createAdmin();