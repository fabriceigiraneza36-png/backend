// services/emailService.js
// ============================================================
// Altuvera Travel — Email Service
// Provider: Resend (primary) → SMTP fallback → console
// Matched exactly to bookingsController.js imports
// ============================================================

"use strict";

/* ═══════════════════════════════════════════════════════════
   CONFIG — reads your exact .env variables
═══════════════════════════════════════════════════════════ */
const CFG = {
  // Provider priority: resend → smtp → console
  resendApiKey:   process.env.RESEND_API_KEY     || "",
  resendDomain:   process.env.RESEND_FROM_DOMAIN || "altuvera.vercel.app",

  smtp: {
    host:   process.env.SMTP_HOST || "smtp.gmail.com",
    port:   parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    user:   process.env.SMTP_USER || "",
    pass:   process.env.SMTP_PASS || "",
  },

  from: {
    name:    "Altuvera Travel",
    address: process.env.SMTP_USER || "altuverasafari@gmail.com",
  },

  adminEmail:   process.env.ADMIN_EMAIL   || "altuverasafari@gmail.com",
  supportEmail: process.env.SUPPORT_EMAIL || "altuverasafari@gmail.com",
  replyTo:      process.env.SUPPORT_EMAIL || "altuverasafari@gmail.com",

  appName:  process.env.APP_NAME    || "Altuvera Travel",
  appUrl:   process.env.FRONTEND_URL || "https://altuvera.vercel.app",
  isDev:    process.env.NODE_ENV !== "production",
};

/* ═══════════════════════════════════════════════════════════
   LAZY NODEMAILER — only loaded if SMTP needed
═══════════════════════════════════════════════════════════ */
let _smtpTransporter = null;

function getSmtpTransporter() {
  if (_smtpTransporter) return _smtpTransporter;
  if (!CFG.smtp.user || !CFG.smtp.pass) return null;

  try {
    const nodemailer = require("nodemailer");
    _smtpTransporter = nodemailer.createTransport({
      host:   CFG.smtp.host,
      port:   CFG.smtp.port,
      secure: CFG.smtp.secure,
      auth: {
        user: CFG.smtp.user,
        pass: CFG.smtp.pass,
      },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 8000,
      greetingTimeout:   5000,
    });
    console.log("[EmailService] ✅ SMTP transporter initialised");
    return _smtpTransporter;
  } catch (err) {
    console.warn("[EmailService] SMTP init failed:", err.message);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════
   CORE SEND — Resend → SMTP → console
═══════════════════════════════════════════════════════════ */
async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!to || !subject || (!html && !text)) {
    throw new Error("sendEmail: to, subject, and html/text are required");
  }

  const plainText = text || stripHtml(html);

  /* ── 1. Resend (HTTPS — works on Render) ── */
  if (CFG.resendApiKey) {
    return _sendViaResend({ to, subject, html, text: plainText, replyTo });
  }

  /* ── 2. SMTP (nodemailer) ── */
  const transporter = getSmtpTransporter();
  if (transporter) {
    return _sendViaSmtp(transporter, { to, subject, html, text: plainText, replyTo });
  }

  /* ── 3. Console fallback (dev / no credentials) ── */
  return _sendViaConsole({ to, subject, text: plainText });
}

