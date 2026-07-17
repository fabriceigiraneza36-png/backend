/**
 * controllers/emailBroadcastController.js
 * ═══════════════════════════════════════════════════════════════════════════════
 * Admin global email broadcast with audience targeting.
 *
 * Audiences:
 *   - all          → every deliverable address (users + active subscribers)
 *   - subscribers  → active newsletter subscribers only
 *   - bookers      → anyone with at least one booking
 *   - nationality  → users/bookers whose nationality matches (requires `nationality`)
 *
 * Endpoints (see routes/emailBroadcast.js):
 *   GET  /api/email-broadcast/nationalities  → distinct nationalities + counts
 *   POST /api/email-broadcast/preview        → recipient count for an audience
 *   POST /api/email-broadcast/send           → send the broadcast
 * ═══════════════════════════════════════════════════════════════════════════════
 */

"use strict";

const { query } = require("../config/db");
const logger = require("../utils/logger");

/* ── Safe require: email sender ─────────────────────────────────────────────── */
let _sendEmail = null;
const EMAIL_PATHS = [
  "../utils/emailService",
  "../services/emailService",
  "../utils/email",
  "../services/email",
];
for (const p of EMAIL_PATHS) {
  try {
    const mod = require(p);
    _sendEmail = mod.sendEmail || mod.default || null;
    if (_sendEmail) {
      logger.info(`[EmailBroadcast] Email service loaded from: ${p}`);
      break;
    }
  } catch {
    /* try next */
  }
}
if (!_sendEmail) {
  logger.warn("[EmailBroadcast] No email service found — broadcasts will be skipped");
  _sendEmail = async () => ({ success: false, error: "Email service not configured" });
}

/**
 * Normalise the varied return shapes of our senders into { success, error }.
 * utils/emailService.sendEmail => positional (to, subject, html)
 * others may accept an object; we always call positionally which utils supports.
 */
