// services/emailService.js
"use strict";

const CFG = {
  resendApiKey:  process.env.RESEND_API_KEY     || "",
  smtp: {
    host:   process.env.SMTP_HOST   || "smtp.gmail.com",
    port:   parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    user:   process.env.SMTP_USER   || "",
    pass:   process.env.SMTP_PASS   || "",
  },
  from: {
    name:    "Altuvera Travel",
    address: process.env.SMTP_USER || "altuverasafari@gmail.com",
  },
  adminEmail:   process.env.ADMIN_EMAIL   || "altuverasafari@gmail.com",
  supportEmail: process.env.SUPPORT_EMAIL || "altuverasafari@gmail.com",
  replyTo:      process.env.SUPPORT_EMAIL || "altuverasafari@gmail.com",
  appName:      process.env.APP_NAME      || "Altuvera Travel",
  appUrl:       process.env.FRONTEND_URL  || "https://www.altuverasafaris.com",
  backendUrl:   process.env.BACKEND_URL   || "https://backend-jd8f.onrender.com",
  isDev:        process.env.NODE_ENV      !== "production",
};

/* ── lazy SMTP transporter ─────────────────────────────────────────────────── */
let _smtp = null;
function getSmtp() {
  if (_smtp) return _smtp;
  if (!CFG.smtp.user || !CFG.smtp.pass) return null;
  try {
    const nodemailer = require("nodemailer");
    _smtp = nodemailer.createTransport({
      host: CFG.smtp.host, port: CFG.smtp.port, secure: CFG.smtp.secure,
      auth: { user: CFG.smtp.user, pass: CFG.smtp.pass },
      tls:  { rejectUnauthorized: false },
      connectionTimeout: 8000,
    });
    console.log("[Email] SMTP ready");
    return _smtp;
  } catch (e) {
    console.warn("[Email] SMTP init failed:", e.message);
    return null;
  }
}

/* ── utilities ─────────────────────────────────────────────────────────────── */
const stripHtml = (h = "") =>
  h.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();

const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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

const badgeCls = (s) => ({
  pending:   "b-pending",
  confirmed: "b-confirmed",
  cancelled: "b-cancelled",
  completed: "b-completed",
  "on-hold": "b-hold",
  refunded:  "b-refunded",
})[s] || "b-pending";

function humanCountdown(targetDate) {
  const now  = new Date();
  now.setHours(0, 0, 0, 0);
  const then = new Date(targetDate);
  then.setHours(0, 0, 0, 0);
  const diffMs   = then - now;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0)  return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 7)   return `in ${diffDays} day${diffDays !== 1 ? "s" : ""}`;
  const weeks = Math.floor(diffDays / 7);
  const days  = diffDays % 7;
  if (diffDays < 30) {
    return days > 0
      ? `in ${weeks} week${weeks !== 1 ? "s" : ""} and ${days} day${days !== 1 ? "s" : ""}`
      : `in ${weeks} week${weeks !== 1 ? "s" : ""}`;
  }
  const months  = Math.floor(diffDays / 30);
  const remDays = diffDays - months * 30;
  if (diffDays < 365) {
    return remDays > 0
      ? `in ${months} month${months !== 1 ? "s" : ""} and ${remDays} day${remDays !== 1 ? "s" : ""}`
      : `in ${months} month${months !== 1 ? "s" : ""}`;
  }
  const years   = Math.floor(diffDays / 365);
  const remMons = Math.floor((diffDays % 365) / 30);
  return remMons > 0
    ? `in ${years} year${years !== 1 ? "s" : ""} and ${remMons} month${remMons !== 1 ? "s" : ""}`
    : `in ${years} year${years !== 1 ? "s" : ""}`;
}