async function _sendViaResend({ to, subject, html, text, replyTo }) {
  // Resend requires a verified domain for the "from" address.
  // On free plan use: onboarding@resend.dev for testing.
  const fromAddress = CFG.resendApiKey
    ? `${CFG.from.name} <onboarding@resend.dev>`  // swap for your verified domain
    : `${CFG.from.name} <${CFG.from.address}>`;

  const body = {
    from:    fromAddress,
    to:      Array.isArray(to) ? to : [to],
    subject,
    html:    html || `<pre>${text}</pre>`,
    text,
    reply_to: replyTo || CFG.replyTo,
  };

  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      Authorization: `Bearer ${CFG.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = json?.message || json?.error || `Resend HTTP ${res.status}`;
    throw new Error(`Resend: ${msg}`);
  }

  console.log(`[EmailService] ✉️  Resend → ${to} | id:${json.id}`);
  return { success: true, provider: "resend", messageId: json.id };
}

async function _sendViaSmtp(transporter, { to, subject, html, text, replyTo }) {
  const info = await transporter.sendMail({
    from:     `"${CFG.from.name}" <${CFG.from.address}>`,
    to,
    subject,
    html,
    text,
    replyTo: replyTo || CFG.replyTo,
  });
  console.log(`[EmailService] ✉️  SMTP → ${to} | msgId:${info.messageId}`);
  return { success: true, provider: "smtp", messageId: info.messageId };
}

function _sendViaConsole({ to, subject, text }) {
  console.log("\n" + "═".repeat(60));
  console.log(`[EmailService] 📧 CONSOLE (no provider configured)`);
  console.log(`  TO:      ${to}`);
  console.log(`  SUBJECT: ${subject}`);
  console.log(`  BODY:    ${(text || "").slice(0, 400)}`);
  console.log("═".repeat(60) + "\n");
  return { success: true, provider: "console", messageId: `console-${Date.now()}` };
}

/* ═══════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════ */
function stripHtml(html = "") {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function esc(str = "") {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  } catch { return String(d); }
}

function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(d); }
}

/* ═══════════════════════════════════════════════════════════
   BASE HTML TEMPLATE
═══════════════════════════════════════════════════════════ */
function baseTemplate({ title, preheader = "", bodyHtml, footerNote = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
       background:#f0fdf4;color:#0f172a;line-height:1.6}
  .wrap{max-width:600px;margin:0 auto;padding:20px 12px}
  .card{background:#fff;border-radius:16px;overflow:hidden;
        box-shadow:0 4px 24px rgba(2,44,34,.08);border:1px solid #d1fae5}
  .hdr{background:linear-gradient(135deg,#022c22,#064e3b 60%,#059669);
       padding:32px 28px;text-align:center}
  .hdr-logo{font-size:24px;font-weight:800;color:#fff;letter-spacing:-.02em}
  .hdr-logo em{color:#34d399;font-style:normal}
  .hdr-sub{color:rgba(255,255,255,.65);font-size:12px;margin-top:3px}
  .body{padding:32px 28px}
  .h1{font-size:21px;font-weight:700;color:#022c22;margin-bottom:5px;line-height:1.3}
  .sub{color:#64748b;font-size:14px;margin-bottom:24px}
  .box{background:#f0fdf4;border-radius:12px;padding:18px 22px;
       border:1px solid #a7f3d0;margin:18px 0}
  .box-title{font-size:11.5px;font-weight:800;color:#065f46;text-transform:uppercase;
             letter-spacing:.07em;margin-bottom:12px}
  .row{display:flex;justify-content:space-between;align-items:flex-start;
       padding:5px 0;border-bottom:1px solid rgba(167,243,208,.35);
       font-size:13.5px;gap:10px}
  .row:last-child{border:none;padding-bottom:0}
  .lbl{color:#64748b;font-weight:500;white-space:nowrap;flex-shrink:0}
  .val{color:#0f172a;font-weight:600;text-align:right;word-break:break-word}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;
         font-size:11.5px;font-weight:700;letter-spacing:.03em}
  .b-pending  {background:#fef3c7;color:#92400e}
  .b-confirmed{background:#dcfce7;color:#166534}
  .b-cancelled{background:#fee2e2;color:#991b1b}
  .b-completed{background:#dbeafe;color:#1e40af}
  .b-hold     {background:#fce7f3;color:#9d174d}
  .btn{display:inline-block;padding:12px 26px;border-radius:11px;
       text-decoration:none;font-weight:700;font-size:13.5px;
       letter-spacing:.02em;margin:5px 3px}
  .btn-g{background:linear-gradient(135deg,#10b981,#059669);color:#fff;
         box-shadow:0 4px 14px rgba(5,150,105,.28)}
  .btn-o{border:1.5px solid #059669;color:#059669;background:#f0fdf4}
  .warn{background:#fffbeb;border-radius:11px;padding:14px 18px;
        border:1px solid #fde68a;margin:16px 0}
  .warn p{font-size:13px;color:#92400e;margin:0}
  .info{background:#eff6ff;border-radius:11px;padding:14px 18px;
        border:1px solid #bfdbfe;margin:16px 0}
  .info p{font-size:13px;color:#1e40af;margin:0}
  .divider{height:1px;
           background:linear-gradient(90deg,transparent,#d1fae5,transparent);
           margin:24px 0}
  .ftr{padding:22px 28px;text-align:center;background:#f8fafb;
       border-top:1px solid #e2e8f0}
  .ftr p{font-size:11.5px;color:#94a3b8;line-height:1.7;margin-bottom:3px}
  .ftr a{color:#059669;text-decoration:none;font-weight:600}
  .otp-code{font-size:38px;font-weight:900;letter-spacing:10px;color:#022c22;
            text-align:center;padding:18px;background:#f0fdf4;
            border-radius:12px;border:2px dashed #a7f3d0;
            font-family:'Courier New',monospace;margin:20px 0}
  @media(max-width:480px){
    .body,.hdr,.ftr{padding:22px 18px}
    .row{flex-direction:column;gap:1px}
    .val{text-align:left}
  }
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f0fdf4">
  ${esc(preheader)}
</div>
<div class="wrap">
<div class="card">
  <div class="hdr">
    <div class="hdr-logo">🌍 <em>Altuvera</em> Travel</div>
    <div class="hdr-sub">Authentic African Safari Experiences</div>
  </div>
  <div class="body">
    ${bodyHtml}
  </div>
  <div class="ftr">
    ${footerNote ? `<p>${footerNote}</p>` : ""}
    <p>© ${new Date().getFullYear()} ${esc(CFG.appName)}. All rights reserved.</p>
    <p>
      <a href="${CFG.appUrl}">Website</a> ·
      <a href="mailto:${CFG.supportEmail}">Support</a> ·
      <a href="${CFG.appUrl}/destinations">Destinations</a>
    </p>
    <p style="margin-top:8px;font-size:10.5px;color:#cbd5e1">
      You're receiving this because you interacted with ${esc(CFG.appName)}.
    </p>
  </div>
</div>
</div>
</body>
</html>`;
}

