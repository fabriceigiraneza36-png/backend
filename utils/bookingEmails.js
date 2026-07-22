// utils/bookingEmails.js
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA SAFARIS — Premium Email Templates (v2.1)
 * ═══════════════════════════════════════════════════════════════════════════════
 * Fixes in v2.1:
 *  • sendBookingVerificationLink now uses _send (was calling undefined `sendEmail`)
 *  • Robust URL builder — validates protocol + host, no more "http:///booking/verify"
 *  • API_URL fallback chain hardened; defaults never produce malformed URLs
 *  • Single export block at the bottom (no more mixed `exports.x` + module.exports)
 *  • Verification link points to backend API endpoint that handles redirect
 * ═══════════════════════════════════════════════════════════════════════════════
 */
"use strict";

const logger = require("./logger");

/* ─── Resolve sendEmail ──────────────────────────────────────────────────── */
let _send = null;
for (const p of ["../utils/email", "../services/emailService", "../utils/emailService"]) {
  try {
    const mod = require(p);
    if (typeof mod.sendEmail === "function") {
      _send = mod.sendEmail;
      logger.info(`[BookingEmails] ✅ Using sendEmail from: ${p}`);
      break;
    }
  } catch { /* try next */ }
}
if (!_send) {
  logger.warn("[BookingEmails] ⚠️  No sender found — using console fallback");
  _send = async ({ to, subject }) => {
    logger.info(`[BookingEmails:console] TO: ${to} | SUBJECT: ${subject}`);
    return { success: true, provider: "console" };
  };
}

/* ─── URL sanitiser ──────────────────────────────────────────────────────── */
/**
 * Ensure a URL string:
 *   • has a protocol (defaults to https://)
 *   • has no trailing slashes
 *   • is a valid, parseable URL
 * Returns fallback if the input is invalid.
 */
const sanitiseUrl = (raw, fallback) => {
  const s = String(raw || "").trim();
  if (!s) return fallback;

  // Add protocol if missing
  let candidate = s;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  // Strip trailing slashes
  candidate = candidate.replace(/\/+$/, "");

  // Validate
  try {
    const u = new URL(candidate);
    if (!u.hostname || u.hostname === "" || u.hostname.includes("/")) {
      logger.warn(`[BookingEmails] Invalid URL host: "${raw}" → using fallback`);
      return fallback;
    }
    return candidate;
  } catch {
    logger.warn(`[BookingEmails] Malformed URL: "${raw}" → using fallback`);
    return fallback;
  }
};

/* ─── Environment ────────────────────────────────────────────────────────── */
const FRONTEND_URL = sanitiseUrl(
  process.env.FRONTEND_URL || process.env.PUBLIC_URL,
  "https://www.altuverasafaris.com",
);

const API_URL = sanitiseUrl(
  process.env.API_URL || process.env.BACKEND_URL,
  "https://backend-jd8f.onrender.com",
);

const ENV = {
  appName:      process.env.APP_NAME       || "Altuvera Safaris",
  frontendUrl:  FRONTEND_URL,
  backendUrl:   API_URL,
  adminEmail:   process.env.ADMIN_EMAIL    || "info@altuverasafaris.com",
  supportEmail: process.env.SUPPORT_EMAIL  || "info@altuverasafaris.com",
  supportPhone: process.env.SUPPORT_PHONE  || "+250 785 751 391",
  whatsappNum:  process.env.WHATSAPP_NUMBER|| "250785751391",
  year:         new Date().getFullYear(),

  logoUrl:      process.env.EMAIL_LOGO_URL ||
    "https://res.cloudinary.com/doijjawna/image/upload/v1784310147/Copilot_20260711_113926_uxs6xi.png",
  heroImage:    process.env.EMAIL_HERO_URL ||
    "https://res.cloudinary.com/doijjawna/image/upload/v1781342220/ChatGPT_Image_Jun_13_2026_11_16_51_AM_oibwwb.png",

  social: {
    instagram: "https://www.instagram.com/altuverasafaris/",
    facebook:  "https://www.facebook.com/profile.php?id=61591972225527",
    twitter:   "https://x.com/altuverasafari",
    linkedin:  "https://www.linkedin.com/in/altuvera-safari-14b9033b5/",
  },
};

logger.info(`[BookingEmails] FRONTEND_URL = ${ENV.frontendUrl}`);
logger.info(`[BookingEmails] API_URL      = ${ENV.backendUrl}`);

const WA_URL = `https://wa.me/${ENV.whatsappNum}`;

/* ════════════════════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════════════════ */
const safe = (v, fb = "—") => {
  if (v == null) return fb;
  if (typeof v === "object") { try { return JSON.stringify(v); } catch { return fb; } }
  return String(v).trim() || fb;
};

const esc = (v, fb = "—") =>
  safe(v, fb)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    if (isNaN(dt)) return safe(d);
    return dt.toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  } catch { return safe(d); }
};

const fmtDateTime = (d) => {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    if (isNaN(dt)) return safe(d);
    return dt.toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return safe(d); }
};

const daysUntil = (d) => {
  if (!d) return null;
  try {
    const diff = new Date(d).setHours(0,0,0,0) - new Date().setHours(0,0,0,0);
    return Math.ceil(diff / 86_400_000);
  } catch { return null; }
};

const humanCountdown = (d) => {
  const days = daysUntil(d);
  if (days === null) return "—";
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `in ${w} week${w > 1 ? "s" : ""}`;
  }
  if (days < 365) {
    const m = Math.floor(days / 30);
    return `in ${m} month${m > 1 ? "s" : ""}`;
  }
  return `in ${Math.floor(days / 365)} year${days >= 730 ? "s" : ""}`;
};

const toPlain = (html = "") =>
  html.replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ").trim().slice(0, 6000);

const tripName = (b) =>
  safe(b.destination_name || b.service_name || b.package_name ||
    b.destination || b.service || b.package, "Your Trip");

