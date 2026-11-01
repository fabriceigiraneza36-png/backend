"use strict";

// Conservative provider failover policy. Only responses that prove the first
// provider did not accept the request may be eligible for cross-provider retry.
const HTTP_TEMPORARY_REJECTIONS = new Set([429]);
const SMTP_TEMPORARY_REJECTIONS = new Set([421, 450, 451, 452, 454]);

function isSafeProviderFailover(provider, statusCode) {
  const status = Number(statusCode || 0);
  if (!Number.isInteger(status)) return false;
  if (provider === "smtp") return SMTP_TEMPORARY_REJECTIONS.has(status);
  if (provider === "resend" || provider === "sendgrid") {
    return HTTP_TEMPORARY_REJECTIONS.has(status);
  }
  return false;
}

module.exports = { isSafeProviderFailover };