/* helper: status badge class */
function badgeCls(status) {
  const map = {
    pending: "b-pending", confirmed: "b-confirmed",
    cancelled: "b-cancelled", completed: "b-completed",
    "on-hold": "b-hold", refunded: "b-confirmed",
  };
  return map[status] || "b-pending";
}

/* ═══════════════════════════════════════════════════════════
   1. sendVerificationCode — OTP email
   Called by: bookingsController.sendOtp
═══════════════════════════════════════════════════════════ */
async function sendVerificationCode(email, code, firstName) {
  if (!email) throw new Error("sendVerificationCode: email required");
  if (!code)  throw new Error("sendVerificationCode: code required");

  const name       = firstName || "Explorer";
  const expiryMins = 10;

  const html = baseTemplate({
    title:    "Your Altuvera Verification Code",
    preheader: `Your verification code is ${code}. Valid for ${expiryMins} minutes.`,
    bodyHtml: `
      <h2 class="h1">🔐 Email Verification</h2>
      <p class="sub">
        Hi ${esc(name)}, please use the code below to verify your email
        and complete your booking.
      </p>

      <div class="otp-code">${esc(code)}</div>

      <div class="warn">
        <p>
          ⏱ This code expires in <strong>${expiryMins} minutes</strong>.
          Do not share it with anyone.
        </p>
      </div>

      <div class="divider"></div>

      <p style="font-size:13px;color:#64748b;text-align:center">
        If you didn't request this code, you can safely ignore this email.
        <br>Someone may have entered your address by mistake.
      </p>
    `,
    footerNote: "Security notice: Altuvera will never ask for your verification code by phone or chat.",
  });

  return sendEmail({
    to:      email,
    subject: `${code} — Your Altuvera Verification Code`,
    html,
    text: `Your Altuvera verification code is: ${code}\n\nThis code expires in ${expiryMins} minutes.\n\nIf you didn't request this, ignore this email.`,
  });
}

