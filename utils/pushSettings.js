"use strict";

const { query } = require("../config/db");

const SETTING_KEY = "user_browser_push_enabled";
let schemaPromise = null;

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS notification_delivery_settings (
          setting_key VARCHAR(100) PRIMARY KEY,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          updated_by INTEGER,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query(
        `INSERT INTO notification_delivery_settings (setting_key, enabled)
         VALUES ($1, TRUE)
         ON CONFLICT (setting_key) DO NOTHING`,
        [SETTING_KEY],
      );
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function getUserBrowserPushEnabled() {
  await ensureSchema();
  const { rows } = await query(
    "SELECT enabled FROM notification_delivery_settings WHERE setting_key = $1 LIMIT 1",
    [SETTING_KEY],
  );
  return rows[0] ? Boolean(rows[0].enabled) : true;
}

async function setUserBrowserPushEnabled(enabled, adminId = null) {
  await ensureSchema();
  const { rows } = await query(
    `INSERT INTO notification_delivery_settings (setting_key, enabled, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (setting_key) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING enabled, updated_by, updated_at`,
    [SETTING_KEY, Boolean(enabled), adminId],
  );
  return rows[0];
}

module.exports = { ensureSchema, getUserBrowserPushEnabled, setUserBrowserPushEnabled };
