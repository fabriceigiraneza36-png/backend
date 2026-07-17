// utils/bookingEmails.js
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA SAFARIS — Premium Booking Email System
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * All emails use a consistent, gorgeous green/white branded template that
 * matches the Altuvera website aesthetic. Every email is:
 *   ✅ Mobile-first responsive
 *   ✅ Works in Gmail, Outlook, Apple Mail, Yahoo
 *   ✅ WCAG accessible (contrast, alt text, semantic structure)
 *   ✅ Dark-mode aware
 *   ✅ Plain-text fallbacks
 *   ✅ No broken [object Object] — all values safely stringified
 *
 * Functions exported:
 *   sendBookingVerificationLink    — guest submits → verify email first
 *   sendBookingReceivedEmail       — after verification / auth submit
 *   sendAdminBookingNotification   — alert admin of new verified booking
 *   sendBookingConfirmation        — admin confirms booking
 *   sendBookingStatusUpdate        — any status change
 *   sendBookingCancellation        — booking cancelled
 *   sendTripCountdownEmail         — X days to departure milestones
 *   sendCancellationRequestAck     — user requested cancellation/refund
 * ═══════════════════════════════════════════════════════════════════════════════
 */
"use strict";

const logger = require("./logger");

/* ─── Resolve the best available sendEmail function ─────────────────────── */
let _send = null;

const SENDER_PATHS = [
  "../utils/email",
  "../services/emailService",
  "../utils/emailService",
];

for (const p of SENDER_PATHS) {
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
  logger.warn("[BookingEmails] ⚠️  No email sender found — using console fallback");
  _send = async ({ to, subject, html }) => {
    logger.info(`[BookingEmails:console] TO: ${to} | SUBJECT: ${subject}`);
    return { success: true, provider: "console" };
  };
}

/* ─── Environment ────────────────────────────────────────────────────────── */
const ENV = {
  appName:      process.env.APP_NAME      || "Altuvera Safaris",
  frontendUrl:  process.env.FRONTEND_URL  || "https://www.altuverasafaris.com",
  backendUrl:   process.env.BACKEND_URL   || "https://backend-jd8f.onrender.com",
  adminEmail:   process.env.ADMIN_EMAIL   || "altuverasafari@gmail.com",
  supportEmail: process.env.SUPPORT_EMAIL || "altuverasafari@gmail.com",
  supportPhone: process.env.SUPPORT_PHONE || "+250 785 751 391",
  whatsappNum:  process.env.WHATSAPP_NUMBER || "250785751391",
  year:         new Date().getFullYear(),
};

const WA_URL = `https://wa.me/${ENV.whatsappNum}`;

/* ════════════════════════════════════════════════════════════════════════════
   ── UTILITY FUNCTIONS ────────────────────────────────────────────────────
════════════════════════════════════════════════════════════════════════════ */

/** Safely stringify any value for display */
const safe = (v, fallback = "—") => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return fallback; }
  }
  return String(v).trim() || fallback;
};

/** HTML-escape a string */
const esc = (v, fallback = "—") => {
  const s = safe(v, fallback);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

/** Format a date for display */
const fmtDate = (d) => {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return safe(d);
    return dt.toLocaleDateString("en-US", {
      weekday: "long", year: "numeric",
      month: "long", day: "numeric",
    });
  } catch { return safe(d); }
};

/** Format date + time */
const fmtDateTime = (d) => {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return safe(d);
    return dt.toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return safe(d); }
};

/** Days until a date (from today) */
const daysUntil = (d) => {
  if (!d) return null;
  try {
    const diff = new Date(d).setHours(0,0,0,0) - new Date().setHours(0,0,0,0);
    return Math.ceil(diff / 86_400_000);
  } catch { return null; }
};

/** Human-readable countdown */
const humanCountdown = (d) => {
  const days = daysUntil(d);
  if (days === null) return "—";
  if (days <= 0)  return "today";
  if (days === 1) return "tomorrow";
  if (days < 7)   return `in ${days} days`;
  if (days < 30)  {
    const w = Math.floor(days / 7), r = days % 7;
    return r > 0 ? `in ${w} week${w>1?"s":""} & ${r} day${r>1?"s":""}` : `in ${w} week${w>1?"s":""}`;
  }
  if (days < 365) {
    const m = Math.floor(days / 30), r = days % 30;
    return r > 3 ? `in ${m} month${m>1?"s":""} & ${r} days` : `in ${m} month${m>1?"s":""}`;
  }
  const y = Math.floor(days / 365);
  return `in ${y} year${y>1?"s":""}`;
};

/** Strip HTML to plain text */
const toPlain = (html = "") =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 6000);

/** Extract best trip name from booking object */
const tripName = (b) =>
  safe(b.destination_name || b.service_name || b.package_name ||
    b.destination || b.service || b.package, "Your Trip");

