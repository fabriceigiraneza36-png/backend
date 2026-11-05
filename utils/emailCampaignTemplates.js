// utils/emailCampaignTemplates.js
// Persistent, reusable, personalised email designs used by admin broadcasts.
"use strict";

const { query } = require("../config/db");
const logger = require("./logger");

const FRONTEND_URL = (process.env.FRONTEND_URL || "https://www.altuverasafaris.com").replace(/\/+$/, "");
const BACKEND_URL = (process.env.BACKEND_URL || "https://backend-jd8f.onrender.com").replace(/\/+$/, "");
const APP_NAME = process.env.APP_NAME || "Altuvera";
const DEFAULT_HERO = process.env.EMAIL_HERO_URL || "";

const DEFAULT_TEMPLATES = [
  { key:"new_destination", name:"New destination", context:"new_destination", subject:"A new place to discover, {{firstName}}", preheader:"Meet a new East African experience curated by Altuvera.", headline:"Your next adventure has a new address", body:"Hello {{firstName}},\n\nWe have added {{destinationName}} to the Altuvera collection. Explore the highlights, discover what makes this place special, and start planning a journey that fits your style.", hero_image_url:"", accent_color:"#059669", background_color:"#f0fdf4", layout:"adventure", animation:"fade", cta_label:"Explore destination", cta_url:"{{contentUrl}}" },
  { key:"new_post", name:"New travel story", context:"new_post", subject:"A fresh travel story for you, {{firstName}}", preheader:"New ideas and practical tips for your next journey.", headline:"A little inspiration for the road ahead", body:"Hello {{firstName}},\n\nOur latest story, {{postTitle}}, is ready. Find helpful insight, local context, and ideas to make your time in East Africa more meaningful.", hero_image_url:"", accent_color:"#0f766e", background_color:"#f0fdfa", layout:"editorial", animation:"fade", cta_label:"Read the story", cta_url:"{{contentUrl}}" },
  { key:"new_package", name:"New travel package", context:"new_package", subject:"A new travel idea to consider, {{firstName}}", preheader:"Discover a new Altuvera package and request a personalised plan.", headline:"A new way to experience East Africa", body:"Hello {{firstName}},\n\nWe have introduced {{packageName}}. Take a look at the package details and send us your preferred dates and travel style. Our team will discuss a proposal with you—there is no online payment required.", hero_image_url:"", accent_color:"#047857", background_color:"#f0fdf4", layout:"adventure", cta_label:"View package", cta_url:"{{contentUrl}}" },
  { key:"top_rated_destination", name:"Popular destination inspiration", context:"top_rated_destination", subject:"Travellers are loving {{destinationName}}, {{firstName}}", preheader:"Take inspiration from one of our most-loved destinations.", headline:"A destination worth dreaming about", body:"Hello {{firstName}},\n\n{{destinationName}} is one of the experiences travellers are responding to most. Discover the highlights, read traveller feedback, and tell us what your ideal trip would look like.", hero_image_url:"", accent_color:"#047857", background_color:"#f0fdf4", layout:"editorial", cta_label:"See why travellers love it", cta_url:"{{contentUrl}}" },
  { key:"booking_encouragement", name:"Personalised trip encouragement", context:"booking_encouragement", subject:"Your next adventure can start with one conversation, {{firstName}}", preheader:"Tell us what you want to experience and we will help shape the details.", headline:"Let's plan something memorable", body:"Hello {{firstName}},\n\nWhether you are dreaming of wildlife, mountain scenery, culture, or a slower local experience, our team can help shape a journey around your interests. Share your ideas, preferred dates, and travel style to begin.", hero_image_url:"", accent_color:"#059669", background_color:"#f0fdf4", layout:"minimal", animation:"none", cta_label:"Start planning", cta_url:"{{bookingUrl}}" },
  { key:"travel_guide", name:"Seasonal travel guide", context:"travel_guide", subject:"A few useful ideas for your next East African trip", preheader:"Practical inspiration to help you plan with confidence.", headline:"Travel well, with the right local insight", body:"Hello {{firstName}},\n\nA thoughtful trip starts with the details. Browse our guides for destination ideas, travel preparation, and ways to experience East Africa respectfully and comfortably.", hero_image_url:"", accent_color:"#0f766e", background_color:"#f0fdfa", layout:"minimal", cta_label:"Browse travel guides", cta_url:"{{contentUrl}}" }
];

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  await query("CREATE TABLE IF NOT EXISTS email_campaign_templates (key TEXT PRIMARY KEY, name TEXT NOT NULL, context TEXT NOT NULL DEFAULT 'general', subject TEXT NOT NULL, preheader TEXT NOT NULL DEFAULT '', headline TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, hero_image_url TEXT NOT NULL DEFAULT '', accent_color VARCHAR(7) NOT NULL DEFAULT '#059669', background_color VARCHAR(7) NOT NULL DEFAULT '#f0fdf4', layout VARCHAR(30) NOT NULL DEFAULT 'editorial', animation VARCHAR(24) NOT NULL DEFAULT 'none', cta_label TEXT NOT NULL DEFAULT 'Learn more', cta_url TEXT NOT NULL DEFAULT 'https://www.altuverasafaris.com', updated_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await query("ALTER TABLE email_campaign_templates ADD COLUMN IF NOT EXISTS animation VARCHAR(24) NOT NULL DEFAULT 'none'");
  await query("CREATE TABLE IF NOT EXISTS email_campaign_logs (id BIGSERIAL PRIMARY KEY, template_key TEXT, context TEXT NOT NULL DEFAULT 'general', subject TEXT NOT NULL, audience TEXT NOT NULL, recipient_count INTEGER NOT NULL DEFAULT 0, sent_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  for (const t of DEFAULT_TEMPLATES) {
    await query("INSERT INTO email_campaign_templates (key,name,context,subject,preheader,headline,body,hero_image_url,accent_color,background_color,layout,animation,cta_label,cta_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (key) DO NOTHING",
      [t.key,t.name,t.context,t.subject,t.preheader,t.headline,t.body,t.hero_image_url || DEFAULT_HERO,t.accent_color,t.background_color,t.layout,t.animation || "none",t.cta_label,t.cta_url]);
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
  const bodyText = personalise(template.body || options.body || "", recipient, context)
    .replace(/^\s*(?:hello|dear)\s+[^,\n]+,?\s*\n+/i, "");
  const title = personalise(template.headline || subject, recipient, context);
  const preheader = personalise(template.preheader || subject, recipient, context);
  const accent = safeColor(template.accent_color || template.accentColor, "#059669");
  const background = safeColor(template.background_color || template.backgroundColor, "#f0fdf4");
  const heroUrl = safeHttpUrl(personalise(template.hero_image_url || template.heroImageUrl || DEFAULT_HERO, recipient, context), "");
  const ctaText = personalise(template.cta_label || template.ctaLabel || "Explore more", recipient, context);
  const ctaCandidate = personalise(template.cta_url || template.ctaUrl || context.contentUrl || FRONTEND_URL + "/destinations", recipient, context);
  const ctaUrl = safeHttpUrl(ctaCandidate, FRONTEND_URL + "/destinations");
  const logoUrl = FRONTEND_URL + "/altuvera.png";
  const displayName = String(recipient.name || "").trim();
  const firstName = displayName.split(/\s+/)[0] || "Explorer";
  const nameParts = displayName.split(/\s+/).filter(Boolean);
  const initials = nameParts.length > 1
    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
    : (nameParts[0] || recipient.email || "U").slice(0, 2).toUpperCase();
  const avatarUrl = safeHttpUrl(recipient.avatar_url || recipient.avatarUrl || "", "");
  const avatarMarkup = avatarUrl
    ? '<img src="' + escapeHtml(avatarUrl) + '" width="44" height="44" alt="' + escapeHtml(displayName || "Your profile") + '" style="display:block;width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid #d1fae5;background:#fff" />'
    : '<table role="presentation" width="44" height="44" cellpadding="0" cellspacing="0" style="width:44px;height:44px;border-radius:50%;background:#d1fae5;border:2px solid #fff"><tr><td align="center" valign="middle" style="font:800 13px Arial,sans-serif;color:#065f46">' + escapeHtml(initials) + '</td></tr></table>';

  const paragraphs = bodyText.split(/\n{2,}/).map(function (part) {
    return '<p style="margin:0 0 13px;color:#334155;font-size:15px;line-height:1.7;overflow-wrap:anywhere">' +
      escapeHtml(part).replace(/\n/g, "<br/>") + "</p>";
  }).join("");

  const rawItems = Array.isArray(context.contentItems) ? context.contentItems : [];
  const contentItems = rawItems.slice(0, 12).map((item) => ({
    title: String(item.title || item.name || "Explore Altuvera").slice(0, 180),
    type: String(item.type || "experience").replace(/[_-]+/g, " ").slice(0, 50),
    description: String(item.description || item.short_description || item.excerpt || "").slice(0, 500),
    url: safeHttpUrl(item.contentUrl || item.url || "", ctaUrl),
  }));
  const itemCards = contentItems.length
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:20px 0 4px">' +
      contentItems.map((item) =>
        '<tr><td style="padding:13px 15px;border:1px solid #dcebe1;border-radius:12px;background:#f8fcf9">' +
        '<p style="margin:0 0 3px;color:#047857;font:700 9px Arial,sans-serif;letter-spacing:1px;text-transform:uppercase">' + escapeHtml(item.type) + '</p>' +
        '<p style="margin:0 0 4px;color:#123b2c;font:700 15px Arial,sans-serif"><a href="' + escapeHtml(item.url) + '" style="color:#123b2c;text-decoration:none">' + escapeHtml(item.title) + '</a></p>' +
        (item.description ? '<p style="margin:0;color:#64748b;font:12px/1.55 Arial,sans-serif">' + escapeHtml(item.description) + '</p>' : '') +
        '</td></tr><tr><td height="8" style="height:8px;font-size:1px;line-height:1px">&nbsp;</td></tr>'
      ).join("") + "</table>"
    : "";

  const rawGallery = Array.isArray(context.mediaGallery) ? context.mediaGallery
    : Array.isArray(context.galleryImages) ? context.galleryImages
    : Array.isArray(context.images) ? context.images : [];
  const galleryImages = rawGallery.map((entry) => {
    if (typeof entry === "string") return { url: safeHttpUrl(entry, ""), alt: title };
    return {
      url: safeHttpUrl(entry?.url || entry?.image_url || entry?.imageUrl || "", ""),
      alt: String(entry?.alt || entry?.title || title).slice(0, 180),
      caption: String(entry?.caption || entry?.title || "").slice(0, 160),
      link: safeHttpUrl(entry?.contentUrl || entry?.link || "", ctaUrl),
    };
  }).filter((image) => image.url).slice(0, 10);

  const galleryRows = [];
  for (let index = 0; index < galleryImages.length; index += 2) {
    galleryRows.push(galleryImages.slice(index, index + 2));
  }

  // Gmail and several mobile email apps do not reliably support horizontally
  // scrollable containers. Use a responsive, table-based gallery so every
  // selected image is visible without requiring swipe or carousel support.
  const galleryMarkup = galleryImages.length
    ? '<div style="margin:23px 0 8px">' +
      '<p style="margin:0 0 11px;color:#174b35;font:800 11px Arial,sans-serif;letter-spacing:1.1px;text-transform:uppercase">Explore the highlights</p>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0">' +
      galleryRows.map((row) =>
        '<tr>' +
        row.map((image) =>
          '<td width="50%" valign="top" style="width:50%;padding:0 5px 10px">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #dcebe1;border-radius:12px;background:#fff;overflow:hidden">' +
          '<tr><td>' +
          '<a href="' + escapeHtml(image.link || ctaUrl) + '" style="display:block;text-decoration:none">' +
          '<img src="' + escapeHtml(image.url) + '" alt="' + escapeHtml(image.alt) + '" width="250" height="150" style="display:block;width:100%;height:150px;object-fit:cover;background:#e8f3eb;border:0;border-radius:11px 11px 0 0" />' +
          '</a></td></tr>' +
          (image.caption ? '<tr><td style="padding:8px 9px;color:#52685d;font:11px/1.4 Arial,sans-serif">' + escapeHtml(image.caption) + '</td></tr>' : '') +
          '</table></td>'
        ).join("") +
        (row.length === 1 ? '<td width="50%" style="width:50%;padding:0 5px 10px">&nbsp;</td>' : '') +
        '</tr>'
      ).join("") +
      '</table></div>'
    : (heroUrl ? '<div style="margin:20px 0 5px;border-radius:13px;overflow:hidden"><img src="' + escapeHtml(heroUrl) + '" alt="' + escapeHtml(title) + '" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0" /></div>' : "");

  const celebration = '<div class="al-celebration" style="position:relative;margin:0 0 18px;padding:11px 15px;border:1px solid #d1fae5;border-radius:13px;background:#f0fdf4;text-align:center;overflow:hidden">' +
    '<span style="color:#047857;font:700 10px Arial,sans-serif;letter-spacing:1.2px;text-transform:uppercase">A fresh update from Altuvera</span>' +
    '<span class="al-confetti al-c1" aria-hidden="true" style="position:absolute;left:10%;top:4px;width:6px;height:9px;background:#10b981;border-radius:2px;transform:rotate(28deg)"></span>' +
    '<span class="al-confetti al-c2" aria-hidden="true" style="position:absolute;left:24%;top:6px;width:5px;height:8px;background:#a7f3d0;border-radius:2px;transform:rotate(-24deg)"></span>' +
    '<span class="al-confetti al-c3" aria-hidden="true" style="position:absolute;right:17%;top:3px;width:6px;height:9px;background:#047857;border-radius:2px;transform:rotate(34deg)"></span>' +
    '<span class="al-confetti al-c4" aria-hidden="true" style="position:absolute;right:8%;top:8px;width:5px;height:8px;background:#6ee7b7;border-radius:2px;transform:rotate(-30deg)"></span></div>';

  const animationCss =
    '@keyframes alCampaignConfetti{0%{transform:translateY(-8px) rotate(0deg);opacity:.25}18%{opacity:1}100%{transform:translateY(36px) rotate(230deg);opacity:.15}}' +
    '.al-confetti{animation:alCampaignConfetti 1.5s ease-out both}' +
    '.al-c2{animation-delay:.08s}.al-c3{animation-delay:.16s}.al-c4{animation-delay:.24s}' +
    '@media(prefers-reduced-motion:reduce){.al-confetti{animation:none!important}}' +
    '@media(max-width:620px){.al-campaign-content{padding:22px 17px!important}.al-campaign-heading{font-size:25px!important}}';

  const unsubscribeUrl = BACKEND_URL + "/api/subscribers/unsubscribe/" + encodeURIComponent(String(recipient.email || ""));
  return '<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><meta name="x-apple-disable-message-reformatting"/><meta name="color-scheme" content="light only"/><title>' +
    escapeHtml(personalise(subject, recipient, context)) + '</title><style>' + animationCss +
    'body{margin:0;padding:0;background:' + background + ';font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%}table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}img{border:0;outline:none;text-decoration:none}' +
    '@media(max-width:620px){.al-campaign-outer{padding:10px 5px!important}.al-campaign-card{border-radius:14px!important}.al-campaign-content{padding:20px 15px!important}.al-campaign-heading{font-size:24px!important}.al-campaign-logo{width:66px!important;height:36px!important}}' +
    '</style></head><body style="margin:0;padding:0;background:' + background + ';font-family:Arial,Helvetica,sans-serif">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">' + escapeHtml(preheader) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="al-campaign-outer" style="width:100%;background:' + background + ';padding:23px 10px"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="al-campaign-card" style="width:100%;max-width:600px;background:#fff;border:1px solid #dbe7e1;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,.07)">' +
    '<tr><td bgcolor="#064e3b" style="padding:14px 19px;background:#064e3b;background-image:linear-gradient(135deg,#063d2e,#087a50)">' +
    '<table data-altuvera-email-header="true" role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="79" valign="middle" style="width:79px"><img class="al-campaign-logo" src="' + escapeHtml(logoUrl) + '" width="72" height="40" alt="Altuvera logo" style="display:block;width:72px;height:40px;object-fit:contain;border-radius:7px;background:#fff;padding:3px"/></td>' +
    '<td valign="middle" style="padding:0 9px"><p style="margin:0;color:#fff;font:800 15px/1.25 Arial,sans-serif">Altuvera</p><p style="margin:4px 0 0;color:#b9f2d4;font:700 8px/1.4 Arial,sans-serif;letter-spacing:.85px;text-transform:uppercase">True adventure in high places &amp; deep culture</p></td>' +
    '<td align="right" valign="middle" width="48" style="width:48px">' + avatarMarkup + '</td></tr></table></td></tr>' +
    '<tr><td class="al-campaign-content" style="padding:28px 32px 27px">' + celebration +
    '<h1 class="al-campaign-heading" style="margin:0 0 11px;color:#123b2c;font:800 29px/1.2 Arial,sans-serif;letter-spacing:-.5px">' + escapeHtml(title) + '</h1>' +
    '<p style="margin:0 0 16px;color:#52685d;font:13px/1.55 Arial,sans-serif">Hello <strong>' + escapeHtml(firstName) + '</strong>,</p>' +
    paragraphs + itemCards + galleryMarkup +
    '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:21px auto 8px"><tr><td bgcolor="' + accent + '" style="border-radius:999px;text-align:center"><a href="' + escapeHtml(ctaUrl) + '" style="display:inline-block;padding:13px 22px;background:' + accent + ';border:1px solid ' + accent + ';border-radius:999px;color:#fff;text-decoration:none;font:700 13px/1.2 Arial,sans-serif">' + escapeHtml(ctaText) + ' &#8594;</a></td></tr></table>' +
    '<p style="margin:15px 0 0;color:#82938a;text-align:center;font:11px/1.6 Arial,sans-serif">Our team is happy to help shape the details around your interests and dates.</p></td></tr>' +
    '<tr><td style="padding:16px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center"><p style="margin:0;color:#64748b;font:11px/1.6 Arial,sans-serif">' + escapeHtml(APP_NAME) + ' · East Africa</p>' +
    '<p style="margin:5px 0 0;color:#94a3b8;font:10px/1.6 Arial,sans-serif">You are receiving travel updates because you opted in. <a href="' + escapeHtml(unsubscribeUrl) + '" style="color:' + accent + ';text-decoration:underline">Unsubscribe</a></p>' +
    '<p style="margin:6px 0 0"><a href="' + escapeHtml(FRONTEND_URL) + '" style="color:' + accent + ';font:10px Arial,sans-serif">Visit Altuvera</a></p>' +
    '<p style="margin:7px 0 0;color:#a5b1a9;font:9px Arial,sans-serif">© ' + new Date().getFullYear() + ' Altuvera. All rights reserved.</p></td></tr></table></td></tr></table></body></html>';
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
    ["none", "fade", "rise"].includes(b.animation) ? b.animation : "none",
    String(b.cta_label || b.ctaLabel || "Explore more").trim().slice(0, 80),
    String(b.cta_url || b.ctaUrl || FRONTEND_URL + "/destinations").trim().slice(0, 600),
    userId || null
  ];
  const result = await query("INSERT INTO email_campaign_templates (key,name,context,subject,preheader,headline,body,hero_image_url,accent_color,background_color,layout,animation,cta_label,cta_url,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name,context=EXCLUDED.context,subject=EXCLUDED.subject,preheader=EXCLUDED.preheader,headline=EXCLUDED.headline,body=EXCLUDED.body,hero_image_url=EXCLUDED.hero_image_url,accent_color=EXCLUDED.accent_color,background_color=EXCLUDED.background_color,layout=EXCLUDED.layout,animation=EXCLUDED.animation,cta_label=EXCLUDED.cta_label,cta_url=EXCLUDED.cta_url,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *", values);
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