/* ═══════════════════════════════════════════════════════════
   2. sendBookingConfirmation — status confirmed
   Called by: bookingsController.updateStatus (status=confirmed)
═══════════════════════════════════════════════════════════ */
async function sendBookingConfirmation(booking) {
  const {
    email,
    full_name        = "Valued Guest",
    booking_number   = booking.id || "N/A",
    destination_name = "Your Destination",
    service_name,
    package_name,
    travel_date,
    return_date,
    number_of_travelers = 1,
    accommodation_type,
    special_requests,
    confirmation_code,
    country_name,
  } = booking;

  if (!email) {
    console.warn("[EmailService] sendBookingConfirmation: no email");
    return { success: false, reason: "no_email" };
  }

  const destLabel = destination_name || service_name || package_name || "Your Trip";

  const html = baseTemplate({
    title:    `Booking Confirmed — ${booking_number}`,
    preheader: `🎉 Your booking ${booking_number} is confirmed! Get ready for ${destLabel}.`,
    bodyHtml: `
      <h2 class="h1">🎉 Booking Confirmed!</h2>
      <p class="sub">
        Hi ${esc(full_name)}, your adventure is officially booked.
        We're thrilled to have you with us!
      </p>

      <div class="box">
        <div class="box-title">📋 Booking Details</div>
        <div class="row">
          <span class="lbl">Booking #</span>
          <span class="val" style="color:#059669;font-family:monospace;font-size:15px">
            ${esc(String(booking_number))}
          </span>
        </div>
        <div class="row">
          <span class="lbl">Status</span>
          <span class="val">
            <span class="badge b-confirmed">✓ Confirmed</span>
          </span>
        </div>
        <div class="row">
          <span class="lbl">Destination</span>
          <span class="val">🌍 ${esc(destLabel)}${country_name ? `, ${esc(country_name)}` : ""}</span>
        </div>
        ${travel_date ? `
        <div class="row">
          <span class="lbl">Departure</span>
          <span class="val">${fmtDate(travel_date)}</span>
        </div>` : ""}
        ${return_date ? `
        <div class="row">
          <span class="lbl">Return</span>
          <span class="val">${fmtDate(return_date)}</span>
        </div>` : ""}
        ${accommodation_type ? `
        <div class="row">
          <span class="lbl">Accommodation</span>
          <span class="val">${esc(accommodation_type)}</span>
        </div>` : ""}
        <div class="row">
          <span class="lbl">Travelers</span>
          <span class="val">👥 ${esc(String(number_of_travelers))}</span>
        </div>
        ${confirmation_code ? `
        <div class="row">
          <span class="lbl">Confirmation Code</span>
          <span class="val" style="font-family:monospace;color:#059669">
            ${esc(confirmation_code)}
          </span>
        </div>` : ""}
      </div>

      ${special_requests ? `
      <div class="box" style="background:#fffbeb;border-color:#fde68a">
        <div class="box-title" style="color:#92400e">💬 Special Requests Noted</div>
        <p style="font-size:13.5px;color:#78350f;margin:0">${esc(special_requests)}</p>
      </div>` : ""}

      <div class="divider"></div>

      <div style="background:#f0fdf4;border-radius:12px;padding:18px 20px;
                  border-left:4px solid #059669;margin:18px 0">
        <div class="box-title">✅ What Happens Next?</div>
        <ol style="margin:0;padding-left:17px;font-size:13.5px;color:#374151;line-height:2.1">
          <li>Your personal safari coordinator will email you within 24 hours</li>
          <li>You'll receive a detailed itinerary and pre-departure guide</li>
          <li>We'll send travel tips specific to your destination</li>
          <li>Arrive, explore, and create memories that last a lifetime 🦁</li>
        </ol>
      </div>

      <div style="text-align:center;margin-top:26px">
        <a href="${CFG.appUrl}/bookings?ref=${esc(String(booking_number))}"
           class="btn btn-g">View My Booking</a>
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">Contact Support</a>
      </div>
    `,
  });

  return sendEmail({
    to:      email,
    subject: `✅ Confirmed: ${booking_number} — ${destLabel} | Altuvera Travel`,
    html,
  });
}

