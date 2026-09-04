"use strict";

const { query } = require("../config/db");
const logger    = require("../utils/logger");

const cfg = {
  resendApiKey: process.env.RESEND_API_KEY || "",
  smtp: {
    host:   process.env.SMTP_HOST   || "smtp.gmail.com",
    port:   parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    user:   process.env.SMTP_USER   || "",
    pass:   process.env.SMTP_PASS   || "",
  },
  from: {
    name:    "Altuvera Safaris",
    address: process.env.SMTP_USER || "altuverasafari@gmail.com",
  },
  adminEmail:   process.env.ADMIN_EMAIL   || "altuverasafari@gmail.com",
  supportEmail: process.env.SUPPORT_EMAIL || "altuverasafari@gmail.com",
  replyTo:      process.env.SUPPORT_EMAIL || "altuverasafari@gmail.com",
  appName:      process.env.APP_NAME      || "Altuvera Safaris",
  appUrl:       process.env.FRONTEND_URL  || "https://www.altuverasafaris.com",
  frontendUrl:  process.env.FRONTEND_URL  || "https://www.altuverasafaris.com",
  backendUrl:   process.env.BACKEND_URL   || "https://backend-jd8f.onrender.com",
  isDev:        process.env.NODE_ENV      !== "production",
};

const CFG = cfg; // Alias for compatibility

/* ── lazy SMTP transporter ─────────────────────────────────────────────────── */
let _smtp = null;
function getSmtp() {
  if (_smtp) return _smtp;
  if (!cfg.smtp.user || !cfg.smtp.pass) return null;
  try {
    const nodemailer = require("nodemailer");
    _smtp = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: cfg.smtp.secure,
      auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
      tls:  { rejectUnauthorized: false },
      connectionTimeout: 8000,
    });
    logger.info("[Email] SMTP ready");
    return _smtp;
  } catch (e) {
    logger.warn("[Email] SMTP init failed:", e.message);
    return null;
  }
}

/* ── Connection Verifier for Server Boot ──────────────────────────────────── */
async function verifyEmailConnection() {
  const smtp = getSmtp();
  if (!smtp) return false;
  try {
    await smtp.verify();
    logger.info("[Email] SMTP connection verified successfully");
    return true;
  } catch (err) {
    logger.warn("[Email] SMTP verification check failed:", err.message);
    return false;
  }
}

/* ── utilities ─────────────────────────────────────────────────────────────── */
const stripHtml = (h = "") =>
  h.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();

const esc = (s = "") =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  } catch { return String(d); }
};

const fmtDateTime = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(d); }
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
  if (days < 7) return `in ${days} day${days !== 1 ? "s" : ""}`;
  const weeks = Math.floor(days / 7);
  const remDays = days % 7;
  if (days < 30) {
    return remDays > 0
      ? `in ${weeks} week${weeks !== 1 ? "s" : ""} and ${remDays} day${remDays !== 1 ? "s" : ""}`
      : `in ${weeks} week${weeks !== 1 ? "s" : ""}`;
  }
  const months = Math.floor(days / 30);
  const remMons = days - months * 30;
  if (days < 365) {
    return remMons > 0
      ? `in ${months} month${months !== 1 ? "s" : ""} and ${remMons} day${remMons !== 1 ? "s" : ""}`
      : `in ${months} month${months !== 1 ? "s" : ""}`;
  }
  const years = Math.floor(days / 365);
  return `in ${years} year${years !== 1 ? "s" : ""}`;
};

const badgeCls = (s) => ({
  pending:   "b-pending",
  confirmed: "b-confirmed",
  cancelled: "b-cancelled",
  completed: "b-completed",
  "on-hold": "b-hold",
  refunded:  "b-refunded",
})[s] || "b-pending";

const STATUS = {
  pending:   { label: "Pending Review",   color: "#92400e" },
  confirmed: { label: "Confirmed",        color: "#166534" },
  "on-hold": { label: "On Hold",          color: "#9d174d" },
  completed: { label: "Completed",        color: "#1e40af" },
  cancelled: { label: "Cancelled",        color: "#991b1b" },
  refunded:  { label: "Refunded",         color: "#5b21b6" },
};

