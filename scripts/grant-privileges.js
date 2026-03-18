/**
 * Grant database privileges to the app role.
 *
 * Usage:
 * - Print recommended SQL (no admin creds):
 *   `node scripts/grant-privileges.js`
 *
 * - Execute automatically (requires admin creds):
 *   Set either `DATABASE_URL_ADMIN` or `DB_ADMIN_*` env vars, then run the script.
 */

require("dotenv").config();
const { Client } = require("pg");

const getAdminConnectionString = () => {
  if (process.env.DATABASE_URL_ADMIN) return process.env.DATABASE_URL_ADMIN;

  const host = process.env.DB_HOST || "localhost";
  const port = process.env.DB_PORT || "5432";
  const database = process.env.DB_NAME || "altuvera";
  const user = process.env.DB_ADMIN_USER || "";
  const password = process.env.DB_ADMIN_PASSWORD || "";

  if (!user || !password) return null;
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
};

const appUser = process.env.DB_USER || "fabrice";
const schema = process.env.DB_SCHEMA || "public";

const sql = `
-- Grant basic schema usage
GRANT USAGE ON SCHEMA ${schema} TO ${appUser};

-- Grant privileges on existing tables/sequences
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${appUser};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${appUser};

-- Ensure future tables/sequences also grant privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appUser};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${appUser};
`.trim();

async function main() {
  const adminConn = getAdminConnectionString();

  if (!adminConn) {
    console.log("No admin credentials found; printing SQL only.\n");
    console.log(sql);
    process.exit(0);
  }

  const client = new Client({ connectionString: adminConn });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("✅ Privileges granted successfully.");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("❌ Failed to grant privileges:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err.message);
  process.exit(1);
});

