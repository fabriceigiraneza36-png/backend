"use strict";

const crypto = require("crypto");
const { Resend } = require("resend");
const emailOutbox = require("../utils/emailOutbox");
const logger = require("../utils/logger");

let resendClient = null;
const getResendClient = () => {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Resend API key is not configured");
  resendClient = new Resend(apiKey);
  return resendClient;
};

const DELIVERY_STATUS = Object.freeze({
  "email.sent": "accepted",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
});

const SUPPRESSION_REASON = Object.freeze({
  "email.bounced": "hard_bounce",
  "email.complained": "spam_complaint",
  "email.suppressed": "provider_suppressed",
});

async function handleResendWebhook(req, res) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({
      success: false,
      code: "RESEND_WEBHOOK_NOT_CONFIGURED",
      message: "Resend webhook verification is not configured",
    });
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (!rawBody) {
    return res.status(400).json({
      success: false,
      code: "WEBHOOK_RAW_BODY_REQUIRED",
    });
  }

  const id = req.get("svix-id");
  const timestamp = req.get("svix-timestamp");
  const signature = req.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return res.status(400).json({
      success: false,
      code: "WEBHOOK_SIGNATURE_HEADERS_REQUIRED",
    });
  }

  let event;
  try {
    event = getResendClient().webhooks.verify({
      payload: rawBody,
      headers: { id, timestamp, signature },
      webhookSecret: secret,
    });
  } catch (err) {
    logger.warn("[ResendWebhook] Signature verification rejected a request", {
      eventId: id,
      reason: String(err.message || "invalid signature").slice(0, 180),
    });
    return res.status(400).json({
      success: false,
      code: "INVALID_WEBHOOK_SIGNATURE",
    });
  }

  const eventType = String(event?.type || "");
  const data = event?.data || {};
  const deliveryStatus = DELIVERY_STATUS[eventType] || null;
  const suppressReason = SUPPRESSION_REASON[eventType] || null;

  // Only Resend email lifecycle events are processed here. Other webhook
  // families (contacts/domains) can be added deliberately without trusting them.
  if (!eventType.startsWith("email.")) {
    return res.status(200).json({ success: true, ignored: true });
  }

  try {
    const recipients = Array.isArray(data.to)
      ? data.to
      : data.to ? [data.to] : data.email ? [data.email] : [];
    const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");

    const result = await emailOutbox.recordProviderEvent({
      eventId: id,
      eventType,
      providerMessageId: data.email_id || null,
      recipients,
      eventCreatedAt: data.created_at || event.created_at || null,
      payloadHash,
      deliveryStatus,
      suppressReason,
    });

    if (!result.duplicate && !result.matchedOutboxRows && data.email_id) {
      logger.warn("[ResendWebhook] Event stored without a matching Altuvera outbox row", {
        eventId: id,
        eventType,
        providerMessageId: data.email_id,
      });
    }

    logger.info("[ResendWebhook] Verified provider event recorded", {
      eventId: id,
      eventType,
      duplicate: result.duplicate,
      matchedOutboxRows: result.matchedOutboxRows,
      suppressedRecipients: result.suppressedRecipients,
    });

    return res.status(200).json({
      success: true,
      duplicate: result.duplicate,
      deliveryStatus,
    });
  } catch (err) {
    // Return 5xx so Resend retries. The database insert is idempotent by svix-id.
    logger.error("[ResendWebhook] Verified event could not be persisted", {
      eventId: id,
      eventType,
      error: String(err.message || "database error").slice(0, 300),
    });
    return res.status(500).json({
      success: false,
      code: "WEBHOOK_PROCESSING_FAILED",
    });
  }
}

module.exports = handleResendWebhook;
