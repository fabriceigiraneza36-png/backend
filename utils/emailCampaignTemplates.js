// utils/emailCampaignTemplates.js
// Persistent, reusable, personalised email designs used by admin broadcasts.
"use strict";

const { query } = require("../config/db");
const logger = require("./logger");

const FRONTEND_URL = (process.env.FRONTEND_URL || "https://www.altuverasafaris.com").replace(/\/+$/, "");
const BACKEND_URL = (process.env.BACKEND_URL || "https://backend-jd8f.onrender.com").replace(/\/+$/, "");
const APP_NAME = process.env.APP_NAME || "Altuvera Safaris";
const DEFAULT_HERO = process.env.EMAIL_HERO_URL || "";

const DEFAULT_TEMPLATES = [
  { key:"new_destination", name:"New destination", context:"new_destination", subject:"A new place to discover, {{firstName}}", preheader:"Meet a new East African experience curated by Altuvera.", headline:"Your next adventure has a new address", body:"Hello {{firstName}},\n\nWe have added {{destinationName}} to the Altuvera collection. Explore the highlights, discover what makes this place special, and start planning a journey that fits your style.", hero_image_url:"", accent_color:"#059669", background_color:"#f0fdf4", layout:"adventure", cta_label:"Explore destination", cta_url:"{{contentUrl}}" },
  { key:"new_post", name:"New travel story", context:"new_post", subject:"A fresh travel story for you, {{firstName}}", preheader:"New ideas and practical tips for your next journey.", headline:"A little inspiration for the road ahead", body:"Hello {{firstName}},\n\nOur latest story, {{postTitle}}, is ready. Find helpful insight, local context, and ideas to make your time in East Africa more meaningful.", hero_image_url:"", accent_color:"#0f766e", background_color:"#f0fdfa", layout:"editorial", cta_label:"Read the story", cta_url:"{{contentUrl}}" },
  { key:"new_package", name:"New travel package", context:"new_package", subject:"A new travel idea to consider, {{firstName}}", preheader:"Discover a new Altuvera package and request a personalised plan.", headline:"A new way to experience East Africa", body:"Hello {{firstName}},\n\nWe have introduced {{packageName}}. Take a look at the package details and send us your preferred dates and travel style. Our team will discuss a proposal with you—there is no online payment required.", hero_image_url:"", accent_color:"#047857", background_color:"#f0fdf4", layout:"adventure", cta_label:"View package", cta_url:"{{contentUrl}}" },
  { key:"top_rated_destination", name:"Popular destination inspiration", context:"top_rated_destination", subject:"Travellers are loving {{destinationName}}, {{firstName}}", preheader:"Take inspiration from one of our most-loved destinations.", headline:"A destination worth dreaming about", body:"Hello {{firstName}},\n\n{{destinationName}} is one of the experiences travellers are responding to most. Discover the highlights, read traveller feedback, and tell us what your ideal trip would look like.", hero_image_url:"", accent_color:"#047857", background_color:"#f0fdf4", layout:"editorial", cta_label:"See why travellers love it", cta_url:"{{contentUrl}}" },
  { key:"booking_encouragement", name:"Personalised trip encouragement", context:"booking_encouragement", subject:"Your next adventure can start with one conversation, {{firstName}}", preheader:"Tell us what you want to experience and we will help shape the details.", headline:"Let's plan something memorable", body:"Hello {{firstName}},\n\nWhether you are dreaming of wildlife, mountain scenery, culture, or a slower local experience, our team can help shape a journey around your interests. Share your ideas, preferred dates, and travel style to begin.", hero_image_url:"", accent_color:"#059669", background_color:"#f0fdf4", layout:"minimal", cta_label:"Start planning", cta_url:"{{bookingUrl}}" },
  { key:"travel_guide", name:"Seasonal travel guide", context:"travel_guide", subject:"A few useful ideas for your next East African trip", preheader:"Practical inspiration to help you plan with confidence.", headline:"Travel well, with the right local insight", body:"Hello {{firstName}},\n\nA thoughtful trip starts with the details. Browse our guides for destination ideas, travel preparation, and ways to experience East Africa respectfully and comfortably.", hero_image_url:"", accent_color:"#0f766e", background_color:"#f0fdfa", layout:"minimal", cta_label:"Browse travel guides", cta_url:"{{contentUrl}}" }
];

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  await query("CREATE TABLE IF NOT EXISTS email_campaign_templates (key TEXT PRIMARY KEY, name TEXT NOT NULL, context TEXT NOT NULL DEFAULT 'general', subject TEXT NOT NULL, preheader TEXT NOT NULL DEFAULT '', headline TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, hero_image_url TEXT NOT NULL DEFAULT '', accent_color VARCHAR(7) NOT NULL DEFAULT '#059669', background_color VARCHAR(7) NOT NULL DEFAULT '#f0fdf4', layout VARCHAR(30) NOT NULL DEFAULT 'editorial', cta_label TEXT NOT NULL DEFAULT 'Learn more', cta_url TEXT NOT NULL DEFAULT 'https://www.altuverasafaris.com', updated_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await query("CREATE TABLE IF NOT EXISTS email_campaign_logs (id BIGSERIAL PRIMARY KEY, template_key TEXT, context TEXT NOT NULL DEFAULT 'general', subject TEXT NOT NULL, audience TEXT NOT NULL, recipient_count INTEGER NOT NULL DEFAULT 0, sent_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  for (const t of DEFAULT_TEMPLATES) {
    await query("INSERT INTO email_campaign_templates (key,name,context,subject,preheader,headline,body,hero_image_url,accent_color,background_color,layout,cta_label,cta_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (key) DO NOTHING",
      [t.key,t.name,t.context,t.subject,t.preheader,t.headline,t.body,t.hero_image_url || DEFAULT_HERO,t.accent_color,t.background_color,t.layout,t.cta_label,t.cta_url]);
  }
  schemaReady = true;
}

const escapeHtml = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;

const safeHttpUrl = (value, fallback) => {
  const candidate = String(value || "").trim();
  try {
    const parsed = new URL(candidate);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.toString() : fallback;
  } catch { return fallback; }
};

function contextValues(recipient, context) {
  const displayName = String(recipient.name || "").trim();
  return {
    firstName: displayName.split(/\s+/)[0] || "Explorer",
    name: displayName || "Explorer",
    destinationName: context.destinationName || context.destination_name || "a remarkable East African destination",
    countryName: context.countryName || context.country_name || "East Africa",
    postTitle: context.postTitle || context.post_title || "our latest travel story",
    packageName: context.packageName || context.package_name || "a new Altuvera travel package",
    rating: context.rating || "highly rated",
    contentUrl: context.contentUrl || context.content_url || FRONTEND_URL + "/destinations",
    bookingUrl: context.bookingUrl || context.booking_url || FRONTEND_URL + "/booking",
    ctaUrl: context.ctaUrl || context.cta_url || context.contentUrl || FRONTEND_URL + "/destinations"
  };
}

function personalise(value, recipient, context) {
  const vars = contextValues(recipient || {}, context || {});
  return String(value == null ? "" : value).replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, function (_match, key) {
    return vars[key] == null ? "" : String(vars[key]);
  });
}

