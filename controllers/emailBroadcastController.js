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
const campaignTemplates = require("../utils/emailCampaignTemplates");
const campaignQueue = require("../utils/emailCampaignQueue");
const { notifyAdminsImmediately } = require("./notificationsController");

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
             AND email <> ''
             AND COALESCE(newsletter_opt_in, false) = true
           ORDER BY LOWER(email), created_at DESC`,
        params: [],
      };

    case "nationality":
      return {
        sql: `
          SELECT LOWER(email) AS email, name FROM (
            SELECT email, full_name AS name, nationality FROM bookings
             WHERE email IS NOT NULL AND email <> ''
               AND COALESCE(newsletter_opt_in, false) = true
            UNION ALL
            SELECT email, full_name AS name, nationality FROM users
             WHERE email IS NOT NULL AND email <> ''
               AND COALESCE(subscribed, false) = true
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
               AND COALESCE(subscribed, false) = true
            UNION ALL
            SELECT email, name FROM subscribers
             WHERE is_active = true AND email IS NOT NULL AND email <> ''
            UNION ALL
            SELECT email, full_name AS name FROM bookings
             WHERE email IS NOT NULL AND email <> ''
               AND COALESCE(newsletter_opt_in, false) = true
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

/**
 * Add current content context to manual campaigns where admin left fields blank.
 * The email remains editable in Email Studio; this simply makes the defaults useful.
 */
const enrichCampaignContext = async (context, input = {}) => {
  const data = { ...(input || {}) };
  const frontendUrl = FRONTEND_URL;
  // The editor sends its current CTA field in contextData for convenience.
  // Template placeholders are not real destinations; let contextual lookup fill them.
  for (const key of ["contentUrl", "bookingUrl"]) {
    if (typeof data[key] === "string" && /\\{\\{\\s*[a-zA-Z]+\\s*\\}\\}/.test(data[key])) delete data[key];
  }
  try {
    if (["top_rated_destination", "booking_encouragement", "new_destination"].includes(context) && !data.destinationName) {
      const { rows } = await query(
        `SELECT id, name, slug, image_url, hero_image, thumbnail_url, short_description,
                rating, review_count
           FROM destinations
          WHERE status = 'published' AND COALESCE(is_active, true) = true
          ORDER BY COALESCE(rating, 0) DESC, COALESCE(review_count, 0) DESC, published_at DESC NULLS LAST
          LIMIT 1`
      );
      const destination = rows[0];
      if (destination) {
        data.destinationName = destination.name;
        data.slug = destination.slug;
        data.shortDescription = destination.short_description || data.shortDescription || "";
        data.heroImageUrl = data.heroImageUrl || destination.hero_image || destination.image_url || destination.thumbnail_url || "";
        data.rating = destination.rating || data.rating || "";
        data.contentUrl = data.contentUrl || frontendUrl + "/destinations/" + encodeURIComponent(destination.slug || destination.id);
        if (context === "booking_encouragement") {
          const genericBookingUrl = frontendUrl + "/booking";
          if (!data.bookingUrl || String(data.bookingUrl).replace(/\/+$/, "") === genericBookingUrl) {
            data.bookingUrl = genericBookingUrl + "?destination=" + encodeURIComponent(destination.slug || destination.id);
          }
        }
      }
    }

    if (["new_post"].includes(context) && !data.postTitle) {
      const { rows } = await query(
        `SELECT id, title, slug, image_url, excerpt
           FROM posts
          WHERE is_published = true
          ORDER BY published_at DESC NULLS LAST, created_at DESC
          LIMIT 1`
      );
      const post = rows[0];
      if (post) {
        data.postTitle = post.title;
        data.slug = post.slug;
        data.shortDescription = post.excerpt || data.shortDescription || "";
        data.heroImageUrl = data.heroImageUrl || post.image_url || "";
        data.contentUrl = data.contentUrl || frontendUrl + "/post/" + encodeURIComponent(post.slug || post.id);
      }
    }

    if (["new_package"].includes(context) && !data.packageName) {
      const { rows } = await query(
        `SELECT id, title, slug, cover_image_url
           FROM packages
          WHERE is_published = true
          ORDER BY created_at DESC
          LIMIT 1`
      );
      const pkg = rows[0];
      if (pkg) {
        data.packageName = pkg.title;
        data.slug = pkg.slug;
        data.heroImageUrl = data.heroImageUrl || pkg.cover_image_url || "";
        data.contentUrl = data.contentUrl || frontendUrl + "/packages/" + encodeURIComponent(pkg.slug || pkg.id);
      }
    }
  } catch (err) {
    // A campaign must still be sendable if an optional content lookup fails.
    logger.warn("[EmailBroadcast] Context enrichment skipped for " + context + ":", err.message);
  }
  return data;
};

/* ── Reusable campaign templates and send history ─────────────────────────── */
exports.getTemplates = async (_req, res, next) => {
  try {
    return res.json({ success: true, data: await campaignTemplates.listTemplates() });
  } catch (err) {
    logger.error("[EmailBroadcast] getTemplates:", err.message);
    next(err);
  }
};

exports.saveTemplate = async (req, res, next) => {
  try {
    const data = await campaignTemplates.saveTemplate(req.body, req.user?.id);
    return res.json({ success: true, data, message: "Email template saved for reuse." });
  } catch (err) {
    logger.error("[EmailBroadcast] saveTemplate:", err.message);
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    next(err);
  }
};

exports.getHistory = async (_req, res, next) => {
  try {
    return res.json({ success: true, data: await campaignTemplates.getHistory() });
  } catch (err) {
    logger.error("[EmailBroadcast] getHistory:", err.message);
    next(err);
  }
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
    await campaignTemplates.ensureSchema();
    const audience = String(req.body?.audience || "all").toLowerCase();
    const nationality = req.body?.nationality;
    const templateKey = String(req.body?.templateKey || req.body?.template?.key || "").trim();
    const providedTemplate = req.body?.template && typeof req.body.template === "object" ? req.body.template : {};
    let storedTemplate = {};
    if (templateKey) {
      const allTemplates = await campaignTemplates.listTemplates();
      storedTemplate = allTemplates.find((item) => item.key === templateKey) || {};
    }
    const template = { ...storedTemplate, ...providedTemplate };
    const subject = String(template.subject || req.body?.subject || "").trim();
    const body = String(template.body || req.body?.body || "").trim();
    const rawHtml = req.body?.html;
    let contextData = req.body?.contextData && typeof req.body.contextData === "object" ? req.body.contextData : {};
    const context = String(template.context || req.body?.context || "general").trim();
    contextData = await enrichCampaignContext(context, contextData);

    if (!AUDIENCES.has(audience)) return res.status(400).json({ success: false, error: "Invalid audience" });
    if (!subject) return res.status(422).json({ success: false, error: "Subject is required." });
    if (subject.length > MAX_SUBJECT) return res.status(422).json({ success: false, error: "Subject is too long." });
    if (!body && !(rawHtml && String(rawHtml).trim())) return res.status(422).json({ success: false, error: "Message body is required." });
    if (audience === "nationality" && !String(nationality || "").trim()) return res.status(422).json({ success: false, error: "Nationality is required." });

    const recipients = await resolveRecipients(audience, nationality);
    if (!recipients.length) {
      return res.json({ success: true, message: "No opted-in recipients matched this audience.", sent: 0, failed: 0, total: 0, audience, context });
    }

    let sent = 0;
    let failed = 0;
    const errors = [];
    for (const recipient of recipients) {
      const recipientSubject = campaignTemplates.personalise(subject, recipient, contextData).slice(0, MAX_SUBJECT);
      const html = rawHtml && String(rawHtml).trim()
        ? String(rawHtml)
        : campaignTemplates.renderHtml({
            subject: recipientSubject,
            body,
            template: {
              ...template,
              subject,
              body,
              hero_image_url: template.hero_image_url || template.heroImageUrl || "",
              accent_color: template.accent_color || template.accentColor || "#059669",
              background_color: template.background_color || template.backgroundColor || "#f0fdf4",
              cta_label: template.cta_label || template.ctaLabel || "Explore more",
              cta_url: template.cta_url || template.ctaUrl || contextData.contentUrl || FRONTEND_URL + "/destinations"
            },
            recipient,
            context: contextData
          });
      const result = await sendOne(recipient.email, recipientSubject, html);
      if (result.success) sent += 1;
      else {
        failed += 1;
        if (errors.length < 5) errors.push({ email: recipient.email, error: result.error });
      }
      if (recipients.length > 10) await new Promise((resolve) => setTimeout(resolve, 120));
    }

    await campaignTemplates.logCampaign({
      templateKey, context, subject, audience, total: recipients.length, sent, failed,
      details: { nationality: audience === "nationality" ? nationality : null, errors }
    });

    logger.info("[EmailBroadcast] context=" + context + " audience=" + audience + (audience === "nationality" ? "(" + nationality + ")" : "") + " -> " + sent + " sent, " + failed + " failed of " + recipients.length);
    return res.json({
      success: true,
      message: "Email sent to " + sent + " recipient(s).",
      sent, failed, total: recipients.length, audience, context, templateKey: templateKey || null,
      errors: failed ? errors : undefined
    });
  } catch (err) {
    logger.error("[EmailBroadcast] send:", err.message);
    next(err);
  }
};


