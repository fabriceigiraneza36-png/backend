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
  refunded:  "b-confirmed",
})[s] || "b-pending";

/**
 * humanCountdown(ms)
 * Returns a friendly string like:
 *   "in 3 weeks and 2 days"
 *   "in 1 month and 5 days"
 *   "in 2 years"
 *   "tomorrow"
 *   "today"
 */
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

  const weeks  = Math.floor(diffDays / 7);
  const days   = diffDays % 7;

  if (diffDays < 30) {
    return days > 0
      ? `in ${weeks} week${weeks !== 1 ? "s" : ""} and ${days} day${days !== 1 ? "s" : ""}`
      : `in ${weeks} week${weeks !== 1 ? "s" : ""}`;
  }

  const months = Math.floor(diffDays / 30);
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
   CORE sendEmail  —  Resend → SMTP → console fallback
══════════════════════════════════════════════════════════════════════════════ */
async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!to || !subject || (!html && !text))
    throw new Error("sendEmail: to, subject, html/text required");

  const plain = text || stripHtml(html);

  /* 1 — Resend (HTTPS, no port issues on Render) */
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

  /* 2 — SMTP */
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

  /* 3 — Console fallback (dev / no provider configured) */
  console.log(`\n${"═".repeat(60)}`);
  console.log("[Email] CONSOLE FALLBACK");
  console.log(`  TO:      ${to}`);
  console.log(`  SUBJECT: ${subject}`);
  console.log(`  PREVIEW: ${plain.slice(0, 300)}`);
  console.log(`${"═".repeat(60)}\n`);
  return { success: true, provider: "console", messageId: `console-${Date.now()}` };
}

