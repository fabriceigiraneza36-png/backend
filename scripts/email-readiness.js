"use strict";

// Safe, non-sending diagnostic for the Altuvera email delivery stack.
// It prints booleans and provider names only; never prints secret values.
const env = process.env;
const providerSetting = String(env.EMAIL_PROVIDER || "auto").trim().toLowerCase();
const providers = {
  resend: Boolean(env.RESEND_API_KEY),
  sendgrid: Boolean(env.SENDGRID_API_KEY),
  smtp: Boolean(env.SMTP_USER && env.SMTP_PASS),
  posta: Boolean(env.POSTA_BASE_URL && env.POSTA_API_KEY),
};
const selectedProvider = providerSetting === "auto"
  ? (providers.resend ? "resend" : providers.sendgrid ? "sendgrid" : providers.smtp ? "smtp" : "none")
  : providerSetting;
const keyBytes = env.EMAIL_OUTBOX_ENCRYPTION_KEY
  ? Buffer.from(env.EMAIL_OUTBOX_ENCRYPTION_KEY, "base64").length
  : 0;
const checks = [
  ["provider setting is valid", ["auto", "resend", "sendgrid", "smtp", "posta"].includes(providerSetting)],
  ["selected provider is configured", Boolean(providers[selectedProvider])],
  ["encrypted outbox key is configured", Boolean(env.EMAIL_OUTBOX_ENCRYPTION_KEY)],
  ["encrypted outbox key is 32 bytes", keyBytes === 32],
  ["provider failover is disabled unless explicitly approved", env.EMAIL_FAILOVER_ENABLED !== "true"],
  ["Resend webhook signing secret is configured", Boolean(env.RESEND_WEBHOOK_SECRET)],
  ["business sender address is configured", /@altuverasafaris\.com$/i.test(env.EMAIL_FROM_ADDRESS || "info@altuverasafaris.com")],
];

console.log("Altuvera email readiness — no messages sent; secret values hidden");
console.log("Selected provider:", selectedProvider);
console.log("Configured transports:", Object.entries(providers).filter(([, configured]) => configured).map(([name]) => name).join(", ") || "none");
if (providers.posta && providerSetting === "auto") {
  console.log("INFO — Posta is configured as an opt-in candidate and is not selected automatically.");
}
for (const [label, passed] of checks) {
  console.log((passed ? "PASS" : "CHECK") + " — " + label);
}
if (env.EMAIL_FAILOVER_ENABLED === "true") {
  console.log("CHECK — cross-provider failover is enabled; verify provider idempotency and authentication before retaining it.");
}
if (selectedProvider === "none" || checks.some(([, passed]) => !passed)) {
  process.exitCode = 1;
}
