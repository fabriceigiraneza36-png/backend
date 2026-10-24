/**
 * Transactional erasure of a traveller and their owned activity.
 *
 * Messaging tables are deliberately cleaned before their parent records. The
 * live schema has evolved across deployments, so optional message-related
 * tables are discovered from information_schema instead of being assumed to
 * exist on every database.
 */
"use strict";

const { pool } = require("../config/db");

const OWNERSHIP_COLUMNS = [
  "user_id", "author_id", "actor_id", "sender_id", "sender_user_id",
  "account_id", "traveller_id", "requester_id", "liked_by",
  "commenter_id", "member_user_id",
];

const qi = (value) => '"' + String(value).replace(/"/g, '""') + '"';
const key = (value) => String(value);
const CORE_TABLES = new Set([
  "users", "messages", "conversations", "chat_messages", "chat_sessions",
]);

async function eraseUserData(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const user = await client.query(
      "SELECT id FROM users WHERE id::text = $1::text FOR UPDATE",
      [userId],
    );
    if (!user.rowCount) {
      await client.query("ROLLBACK");
      return { found: false, deletedRows: 0 };
    }

    const columnsResult = await client.query(`
      SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       ORDER BY c.table_name, c.ordinal_position
    `);
    const columnsByTable = new Map();
    for (const row of columnsResult.rows) {
      if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, new Set());
      columnsByTable.get(row.table_name).add(row.column_name);
    }
    const hasColumn = (table, column) => columnsByTable.get(table)?.has(column) === true;
    const tableExists = (table) => columnsByTable.has(table);
    const deletedCount = { rows: 0 };

    const deleteByValues = async (table, column, values) => {
      if (!tableExists(table) || !hasColumn(table, column) || !values?.length) return 0;
      const result = await client.query(
        `DELETE FROM ${qi("public")}.${qi(table)}
          WHERE ${qi(column)}::text = ANY($1::text[])`,
        [values.map(key)],
      );
      deletedCount.rows += result.rowCount || 0;
      return result.rowCount || 0;
    };

    const deleteByUser = async (table, column) => {
      if (!tableExists(table) || !hasColumn(table, column)) return 0;
      const result = await client.query(
        `DELETE FROM ${qi("public")}.${qi(table)}
          WHERE ${qi(column)}::text = $1::text`,
        [userId],
      );
      deletedCount.rows += result.rowCount || 0;
      return result.rowCount || 0;
    };

    // Get all chat/session/message identifiers while the transaction locks
    // the account, so dependent records can be removed before parent rows.
    // Only direct conversations are removed. Group conversations can be
    // owned by this user in older deployments, but must survive deletion.
    const conversationIds = tableExists("conversations") && hasColumn("conversations", "user_id")
      ? (await client.query(
          `SELECT id::text AS id FROM conversations
            WHERE user_id::text = $1::text
              ${hasColumn("conversations", "group_id") ? "AND group_id IS NULL" : ""}`,
          [userId],
        )).rows.map((row) => row.id)
      : [];

    const groupConversationIds = tableExists("conversations") && hasColumn("conversations", "group_id")
      ? (await client.query(
          `SELECT DISTINCT c.id::text AS id
             FROM conversations c
            WHERE c.group_id IS NOT NULL
              AND (
                ${hasColumn("conversations", "user_id") ? "c.user_id::text = $1::text OR" : ""}
                ${tableExists("message_group_members") && hasColumn("message_group_members", "user_id") && hasColumn("message_group_members", "group_id")
                  ? "EXISTS (SELECT 1 FROM message_group_members gm WHERE gm.group_id = c.group_id AND gm.user_id::text = $1::text)"
                  : "FALSE"}
              )`,
          [userId],
        )).rows.map((row) => row.id)
      : [];

    // Preserve group message bodies and history, but clear the deleted user's
    // identity so the UI can render the sender as unavailable.
    if (groupConversationIds.length && tableExists("messages") && hasColumn("messages", "sender_id")) {
      const sets = ["sender_id = NULL"];
      if (hasColumn("messages", "sender_name")) sets.push("sender_name = 'Deleted user'");
      if (hasColumn("messages", "sender_email")) sets.push("sender_email = NULL");
      if (hasColumn("messages", "sender_avatar")) sets.push("sender_avatar = NULL");
      if (hasColumn("messages", "metadata")) {
        sets.push("metadata = COALESCE(metadata, '{}'::jsonb) || '{\"senderDeleted\":true,\"senderUnavailable\":true}'::jsonb");
      }
      if (hasColumn("messages", "updated_at")) sets.push("updated_at = NOW()");
      await client.query(
        `UPDATE messages SET ${sets.join(", ")}
          WHERE sender_id::text = $1::text
            AND conversation_id::text = ANY($2::text[])`,
        [userId, groupConversationIds],
      );
    }

    const sessionIds = tableExists("chat_sessions") && hasColumn("chat_sessions", "user_id")
      ? (await client.query(
          "SELECT session_id FROM chat_sessions WHERE user_id::text = $1::text AND session_id IS NOT NULL",
          [userId],
        )).rows.map((row) => row.session_id).filter(Boolean)
      : [];

    const messageConditions = [];
    const messageParams = [];
    if (conversationIds.length && hasColumn("messages", "conversation_id")) {
      messageParams.push(conversationIds);
      messageConditions.push(`conversation_id::text = ANY($${messageParams.length}::text[])`);
    }
    if (hasColumn("messages", "sender_id")) {
      messageParams.push(userId);
      const senderClause = `sender_id::text = ${messageParams.length}::text`;
      messageConditions.push(groupConversationIds.length && hasColumn("messages", "conversation_id")
        ? `(${senderClause} AND NOT EXISTS (
             SELECT 1 FROM conversations preserved
              WHERE preserved.id = messages.conversation_id
                AND preserved.group_id IS NOT NULL
           ))`
        : senderClause);
    }
    const messageIds = tableExists("messages") && hasColumn("messages", "id") && messageConditions.length
      ? (await client.query(
          `SELECT id::text AS id FROM messages WHERE ${messageConditions.join(" OR ")}`,
          messageParams,
        )).rows.map((row) => row.id)
      : [];

    // Clear reply pointers first. Some deployed schemas have the self-FK on
    // reply_to_id; others were created by the idempotent bootstrap without it.
    if (messageIds.length && hasColumn("messages", "reply_to_id")) {
      await client.query(
        "UPDATE messages SET reply_to_id = NULL WHERE reply_to_id::text = ANY($1::text[])",
        [messageIds],
      );
    }

    // Delete child rows for messages/conversations before deleting the parent
    // rows. Only messaging-shaped tables and known linkage columns are used;
    // identifiers are discovered from the database and quoted as identifiers.
    const messagingTable = (table) => /message|chat|typing|conversation|receipt|reaction|attachment/i.test(table);
    for (const [table, columns] of columnsByTable) {
      if (CORE_TABLES.has(table) || !messagingTable(table)) continue;
      if (columns.has("message_id")) await deleteByValues(table, "message_id", messageIds);
      if (columns.has("reply_to_id")) await deleteByValues(table, "reply_to_id", messageIds);
      if (columns.has("conversation_id")) await deleteByValues(table, "conversation_id", conversationIds);
      if (columns.has("session_id") && table !== "conversations") {
        await deleteByValues(table, "session_id", sessionIds);
      }
    }

    // Remove the traveller's own messages even when they were sent inside a
    // shared/group conversation, then remove their chat-widget history.
    if (tableExists("messages")) {
      const conditions = [];
      const params = [];
      if (conversationIds.length && hasColumn("messages", "conversation_id")) {
        params.push(conversationIds);
        conditions.push(`conversation_id::text = ANY($${params.length}::text[])`);
      }
      if (hasColumn("messages", "sender_id")) {
        params.push(userId);
        const senderClause = `sender_id::text = ${params.length}::text`;
        conditions.push(groupConversationIds.length && hasColumn("messages", "conversation_id")
          ? `(${senderClause} AND NOT EXISTS (
               SELECT 1 FROM conversations preserved
                WHERE preserved.id = messages.conversation_id
                  AND preserved.group_id IS NOT NULL
             ))`
          : senderClause);
      }
      if (conditions.length) {
        const result = await client.query(
          `DELETE FROM ${qi("public")}.${qi("messages")} WHERE ${conditions.join(" OR ")}`,
          params,
        );
        deletedCount.rows += result.rowCount || 0;
      }
    }

    if (tableExists("chat_messages")) {
      await deleteByValues("chat_messages", "session_id", sessionIds);
      await deleteByUser("chat_messages", "sender_id");
    }
    await deleteByUser("chat_sessions", "user_id");

    // Generic per-user activity (likes, comments, bookings, notifications,
    // security factors, preferences, group membership, etc.). All names come
    // from PostgreSQL's schema catalog and are safely quoted.
    const schema = await client.query(`
      SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public'
         AND t.table_type = 'BASE TABLE'
         AND c.column_name = ANY($1::text[])
       ORDER BY c.table_name, c.ordinal_position
    `, [OWNERSHIP_COLUMNS]);

    const tableColumns = new Map();
    for (const row of schema.rows) {
      if (CORE_TABLES.has(row.table_name)) continue;
      if (!tableColumns.has(row.table_name)) tableColumns.set(row.table_name, new Set());
      tableColumns.get(row.table_name).add(row.column_name);
    }

    for (const [table, columns] of tableColumns) {
      const predicates = [...columns]
        .map((column) => `${qi(column)}::text = $1::text`)
        .join(" OR ");
      if (!predicates) continue;
      const result = await client.query(
        `DELETE FROM ${qi("public")}.${qi(table)} WHERE ${predicates}`,
        [userId],
      );
      deletedCount.rows += result.rowCount || 0;
    }

    // Some bootstrap versions omitted FK constraints on conversations, so
    // clear rows tied to those conversations explicitly before deleting them.
    if (conversationIds.length && tableExists("conversations")) {
      const result = await client.query(
        "DELETE FROM conversations WHERE id::text = ANY($1::text[])",
        [conversationIds],
      );
      deletedCount.rows += result.rowCount || 0;
    }

    // Null residual optional user links whose FK action is SET NULL.
    if (tableExists("conversations") && hasColumn("conversations", "user_id")) {
      await client.query(
        "UPDATE conversations SET user_id = NULL WHERE user_id::text = $1::text",
        [userId],
      );
    }
    if (tableExists("chat_sessions") && hasColumn("chat_sessions", "user_id")) {
      await client.query(
        "UPDATE chat_sessions SET user_id = NULL WHERE user_id::text = $1::text",
        [userId],
      );
    }

    await client.query("DELETE FROM users WHERE id::text = $1::text", [userId]);
    await client.query("COMMIT");
    return {
      found: true,
      deletedRows: deletedCount.rows,
      preservedGroupConversations: groupConversationIds.length,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { eraseUserData };