/* ── Automatic contextual campaigns: queue, retouch window, and worker ─────── */
let processingDueCampaigns = false;

const normaliseCampaignOverrides = (input = {}) => {
  const value = input && typeof input === "object" ? input : {};
  const out = {};
  const stringFields = {
    subject: 200, preheader: 240, headline: 180, body: 10000,
    hero_image_url: 1200, cta_label: 80, cta_url: 1200,
  };
  for (const [key, max] of Object.entries(stringFields)) {
    if (value[key] !== undefined) out[key] = String(value[key] || "").trim().slice(0, max);
  }
  if (value.accent_color !== undefined) {
    out.accent_color = /^#[0-9a-f]{6}$/i.test(String(value.accent_color)) ? String(value.accent_color) : "#059669";
  }
  if (value.background_color !== undefined) {
    out.background_color = /^#[0-9a-f]{6}$/i.test(String(value.background_color)) ? String(value.background_color) : "#f0fdf4";
  }
  if (value.layout !== undefined) {
    out.layout = ["adventure", "editorial", "minimal"].includes(value.layout) ? value.layout : "editorial";
  }
  if (value.animation !== undefined) {
    out.animation = ["none", "fade", "rise"].includes(value.animation) ? value.animation : "none";
  }
  return out;
};

const parseJsonObject = (value) => {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
};

