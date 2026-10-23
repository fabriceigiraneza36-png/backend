"use strict";

const { query } = require("../config/db");

let schemaPromise;
const ensureSchema = () => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS account_activity_logs (
          id BIGSERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          event_type VARCHAR(80) NOT NULL,
          title VARCHAR(180) NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          outcome VARCHAR(30) NOT NULL DEFAULT 'success',
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_account_activity_user_created
        ON account_activity_logs(user_id, created_at DESC)
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS account_activity_deletion_requests (
          id BIGSERIAL PRIMARY KEY,
          activity_id BIGINT NOT NULL,
          requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reason VARCHAR(500) NOT NULL DEFAULT '',
          status VARCHAR(20) NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','approved','rejected')),
          reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          reviewed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_activity_deletion_status
        ON account_activity_deletion_requests(status, created_at DESC)
      `);
      // Enforce one pending request per activity/requester even under concurrent requests.
      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_deletion_pending_requester
        ON account_activity_deletion_requests(activity_id, requester_id)
        WHERE status = 'pending'
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS account_activity_deletion_audit (
          id BIGSERIAL PRIMARY KEY,
          activity_id BIGINT NOT NULL,
          user_id INTEGER NOT NULL,
          event_type VARCHAR(80) NOT NULL,
          title VARCHAR(180) NOT NULL,
          activity_created_at TIMESTAMPTZ,
          requester_id INTEGER NOT NULL,
          reviewer_id INTEGER NOT NULL,
          reason VARCHAR(500) NOT NULL DEFAULT '',
          deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
};

const recordAccountActivity = async ({
  userId, eventType, title, description = "", outcome = "success", metadata = {},
}) => {
  if (!userId || !eventType || !title) return null;
  try {
    await ensureSchema();
    const result = await query(
      `INSERT INTO account_activity_logs
         (user_id, event_type, title, description, outcome, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       RETURNING id, user_id, event_type, title, description, outcome, metadata, created_at`,
      [
        userId,
        String(eventType).slice(0, 80),
        String(title).slice(0, 180),
        String(description).slice(0, 2000),
        String(outcome).slice(0, 30),
        JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
      ],
    );
    return result.rows[0] || null;
  } catch (error) {
    // Audit logging must not turn a successful sign-in or booking into a failure.
    console.error("[AccountActivity] Could not record event:", error.message);
    return null;
  }
};

module.exports = { ensureAccountActivitySchema: ensureSchema, recordAccountActivity };
