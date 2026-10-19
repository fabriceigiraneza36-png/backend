// generate-admin.js
// Generate a one-time admin SQL statement using secrets supplied outside source control.
// Run with ADMIN_EMAIL and ADMIN_SEED_PASSWORD environment variables set.
const bcrypt = require("bcryptjs");

const email = process.env.ADMIN_EMAIL || "info@altuverasafaris.com";
const password = process.env.ADMIN_SEED_PASSWORD;
if (!password) {
  console.error("Missing ADMIN_SEED_PASSWORD. Set it securely in your environment; never commit it.");
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("ADMIN_EMAIL must be a valid email address.");
  process.exit(1);
}

const adminData = {
  email,
  username: process.env.ADMIN_USERNAME || "altuvera_admin",
  password,
  fullName: process.env.ADMIN_FULL_NAME || "Altuvera Admin",
  role: "superadmin",
};

const hash = bcrypt.hashSync(adminData.password, 12);

console.log("\nAdmin password hash generated. The plaintext password is not printed.\n");
console.log("Email:    ", adminData.email);
console.log("Username: ", adminData.username);
console.log("Hash:     ", hash);

console.log("\n── Run this SQL in Neon console ──────────────────────────────────────\n");
console.log(`
INSERT INTO admin_users (
  email, username, password_hash, full_name, role,
  is_active, token_version, created_at, updated_at
)
VALUES (
  '${adminData.email.replace(/'/g, "''")}',
  '${adminData.username.replace(/'/g, "''")}',
  '${hash}',
  '${adminData.fullName.replace(/'/g, "''")}',
  '${adminData.role}',
  true,
  0,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  full_name     = EXCLUDED.full_name,
  role          = EXCLUDED.role,
  is_active     = true,
  token_version = 0,
  updated_at    = NOW()
RETURNING id, email, username, role, is_active;
`);