/* ═══════════════════════════════════════════════════════════
   3. sendBookingStatusUpdate — generic status change
   Called by: bookingsController.updateStatus (non-confirm/cancel)
═══════════════════════════════════════════════════════════ */
async function sendBookingStatusUpdate(booking, oldStatus, newStatus, reason) {
  const {
    email,
    full_name      = "Valued Guest",
    booking_number = booking.id || "N/A",
    destination_name = booking.service_name || booking.package_name || "Your Trip",
    travel_date,
  } = booking;

  if (!email) return { success: false, reason: "no_email" };

  const statusLabels = {
    pending:   "⏳ Pending Review",
    confirmed: "✅ Confirmed",
    "on-hold": "⏸ On Hold",
    completed: "🏁 Completed",
    cancelled: "❌ Cancelled",
    refunded:  "💳 Refunded",
  };

  const statusMessages = {
    pending:   "Your booking is back under review. We'll be in touch soon.",
    confirmed: "Great news — your booking has been confirmed!",
    "on-hold": "Your booking has been placed on hold. Please contact us for details.",
    completed: "Your trip is complete. We hope it was extraordinary! 🌟",
    refunded:  "Your refund has been processed. Please allow 5–10 business days.",
  };

  const html = baseTemplate({
    title:    `Booking Update: ${newStatus} — ${booking_number}`,
    preheader: `Your booking ${booking_number} status has been updated to ${newStatus}.`,
    bodyHtml: `
      <h2 class="h1">🔄 Booking Status Updated</h2>
      <p class="sub">Hi ${esc(full_name)}, there's an update on your booking.</p>

      <div class="box">
        <div class="box-title">📋 Status Change</div>
        <div class="row">
          <span class="lbl">Booking #</span>
          <span class="val" style="font-family:monospace">${esc(String(booking_number))}</span>
        </div>
        <div class="row">
          <span class="lbl">Destination</span>
          <span class="val">${esc(destination_name)}</span>
        </div>
        ${travel_date ? `
        <div class="row">
          <span class="lbl">Travel Date</span>
          <span class="val">${fmtDate(travel_date)}</span>
        </div>` : ""}
        <div class="row">
          <span class="lbl">Previous</span>
          <span class="val">
            <span class="badge ${badgeCls(oldStatus)}">${esc(statusLabels[oldStatus] || oldStatus)}</span>
          </span>
        </div>
        <div class="row">
          <span class="lbl">New Status</span>
          <span class="val">
            <span class="badge ${badgeCls(newStatus)}">${esc(statusLabels[newStatus] || newStatus)}</span>
          </span>
        </div>
      </div>

      <div class="info">
        <p>ℹ️ ${esc(statusMessages[newStatus] || "Your booking has been updated.")}</p>
      </div>

      ${reason ? `
      <div class="warn">
        <p>📝 <strong>Note from our team:</strong> ${esc(reason)}</p>
      </div>` : ""}

      <div style="text-align:center;margin-top:24px">
        <a href="${CFG.appUrl}/my-bookings" class="btn btn-g">View Booking</a>
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">Get Help</a>
      </div>
    `,
  });

  return sendEmail({
    to:      email,
    subject: `🔄 Booking ${booking_number} — Status: ${newStatus} | Altuvera`,
    html,
  });
}

