require("dotenv").config({ path: require("path").resolve(process.cwd(), ".env") });
const bcrypt = require("bcryptjs");
const { query, closeConnections } = require("../config/db");

(async () => {
  try {
    console.log("🔍 Checking admin_users table...");
    const cols = await query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'admin_users' ORDER BY ordinal_position"
    );
    console.log("Columns:", cols.rows.map((r) => r.column_name));

    const existing = await query("SELECT COUNT(*) FROM admin_users");
    console.log("Current admin count:", existing.rows[0].count);

    const passwordHash = await bcrypt.hash("admin123", 12);

    const result = await query(
      `INSERT INTO admin_users (email, username, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, username, full_name, role, is_active`,
      ["admin@altuvera.com", "admin", passwordHash, "System Administrator", "superadmin", true]
    );

    console.log("\n✅ Admin user created successfully!");
    console.log("═══════════════════════════════════════");
    console.log("Email:    admin@altuvera.com");
    console.log("Password: admin123");
    console.log("Role:     superadmin");
    console.log("═══════════════════════════════════════");
    console.log("Inserted:", result.rows[0]);
  } catch (err) {
    console.error("\n❌ Error:", err.message);
    console.error("Code:", err.code);
    console.error("Detail:", err.detail || "N/A");
    process.exit(1);
  } finally {
    await closeConnections();
  }
})();
