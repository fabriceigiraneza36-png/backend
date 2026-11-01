"use strict";

const crypto = require("crypto");
const { query, pool } = require("../config/db");
const logger = require("./logger");

let schemaPromise = null;
const DEFAULT_TTL_HOURS = 6;
const MAX_ATTEMPTS = 8;
const LEASE_SECONDS = 120;

function getEncryptionKey() {
  const raw = process.env.EMAIL_OUTBOX_ENCRYPTION_KEY || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("EMAIL_OUTBOX_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

function encryptPayload(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const plain = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptPayload(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted email payload");
  const iv = Buffer.from(parts[0], "base64url");
  const tag = Buffer.from(parts[1], "base64url");
  const encrypted = Buffer.from(parts[2], "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    // Fail closed: email bodies (including OTPs) are never persisted unencrypted.
    getEncryptionKey();
    await query(
      "CREATE TABLE IF NOT EXISTS email_outbox (" +
      "id UUID PRIMARY KEY, " +
      "idempotency_key VARCHAR(255) NOT NULL UNIQUE, " +
      "payload_hash CHAR(64) NOT NULL, " +
      "payload_ciphertext TEXT, " +
      "provider VARCHAR(24) NOT NULL, " +
      "status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','uncertain','expired')), " +
      "attempts INTEGER NOT NULL DEFAULT 0, " +
      "max_attempts INTEGER NOT NULL DEFAULT " + MAX_ATTEMPTS + ", " +
      "next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
      "expires_at TIMESTAMPTZ NOT NULL, " +
      "locked_until TIMESTAMPTZ, " +
      "provider_message_id TEXT, " +
      "last_error TEXT, " +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
      "sent_at TIMESTAMPTZ, " +
      "delivery_status VARCHAR(24) NOT NULL DEFAULT 'accepted', " +
      "delivery_event_at TIMESTAMPTZ)"
    );
    await query("ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(24) NOT NULL DEFAULT 'accepted'");
    await query("ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS delivery_event_at TIMESTAMPTZ");
    await query("CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox(status, next_attempt_at)");
    await query(
      "CREATE TABLE IF NOT EXISTS email_provider_events (" +
      "event_id VARCHAR(255) PRIMARY KEY, provider VARCHAR(24) NOT NULL, " +
      "event_type VARCHAR(64) NOT NULL, provider_message_id TEXT, " +
      "recipient_email TEXT, event_created_at TIMESTAMPTZ, payload_hash CHAR(64) NOT NULL, " +
      "received_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
    );
    await query(
      "CREATE INDEX IF NOT EXISTS idx_email_provider_events_message ON email_provider_events(provider, provider_message_id)"
    );
    await query(
      "CREATE TABLE IF NOT EXISTS email_suppressions (" +
      "email TEXT PRIMARY KEY, reason VARCHAR(40) NOT NULL, provider VARCHAR(24) NOT NULL, " +
      "provider_event_id VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
    );
    await query("CREATE INDEX IF NOT EXISTS idx_email_outbox_expiry ON email_outbox(status, expires_at)");
    await query("CREATE INDEX IF NOT EXISTS idx_email_outbox_provider_message ON email_outbox(provider, provider_message_id)");
  })().catch((err) => {
    schemaPromise = null;
    throw err;
  });
  return schemaPromise;
}

function retryDelayMs(attempt) {
  const base = Math.min(5 * Math.pow(2, Math.max(0, attempt - 1)), 300);
  const jitter = Math.floor(Math.random() * 4);
  return (base + jitter) * 1000;
}

async function claimJob(id) {
  const result = await query(
    "UPDATE email_outbox " +
    "SET status = 'sending', attempts = attempts + 1, " +
    "locked_until = NOW() + ($2 * INTERVAL '1 second'), updated_at = NOW() " +
    "WHERE id = $1 AND status = 'queued' AND next_attempt_at <= NOW() AND expires_at > NOW() " +
    "RETURNING id, idempotency_key, payload_ciphertext, provider, attempts, max_attempts, expires_at",
    [id, LEASE_SECONDS],
  );
  return result.rows && result.rows[0] ? result.rows[0] : null;
}

async function getJob(id) {
  const result = await query(
    "SELECT id, status, provider, provider_message_id, attempts, last_error FROM email_outbox WHERE id = $1 LIMIT 1",
    [id],
  );
  return result.rows && result.rows[0] ? result.rows[0] : null;
}

async function attemptJob(id, deliver) {
  const job = await claimJob(id);
  if (!job) {
    const current = await getJob(id);
    return current ? { status: current.status, job: current } : { status: "missing" };
  }

  let payload;
  try {
    payload = decryptPayload(job.payload_ciphertext);
  } catch (err) {
    await query(
      "UPDATE email_outbox SET status = 'failed', payload_ciphertext = NULL, locked_until = NULL, " +
      "last_error = $2, updated_at = NOW() WHERE id = $1",
      [id, "Email payload decryption failed: " + err.message],
    );
    return { status: "failed" };
  }

  try {
    const result = await deliver(payload, { idempotencyKey: job.idempotency_key, provider: job.provider });
    await query(
      "UPDATE email_outbox SET status = 'sent', payload_ciphertext = NULL, locked_until = NULL, " +
      "provider = COALESCE($2, provider), provider_message_id = $3, last_error = NULL, " +
      "sent_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id, result && result.provider ? result.provider : job.provider, result && result.messageId ? result.messageId : null],
    );
    logger.info("[EmailOutbox] Provider accepted email", { outboxId: id, provider: result && result.provider ? result.provider : job.provider });
    return { status: "sent", result };
  } catch (err) {
    const attempt = Number(job.attempts || 1);
    const retrySafe = err && err.retryable === true &&
      (err.idempotentRetrySafe === true || err.definitiveRejected === true);
    const canRetry = retrySafe &&
      attempt < Number(job.max_attempts || MAX_ATTEMPTS) &&
      Date.now() < new Date(job.expires_at).getTime();

    if (canRetry) {
      const delayMs = retryDelayMs(attempt);
      await query(
        "UPDATE email_outbox SET status = 'queued', locked_until = NULL, " +
        "next_attempt_at = NOW() + ($2 * INTERVAL '1 millisecond'), last_error = $3, updated_at = NOW() " +
        "WHERE id = $1",
        [id, delayMs, String(err.message || "Temporary email delivery failure").slice(0, 1500)],
      );
      logger.warn("[EmailOutbox] Email queued for safe retry", { outboxId: id, provider: job.provider, attempt, retryInMs: delayMs });
      return { status: "queued" };
    }

    const status = err && err.deliveryUnknown === true ? "uncertain" : "failed";
    await query(
      "UPDATE email_outbox SET status = $2, payload_ciphertext = NULL, locked_until = NULL, " +
      "last_error = $3, updated_at = NOW() WHERE id = $1",
      [id, status, String(err && err.message ? err.message : "Email delivery failed").slice(0, 1500)],
    );
    logger.error("[EmailOutbox] Email delivery stopped", {
      outboxId: id, provider: job.provider, status,
      error: String(err && err.message ? err.message : "Unknown error").slice(0, 500),
    });
    return { status };
  }
}

async function enqueueAndDeliver({ payload, idempotencyKey, provider, deliver, ttlSeconds }) {
  await ensureSchema();
  await assertNotSuppressed([payload?.to, payload?.cc, payload?.bcc]);
  if (typeof deliver !== "function") throw new TypeError("Email delivery adapter is required");
  const key = String(idempotencyKey || crypto.randomUUID()).slice(0, 255);
  const serialized = JSON.stringify(payload);
  const payloadHash = crypto.createHash("sha256").update(serialized).digest("hex");
  const ciphertext = encryptPayload(payload);
  const ttl = Math.max(60, Number(ttlSeconds) || DEFAULT_TTL_HOURS * 3600);
  const id = crypto.randomUUID();

  await query(
    "INSERT INTO email_outbox " +
    "(id, idempotency_key, payload_hash, payload_ciphertext, provider, status, next_attempt_at, expires_at, created_at, updated_at) " +
    "VALUES ($1,$2,$3,$4,$5,'queued',NOW(),NOW() + ($6 * INTERVAL '1 second'),NOW(),NOW()) " +
    "ON CONFLICT (idempotency_key) DO NOTHING",
    [id, key, payloadHash, ciphertext, provider, ttl],
  );

  const existingResult = await query(
    "SELECT id, payload_hash, status, provider, provider_message_id FROM email_outbox WHERE idempotency_key = $1 LIMIT 1",
    [key],
  );
  const existing = existingResult.rows && existingResult.rows[0];
  if (!existing) throw new Error("Email outbox insert could not be verified");
  if (existing.payload_hash !== payloadHash) {
    throw new Error("Email idempotency key was reused with a different message payload");
  }

  if (existing.status === "sent") {
    return {
      success: true, deduplicated: true, provider: existing.provider,
      messageId: existing.provider_message_id, outboxId: existing.id,
    };
  }
  if (existing.status === "uncertain") {
    const error = new Error("Email delivery outcome is uncertain; automatic resend is paused to prevent duplicates");
    error.deliveryUnknown = true;
    error.outboxId = existing.id;
    throw error;
  }
  if (existing.status === "failed" || existing.status === "expired") {
    throw new Error("Email outbox job is " + existing.status + "; create a new message with a new idempotency key");
  }

  const attempt = await attemptJob(existing.id, deliver);
  if (attempt.status === "sent") {
    return {
      success: true,
      provider: attempt.result && attempt.result.provider ? attempt.result.provider : existing.provider,
      messageId: attempt.result && attempt.result.messageId ? attempt.result.messageId : undefined,
      outboxId: existing.id,
    };
  }
  if (attempt.status === "queued" || attempt.status === "sending") {
    return { success: true, queued: true, provider: existing.provider, outboxId: existing.id };
  }
  if (attempt.status === "uncertain") {
    const error = new Error("Email delivery outcome is uncertain; it has been paused to prevent duplicates");
    error.deliveryUnknown = true;
    error.outboxId = existing.id;
    throw error;
  }
  throw new Error("Email could not be delivered; outbox status: " + attempt.status);
}

async function processDueEmails(deliver, limit = 10) {
  await ensureSchema();

  // Reclaim only stale Resend jobs: the same idempotency key makes a retry safe
  // within Resend's documented 24-hour idempotency window.
  await query(
    "UPDATE email_outbox SET status = CASE " +
    "WHEN provider = 'resend' AND expires_at > NOW() AND created_at > NOW() - INTERVAL '23 hours' THEN 'queued' ELSE 'uncertain' END, " +
    "next_attempt_at = NOW(), locked_until = NULL, " +
    "last_error = 'Worker lease expired before completion; outcome reconciled conservatively', updated_at = NOW() " +
    "WHERE status = 'sending' AND locked_until < NOW()",
  );

  const result = await query(
    "SELECT id FROM email_outbox WHERE status = 'queued' AND next_attempt_at <= NOW() AND expires_at > NOW() " +
    "ORDER BY created_at ASC LIMIT $1",
    [Math.max(1, Math.min(Number(limit) || 10, 50))],
  );

  let sent = 0;
  let queued = 0;
  let stopped = 0;
  for (const row of result.rows || []) {
    const outcome = await attemptJob(row.id, deliver);
    if (outcome.status === "sent") sent += 1;
    else if (outcome.status === "queued" || outcome.status === "sending") queued += 1;
    else stopped += 1;
  }

  const expired = await query(
    "UPDATE email_outbox SET status = 'expired', payload_ciphertext = NULL, " +
    "last_error = 'Email expired before delivery', locked_until = NULL, updated_at = NOW() " +
    "WHERE status = 'queued' AND expires_at <= NOW()",
  );

  return { processed: (result.rows || []).length, sent, queued, stopped, expired: expired.rowCount || 0 };
}


function normalizeRecipient(value) {
  const raw = String(value || "").trim();
  const angle = raw.match(/<([^<>]+)>/);
  const email = (angle ? angle[1] : raw).trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}

async function assertNotSuppressed(recipients) {
  await ensureSchema();
  const input = Array.isArray(recipients) ? recipients : [recipients];
  const addresses = [...new Set(input.flatMap((item) => {
    if (Array.isArray(item)) return item.map(normalizeRecipient).filter(Boolean);
    return [normalizeRecipient(item)].filter(Boolean);
  }))];
  if (!addresses.length) return;
  const result = await query(
    "SELECT email, reason FROM email_suppressions WHERE email = ANY($1::text[]) LIMIT 1",
    [addresses],
  );
  if (result.rows && result.rows.length) {
    const error = new Error("Email recipient is suppressed due to a previous bounce or complaint");
    error.code = "EMAIL_RECIPIENT_SUPPRESSED";
    error.statusCode = 422;
    error.definitiveRejected = true;
    error.retryable = false;
    throw error;
  }
}

async function recordProviderEvent({
  eventId, eventType, providerMessageId = null, recipients = [],
  eventCreatedAt = null, payloadHash, deliveryStatus = null, suppressReason = null,
}) {
  await ensureSchema();
  if (!eventId || !eventType || !payloadHash) throw new Error("Provider event metadata is incomplete");

  const normalizedRecipients = [...new Set(
    (Array.isArray(recipients) ? recipients : [recipients])
      .map(normalizeRecipient).filter(Boolean)
  )];
  const eventAt = eventCreatedAt && !Number.isNaN(Date.parse(eventCreatedAt))
    ? new Date(eventCreatedAt).toISOString()
    : new Date().toISOString();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      "INSERT INTO email_provider_events " +
      "(event_id, provider, event_type, provider_message_id, recipient_email, event_created_at, payload_hash) " +
      "VALUES ($1, 'resend', $2, $3, $4, $5, $6) ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
      [String(eventId), String(eventType), providerMessageId, normalizedRecipients[0] || null, eventAt, payloadHash],
    );
    if (!inserted.rowCount) {
      await client.query("COMMIT");
      return { duplicate: true, matchedOutboxRows: 0, suppressedRecipients: 0 };
    }

    let matchedOutboxRows = 0;
    if (providerMessageId && deliveryStatus) {
      const updated = await client.query(
        "UPDATE email_outbox SET delivery_status = $2, delivery_event_at = $3, updated_at = NOW() " +
        "WHERE provider = 'resend' AND provider_message_id = $1 " +
        "AND (delivery_event_at IS NULL OR delivery_event_at <= $3)",
        [String(providerMessageId), String(deliveryStatus), eventAt],
      );
      matchedOutboxRows = updated.rowCount || 0;
    }

    let suppressedRecipients = 0;
    if (suppressReason && normalizedRecipients.length) {
      for (const address of normalizedRecipients) {
        const suppression = await client.query(
          "INSERT INTO email_suppressions (email, reason, provider, provider_event_id) " +
          "VALUES ($1, $2, 'resend', $3) " +
          "ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason, provider = EXCLUDED.provider, " +
          "provider_event_id = EXCLUDED.provider_event_id, updated_at = NOW() RETURNING email",
          [address, String(suppressReason), String(eventId)],
        );
        if (suppression.rowCount) suppressedRecipients += 1;
      }
    }

    await client.query("COMMIT");
    return { duplicate: false, matchedOutboxRows, suppressedRecipients };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  ensureSchema,
  enqueueAndDeliver,
  processDueEmails,
  assertNotSuppressed,
  recordProviderEvent,
};