async function deliverQueuedCampaign(row, io) {
  const contextData = parseJsonObject(row.data);
  const overrides = parseJsonObject(row.template_overrides);
  const templates = await campaignTemplates.listTemplates();
  const saved = templates.find((item) => item.key === row.template_key);
  if (!saved) throw new Error("Email template not found: " + row.template_key);

  const template = {
    ...saved,
    ...overrides,
    subject: overrides.subject || saved.subject,
    body: overrides.body || saved.body,
    headline: overrides.headline || saved.headline,
    preheader: overrides.preheader || saved.preheader,
    hero_image_url: overrides.hero_image_url || contextData.heroImageUrl || saved.hero_image_url || "",
    accent_color: overrides.accent_color || saved.accent_color || "#059669",
    background_color: overrides.background_color || saved.background_color || "#f0fdf4",
    layout: overrides.layout || saved.layout || "editorial",
    cta_label: overrides.cta_label || saved.cta_label || "Explore more",
    cta_url: overrides.cta_url || contextData.contentUrl || saved.cta_url || FRONTEND_URL + "/destinations",
  };
  const recipients = await resolveRecipients("all");
  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const recipient of recipients) {
    const recipientSubject = campaignTemplates.personalise(template.subject, recipient, contextData).slice(0, MAX_SUBJECT);
    const html = campaignTemplates.renderHtml({
      subject: recipientSubject,
      body: template.body,
      template,
      recipient,
      context: contextData,
    });
    const result = await sendOne(recipient.email, recipientSubject, html);
    if (result.success) sent += 1;
    else {
      failed += 1;
      if (errors.length < 5) errors.push({ email: recipient.email, error: result.error });
    }
    if (recipients.length > 10) await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const campaignResult = {
    id: Number(row.id),
    context: row.context,
    templateKey: row.template_key,
    subject: template.subject,
    total: recipients.length,
    sent,
    failed,
    createdAt: row.created_at,
  };
  await campaignTemplates.logCampaign({
    templateKey: row.template_key,
    context: row.context,
    subject: template.subject,
    audience: "all",
    total: recipients.length,
    sent,
    failed,
    details: {
      queueId: Number(row.id),
      autoTriggered: true,
      eventData: contextData,
      errors,
    },
  });

  const status = failed > 0 && sent === 0 ? "failed" : "sent";
  await query(
    `UPDATE email_campaign_queue
        SET status=$2, sent_at=NOW(), recipient_count=$3, sent_count=$4, failed_count=$5, last_error=$6
      WHERE id=$1`,
    [row.id, status, recipients.length, sent, failed, errors.length ? errors.map((item) => item.error).join("; ").slice(0, 2000) : null],
  );

  try {
    io?.to("admin-room").emit("email-campaign:sent", campaignResult);
  } catch (emitErr) {
    logger.warn("[EmailCampaignQueue] completion event failed:", emitErr.message);
  }

  // Persist a detailed admin-panel notification so the result remains visible
  // even when the admin was offline while this contextual campaign was sent.
  try {
    await notifyAdminsImmediately({
      type: "email_campaign_sent",
      category: "email",
      title: "Contextual email campaign completed",
      message: `The "${String(row.context || "general").replace(/[_-]+/g, " ")}" campaign finished on ${new Date().toLocaleString("en-US")}. ${sent} email(s) sent, ${failed} failed, out of ${recipients.length} opted-in recipient(s).`,
      actionUrl: "/broadcast",
      actionLabel: "View email campaign history",
      priority: failed > 0 ? "high" : "normal",
      metadata: {
        campaignId: Number(row.id),
        context: row.context,
        templateKey: row.template_key,
        subject: template.subject,
        recipientCount: recipients.length,
        sentCount: sent,
        failedCount: failed,
        completedAt: new Date().toISOString(),
        eventData: contextData,
        automatic: true,
      },
    });
  } catch (notificationErr) {
    logger.warn("[EmailCampaignQueue] persistent admin notification failed:", notificationErr.message);
  }

  logger.info("[EmailCampaignQueue] finished id=" + row.id + " sent=" + sent + " failed=" + failed + " recipients=" + recipients.length);
  return campaignResult;
}