/* ════════════════════════════════════════════════════════════════════════════
   DESIGN TOKENS
════════════════════════════════════════════════════════════════════════════ */
const T = {
  g900: "#022c22", g800: "#064e3b", g700: "#047857",
  g600: "#059669", g500: "#10b981", g400: "#34d399",
  g300: "#6ee7b7", g200: "#a7f3d0", g100: "#d1fae5", g50: "#f0fdf4",
  n900: "#0f172a", n800: "#1e293b", n700: "#334155",
  n500: "#64748b", n400: "#94a3b8", n300: "#cbd5e1",
  n200: "#e2e8f0", n100: "#f1f5f9", n50:  "#f8fafc",
  white: "#ffffff",
  amber: "#f59e0b", amberBg: "#fffbeb", amberBd: "#fde68a",
  red:   "#dc2626", redBg:   "#fef2f2", redBd:   "#fecaca",
  blue:  "#3b82f6", blueBg:  "#eff6ff", blueBd:  "#bfdbfe",
};

const STATUS = {
  pending:   { bg: T.amberBg, color: "#92400e", bd: T.amberBd, label: "Pending Review" },
  confirmed: { bg: T.g100,    color: T.g800,    bd: T.g300,    label: "Confirmed" },
  completed: { bg: T.blueBg,  color: "#1e40af", bd: T.blueBd,  label: "Completed" },
  cancelled: { bg: T.redBg,   color: "#991b1b", bd: T.redBd,   label: "Cancelled" },
  "on-hold": { bg: "#f3e8ff", color: "#6b21a8", bd: "#d8b4fe", label: "On Hold" },
  refunded:  { bg: "#fff7ed", color: "#9a3412", bd: "#fdba74", label: "Refunded" },
};

const statusPill = (s = "pending") => {
  const st = STATUS[s] || STATUS.pending;
  return `<span style="display:inline-block;padding:6px 16px;background:${st.bg};
    color:${st.color};border:1.5px solid ${st.bd};border-radius:100px;
    font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
    font-family:'Inter',-apple-system,sans-serif;">${st.label}</span>`;
};

/* ════════════════════════════════════════════════════════════════════════════
   SOCIAL ICONS
════════════════════════════════════════════════════════════════════════════ */
const SOCIAL_ICONS = {
  instagram: "https://cdn-icons-png.flaticon.com/128/2111/2111463.png",
  facebook:  "https://cdn-icons-png.flaticon.com/128/5968/5968764.png",
  twitter:   "https://cdn-icons-png.flaticon.com/128/5968/5968958.png",
  linkedin:  "https://cdn-icons-png.flaticon.com/128/174/174857.png",
  whatsapp:  "https://cdn-icons-png.flaticon.com/128/3670/3670051.png",
  email:     "https://cdn-icons-png.flaticon.com/128/732/732200.png",
  phone:     "https://cdn-icons-png.flaticon.com/128/597/597177.png",
  location:  "https://cdn-icons-png.flaticon.com/128/684/684908.png",
};