/** Status badge colour config */
const STATUS_STYLE = {
  pending:   { bg: "#fef3c7", color: "#92400e", border: "#fde68a", label: "Pending Review"  },
  confirmed: { bg: "#d1fae5", color: "#065f46", border: "#6ee7b7", label: "Confirmed ✓"     },
  completed: { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd", label: "Completed"        },
  cancelled: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", label: "Cancelled"        },
  "on-hold": { bg: "#f3e8ff", color: "#6b21a8", border: "#d8b4fe", label: "On Hold"          },
  refunded:  { bg: "#fff7ed", color: "#9a3412", border: "#fdba74", label: "Refunded"         },
};

const statusBadge = (s = "pending") => {
  const st = STATUS_STYLE[s] || STATUS_STYLE.pending;
  return `<span style="display:inline-block;padding:5px 18px;
    background:${st.bg};color:${st.color};border:1.5px solid ${st.border};
    border-radius:30px;font-size:12px;font-weight:800;letter-spacing:.05em;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    ${st.label}
  </span>`;
};

/* ════════════════════════════════════════════════════════════════════════════
   ── DESIGN TOKENS ────────────────────────────────────────────────────────
════════════════════════════════════════════════════════════════════════════ */
const T = {
  // Brand greens
  g900: "#064e3b",
  g800: "#065f46",
  g700: "#047857",
  g600: "#059669",
  g500: "#10b981",
  g400: "#34d399",
  g200: "#a7f3d0",
  g100: "#d1fae5",
  g50:  "#f0fdf4",
  // Neutrals
  n900: "#0f172a",
  n700: "#374151",
  n500: "#6b7280",
  n300: "#d1d5db",
  n100: "#f3f4f6",
  white: "#ffffff",
  // Semantic
  amber: "#f59e0b",
  amberLight: "#fffbeb",
  amberBorder: "#fde68a",
  red: "#dc2626",
  redLight: "#fef2f2",
  blue: "#3b82f6",
  blueLight: "#eff6ff",
};

/* ════════════════════════════════════════════════════════════════════════════
   ── BASE EMAIL SHELL ─────────────────────────────────────────────────────
════════════════════════════════════════════════════════════════════════════ */
const shell = ({
  preheader  = "",
  body       = "",
  headerIcon = "🌍",
  headerBadge = "",
}) => `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${esc(ENV.appName)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    /* ── Reset ── */
    *, *::before, *::after { box-sizing: border-box; }
    body, table, td, p, a, li, blockquote {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none;
          -ms-interpolation-mode: bicubic; display: block; }
    body { margin: 0; padding: 0; width: 100% !important; }

    /* ── Body & wrapper ── */
    .email-body {
      background-color: ${T.g50};
      padding: 32px 0 48px;
    }
    .email-wrapper {
      width: 100%;
      max-width: 600px;
      margin: 0 auto;
    }

    /* ── Card ── */
    .email-card {
      background: ${T.white};
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 8px 48px rgba(5, 150, 105, 0.12),
                  0 2px 8px rgba(0,0,0,0.06);
      border: 1px solid ${T.g100};
    }

    /* ── Header ── */
    .email-header {
      background: linear-gradient(
        145deg,
        #022c22 0%,
        #064e3b 35%,
        #047857 70%,
        #059669 100%
      );
      padding: 44px 40px 36px;
      text-align: center;
      position: relative;
    }

    /* ── Info box ── */
    .info-box {
      background: ${T.g50};
      border: 1.5px solid ${T.g200};
      border-radius: 16px;
      overflow: hidden;
      margin: 20px 0;
    }
    .info-box-header {
      background: linear-gradient(135deg, #022c22, #047857);
      padding: 12px 20px;
    }
    .info-box-header span {
      font-size: 12px;
      font-weight: 800;
      color: rgba(255,255,255,0.9);
      text-transform: uppercase;
      letter-spacing: .1em;
    }
    .info-row {
      display: flex;
      padding: 12px 20px;
      border-bottom: 1px solid ${T.g100};
      align-items: flex-start;
      gap: 12px;
    }
    .info-row:last-child { border-bottom: none; }
    .info-label {
      font-size: 11.5px;
      font-weight: 700;
      color: ${T.n500};
      text-transform: uppercase;
      letter-spacing: .07em;
      white-space: nowrap;
      flex-shrink: 0;
      min-width: 110px;
      padding-top: 2px;
    }
    .info-value {
      font-size: 14px;
      font-weight: 600;
      color: ${T.n900};
      line-height: 1.5;
      word-break: break-word;
    }

    /* ── CTA button ── */
    .cta-primary {
      display: inline-block;
      padding: 16px 44px;
      background: linear-gradient(135deg, #10b981, #047857);
      color: #fff !important;
      text-decoration: none;
      border-radius: 50px;
      font-size: 16px;
      font-weight: 800;
      letter-spacing: .02em;
      box-shadow: 0 6px 24px rgba(5, 150, 105, 0.4);
    }
    .cta-secondary {
      display: inline-block;
      padding: 12px 28px;
      background: ${T.white};
      color: ${T.g700} !important;
      text-decoration: none;
      border-radius: 50px;
      font-size: 14px;
      font-weight: 700;
      border: 2px solid ${T.g200};
    }
    .wa-btn {
      display: inline-block;
      padding: 12px 28px;
      background: #25D366;
      color: #fff !important;
      text-decoration: none;
      border-radius: 50px;
      font-size: 14px;
      font-weight: 700;
    }

    /* ── Countdown ── */
    .countdown-box {
      background: linear-gradient(145deg, #022c22, #064e3b, #047857);
      border-radius: 20px;
      padding: 32px 24px;
      text-align: center;
      margin: 24px 0;
    }
    .countdown-number {
      font-size: 80px;
      font-weight: 900;
      color: #34d399;
      line-height: 1;
      font-family: 'Courier New', 'Lucida Console', monospace;
      display: block;
    }
    .countdown-label {
      font-size: 14px;
      color: rgba(255,255,255,.7);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .15em;
      margin-top: 8px;
      display: block;
    }
    .countdown-sub {
      font-size: 16px;
      color: rgba(255,255,255,.85);
      margin-top: 14px;
      line-height: 1.5;
    }

    /* ── Notice boxes ── */
    .notice-warning {
      background: ${T.amberLight};
      border: 1.5px solid ${T.amberBorder};
      border-left: 4px solid ${T.amber};
      border-radius: 0 14px 14px 0;
      padding: 16px 20px;
      margin: 20px 0;
    }
    .notice-info {
      background: ${T.blueLight};
      border: 1.5px solid #bfdbfe;
      border-left: 4px solid ${T.blue};
      border-radius: 0 14px 14px 0;
      padding: 16px 20px;
      margin: 20px 0;
    }
    .notice-success {
      background: ${T.g50};
      border: 1.5px solid ${T.g200};
      border-left: 4px solid ${T.g500};
      border-radius: 0 14px 14px 0;
      padding: 16px 20px;
      margin: 20px 0;
    }
    .notice-error {
      background: ${T.redLight};
      border: 1.5px solid #fca5a5;
      border-left: 4px solid ${T.red};
      border-radius: 0 14px 14px 0;
      padding: 16px 20px;
      margin: 20px 0;
    }

    /* ── Step list ── */
    .step-list { list-style: none; margin: 0; padding: 0; }
    .step-item {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 12px 0;
      border-bottom: 1px solid ${T.g100};
    }
    .step-item:last-child { border-bottom: none; }
    .step-num {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: linear-gradient(135deg, #10b981, #047857);
      color: #fff;
      font-size: 13px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    /* ── Divider ── */
    .divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, ${T.g200}, transparent);
      margin: 28px 0;
      border: none;
    }

    /* ── Footer ── */
    .email-footer {
      background: #f8fafc;
      border-top: 1px solid ${T.n300};
      padding: 28px 40px;
      text-align: center;
    }

    /* ── Dark mode ── */
    @media (prefers-color-scheme: dark) {
      .email-body   { background-color: #0a1628 !important; }
      .email-card   { background: #111827 !important; border-color: #1f2937 !important; }
      .info-box     { background: #1f2937 !important; border-color: #374151 !important; }
      .info-row     { border-color: #374151 !important; }
      .info-value   { color: #f9fafb !important; }
      .email-footer { background: #1f2937 !important; border-color: #374151 !important; }
    }

    /* ── Mobile ── */
    @media only screen and (max-width: 600px) {
      .email-body   { padding: 0 !important; }
      .email-card   { border-radius: 0 !important; }
      .email-header { padding: 32px 20px 24px !important; }
      .email-content{ padding: 24px 20px !important; }
      .email-footer { padding: 20px !important; }
      .countdown-number { font-size: 56px !important; }
      .cta-primary  { padding: 14px 28px !important; font-size: 15px !important; }
      .info-label   { min-width: 90px !important; }
      .info-row     { flex-direction: column; gap: 4px !important; }
    }
  </style>
</head>
<body class="email-body">
  <!-- Preheader (hidden) -->
  <div aria-hidden="true" style="display:none;max-height:0;overflow:hidden;
    mso-hide:all;font-size:1px;line-height:1px;color:${T.g50};">
    ${esc(preheader)}&nbsp;&#8203;&zwnj;&nbsp;&#8203;&zwnj;&nbsp;
  </div>

  <div class="email-wrapper" style="width:100%;max-width:600px;margin:0 auto;padding:0 16px;">
    <div class="email-card">

      <!-- ── HEADER ─────────────────────────────────────────── -->
      <div class="email-header">
        <!-- Top accent line -->
        <div style="position:absolute;top:0;left:0;right:0;height:4px;
          background:linear-gradient(90deg,#34d399,#10b981,#059669,#34d399);"></div>

        <!-- Logo icon -->
        <div style="width:72px;height:72px;border-radius:20px;
          background:rgba(255,255,255,.12);backdrop-filter:blur(8px);
          border:1.5px solid rgba(255,255,255,.2);
          display:inline-flex;align-items:center;justify-content:center;
          margin-bottom:16px;font-size:36px;line-height:1;">
          ${headerIcon}
        </div>

        <!-- Brand name -->
        <div>
          <a href="${ENV.frontendUrl}" style="text-decoration:none;">
            <span style="font-size:28px;font-weight:900;color:#fff;
              letter-spacing:-.5px;display:block;
              font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              ${esc(ENV.appName)}
            </span>
          </a>
          <span style="font-size:11px;color:rgba(255,255,255,.6);
            text-transform:uppercase;letter-spacing:2.5px;font-weight:700;
            display:block;margin-top:4px;">
            Premium East African Safaris
          </span>
        </div>

        <!-- Optional badge pill -->
        ${headerBadge ? `<div style="margin-top:18px;">${headerBadge}</div>` : ""}
      </div>
      <!-- ── END HEADER ───────────────────────────────────────── -->

      <!-- ── BODY ──────────────────────────────────────────────── -->
      <div class="email-content" style="padding:36px 40px 32px;">
        ${body}
      </div>
      <!-- ── END BODY ─────────────────────────────────────────── -->

      <!-- ── FOOTER ───────────────────────────────────────────── -->
      <div class="email-footer">
        <!-- WhatsApp -->
        <div style="margin-bottom:18px;">
          <a href="${WA_URL}" class="wa-btn"
            style="display:inline-block;padding:10px 24px;background:#25D366;
              color:#fff;text-decoration:none;border-radius:30px;
              font-size:13px;font-weight:700;">
            💬 &nbsp;WhatsApp Support
          </a>
        </div>

        <!-- Links -->
        <p style="margin:0 0 10px;font-size:12px;color:${T.n500};">
          <a href="${ENV.frontendUrl}" style="color:${T.n500};text-decoration:none;margin:0 8px;">
            Website
          </a>
          <span style="color:${T.n300};">|</span>
          <a href="mailto:${ENV.supportEmail}" style="color:${T.n500};text-decoration:none;margin:0 8px;">
            ${esc(ENV.supportEmail)}
          </a>
          <span style="color:${T.n300};">|</span>
          <a href="${ENV.frontendUrl}/destinations" style="color:${T.n500};text-decoration:none;margin:0 8px;">
            Destinations
          </a>
        </p>

        <p style="margin:0;font-size:11px;color:${T.n300};">
          © ${ENV.year} ${esc(ENV.appName)} · All rights reserved
        </p>
      </div>
      <!-- ── END FOOTER ─────────────────────────────────────── -->

    </div>
  </div>
</body>
</html>`;

/* ════════════════════════════════════════════════════════════════════════════
   ── REUSABLE COMPONENTS ──────────────────────────────────────────────────
════════════════════════════════════════════════════════════════════════════ */

/** Info/detail row */
const row = (label, value, highlight = false) => {
  const v = safe(value);
  if (!v || v === "—") return "";
  return `<tr>
    <td class="info-label" style="
      font-size:11.5px;font-weight:700;color:${T.n500};
      text-transform:uppercase;letter-spacing:.07em;
      white-space:nowrap;padding:11px 0 11px 20px;
      vertical-align:top;min-width:120px;
      border-bottom:1px solid ${T.g100};">
      ${esc(label)}
    </td>
    <td class="info-value" style="
      font-size:14px;font-weight:${highlight ? "800" : "600"};
      color:${highlight ? T.g700 : T.n900};
      padding:11px 20px 11px 12px;
      vertical-align:top;line-height:1.5;
      word-break:break-word;
      border-bottom:1px solid ${T.g100};">
      ${esc(v)}
    </td>
  </tr>`;
};

/** Info table wrapper */
const infoTable = (title, rows) => {
  const content = rows.filter(Boolean).join("");
  if (!content.trim()) return "";
  return `
    <div style="background:${T.g50};border:1.5px solid ${T.g200};
      border-radius:16px;overflow:hidden;margin:20px 0;">
      <div style="background:linear-gradient(135deg,#022c22 0%,#047857 100%);
        padding:12px 20px;">
        <span style="font-size:12px;font-weight:800;
          color:rgba(255,255,255,.9);text-transform:uppercase;letter-spacing:.1em;">
          ${esc(title)}
        </span>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="border-collapse:collapse;">
        <tbody>${content}</tbody>
      </table>
    </div>`;
};

/** Step / next-steps list */
const stepList = (steps) => steps.map((s, i) => `
  <tr>
    <td style="width:36px;padding:10px 0 10px 20px;vertical-align:top;">
      <div style="width:28px;height:28px;border-radius:50%;
        background:linear-gradient(135deg,#10b981,#047857);
        color:#fff;font-size:13px;font-weight:800;text-align:center;
        line-height:28px;font-family:monospace;">
        ${i + 1}
      </div>
    </td>
    <td style="padding:10px 20px 10px 12px;font-size:13.5px;
      color:${T.n700};line-height:1.6;vertical-align:middle;
      border-bottom:${i < steps.length - 1 ? `1px solid ${T.g100}` : "none"};">
      ${esc(s)}
    </td>
  </tr>`
).join("");

/** Full booking summary block */
const bookingSummary = (b) => {
  const dest    = tripName(b);
  const country = safe(b.country_name || b.country);
  const travelers = Number(b.number_of_travelers) || 1;
  const adults    = Number(b.number_of_adults);
  const children  = Number(b.number_of_children);
  const travelersStr = adults > 0
    ? `${travelers} (${adults} adult${adults>1?"s":""}${children>0 ? `, ${children} child${children>1?"ren":""}` : ""})`
    : `${travelers}`;

  return infoTable("📋 Booking Details", [
    row("Booking Ref",   b.booking_number, true),
    row("Status",        b.status ? STATUS_STYLE[b.status]?.label || b.status : null),
    row("Destination",   dest !== "Your Trip" ? dest : null),
    row("Country",       country !== "—" ? country : null),
    row("Departure",     fmtDate(b.travel_date)),
    row("Return",        fmtDate(b.return_date)),
    row("Flexible",      b.flexible_dates ? `Yes${b.flexible_months?.length ? ` — ${Array.isArray(b.flexible_months) ? b.flexible_months.join(", ") : b.flexible_months}` : ""}` : null),
    row("Travelers",     travelers > 0 ? travelersStr : null),
    row("Group Type",    b.group_type),
    row("Accommodation", b.accommodation_type),
    row("Submitted",     fmtDateTime(b.created_at || new Date())),
  ]);
};

/** CTA button row */
const ctaBlock = (primaryText, primaryUrl, secondaryText, secondaryUrl) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="margin-top:28px;">
    <tr><td align="center" style="padding-bottom:${secondaryText ? "12px" : "0"};">
      <a href="${esc(primaryUrl)}" class="cta-primary"
        style="display:inline-block;padding:16px 44px;
          background:linear-gradient(135deg,#10b981,#047857);
          color:#fff;text-decoration:none;border-radius:50px;
          font-size:16px;font-weight:800;
          box-shadow:0 6px 24px rgba(5,150,105,.4);">
        ${esc(primaryText)}
      </a>
    </td></tr>
    ${secondaryText && secondaryUrl ? `
    <tr><td align="center">
      <a href="${esc(secondaryUrl)}" class="cta-secondary"
        style="display:inline-block;padding:11px 28px;
          background:#fff;color:${T.g700};text-decoration:none;
          border-radius:50px;font-size:14px;font-weight:700;
          border:2px solid ${T.g200};">
        ${esc(secondaryText)}
      </a>
    </td></tr>` : ""}
  </table>`;

/** Section heading */
const heading = (text, emoji = "") => `
  <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;
    color:${T.n900};line-height:1.3;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    ${emoji ? emoji + " " : ""}${esc(text)}
  </h1>`;

/** Body paragraph */
const para = (text, style = "") => `
  <p style="margin:0 0 16px;font-size:15px;color:${T.n700};
    line-height:1.75;${style}">
    ${text}
  </p>`;

/** Safe send wrapper — never throws */
const safeSend = async (to, subject, html, label = "") => {
  try {
    if (!to) {
      logger.warn(`[BookingEmails] ${label}: no recipient — skipping`);
      return { success: false, error: "No recipient" };
    }
    const plain = toPlain(html);
    const result = await _send({ to, subject, html, text: plain });
    logger.info(`[BookingEmails] ✅ ${label} → ${to}`);
    return result || { success: true };
  } catch (err) {
    logger.error(`[BookingEmails] ❌ ${label} failed → ${to}: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   ═══════════════════  EMAIL FUNCTIONS  ═══════════════════════════════════
════════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────────────────
   1.  BOOKING VERIFICATION LINK
       Called right after a guest submits the form.
       Admin is NOT notified until user clicks this link.
───────────────────────────────────────────────────────────────────────── */
const sendBookingVerificationLink = async (booking, token) => {
  if (!booking?.email || !token) {
    logger.warn("[BookingEmails] sendBookingVerificationLink: missing email or token");
    return { success: false };
  }

  const verifyUrl = `${ENV.backendUrl}/api/bookings/verify-email/${token}`;
  const dest = tripName(booking);
  const name = safe(booking.full_name, "Explorer");

  const html = shell({
    preheader: `One click to confirm your ${dest} booking — Ref ${safe(booking.booking_number)}. Link expires in 24 hours.`,
    headerIcon: "📧",
    headerBadge: `<div style="display:inline-block;padding:8px 20px;
      background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.3);
      border-radius:30px;font-size:13px;font-weight:700;color:#fff;">
      ⏳ Email Verification Required
    </div>`,
    body: `
      ${heading("One step away from your adventure!", "✉️")}
      ${para(`Hi <strong style="color:${T.n900};">${esc(name)}</strong>,`)}
      ${para(`Thank you for choosing <strong>${esc(ENV.appName)}</strong>!
        Your booking request has been received, but we need to
        <strong>verify your email address</strong> before sending it to our
        travel team. Please click the button below — it only takes a second.`)}

      ${bookingSummary(booking)}

      <!-- Big verify box -->
      <div style="background:linear-gradient(135deg,${T.g50},#dcfce7);
        border:2px solid ${T.g400};border-radius:20px;
        padding:32px 28px;margin:24px 0;text-align:center;">
        <div style="font-size:48px;margin-bottom:14px;">🔐</div>
        <p style="margin:0 0 6px;font-size:12px;font-weight:800;
          color:${T.g700};text-transform:uppercase;letter-spacing:.12em;">
          Email Verification
        </p>
        <p style="margin:0 0 24px;font-size:14px;color:${T.n700};line-height:1.6;">
          This link is valid for <strong>24 hours</strong>.
          Click below to confirm your request.
        </p>
        <a href="${verifyUrl}"
          style="display:inline-block;padding:18px 52px;
            background:linear-gradient(135deg,#10b981,#047857);
            color:#fff;text-decoration:none;border-radius:50px;
            font-size:17px;font-weight:900;
            box-shadow:0 8px 28px rgba(5,150,105,.45);
            letter-spacing:.02em;">
          ✅ &nbsp;Verify &amp; Confirm My Booking
        </a>
        <p style="margin:20px 0 0;font-size:11.5px;color:${T.n500};">
          Button not working? Copy this link into your browser:
        </p>
        <p style="margin:6px 0 0;font-size:11px;word-break:break-all;">
          <a href="${verifyUrl}" style="color:${T.g600};">${esc(verifyUrl)}</a>
        </p>
      </div>

      <!-- What happens next -->
      <div style="background:${T.amberLight};border:1.5px solid ${T.amberBorder};
        border-radius:16px;padding:20px;margin:20px 0;">
        <p style="margin:0 0 14px;font-size:13px;font-weight:800;
          color:#92400e;text-transform:uppercase;letter-spacing:.07em;">
          ⚡ After verification:
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${stepList([
            "Your request goes straight to our expert travel team",
            "We'll contact you within <strong>24 hours</strong> to discuss your perfect itinerary",
            "You'll receive a personalised quote — <strong>no payment required now</strong>",
            "Once you're happy, we'll confirm your adventure officially!",
          ])}
        </table>
      </div>

      ${ctaBlock(
        "💬 Chat on WhatsApp Instead",
        WA_URL,
        "🏠 Visit Our Website",
        ENV.frontendUrl,
      )}

      <hr class="divider" style="border:none;height:1px;
        background:linear-gradient(90deg,transparent,${T.g200},transparent);
        margin:28px 0;" />

      <p style="font-size:12px;color:${T.n500};text-align:center;line-height:1.6;margin:0;">
        This email was sent because someone submitted a booking at
        <a href="${ENV.frontendUrl}" style="color:${T.g600};">${esc(ENV.appName)}</a>
        using this address. If this wasn't you, simply ignore this email —
        your address will not be saved.
      </p>
    `,
  });

  return safeSend(
    booking.email,
    `✅ Confirm Your Booking — ${dest} | ${ENV.appName}`,
    html,
    "sendBookingVerificationLink",
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   2.  BOOKING RECEIVED (sent to customer after verification / auth submit)
───────────────────────────────────────────────────────────────────────── */
const sendBookingReceivedEmail = async (booking) => {
  if (!booking?.email) return { success: false };

  const dest = tripName(booking);
  const name = safe(booking.full_name, "Explorer");

  const html = shell({
    preheader: `We've received your booking for ${dest}! Our team will contact you within 24 hours — Ref ${safe(booking.booking_number)}.`,
    headerIcon: "🎉",
    headerBadge: statusBadge("pending"),
    body: `
      ${heading("Your booking request is with us!", "🌍")}
      ${para(`Hi <strong style="color:${T.n900};">${esc(name)}</strong>, wonderful news!`)}
      ${para(`Your safari booking request for <strong>${esc(dest)}</strong>
        has been received and is now with our expert travel team.
        We'll personally reach out within
        <strong style="color:${T.g600};">24 hours</strong>
        to start crafting your perfect itinerary.`)}

      ${bookingSummary(booking)}

      <!-- What happens next -->
      <div style="background:${T.g50};border:1.5px solid ${T.g200};
        border-radius:16px;padding:20px;margin:20px 0;">
        <p style="margin:0 0 14px;font-size:13px;font-weight:800;
          color:${T.g800};text-transform:uppercase;letter-spacing:.07em;">
          📋 What happens next?
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${stepList([
            "Our team reviews your request and destination availability",
            "A dedicated safari coordinator contacts you within <strong>24 hours</strong>",
            "We design a fully personalised itinerary just for your group",
            "You receive a custom quote — <strong>no payment required at this stage</strong>",
            "Once you approve, we confirm your booking and the adventure begins! 🦁",
          ])}
        </table>
      </div>

      <!-- Instant contact -->
      <div style="background:linear-gradient(135deg,#022c22,#047857);
        border-radius:16px;padding:24px;text-align:center;margin:24px 0;">
        <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#fff;">
          Can't wait? Reach us instantly on WhatsApp!
        </p>
        <p style="margin:0 0 18px;font-size:13px;color:rgba(255,255,255,.7);">
          Our safari experts are available 7 days a week
        </p>
        <a href="${WA_URL}"
          style="display:inline-block;padding:13px 32px;
            background:#25D366;color:#fff;text-decoration:none;
            border-radius:40px;font-size:15px;font-weight:800;">
          💬 &nbsp;Chat on WhatsApp
        </a>
      </div>

      ${ctaBlock(
        "Track My Booking",
        `${ENV.frontendUrl}/my-bookings`,
        `📧 Email Support`,
        `mailto:${ENV.supportEmail}`,
      )}
    `,
  });

  return safeSend(
    booking.email,
    `🌍 Booking Received — Ref ${safe(booking.booking_number)} | ${ENV.appName}`,
    html,
    "sendBookingReceivedEmail",
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   3.  ADMIN NOTIFICATION (after email verification or auth booking)
───────────────────────────────────────────────────────────────────────── */
const sendAdminBookingNotification = async (booking) => {
  if (!ENV.adminEmail) {
    logger.warn("[BookingEmails] sendAdminBookingNotification: ADMIN_EMAIL not set");
    return { success: false };
  }

  const dest    = tripName(booking);
  const name    = safe(booking.full_name, "Unknown");
  const email   = safe(booking.email);
  const phone   = safe(booking.phone);
  const wa      = phone !== "—" ? phone.replace(/\D/g, "") : null;
  const adminUrl = `${ENV.frontendUrl}/admin/bookings`;
  const travelers = Number(booking.number_of_travelers) || 1;

  const html = shell({
    preheader: `ACTION REQUIRED: New verified booking ${safe(booking.booking_number)} from ${name} for ${dest}.`,
    headerIcon: "🔔",
    headerBadge: `<div style="display:inline-block;padding:8px 20px;
      background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.3);
      border-radius:30px;font-size:13px;font-weight:700;color:#fff;">
      🔔 Admin Alert — Action Required
    </div>`,
    body: `
      ${heading("New Verified Booking Received", "🔔")}
      ${para(`A customer has verified their email. This booking is now
        <strong>awaiting your review and approval</strong>.
        Please log in to the admin panel to process this request.`)}

      <!-- Quick stat pills -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="margin:20px 0;">
        <tr>
          ${[
            ["Booking #", safe(booking.booking_number)],
            ["Travelers", String(travelers)],
            ["Source",    safe(booking.source, "website")],
            ["Verified",  "✅ Yes"],
          ].map(([l, v]) => `
          <td style="width:25%;padding:0 4px;vertical-align:top;">
            <div style="background:${T.g50};border:1.5px solid ${T.g200};
              border-radius:12px;padding:12px 8px;text-align:center;">
              <div style="font-size:15px;font-weight:900;color:${T.g800};
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${esc(v)}
              </div>
              <div style="font-size:10px;color:${T.n500};margin-top:3px;
                text-transform:uppercase;letter-spacing:.06em;font-weight:700;">
                ${esc(l)}
              </div>
            </div>
          </td>`).join("")}
        </tr>
      </table>

      ${infoTable("👤 Customer Information", [
        row("Full Name",    name),
        row("Email",        email),
        row("Phone",        phone),
        row("WhatsApp",     booking.whatsapp),
        row("Nationality",  booking.nationality),
        row("Country",      booking.country),
        row("Group Type",   booking.group_type),
        row("Contact Pref", booking.preferred_contact_method),
      ])}

      ${infoTable("🗺️ Trip Details", [
        row("Booking Ref",   booking.booking_number, true),
        row("Destination",   dest),
        row("Country",       booking.country_name),
        row("Departure",     fmtDate(booking.travel_date)),
        row("Return",        fmtDate(booking.return_date)),
        row("Flexible",      booking.flexible_dates ? `Yes${booking.flexible_months?.length ? ` — ${Array.isArray(booking.flexible_months) ? booking.flexible_months.join(", ") : booking.flexible_months}` : ""}` : "No"),
        row("Adults",        booking.number_of_adults),
        row("Children",      booking.number_of_children),
        row("Total",         String(travelers)),
        row("Accommodation", booking.accommodation_type),
        row("Dietary",       booking.dietary_requirements),
        row("Submitted",     fmtDateTime(booking.created_at)),
        row("Status",        booking.status),
      ])}

      ${booking.special_requests ? `
      <div style="background:${T.amberLight};border:1.5px solid ${T.amberBorder};
        border-radius:14px;padding:18px 20px;margin:16px 0;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:800;color:#92400e;
          text-transform:uppercase;letter-spacing:.08em;">
          💬 Customer Special Requests
        </p>
        <p style="margin:0;font-size:14px;color:#78350f;line-height:1.65;
          white-space:pre-wrap;">${esc(booking.special_requests)}</p>
      </div>` : ""}

      <!-- Action buttons -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="margin-top:28px;">
        <tr>
          <td align="center" style="padding-bottom:12px;">
            <a href="${esc(adminUrl)}"
              style="display:inline-block;padding:16px 44px;
                background:linear-gradient(135deg,#10b981,#047857);
                color:#fff;text-decoration:none;border-radius:50px;
                font-size:16px;font-weight:900;">
              🖥️ &nbsp;Open Admin Panel
            </a>
          </td>
        </tr>
        <tr>
          <td align="center">
            <a href="mailto:${esc(email)}?subject=Re: Your ${esc(dest)} Booking — ${esc(safe(booking.booking_number))}"
              style="display:inline-block;padding:11px 28px;margin:4px;
                background:#fff;color:${T.g700};text-decoration:none;
                border-radius:50px;font-size:14px;font-weight:700;
                border:2px solid ${T.g200};">
              📧 Reply to Customer
            </a>
            ${wa ? `
            <a href="https://wa.me/${wa}"
              style="display:inline-block;padding:11px 28px;margin:4px;
                background:#25D366;color:#fff;text-decoration:none;
                border-radius:50px;font-size:14px;font-weight:700;">
              💬 WhatsApp Customer
            </a>` : ""}
          </td>
        </tr>
      </table>
    `,
  });

  return safeSend(
    ENV.adminEmail,
    `🔔 New Booking: ${safe(booking.booking_number)} — ${name} → ${dest} | ${ENV.appName}`,
    html,
    "sendAdminBookingNotification",
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   4.  BOOKING CONFIRMED (admin approves → sent to customer)
───────────────────────────────────────────────────────────────────────── */
const sendBookingConfirmation = async (booking) => {
  if (!booking?.email) return { success: false };

  const dest    = tripName(booking);
  const name    = safe(booking.full_name, "Explorer");
  const days    = daysUntil(booking.travel_date);
  const countdown = booking.travel_date ? humanCountdown(booking.travel_date) : null;

  const html = shell({
    preheader: `🎉 Your ${dest} adventure is officially confirmed! ${countdown ? `Your trip is ${countdown}.` : ""} Ref ${safe(booking.booking_number)}.`,
    headerIcon: "🎊",
    headerBadge: statusBadge("confirmed"),
    body: `
      ${heading("Your adventure is officially confirmed!", "🎉")}
      ${para(`Hi <strong style="color:${T.n900};">${esc(name)}</strong>,
        we have incredible news —`)}
      ${para(`Your safari adventure to <strong>${esc(dest)}</strong>
        has been <strong style="color:${T.g600};">officially confirmed</strong>
        by our travel team. Pack your bags — Africa is waiting for you! 🌍`)}

      <!-- Countdown -->
      ${countdown && days !== null && days >= 0 ? `
      <div class="countdown-box" style="
        background:linear-gradient(145deg,#022c22,#064e3b,#047857);
        border-radius:20px;padding:36px 24px;text-align:center;margin:24px 0;">
        <span style="font-size:12px;font-weight:800;color:${T.g400};
          text-transform:uppercase;letter-spacing:.2em;display:block;
          margin-bottom:12px;">
          Your trip is
        </span>
        <span class="countdown-number" style="
          font-size:${days < 10 ? "88px" : "72px"};font-weight:900;
          color:#34d399;line-height:1;display:block;
          font-family:'Courier New','Lucida Console',monospace;">
          ${days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : humanCountdown(booking.travel_date).toUpperCase()}
        </span>
        <span class="countdown-label" style="
          font-size:14px;color:rgba(255,255,255,.65);font-weight:700;
          text-transform:uppercase;letter-spacing:.15em;
          margin-top:10px;display:block;">
          ✈️ ${esc(dest)}
        </span>
        <p style="margin:14px 0 0;font-size:15px;color:rgba(255,255,255,.8);
          line-height:1.5;">
          ${fmtDate(booking.travel_date)}
        </p>
      </div>` : ""}

      ${bookingSummary({ ...booking, status: "confirmed" })}

      ${booking.confirmation_code ? `
      <div style="background:${T.g50};border:2px solid ${T.g400};
        border-radius:16px;padding:24px;text-align:center;margin:20px 0;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:800;color:${T.g600};
          text-transform:uppercase;letter-spacing:.15em;">
          Confirmation Code
        </p>
        <p style="margin:0;font-size:36px;font-weight:900;color:${T.g700};
          font-family:'Courier New',monospace;letter-spacing:8px;">
          ${esc(booking.confirmation_code)}
        </p>
        <p style="margin:8px 0 0;font-size:12px;color:${T.n500};">
          Keep this safe — you may need it for check-in
        </p>
      </div>` : ""}

      <!-- Important next steps -->
      <div style="background:${T.g50};border:1.5px solid ${T.g200};
        border-radius:16px;padding:20px;margin:20px 0;">
        <p style="margin:0 0 14px;font-size:13px;font-weight:800;
          color:${T.g800};text-transform:uppercase;letter-spacing:.07em;">
          📌 Important next steps
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${stepList([
            "Ensure your passport is valid for at least <strong>6 months</strong> beyond your return date",
            "Check visa requirements for your destination country",
            "Arrange comprehensive travel insurance",
            "Your safari coordinator will contact you with a detailed itinerary",
            "We'll send countdown reminders as your departure approaches 🦁",
          ])}
        </table>
      </div>

      ${ctaBlock(
        "View My Booking",
        `${ENV.frontendUrl}/my-bookings`,
        "💬 Chat on WhatsApp",
        WA_URL,
      )}
    `,
  });

  return safeSend(
    booking.email,
    `✅ Confirmed: ${safe(booking.booking_number)} — ${dest} | ${ENV.appName}`,
    html,
    "sendBookingConfirmation",
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   5.  BOOKING STATUS UPDATE (generic — on-hold, completed, etc.)
───────────────────────────────────────────────────────────────────────── */
const sendBookingStatusUpdate = async (booking, fromStatus, toStatus, reason = "") => {
  if (!booking?.email) return { success: false };

  const dest  = tripName(booking);
  const name  = safe(booking.full_name, "Explorer");
  const st    = STATUS_STYLE[toStatus] || STATUS_STYLE.pending;
  const from  = STATUS_STYLE[fromStatus]?.label || safe(fromStatus);

  const msgs = {
    pending:   "Your booking is under review. Our team will be in touch shortly.",
    confirmed: "Wonderful! Your booking has been confirmed. Get ready for an incredible adventure!",
    "on-hold": "Your booking is temporarily on hold pending some additional details. Our team will contact you shortly.",
    completed: "Your safari journey is marked as completed. We hope it was truly extraordinary! 🌟",
    cancelled: "Your booking has been cancelled. We're sorry to see this happen.",
    refunded:  "Your refund has been processed. Please allow 5–10 business days to appear.",
  };

  const statusIcon = {
    confirmed: "🎉", "on-hold": "⏸️", completed: "🏆",
    cancelled: "❌", refunded: "💰", pending: "⏳",
  };

  const icon = statusIcon[toStatus] || "🔄";
  const msg  = msgs[toStatus] || "Your booking status has been updated.";

  const html = shell({
    preheader: `Your booking ${safe(booking.booking_number)} is now: ${st.label}. ${msg}`,
    headerIcon: icon,
    headerBadge: statusBadge(toStatus),
    body: `
      ${heading(`Booking Status Update`, icon)}
      ${para(`Hi <strong style="color:${T.n900};">${esc(name)}</strong>,`)}
      ${para(msg)}

      ${infoTable("🔄 Status Change", [
        row("Booking Ref",     booking.booking_number, true),
        row("Destination",     dest !== "Your Trip" ? dest : null),
        row("Travel Date",     fmtDate(booking.travel_date)),
        row("Previous Status", from),
        row("New Status",      st.label),
        row("Updated",         fmtDateTime(new Date())),
      ])}

      ${reason ? `
      <div style="background:${T.amberLight};border:1.5px solid ${T.amberBorder};
        border-left:4px solid ${T.amber};border-radius:0 14px 14px 0;
        padding:16px 20px;margin:16px 0;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:800;color:#92400e;
          text-transform:uppercase;letter-spacing:.07em;">
          📝 Note from our team
        </p>
        <p style="margin:0;font-size:14px;color:#78350f;line-height:1.65;">
          ${esc(reason)}
        </p>
      </div>` : ""}

      ${toStatus === "completed" ? `
      <div style="background:linear-gradient(135deg,${T.g50},#dcfce7);
        border:2px solid ${T.g300};border-radius:16px;
        padding:24px;text-align:center;margin:20px 0;">
        <p style="margin:0 0 6px;font-size:20px;font-weight:900;color:${T.g800};">
          🌟 Thank you for travelling with us!
        </p>
        <p style="margin:0;font-size:14px;color:${T.n700};line-height:1.6;">
          We hope your adventure was everything you dreamed of.
          We'd love to read your review — and even more, plan your next journey!
        </p>
      </div>
      ` : ""}

      ${ctaBlock(
        "View My Booking",
        `${ENV.frontendUrl}/my-bookings`,
        "Get Support",
        `mailto:${ENV.supportEmail}`,
      )}
    `,
  });

  return safeSend(
    booking.email,
    `${icon} Booking ${st.label} — ${safe(booking.booking_number)} | ${ENV.appName}`,
    html,
    `sendBookingStatusUpdate(${fromStatus}→${toStatus})`,
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   6.  BOOKING CANCELLATION (shorthand)
───────────────────────────────────────────────────────────────────────── */
const sendBookingCancellation = async (booking, reason = "") => {
  if (!booking?.email) return { success: false };

  const dest = tripName(booking);
  const name = safe(booking.full_name, "Explorer");

  const html = shell({
    preheader: `Your booking ${safe(booking.booking_number)} for ${dest} has been cancelled.${reason ? " " + reason : ""}`,
    headerIcon: "❌",
    headerBadge: statusBadge("cancelled"),
    body: `
      ${heading("Booking Cancelled", "❌")}
      ${para(`Hi <strong style="color:${T.n900};">${esc(name)}</strong>,`)}
      ${para(`We're sorry to inform you that your booking for
        <strong>${esc(dest)}</strong> has been cancelled.
        We understand this is disappointing and we apologise for any inconvenience.`)}

      ${infoTable("📋 Cancelled Booking", [
        row("Booking Ref",  booking.booking_number, true),
        row("Destination",  dest !== "Your Trip" ? dest : null),
        row("Travel Date",  fmtDate(booking.travel_date)),
        row("Status",       "Cancelled"),
        row("Cancelled On", fmtDateTime(new Date())),
      ])}

      ${reason ? `
      <div style="background:${T.redLight};border:1.5px solid #fca5a5;
        border-left:4px solid ${T.red};border-radius:0 14px 14px 0;
        padding:16px 20px;margin:16px 0;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:800;color:#991b1b;
          text-transform:uppercase;letter-spacing:.07em;">
          📝 Cancellation Reason
        </p>
        <p style="margin:0;font-size:14px;color:#7f1d1d;line-height:1.65;">
          ${esc(reason)}
        </p>
      </div>` : ""}

      <div style="background:${T.blueLight};border:1.5px solid #bfdbfe;
        border-left:4px solid ${T.blue};border-radius:0 14px 14px 0;
        padding:16px 20px;margin:16px 0;">
        <p style="margin:0;font-size:14px;color:#1e40af;line-height:1.65;">
          💳 &nbsp;If you made a payment, a <strong>full refund will be
          processed within 5–10 business days</strong> to your original
          payment method.
        </p>
      </div>

      <!-- Africa will wait -->
      <div style="background:linear-gradient(135deg,#022c22,#047857);
        border-radius:16px;padding:24px;text-align:center;margin:24px 0;">
        <p style="margin:0 0 6px;font-size:18px;font-weight:800;color:#fff;">
          🌍 Africa will be here when you're ready
        </p>
        <p style="margin:0 0 18px;font-size:14px;color:rgba(255,255,255,.75);line-height:1.6;">
          We'd love to plan your next adventure whenever you're ready.
          Our destinations aren't going anywhere!
        </p>
        <a href="${ENV.frontendUrl}/destinations"
          style="display:inline-block;padding:12px 32px;
            background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.3);
            color:#fff;text-decoration:none;border-radius:30px;
            font-size:14px;font-weight:700;">
          Browse Destinations →
        </a>
      </div>

      ${ctaBlock(
        "💬 Talk to Our Team",
        WA_URL,
        "📧 Email Support",
        `mailto:${ENV.supportEmail}`,
      )}
    `,
  });

  return safeSend(
    booking.email,
    `❌ Booking Cancelled — ${safe(booking.booking_number)} | ${ENV.appName}`,
    html,
    "sendBookingCancellation",
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   7.  TRIP COUNTDOWN EMAIL (milestone reminders)
───────────────────────────────────────────────────────────────────────── */
const sendTripCountdownEmail = async (booking) => {
  if (!booking?.email || !booking?.travel_date) return { success: false };

  const days = daysUntil(booking.travel_date);
  if (days === null || days < 0) return { success: false, error: "Past date" };

  const MILESTONES = [60, 30, 14, 7, 3, 1, 0];
  if (!MILESTONES.includes(days)) return { success: false, error: "Not a milestone" };

  const dest    = tripName(booking);
  const name    = safe(booking.full_name, "Explorer");
  const countdown = humanCountdown(booking.travel_date);

  const CONTENT = {
    0:  {
      emoji: "🚀", urgency: "TODAY IS THE DAY!",
      headline: "Your adventure starts TODAY!",
      sub: "This is it! Your African safari begins today. Safe travels — enjoy every magical moment!",
      tips: [
        "✅ Double-check you have passport, tickets, and all documents",
        "✅ Arrive at the airport at least 3 hours before departure",
        "✅ Charge all your devices — you'll want to capture everything",
        "✅ Our guide will meet you at the arranged location",
        "🦁 Africa is ready to take your breath away — enjoy every second!",
      ],
    },
    1:  {
      emoji: "✈️", urgency: "TOMORROW IS THE DAY!",
      headline: "You leave tomorrow!",
      sub: "The big day is almost here! Time for final preparations.",
      tips: [
        "🧳 Lay out everything you need tonight",
        "📋 Confirm your transfer and pick-up time with our team",
        "💊 Pack any medications in your carry-on bag",
        "🔋 Charge all devices and clear memory cards",
        "😴 Get a good night's sleep — adventure awaits!",
      ],
    },
    3:  {
      emoji: "🔥", urgency: "3 DAYS TO GO!",
      headline: "3 days and counting!",
      sub: "You're almost there! Here are your final preparation tips.",
      tips: [
        "🎒 Finalise your packing — don't forget layers for morning game drives",
        "📂 Print copies of your booking confirmation and travel insurance",
        "📱 Download offline maps for your destination",
        "💴 Get some local currency for tips and small purchases",
        "⏰ Confirm your pick-up or transfer time with our team",
      ],
    },
    7:  {
      emoji: "⚡", urgency: "ONE WEEK TO GO!",
      headline: "One week until your safari!",
      sub: "Your adventure is exactly one week away. Here's your pre-departure checklist.",
      tips: [
        "🧴 Complete your packing — check the weather forecast for your destination",
        "🛂 Confirm your passport is valid for 6+ months",
        "📱 Save our guide's contact number in your phone",
        "📷 Test your camera and pack extra memory cards",
        "🎉 Share your excitement — tell friends and family you're going to Africa!",
      ],
    },
    14: {
      emoji: "📅", urgency: "2 WEEKS TO GO!",
      headline: "Two weeks to go!",
      sub: "Your East African adventure is just two weeks away. Here's how to prepare.",
      tips: [
        "🧳 Start packing non-essential items early",
        "💉 Ensure any required vaccinations are completed",
        "🏥 Pick up any prescription medications you need for the trip",
        "📋 Review your booking itinerary and contact us with any questions",
        "📷 Charge and test all camera equipment",
      ],
    },
    30: {
      emoji: "🗓️", urgency: "ONE MONTH TO GO!",
      headline: "One month until your safari!",
      sub: "Your adventure is exactly one month away. A few things to take care of now.",
      tips: [
        "✈️ Book any internal flights or transfers if not already arranged",
        "🎒 Start planning your packing list — layers are key for safari mornings",
        "🛡️ Confirm your travel insurance covers adventure activities",
        "📖 Start reading about the wildlife and culture you'll encounter",
        "🌍 Share your itinerary with a trusted contact at home",
      ],
    },
    60: {
      emoji: "🌍", urgency: "60 DAYS TO GO!",
      headline: "60 days until your adventure!",
      sub: "Your safari is two months away — the perfect time to start planning.",
      tips: [
        "🛂 Apply for any required visas (processing can take 4–6 weeks)",
        "💉 Schedule any required vaccinations with your GP",
        "🛡️ Purchase comprehensive travel insurance now",
        "🎒 Research what to pack for an East African safari",
        "📸 Follow us on social media for destination inspiration!",
      ],
    },
  };

  const c = CONTENT[days] || CONTENT[7];

  const html = shell({
    preheader: `${c.urgency} — Your ${dest} adventure is ${countdown}. ${c.sub}`,
    headerIcon: c.emoji,
    headerBadge: `<div style="display:inline-block;padding:8px 20px;
      background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.3);
      border-radius:30px;font-size:13px;font-weight:700;color:#fff;">
      ${c.urgency}
    </div>`,
    body: `
      ${heading(c.headline)}
      ${para(`Hi <strong style="color:${T.n900};">${esc(name)}</strong>,`)}
      ${para(c.sub)}

      <!-- Countdown display -->
      <div style="background:linear-gradient(145deg,#022c22,#064e3b,#047857);
        border-radius:20px;padding:${days <= 1 ? "36px" : "32px"} 24px;
        text-align:center;margin:24px 0;">
        ${days > 1 ? `
        <span style="font-size:${days >= 10 ? "88px" : "100px"};font-weight:900;
          color:#34d399;line-height:1;display:block;
          font-family:'Courier New','Lucida Console',monospace;">
          ${days}
        </span>
        <span style="font-size:16px;color:rgba(255,255,255,.75);font-weight:700;
          text-transform:uppercase;letter-spacing:.15em;display:block;margin-top:8px;">
          day${days !== 1 ? "s" : ""} to go
        </span>` : `
        <span style="font-size:44px;font-weight:900;color:#34d399;
          display:block;font-family:'Courier New',monospace;letter-spacing:2px;">
          ${days === 0 ? "TODAY! 🎉" : "TOMORROW! ✈️"}
        </span>`}
        <div style="margin-top:16px;padding-top:16px;
          border-top:1px solid rgba(255,255,255,.15);">
          <p style="margin:0;font-size:15px;color:rgba(255,255,255,.85);font-weight:600;">
            ✈️ ${esc(dest)}
          </p>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,.55);">
            ${fmtDate(booking.travel_date)}
          </p>
        </div>
      </div>

      ${infoTable("📋 Your Trip", [
        row("Booking Ref",  booking.booking_number, true),
        row("Destination",  dest !== "Your Trip" ? dest : null),
        row("Country",      booking.country_name),
        row("Departure",    fmtDate(booking.travel_date)),
        row("Return",       fmtDate(booking.return_date)),
        row("Travelers",    booking.number_of_travelers),
      ])}

      <!-- Checklist -->
      <div style="background:${T.amberLight};border:1.5px solid ${T.amberBorder};
        border-radius:16px;padding:20px;margin:20px 0;">
        <p style="margin:0 0 14px;font-size:13px;font-weight:800;color:#92400e;
          text-transform:uppercase;letter-spacing:.07em;">
          ✅ ${days <= 3 ? "Final checklist" : "Preparation tips"}
        </p>
        ${c.tips.map(tip => `
        <p style="margin:0 0 10px;font-size:14px;color:#92400e;
          line-height:1.6;padding-left:4px;">
          ${esc(tip)}
        </p>`).join("")}
      </div>

      <!-- Need help -->
      <div style="background:linear-gradient(135deg,#022c22,#047857);
        border-radius:16px;padding:22px;text-align:center;margin:20px 0;">
        <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#fff;">
          Questions? We're here for you! 🦁
        </p>
        <p style="margin:0 0 16px;font-size:13px;color:rgba(255,255,255,.7);">
          Chat with your safari coordinator any time
        </p>
        <a href="${WA_URL}"
          style="display:inline-block;padding:12px 28px;
            background:#25D366;color:#fff;text-decoration:none;
            border-radius:30px;font-size:14px;font-weight:800;">
          💬 &nbsp;WhatsApp Our Team
        </a>
      </div>

      ${ctaBlock(
        "View Full Booking",
        `${ENV.frontendUrl}/my-bookings`,
        "Contact Your Coordinator",
        `mailto:${ENV.supportEmail}?subject=Countdown query — ${safe(booking.booking_number)}`,
      )}

      <p style="font-size:12px;color:${T.n500};text-align:center;
        line-height:1.6;margin-top:20px;">
        You're receiving countdown emails as your departure approaches. 🌿<br/>
        To stop, reply with "unsubscribe countdown" to
        <a href="mailto:${ENV.supportEmail}" style="color:${T.g600};">
          ${esc(ENV.supportEmail)}
        </a>
      </p>
    `,
  });

  return safeSend(
    booking.email,
    `${c.emoji} ${c.urgency} — ${dest} | ${ENV.appName}`,
    html,
    `sendTripCountdownEmail(${days}d)`,
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   8.  CANCELLATION REQUEST ACKNOWLEDGEMENT
───────────────────────────────────────────────────────────────────────── */
const sendCancellationRequestAck = async (booking, requestType = "cancellation") => {
  if (!booking?.email) return { success: false };

  const dest  = tripName(booking);
  const name  = safe(booking.full_name, "Explorer");
  const label = requestType === "refund" ? "Refund" : "Cancellation";

  const html = shell({
    preheader: `Your ${label.toLowerCase()} request for booking ${safe(booking.booking_number)} has been received. We'll respond within 24–48 hours.`,
    headerIcon: "📝",
    body: `
      ${heading(`${label} Request Received`, "📝")}
      ${para(`Hi <strong style="color:${T.n900};">${esc(name)}</strong>,`)}
      ${para(`We've received your <strong>${esc(label.toLowerCase())} request</strong>
        for booking <strong>${esc(safe(booking.booking_number))}</strong>
        (${esc(dest)}).
        Our team will review it carefully and get back to you within
        <strong style="color:${T.g600};">24–48 hours</strong>.`)}

      ${bookingSummary(booking)}

      <div style="background:${T.blueLight};border:1.5px solid #bfdbfe;
        border-left:4px solid ${T.blue};border-radius:0 14px 14px 0;
        padding:16px 20px;margin:16px 0;">
        <p style="margin:0;font-size:14px;color:#1e40af;line-height:1.65;">
          ℹ️ &nbsp;Your booking remains <strong>active</strong> until your
          ${label.toLowerCase()} request has been reviewed and approved
          by our team. We'll notify you by email of our decision.
        </p>
      </div>

      ${ctaBlock(
        "View My Booking",
        `${ENV.frontendUrl}/my-bookings`,
        "💬 Chat on WhatsApp",
        WA_URL,
      )}
    `,
  });

  return safeSend(
    booking.email,
    `📝 ${label} Request Received — ${safe(booking.booking_number)} | ${ENV.appName}`,
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
};