exports.getPendingQueue = async (_req, res, next) => {
  try {
    const data = await campaignQueue.getPendingAdminCampaigns();
    return res.json({ success: true, data });
  } catch (err) {
    logger.error("[EmailBroadcast] getPendingQueue:", err.message);
    next(err);
  }
};

exports.updateQueuedTemplate = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Invalid campaign id." });
    const overrides = normaliseCampaignOverrides(req.body?.template || req.body || {});
    const { rows } = await query(
      `UPDATE email_campaign_queue
          SET template_overrides = COALESCE(template_overrides, '{}'::jsonb) || $2::jsonb
        WHERE id=$1 AND status='queued' AND scheduled_at > NOW()
        RETURNING id, context, template_key, template_overrides, scheduled_at`,
      [id, JSON.stringify(overrides)],
    );
    if (!rows[0]) return res.status(409).json({ success: false, error: "The 10-second retouch window has ended or this campaign has already started sending." });
    return res.json({ success: true, data: rows[0], message: "Retouch saved. The countdown will continue." });
  } catch (err) {
    logger.error("[EmailBroadcast] updateQueuedTemplate:", err.message);
    next(err);
  }
};

exports.sendQueuedNow = async (req, res, next) => {
  let claimed = null;
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Invalid campaign id." });
    const overrides = normaliseCampaignOverrides(req.body?.template || {});
    const { rows } = await query(
      `UPDATE email_campaign_queue
          SET status='sending',
              sending_at=NOW(),
              scheduled_at=NOW(),
              template_overrides=COALESCE(template_overrides, '{}'::jsonb) || $2::jsonb
        WHERE id=$1 AND status='queued'
        RETURNING *`,
      [id, JSON.stringify(overrides)],
    );
    claimed = rows[0];
    if (!claimed) return res.status(409).json({ success: false, error: "This campaign is already sending or has already been handled." });
    const result = await deliverQueuedCampaign(claimed, req.app.get("io"));
    return res.json({ success: true, data: result, message: "Email campaign sent." });
  } catch (err) {
    if (claimed) {
      await query(
        "UPDATE email_campaign_queue SET status='failed', sent_at=NOW(), last_error=$2 WHERE id=$1",
        [claimed.id, String(err.message || err).slice(0, 2000)],
      ).catch(() => {});
    }
    logger.error("[EmailBroadcast] sendQueuedNow:", err.message);
    if (claimed) return res.status(500).json({ success: false, error: "The queued campaign could not be sent.", detail: err.message });
    next(err);
  }
};