function renderHtml(options) {
  const subject = options.subject || "Altuvera travel inspiration";
  const template = options.template || {};
  const recipient = options.recipient || {};
  const context = options.context || {};
  const bodyText = personalise(template.body || options.body || "", recipient, context);
  const title = personalise(template.headline || subject, recipient, context);
  const preheader = personalise(template.preheader || subject, recipient, context);
  const accent = safeColor(template.accent_color || template.accentColor, "#059669");
  const background = safeColor(template.background_color || template.backgroundColor, "#f0fdf4");
  const heroUrl = safeHttpUrl(personalise(template.hero_image_url || template.heroImageUrl || DEFAULT_HERO, recipient, context), "");
  const ctaText = personalise(template.cta_label || template.ctaLabel || "Explore more", recipient, context);
  const ctaCandidate = personalise(template.cta_url || template.ctaUrl || context.contentUrl || FRONTEND_URL + "/destinations", recipient, context);
  const ctaUrl = safeHttpUrl(ctaCandidate, FRONTEND_URL + "/destinations");
  const layout = ["adventure", "editorial", "minimal"].includes(template.layout) ? template.layout : "editorial";
  const paragraphs = bodyText.split(/\n{2,}/).map(function (part) {
    return '<p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.75">' + escapeHtml(part).replace(/\n/g, "<br/>") + "</p>";
  }).join("");
  const hero = heroUrl
    ? '<tr><td style="padding:0;background:#e2e8f0"><img src="' + escapeHtml(heroUrl) + '" alt="' + escapeHtml(title) + '" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0" /></td></tr>'
    : "";
  const headerBg = layout === "minimal" ? "#ffffff" : accent;
  const headerColor = layout === "minimal" ? "#0f172a" : "#ffffff";
  const subtitleColor = layout === "minimal" ? accent : "#d1fae5";
  const unsubscribeUrl = BACKEND_URL + "/api/subscribers/unsubscribe/" + encodeURIComponent(String(recipient.email || ""));
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><meta name="color-scheme" content="light only"/><title>' + escapeHtml(personalise(subject, recipient, context)) + '</title><style>body{margin:0;padding:0;background:' + background + ';font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%}@media(max-width:620px){.outer{padding:12px 6px!important}.content{padding:22px 18px!important}.heading{font-size:25px!important}}</style></head><body style="margin:0;padding:0;background:' + background + ';font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">' + escapeHtml(preheader) + '</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + background + ';padding:24px 10px" class="outer"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #dbe7e1;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,.07)"><tr><td style="padding:25px 28px 22px;background:' + headerBg + ';color:' + headerColor + ';text-align:center"><div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.82">ALTUVERA SAFARIS</div><h1 class="heading" style="margin:11px 0 0;font-size:30px;line-height:1.2;font-weight:800;color:' + headerColor + '">' + escapeHtml(title) + '</h1><p style="margin:9px 0 0;font-size:12px;line-height:1.5;color:' + subtitleColor + '">True adventure in high places &amp; deep culture</p></td></tr>' + hero + '<tr><td class="content" style="padding:29px 32px 28px">' + paragraphs + '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto 8px"><tr><td bgcolor="' + accent + '" style="border-radius:11px;text-align:center"><a href="' + escapeHtml(ctaUrl) + '" style="display:inline-block;padding:14px 22px;background:' + accent + ';border:1px solid ' + accent + ';border-radius:11px;color:#fff;text-decoration:none;font-size:14px;line-height:1.2;font-weight:700">' + escapeHtml(ctaText) + '</a></td></tr></table><p style="margin:20px 0 0;color:#64748b;text-align:center;font-size:12px;line-height:1.6">Our team is happy to help shape the details around your interests and dates.</p></td></tr><tr><td style="padding:18px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center"><p style="margin:0;color:#64748b;font-size:11px;line-height:1.7">' + escapeHtml(APP_NAME) + ' · East Africa</p><p style="margin:6px 0 0;color:#94a3b8;font-size:11px;line-height:1.7">You are receiving travel inspiration because you opted in. <a href="' + escapeHtml(unsubscribeUrl) + '" style="color:' + accent + ';text-decoration:underline">Unsubscribe</a></p><p style="margin:8px 0 0"><a href="' + escapeHtml(FRONTEND_URL) + '" style="font-size:11px;color:' + accent + '">Visit Altuvera</a></p></td></tr></table></td></tr></table></body></html>';
}