function tripName(booking = {}) {
  return booking.destination_name ||
         booking.service_name ||
         booking.package_name ||
         booking.destination ||
         booking.service ||
         booking.package ||
         "Your Trip";
}

function safe(value, fallback = "—") {
  return value == null || value === "" ? fallback : String(value);
}

/* ════════════════════════════════════════════════════════════════════════════════
    CORE sendEmail
═══════════════════════════════════════════════════════════════════════════════ */
async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!to || !subject || (!html && !text))
    throw new Error("sendEmail: to, subject, html/text required");

  const plain = text || stripHtml(html);

  if (cfg.resendApiKey) {
    const body = {
      from:     `${cfg.from.name} <onboarding@resend.dev>`,
      to:       Array.isArray(to) ? to : [to],
      subject,
      html:     html || `<pre>${plain}</pre>`,
      text:     plain,
      reply_to: replyTo || cfg.replyTo,
    };
    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${cfg.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(`Resend ${res.status}: ${json?.message || JSON.stringify(json)}`);
    logger.info(`[Email] Resend ✅ → ${to} | id:${json.id}`);
    return { success: true, provider: "resend", messageId: json.id };
  }

  const smtp = getSmtp();
  if (smtp) {
    const info = await smtp.sendMail({
      from:    `"${cfg.from.name}" <${cfg.from.address}>`,
      to, subject, html, text: plain,
      replyTo: replyTo || cfg.replyTo,
    });
    logger.info(`[Email] SMTP ✅ → ${to} | msgId:${info.messageId}`);
    return { success: true, provider: "smtp", messageId: info.messageId };
  }

  logger.info(`[Email] CONSOLE FALLBACK → ${to} | Subject: ${subject}`);
  return { success: true, provider: "console", messageId: `console-${Date.now()}` };
}

/* ════════════════════════════════════════════════════════════════════════════════
    GLOBAL CSS
════════════════════════════════════════════════════════════════════════════════ */
const GLOBAL_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
      background:#f0fdf4;color:#0f172a;line-height:1.65;-webkit-text-size-adjust:100%}
