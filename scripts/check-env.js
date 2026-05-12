#!/usr/bin/env node
/**
 * Verifies that all required environment variables are present.
 * Warns about optional-but-recommended ones.
 * Exits 1 if any required var is missing.
 */

"use strict";

require("dotenv").config({
  path: require("path").resolve(process.cwd(), ".env"),
});

const RESET  = "\x1b[0m";
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const BOLD   = "\x1b[1m";

// ── Variable definitions ──────────────────────────────────────────────────────

const REQUIRED = [
  { key: "JWT_SECRET",    hint: "Must be at least 32 chars, randomly generated" },
  { key: "DATABASE_URL",  hint: "PostgreSQL connection string" },
];

const RECOMMENDED = [
  { key: "NODE_ENV",       hint: "Set to 'production' in prod" },
  { key: "PORT",           hint: "Defaults to 3000 if not set" },
  { key: "FRONTEND_URL",   hint: "Your frontend origin for CORS" },
  { key: "BACKEND_URL",    hint: "Your backend public URL" },
  { key: "CORS_ORIGINS",   hint: "Comma-separated extra allowed origins" },
];

const OPTIONAL = [
  { key: "SMTP_HOST",        hint: "SMTP server hostname" },
  { key: "SMTP_PORT",        hint: "SMTP port (465 or 587)" },
  { key: "SMTP_USER",        hint: "SMTP username / from address" },
  { key: "SMTP_PASS",        hint: "SMTP password" },
  { key: "SMTP_FROM",        hint: "Default From address" },
  { key: "SENDGRID_API_KEY", hint: "SendGrid API key (overrides SMTP)" },
  { key: "CLOUDINARY_URL",   hint: "Cloudinary connection string" },
  { key: "ADMIN_EMAIL",      hint: "Admin notification email" },
  { key: "DB_SSL",           hint: "Set to 'false' for local dev without SSL" },
  { key: "DB_POOL_MAX",      hint: "Max pool connections (default: 30)" },
];

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${CYAN}${BOLD}╔══════════════════════════════════════════╗`);
console.log(`║   ALTUVERA — Environment Check           ║`);
console.log(`╚══════════════════════════════════════════╝${RESET}\n`);

const missing    = [];
const warnings   = [];

// ── Required ─────────────────────────────────────────────────────────────────
console.log(`${BOLD}Required:${RESET}`);

for (const { key, hint } of REQUIRED) {
  const val = process.env[key];
  if (!val) {
    missing.push({ key, hint });
    console.log(`  ${RED}✗ MISSING${RESET}  ${key}`);
    console.log(`           ${YELLOW}Hint: ${hint}${RESET}`);
  } else {
    // Mask sensitive values in output
    const display = val.length > 6
      ? `${val.slice(0, 3)}${"*".repeat(Math.min(val.length - 3, 12))}`
      : "***";
    console.log(`  ${GREEN}✓ SET${RESET}     ${key} = ${display}`);
  }
}

// Extra validation: JWT_SECRET length
const jwtSecret = process.env.JWT_SECRET || "";
if (jwtSecret && jwtSecret.length < 32) {
  warnings.push({
    key:  "JWT_SECRET",
    hint: `Too short (${jwtSecret.length} chars). Use at least 32 random chars.`,
  });
  console.log(`  ${YELLOW}⚠ SHORT${RESET}   JWT_SECRET is only ${jwtSecret.length} chars — use ≥32`);
}

// ── Recommended ───────────────────────────────────────────────────────────────
console.log(`\n${BOLD}Recommended:${RESET}`);

for (const { key, hint } of RECOMMENDED) {
  const val = process.env[key];
  if (!val) {
    warnings.push({ key, hint });
    console.log(`  ${YELLOW}⚠ MISSING${RESET}  ${key}`);
    console.log(`           ${YELLOW}Hint: ${hint}${RESET}`);
  } else {
    console.log(`  ${GREEN}✓ SET${RESET}     ${key} = ${val}`);
  }
}

// ── Optional ──────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}Optional:${RESET}`);

for (const { key, hint } of OPTIONAL) {
  const val = process.env[key];
  if (val) {
    const display = ["SMTP_PASS", "SENDGRID_API_KEY", "CLOUDINARY_URL"].includes(key)
      ? "***configured***"
      : val;
    console.log(`  ${GREEN}✓ SET${RESET}     ${key} = ${display}`);
  } else {
    console.log(`  ${YELLOW}-${RESET}         ${key}  ${YELLOW}(${hint})${RESET}`);
  }
}

// ── Result ────────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}─────────────────────────────────────────────${RESET}`);

if (missing.length > 0) {
  console.log(
    `\n${RED}${BOLD}✗ Build blocked — ${missing.length} required variable(s) missing:${RESET}`,
  );
  for (const { key, hint } of missing) {
    console.log(`  ${RED}${key}${RESET} — ${hint}`);
  }
  console.log(
    `\n${YELLOW}Add these to your .env file and re-run.${RESET}\n`,
  );
  process.exit(1);
}

if (warnings.length > 0) {
  console.log(
    `${YELLOW}⚠ ${warnings.length} warning(s) — review before deploying to production.${RESET}`,
  );
}

console.log(`\n${GREEN}${BOLD}Environment check passed ✓${RESET}\n`);
process.exit(0);