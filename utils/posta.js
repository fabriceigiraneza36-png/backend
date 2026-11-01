"use strict";

const logger = require("./logger");
const { isSafeProviderFailover } = require("./emailPolicy");

function parseBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("POSTA_BASE_URL is not configured");
  const parsed = new URL(raw);
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHost) {
    throw new Error("POSTA_BASE_URL must use HTTPS outside localhost");
  }
  return raw;
}

function makeProviderError(message, statusCode = null, responseBody = null) {
  const error = new Error(String(message || "Posta delivery failed").slice(0, 500));
  error.provider = "posta";
  error.statusCode = Number(statusCode) || null;
  error.definitiveRejected = Boolean(error.statusCode && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408);
  error.retryable = error.statusCode === 429;
  error.providerFailoverEligible = isSafeProviderFailover("posta", error.statusCode);
  // Posta's public send API does not document an idempotency-key contract.
  // A missing response or 5xx may mean the remote queue accepted the email.
  error.deliveryUnknown = error.statusCode === 408 || !error.definitiveRejected;
  error.idempotentRetrySafe = false;
  if (responseBody && typeof responseBody === "object") {
    error.providerErrorCode = String(responseBody.code || responseBody.error_code || "").slice(0, 100);
  }
  return error;
}

function createClient({
  baseUrl,
  apiKey,
  fetchImpl = global.fetch,
  timeoutMs = 15000,
} = {}) {
  const endpoint = parseBaseUrl(baseUrl);
  const credential = String(apiKey || "").trim();
  if (!credential) throw new Error("POSTA_API_KEY is not configured");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");

  return {
    async send({ to, subject, html, text, from, replyTo, cc, bcc }) {
      if (!to || !subject || (!html && !text)) {
        throw new Error("Posta send requires to, subject and html/text");
      }
      // Posta's documented single-email schema does not expose envelope CC/BCC.
      // Fail explicitly rather than silently dropping recipients or leaking BCC.
      if (cc || bcc) {
        const error = new Error("The Posta adapter does not support CC/BCC until its API contract is verified");
        error.code = "POSTA_UNSUPPORTED_RECIPIENT_FIELDS";
        error.definitiveRejected = true;
        error.deliveryUnknown = false;
        throw error;
      }

      const headers = {};
      if (replyTo) headers["Reply-To"] = String(replyTo);
      const payload = {
        from: String(from || "Altuvera Safaris <info@altuverasafaris.com>"),
        to: Array.isArray(to) ? to : [to],
        subject: String(subject),
        ...(html ? { html: String(html) } : {}),
        ...(text ? { text: String(text) } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 15000));
      let response;
      let body;
      try {
        response = await fetchImpl(endpoint + "/api/v1/emails/send", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + credential,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        body = await response.json().catch(() => null);
      } catch (cause) {
        const error = makeProviderError("Posta request outcome is unknown: " + String(cause && cause.message || "network error"));
        error.cause = cause;
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok || !body || body.success === false || !body.data?.id) {
        const statusCode = Number(response.status) || null;
        const message = body?.message || body?.error || body?.data?.message ||
          (response.ok ? "Posta returned no message ID" : "Posta HTTP " + response.status);
        throw makeProviderError(message, statusCode, body);
      }

      logger.info("[Posta] Message accepted into self-hosted queue", {
        messageId: String(body.data.id).slice(0, 120),
        status: String(body.data.status || "queued").slice(0, 32),
      });
      return {
        delivered: true,
        accepted: true,
        provider: "posta",
        messageId: String(body.data.id),
        providerStatus: String(body.data.status || "queued"),
      };
    },
  };
}

async function send(options) {
  const client = createClient({
    baseUrl: process.env.POSTA_BASE_URL,
    apiKey: process.env.POSTA_API_KEY,
  });
  return client.send(options);
}

module.exports = { send, createClient, makeProviderError };
