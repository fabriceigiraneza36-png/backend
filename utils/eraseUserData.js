/**
 * Soft-delete a traveller while preserving shared group conversation history.
 *
 * Private support threads are hidden from the active inbox when an account is
 * removed. Shared group conversations/messages stay intact; the member is
 * removed from membership and their historical messages are displayed as
 * "Deleted user" by the messaging read layer.
 */
"use strict";

const { pool } = require("../config/db");

async function eraseUserData(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Safe for production databases that predate the soft-delete field.
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ");

    const result = await client.query(
      `UPDATE users
          SET deleted_at = COALESCE(deleted_at, NOW()),
              is_active = FALSE,
              updated_at = NOW()
        WHERE id::text = $1::text AND deleted_at IS NULL
        RETURNING id`,
      [userId],
    );

    let alreadyDeleted = false;
    if (!result.rowCount) {
      const existing = await client.query(
        "SELECT id, deleted_at FROM users WHERE id::text = $1::text",
        [userId],
      );
      if (!existing.rowCount) {
        await client.query("ROLLBACK");
        return { found: false, deletedRows: 0 };
      }
      alreadyDeleted = Boolean(existing.rows[0]?.deleted_at);
    }

    // Count shared threads before removing this member. Group conversations
    // are intentionally not soft-deleted even when the group had only two users.
    const groupThreads = await client.query(
      `SELECT COUNT(DISTINCT c.id)::INT AS count
         FROM conversations c
        WHERE c.group_id IS NOT NULL
          AND (
            c.user_id::text = $1::text
            OR EXISTS (
              SELECT 1 FROM message_group_members gm
               WHERE gm.group_id = c.group_id AND gm.user_id::text = $1::text
            )
          )`,
      [userId],
    );

    // Hide the account's private one-to-one support threads from the live
    // admin inbox. Messages stay in the database for auditability, but only
    // group threads remain visible in messaging after account removal.
    const privateThreads = await client.query(
      `UPDATE conversations
          SET deleted_at = COALESCE(deleted_at, NOW()),
              updated_at = NOW()
        WHERE user_id::text = $1::text
          AND group_id IS NULL
          AND deleted_at IS NULL
        RETURNING id`,
      [userId],
    );

    // Keep the group and all messages, but mark the removed traveller as no
    // longer a participant so the remaining group members retain normal access.
    const memberships = await client.query(
      "DELETE FROM message_group_members WHERE user_id::text = $1::text",
      [userId],
    );

    await client.query("COMMIT");
    return {
      found: true,
      alreadyDeleted,
      softDeleted: true,
      deletedRows: result.rowCount ? 1 : 0,
      privateConversationsHidden: privateThreads.rowCount || 0,
      removedGroupMemberships: memberships.rowCount || 0,
      preservedGroupConversations: groupThreads.rows[0]?.count || 0,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { eraseUserData };