/* ══════════════════════════════════════════════════════════════════════════════
   CORE sendEmail
══════════════════════════════════════════════════════════════════════════════ */
async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!to || !subject || (!html && !text))
    throw new Error("sendEmail: to, subject, html/text required");

  const plain = text || stripHtml(html);

  if (CFG.resendApiKey) {
    const body = {
      from:     `${CFG.from.name} <onboarding@resend.dev>`,
      to:       Array.isArray(to) ? to : [to],
      subject,
      html:     html || `<pre>${plain}</pre>`,
      text:     plain,
      reply_to: replyTo || CFG.replyTo,
    };
    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${CFG.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(`Resend ${res.status}: ${json?.message || JSON.stringify(json)}`);
    console.log(`[Email] Resend ✅ → ${to} | id:${json.id}`);
    return { success: true, provider: "resend", messageId: json.id };
  }

  const smtp = getSmtp();
  if (smtp) {
    const info = await smtp.sendMail({
      from:    `"${CFG.from.name}" <${CFG.from.address}>`,
      to, subject, html, text: plain,
      replyTo: replyTo || CFG.replyTo,
    });
    console.log(`[Email] SMTP ✅ → ${to} | msgId:${info.messageId}`);
    return { success: true, provider: "smtp", messageId: info.messageId };
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log("[Email] CONSOLE FALLBACK");
  console.log(`  TO:      ${to}`);
  console.log(`  SUBJECT: ${subject}`);
  console.log(`  PREVIEW: ${plain.slice(0, 300)}`);
  console.log(`${"═".repeat(60)}\n`);
  return { success: true, provider: "console", messageId: `console-${Date.now()}` };
}

/* ══════════════════════════════════════════════════════════════════════════════
   GLOBAL CSS  (shared across all templates)
══════════════════════════════════════════════════════════════════════════════ */
const GLOBAL_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
     background:#f0fdf4;color:#0f172a;line-height:1.65;-webkit-text-size-adjust:100%}
img{border:0;display:block;max-width:100%;height:auto}
a{color:#059669;text-decoration:none}

/* layout */
.outer{background:#f0fdf4;padding:28px 12px}
.w{max-width:620px;margin:0 auto}
.card{background:#ffffff;border-radius:20px;overflow:hidden;
      box-shadow:0 8px 40px rgba(2,44,34,.10),0 1px 4px rgba(0,0,0,.04);
      border:1px solid #d1fae5}

/* header */
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

/* body area */
.body-pad{padding:34px 30px}

/* typography */
.h1{font-size:22px;font-weight:800;color:#022c22;letter-spacing:-.02em;line-height:1.25;margin-bottom:6px}
.h2{font-size:16px;font-weight:700;color:#064e3b;letter-spacing:-.01em;margin-bottom:12px}
.lead{font-size:14.5px;color:#475569;line-height:1.7;margin-bottom:18px}
.small{font-size:12px;color:#94a3b8}

/* info box */
.box{background:#f0fdf4;border-radius:14px;padding:18px 22px;
     border:1px solid #a7f3d0;margin:18px 0}
.box-title{font-size:10.5px;font-weight:800;color:#065f46;
           text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px;
           display:flex;align-items:center;gap:6px}
.row{display:flex;justify-content:space-between;align-items:flex-start;
     padding:7px 0;border-bottom:1px solid rgba(167,243,208,.4);font-size:13.5px;gap:10px}
.row:last-child{border:none;padding-bottom:0}
.lbl{color:#64748b;font-weight:500;white-space:nowrap;flex-shrink:0;min-width:120px}
.val{color:#0f172a;font-weight:600;text-align:right;word-break:break-word;flex:1}

/* badges */
.bd{display:inline-block;padding:3px 11px;border-radius:999px;
    font-size:11px;font-weight:700;letter-spacing:.04em;vertical-align:middle}
.b-pending  {background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.b-confirmed{background:#dcfce7;color:#166534;border:1px solid #86efac}
.b-cancelled{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
.b-completed{background:#dbeafe;color:#1e40af;border:1px solid #93c5fd}
.b-hold     {background:#fce7f3;color:#9d174d;border:1px solid #f9a8d4}
.b-refunded {background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd}

/* buttons */
.btn-row{text-align:center;margin:26px 0 10px}
.btn{display:inline-block;padding:14px 30px;border-radius:14px;font-weight:700;
     font-size:14px;letter-spacing:.01em;margin:4px 5px;line-height:1;
     border:2px solid transparent}
.btn-g{background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:#fff!important;
       box-shadow:0 6px 20px rgba(5,150,105,.35)}
.btn-o{background:#f0fdf4;color:#059669!important;border-color:#a7f3d0}
.btn-w{background:#fff;color:#059669!important;border-color:rgba(255,255,255,.4)}
.btn-r{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff!important;
       box-shadow:0 6px 20px rgba(220,38,38,.3)}

/* divider */
.div{height:1px;background:linear-gradient(90deg,transparent,#d1fae5 40%,#a7f3d0 50%,#d1fae5 60%,transparent);
     margin:24px 0}

/* alert boxes */
.warn{background:#fffbeb;border-radius:12px;padding:14px 18px;
      border:1px solid #fde68a;margin:14px 0}
.warn p{font-size:13px;color:#92400e;margin:0;line-height:1.6}
.info-box{background:#eff6ff;border-radius:12px;padding:14px 18px;
          border:1px solid #bfdbfe;margin:14px 0}
.info-box p{font-size:13px;color:#1e40af;margin:0;line-height:1.6}
.success-alert{background:linear-gradient(135deg,#ecfdf5,#d1fae5);
               border-radius:12px;padding:16px 20px;border:1px solid #6ee7b7;
               margin:14px 0;text-align:center}

/* stat pills */
.stats{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
.stat{flex:1;min-width:90px;text-align:center;padding:14px 10px;
      background:#f0fdf4;border-radius:12px;border:1px solid #a7f3d0}
.stat-num{font-size:18px;font-weight:900;color:#022c22;line-height:1}
.stat-lbl{font-size:10px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.06em}

/* countdown */
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

/* tips list */
.tips{background:#fff;border-radius:12px;padding:18px 20px;
      border:1px solid #d1fae5;margin:16px 0}
.tips li{font-size:13px;color:#374151;padding:6px 0;line-height:1.55;
         border-bottom:1px dashed #e2e8f0;list-style:none;
         display:flex;align-items:flex-start;gap:8px}
.tips li:last-child{border:none;padding-bottom:0}
.tip-dot{width:7px;height:7px;border-radius:50%;background:#10b981;
         flex-shrink:0;margin-top:5px}

/* footer */
.ftr{padding:22px 28px;text-align:center;background:#f8fafc;
     border-top:1px solid #e2e8f0}
.ftr p{font-size:11.5px;color:#94a3b8;line-height:1.8;margin-bottom:2px}
.ftr a{color:#059669;font-weight:600}

/* steps */
.steps{counter-reset:step;margin:18px 0}
.step{display:flex;align-items:flex-start;gap:12px;padding:10px 0;
      border-bottom:1px dashed #e2e8f0;font-size:13px;color:#374151}
.step:last-child{border:none}
.step-n{width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#10b981,#059669);
        color:#fff;font-weight:800;font-size:11px;display:flex;align-items:center;
        justify-content:center;flex-shrink:0;margin-top:1px}

/* highlights bar */
.hlt-bar{background:linear-gradient(135deg,#ecfdf5,#d1fae5);
         border-radius:14px;padding:20px 22px;border:1px solid #6ee7b7;
         text-align:center;margin:20px 0}
.hlt-icon{font-size:36px;margin-bottom:8px}
.hlt-ttl{font-size:17px;font-weight:800;color:#065f46;margin-bottom:4px}
.hlt-sub{font-size:13px;color:#047857}

/* ref code */
.ref-code{font-family:'Courier New',Courier,monospace;font-size:22px;
          font-weight:900;color:#059669;letter-spacing:.12em;
          background:#f0fdf4;border:2px dashed #6ee7b7;border-radius:12px;
          padding:12px 20px;display:inline-block;margin:10px 0}

/* mobile */
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

/* ══════════════════════════════════════════════════════════════════════════════
   BASE HTML SHELL
══════════════════════════════════════════════════════════════════════════════ */
function shell({ title, preheader = "", body, footer = "", extraCss = "" }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<title>${esc(title)}</title>
<style>${GLOBAL_CSS}${extraCss}</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f0fdf4;mso-hide:all">
  ${esc(preheader)}&nbsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;
</div>
<div class="outer">
<div class="w"><div class="card">

  <!-- HEADER -->
  <div class="hdr">
    <div class="hdr-glow"></div>
    <div class="brand">Authentic African Experiences</div>
    <div class="logo-txt">🌍 <em>Altuvera</em> Travel</div>
    <div class="tagline">Where Africa's Soul Meets World-Class Adventure</div>
  </div>

  <!-- BODY -->
  <div class="body-pad">${body}</div>

  <!-- FOOTER -->
  <div class="ftr">
    ${footer ? `<p style="margin-bottom:10px;color:#64748b;font-size:12px">${footer}</p>` : ""}
    <p>
      <a href="${CFG.appUrl}">Website</a> &nbsp;·&nbsp;
      <a href="${CFG.appUrl}/destinations">Destinations</a> &nbsp;·&nbsp;
      <a href="mailto:${CFG.supportEmail}">Support</a> &nbsp;·&nbsp;
      <a href="https://wa.me/250785751391">WhatsApp</a>
    </p>
    <p style="margin-top:8px">© ${new Date().getFullYear()} Altuvera Travel · All rights reserved</p>
    <p style="margin-top:4px">
      <a href="${CFG.appUrl}" style="color:#cbd5e1;font-weight:400">
        www.altuverasafaris.com
      </a>
    </p>
  </div>

</div></div>
</div>
</body></html>`;
}

/* ══════════════════════════════════════════════════════════════════════════════
   1.  sendBookingVerificationLink
══════════════════════════════════════════════════════════════════════════════ */
async function sendBookingVerificationLink(booking, verificationToken) {
  const {
    email,
    full_name        = "Explorer",
    booking_number   = "N/A",
    destination_name = booking.service_name || booking.package_name || "Your Trip",
    country_name,
    travel_date,
    number_of_travelers = 1,
  } = booking;

  if (!email) {
    console.warn("[Email] sendBookingVerificationLink: no email");
    return { success: false, reason: "no_email" };
  }

  const verifyUrl = `${CFG.backendUrl}/api/bookings/verify-email/${verificationToken}`;

  const extraCss = `
    .verify-hero{background:linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%);
                 border-radius:16px;padding:26px 22px;text-align:center;margin:0 0 22px;
                 border:1px solid #6ee7b7}
    .verify-icon{font-size:52px;margin-bottom:10px}
    .verify-ttl{font-size:20px;font-weight:800;color:#022c22;margin-bottom:4px}
    .verify-sub{font-size:13px;color:#047857;line-height:1.5}
    .timer-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;
                background:#fff;border-radius:999px;border:1px solid #fde68a;
                font-size:12px;color:#92400e;font-weight:700;margin-top:14px}
    .url-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;
             padding:12px 16px;margin:16px 0;word-break:break-all;
             font-size:11.5px;color:#64748b;font-family:'Courier New',monospace;line-height:1.5}
  `;

  const html = shell({
    title:     "Confirm Your Booking Request — Altuvera Travel",
    preheader: `One click to secure your ${destination_name} adventure. Link expires in 24 hours.`,
    extraCss,
    body: `
      <!-- Hero -->
      <div class="verify-hero">
        <div class="verify-icon">✉️</div>
        <div class="verify-ttl">Verify Your Email Address</div>
        <div class="verify-sub">
          Almost there, <strong>${esc(full_name)}</strong>!<br/>
          Click the button below to confirm your booking request and
          send it to our safari team.
        </div>
        <div class="timer-pill">
          ⏱&nbsp; This link expires in <strong>&nbsp;24 hours</strong>
        </div>
      </div>

      <!-- Booking snapshot -->
      <div class="box">
        <div class="box-title">📋 Your Booking Snapshot</div>
        <div class="row">
          <span class="lbl">Booking Ref</span>
          <span class="val" style="font-family:'Courier New',monospace;color:#059669;font-size:14px">
            ${esc(String(booking_number))}
          </span>
        </div>
        <div class="row">
          <span class="lbl">Destination</span>
          <span class="val">🌍 ${esc(destination_name)}${country_name ? `, ${esc(country_name)}` : ""}</span>
        </div>
        ${travel_date ? `
        <div class="row">
          <span class="lbl">Travel Date</span>
          <span class="val">📅 ${fmtDate(travel_date)}</span>
        </div>` : ""}
        <div class="row">
          <span class="lbl">Travelers</span>
          <span class="val">👥 ${esc(String(number_of_travelers))} ${Number(number_of_travelers) === 1 ? "person" : "people"}</span>
        </div>
        <div class="row">
          <span class="lbl">Status</span>
          <span class="val"><span class="bd b-pending">⏳ Awaiting Verification</span></span>
        </div>
      </div>

      <!-- CTA -->
      <div class="btn-row" style="margin:28px 0">
        <a href="${verifyUrl}" class="btn btn-g" style="font-size:15px;padding:17px 40px;border-radius:16px">
          ✅&nbsp; Confirm My Booking Request
        </a>
      </div>

      <div class="warn">
        <p>
          🔒 <strong>Didn't make this booking?</strong>
          Simply ignore this email — your information is safe and no booking will be created.
        </p>
      </div>

      <div class="div"></div>

      <!-- Fallback URL -->
      <p style="font-size:12.5px;color:#64748b;text-align:center;margin-bottom:8px">
        Button not working? Copy and paste this link into your browser:
      </p>
      <div class="url-box">${esc(verifyUrl)}</div>

      <div class="div"></div>

      <!-- Support -->
      <div style="text-align:center">
        <p style="font-size:13px;color:#64748b;margin-bottom:14px">
          Have questions? Our safari team is ready to help:
        </p>
        <a href="https://wa.me/250785751391" class="btn btn-o">💬 WhatsApp Us</a>
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">✉️ Email Support</a>
      </div>`,

    footer: "This verification link is valid for 24 hours from the time your booking was submitted.",
  });

  return sendEmail({
    to:      email,
    subject: `✅ Please verify your booking: ${destination_name} — Altuvera Travel`,
    html,
    text: [
      `Hi ${full_name},`,
      ``,
      `Please verify your booking request by visiting:`,
      verifyUrl,
      ``,
      `Booking Ref: ${booking_number}`,
      `Destination: ${destination_name}${country_name ? `, ${country_name}` : ""}`,
      travel_date ? `Travel Date: ${fmtDate(travel_date)}` : "",
      `Travelers: ${number_of_travelers}`,
      ``,
      `This link expires in 24 hours.`,
      ``,
      `— Altuvera Travel`,
    ].filter(Boolean).join("\n"),
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   2.  sendAdminBookingNotification
══════════════════════════════════════════════════════════════════════════════ */
async function sendAdminBookingNotification(booking) {
  const adminEmail = CFG.adminEmail;
  if (!adminEmail) {
    console.warn("[Email] sendAdminBookingNotification: ADMIN_EMAIL not set");
    return { success: false, reason: "no_admin_email" };
  }

  const {
    booking_number      = booking.id || "N/A",
    full_name           = "Unknown",
    email               = "—",
    phone               = "—",
    whatsapp,
    nationality,
    country,
    booking_type        = "custom",
    destination_name,
    service_name,
    package_name,
    travel_date,
    return_date,
    flexible_dates,
    number_of_travelers = 1,
    number_of_adults,
    number_of_children,
    accommodation_type,
    dietary_requirements,
    special_requests,
    source              = "website",
    status              = "pending",
    created_at,
  } = booking;

  const trip = destination_name || service_name || package_name || "Custom Request";
  const wa   = whatsapp ? whatsapp.replace(/\D/g, "") : null;

  const extraCss = `
    .admin-alert{background:linear-gradient(135deg,#022c22,#064e3b);
                 border-radius:16px;padding:20px 22px;margin:0 0 22px;
                 display:flex;align-items:center;gap:14px}
    .alert-icon{font-size:36px;flex-shrink:0}
    .alert-content{}
    .alert-ttl{font-size:17px;font-weight:800;color:#34d399;margin-bottom:3px}
    .alert-sub{font-size:12.5px;color:rgba(255,255,255,.6);line-height:1.4}
    .quick-action{background:#f0fdf4;border-radius:14px;padding:16px 18px;
                  border:1px solid #a7f3d0;margin-top:20px}
    .qa-ttl{font-size:10px;font-weight:800;color:#065f46;
            text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px}
  `;

  const html = shell({
    title:     `🔔 New Verified Booking: ${booking_number}`,
    preheader: `Email verified! New booking from ${full_name} for ${trip}. Action required.`,
    extraCss,
    body: `
      <!-- Alert banner -->
      <div class="admin-alert">
        <div class="alert-icon">🔔</div>
        <div class="alert-content">
          <div class="alert-ttl">New Verified Booking</div>
          <div class="alert-sub">
            Customer email verified · Awaiting your review &amp; approval
          </div>
        </div>
      </div>

      <!-- Stats row -->
      <div class="stats">
        <div class="stat">
          <div class="stat-num">#${esc(String(booking_number))}</div>
          <div class="stat-lbl">Booking Ref</div>
        </div>
        <div class="stat">
          <div class="stat-num">${esc(String(number_of_travelers))}</div>
          <div class="stat-lbl">Traveler${Number(number_of_travelers) !== 1 ? "s" : ""}</div>
        </div>
        <div class="stat">
          <div class="stat-num">${esc(source)}</div>
          <div class="stat-lbl">Source</div>
        </div>
        <div class="stat">
          <div class="stat-num">${esc(booking_type)}</div>
          <div class="stat-lbl">Type</div>
        </div>
      </div>

      <!-- Customer details -->
      <div class="box">
        <div class="box-title">👤 Customer Details</div>
        <div class="row">
          <span class="lbl">Full Name</span>
          <span class="val">${esc(full_name)}</span>
        </div>
        <div class="row">
          <span class="lbl">Email</span>
          <span class="val">
            <a href="mailto:${esc(email)}" style="color:#059669">${esc(email)}</a>
          </span>
        </div>
        <div class="row">
          <span class="lbl">Phone</span>
          <span class="val">${esc(String(phone))}</span>
        </div>
        ${wa ? `
        <div class="row">
          <span class="lbl">WhatsApp</span>
          <span class="val">
            <a href="https://wa.me/${wa}" style="color:#25d366;font-weight:700">
              💬 ${esc(whatsapp)}
            </a>
          </span>
        </div>` : ""}
        ${nationality ? `<div class="row"><span class="lbl">Nationality</span><span class="val">🌐 ${esc(nationality)}</span></div>` : ""}
        ${country     ? `<div class="row"><span class="lbl">From Country</span><span class="val">${esc(country)}</span></div>` : ""}
      </div>

      <!-- Trip details -->
      <div class="box">
        <div class="box-title">🗺️ Trip Details</div>
        <div class="row">
          <span class="lbl">Destination</span>
          <span class="val">🌍 ${esc(trip)}</span>
        </div>
        <div class="row">
          <span class="lbl">Booking Type</span>
          <span class="val">${esc(booking_type)}</span>
        </div>
        ${travel_date ? `<div class="row"><span class="lbl">Departure</span><span class="val">📅 ${fmtDate(travel_date)}</span></div>` : ""}
        ${return_date ? `<div class="row"><span class="lbl">Return</span><span class="val">📅 ${fmtDate(return_date)}</span></div>` : ""}
        ${flexible_dates ? `
        <div class="row">
          <span class="lbl">Flexible Dates</span>
          <span class="val" style="color:#059669">✓ Yes — flexible</span>
        </div>` : ""}
        <div class="row">
          <span class="lbl">Travelers</span>
          <span class="val">
            👥 ${esc(String(number_of_travelers))} total
            ${number_of_adults
              ? ` (${number_of_adults} adult${number_of_adults != 1 ? "s" : ""}${number_of_children ? `, ${number_of_children} child${number_of_children != 1 ? "ren" : ""}` : ""})`
              : ""}
          </span>
        </div>
        ${accommodation_type   ? `<div class="row"><span class="lbl">Accommodation</span><span class="val">${esc(accommodation_type)}</span></div>` : ""}
        ${dietary_requirements ? `<div class="row"><span class="lbl">Dietary Needs</span><span class="val">${esc(dietary_requirements)}</span></div>` : ""}
        <div class="row">
          <span class="lbl">Status</span>
          <span class="val"><span class="bd b-pending">⏳ ${esc(status)}</span></span>
        </div>
        <div class="row">
          <span class="lbl">Submitted</span>
          <span class="val">${fmtDateTime(created_at || new Date())}</span>
        </div>
      </div>

      ${special_requests ? `
      <div class="box" style="background:#fffbeb;border-color:#fde68a">
        <div class="box-title" style="color:#92400e">💬 Special Requests from Customer</div>
        <p style="font-size:13.5px;color:#78350f;margin:0;white-space:pre-wrap;line-height:1.65">
          ${esc(special_requests)}
        </p>
      </div>` : ""}

      <!-- Action buttons -->
      <div class="quick-action">
        <div class="qa-ttl">⚡ Quick Actions</div>
        <div class="btn-row" style="margin:0">
          <a href="${CFG.appUrl}/admin/bookings" class="btn btn-g">Open Admin Panel →</a>
          <a href="mailto:${esc(email)}?subject=Re: Your Booking ${esc(String(booking_number))}" class="btn btn-o">✉️ Reply to Customer</a>
          ${wa ? `<a href="https://wa.me/${wa}" class="btn btn-o" style="background:#f0fff4;border-color:#86efac;color:#166534!important">💬 WhatsApp</a>` : ""}
        </div>
      </div>`,
  });

  return sendEmail({
    to:      adminEmail,
    replyTo: email,
    subject: `🔔 New Verified Booking #${booking_number} — ${full_name} → ${trip}`,
    html,
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   3.  sendBookingConfirmation  — Full confetti celebration card
══════════════════════════════════════════════════════════════════════════════ */
async function sendBookingConfirmation(booking) {
  const {
    email,
    full_name           = "Valued Guest",
    booking_number      = booking.id || "N/A",
    destination_name,
    service_name,
    package_name,
    country_name,
    travel_date,
    return_date,
    number_of_travelers = 1,
    accommodation_type,
    special_requests,
    confirmation_code,
  } = booking;

  if (!email) return { success: false, reason: "no_email" };

  const trip      = destination_name || service_name || package_name || "Your Trip";
  const tDate     = travel_date ? new Date(travel_date) : null;
  const countdown = tDate ? humanCountdown(tDate) : null;

  /* Destination image — use a gorgeous Unsplash safari photo */
  const heroImg = "https://images.unsplash.com/photo-1516426122078-c23e76319801?w=1200&q=85&auto=format&fit=crop";

  const extraCss = `
    /* ── confetti keyframes ─────────────────────────────────────────────── */
    @keyframes fall1{0%{transform:translateY(-20px) rotate(0deg);opacity:1}
                     100%{transform:translateY(520px) rotate(720deg);opacity:0}}
    @keyframes fall2{0%{transform:translateY(-20px) rotate(0deg);opacity:1}
                     100%{transform:translateY(520px) rotate(-540deg);opacity:0}}
    @keyframes fall3{0%{transform:translateY(-20px) rotate(0deg);opacity:1}
                     100%{transform:translateY(520px) rotate(360deg);opacity:0}}
    @keyframes sway {0%,100%{margin-left:0}50%{margin-left:30px}}

    .confetti-wrap{position:relative;overflow:hidden;height:0}
    .confetti-piece{position:absolute;top:0;width:10px;height:10px;
                    border-radius:2px;opacity:0;animation-fill-mode:both}

    /* hero */
    .hero-img-wrap{position:relative;border-radius:16px;overflow:hidden;margin:0 0 24px;height:220px}
    .hero-img{width:100%;height:220px;object-fit:cover;display:block}
    .hero-overlay{position:absolute;inset:0;
                  background:linear-gradient(to bottom,rgba(2,44,34,.1) 0%,rgba(2,44,34,.72) 100%);
                  display:flex;flex-direction:column;align-items:center;
                  justify-content:flex-end;padding:22px;text-align:center}
    .hero-badge{display:inline-flex;align-items:center;gap:6px;
                background:rgba(52,211,153,.2);border:1px solid rgba(52,211,153,.5);
                border-radius:999px;padding:5px 14px;font-size:11px;
                color:#6ee7b7;font-weight:700;letter-spacing:.06em;margin-bottom:10px}
    .hero-title{font-size:22px;font-weight:900;color:#fff;
                text-shadow:0 2px 8px rgba(0,0,0,.4);line-height:1.2;margin-bottom:4px}
    .hero-sub{font-size:13px;color:rgba(255,255,255,.75)}

    /* celebration strip */
    .celebration{background:linear-gradient(135deg,#022c22,#047857);
                 border-radius:18px;padding:28px 22px;margin:0 0 24px;
                 text-align:center;position:relative;overflow:hidden}
    .cel-glow{position:absolute;top:50%;left:50%;
              transform:translate(-50%,-50%);width:280px;height:280px;
              border-radius:50%;
              background:radial-gradient(circle,rgba(52,211,153,.2) 0%,transparent 70%)}
    .cel-emoji{font-size:52px;margin-bottom:12px;position:relative;
               animation:bounce 1s ease infinite alternate}
    @keyframes bounce{from{transform:translateY(0)}to{transform:translateY(-8px)}}
    .cel-h{font-size:22px;font-weight:900;color:#fff;margin-bottom:6px;
           position:relative;letter-spacing:-.01em}
    .cel-h em{color:#34d399;font-style:normal}
    .cel-p{font-size:13.5px;color:rgba(255,255,255,.7);line-height:1.6;
           position:relative;max-width:360px;margin:0 auto}
    .cel-ref{display:inline-block;margin-top:16px;padding:10px 20px;
             background:rgba(255,255,255,.1);border-radius:12px;
             border:1px solid rgba(52,211,153,.35);position:relative}
    .cel-ref-lbl{font-size:10px;color:rgba(255,255,255,.5);
                 text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px}
    .cel-ref-val{font-family:'Courier New',monospace;font-size:18px;
                 font-weight:900;color:#34d399;letter-spacing:.12em}

    /* next steps */
    .next-steps{background:linear-gradient(135deg,#ecfdf5,#d1fae5);
                border-radius:14px;padding:20px 22px;border:1px solid #6ee7b7;margin:20px 0}
    .ns-ttl{font-size:11px;font-weight:800;color:#065f46;
            text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px}
    .ns-item{display:flex;align-items:flex-start;gap:12px;
             padding:9px 0;border-bottom:1px dashed rgba(167,243,208,.5);
             font-size:13px;color:#065f46;line-height:1.5}
    .ns-item:last-child{border:none;padding-bottom:0}
    .ns-n{width:26px;height:26px;border-radius:50%;
          background:linear-gradient(135deg,#10b981,#059669);
          color:#fff;font-size:11px;font-weight:800;
          display:flex;align-items:center;justify-content:center;flex-shrink:0}
  `;

  /* ── Build confetti pieces (inline — email-safe via absolute positioning) ── */
  const confettiColors = ["#34d399","#10b981","#059669","#fbbf24","#f59e0b","#6ee7b7","#fff","#a7f3d0","#fde68a"];
  const confettiPieces = Array.from({ length: 22 }, (_, i) => {
    const color = confettiColors[i % confettiColors.length];
    const left  = Math.floor(Math.random() * 90) + 5;
    const delay = (Math.random() * 1.8).toFixed(2);
    const dur   = (1.8 + Math.random() * 1.5).toFixed(2);
    const anim  = `fall${(i % 3) + 1}`;
    const size  = 6 + Math.floor(Math.random() * 8);
    const shape = i % 4 === 0 ? "50%" : "2px";
    return `<div class="confetti-piece" style="
      left:${left}%;width:${size}px;height:${size}px;
      background:${color};border-radius:${shape};
      animation:${anim} ${dur}s ${delay}s ease-in both, sway ${dur}s ${delay}s ease-in-out both
    "></div>`;
  }).join("");

  const html = shell({
    title:     `🎉 Booking Confirmed — Your ${trip} Adventure Awaits!`,
    preheader: `Congratulations ${full_name}! Your booking is confirmed. ${countdown ? `Your trip is ${countdown}.` : "Get ready for Africa!"}`,
    extraCss,
    body: `
      <!-- ░░ CONFETTI LAYER ░░ -->
      <div class="confetti-wrap" style="height:1px;position:relative">
        ${confettiPieces}
      </div>

      <!-- ░░ CELEBRATION STRIP ░░ -->
      <div class="celebration">
        <div class="cel-glow"></div>
        <div class="cel-emoji">🎉</div>
        <div class="cel-h">Booking <em>Confirmed!</em></div>
        <p class="cel-p">
          Congratulations, <strong style="color:#fff">${esc(full_name)}</strong>!
          Your African safari adventure is officially booked and confirmed.
          Africa is ready to take your breath away. 🦁
        </p>
        <div class="cel-ref">
          <div class="cel-ref-lbl">Your Booking Reference</div>
          <div class="cel-ref-val">${esc(String(booking_number))}</div>
        </div>
      </div>

      <!-- ░░ HERO IMAGE ░░ -->
      <div class="hero-img-wrap">
        <img src="${heroImg}" alt="${esc(trip)}" class="hero-img" width="560"/>
        <div class="hero-overlay">
          <div class="hero-badge">✅ Confirmed Adventure</div>
          <div class="hero-title">🌍 ${esc(trip)}</div>
          <div class="hero-sub">
            ${country_name ? `${esc(country_name)} · ` : ""}
            ${tDate ? fmtDate(travel_date) : "Date TBC"}
          </div>
        </div>
      </div>

      <!-- ░░ COUNTDOWN ░░ -->
      ${countdown && tDate ? `
      <div class="cd">
        <div class="cd-glow"></div>
        <div class="cd-val">${esc(countdown)}</div>
        <div class="cd-unit">until your adventure begins</div>
        <div class="cd-dest">✈️ ${esc(trip)}</div>
        <div class="cd-date">
          Departing ${fmtDate(travel_date)}${return_date ? ` · Returning ${fmtDate(return_date)}` : ""}
        </div>
      </div>` : ""}

      <!-- ░░ BOOKING DETAILS ░░ -->
      <div class="box">
        <div class="box-title">📋 Confirmed Booking Details</div>
        <div class="row">
          <span class="lbl">Booking Ref</span>
          <span class="val" style="font-family:'Courier New',monospace;color:#059669;font-size:15px">
            ${esc(String(booking_number))}
          </span>
        </div>
        <div class="row">
          <span class="lbl">Status</span>
          <span class="val"><span class="bd b-confirmed">✓ Confirmed</span></span>
        </div>
        <div class="row">
          <span class="lbl">Destination</span>
          <span class="val">🌍 ${esc(trip)}${country_name ? `, ${esc(country_name)}` : ""}</span>
        </div>
        ${travel_date ? `<div class="row"><span class="lbl">Departure</span><span class="val">📅 ${fmtDate(travel_date)}</span></div>` : ""}
        ${return_date ? `<div class="row"><span class="lbl">Return</span><span class="val">📅 ${fmtDate(return_date)}</span></div>` : ""}
        ${accommodation_type ? `<div class="row"><span class="lbl">Accommodation</span><span class="val">🏕️ ${esc(accommodation_type)}</span></div>` : ""}
        <div class="row">
          <span class="lbl">Travelers</span>
          <span class="val">👥 ${esc(String(number_of_travelers))} ${Number(number_of_travelers) === 1 ? "person" : "people"}</span>
        </div>
        ${confirmation_code ? `
        <div class="row">
          <span class="lbl">Confirmation Code</span>
          <span class="val" style="font-family:'Courier New',monospace;color:#059669;font-weight:800">
            ${esc(confirmation_code)}
          </span>
        </div>` : ""}
      </div>

      ${special_requests ? `
      <div class="box" style="background:#fffbeb;border-color:#fde68a">
        <div class="box-title" style="color:#92400e">💬 Your Special Requests — Confirmed & Noted</div>
        <p style="font-size:13px;color:#78350f;margin:0;line-height:1.65">${esc(special_requests)}</p>
      </div>` : ""}

      <!-- ░░ NEXT STEPS ░░ -->
      <div class="next-steps">
        <div class="ns-ttl">🗓️ What Happens Next?</div>
        ${[
          ["Your dedicated safari coordinator will contact you within 24 hours", "1"],
          ["You'll receive a detailed, personalised day-by-day itinerary", "2"],
          ["Pre-departure briefing with packing tips and local insights", "3"],
          ["Daily countdown reminders sent as your departure approaches", "4"],
          ["Arrive, explore, and create memories that last a lifetime 🦁", "5"],
        ].map(([text, n]) => `
        <div class="ns-item">
          <div class="ns-n">${n}</div>
          <div>${text}</div>
        </div>`).join("")}
      </div>

      <!-- ░░ CTA BUTTONS ░░ -->
      <div class="btn-row">
        <a href="${CFG.appUrl}/my-bookings" class="btn btn-g" style="font-size:14px;padding:15px 32px">
          🌿 View My Booking
        </a>
        <a href="${CFG.appUrl}/destinations" class="btn btn-o">Explore More</a>
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">Contact Us</a>
      </div>

      <div class="div"></div>

      <!-- Social proof / warm close -->
      <div style="text-align:center;padding:10px 0">
        <p style="font-size:14px;color:#047857;font-weight:700;margin-bottom:6px">
          Welcome to the Altuvera family! 🌍
        </p>
        <p style="font-size:13px;color:#64748b;line-height:1.6">
          We've helped thousands of travellers discover the magic of Africa.
          Your adventure is in the best hands. Can't wait to see you there!
        </p>
      </div>`,

    footer: "Save your booking reference <strong>" + esc(String(booking_number)) + "</strong> — you'll need it for any enquiries.",
  });

  return sendEmail({
    to:      email,
    subject: `🎉 Confirmed: Your ${trip} Safari Adventure | Altuvera Travel`,
    html,
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   4.  sendBookingStatusUpdate
══════════════════════════════════════════════════════════════════════════════ */
async function sendBookingStatusUpdate(booking, oldStatus, newStatus, reason) {
  const {
    email,
    full_name      = "Valued Guest",
    booking_number = booking.id || "N/A",
    destination_name = booking.service_name || booking.package_name || "Your Trip",
    travel_date,
  } = booking;

  if (!email) return { success: false, reason: "no_email" };

  const labels = {
    pending:   "⏳ Pending",
    confirmed: "✅ Confirmed",
    "on-hold": "⏸ On Hold",
    completed: "🏁 Completed",
    cancelled: "❌ Cancelled",
    refunded:  "💳 Refunded",
  };

  const messages = {
    pending:   "Your booking is back under review. Our team will be in touch shortly with next steps.",
    confirmed: "Wonderful news! Your booking has been confirmed. Africa is waiting for you — start packing! 🦁",
    "on-hold": "Your booking has been placed on hold. Our team will contact you within 24 hours with details.",
    completed: "Your safari is complete! We hope every moment was magical. We'd love to see you again. 🌟",
    refunded:  "Your refund has been processed. Please allow 5–10 business days to appear in your account.",
  };

  const icons = {
    pending:   "⏳", confirmed: "✅", "on-hold": "⏸",
    completed: "🏁", cancelled: "❌", refunded: "💳",
  };

  const extraCss = `
    .status-hero{border-radius:16px;padding:26px 22px;text-align:center;
                 margin:0 0 22px;border:1px solid #e2e8f0}
    .status-arrow{display:flex;align-items:center;justify-content:center;
                  gap:12px;flex-wrap:wrap;margin:12px 0}
    .s-chip{display:inline-flex;align-items:center;gap:5px;padding:6px 14px;
            border-radius:999px;font-size:12.5px;font-weight:700;border:1px solid}
    .arrow-icon{font-size:20px;color:#94a3b8}
  `;

  const html = shell({
    title:     `Booking Update: ${booking_number} is now ${newStatus}`,
    preheader: `Your Altuvera Travel booking ${booking_number} status has changed to ${newStatus}.`,
    extraCss,
    body: `
      <div class="status-hero"
           style="background:${newStatus === "confirmed" ? "linear-gradient(135deg,#ecfdf5,#d1fae5)" :
                               newStatus === "on-hold"   ? "linear-gradient(135deg,#fdf4ff,#fce7f3)" :
                               newStatus === "completed" ? "linear-gradient(135deg,#eff6ff,#dbeafe)" :
                               "linear-gradient(135deg,#f8fafc,#f1f5f9)"};
                border-color:${newStatus === "confirmed" ? "#6ee7b7" : newStatus === "on-hold" ? "#f9a8d4" : "#e2e8f0"}">
        <div style="font-size:44px;margin-bottom:10px">${icons[newStatus] || "🔄"}</div>
        <h2 style="font-size:20px;font-weight:800;color:#022c22;margin-bottom:6px">
          Booking Status Updated
        </h2>
        <p style="font-size:13.5px;color:#475569;line-height:1.6;margin-bottom:14px">
          Hi <strong>${esc(full_name)}</strong>, here's what changed on your booking.
        </p>
        <div class="status-arrow">
          <span class="s-chip ${badgeCls(oldStatus)}">${esc(labels[oldStatus] || oldStatus)}</span>
          <span class="arrow-icon">→</span>
          <span class="s-chip ${badgeCls(newStatus)}">${esc(labels[newStatus] || newStatus)}</span>
        </div>
      </div>

      <div class="box">
        <div class="box-title">📋 Booking Details</div>
        <div class="row">
          <span class="lbl">Booking #</span>
          <span class="val" style="font-family:'Courier New',monospace;color:#059669">${esc(String(booking_number))}</span>
        </div>
        <div class="row">
          <span class="lbl">Destination</span>
          <span class="val">🌍 ${esc(destination_name)}</span>
        </div>
        ${travel_date ? `<div class="row"><span class="lbl">Travel Date</span><span class="val">📅 ${fmtDate(travel_date)}</span></div>` : ""}
        <div class="row">
          <span class="lbl">Previous Status</span>
          <span class="val"><span class="bd ${badgeCls(oldStatus)}">${esc(labels[oldStatus] || oldStatus)}</span></span>
        </div>
        <div class="row">
          <span class="lbl">New Status</span>
          <span class="val"><span class="bd ${badgeCls(newStatus)}">${esc(labels[newStatus] || newStatus)}</span></span>
        </div>
      </div>

      <div class="info-box">
        <p>ℹ️&nbsp; ${esc(messages[newStatus] || "Your booking details have been updated by our team.")}</p>
      </div>

      ${reason ? `
      <div class="warn">
        <p>📝 <strong>Note from our team:</strong><br/>${esc(reason)}</p>
      </div>` : ""}

      <div class="btn-row">
        <a href="${CFG.appUrl}/my-bookings" class="btn btn-g">View My Booking</a>
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">Get Help</a>
        <a href="https://wa.me/250785751391" class="btn btn-o">💬 WhatsApp</a>
      </div>`,
  });

  return sendEmail({
    to:      email,
    subject: `🔄 Booking Update: ${booking_number} is now "${newStatus}" | Altuvera Travel`,
    html,
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   5.  sendBookingCancellation
══════════════════════════════════════════════════════════════════════════════ */
async function sendBookingCancellation(booking, reason) {
  const {
    email,
    full_name      = "Valued Guest",
    booking_number = booking.id || "N/A",
    destination_name = booking.service_name || booking.package_name || "Your Trip",
    country_name,
    travel_date,
  } = booking;

  if (!email) return { success: false, reason: "no_email" };

  const extraCss = `
    .cancel-hero{background:linear-gradient(135deg,#fff1f2,#fee2e2);
                 border-radius:16px;padding:26px 22px;text-align:center;
                 border:1px solid #fca5a5;margin:0 0 22px}
    .rebooking{background:linear-gradient(135deg,#ecfdf5,#d1fae5);
               border-radius:14px;padding:18px 20px;border:1px solid #6ee7b7;
               text-align:center;margin:20px 0}
    .rb-ttl{font-size:14px;font-weight:700;color:#065f46;margin-bottom:6px}
    .rb-sub{font-size:13px;color:#047857;margin-bottom:14px;line-height:1.5}
  `;

  const html = shell({
    title:     `Booking Cancelled — ${booking_number}`,
    preheader: `Your Altuvera Travel booking ${booking_number} has been cancelled. We hope to see you again soon.`,
    extraCss,
    body: `
      <div class="cancel-hero">
        <div style="font-size:44px;margin-bottom:12px">💔</div>
        <h2 style="font-size:20px;font-weight:800;color:#991b1b;margin-bottom:8px">
          Booking Cancelled
        </h2>
        <p style="font-size:13.5px;color:#7f1d1d;line-height:1.6">
          Hi <strong>${esc(full_name)}</strong>, we're sorry to inform you that
          your booking has been cancelled. We hope to welcome you on a future adventure!
        </p>
      </div>

      <div class="box" style="background:#fff1f2;border-color:#fca5a5">
        <div class="box-title" style="color:#991b1b">📋 Cancelled Booking</div>
        <div class="row">
          <span class="lbl">Booking #</span>
          <span class="val" style="font-family:'Courier New',monospace">${esc(String(booking_number))}</span>
        </div>
        <div class="row">
          <span class="lbl">Status</span>
          <span class="val"><span class="bd b-cancelled">✗ Cancelled</span></span>
        </div>
        <div class="row">
          <span class="lbl">Destination</span>
          <span class="val">${esc(destination_name)}${country_name ? `, ${esc(country_name)}` : ""}</span>
        </div>
        ${travel_date ? `<div class="row"><span class="lbl">Was Planned For</span><span class="val">📅 ${fmtDate(travel_date)}</span></div>` : ""}
        ${reason ? `<div class="row"><span class="lbl">Reason</span><span class="val">${esc(reason)}</span></div>` : ""}
      </div>

      <div class="info-box">
        <p>
          💳 <strong>Refund Policy:</strong> If a payment was made,
          your refund will be processed within <strong>5–10 business days</strong>.
          Contact us if you have any questions.
        </p>
      </div>

      <div class="div"></div>

      <!-- Encourage rebooking -->
      <div class="rebooking">
        <div class="rb-ttl">🌍 Africa Will Always Be Here For You</div>
        <div class="rb-sub">
          Whenever you're ready, we'd love to plan your next unforgettable adventure.
          Browse our destinations and find your perfect safari.
        </div>
        <a href="${CFG.appUrl}/destinations" class="btn btn-g">Browse Destinations</a>
      </div>

      <div class="btn-row" style="margin-top:16px">
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">✉️ Contact Us</a>
        <a href="https://wa.me/250785751391" class="btn btn-o">💬 WhatsApp</a>
      </div>`,
  });

  return sendEmail({
    to:      email,
    subject: `❌ Booking Cancelled: ${booking_number} | Altuvera Travel`,
    html,
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   6.  sendTripCountdownEmail
══════════════════════════════════════════════════════════════════════════════ */
async function sendTripCountdownEmail(booking) {
  const {
    email,
    full_name           = "Explorer",
    booking_number      = booking.id || "N/A",
    destination_name,
    service_name,
    package_name,
    country_name,
    travel_date,
    number_of_travelers = 1,
  } = booking;

  if (!email || !travel_date) return { success: false, reason: "no_email_or_date" };

  const trip     = destination_name || service_name || package_name || "Your Trip";
  const tDate    = new Date(travel_date);
  const now      = new Date();
  now.setHours(0, 0, 0, 0);
  tDate.setHours(0, 0, 0, 0);
  const diffDays = Math.round((tDate - now) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { success: false, reason: "trip_in_past" };

  const countdown = humanCountdown(tDate);

  let headline, emoji, subline, tips = [], urgency = "low";

  if (diffDays === 0) {
    headline = "Today Is The Day!";
    emoji    = "🎉";
    urgency  = "critical";
    subline  = "Your African adventure begins TODAY. Safe travels and enjoy every magical moment!";
    tips = [
      "Double-check passport, visa, and all travel documents",
      "Arrive at the airport at least 3 hours early for international flights",
      "Charge all devices — you'll want to capture every moment",
      "Download offline maps and translation apps",
      "Most importantly: savour every single second. Africa will take your breath away 🦁",
    ];
  } else if (diffDays === 1) {
    headline = "Tomorrow Is The Big Day!";
    emoji    = "✈️";
    urgency  = "high";
    subline  = "You leave tomorrow! Time for your final checks and to let the excitement take over.";
    tips = [
      "Lay out everything you need tonight — don't leave packing to the morning",
      "Confirm your airport transfer and accommodation check-in time",
      "Share your full itinerary with family or emergency contact",
      "Get a good night's sleep — the adventure of a lifetime awaits!",
    ];
  } else if (diffDays <= 7) {
    headline = `Only ${diffDays} Days To Go!`;
    emoji    = "🌟";
    urgency  = "high";
    subline  = `Your ${trip} adventure is almost here. This is the week to finalize everything!`;
    tips = [
      "Complete your packing — check your list twice",
      "Verify all visa and vaccination documentation is ready",
      "Download offline maps for your destination",
      "Notify your bank and phone provider of international travel",
      "Read up on local customs, wildlife, and what to expect",
    ];
  } else if (diffDays <= 30) {
    headline = `Your Safari Is ${countdown}`;
    emoji    = "🦁";
    urgency  = "medium";
    subline  = `Less than a month away! Here's how to make the most of your final preparations.`;
    tips = [
      "Book any remaining internal transfers or domestic flights",
      "Purchase any gear you still need — binoculars, layers, sun protection",
      "Research the wildlife and ecosystems you'll be experiencing",
      "Arrange foreign currency or confirm your card works abroad",
    ];
  } else if (diffDays <= 90) {
    headline = `Your Adventure Awaits — ${countdown}`;
    emoji    = "🌍";
    urgency  = "low";
    subline  = `You're getting closer every day! Here are things to take care of in the coming weeks.`;
    tips = [
      "Confirm all accommodation and activity bookings are secured",
      "Arrange comprehensive travel insurance if not already done",
      "Apply for any required visas — allow plenty of processing time",
      "Start researching local customs, language basics, and tipping etiquette",
    ];
  } else {
    headline = `The Countdown Has Begun — ${countdown}`;
    emoji    = "🗺️";
    urgency  = "low";
    subline  = `Your ${trip} adventure is on the horizon. Here's how to plan ahead for an unforgettable experience.`;
    tips = [
      "Mark your travel dates prominently in your calendar",
      "Set a savings goal for personal expenses, tips, and souvenirs",
      "Start a packing list — it's never too early",
      "Follow Altuvera Travel for destination inspiration and travel tips",
    ];
  }

  const urgencyBg = {
    critical: "linear-gradient(140deg,#064e3b,#065f46,#059669)",
    high:     "linear-gradient(140deg,#022c22,#064e3b,#047857)",
    medium:   "linear-gradient(140deg,#022c22,#064e3b,#065f46)",
    low:      "linear-gradient(140deg,#0f172a,#022c22,#064e3b)",
  }[urgency];

  const extraCss = `
    .cd-card{border-radius:20px;padding:32px 24px;text-align:center;
             margin:0 0 24px;position:relative;overflow:hidden;
             background:${urgencyBg}}
    .cd-card-glow{position:absolute;top:50%;left:50%;
                  transform:translate(-50%,-50%);width:320px;height:320px;
                  border-radius:50%;
                  background:radial-gradient(circle,rgba(52,211,153,.2) 0%,transparent 70%)}
    .cd-emoji{font-size:46px;margin-bottom:12px;position:relative;
              display:inline-block;animation:wobble 2s ease-in-out infinite}
    @keyframes wobble{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
    .cd-headline{font-size:22px;font-weight:900;color:#fff;margin-bottom:8px;
                 position:relative;letter-spacing:-.015em}
    .cd-sub{font-size:13px;color:rgba(255,255,255,.65);margin-bottom:20px;
            position:relative;line-height:1.6;max-width:380px;margin-left:auto;margin-right:auto}
    .cd-counter{background:rgba(255,255,255,.08);border:1px solid rgba(52,211,153,.3);
                border-radius:16px;padding:16px 22px;display:inline-block;
                position:relative;margin-bottom:16px}
    .cd-num{font-size:54px;font-weight:900;color:#34d399;
            font-family:'Courier New',Courier,monospace;line-height:1}
    .cd-lbl{font-size:10px;color:rgba(255,255,255,.45);text-transform:uppercase;
            letter-spacing:.15em;margin-top:4px}
    .cd-meta{font-size:13px;color:rgba(255,255,255,.6);position:relative}
    .cd-meta strong{color:rgba(255,255,255,.9)}
  `;

  const html = shell({
    title:     `${emoji} ${headline} — ${trip} | Altuvera Travel`,
    preheader: `${countdown} until your ${trip} adventure! ${subline}`,
    extraCss,
    body: `
      <!-- Countdown card -->
      <div class="cd-card">
        <div class="cd-card-glow"></div>
        <div class="cd-emoji">${emoji}</div>
        <div class="cd-headline">${esc(headline)}</div>
        <p class="cd-sub">${esc(subline)}</p>
        <div class="cd-counter">
          <div class="cd-num">${esc(countdown)}</div>
          <div class="cd-lbl">Until departure</div>
        </div>
        <br/>
        <div class="cd-meta">
          ✈️ <strong>${esc(trip)}${country_name ? ` · ${esc(country_name)}` : ""}</strong><br/>
          <span style="font-size:12px;margin-top:4px;display:inline-block">${fmtDate(travel_date)}</span>
        </div>
      </div>

      <!-- Booking snapshot -->
      <div class="box">
        <div class="box-title">📋 Your Trip Details</div>
        <div class="row">
          <span class="lbl">Booking Ref</span>
          <span class="val" style="font-family:'Courier New',monospace;color:#059669">${esc(String(booking_number))}</span>
        </div>
        <div class="row">
          <span class="lbl">Destination</span>
          <span class="val">🌍 ${esc(trip)}${country_name ? `, ${esc(country_name)}` : ""}</span>
        </div>
        <div class="row">
          <span class="lbl">Departure</span>
          <span class="val">📅 ${fmtDate(travel_date)}</span>
        </div>
        <div class="row">
          <span class="lbl">Travelers</span>
          <span class="val">👥 ${esc(String(number_of_travelers))} ${Number(number_of_travelers) === 1 ? "person" : "people"}</span>
        </div>
        <div class="row">
          <span class="lbl">Status</span>
          <span class="val"><span class="bd b-confirmed">✓ Confirmed</span></span>
        </div>
      </div>

      ${tips.length ? `
      <!-- Tips -->
      <div class="next-steps" style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border-color:#6ee7b7">
        <div class="ns-ttl" style="color:#065f46">💡 Preparation Tips for ${esc(full_name)}</div>
        ${tips.map((t, i) => `
        <div class="ns-item">
          <div class="ns-n">${i + 1}</div>
          <div>${esc(t)}</div>
        </div>`).join("")}
      </div>` : ""}

      <div class="div"></div>

      <div class="btn-row">
        <a href="${CFG.appUrl}/my-bookings" class="btn btn-g">🌿 View My Booking</a>
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">Contact My Coordinator</a>
      </div>

      <p style="text-align:center;font-size:12px;color:#94a3b8;margin-top:20px;line-height:1.7">
        You'll receive daily countdown updates leading up to your departure. 🌿<br/>
        <a href="mailto:${CFG.supportEmail}?subject=Unsubscribe countdown ${esc(String(booking_number))}"
           style="color:#94a3b8">Unsubscribe from countdowns</a>
      </p>`,

    footer: `To stop receiving countdown emails, reply "unsubscribe countdown" to <a href="mailto:${CFG.supportEmail}">${CFG.supportEmail}</a>.`,
  });

  return sendEmail({
    to:      email,
    subject: `${emoji} ${headline} — ${trip} | Altuvera Travel`,
    html,
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   VERIFY CONNECTION
══════════════════════════════════════════════════════════════════════════════ */
async function verifyConnection() {
  if (CFG.resendApiKey) {
    try {
      const r = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${CFG.resendApiKey}` },
      });
      if (r.ok) { console.log("[Email] ✅ Resend verified"); return true; }
    } catch (e) { console.warn("[Email] Resend ping failed:", e.message); }
  }
  const s = getSmtp();
  if (s) {
    try {
      await s.verify();
      console.log("[Email] ✅ SMTP verified");
      return true;
    } catch (e) { console.warn("[Email] SMTP verify failed:", e.message); }
  }
  console.warn("[Email] ⚠️ No provider verified — console fallback active");
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════════
   EXPORTS
══════════════════════════════════════════════════════════════════════════════ */
module.exports = {
  sendEmail,
  sendBookingVerificationLink,
  sendAdminBookingNotification,
  sendBookingConfirmation,
  sendBookingStatusUpdate,
  sendBookingCancellation,
  sendTripCountdownEmail,
  verifyConnection,
  humanCountdown,
};