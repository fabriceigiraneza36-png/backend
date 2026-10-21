// utils/emailCampaignQueue.js
// Queues contextual email announcements and gives the admin panel a 10-second
// opportunity to retouch the campaign. If nobody is connected, the campaign is
// due immediately and the server worker sends it without waiting for an admin.
"use strict";

const { query } = require("../config/db");
const logger = require("./logger");
const campaignTemplates = require("./emailCampaignTemplates");

const TEMPLATE_BY_CONTEXT = {
  destination: "new_destination",
  new_destination: "new_destination",
  post: "new_post",
  new_post: "new_post",
  package: "new_package",
  new_package: "new_package",
  popular_destination: "top_rated_destination",
  top_rated_destination: "top_rated_destination",
  booking_encouragement: "booking_encouragement",
  travel_guide: "travel_guide",
};

let schemaReady = false;
let schemaPromise = null;

async function ensureQueueSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await campaignTemplates.ensureSchema();
    await query(`
      CREATE TABLE IF NOT EXISTS email_campaign_queue (
        id BIGSERIAL PRIMARY KEY,
        context TEXT NOT NULL DEFAULT 'general',
        template_key TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        template_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
        status VARCHAR(24) NOT NULL DEFAULT 'queued',
        scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sending_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        recipient_count INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_campaign_queue_due ON email_campaign_queue(status, scheduled_at)`);
    schemaReady = true;
  })().catch((err) => {
    schemaPromise = null;
    throw err;
  });
  return schemaPromise;
}

function isAdminOnline(io) {
  try {
    return Number(io?.sockets?.adapter?.rooms?.get("admin-room")?.size || 0) > 0;
  } catch {
    return false;
  }
}

function normaliseContextData(input = {}) {
  const data = {};
  const allowed = [
    "destinationName", "countryName", "postTitle", "packageName", "rating",
    "contentUrl", "bookingUrl", "heroImageUrl", "shortDescription", "slug",
    "countrySlug", "packageId", "destinationId", "postId", "ratingCount",
  ];
  for (const key of allowed) {
    const value = input[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      data[key] = typeof value === "string" ? value.trim().slice(0, 2000) : value;
    }
  }
  return data;
}

async function enqueueContextCampaign({ context, data = {}, io = null }) {
  await ensureQueueSchema();
  const resolvedContext = String(context || "general").trim().toLowerCase();
  const templateKey = TEMPLATE_BY_CONTEXT[resolvedContext] || "travel_guide";
  const contextData = normaliseContextData(data);
  const liveAdmin = isAdminOnline(io);
  const scheduledAt = new Date(Date.now() + (liveAdmin ? 10_000 : 0));
  const result = await query(
    `INSERT INTO email_campaign_queue
       (context, template_key, data, status, scheduled_at, created_at)
     VALUES ($1, $2, $3::jsonb, 'queued', $4, NOW())
     RETURNING id, context, template_key, data, status, scheduled_at, created_at`,
    [resolvedContext, templateKey, JSON.stringify(contextData), scheduledAt],
  );
  const row = result.rows[0];
  logger.info("[EmailCampaignQueue] queued " + row.id + " context=" + row.context + " adminOnline=" + liveAdmin);

  if (liveAdmin && io) {
    try {
      const templates = await campaignTemplates.listTemplates();
      const template = templates.find((item) => item.key === templateKey) || null;
      io.to("admin-room").emit("email-campaign:approval-needed", {
        id: Number(row.id),
        context: row.context,
        templateKey: row.template_key,
        contextData,
        template,
        scheduledAt: row.scheduled_at,
        countdownSeconds: 10,
        message: "A contextual email is ready. Retouch it within 10 seconds or let it send automatically.",
      });
    } catch (err) {
      logger.warn("[EmailCampaignQueue] admin preview event failed:", err.message);
    }
  }

  return row;
}

async function getPendingAdminCampaigns() {
  await ensureQueueSchema();
  const result = await query(
    `SELECT id, context, template_key, data, template_overrides, status, scheduled_at, created_at
       FROM email_campaign_queue
      WHERE status = 'queued'
        AND scheduled_at > NOW()
      ORDER BY scheduled_at ASC
      LIMIT 20`,
  );
  return result.rows;
}

module.exports = { ensureQueueSchema, enqueueContextCampaign, getPendingAdminCampaigns, isAdminOnline };