/* ═══════════════════════════════════════════════════════════
   4. sendBookingCancellation — status cancelled
   Called by: bookingsController.updateStatus (status=cancelled)
═══════════════════════════════════════════════════════════ */
async function sendBookingCancellation(booking, reason) {
  const {
    email,
    full_name        = "Valued Guest",
    booking_number   = booking.id || "N/A",
    destination_name = booking.service_name || booking.package_name || "Your Trip",
    travel_date,
    country_name,
  } = booking;

  if (!email) return { success: false, reason: "no_email" };

  const html = baseTemplate({
    title:    `Booking Cancelled — ${booking_number}`,
    preheader: `Your booking ${booking_number} has been cancelled.`,
    bodyHtml: `
      <h2 class="h1">❌ Booking Cancelled</h2>
      <p class="sub">
        Hi ${esc(full_name)}, your booking has been cancelled.
        We're sorry we couldn't make it happen this time.
      </p>

      <div class="box" style="background:#fff1f2;border-color:#fca5a5">
        <div class="box-title" style="color:#991b1b">📋 Cancelled Booking</div>
        <div class="row">
          <span class="lbl">Booking #</span>
          <span class="val" style="font-family:monospace">${esc(String(booking_number))}</span>
        </div>
        <div class="row">
          <span class="lbl">Status</span>
          <span class="val">
            <span class="badge b-cancelled">✗ Cancelled</span>
          </span>
        </div>
        <div class="row">
          <span class="lbl">Destination</span>
          <span class="val">${esc(destination_name)}${country_name ? `, ${esc(country_name)}` : ""}</span>
        </div>
        ${travel_date ? `
        <div class="row">
          <span class="lbl">Was Planned For</span>
          <span class="val">${fmtDate(travel_date)}</span>
        </div>` : ""}
        ${reason ? `
        <div class="row">
          <span class="lbl">Reason</span>
          <span class="val">${esc(reason)}</span>
        </div>` : ""}
      </div>

      <div class="info">
        <p>
          💳 If a payment was made, refunds are processed within
          <strong>5–10 business days</strong> to your original payment method.
          Contact us if you have questions.
        </p>
      </div>

      <div class="divider"></div>

      <p style="font-size:13.5px;color:#64748b;text-align:center;margin:16px 0">
        We hope to welcome you on a future adventure! 🌍
        Our team is always here to help plan your perfect safari.
      </p>

      <div style="text-align:center;margin-top:22px">
        <a href="${CFG.appUrl}/destinations" class="btn btn-g">
          Browse Destinations
        </a>
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">
          Contact Us
        </a>
      </div>
    `,
  });

  return sendEmail({
    to:      email,
    subject: `❌ Booking Cancelled: ${booking_number} | Altuvera Travel`,
    html,
  });
}