/* ══════════════════════════════════════════════════════════════════════════════
   BASE HTML SHELL
══════════════════════════════════════════════════════════════════════════════ */
function shell({ title, preheader = "", body, footer = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
     background:#f0fdf4;color:#0f172a;line-height:1.6}
.w{max-width:600px;margin:0 auto;padding:20px 12px}
.c{background:#fff;border-radius:16px;overflow:hidden;
   box-shadow:0 4px 24px rgba(2,44,34,.08);border:1px solid #d1fae5}
.h{background:linear-gradient(135deg,#022c22,#064e3b 55%,#059669);
   padding:28px 26px;text-align:center}
.hl{font-size:21px;font-weight:800;color:#fff;letter-spacing:-.02em}
.hl em{color:#34d399;font-style:normal}
.hs{color:rgba(255,255,255,.6);font-size:12px;margin-top:3px}
.b{padding:30px 26px}
.t1{font-size:20px;font-weight:700;color:#022c22;margin-bottom:4px;line-height:1.3}
.st{color:#64748b;font-size:13.5px;margin-bottom:20px}
.bx{background:#f0fdf4;border-radius:11px;padding:16px 20px;
    border:1px solid #a7f3d0;margin:16px 0}
.bt{font-size:11px;font-weight:800;color:#065f46;text-transform:uppercase;
    letter-spacing:.07em;margin-bottom:10px}
.r{display:flex;justify-content:space-between;align-items:flex-start;
   padding:5px 0;border-bottom:1px solid rgba(167,243,208,.35);
   font-size:13px;gap:8px}
.r:last-child{border:none;padding-bottom:0}
.l{color:#64748b;font-weight:500;white-space:nowrap;flex-shrink:0}
.v{color:#0f172a;font-weight:600;text-align:right;word-break:break-word}
.bd{display:inline-block;padding:3px 9px;border-radius:999px;
    font-size:11px;font-weight:700;letter-spacing:.03em}
.b-pending  {background:#fef3c7;color:#92400e}
.b-confirmed{background:#dcfce7;color:#166534}
.b-cancelled{background:#fee2e2;color:#991b1b}
.b-completed{background:#dbeafe;color:#1e40af}
.b-hold     {background:#fce7f3;color:#9d174d}
.btn{display:inline-block;padding:14px 28px;border-radius:12px;
     text-decoration:none;font-weight:700;font-size:14px;margin:4px 3px;
     letter-spacing:.01em}
.btn-g{background:linear-gradient(135deg,#10b981,#059669);color:#fff;
       box-shadow:0 4px 14px rgba(5,150,105,.3)}
.btn-o{border:1.5px solid #059669;color:#059669;background:#f0fdf4}
.btn-r{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;
       box-shadow:0 4px 14px rgba(220,38,38,.25)}
.warn{background:#fffbeb;border-radius:10px;padding:13px 17px;
      border:1px solid #fde68a;margin:14px 0}
.warn p{font-size:13px;color:#92400e;margin:0}
.info{background:#eff6ff;border-radius:10px;padding:13px 17px;
      border:1px solid #bfdbfe;margin:14px 0}
.info p{font-size:13px;color:#1e40af;margin:0}
.success-box{background:#f0fdf4;border-radius:12px;padding:18px 22px;
             border:2px solid #a7f3d0;margin:18px 0;text-align:center}
.div{height:1px;background:linear-gradient(90deg,transparent,#d1fae5,transparent);margin:22px 0}
.countdown{text-align:center;padding:24px 16px;
           background:linear-gradient(135deg,#022c22,#064e3b);
           border-radius:16px;margin:20px 0;color:#fff}
.cd-num{font-size:48px;font-weight:900;color:#34d399;
        font-family:'Courier New',monospace;letter-spacing:.04em;line-height:1}
.cd-lbl{font-size:11px;color:rgba(255,255,255,.5);
        text-transform:uppercase;letter-spacing:.1em;margin-top:4px}
.cd-msg{font-size:15px;color:rgba(255,255,255,.8);margin-top:12px;line-height:1.5}
.ft{padding:20px 26px;text-align:center;background:#f8fafb;border-top:1px solid #e2e8f0}
.ft p{font-size:11px;color:#94a3b8;line-height:1.7;margin-bottom:2px}
.ft a{color:#059669;text-decoration:none;font-weight:600}
@media(max-width:480px){.b,.h,.ft{padding:20px 14px}
.r{flex-direction:column;gap:1px}.v{text-align:left}
.btn{display:block;text-align:center;margin:6px 0}
.cd-num{font-size:38px}}
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f0fdf4">
  ${esc(preheader)}
</div>
<div class="w"><div class="c">
  <div class="h">
    <div class="hl">🌍 <em>Altuvera</em> Travel</div>
    <div class="hs">Authentic African Safari Experiences</div>
  </div>
  <div class="b">${body}</div>
  <div class="ft">
    ${footer ? `<p>${footer}</p>` : ""}
    <p>© ${new Date().getFullYear()} Altuvera Travel · All rights reserved</p>
    <p>
      <a href="${CFG.appUrl}">Website</a> ·
      <a href="mailto:${CFG.supportEmail}">Support</a> ·
      <a href="${CFG.appUrl}/destinations">Destinations</a>
    </p>
  </div>
</div></div>
</body></html>`;
}

/* ══════════════════════════════════════════════════════════════════════════════
   1.  sendBookingVerificationLink
       Called immediately after user submits booking form.
       User must click the link to confirm their email & send to admin.
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

  const html = shell({
    title:     "Confirm Your Booking Request",
    preheader: `One click to confirm your booking for ${destination_name}. Link expires in 24 hours.`,
    body: `
      <h2 class="t1">✅ Confirm Your Booking Request</h2>
      <p class="st">
        Hi <strong>${esc(full_name)}</strong>,<br/>
        Thank you for choosing Altuvera Travel!
        To complete your booking request, please verify your email address
        by clicking the button below.
      </p>

      <div class="bx">
        <div class="bt">📋 Your Booking Summary</div>
        <div class="r">
          <span class="l">Booking Ref</span>
          <span class="v" style="font-family:monospace;color:#059669">${esc(String(booking_number))}</span>
        </div>
        <div class="r">
          <span class="l">Destination</span>
          <span class="v">🌍 ${esc(destination_name)}${country_name ? `, ${esc(country_name)}` : ""}</span>
        </div>
        ${travel_date ? `
        <div class="r">
          <span class="l">Travel Date</span>
          <span class="v">${fmtDate(travel_date)}</span>
        </div>` : ""}
        <div class="r">
          <span class="l">Travelers</span>
          <span class="v">👥 ${esc(String(number_of_travelers))}</span>
        </div>
        <div class="r">
          <span class="l">Status</span>
          <span class="v"><span class="bd b-pending">⏳ Pending Verification</span></span>
        </div>
      </div>

      <!-- Primary CTA -->
      <div style="text-align:center;margin:28px 0 20px">
        <a href="${verifyUrl}" class="btn btn-g"
           style="font-size:15px;padding:16px 36px;border-radius:14px">
          ✅ Confirm My Booking Request
        </a>
      </div>

      <div class="warn">
        <p>
          ⏱ <strong>This link expires in 24 hours.</strong>
          If you didn't make this booking, simply ignore this email —
          no action needed.
        </p>
      </div>

      <div class="div"></div>

      <p style="font-size:12px;color:#94a3b8;text-align:center;line-height:1.6">
        Can't click the button? Copy this link into your browser:<br/>
        <span style="word-break:break-all;color:#059669;font-size:11px">
          ${esc(verifyUrl)}
        </span>
      </p>

      <div class="div"></div>

      <div style="text-align:center">
        <p style="font-size:13px;color:#6B7280;margin-bottom:12px">
          Need help? We're here for you:
        </p>
        <a href="https://wa.me/250788000000" class="btn btn-o"
           style="font-size:13px">
          💬 WhatsApp Support
        </a>
      </div>`,

    footer: "This verification link is valid for 24 hours from the time of your booking request.",
  });

  return sendEmail({
    to:      email,
    subject: `✅ Confirm Your Booking: ${destination_name} | Altuvera Travel`,
    html,
    text: [
      `Hi ${full_name},`,
      ``,
      `Please confirm your booking request by visiting:`,
      verifyUrl,
      ``,
      `Booking: ${booking_number}`,
      `Destination: ${destination_name}`,
      travel_date ? `Travel Date: ${fmtDate(travel_date)}` : "",
      ``,
      `This link expires in 24 hours.`,
      ``,
      `— Altuvera Travel`,
    ].filter(Boolean).join("\n"),
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   2.  sendAdminBookingNotification
       Sent to admin AFTER the user clicks the verification link.
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
  const adminUrl = `${CFG.appUrl}/admin/bookings`;

  const html = shell({
    title:     `🔔 New Verified Booking: ${booking_number}`,
    preheader: `Email verified! New booking from ${full_name} for ${trip}. Awaiting your approval.`,
    body: `
      <h2 class="t1">🔔 New Booking — Email Verified</h2>
      <p class="st">
        The customer has verified their email. This booking is now
        awaiting your <strong>review and approval</strong>.
      </p>

      <!-- Quick stats -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0">
        ${[
          ["Booking #", String(booking_number)],
          ["Travelers", String(number_of_travelers)],
          ["Source",    source],
        ].map(([l, v]) => `
          <div style="flex:1;min-width:100px;text-align:center;padding:12px 8px;
                      background:#f0fdf4;border-radius:10px;border:1px solid #a7f3d0">
            <div style="font-size:14px;font-weight:800;color:#022c22">${esc(v)}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">${esc(l)}</div>
          </div>`
        ).join("")}
      </div>

      <div class="bx">
        <div class="bt">👤 Customer</div>
        <div class="r">
          <span class="l">Name</span>
          <span class="v">${esc(full_name)}</span>
        </div>
        <div class="r">
          <span class="l">Email</span>
          <span class="v">
            <a href="mailto:${esc(email)}" style="color:#059669">${esc(email)}</a>
          </span>
        </div>
        <div class="r">
          <span class="l">Phone</span>
          <span class="v">${esc(String(phone))}</span>
        </div>
        ${wa ? `
        <div class="r">
          <span class="l">WhatsApp</span>
          <span class="v">
            <a href="https://wa.me/${wa}" style="color:#25d366">${esc(whatsapp)}</a>
          </span>
        </div>` : ""}
        ${nationality ? `<div class="r"><span class="l">Nationality</span><span class="v">${esc(nationality)}</span></div>` : ""}
        ${country     ? `<div class="r"><span class="l">Country</span><span class="v">${esc(country)}</span></div>` : ""}
      </div>

      <div class="bx">
        <div class="bt">🗺️ Trip Details</div>
        <div class="r"><span class="l">Type</span><span class="v">${esc(booking_type)}</span></div>
        <div class="r"><span class="l">Destination</span><span class="v">${esc(trip)}</span></div>
        ${travel_date ? `<div class="r"><span class="l">Departure</span><span class="v">${fmtDate(travel_date)}</span></div>` : ""}
        ${return_date ? `<div class="r"><span class="l">Return</span><span class="v">${fmtDate(return_date)}</span></div>` : ""}
        ${flexible_dates ? `<div class="r"><span class="l">Flexible Dates</span><span class="v" style="color:#059669">✓ Yes</span></div>` : ""}
        <div class="r">
          <span class="l">Travelers</span>
          <span class="v">
            ${esc(String(number_of_travelers))} total
            ${number_of_adults ? `(${number_of_adults} adults${number_of_children ? `, ${number_of_children} children` : ""})` : ""}
          </span>
        </div>
        ${accommodation_type    ? `<div class="r"><span class="l">Accommodation</span><span class="v">${esc(accommodation_type)}</span></div>` : ""}
        ${dietary_requirements  ? `<div class="r"><span class="l">Dietary</span><span class="v">${esc(dietary_requirements)}</span></div>` : ""}
        <div class="r">
          <span class="l">Status</span>
          <span class="v"><span class="bd b-pending">⏳ ${esc(status)}</span></span>
        </div>
        <div class="r">
          <span class="l">Submitted</span>
          <span class="v">${fmtDateTime(created_at || new Date())}</span>
        </div>
      </div>

      ${special_requests ? `
      <div class="bx" style="background:#fffbeb;border-color:#fde68a">
        <div class="bt" style="color:#92400e">💬 Special Requests</div>
        <p style="font-size:13px;color:#78350f;margin:0;white-space:pre-wrap">${esc(special_requests)}</p>
      </div>` : ""}

      <div style="text-align:center;margin-top:24px">
        <a href="${adminUrl}" class="btn btn-g">Open Admin Panel →</a>
        <a href="mailto:${esc(email)}" class="btn btn-o">Reply to Customer</a>
        ${wa ? `<a href="https://wa.me/${wa}" class="btn btn-o"
                   style="background:#f0fff4;border-color:#25d366;color:#15803d">
                   WhatsApp
                </a>` : ""}
      </div>`,
  });

  return sendEmail({
    to:      adminEmail,
    replyTo: email,
    subject: `🔔 New Verified Booking: ${booking_number} — ${full_name} → ${trip}`,
    html,
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   3.  sendBookingConfirmation
       Sent to customer when admin APPROVES / CONFIRMS the booking.
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

  const trip    = destination_name || service_name || package_name || "Your Trip";
  const tDate   = travel_date ? new Date(travel_date) : null;
  const countdown = tDate ? humanCountdown(tDate) : null;

  const html = shell({
    title:     `🎉 Booking Confirmed — ${booking_number}`,
    preheader: `Your adventure is confirmed! ${countdown ? `Your trip is ${countdown}.` : ""}`,
    body: `
      <h2 class="t1">🎉 Your Booking is Confirmed!</h2>
      <p class="st">
        Hi <strong>${esc(full_name)}</strong>, wonderful news —
        your safari adventure has been officially confirmed by our team.
        Your journey awaits!
      </p>

      ${countdown && tDate ? `
      <div class="countdown">
        <div class="cd-num">${esc(countdown)}</div>
        <div class="cd-lbl">until your adventure begins</div>
        <div class="cd-msg">
          ✈️ <em>${esc(trip)}</em> is waiting for you —<br/>
          Pack your bags and get ready!
        </div>
      </div>` : ""}

      <div class="bx">
        <div class="bt">📋 Booking Confirmation</div>
        <div class="r">
          <span class="l">Booking #</span>
          <span class="v" style="color:#059669;font-family:monospace;font-size:14px">${esc(String(booking_number))}</span>
        </div>
        <div class="r">
          <span class="l">Status</span>
          <span class="v"><span class="bd b-confirmed">✓ Confirmed</span></span>
        </div>
        <div class="r">
          <span class="l">Destination</span>
          <span class="v">🌍 ${esc(trip)}${country_name ? `, ${esc(country_name)}` : ""}</span>
        </div>
        ${travel_date ? `<div class="r"><span class="l">Departure</span><span class="v">${fmtDate(travel_date)}</span></div>` : ""}
        ${return_date ? `<div class="r"><span class="l">Return</span><span class="v">${fmtDate(return_date)}</span></div>` : ""}
        ${accommodation_type ? `<div class="r"><span class="l">Accommodation</span><span class="v">${esc(accommodation_type)}</span></div>` : ""}
        <div class="r">
          <span class="l">Travelers</span>
          <span class="v">👥 ${esc(String(number_of_travelers))}</span>
        </div>
        ${confirmation_code ? `
        <div class="r">
          <span class="l">Confirmation Code</span>
          <span class="v" style="font-family:monospace;color:#059669">${esc(confirmation_code)}</span>
        </div>` : ""}
      </div>

      ${special_requests ? `
      <div class="bx" style="background:#fffbeb;border-color:#fde68a">
        <div class="bt" style="color:#92400e">💬 Your Special Requests — Noted</div>
        <p style="font-size:13px;color:#78350f;margin:0">${esc(special_requests)}</p>
      </div>` : ""}

      <div class="div"></div>

      <div style="background:#f0fdf4;border-radius:11px;padding:16px 18px;
                  border-left:4px solid #059669;margin:16px 0">
        <div class="bt">✅ What Happens Next?</div>
        <ol style="margin:0;padding-left:16px;font-size:13px;color:#374151;line-height:2.1">
          <li>Your dedicated safari coordinator will reach out within 24 hours</li>
          <li>You'll receive a detailed itinerary and pre-departure briefing</li>
          <li>We'll send daily countdown reminders as your trip approaches</li>
          <li>Arrive, explore, and create memories that last a lifetime 🦁</li>
        </ol>
      </div>

      <div style="text-align:center;margin-top:24px">
        <a href="${CFG.appUrl}/my-bookings" class="btn btn-g">View My Booking</a>
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">Contact Support</a>
      </div>`,
  });

  return sendEmail({
    to:      email,
    subject: `✅ Confirmed: ${booking_number} — ${trip} | Altuvera Travel`,
    html,
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   4.  sendBookingStatusUpdate  (on-hold, completed, etc.)
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
    pending:   "Your booking is back under review. We'll be in touch shortly.",
    confirmed: "Wonderful! Your booking has been confirmed. Get ready for an incredible adventure!",
    "on-hold": "Your booking is on hold. Our team will contact you with further details.",
    completed: "Your safari journey is complete. We hope it was truly extraordinary! 🌟",
    refunded:  "Your refund has been processed. Please allow 5–10 business days.",
  };

  const html = shell({
    title:     `Booking Update — ${booking_number}`,
    preheader: `Your booking ${booking_number} is now: ${newStatus}.`,
    body: `
      <h2 class="t1">🔄 Booking Status Updated</h2>
      <p class="st">Hi ${esc(full_name)}, here's the latest update on your booking.</p>

      <div class="bx">
        <div class="bt">📋 Status Change</div>
        <div class="r">
          <span class="l">Booking #</span>
          <span class="v" style="font-family:monospace">${esc(String(booking_number))}</span>
        </div>
        <div class="r">
          <span class="l">Destination</span>
          <span class="v">${esc(destination_name)}</span>
        </div>
        ${travel_date ? `<div class="r"><span class="l">Travel Date</span><span class="v">${fmtDate(travel_date)}</span></div>` : ""}
        <div class="r">
          <span class="l">Previous Status</span>
          <span class="v"><span class="bd ${badgeCls(oldStatus)}">${esc(labels[oldStatus] || oldStatus)}</span></span>
        </div>
        <div class="r">
          <span class="l">New Status</span>
          <span class="v"><span class="bd ${badgeCls(newStatus)}">${esc(labels[newStatus] || newStatus)}</span></span>
        </div>
      </div>

      <div class="info">
        <p>ℹ️ ${esc(messages[newStatus] || "Your booking has been updated.")}</p>
      </div>

      ${reason ? `
      <div class="warn">
        <p>📝 <strong>Note from our team:</strong> ${esc(reason)}</p>
      </div>` : ""}

      <div style="text-align:center;margin-top:22px">
        <a href="${CFG.appUrl}/my-bookings" class="btn btn-g">View My Booking</a>
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">Get Help</a>
      </div>`,
  });

  return sendEmail({
    to:      email,
    subject: `🔄 Booking Update: ${booking_number} — Now ${newStatus} | Altuvera Travel`,
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

  const html = shell({
    title:     `Booking Cancelled — ${booking_number}`,
    preheader: `Your booking ${booking_number} has been cancelled.`,
    body: `
      <h2 class="t1">❌ Booking Cancelled</h2>
      <p class="st">
        Hi ${esc(full_name)}, we're sorry to let you know that
        your booking has been cancelled. We hope to welcome you
        on a future adventure!
      </p>

      <div class="bx" style="background:#fff1f2;border-color:#fca5a5">
        <div class="bt" style="color:#991b1b">📋 Cancelled Booking</div>
        <div class="r">
          <span class="l">Booking #</span>
          <span class="v" style="font-family:monospace">${esc(String(booking_number))}</span>
        </div>
        <div class="r">
          <span class="l">Status</span>
          <span class="v"><span class="bd b-cancelled">✗ Cancelled</span></span>
        </div>
        <div class="r">
          <span class="l">Destination</span>
          <span class="v">${esc(destination_name)}${country_name ? `, ${esc(country_name)}` : ""}</span>
        </div>
        ${travel_date ? `<div class="r"><span class="l">Was Planned For</span><span class="v">${fmtDate(travel_date)}</span></div>` : ""}
        ${reason ? `<div class="r"><span class="l">Reason</span><span class="v">${esc(reason)}</span></div>` : ""}
      </div>

      <div class="info">
        <p>
          💳 If a payment was made, refunds are processed within
          <strong>5–10 business days</strong>.
        </p>
      </div>

      <div class="div"></div>

      <p style="font-size:13px;color:#64748b;text-align:center;margin:14px 0">
        Africa will be here whenever you're ready. We'd love to plan
        your next adventure! 🌍
      </p>

      <div style="text-align:center;margin-top:20px">
        <a href="${CFG.appUrl}/destinations" class="btn btn-g">Browse Destinations</a>
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">Contact Us</a>
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
       Called by the daily scheduler for confirmed bookings.
       Sends personalised countdown emails until departure day.
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

  /* ── Dynamic messaging based on how far away the trip is ── */
  let headline, subline, tips = [];

  if (diffDays === 0) {
    headline = "🎉 Today Is The Day!";
    subline  = "Your African adventure begins TODAY. Safe travels and enjoy every magical moment!";
    tips     = [
      "Double-check you have your passport and travel documents",
      "Arrive at the airport at least 3 hours early for international flights",
      "Charge all your devices — you'll want to capture every moment",
      "Most importantly — savour every second. Africa will take your breath away 🦁",
    ];
  } else if (diffDays === 1) {
    headline = "✈️ Tomorrow Is The Big Day!";
    subline  = "You leave tomorrow! Time to do your final checks and get excited.";
    tips     = [
      "Lay out everything you need the night before",
      "Confirm your transfer and accommodation details",
      "Get a good night's sleep — adventure awaits!",
    ];
  } else if (diffDays <= 7) {
    headline = `🌟 Only ${diffDays} Days To Go!`;
    subline  = `Your ${trip} experience is almost here. This is the week to get everything ready!`;
    tips     = [
      "Finalise your packing list",
      "Check visa and vaccination requirements",
      "Download offline maps for your destination",
      "Notify your bank of international travel",
    ];
  } else if (diffDays <= 30) {
    headline = `🦁 Your Safari Is ${countdown}`;
    subline  = `Less than a month to go! Here's how to make the most of your final preparations.`;
    tips     = [
      "Book any internal transfers or domestic flights",
      "Shop for any gear you might still need (binoculars, sunscreen, layers)",
      "Read up on the wildlife and culture you'll experience",
      "Share your itinerary with family or friends",
    ];
  } else if (diffDays <= 90) {
    headline = `🌍 Your Adventure Awaits — ${countdown}`;
    subline  = `You're getting closer! Here are some things to take care of in the coming weeks.`;
    tips     = [
      "Confirm all accommodation and activity bookings",
      "Arrange travel insurance if you haven't already",
      "Apply for any required visas",
      "Start researching local customs and etiquette",
    ];
  } else {
    headline = `🗺️ The Countdown Has Begun — ${countdown}`;
    subline  = `Your ${trip} adventure is on the horizon. Here's how to plan ahead for an unforgettable experience.`;
    tips     = [
      "Mark your travel dates in your calendar",
      "Set a savings goal for personal expenses and tips",
      "Start a packing list — better early than rushed",
      "Follow Altuvera Travel for destination inspiration and tips",
    ];
  }

  const html = shell({
    title:     `${headline} | ${trip}`,
    preheader: `${countdown} until your ${trip} adventure! ${subline}`,
    body: `
      <h2 class="t1">${headline}</h2>
      <p class="st">Hi <strong>${esc(full_name)}</strong>, ${esc(subline)}</p>

      <!-- Countdown display -->
      <div class="countdown">
        <div class="cd-num">${esc(countdown)}</div>
        <div class="cd-lbl">until your departure</div>
        <div class="cd-msg">
          ✈️ <strong>${esc(trip)}</strong>
          ${country_name ? `· ${esc(country_name)}` : ""}<br/>
          <span style="font-size:13px;opacity:.7">${fmtDate(travel_date)}</span>
        </div>
      </div>

      <!-- Booking summary -->
      <div class="bx">
        <div class="bt">📋 Your Trip</div>
        <div class="r">
          <span class="l">Booking Ref</span>
          <span class="v" style="font-family:monospace;color:#059669">${esc(String(booking_number))}</span>
        </div>
        <div class="r">
          <span class="l">Destination</span>
          <span class="v">🌍 ${esc(trip)}${country_name ? `, ${esc(country_name)}` : ""}</span>
        </div>
        <div class="r">
          <span class="l">Departure</span>
          <span class="v">${fmtDate(travel_date)}</span>
        </div>
        <div class="r">
          <span class="l">Travelers</span>
          <span class="v">👥 ${esc(String(number_of_travelers))}</span>
        </div>
      </div>

      ${tips.length ? `
      <!-- Tips section -->
      <div class="bx" style="background:#fff;border-color:#a7f3d0">
        <div class="bt">💡 Preparation Tips</div>
        <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:2">
          ${tips.map(t => `<li>${esc(t)}</li>`).join("")}
        </ul>
      </div>` : ""}

      <div class="div"></div>

      <div style="text-align:center;margin-top:20px">
        <a href="${CFG.appUrl}/my-bookings" class="btn btn-g">View My Booking</a>
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">Contact Your Coordinator</a>
      </div>

      <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px">
        You'll receive daily countdown updates until your departure day. 🌿
      </p>`,

    footer: `To stop receiving countdown emails, reply with "unsubscribe countdown" to ${CFG.supportEmail}.`,
  });

  return sendEmail({
    to:      email,
    subject: `${headline} — ${trip} | Altuvera Travel`,
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