async function listTemplates() {
  await ensureSchema();
  const result = await query("SELECT * FROM email_campaign_templates ORDER BY name ASC");
  return result.rows;
}

async function saveTemplate(body, userId) {
  await ensureSchema();
  const b = body || {};
  const key = String(b.key || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80);
  const name = String(b.name || "").trim().slice(0, 120);
  const subject = String(b.subject || "").trim().slice(0, 200);
  const copy = String(b.body || "").trim().slice(0, 10000);
  if (!key || !name || !subject || !copy) throw Object.assign(new Error("Template key, name, subject, and message are required."), { status: 422 });
  const values = [
    key, name, String(b.context || "general").trim().slice(0, 80) || "general", subject,
    String(b.preheader || "").slice(0, 240), String(b.headline || "").slice(0, 180), copy,
    safeHttpUrl(b.hero_image_url || b.heroImageUrl, ""),
    safeColor(b.accent_color || b.accentColor, "#059669"),
    safeColor(b.background_color || b.backgroundColor, "#f0fdf4"),
    ["adventure", "editorial", "minimal"].includes(b.layout) ? b.layout : "editorial",
    String(b.cta_label || b.ctaLabel || "Explore more").trim().slice(0, 80),
    String(b.cta_url || b.ctaUrl || FRONTEND_URL + "/destinations").trim().slice(0, 600),
    userId || null
  ];
  const result = await query("INSERT INTO email_campaign_templates (key,name,context,subject,preheader,headline,body,hero_image_url,accent_color,background_color,layout,cta_label,cta_url,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name,context=EXCLUDED.context,subject=EXCLUDED.subject,preheader=EXCLUDED.preheader,headline=EXCLUDED.headline,body=EXCLUDED.body,hero_image_url=EXCLUDED.hero_image_url,accent_color=EXCLUDED.accent_color,background_color=EXCLUDED.background_color,layout=EXCLUDED.layout,cta_label=EXCLUDED.cta_label,cta_url=EXCLUDED.cta_url,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *", values);
  return result.rows[0];
}

async function logCampaign(entry) {
  try {
    await ensureSchema();
    await query("INSERT INTO email_campaign_logs (template_key,context,subject,audience,recipient_count,sent_count,failed_count,details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
      [entry.templateKey || null, entry.context || "general", entry.subject, entry.audience, entry.total || 0, entry.sent || 0, entry.failed || 0, JSON.stringify(entry.details || {})]);
  } catch (err) {
    logger.warn("[EmailCampaignTemplates] campaign log write failed:", err.message);
  }
}

async function getHistory() {
  await ensureSchema();
  const result = await query("SELECT id,template_key,context,subject,audience,recipient_count,sent_count,failed_count,details,created_at FROM email_campaign_logs ORDER BY created_at DESC LIMIT 50");
  return result.rows;
}

module.exports = { DEFAULT_TEMPLATES, ensureSchema, listTemplates, saveTemplate, personalise, renderHtml, logCampaign, getHistory };