const sendOne = async (to, subject, html) => {
  try {
    const res = await _sendEmail(to, subject, html);
    if (res && res.success === false) {
      return { success: false, error: res.error || "Send failed" };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

/* ── Constants ──────────────────────────────────────────────────────────────── */
const AUDIENCES = new Set(["all", "subscribers", "bookers", "nationality"]);
const MAX_SUBJECT = 200;

const FRONTEND_URL = (
  process.env.FRONTEND_URL || "https://www.altuverasafaris.com"
).replace(/\/+$/, "");

const APP_NAME = process.env.APP_NAME || "Altuvera Safaris";

/* ── Helpers ────────────────────────────────────────────────────────────────── */
const isValidEmail = (e) =>
  typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

const escapeHtml = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

/**
 * Wrap admin content in a branded shell if the caller did not supply full HTML.
 */
const buildHtml = ({ subject, body, rawHtml }) => {
  if (rawHtml && String(rawHtml).trim()) return String(rawHtml);

  const safeBody = escapeHtml(String(body || "")).replace(/\n/g, "<br/>");
  const cleanSubject = escapeHtml(subject);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f0fdf4;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(5,150,105,.08);">
        <tr><td style="background:linear-gradient(135deg,#059669,#047857);padding:28px 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">🌍 ${escapeHtml(APP_NAME)}</h1>
        </td></tr>
        <tr><td style="padding:40px;">
          <h2 style="margin:0 0 18px;color:#022c22;font-size:22px;font-weight:600;">${cleanSubject}</h2>
          <div style="color:#334155;font-size:15px;line-height:1.7;">${safeBody}</div>
        </td></tr>
        <tr><td style="background:#f0fdf4;padding:20px 40px;text-align:center;border-top:1px solid #d1fae5;">
          <p style="margin:0;color:#059669;font-size:12px;font-weight:600;">${escapeHtml(APP_NAME)} · East Africa</p>
          <p style="margin:6px 0 0;color:#94a3b8;font-size:11px;">
            You are receiving this email from ${escapeHtml(APP_NAME)}.
            <a href="${FRONTEND_URL}/unsubscribe" style="color:#059669;">Unsubscribe</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
};

/**
 * Build the recipient query for a given audience.
 * Returns { sql, params } selecting DISTINCT lower(email) AS email, name.
 * Names are best-effort for personalisation.
 */
const buildRecipientQuery = (audience, nationality) => {
  switch (audience) {
    case "subscribers":
      return {
        sql: `
          SELECT LOWER(email) AS email, name
            FROM subscribers
           WHERE is_active = true
             AND email IS NOT NULL`,
        params: [],
      };

    case "bookers":
      return {
        sql: `
          SELECT DISTINCT ON (LOWER(email)) LOWER(email) AS email, full_name AS name
            FROM bookings
           WHERE email IS NOT NULL
             AND email <> ''`,
        params: [],
      };

    case "nationality":
      return {
        sql: `
          SELECT LOWER(email) AS email, name FROM (
            SELECT email, full_name AS name, nationality FROM bookings
             WHERE email IS NOT NULL AND email <> ''
            UNION ALL
            SELECT email, full_name AS name, nationality FROM users
             WHERE email IS NOT NULL AND email <> ''
          ) t
           WHERE t.nationality IS NOT NULL
             AND LOWER(TRIM(t.nationality)) = LOWER(TRIM($1))`,
        params: [nationality],
      };

    case "all":
    default:
      return {
        sql: `
          SELECT LOWER(email) AS email, name FROM (
            SELECT email, full_name AS name FROM users
             WHERE email IS NOT NULL AND email <> ''
               AND COALESCE(is_active, true) = true
            UNION ALL
            SELECT email, name FROM subscribers
             WHERE is_active = true AND email IS NOT NULL AND email <> ''
            UNION ALL
            SELECT email, full_name AS name FROM bookings
             WHERE email IS NOT NULL AND email <> ''
          ) t`,
        params: [],
      };
  }
};

/**
 * Resolve a de-duplicated, valid recipient list for an audience.
 */
const resolveRecipients = async (audience, nationality) => {
  const { sql, params } = buildRecipientQuery(audience, nationality);
  const { rows } = await query(sql, params);

  const seen = new Map();
  for (const r of rows) {
    const email = (r.email || "").trim().toLowerCase();
    if (!isValidEmail(email)) continue;
    if (!seen.has(email)) {
      seen.set(email, { email, name: r.name || null });
    } else if (!seen.get(email).name && r.name) {
      seen.get(email).name = r.name;
    }
  }
  return [...seen.values()];
};

/* ═══════════════════════════════════════════════════════════════════════════════
   GET /api/email-broadcast/nationalities
═══════════════════════════════════════════════════════════════════════════════ */
exports.getNationalities = async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT TRIM(nationality) AS nationality, COUNT(*)::INTEGER AS count
        FROM (
          SELECT nationality FROM bookings
           WHERE nationality IS NOT NULL AND TRIM(nationality) <> ''
          UNION ALL
          SELECT nationality FROM users
           WHERE nationality IS NOT NULL AND TRIM(nationality) <> ''
        ) t
       GROUP BY TRIM(nationality)
       ORDER BY count DESC, nationality ASC
    `);

    return res.json({ success: true, data: rows });
  } catch (err) {
    logger.error("[EmailBroadcast] getNationalities:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   POST /api/email-broadcast/preview
   Body: { audience, nationality? } → { count }
═══════════════════════════════════════════════════════════════════════════════ */
exports.preview = async (req, res, next) => {
  try {
    const audience = String(req.body?.audience || "all").toLowerCase();
    const nationality = req.body?.nationality;

    if (!AUDIENCES.has(audience)) {
      return res.status(400).json({ success: false, error: "Invalid audience" });
    }
    if (audience === "nationality" && !String(nationality || "").trim()) {
      return res.status(400).json({ success: false, error: "Nationality is required" });
    }

    const recipients = await resolveRecipients(audience, nationality);
    return res.json({ success: true, count: recipients.length, audience });
  } catch (err) {
    logger.error("[EmailBroadcast] preview:", err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   POST /api/email-broadcast/send
   Body: { audience, nationality?, subject, body, html? }
═══════════════════════════════════════════════════════════════════════════════ */
exports.send = async (req, res, next) => {
  try {
    const audience = String(req.body?.audience || "all").toLowerCase();
    const nationality = req.body?.nationality;
    const subject = String(req.body?.subject || "").trim();
    const body = String(req.body?.body || "").trim();
    const rawHtml = req.body?.html;

    if (!AUDIENCES.has(audience)) {
      return res.status(400).json({ success: false, error: "Invalid audience" });
    }
    if (!subject) {
      return res.status(422).json({ success: false, error: "Subject is required." });
    }
    if (subject.length > MAX_SUBJECT) {
      return res.status(422).json({ success: false, error: "Subject is too long." });
    }
    if (!body && !(rawHtml && String(rawHtml).trim())) {
      return res.status(422).json({ success: false, error: "Message body is required." });
    }
    if (audience === "nationality" && !String(nationality || "").trim()) {
      return res.status(422).json({ success: false, error: "Nationality is required." });
    }

    const recipients = await resolveRecipients(audience, nationality);

    if (!recipients.length) {
      return res.json({
        success: true,
        message: "No recipients matched this audience.",
        sent: 0,
        failed: 0,
        total: 0,
        audience,
      });
    }

    const html = buildHtml({ subject, body, rawHtml });

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const r of recipients) {
      const result = await sendOne(r.email, subject, html);
      if (result.success) {
        sent += 1;
      } else {
        failed += 1;
        if (errors.length < 5) errors.push({ email: r.email, error: result.error });
      }
      // Gentle throttle for large batches to respect SMTP rate limits
      if (recipients.length > 10) {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }

    logger.info(
      `[EmailBroadcast] audience=${audience}${
        audience === "nationality" ? `(${nationality})` : ""
      } → ${sent} sent, ${failed} failed of ${recipients.length}`,
    );

    return res.json({
      success: true,
      message: `Broadcast sent to ${sent} recipient(s).`,
      sent,
      failed,
      total: recipients.length,
      audience,
      errors: failed ? errors : undefined,
    });
  } catch (err) {
    logger.error("[EmailBroadcast] send:", err.message);
    next(err);
  }
};