const socialBar = () => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
    <tr>
      ${[
        ["instagram", ENV.social.instagram],
        ["facebook",  ENV.social.facebook],
        ["twitter",   ENV.social.twitter],
        ["linkedin",  ENV.social.linkedin],
      ].map(([key, url]) => `
        <td style="padding:0 6px;">
          <a href="${esc(url)}" target="_blank" style="text-decoration:none;">
            <img src="${SOCIAL_ICONS[key]}" width="34" height="34" alt="${key}"
              style="display:block;border-radius:10px;border:0;outline:none;" />
          </a>
        </td>
      `).join("")}
    </tr>
  </table>`;

/* ════════════════════════════════════════════════════════════════════════════
   EMAIL SHELL
════════════════════════════════════════════════════════════════════════════ */
const shell = ({
  preheader = "",
  body = "",
  showHero = true,
  heroBadge = "",
  heroTitle = "",
  heroSubtitle = "",
}) => `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${esc(ENV.appName)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body, table, td, p, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; display:block; }
    body { margin:0; padding:0; width:100% !important; background:#f0fdf4;
           font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
    .wrap { width:100%; background:#f0fdf4; padding:32px 16px 48px; }
    .card { max-width:620px; margin:0 auto; background:#ffffff; border-radius:24px;
            overflow:hidden; box-shadow:0 12px 48px rgba(5,150,105,.15),
                                         0 4px 12px rgba(0,0,0,.04); }
    .hero { position:relative; text-align:center; }
    .hero-overlay { background:linear-gradient(135deg, rgba(2,44,34,.85), rgba(4,120,87,.75)); }
    .btn-primary { display:inline-block; padding:15px 40px;
      background:linear-gradient(135deg,#10b981,#047857); color:#ffffff !important;
      text-decoration:none; border-radius:100px; font-size:15px; font-weight:700;
      letter-spacing:.01em; box-shadow:0 8px 24px rgba(5,150,105,.35);
      font-family:'Inter',sans-serif; }
    .btn-secondary { display:inline-block; padding:12px 30px; background:#ffffff;
      color:#047857 !important; text-decoration:none; border-radius:100px;
      font-size:14px; font-weight:600; border:2px solid #a7f3d0;
      font-family:'Inter',sans-serif; }
    .btn-wa { display:inline-block; padding:14px 32px; background:#25D366;
      color:#ffffff !important; text-decoration:none; border-radius:100px;
      font-size:14px; font-weight:700; box-shadow:0 6px 18px rgba(37,211,102,.3);
      font-family:'Inter',sans-serif; }
    .info-tbl { width:100%; border-collapse:separate; border-spacing:0;
      background:#f8fafc; border-radius:14px; overflow:hidden; }
    .info-tbl td { padding:11px 18px; font-family:'Inter',sans-serif; font-size:13.5px;
      border-bottom:1px solid #e2e8f0; vertical-align:top; }
    .info-tbl tr:last-child td { border-bottom:none; }
    .info-tbl .lbl { font-size:10.5px; font-weight:700; color:#64748b;
      text-transform:uppercase; letter-spacing:.08em; white-space:nowrap; width:130px; }
    .info-tbl .val { font-weight:600; color:#0f172a; }
    .info-tbl .highlight { color:#047857; font-weight:800; font-family:'Inter',sans-serif; }
    @media (prefers-color-scheme: dark) {
      .wrap { background:#0a1628 !important; }
      .card { background:#111827 !important; }
      .info-tbl { background:#1f2937 !important; }
      .info-tbl td { border-color:#374151 !important; color:#e5e7eb !important; }
      .info-tbl .val { color:#f9fafb !important; }
      .greeting, .body-text { color:#cbd5e1 !important; }
      .headline { color:#f8fafc !important; }
      .footer { background:#111827 !important; }
      .footer p, .footer a { color:#94a3b8 !important; }
    }
    @media only screen and (max-width:620px) {
      .wrap { padding:0 !important; }
      .card { border-radius:0 !important; }
      .content { padding:28px 20px !important; }
      .hero-inner { padding:40px 20px !important; }
      .hero-title { font-size:26px !important; }
      .info-tbl .lbl { display:block; width:auto !important; padding-bottom:2px !important; }
      .info-tbl .val { display:block; padding-top:0 !important; }
      .info-tbl td { padding:14px 16px 8px !important; }
      .btn-primary, .btn-secondary, .btn-wa { display:block !important; margin:8px auto !important;
        max-width:280px !important; text-align:center !important; }
    }
  </style>
</head>
<body>
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;
    font-size:1px;line-height:1px;color:#f0fdf4;">
    ${esc(preheader)}&nbsp;&#8203;&zwnj;&nbsp;&#8203;&zwnj;&nbsp;
  </div>

  <div class="wrap">
    <div class="card">
      ${showHero ? `
      <div class="hero" style="background-image:url('${ENV.heroImage}');
        background-size:cover;background-position:center;background-color:#022c22;">
        <div class="hero-overlay">
          <div class="hero-inner" style="padding:56px 40px;text-align:center;">
            <img src="${ENV.logoUrl}" width="80" height="80" alt="${esc(ENV.appName)}"
              style="display:block;margin:0 auto 20px;border-radius:16px;
              background:rgba(255,255,255,.15);padding:8px;" />
            <h1 style="margin:0;color:#ffffff;font-family:'Playfair Display',Georgia,serif;
              font-size:32px;font-weight:700;letter-spacing:-.5px;line-height:1.2;">
              ${esc(ENV.appName)}
            </h1>
            <p style="margin:6px 0 0;color:#a7f3d0;font-size:11px;font-weight:600;
              letter-spacing:3px;text-transform:uppercase;font-family:'Inter',sans-serif;">
              Premium East African Safaris
            </p>
            ${heroBadge ? `<div style="margin-top:24px;">${heroBadge}</div>` : ""}
            ${heroTitle ? `
            <h2 class="hero-title" style="margin:28px 0 8px;color:#ffffff;
              font-family:'Playfair Display',Georgia,serif;font-size:30px;
              font-weight:700;line-height:1.25;letter-spacing:-.5px;">
              ${esc(heroTitle)}
            </h2>` : ""}
            ${heroSubtitle ? `
            <p style="margin:0;color:rgba(255,255,255,.85);font-size:15px;
              line-height:1.6;max-width:440px;margin-left:auto;margin-right:auto;
              font-family:'Inter',sans-serif;">
              ${esc(heroSubtitle)}
            </p>` : ""}
          </div>
        </div>
      </div>
      ` : ""}

      <div class="content" style="padding:40px 44px;">
        ${body}
      </div>

      <div class="footer" style="background:#f8fafc;border-top:1px solid #e2e8f0;
        padding:32px 40px;text-align:center;">
        <div style="margin-bottom:20px;">
          ${socialBar()}
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
          <tr>
            <td style="padding:0 10px;">
              <a href="mailto:${ENV.supportEmail}" style="text-decoration:none;color:#64748b;
                font-size:12px;font-family:'Inter',sans-serif;font-weight:500;">
                <img src="${SOCIAL_ICONS.email}" width="14" height="14"
                  style="display:inline-block;vertical-align:middle;margin-right:5px;border:0;" alt="" />
                ${esc(ENV.supportEmail)}
              </a>
            </td>
            <td style="color:#cbd5e1;">·</td>
            <td style="padding:0 10px;">
              <a href="${ENV.frontendUrl}" style="text-decoration:none;color:#64748b;
                font-size:12px;font-family:'Inter',sans-serif;font-weight:500;">
                🌐 altuverasafaris.com
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 6px;font-size:11.5px;color:#94a3b8;
          font-family:'Inter',sans-serif;line-height:1.6;">
          Crafting unforgettable East African adventures since ${ENV.year}
        </p>
        <p style="margin:0;font-size:11px;color:#cbd5e1;font-family:'Inter',sans-serif;">
          © ${ENV.year} ${esc(ENV.appName)} · All rights reserved
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;

/* ════════════════════════════════════════════════════════════════════════════
   REUSABLE BLOCKS
════════════════════════════════════════════════════════════════════════════ */
const row = (label, value, highlight = false) => {
  const v = safe(value);
  if (!v || v === "—") return "";
  return `<tr>
    <td class="lbl">${esc(label)}</td>
    <td class="val ${highlight ? "highlight" : ""}">${esc(v)}</td>
  </tr>`;
};

const infoTable = (title, rows) => {
  const content = rows.filter(Boolean).join("");
  if (!content.trim()) return "";
  return `
    <div style="margin:24px 0;">
      ${title ? `
      <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#047857;
        text-transform:uppercase;letter-spacing:.12em;font-family:'Inter',sans-serif;">
        ${esc(title)}
      </p>` : ""}
      <table class="info-tbl" role="presentation" cellpadding="0" cellspacing="0">
        <tbody>${content}</tbody>
      </table>
    </div>`;
};

const bookingSummary = (b) => {
  const dest = tripName(b);
  const country = safe(b.country_name || b.country);
  const travelers = Number(b.number_of_travelers) || 1;
  const adults = Number(b.number_of_adults);
  const children = Number(b.number_of_children);
  const trStr = adults > 0
    ? `${travelers} (${adults} adult${adults > 1 ? "s" : ""}${children > 0 ? `, ${children} child${children > 1 ? "ren" : ""}` : ""})`
    : String(travelers);

  return infoTable("Booking Summary", [
    row("Reference",     b.booking_number, true),
    row("Destination",   dest !== "Your Trip" ? dest : null),
    row("Country",       country !== "—" ? country : null),
    row("Departure",     fmtDate(b.travel_date)),
    row("Return",        fmtDate(b.return_date)),
    row("Travelers",     travelers > 0 ? trStr : null),
    row("Accommodation", b.accommodation_type),
  ]);
};

const heading = (text) => `
  <h1 class="headline" style="margin:0 0 14px;font-family:'Playfair Display',Georgia,serif;
    font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;letter-spacing:-.3px;">
    ${esc(text)}
  </h1>`;

const para = (html) => `
  <p class="body-text" style="margin:0 0 16px;font-family:'Inter',sans-serif;
    font-size:15px;color:#334155;line-height:1.7;">
    ${html}
  </p>`;

const greet = (name) => `
  <p class="greeting" style="margin:0 0 6px;font-family:'Inter',sans-serif;
    font-size:16px;color:#0f172a;font-weight:600;">
    Hi ${esc(safe(name, "there"))},
  </p>`;

const ctaBlock = (primaryText, primaryUrl, secondaryText, secondaryUrl) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 20px;">
    <tr><td align="center" style="padding-bottom:${secondaryText ? "12px" : "0"};">
      <a href="${esc(primaryUrl)}" class="btn-primary"
        style="display:inline-block;padding:15px 40px;
          background:linear-gradient(135deg,#10b981,#047857);
          color:#ffffff !important;text-decoration:none;border-radius:100px;
          font-family:'Inter',sans-serif;font-size:15px;font-weight:700;
          box-shadow:0 8px 24px rgba(5,150,105,.35);">
        ${esc(primaryText)}
      </a>
    </td></tr>
    ${secondaryText && secondaryUrl ? `
    <tr><td align="center">
      <a href="${esc(secondaryUrl)}" class="btn-secondary"
        style="display:inline-block;padding:12px 30px;background:#ffffff;
          color:#047857 !important;text-decoration:none;border-radius:100px;
          font-family:'Inter',sans-serif;font-size:14px;font-weight:600;
          border:2px solid #a7f3d0;">
        ${esc(secondaryText)}
      </a>
    </td></tr>` : ""}
  </table>`;

const divider = () => `
  <div style="height:1px;background:linear-gradient(90deg,transparent,#e2e8f0,transparent);
    margin:24px 0;"></div>`;

const notice = (type, title, message) => {
  const styles = {
    info:    { bg: T.blueBg,  bd: T.blueBd,  border: T.blue,  color: "#1e40af" },
    success: { bg: T.g50,     bd: T.g200,    border: T.g500,  color: T.g800 },
    warning: { bg: T.amberBg, bd: T.amberBd, border: T.amber, color: "#92400e" },
    error:   { bg: T.redBg,   bd: T.redBd,   border: T.red,   color: "#991b1b" },
  };
  const s = styles[type] || styles.info;
  return `
  <div style="background:${s.bg};border:1px solid ${s.bd};border-left:4px solid ${s.border};
    border-radius:0 12px 12px 0;padding:14px 18px;margin:18px 0;">
    ${title ? `
    <p style="margin:0 0 4px;font-family:'Inter',sans-serif;font-size:11px;
      font-weight:700;color:${s.color};text-transform:uppercase;letter-spacing:.08em;">
      ${esc(title)}
    </p>` : ""}
    <p style="margin:0;font-family:'Inter',sans-serif;font-size:14px;
      color:${s.color};line-height:1.6;">
      ${message}
    </p>
  </div>`;
};

const countdownBox = (days, destination, travelDate) => `
  <div style="background:linear-gradient(145deg,#022c22,#064e3b,#047857);
    border-radius:20px;padding:36px 24px;text-align:center;margin:24px 0;
    box-shadow:0 8px 28px rgba(4,120,87,.25);">
    <p style="margin:0 0 10px;font-family:'Inter',sans-serif;font-size:11px;
      font-weight:700;color:#a7f3d0;text-transform:uppercase;letter-spacing:.15em;">
      Your Adventure Begins
    </p>
    ${days > 1 ? `
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:${days >= 100 ? "68px" : "88px"};
      font-weight:800;color:#34d399;line-height:1;">
      ${days}
    </div>
    <p style="margin:6px 0 0;font-family:'Inter',sans-serif;font-size:13px;
      color:rgba(255,255,255,.7);font-weight:600;text-transform:uppercase;
      letter-spacing:.15em;">
      day${days !== 1 ? "s" : ""} to go
    </p>` : `
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:44px;
      font-weight:800;color:#34d399;line-height:1.2;">
      ${days === 0 ? "Today!" : "Tomorrow!"}
    </div>`}
    <div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,.15);">
      <p style="margin:0;font-family:'Inter',sans-serif;font-size:15px;
        color:#ffffff;font-weight:600;">
        ${esc(destination)}
      </p>
      <p style="margin:4px 0 0;font-family:'Inter',sans-serif;font-size:13px;
        color:rgba(255,255,255,.65);">
        ${fmtDate(travelDate)}
      </p>
    </div>
  </div>`;

const step = (num, text) => `
  <tr>
    <td style="width:34px;padding:10px 12px 10px 0;vertical-align:top;">
      <div style="width:26px;height:26px;border-radius:50%;
        background:linear-gradient(135deg,#10b981,#047857);color:#ffffff;
        font-family:'Inter',sans-serif;font-size:12px;font-weight:800;
        text-align:center;line-height:26px;">
        ${num}
      </div>
    </td>
    <td style="padding:10px 0;font-family:'Inter',sans-serif;font-size:14px;
      color:#334155;line-height:1.6;vertical-align:middle;">
      ${text}
    </td>
  </tr>`;

const stepList = (items) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">
    ${items.map((t, i) => step(i + 1, t)).join("")}
  </table>`;

/* ════════════════════════════════════════════════════════════════════════════
   URL BUILDERS
════════════════════════════════════════════════════════════════════════════ */

/**
 * Build a verification URL that hits the BACKEND directly.
 * The backend endpoint marks the booking verified and redirects to frontend.
 *
 * Example output:
 *   https://backend-jd8f.onrender.com/api/bookings/verify-email/abc123xyz
 */
const buildVerificationLink = (token) => {
  if (!token) throw new Error("buildVerificationLink: token is required");
  const clean = encodeURIComponent(String(token).trim());
  const url = `${ENV.backendUrl}/api/bookings/verify-email/${clean}`;

  // Sanity check — never let a malformed URL escape
  try {
    const u = new URL(url);
    if (!u.hostname) throw new Error("no host");
    return url;
  } catch (err) {
    logger.error(`[BookingEmails] buildVerificationLink produced invalid URL: "${url}" — ${err.message}`);
    throw new Error(`Malformed verification URL: ${url}`);
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   SAFE SEND WRAPPER
════════════════════════════════════════════════════════════════════════════ */
const safeSend = async (to, subject, html, label = "") => {
  try {
    if (!to) {
      logger.warn(`[BookingEmails] ${label}: no recipient — skipping`);
      return { success: false, error: "No recipient" };
    }
    const text = toPlain(html);
    const result = await _send({ to, subject, html, text });
    logger.info(`[BookingEmails] ✅ ${label} → ${to}`);
    return result || { success: true };
  } catch (err) {
    logger.error(`[BookingEmails] ❌ ${label} failed → ${to}: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   ═══════════════════  EMAIL TEMPLATES  ═══════════════════════════════════
════════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────────────────
   1. VERIFICATION LINK
───────────────────────────────────────────────────────────────────────── */
const sendBookingVerificationLink = async (booking, token) => {
  try {
    if (!booking?.email) {
      logger.warn("[BookingEmails] sendBookingVerificationLink: booking.email missing");
      return { success: false, error: "No email" };
    }
    if (!token) {
      logger.warn("[BookingEmails] sendBookingVerificationLink: token missing");
      return { success: false, error: "No token" };
    }

    const verifyUrl   = buildVerificationLink(token);
    const displayName = safe(booking.full_name, "traveller");
    const destination = tripName(booking);
    const bookingRef  = safe(booking.booking_number);

    logger.info(`[BookingEmails] Verification link → ${verifyUrl}`);

    const html = shell({
      preheader: `Confirm your email to complete your ${destination} booking.`,
      heroBadge: `<span style="display:inline-block;padding:7px 18px;
        background:rgba(255,255,255,.18);border:1.5px solid rgba(255,255,255,.35);
        border-radius:100px;color:#ffffff;font-family:'Inter',sans-serif;
        font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
        ✉️ Verify Your Email
      </span>`,
      heroTitle: "Confirm your booking",
      heroSubtitle: "One quick click and our team can start planning your adventure.",
      body: `
        ${greet(displayName)}
        ${para(`Thanks for booking <strong style="color:${T.g700};">${esc(destination)}</strong>
          with us. Please confirm your email address so we can start planning your journey.`)}

        ${infoTable("Booking Reference", [
          row("Reference", bookingRef, true),
          row("Destination", destination !== "Your Trip" ? destination : null),
        ])}

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
          <tr><td align="center">
            <a href="${esc(verifyUrl)}"
              style="display:inline-block;padding:16px 44px;
                background:linear-gradient(135deg,#10b981,#047857);
                color:#ffffff !important;text-decoration:none;border-radius:100px;
                font-family:'Inter',sans-serif;font-size:15px;font-weight:700;
                box-shadow:0 8px 24px rgba(5,150,105,.35);">
              ✅ Confirm My Booking
            </a>
          </td></tr>
        </table>

        <p style="margin:20px 0 8px;font-family:'Inter',sans-serif;font-size:12px;
          color:${T.n500};line-height:1.6;">
          If the button doesn't work, copy and paste this link into your browser:
        </p>
        <div style="padding:12px 14px;background:${T.n50};border:1px solid ${T.n200};
          border-radius:10px;font-family:monospace;font-size:12px;color:${T.n700};
          word-break:break-all;line-height:1.5;margin-bottom:20px;">
          ${esc(verifyUrl)}
        </div>

        ${notice("warning", "Link expires in 24 hours",
          "For security, this verification link is valid for 24 hours. " +
          "If it expires, you can request a new one from the confirmation page.")}
      `,
    });

    return safeSend(
      booking.email,
      `Confirm Your Booking — ${destination} | ${ENV.appName}`,
      html,
      "sendBookingVerificationLink",
    );
  } catch (err) {
    logger.error(`[BookingEmails] sendBookingVerificationLink failed: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   2. BOOKING RECEIVED
───────────────────────────────────────────────────────────────────────── */
const sendBookingReceivedEmail = async (booking) => {
  if (!booking?.email) return { success: false };
  const dest = tripName(booking);

  const html = shell({
    preheader: `Booking received for ${dest} — we'll contact you within 24 hours.`,
    heroBadge: statusPill("pending"),
    heroTitle: "Your journey begins here",
    heroSubtitle: "We've received your booking request and our team is already reviewing it.",
    body: `
      ${greet(booking.full_name)}
      ${para(`We're delighted you chose <strong style="color:${T.g700};">${esc(ENV.appName)}</strong>
        for your <strong>${esc(dest)}</strong> adventure. Our travel experts will contact you
        within <strong style="color:${T.g600};">24 hours</strong> to craft your perfect itinerary.`)}
      ${bookingSummary(booking)}
      <p style="margin:24px 0 12px;font-family:'Inter',sans-serif;font-size:11px;
        font-weight:700;color:${T.g700};text-transform:uppercase;letter-spacing:.12em;">
        What Happens Next
      </p>
      ${stepList([
        "Our team reviews availability for your dates",
        "A dedicated coordinator contacts you within <strong>24 hours</strong>",
        "We design your personalised itinerary",
        "You receive a custom quote — <strong>no payment required yet</strong>",
        "Once approved, we confirm your booking",
      ])}
      ${notice("info", "While You Wait",
        `Feel free to <a href="${WA_URL}" style="color:${T.blue};font-weight:600;">
          chat with us on WhatsApp</a> if you have any questions — our experts are available 7 days a week.`)}
      ${ctaBlock("Track My Booking", `${ENV.frontendUrl}/my-bookings`, "Contact Support", `mailto:${ENV.supportEmail}`)}
    `,
  });

  return safeSend(
    booking.email,
    `Booking Received — ${safe(booking.booking_number)} | ${ENV.appName}`,
    html,
    "sendBookingReceivedEmail",
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   3. ADMIN NOTIFICATION
───────────────────────────────────────────────────────────────────────── */
const sendAdminBookingNotification = async (booking) => {
  if (!ENV.adminEmail) return { success: false };
  const dest = tripName(booking);
  const name = safe(booking.full_name);
  const email = safe(booking.email);
  const phone = safe(booking.phone);
  const wa = phone !== "—" ? phone.replace(/\D/g, "") : null;
  const adminUrl = `${ENV.frontendUrl}/admin/bookings`;
  const travelers = Number(booking.number_of_travelers) || 1;

  const html = shell({
    preheader: `New booking: ${name} → ${dest} (${safe(booking.booking_number)})`,
    heroBadge: `<span style="display:inline-block;padding:7px 18px;
      background:rgba(245,158,11,.25);border:1.5px solid rgba(251,191,36,.6);
      border-radius:100px;color:#fef3c7;font-family:'Inter',sans-serif;
      font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
      🔔 Action Required
    </span>`,
    heroTitle: "New Verified Booking",
    heroSubtitle: `${name} has submitted a booking for ${dest}. Ready for your review.`,
    body: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
        <tr>
          ${[
            ["Reference", safe(booking.booking_number)],
            ["Travelers", String(travelers)],
            ["Source", safe(booking.source, "website")],
            ["Verified", "✓ Yes"],
          ].map(([l, v]) => `
          <td style="width:25%;padding:0 4px;vertical-align:top;">
            <div style="background:${T.g50};border:1px solid ${T.g200};
              border-radius:12px;padding:14px 10px;text-align:center;">
              <div style="font-family:'Inter',sans-serif;font-size:15px;font-weight:800;
                color:${T.g800};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${esc(v)}
              </div>
              <div style="font-family:'Inter',sans-serif;font-size:10px;color:${T.n500};
                margin-top:4px;text-transform:uppercase;letter-spacing:.08em;font-weight:600;">
                ${esc(l)}
              </div>
            </div>
          </td>`).join("")}
        </tr>
      </table>

      ${infoTable("Customer", [
        row("Name",        name),
        row("Email",       email),
        row("Phone",       phone),
        row("WhatsApp",    booking.whatsapp),
        row("Nationality", booking.nationality),
        row("Country",     booking.country),
      ])}

      ${infoTable("Trip", [
        row("Reference",     booking.booking_number, true),
        row("Destination",   dest),
        row("Country",       booking.country_name),
        row("Departure",     fmtDate(booking.travel_date)),
        row("Return",        fmtDate(booking.return_date)),
        row("Adults",        booking.number_of_adults),
        row("Children",      booking.number_of_children),
        row("Accommodation", booking.accommodation_type),
        row("Dietary",       booking.dietary_requirements),
        row("Submitted",     fmtDateTime(booking.created_at)),
      ])}

      ${booking.special_requests ? notice("warning", "Special Requests",
        `<span style="white-space:pre-wrap;">${esc(booking.special_requests)}</span>`) : ""}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
        <tr><td align="center" style="padding-bottom:12px;">
          <a href="${esc(adminUrl)}" class="btn-primary"
            style="display:inline-block;padding:16px 44px;
              background:linear-gradient(135deg,#10b981,#047857);
              color:#ffffff !important;text-decoration:none;border-radius:100px;
              font-family:'Inter',sans-serif;font-size:15px;font-weight:700;
              box-shadow:0 8px 24px rgba(5,150,105,.35);">
            Open Admin Panel
          </a>
        </td></tr>
        <tr><td align="center">
          <a href="mailto:${esc(email)}?subject=Re: Your ${esc(dest)} Booking — ${esc(safe(booking.booking_number))}"
            style="display:inline-block;padding:11px 24px;margin:4px;
              background:#ffffff;color:${T.g700} !important;text-decoration:none;
              border-radius:100px;font-family:'Inter',sans-serif;font-size:13px;
              font-weight:600;border:2px solid ${T.g200};">
            Reply to Customer
          </a>
          ${wa ? `
          <a href="https://wa.me/${wa}"
            style="display:inline-block;padding:11px 24px;margin:4px;
              background:#25D366;color:#ffffff !important;text-decoration:none;
              border-radius:100px;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;">
            WhatsApp Customer
          </a>` : ""}
        </td></tr>
      </table>
    `,
  });

  return safeSend(
    ENV.adminEmail,
    `[New Booking] ${safe(booking.booking_number)} — ${name} → ${dest}`,
    html,
    "sendAdminBookingNotification",
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   4. BOOKING CONFIRMED
───────────────────────────────────────────────────────────────────────── */
const sendBookingConfirmation = async (booking) => {
  if (!booking?.email) return { success: false };
  const dest = tripName(booking);
  const days = daysUntil(booking.travel_date);

  const html = shell({
    preheader: `Your ${dest} adventure is confirmed! ${days !== null ? humanCountdown(booking.travel_date) : ""}`,
    heroBadge: statusPill("confirmed"),
    heroTitle: "Your adventure is confirmed",
    heroSubtitle: `Pack your bags — ${dest} is waiting for you.`,
    body: `
      ${greet(booking.full_name)}
      ${para(`Wonderful news — your safari to <strong style="color:${T.g700};">${esc(dest)}</strong>
        has been <strong>officially confirmed</strong>. We're excited to be part of your journey.`)}
      ${days !== null && days >= 0 ? countdownBox(days, dest, booking.travel_date) : ""}
      ${bookingSummary({ ...booking, status: "confirmed" })}
      ${booking.confirmation_code ? `
      <div style="background:${T.g50};border:2px solid ${T.g400};border-radius:14px;
        padding:22px;text-align:center;margin:20px 0;">
        <p style="margin:0 0 6px;font-family:'Inter',sans-serif;font-size:10.5px;
          font-weight:700;color:${T.g600};text-transform:uppercase;letter-spacing:.15em;">
          Confirmation Code
        </p>
        <p style="margin:0;font-family:'Inter',sans-serif;font-size:28px;font-weight:800;
          color:${T.g700};letter-spacing:6px;">
          ${esc(booking.confirmation_code)}
        </p>
      </div>` : ""}
      <p style="margin:24px 0 12px;font-family:'Inter',sans-serif;font-size:11px;
        font-weight:700;color:${T.g700};text-transform:uppercase;letter-spacing:.12em;">
        Before You Travel
      </p>
      ${stepList([
        "Ensure your passport is valid for at least <strong>6 months</strong>",
        "Check visa requirements for your destination",
        "Arrange comprehensive travel insurance",
        "Your coordinator will send a detailed itinerary shortly",
      ])}
      ${ctaBlock("View My Booking", `${ENV.frontendUrl}/my-bookings`, "Chat on WhatsApp", WA_URL)}
    `,
  });

  return safeSend(
    booking.email,
    `Confirmed: ${dest} — ${safe(booking.booking_number)} | ${ENV.appName}`,
    html,
    "sendBookingConfirmation",
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   5. STATUS UPDATE
───────────────────────────────────────────────────────────────────────── */
const sendBookingStatusUpdate = async (booking, fromStatus, toStatus, reason = "") => {
  if (!booking?.email) return { success: false };
  const dest = tripName(booking);
  const st = STATUS[toStatus] || STATUS.pending;
  const fromLabel = STATUS[fromStatus]?.label || safe(fromStatus);

  const messages = {
    pending:   "Your booking is being reviewed. We'll be in touch shortly.",
    confirmed: "Your booking is confirmed. Get ready for an incredible adventure!",
    "on-hold": "Your booking is temporarily on hold pending additional details.",
    completed: "Your safari is complete. Thank you for travelling with us.",
    cancelled: "Your booking has been cancelled.",
    refunded:  "Your refund has been processed. Please allow 5–10 business days.",
  };

  const html = shell({
    preheader: `Booking ${safe(booking.booking_number)}: ${st.label}`,
    heroBadge: statusPill(toStatus),
    heroTitle: `Status Updated: ${st.label}`,
    heroSubtitle: messages[toStatus] || "Your booking status has been updated.",
    body: `
      ${greet(booking.full_name)}
      ${para(messages[toStatus] || "Your booking status has been updated.")}
      ${infoTable("Status Change", [
        row("Reference",   booking.booking_number, true),
        row("Destination", dest !== "Your Trip" ? dest : null),
        row("Travel Date", fmtDate(booking.travel_date)),
        row("Previous",    fromLabel),
        row("Now",         st.label),
        row("Updated",     fmtDateTime(new Date())),
      ])}
      ${reason ? notice("info", "Note from Our Team", esc(reason)) : ""}
      ${toStatus === "completed" ? notice("success", "Thank You",
        "We'd love to hear about your experience — leave us a review and let's plan your next adventure!") : ""}
      ${ctaBlock("View My Booking", `${ENV.frontendUrl}/my-bookings`, "Contact Support", `mailto:${ENV.supportEmail}`)}
    `,
  });

  return safeSend(
    booking.email,
    `Booking ${st.label} — ${safe(booking.booking_number)} | ${ENV.appName}`,
    html,
    `sendBookingStatusUpdate(${fromStatus}→${toStatus})`,
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   6. CANCELLATION
───────────────────────────────────────────────────────────────────────── */
const sendBookingCancellation = async (booking, reason = "") => {
  if (!booking?.email) return { success: false };
  const dest = tripName(booking);

  const html = shell({
    preheader: `Booking ${safe(booking.booking_number)} cancelled.`,
    heroBadge: statusPill("cancelled"),
    heroTitle: "Booking Cancelled",
    heroSubtitle: "We're sorry to see this booking cancelled. Africa will be here when you're ready.",
    body: `
      ${greet(booking.full_name)}
      ${para(`We're sorry to inform you that your booking for <strong>${esc(dest)}</strong>
        has been cancelled. We apologise for any inconvenience this may cause.`)}
      ${infoTable("Cancelled Booking", [
        row("Reference",   booking.booking_number, true),
        row("Destination", dest !== "Your Trip" ? dest : null),
        row("Travel Date", fmtDate(booking.travel_date)),
        row("Cancelled",   fmtDateTime(new Date())),
      ])}
      ${reason ? notice("error", "Cancellation Reason", esc(reason)) : ""}
      ${notice("info", "Refund Information",
        "If a payment was made, a full refund will be processed within 5–10 business days to your original payment method.")}
      <div style="background:linear-gradient(135deg,#022c22,#047857);border-radius:16px;
        padding:28px 24px;text-align:center;margin:24px 0;">
        <h3 style="margin:0 0 8px;font-family:'Playfair Display',Georgia,serif;
          font-size:22px;font-weight:700;color:#ffffff;">
          Ready when you are
        </h3>
        <p style="margin:0 0 20px;font-family:'Inter',sans-serif;font-size:14px;
          color:rgba(255,255,255,.8);line-height:1.6;">
          Our destinations aren't going anywhere. Let's plan your next adventure.
        </p>
        <a href="${ENV.frontendUrl}/destinations"
          style="display:inline-block;padding:12px 32px;background:#ffffff;
            color:${T.g700} !important;text-decoration:none;border-radius:100px;
            font-family:'Inter',sans-serif;font-size:13px;font-weight:700;">
          Browse Destinations
        </a>
      </div>
      ${ctaBlock("Talk to Our Team", WA_URL, "Email Support", `mailto:${ENV.supportEmail}`)}
    `,
  });

  return safeSend(
    booking.email,
    `Cancelled — ${safe(booking.booking_number)} | ${ENV.appName}`,
    html,
    "sendBookingCancellation",
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   7. TRIP COUNTDOWN
───────────────────────────────────────────────────────────────────────── */
const sendTripCountdownEmail = async (booking) => {
  if (!booking?.email || !booking?.travel_date) return { success: false };
  const days = daysUntil(booking.travel_date);
  if (days === null || days < 0) return { success: false, error: "Past date" };

  const MILESTONES = [60, 30, 14, 7, 3, 1, 0];
  if (!MILESTONES.includes(days)) return { success: false, error: "Not a milestone" };

  const dest = tripName(booking);

  const CONTENT = {
    0: {
      urgency: "Today is the day!",
      title: "Your adventure starts today",
      sub: "This is it — safe travels and enjoy every magical moment.",
      tips: [
        "Double-check passport, tickets, and documents",
        "Arrive at airport 3 hours before departure",
        "Charge all devices — capture every moment",
        "Our guide will meet you at the arranged location",
      ],
    },
    1: {
      urgency: "One day to go",
      title: "You leave tomorrow",
      sub: "Time for final preparations. Get a good night's sleep!",
      tips: [
        "Lay out everything you need tonight",
        "Confirm pick-up time with our team",
        "Pack medications in your carry-on",
        "Charge all devices and clear memory cards",
      ],
    },
    3: {
      urgency: "3 days to go",
      title: "Almost there",
      sub: "Your African adventure is just three days away.",
      tips: [
        "Finalise packing — include layers for morning drives",
        "Print booking confirmation and travel insurance",
        "Download offline maps for your destination",
        "Get local currency for tips and small purchases",
      ],
    },
    7: {
      urgency: "One week to go",
      title: "Your safari is next week",
      sub: "Here's your pre-departure checklist.",
      tips: [
        "Complete packing — check weather forecast",
        "Confirm passport valid for 6+ months",
        "Save your guide's contact number",
        "Test camera and pack extra memory cards",
      ],
    },
    14: {
      urgency: "Two weeks to go",
      title: "Two weeks until adventure",
      sub: "Time to prepare for your East African safari.",
      tips: [
        "Start packing non-essential items",
        "Ensure vaccinations are completed",
        "Pick up prescription medications",
        "Review your itinerary and ask any questions",
      ],
    },
    30: {
      urgency: "One month to go",
      title: "One month until your safari",
      sub: "The countdown begins — here's what to prepare.",
      tips: [
        "Book internal flights or transfers if needed",
        "Start your packing checklist",
        "Confirm travel insurance covers activities",
        "Share your itinerary with a trusted contact",
      ],
    },
    60: {
      urgency: "60 days to go",
      title: "Your adventure in 60 days",
      sub: "Two months out — the perfect time to plan.",
      tips: [
        "Apply for required visas (4–6 weeks processing)",
        "Schedule required vaccinations",
        "Purchase comprehensive travel insurance",
        "Research packing essentials for East Africa",
      ],
    },
  };

  const c = CONTENT[days] || CONTENT[7];

  const html = shell({
    preheader: `${c.urgency} — Your ${dest} adventure. ${c.sub}`,
    heroBadge: `<span style="display:inline-block;padding:7px 18px;
      background:rgba(52,211,153,.25);border:1.5px solid rgba(52,211,153,.5);
      border-radius:100px;color:#a7f3d0;font-family:'Inter',sans-serif;
      font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
      ${esc(c.urgency)}
    </span>`,
    heroTitle: c.title,
    heroSubtitle: c.sub,
    body: `
      ${greet(booking.full_name)}
      ${para(c.sub)}
      ${countdownBox(days, dest, booking.travel_date)}
      ${infoTable("Your Trip", [
        row("Reference",   booking.booking_number, true),
        row("Destination", dest !== "Your Trip" ? dest : null),
        row("Country",     booking.country_name),
        row("Departure",   fmtDate(booking.travel_date)),
        row("Return",      fmtDate(booking.return_date)),
        row("Travelers",   booking.number_of_travelers),
      ])}
      <p style="margin:24px 0 12px;font-family:'Inter',sans-serif;font-size:11px;
        font-weight:700;color:${T.g700};text-transform:uppercase;letter-spacing:.12em;">
        ${days <= 3 ? "Final Checklist" : "Preparation Tips"}
      </p>
      ${stepList(c.tips)}
      ${ctaBlock("View Full Booking", `${ENV.frontendUrl}/my-bookings`, "Contact Coordinator", `mailto:${ENV.supportEmail}`)}
    `,
  });

  return safeSend(
    booking.email,
    `${c.urgency} — ${dest} | ${ENV.appName}`,
    html,
    `sendTripCountdownEmail(${days}d)`,
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   8. CANCELLATION REQUEST ACK
───────────────────────────────────────────────────────────────────────── */
const sendCancellationRequestAck = async (booking, requestType = "cancellation") => {
  if (!booking?.email) return { success: false };
  const dest = tripName(booking);
  const label = requestType === "refund" ? "Refund" : "Cancellation";

  const html = shell({
    preheader: `${label} request received for ${safe(booking.booking_number)}.`,
    heroBadge: `<span style="display:inline-block;padding:7px 18px;
      background:rgba(255,255,255,.18);border:1.5px solid rgba(255,255,255,.35);
      border-radius:100px;color:#ffffff;font-family:'Inter',sans-serif;
      font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
      📝 Under Review
    </span>`,
    heroTitle: `${label} Request Received`,
    heroSubtitle: "Our team will review your request within 24–48 hours.",
    body: `
      ${greet(booking.full_name)}
      ${para(`We've received your <strong>${esc(label.toLowerCase())} request</strong>
        for booking <strong style="color:${T.g700};">${esc(safe(booking.booking_number))}</strong>
        (${esc(dest)}). Our team will review it and respond within
        <strong>24–48 hours</strong>.`)}
      ${bookingSummary(booking)}
      ${notice("info", "Important",
        `Your booking remains <strong>active</strong> until we've reviewed your ${label.toLowerCase()} request.
         We'll notify you by email of our decision.`)}
      ${ctaBlock("View My Booking", `${ENV.frontendUrl}/my-bookings`, "Chat on WhatsApp", WA_URL)}
    `,
  });

  return safeSend(
    booking.email,
    `${label} Request Received — ${safe(booking.booking_number)} | ${ENV.appName}`,
    html,
    "sendCancellationRequestAck",
  );
};

/* ════════════════════════════════════════════════════════════════════════════
   EXPORTS
════════════════════════════════════════════════════════════════════════════ */
module.exports = {
  sendBookingVerificationLink,
  sendBookingReceivedEmail,
  sendAdminBookingNotification,
  sendBookingConfirmation,
  sendBookingStatusUpdate,
  sendBookingCancellation,
  sendTripCountdownEmail,
  sendCancellationRequestAck,
  buildVerificationLink,   // exported for testing
};  