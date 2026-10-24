/**
 * Soft-delete a traveller while preserving conversation history.
 *
 * Messaging records are an audit trail: deleting a user must never cascade
 * through their conversations, group memberships, or messages.  The deleted
 * account is disabled and marked so inboxes can render "Deleted user".
 */
"use strict";
const { pool } = require("../config/db");

async function eraseUserData(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Safe for existing production databases that predate the soft-delete field.
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ");

    const result = await client.query(
      `UPDATE users
          SET deleted_at = COALESCE(deleted_at, NOW()),
              is_active = FALSE,
              updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id`,
      [userId],
    );

    if (!result.rowCount) {
      const existing = await client.query("SELECT id, deleted_at FROM users WHERE id=$1", [userId]);
      await client.query("COMMIT");
      return { found: Boolean(existing.rowCount), alreadyDeleted: Boolean(existing.rows[0]?.deleted_at), deletedRows: 0 };
    }

    // Deliberately retain messages, conversations, group memberships, and
    // user identity columns: historical messages remain attributable and
    // groups remain usable by their surviving members.
    await client.query("COMMIT");
    return { found: true, deletedRows: 1, softDeleted: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
module.exports = { eraseUserData };