img{border:0;display:block;max-width:100%;height:auto}
a{color:#059669;text-decoration:none}
.outer{background:#f0fdf4;padding:28px 12px}
.w{max-width:620px;margin:0 auto}
.card{background:#ffffff;border-radius:20px;overflow:hidden;
      box-shadow:0 8px 40px rgba(2,44,34,.10),0 1px 4px rgba(0,0,0,.04);
      border:1px solid #d1fae5}
.hdr{background:linear-gradient(140deg,#022c22 0%,#064e3b 50%,#047857 100%);
      padding:32px 28px 26px;text-align:center;position:relative;overflow:hidden}
.hdr-glow{position:absolute;top:-60px;left:50%;transform:translateX(-50%);
           width:260px;height:260px;border-radius:50%;
           background:radial-gradient(circle,rgba(52,211,153,.18) 0%,transparent 70%);
           pointer-events:none}
.brand{font-size:13px;font-weight:700;color:rgba(255,255,255,.55);
        letter-spacing:.18em;text-transform:uppercase;margin-bottom:10px}
.logo-txt{font-size:26px;font-weight:900;color:#fff;letter-spacing:-.025em;line-height:1}
.logo-txt em{color:#34d399;font-style:normal}
.tagline{font-size:12px;color:rgba(255,255,255,.45);margin-top:6px;letter-spacing:.04em}
.body-pad{padding:34px 30px}
.box{background:#f0fdf4;border-radius:14px;padding:18px 22px;
      border:1px solid #a7f3d0;margin:18px 0}
.box-title{font-size:10.5px;font-weight:800;color:#065f46;
            text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px}
.row{display:flex;justify-content:space-between;align-items:flex-start;
      padding:7px 0;border-bottom:1px solid #a7f3d0;line-height:1.5}
.row:last-child{border:none;padding-bottom:0}
.lbl{color:#64748b;font-weight:500;white-space:nowrap;flex-shrink:0;min-width:120px}
.val{color:#0f172a;font-weight:600;text-align:right;word-break:break-word;flex:1}
.bd{display:inline-block;padding:3px 11px;border-radius:999px;
     font-size:11px;font-weight:700;letter-spacing:.04em;vertical-align:middle}
.b-pending  {background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.b-confirmed{background:#dcfce7;color:#166534;border:1px solid #86efac}
.b-cancelled{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
.b-completed{background:#dbeafe;color:#1e40af;border:1px solid #93c5fd}
.b-hold     {background:#fce7f3;color:#9d174d;border:1px solid #f9a8d4}
.b-refunded {background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd}
.btn-row{text-align:center;margin:26px 0 10px}
.btn{display:inline-block;padding:14px 30px;border-radius:14px;font-weight:700;
      font-size:14px;letter-spacing:.01em;margin:4px 5px;line-height:1;
      border:2px solid transparent}
.btn-g{background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:#fff!important;
       box-shadow:0 6px 20px rgba(5,150,105,.35)}
.btn-o{background:#f0fdf4;color:#059669!important;border-color:#a7f3d0}
.div{height:1px;background:linear-gradient(90deg,transparent,#d1fae5 40%,#a7f3d0 50%,#d1fae5 60%,transparent);
     margin:24px 0}
.warn{background:#fffbeb;border-radius:12px;padding:14px 18px;
      border:1px solid #fde68a;margin:14px 0}
.warn p{font-size:13px;color:#92400e;margin:0;line-height:1.6}
.info-box{background:#eff6ff;border-radius:12px;padding:14px 18px;
          border:1px solid #bfdbfe;margin:14px 0}
.info-box p{font-size:13px;color:#1e40af;margin:0;line-height:1.6}
.stats{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
.stat{flex:1;min-width:90px;text-align:center;padding:14px 10px;
      background:#f0fdf4;border-radius:12px;border:1px solid #a7f3d0}
.stat-num{font-size:18px;font-weight:900;color:#022c22;line-height:1}
.stat-lbl{font-size:10px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.06em}
.cd{text-align:center;padding:30px 20px;
     background:linear-gradient(140deg,#022c22,#064e3b 55%,#047857);
     border-radius:18px;margin:22px 0;position:relative;overflow:hidden}
.cd-glow{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
          width:300px;height:300px;border-radius:50%;
          background:radial-gradient(circle,rgba(52,211,153,.15) 0%,transparent 70%)}
.cd-val{font-size:52px;font-weight:900;color:#34d399;
         font-family:'Courier New',Courier,monospace;letter-spacing:.02em;
         line-height:1;position:relative}
.cd-unit{font-size:11px;color:rgba(255,255,255,.45);text-transform:uppercase;
          letter-spacing:.15em;margin-top:5px;position:relative}
.cd-dest{font-size:16px;color:#fff;margin-top:14px;font-weight:700;
          position:relative;line-height:1.4}
.cd-date{font-size:12px;color:rgba(255,255,255,.5);margin-top:5px;position:relative}
.ftr{padding:22px 28px;text-align:center;background:#f8fafc;
      border-top:1px solid #e2e8f0}
.ftr p{font-size:11.5px;color:#94a3b8;line-height:1.8;margin-bottom:2px}
.ftr a{color:#059669;font-weight:600}
@media(max-width:500px){
  .body-pad{padding:22px 18px}
  .hdr{padding:24px 18px 20px}
  .row{flex-direction:column;gap:2px}.val{text-align:left}
  .btn{display:block;text-align:center;margin:6px 0}
  .cd-val{font-size:40px}
  .stats{flex-direction:column}
  .stat{min-width:unset}
  .lbl{min-width:unset}
}
`;

/* ════════════════════════════════════════════════════════════════════════════════
    BASE HTML SHELL
════════════════════════════════════════════════════════════════════════════════ */
function shell({ title, preheader = "", body, footer = "", extraCss = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>${GLOBAL_CSS}${extraCss}</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f0fdf4;">
  ${esc(preheader)}
</div>
<div class="outer">
<div class="w"><div class="card">
  <div class="hdr">
    <div class="hdr-glow"></div>
    <div class="brand">Authentic African Experiences</div>
    <div class="logo-txt">🌍 <em>Altuvera</em> Safaris</div>
    <div class="tagline">Where Africa's Soul Meets World-Class Adventure</div>
  </div>
  <div class="body-pad">${body}</div>
  <div class="ftr">
    ${footer ? `<p style="margin-bottom:10px;color:#64748b;font-size:12px">${footer}</p>` : ""}
    <p>
      <a href="${cfg.appUrl}">Website</a> &nbsp;·&nbsp;
      <a href="${cfg.appUrl}/destinations">Destinations</a> &nbsp;·&nbsp;
      <a href="mailto:${cfg.supportEmail}">Support</a> &nbsp;·&nbsp;
      <a href="https://wa.me/250785751391">WhatsApp</a>
    </p>
    <p style="margin-top:8px">© ${new Date().getFullYear()} Altuvera Safaris · All rights reserved</p>
  </div>
</div></div></div>
</body></html>`;
}

/* ════════════════════════════════════════════════════════════════════════════════
    1. sendBookingVerificationLink
════════════════════════════════════════════════════════════════════════════════ */
async function sendBookingVerificationLink(booking, verificationToken) {
  const {
    email,
    full_name        = "Explorer",
    booking_number   = booking.id || "N/A",
    destination_name = tripName(booking),
    country_name,
    travel_date,
    number_of_travelers = 1,
  } = booking || {};

  if (!email || !verificationToken) {
    logger.warn("[Email] sendBookingVerificationLink: missing email or token");
    return { success: false, reason: "missing_params" };
  }

  const verifyUrl = `${cfg.backendUrl}/api/bookings/verify-email/${verificationToken}`;

  const html = shell({
    title:     "Confirm Your Booking Request — Altuvera Safaris",
    preheader: `One click to secure your ${destination_name} adventure.`,
    body: `
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:48px;">✉️</div>
        <h1 style="font-size:20px;font-weight:800;color:#022c22;margin:10px 0;">Verify Your Email Address</h1>
        <p style="color:#475569;font-size:14px;">
          Almost there, <strong>${esc(full_name)}</strong>! Click below to confirm your booking request.
        </p>
      </div>

      <div class="box">
        <div class="box-title">📋 Booking Snapshot</div>
        <div class="row"><span class="lbl">Booking Ref</span><span class="val">${esc(String(booking_number))}</span></div>
        <div class="row"><span class="lbl">Destination</span><span class="val">🌍 ${esc(destination_name)}${country_name ? `, ${esc(country_name)}` : ""}</span></div>
        ${travel_date ? `<div class="row"><span class="lbl">Travel Date</span><span class="val">📅 ${fmtDate(travel_date)}</span></div>` : ""}
        <div class="row"><span class="lbl">Travelers</span><span class="val">👥 ${esc(String(number_of_travelers))}</span></div>
      </div>

      <div class="btn-row">
        <a href="${verifyUrl}" class="btn btn-g">✅ Confirm My Booking Request</a>
      </div>
    `,
    footer: "This verification link expires in 24 hours.",
  });

  return sendEmail({
    to: email,
    subject: `✅ Please verify your booking: ${destination_name} — Altuvera Safaris`,
    html,
  });
}

/* ═════════════════════════════════════════════════════════════════════════════════
    2. sendAdminBookingNotification
════════════════════════════════════════════════════════════════════════════════ */
async function sendAdminBookingNotification(booking) {
  const adminEmail = cfg.adminEmail;
  if (!adminEmail) return { success: false, reason: "no_admin_email" };

  const {
    booking_number      = booking.id || "N/A",
    full_name           = "Guest",
    email               = "",
    phone               = "—",
    whatsapp            = phone,
    nationality,
    country,
    source              = "website",
    booking_type        = "Safari",
    travel_date,
    return_date,
    flexible_dates,
    number_of_travelers = 1,
    accommodation_type,
    dietary_requirements,
    status              = "pending",
    created_at,
    special_requests,
  } = booking || {};

  const dest = tripName(booking);

  const html = shell({
    title:     `🔔 New Verified Booking: #${booking_number}`,
    preheader: `New verified booking from ${full_name} for ${dest}.`,
    body: `
      <div style="background:#022c22;border-radius:12px;padding:16px;color:#fff;margin-bottom:16px;">
        <h2 style="color:#34d399;font-size:18px;">🔔 New Verified Booking</h2>
        <p style="font-size:13px;color:#e2e8f0;">Customer verified their email · Awaiting review</p>
      </div>

      <div class="stats">
        <div class="stat"><div class="stat-num">#${esc(String(booking_number))}</div><div class="stat-lbl">Ref</div></div>
        <div class="stat"><div class="stat-num">${esc(String(number_of_travelers))}</div><div class="stat-lbl">Travelers</div></div>
        <div class="stat"><div class="stat-num">${esc(source)}</div><div class="stat-lbl">Source</div></div>
      </div>

      <div class="box">
        <div class="box-title">👤 Customer Details</div>
        <div class="row"><span class="lbl">Full Name</span><span class="val">${esc(full_name)}</span></div>
        <div class="row"><span class="lbl">Email</span><span class="val"><a href="mailto:${esc(email)}">${esc(email)}</a></span></div>
        <div class="row"><span class="lbl">Phone</span><span class="val">${esc(phone)}</span></div>
        ${nationality ? `<div class="row"><span class="lbl">Nationality</span><span class="val">${esc(nationality)}</span></div>` : ""}
      </div>

      <div class="box">
        <div class="box-title">🗺️ Trip Details</div>
        <div class="row"><span class="lbl">Destination</span><span class="val">🌍 ${esc(dest)}</span></div>
        ${travel_date ? `<div class="row"><span class="lbl">Departure</span><span class="val">📅 ${fmtDate(travel_date)}</span></div>` : ""}
        ${return_date ? `<div class="row"><span class="lbl">Return</span><span class="val">📅 ${fmtDate(return_date)}</span></div>` : ""}
        ${special_requests ? `<div class="row"><span class="lbl">Notes</span><span class="val">${esc(special_requests)}</span></div>` : ""}
      </div>

      <div class="btn-row">
        <a href="${cfg.frontendUrl}/admin/bookings" class="btn btn-g">Open Admin Panel →</a>
      </div>
    `,
  });

  return sendEmail({
    to: adminEmail,
    replyTo: email,
    subject: `🔔 New Verified Booking #${booking_number} — ${full_name} → ${dest}`,
    html,
  });
}

/* ════════════════════════════════════════════════════════════════════════════════
    3. sendBookingConfirmation
════════════════════════════════════════════════════════════════════════════════ */
async function sendBookingConfirmation(booking) {
  const {
    email,
    full_name           = "Valued Guest",
    booking_number      = booking.id || "N/A",
    country_name,
    travel_date,
    return_date,
    number_of_travelers = 1,
    accommodation_type,
    special_requests,
    confirmation_code,
  } = booking || {};

  if (!email) return { success: false, reason: "no_email" };

  const trip      = tripName(booking);
  const tDate     = travel_date ? new Date(travel_date) : null;
  const countdown = tDate ? humanCountdown(tDate) : null;

  const html = shell({
    title:     `🎉 Booking Confirmed — Your ${trip} Adventure!`,
    preheader: `Congratulations ${full_name}! Your booking #${booking_number} is confirmed.`,
    body: `
      <div style="background:linear-gradient(135deg,#022c22,#047857);border-radius:18px;padding:26px;text-align:center;color:#fff;margin-bottom:20px;">
        <div style="font-size:46px;">🎉</div>
        <h1 style="font-size:22px;font-weight:900;margin:8px 0;color:#fff;">Booking Confirmed!</h1>
        <p style="font-size:13.5px;color:#e2e8f0;">Get ready, <strong>${esc(full_name)}</strong>! Africa is waiting for you.</p>
        <div style="margin-top:14px;display:inline-block;padding:8px 18px;background:rgba(255,255,255,0.1);border-radius:10px;color:#34d399;font-weight:900;">
          Ref: ${esc(String(booking_number))}
        </div>
      </div>

      <div class="box">
        <div class="box-title">📋 Trip Summary</div>
        <div class="row"><span class="lbl">Destination</span><span class="val">🌍 ${esc(trip)}${country_name ? `, ${esc(country_name)}` : ""}</span></div>
        ${travel_date ? `<div class="row"><span class="lbl">Departure</span><span class="val">📅 ${fmtDate(travel_date)}</span></div>` : ""}
        ${return_date ? `<div class="row"><span class="lbl">Return</span><span class="val">📅 ${fmtDate(return_date)}</span></div>` : ""}
        <div class="row"><span class="lbl">Travelers</span><span class="val">👥 ${esc(String(number_of_travelers))}</span></div>
      </div>

      <div class="btn-row">
        <a href="${cfg.frontendUrl}/my-bookings" class="btn btn-g">View My Booking</a>
      </div>
    `,
  });

  return sendEmail({
    to: email,
    subject: `🎉 Confirmed: Your ${trip} Safari Adventure | Altuvera Safaris`,
    html,
  });
}

/* ═════════════════════════════════════════════════════════════════════════════════
    4. sendBookingStatusUpdate
═════════════════════════════════════════════════════════════════════════════════ */
async function sendBookingStatusUpdate(booking, oldStatus, newStatus, reason = "") {
  if (!booking?.email) return { success: false, reason: "no_email" };

  const {
    full_name      = "Valued Guest",
    booking_number = booking.id || "N/A",
    travel_date,
  } = booking;

  const dest = tripName(booking);

  const html = shell({
    title:     `Booking Update: #${booking_number} is now ${newStatus}`,
    preheader: `Your booking #${booking_number} status is now ${newStatus}.`,
    body: `
      <div style="text-align:center;margin-bottom:20px;">
        <h2 style="font-size:20px;font-weight:800;color:#022c22;">Booking Status Updated</h2>
        <p style="color:#475569;font-size:14px;margin-top:6px;">
          Hi <strong>${esc(full_name)}</strong>, the status of your booking has changed:
        </p>
        <div style="margin:16px 0;">
          <span class="bd ${badgeCls(oldStatus)}">${esc(oldStatus)}</span>
          <span style="margin:0 8px;color:#94a3b8;">→</span>
          <span class="bd ${badgeCls(newStatus)}">${esc(newStatus)}</span>
        </div>
      </div>

      <div class="box">
        <div class="box-title">📋 Booking Details</div>
        <div class="row"><span class="lbl">Booking Ref</span><span class="val">${esc(String(booking_number))}</span></div>
        <div class="row"><span class="lbl">Destination</span><span class="val">🌍 ${esc(dest)}</span></div>
        ${travel_date ? `<div class="row"><span class="lbl">Travel Date</span><span class="val">📅 ${fmtDate(travel_date)}</span></div>` : ""}
      </div>

      ${reason ? `<div class="warn"><p>📝 <strong>Note:</strong> ${esc(reason)}</p></div>` : ""}

      <div class="btn-row">
        <a href="${cfg.frontendUrl}/my-bookings" class="btn btn-g">View My Booking</a>
      </div>
    `,
  });

  return sendEmail({
    to: booking.email,
    subject: `🔄 Booking Update: #${booking_number} is now "${newStatus}" | Altuvera Safaris`,
    html,
  });
}

/* ═════════════════════════════════════════════════════════════════════════════════
    5. sendBookingCancellation
═════════════════════════════════════════════════════════════════════════════════ */
async function sendBookingCancellation(booking, reason = "") {
  if (!booking?.email) return { success: false, reason: "no_email" };

  const {
    full_name      = "Valued Guest",
    booking_number = booking.id || "N/A",
    country_name,
    travel_date,
  } = booking;

  const dest = tripName(booking);

  const html = shell({
    title:     `Booking Cancelled — #${booking_number}`,
    preheader: `Your booking #${booking_number} has been cancelled.`,
    body: `
      <div style="background:#fee2e2;border-radius:14px;padding:20px;text-align:center;margin-bottom:20px;">
        <div style="font-size:40px;">❌</div>
        <h2 style="color:#991b1b;margin-top:6px;">Booking Cancelled</h2>
        <p style="color:#7f1d1d;font-size:13.5px;">
          Hi <strong>${esc(full_name)}</strong>, your booking request has been cancelled.
        </p>
      </div>

      <div class="box" style="border-color:#fca5a5;">
        <div class="box-title" style="color:#991b1b;">📋 Details</div>
        <div class="row"><span class="lbl">Booking Ref</span><span class="val">${esc(String(booking_number))}</span></div>
        <div class="row"><span class="lbl">Destination</span><span class="val">🌍 ${esc(dest)}${country_name ? `, ${esc(country_name)}` : ""}</span></div>
        ${travel_date ? `<div class="row"><span class="lbl">Travel Date</span><span class="val">📅 ${fmtDate(travel_date)}</span></div>` : ""}
      </div>

      ${reason ? `<div class="warn"><p>📝 <strong>Reason:</strong> ${esc(reason)}</p></div>` : ""}

      <div class="btn-row">
        <a href="${cfg.frontendUrl}/destinations" class="btn btn-g">Explore Other Trips</a>
      </div>
    `,
  });

  return sendEmail({
    to: booking.email,
    subject: `Booking Cancelled — #${booking_number} | Altuvera Safaris`,
    html,
  });
}

/* ═════════════════════════════════════════════════════════════════════════════════
    6. sendTripCountdownEmail
═════════════════════════════════════════════════════════════════════════════════ */
async function sendTripCountdownEmail(booking) {
  if (!booking?.email || !booking?.travel_date) return { success: false, reason: "no_email_or_date" };
  const days = daysUntil(booking.travel_date);
  if (days === null || days < 0) return { success: false, reason: "past_date" };

  const dest = tripName(booking);

  const html = shell({
    title:     `⏳ ${days} Day${days === 1 ? "" : "s"} Until Your ${dest} Safari!`,
    preheader: `Get ready! Your safari starts ${days === 0 ? "today" : `in ${days} days`}.`,
    body: `
      <div class="cd">
        <div class="cd-glow"></div>
        <div class="cd-val">${days}</div>
        <div class="cd-unit">Day${days === 1 ? "" : "s"} To Go</div>
        <div class="cd-dest">✈️ ${esc(dest)}</div>
        <div class="cd-date">Departing: ${fmtDate(booking.travel_date)}</div>
      </div>

      <div class="box">
        <div class="box-title">🧳 Preparation Reminders</div>
        <div class="row"><span class="lbl">Passports & Visas</span><span class="val">Check validity (6+ months)</span></div>
        <div class="row"><span class="lbl">Packing</span><span class="val">Neutral clothing, chargers, meds</span></div>
      </div>

      <div class="btn-row">
        <a href="${cfg.frontendUrl}/my-bookings" class="btn btn-g">View Trip Details</a>
      </div>
    `,
  });

  return sendEmail({
    to: booking.email,
    subject: `⏳ ${days} Day${days === 1 ? "" : "s"} until ${dest}! | Altuvera Safaris`,
    html,
  });
}

/* ═════════════════════════════════════════════════════════════════════════════════
    7. sendBookingReceivedEmail
═════════════════════════════════════════════════════════════════════════════════ */
async function sendBookingReceivedEmail(booking) {
  if (!booking?.email) return { success: false, reason: "no_email" };

  const {
    full_name           = "Valued Guest",
    booking_number      = booking.id || "N/A",
    country_name,
    travel_date,
    number_of_travelers = 1,
  } = booking;

  const dest = tripName(booking);

  const html = shell({
    title:     `📬 Booking Received — #${booking_number}`,
    preheader: `We've received your booking request for ${dest}.`,
    body: `
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:46px;">📬</div>
        <h1 style="font-size:20px;font-weight:800;color:#022c22;margin:8px 0;">Booking Received</h1>
        <p style="color:#475569;font-size:14px;">
          Thanks, <strong>${esc(full_name)}</strong>! Our team is reviewing availability and will reach out within 24 hours.
        </p>
      </div>

      <div class="box">
        <div class="box-title">📋 Request Details</div>
        <div class="row"><span class="lbl">Booking Ref</span><span class="val">${esc(String(booking_number))}</span></div>
        <div class="row"><span class="lbl">Destination</span><span class="val">🌍 ${esc(dest)}${country_name ? `, ${esc(country_name)}` : ""}</span></div>
        ${travel_date ? `<div class="row"><span class="lbl">Travel Date</span><span class="val">📅 ${fmtDate(travel_date)}</span></div>` : ""}
        <div class="row"><span class="lbl">Travelers</span><span class="val">👥 ${esc(String(number_of_travelers))}</span></div>
      </div>

      <div class="btn-row">
        <a href="${cfg.frontendUrl}/my-bookings" class="btn btn-g">Track Status</a>
      </div>
    `,
  });

  return sendEmail({
    to: booking.email,
    subject: `📬 Booking Received — #${booking_number} | Altuvera Safaris`,
    html,
  });
}

/* ═════════════════════════════════════════════════════════════════════════════════
    8. sendDestinationAlertEmail
═════════════════════════════════════════════════════════════════════════════════ */
async function sendDestinationAlertEmail(destination) {
  const {
    name = "New Destination",
    slug,
    country_name,
    image_url,
    short_description,
  } = destination || {};

  if (!slug) {
    logger.warn("[Email] sendDestinationAlertEmail: no slug");
    return { success: false, reason: "no_slug" };
  }

  const destinationUrl = `${cfg.appUrl}/destinations/${slug}`;
  const imageToUse = image_url || "https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?w=1200&q=85";

  const html = shell({
    title:     `🌟 New Destination Alert: ${name} is now live!`,
    preheader: `Explore our newest destination and book your next safari adventure.`,
    body: `
      <div style="border-radius:14px;overflow:hidden;margin-bottom:16px;">
        <img src="${imageToUse}" alt="${esc(name)}" style="width:100%;height:220px;object-fit:cover;" />
      </div>

      <h1 style="font-size:22px;font-weight:900;color:#022c22;margin-bottom:8px;">
        📍 ${esc(name)}${country_name ? `, ${esc(country_name)}` : ""}
      </h1>
      ${short_description ? `<p style="color:#475569;font-size:14px;margin-bottom:20px;">${esc(short_description)}</p>` : ""}

      <div class="btn-row">
        <a href="${destinationUrl}" class="btn btn-g">🌟 Explore ${esc(name)}</a>
      </div>
    `,
  });

  try {
    const { rows } = await query(
      `SELECT email, name FROM subscribers WHERE is_active = true AND email IS NOT NULL`
    );

    let sent = 0;
    let failed = 0;

    for (const sub of rows) {
      try {
        await sendEmail({
          to: sub.email,
          subject: `🌟 New Destination Alert: ${name} is live! | Altuvera Safaris`,
          html,
        });
        sent++;
      } catch (err) {
        failed++;
        logger.warn(`[Email] Destination alert failed for ${sub.email}: ${err.message}`);
      }

      if (rows.length > 10) {
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    logger.info(`[Email] Destination alert sent: ${sent} success, ${failed} failed`);
    return { success: sent > 0, sent, failed, total: rows.length };
  } catch (err) {
    logger.error("[Email] sendDestinationAlertEmail DB error:", err.message);
    return { success: false, error: err.message };
  }
}

/* ─── EXPORTS ──────────────────────────────────────────────────────────────── */
module.exports = {
  sendEmail,
  verifyEmailConnection,
  sendBookingVerificationLink,
  sendAdminBookingNotification,
  sendBookingReceivedEmail,
  sendBookingConfirmation,
  sendBookingStatusUpdate,
  sendBookingCancellation,
  sendTripCountdownEmail,
  sendDestinationAlertEmail,
};