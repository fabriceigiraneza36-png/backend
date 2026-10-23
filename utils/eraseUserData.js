/**
 * Transactional erasure of a traveller and their owned activity.
 * Schema-aware for optional activity modules; any failed deletion rolls back.
 */
"use strict";
const { pool } = require("../config/db");
const OWNERSHIP_COLUMNS = ["user_id","author_id","created_by","owner_id","actor_id","sender_id","sender_user_id","account_id","traveller_id","requester_id","liked_by","commenter_id","member_user_id"];
const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"';

async function eraseUserData(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (!user.rowCount) {
      await client.query("ROLLBACK");
      return { found: false, deletedRows: 0 };
    }

    const conversations = await client.query("SELECT id FROM conversations WHERE user_id=$1", [userId]);
    const conversationIds = conversations.rows.map((r) => r.id);
    if (conversationIds.length) {
      await client.query("DELETE FROM messages WHERE conversation_id=ANY($1::int[])", [conversationIds]);
    }
    await client.query("DELETE FROM messages WHERE sender_id=$1", [userId]);

    const optionalTables = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name IN ('chat_messages','chat_sessions','message_group_members')
    `);
    const optional = new Map();
    for (const r of optionalTables.rows) {
      if (!optional.has(r.table_name)) optional.set(r.table_name, new Set());
      optional.get(r.table_name).add(r.column_name);
    }
    if (optional.get("chat_messages")?.has("sender_id")) {
      await client.query("DELETE FROM chat_messages WHERE sender_id=$1", [userId]);
    }
    if (optional.get("chat_sessions")?.has("user_id")) {
      await client.query("DELETE FROM chat_sessions WHERE user_id=$1", [userId]);
    }

    const schema = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema='public' AND column_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position
    `, [OWNERSHIP_COLUMNS]);
    const tableColumns = new Map();
    for (const r of schema.rows) {
      if (["users","messages","conversations","chat_messages","chat_sessions"].includes(r.table_name)) continue;
      if (!tableColumns.has(r.table_name)) tableColumns.set(r.table_name, new Set());
      tableColumns.get(r.table_name).add(r.column_name);
    }

    // Remove authored/owned records such as likes, comments, ratings,
    // notifications, bookings, account activity and security factors.
    let deletedRows = 0;
    for (const [table, columns] of tableColumns) {
      const where = [...columns].map((c) => `${qi(c)}::text=$1::text`).join(" OR ");
      const result = await client.query(`DELETE FROM ${qi("public")}.${qi(table)} WHERE ${where}`, [userId]);
      deletedRows += result.rowCount || 0;
    }
    if (optional.get("message_group_members")?.has("user_id")) {
      const result = await client.query("DELETE FROM message_group_members WHERE user_id=$1", [userId]);
      deletedRows += result.rowCount || 0;
    }
    if (conversationIds.length) {
      const result = await client.query("DELETE FROM conversations WHERE id=ANY($1::int[])", [conversationIds]);
      deletedRows += result.rowCount || 0;
    }
    await client.query("DELETE FROM users WHERE id=$1", [userId]);
    await client.query("COMMIT");
    return { found: true, deletedRows };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
module.exports = { eraseUserData };