exports.processDueCampaigns = async (io) => {
  if (processingDueCampaigns) return;
  processingDueCampaigns = true;
  try {
    await campaignQueue.ensureQueueSchema();
    for (let i = 0; i < 3; i += 1) {
      const { rows } = await query(
        `UPDATE email_campaign_queue
            SET status='sending', sending_at=NOW()
          WHERE id = (
            SELECT id FROM email_campaign_queue
             WHERE status='queued' AND scheduled_at <= NOW()
             ORDER BY scheduled_at ASC, id ASC
             FOR UPDATE SKIP LOCKED
             LIMIT 1
          )
          RETURNING *`,
      );
      const row = rows[0];
      if (!row) break;
      try {
        await deliverQueuedCampaign(row, io);
      } catch (err) {
        await query(
          "UPDATE email_campaign_queue SET status='failed', sent_at=NOW(), last_error=$2 WHERE id=$1",
          [row.id, String(err.message || err).slice(0, 2000)],
        ).catch(() => {});
        await campaignTemplates.logCampaign({
          templateKey: row.template_key,
          context: row.context,
          subject: row.template_key,
          audience: "all",
          total: 0, sent: 0, failed: 1,
          details: { queueId: Number(row.id), autoTriggered: true, eventData: parseJsonObject(row.data), error: err.message },
        }).catch(() => {});
        logger.error("[EmailCampaignQueue] failed id=" + row.id + ": " + err.message);
        try {
          io?.to("admin-room").emit("email-campaign:sent", {
            id: Number(row.id), context: row.context, templateKey: row.template_key,
            subject: row.template_key, total: 0, sent: 0, failed: 1, error: err.message,
          });
        } catch {}
        try {
          await notifyAdminsImmediately({
            type: "email_campaign_failed",
            category: "email",
            title: "Automatic email campaign failed",
            message: `The "${String(row.context || "general").replace(/[_-]+/g, " ")}" campaign could not be completed at ${new Date().toLocaleString("en-US")}. Please open Email Studio to review the error and retry.`,
            actionUrl: "/broadcast",
            actionLabel: "Review campaign",
            priority: "high",
            metadata: {
              campaignId: Number(row.id),
              context: row.context,
              templateKey: row.template_key,
              campaignError: String(err.message || err).slice(0, 1000),
              completedAt: new Date().toISOString(),
              eventData: parseJsonObject(row.data),
              automatic: true,
            },
          });
        } catch (notificationErr) {
          logger.warn("[EmailCampaignQueue] persistent failure notification failed:", notificationErr.message);
        }
      }
    }
  } catch (err) {
    logger.error("[EmailCampaignQueue] worker error:", err.message);
  } finally {
    processingDueCampaigns = false;
  }
};