/* ═══════════════════════════════════════════════════════════
   5. sendAdminBookingNotification — new booking alert to admin
   Called by: bookingsController.create
═══════════════════════════════════════════════════════════ */
async function sendAdminBookingNotification(booking) {
  const adminEmail = CFG.adminEmail;
  if (!adminEmail) {
    console.warn("[EmailService] sendAdminBookingNotification: ADMIN_EMAIL not set");
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
    destination_name    = "—",
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

  const tripLabel = destination_name !== "—"
    ? destination_name
    : service_name || package_name || "Custom Request";

  const html = baseTemplate({
    title:    `New Booking: ${booking_number}`,
    preheader: `New ${booking_type} booking from ${full_name} for ${tripLabel}`,
    bodyHtml: `
      <h2 class="h1">🔔 New Booking Received</h2>
      <p class="sub">
        A new booking has been submitted and needs your attention.
      </p>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0">
        ${[
          ["Booking #", booking_number],
          ["Travelers", number_of_travelers],
          ["Source", source],
        ].map(([l, v]) => `
          <div style="flex:1;min-width:120px;text-align:center;padding:14px 10px;
                      background:#f0fdf4;border-radius:10px;border:1px solid #a7f3d0">
            <div style="font-size:13px;font-weight:800;color:#022c22">${esc(String(v))}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">${esc(l)}</div>
          </div>`).join("")}
      </div>

      <div class="box">
        <div class="box-title">👤 Customer Info</div>
        <div class="row">
          <span class="lbl">Name</span>
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
        ${whatsapp ? `
        <div class="row">
          <span class="lbl">WhatsApp</span>
          <span class="val">
            <a href="https://wa.me/${esc(whatsapp.replace(/\D/g,""))}"
               style="color:#25d366">
              ${esc(whatsapp)}
            </a>
          </span>
        </div>` : ""}
        ${nationality ? `
        <div class="row">
          <span class="lbl">Nationality</span>
          <span class="val">${esc(nationality)}</span>
        </div>` : ""}
        ${country ? `
        <div class="row">
          <span class="lbl">Country</span>
          <span class="val">${esc(country)}</span>
        </div>` : ""}
      </div>

      <div class="box">
        <div class="box-title">🗺️ Trip Details</div>
        <div class="row">
          <span class="lbl">Type</span>
          <span class="val">${esc(booking_type)}</span>
        </div>
        <div class="row">
          <span class="lbl">Destination</span>
          <span class="val">${esc(tripLabel)}</span>
        </div>
        ${travel_date ? `
        <div class="row">
          <span class="lbl">Departure</span>
          <span class="val">${fmtDate(travel_date)}</span>
        </div>` : ""}
        ${return_date ? `
        <div class="row">
          <span class="lbl">Return</span>
          <span class="val">${fmtDate(return_date)}</span>
        </div>` : ""}
        ${flexible_dates ? `
        <div class="row">
          <span class="lbl">Flexible Dates</span>
          <span class="val" style="color:#059669">✓ Yes</span>
        </div>` : ""}
        <div class="row">
          <span class="lbl">Travelers</span>
          <span class="val">
            ${esc(String(number_of_travelers))} total
            ${number_of_adults    ? ` (${number_of_adults} adults`    : ""}
            ${number_of_children  ? `, ${number_of_children} children)` : number_of_adults ? ")" : ""}
          </span>
        </div>
        ${accommodation_type ? `
        <div class="row">
          <span class="lbl">Accommodation</span>
          <span class="val">${esc(accommodation_type)}</span>
        </div>` : ""}
        ${dietary_requirements ? `
        <div class="row">
          <span class="lbl">Dietary</span>
          <span class="val">${esc(dietary_requirements)}</span>
        </div>` : ""}
        <div class="row">
          <span class="lbl">Status</span>
          <span class="val">
            <span class="badge b-pending">⏳ ${esc(status)}</span>
          </span>
        </div>
        <div class="row">
          <span class="lbl">Submitted</span>
          <span class="val">${fmtDateTime(created_at || new Date())}</span>
        </div>
      </div>

      ${special_requests ? `
      <div class="box" style="background:#fffbeb;border-color:#fde68a">
        <div class="box-title" style="color:#92400e">💬 Special Requests</div>
        <p style="font-size:13.5px;color:#78350f;margin:0;white-space:pre-wrap">
          ${esc(special_requests)}
        </p>
      </div>` : ""}

      <div style="text-align:center;margin-top:26px">
        <a href="${CFG.appUrl}/admin/bookings" class="btn btn-g">
          Open Admin Dashboard
        </a>
        <a href="mailto:${esc(email)}" class="btn btn-o">
          Reply to Customer
        </a>
        ${whatsapp ? `
        <a href="https://wa.me/${esc(whatsapp.replace(/\D/g,""))}"
           class="btn btn-o" style="background:#f0fff4;border-color:#25d366;color:#15803d">
          WhatsApp
        </a>` : ""}
      </div>
    `,
  });

  return sendEmail({
    to:      adminEmail,
    replyTo: email,
    subject: `🔔 New Booking: ${booking_number} — ${full_name} → ${tripLabel}`,
    html,
  });
}

/* ═══════════════════════════════════════════════════════════
   VERIFY CONNECTION
═══════════════════════════════════════════════════════════ */
async function verifyConnection() {
  // Test Resend
  if (CFG.resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${CFG.resendApiKey}` },
      });
      if (res.ok) {
        console.log("[EmailService] ✅ Resend connection verified");
        return true;
      }
    } catch (err) {
      console.warn("[EmailService] Resend verify failed:", err.message);
    }
  }

  // Test SMTP
  const transporter = getSmtpTransporter();
  if (transporter) {
    try {
      await transporter.verify();
      console.log("[EmailService] ✅ SMTP connection verified");
      return true;
    } catch (err) {
      console.warn("[EmailService] SMTP verify failed:", err.message);
    }
  }

  console.warn("[EmailService] ⚠️  No email provider verified — using console fallback");
  return false;
}

/* ═══════════════════════════════════════════════════════════
   EXPORTS — exactly matching bookingsController.js imports
═══════════════════════════════════════════════════════════ */
module.exports = {
  // ── Used directly by bookingsController ──
  sendVerificationCode,       // sendOtp handler
  sendBookingConfirmation,    // updateStatus → confirmed
  sendBookingStatusUpdate,    // updateStatus → other statuses
  sendBookingCancellation,    // updateStatus → cancelled
  sendAdminBookingNotification, // create handler

  // ── Extras (available for other controllers) ──
  sendEmail,
  verifyConnection,
};