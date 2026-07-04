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
    address: process.env.SMTP_USER  || "altuverasafari@gmail.com",
  },
  adminEmail:   process.env.ADMIN_EMAIL   || "altuverasafari@gmail.com",
  supportEmail: process.env.SUPPORT_EMAIL || "altuverasafari@gmail.com",
  replyTo:      process.env.SUPPORT_EMAIL || "altuverasafari@gmail.com",
  appName:      process.env.APP_NAME      || "Altuvera Travel",
  appUrl:       process.env.FRONTEND_URL  || "https://altuvera.vercel.app",
  isDev:        process.env.NODE_ENV      !== "production",
};

/* ── lazy SMTP transporter ── */
let _smtp = null;
function getSmtp() {
  if (_smtp) return _smtp;
  if (!CFG.smtp.user || !CFG.smtp.pass) return null;
  try {
    const nodemailer = require("nodemailer");
    _smtp = nodemailer.createTransport({
      host: CFG.smtp.host, port: CFG.smtp.port, secure: CFG.smtp.secure,
      auth: { user: CFG.smtp.user, pass: CFG.smtp.pass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 8000,
    });
    console.log("[Email] SMTP ready");
    return _smtp;
  } catch (e) {
    console.warn("[Email] SMTP init failed:", e.message);
    return null;
  }
}

/* ── utilities ── */
function stripHtml(h = "") {
  return h.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}
function esc(s = "") {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US",{
      weekday:"long", year:"numeric", month:"long", day:"numeric"
    });
  } catch { return String(d); }
}
function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-US",{
      year:"numeric", month:"short", day:"numeric",
      hour:"2-digit", minute:"2-digit"
    });
  } catch { return String(d); }
}
function badgeCls(s) {
  return ({ pending:"b-pending", confirmed:"b-confirmed",
            cancelled:"b-cancelled", completed:"b-completed",
            "on-hold":"b-hold", refunded:"b-confirmed" })[s] || "b-pending";
}

/* ══════════════════════════════════════════════════════
   CORE sendEmail  —  Resend → SMTP → console
══════════════════════════════════════════════════════ */
async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!to || !subject || (!html && !text))
    throw new Error("sendEmail: to, subject, html/text required");

  const plain = text || stripHtml(html);

  /* 1 — Resend */
  if (CFG.resendApiKey) {
    const fromAddr = `${CFG.from.name} <onboarding@resend.dev>`;
    const body = {
      from: fromAddr,
      to:   Array.isArray(to) ? to : [to],
      subject,
      html: html || `<pre>${plain}</pre>`,
      text: plain,
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
    if (!res.ok) throw new Error(`Resend ${res.status}: ${json?.message || JSON.stringify(json)}`);
    console.log(`[Email] Resend → ${to} id:${json.id}`);
    return { success:true, provider:"resend", messageId:json.id };
  }

  /* 2 — SMTP */
  const smtp = getSmtp();
  if (smtp) {
    const info = await smtp.sendMail({
      from:    `"${CFG.from.name}" <${CFG.from.address}>`,
      to, subject, html, text: plain,
      replyTo: replyTo || CFG.replyTo,
    });
    console.log(`[Email] SMTP → ${to} msgId:${info.messageId}`);
    return { success:true, provider:"smtp", messageId:info.messageId };
  }

  /* 3 — Console fallback */
  console.log(`\n${"═".repeat(55)}`);
  console.log(`[Email] CONSOLE FALLBACK`);
  console.log(`  TO:      ${to}`);
  console.log(`  SUBJECT: ${subject}`);
  console.log(`  PREVIEW: ${plain.slice(0,200)}`);
  console.log(`${"═".repeat(55)}\n`);
  return { success:true, provider:"console", messageId:`console-${Date.now()}` };
}

/* ══════════════════════════════════════════════════════
   BASE HTML TEMPLATE
══════════════════════════════════════════════════════ */
function tpl({ title, preheader="", body, footer="" }) {
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
   padding:30px 26px;text-align:center}
.hl{font-size:22px;font-weight:800;color:#fff;letter-spacing:-.02em}
.hl em{color:#34d399;font-style:normal}
.hs{color:rgba(255,255,255,.6);font-size:12px;margin-top:3px}
.b{padding:30px 26px}
.t1{font-size:20px;font-weight:700;color:#022c22;margin-bottom:4px;line-height:1.3}
.st{color:#64748b;font-size:13.5px;margin-bottom:22px}
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
.btn{display:inline-block;padding:11px 24px;border-radius:10px;
     text-decoration:none;font-weight:700;font-size:13px;margin:4px 3px}
.btn-g{background:linear-gradient(135deg,#10b981,#059669);color:#fff;
       box-shadow:0 4px 12px rgba(5,150,105,.28)}
.btn-o{border:1.5px solid #059669;color:#059669;background:#f0fdf4}
.warn{background:#fffbeb;border-radius:10px;padding:13px 17px;
      border:1px solid #fde68a;margin:14px 0}
.warn p{font-size:13px;color:#92400e;margin:0}
.info{background:#eff6ff;border-radius:10px;padding:13px 17px;
      border:1px solid #bfdbfe;margin:14px 0}
.info p{font-size:13px;color:#1e40af;margin:0}
.div{height:1px;background:linear-gradient(90deg,transparent,#d1fae5,transparent);margin:22px 0}
.otp{font-size:36px;font-weight:900;letter-spacing:10px;color:#022c22;
     text-align:center;padding:16px;background:#f0fdf4;border-radius:12px;
     border:2px dashed #a7f3d0;font-family:'Courier New',monospace;margin:18px 0}
.ft{padding:20px 26px;text-align:center;background:#f8fafb;border-top:1px solid #e2e8f0}
.ft p{font-size:11px;color:#94a3b8;line-height:1.7;margin-bottom:2px}
.ft a{color:#059669;text-decoration:none;font-weight:600}
@media(max-width:480px){.b,.h,.ft{padding:20px 16px}
.r{flex-direction:column;gap:1px}.v{text-align:left}}
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

/* ══════════════════════════════════════════════════════
   1.  sendVerificationCode
       → bookingsController.sendOtp
══════════════════════════════════════════════════════ */
async function sendVerificationCode(email, code, firstName) {
  if (!email) throw new Error("sendVerificationCode: email required");
  if (!code)  throw new Error("sendVerificationCode: code required");

  const name = firstName || "Explorer";

  const html = tpl({
    title:     "Your Altuvera Verification Code",
    preheader: `Your code is ${code} — valid for 10 minutes.`,
    body: `
      <h2 class="t1">🔐 Email Verification</h2>
      <p class="st">
        Hi ${esc(name)}, enter the code below to verify your email
        and complete your booking.
      </p>
      <div class="otp">${esc(String(code))}</div>
      <div class="warn">
        <p>⏱ Expires in <strong>10 minutes</strong>.
           Do not share this code with anyone.</p>
      </div>
      <div class="div"></div>
      <p style="font-size:13px;color:#64748b;text-align:center">
        Didn't request this? You can safely ignore this email.
      </p>`,
    footer: "Security: Altuvera will never ask for your code by phone or chat.",
  });

  return sendEmail({
    to:      email,
    subject: `${code} — Your Altuvera Verification Code`,
    html,
    text:    `Your Altuvera verification code is: ${code}\n\nExpires in 10 minutes.\nDo not share this code.`,
  });
}

/* ══════════════════════════════════════════════════════
   2.  sendBookingConfirmation
       → bookingsController.updateStatus (confirmed)
══════════════════════════════════════════════════════ */
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

  if (!email) {
    console.warn("[Email] sendBookingConfirmation: no email");
    return { success:false, reason:"no_email" };
  }

  const trip = destination_name || service_name || package_name || "Your Trip";

  const html = tpl({
    title:     `Booking Confirmed — ${booking_number}`,
    preheader: `🎉 Your booking ${booking_number} is confirmed! Get ready for ${trip}.`,
    body: `
      <h2 class="t1">🎉 Booking Confirmed!</h2>
      <p class="st">
        Hi ${esc(full_name)}, your adventure is officially booked.
        We can't wait to welcome you!
      </p>
      <div class="bx">
        <div class="bt">📋 Booking Details</div>
        <div class="r">
          <span class="l">Booking #</span>
          <span class="v" style="color:#059669;font-family:monospace;font-size:14px">
            ${esc(String(booking_number))}
          </span>
        </div>
        <div class="r">
          <span class="l">Status</span>
          <span class="v"><span class="bd b-confirmed">✓ Confirmed</span></span>
        </div>
        <div class="r">
          <span class="l">Destination</span>
          <span class="v">🌍 ${esc(trip)}${country_name ? `, ${esc(country_name)}`:""}</span>
        </div>
        ${travel_date ? `
        <div class="r">
          <span class="l">Departure</span>
          <span class="v">${fmtDate(travel_date)}</span>
        </div>` : ""}
        ${return_date ? `
        <div class="r">
          <span class="l">Return</span>
          <span class="v">${fmtDate(return_date)}</span>
        </div>` : ""}
        ${accommodation_type ? `
        <div class="r">
          <span class="l">Accommodation</span>
          <span class="v">${esc(accommodation_type)}</span>
        </div>` : ""}
        <div class="r">
          <span class="l">Travelers</span>
          <span class="v">👥 ${esc(String(number_of_travelers))}</span>
        </div>
        ${confirmation_code ? `
        <div class="r">
          <span class="l">Confirmation Code</span>
          <span class="v" style="font-family:monospace;color:#059669">
            ${esc(confirmation_code)}
          </span>
        </div>` : ""}
      </div>
      ${special_requests ? `
      <div class="bx" style="background:#fffbeb;border-color:#fde68a">
        <div class="bt" style="color:#92400e">💬 Special Requests Noted</div>
        <p style="font-size:13px;color:#78350f;margin:0">${esc(special_requests)}</p>
      </div>` : ""}
      <div class="div"></div>
      <div style="background:#f0fdf4;border-radius:11px;padding:16px 18px;
                  border-left:4px solid #059669;margin:16px 0">
        <div class="bt">✅ What Happens Next?</div>
        <ol style="margin:0;padding-left:16px;font-size:13px;color:#374151;line-height:2.1">
          <li>Your safari coordinator will email you within 24 hours</li>
          <li>You'll receive a detailed itinerary and pre-departure guide</li>
          <li>We'll send travel tips for your destination</li>
          <li>Arrive, explore, and create lifelong memories 🦁</li>
        </ol>
      </div>
      <div style="text-align:center;margin-top:22px">
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

/* ══════════════════════════════════════════════════════
   3.  sendBookingStatusUpdate
       → bookingsController.updateStatus (other statuses)
══════════════════════════════════════════════════════ */
async function sendBookingStatusUpdate(booking, oldStatus, newStatus, reason) {
  const {
    email,
    full_name        = "Valued Guest",
    booking_number   = booking.id || "N/A",
    destination_name = booking.service_name || booking.package_name || "Your Trip",
    travel_date,
  } = booking;

  if (!email) return { success:false, reason:"no_email" };

  const labels = {
    pending:"⏳ Pending", confirmed:"✅ Confirmed", "on-hold":"⏸ On Hold",
    completed:"🏁 Completed", cancelled:"❌ Cancelled", refunded:"💳 Refunded",
  };
  const messages = {
    pending:   "Your booking is back under review. We'll be in touch soon.",
    confirmed: "Great news — your booking has been confirmed!",
    "on-hold": "Your booking is on hold. Please contact us for details.",
    completed: "Your trip is complete. We hope it was extraordinary! 🌟",
    refunded:  "Your refund has been processed. Allow 5–10 business days.",
  };

  const html = tpl({
    title:     `Booking Update — ${booking_number}`,
    preheader: `Your booking ${booking_number} status is now: ${newStatus}.`,
    body: `
      <h2 class="t1">🔄 Booking Status Updated</h2>
      <p class="st">Hi ${esc(full_name)}, here's an update on your booking.</p>
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
        ${travel_date ? `
        <div class="r">
          <span class="l">Travel Date</span>
          <span class="v">${fmtDate(travel_date)}</span>
        </div>` : ""}
        <div class="r">
          <span class="l">Previous</span>
          <span class="v">
            <span class="bd ${badgeCls(oldStatus)}">${esc(labels[oldStatus]||oldStatus)}</span>
          </span>
        </div>
        <div class="r">
          <span class="l">New Status</span>
          <span class="v">
            <span class="bd ${badgeCls(newStatus)}">${esc(labels[newStatus]||newStatus)}</span>
          </span>
        </div>
      </div>
      <div class="info">
        <p>ℹ️ ${esc(messages[newStatus]||"Your booking has been updated.")}</p>
      </div>
      ${reason ? `
      <div class="warn">
        <p>📝 <strong>Note:</strong> ${esc(reason)}</p>
      </div>` : ""}
      <div style="text-align:center;margin-top:22px">
        <a href="${CFG.appUrl}/my-bookings" class="btn btn-g">View Booking</a>
        <a href="mailto:${CFG.supportEmail}" class="btn btn-o">Get Help</a>
      </div>`,
  });

  return sendEmail({
    to:      email,
    subject: `🔄 Booking ${booking_number} → ${newStatus} | Altuvera Travel`,
    html,
  });
}

/* ══════════════════════════════════════════════════════
   4.  sendBookingCancellation
       → bookingsController.updateStatus (cancelled)
══════════════════════════════════════════════════════ */
async function sendBookingCancellation(booking, reason) {
  const {
    email,
    full_name        = "Valued Guest",
    booking_number   = booking.id || "N/A",
    destination_name = booking.service_name || booking.package_name || "Your Trip",
    country_name,
    travel_date,
  } = booking;

  if (!email) return { success:false, reason:"no_email" };

  const html = tpl({
    title:     `Booking Cancelled — ${booking_number}`,
    preheader: `Your booking ${booking_number} has been cancelled.`,
    body: `
      <h2 class="t1">❌ Booking Cancelled</h2>
      <p class="st">
        Hi ${esc(full_name)}, your booking has been cancelled.
        We're sorry it didn't work out this time.
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
          <span class="v">${esc(destination_name)}${country_name?`, ${esc(country_name)}`:""}</span>
        </div>
        ${travel_date ? `
        <div class="r">
          <span class="l">Was Planned For</span>
          <span class="v">${fmtDate(travel_date)}</span>
        </div>` : ""}
        ${reason ? `
        <div class="r">
          <span class="l">Reason</span>
          <span class="v">${esc(reason)}</span>
        </div>` : ""}
      </div>
      <div class="info">
        <p>
          💳 If a payment was made, refunds are processed within
          <strong>5–10 business days</strong> to your original payment method.
        </p>
      </div>
      <div class="div"></div>
      <p style="font-size:13px;color:#64748b;text-align:center;margin:14px 0">
        We hope to welcome you on a future adventure! 🌍
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

/* ══════════════════════════════════════════════════════
   5.  sendAdminBookingNotification
       → bookingsController.create
══════════════════════════════════════════════════════ */
async function sendAdminBookingNotification(booking) {
  const adminEmail = CFG.adminEmail;
  if (!adminEmail) {
    console.warn("[Email] sendAdminBookingNotification: ADMIN_EMAIL not set");
    return { success:false, reason:"no_admin_email" };
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

  const html = tpl({
    title:     `New Booking: ${booking_number}`,
    preheader: `New ${booking_type} booking from ${full_name} for ${trip}`,
    body: `
      <h2 class="t1">🔔 New Booking Received</h2>
      <p class="st">A new booking has been submitted and needs your attention.</p>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0">
        ${[["Booking #",String(booking_number)],["Travelers",String(number_of_travelers)],["Source",source]]
          .map(([l,v])=>`
          <div style="flex:1;min-width:110px;text-align:center;padding:12px 8px;
                      background:#f0fdf4;border-radius:10px;border:1px solid #a7f3d0">
            <div style="font-size:13px;font-weight:800;color:#022c22">${esc(v)}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">${esc(l)}</div>
          </div>`).join("")}
      </div>

      <div class="bx">
        <div class="bt">👤 Customer</div>
        <div class="r"><span class="l">Name</span><span class="v">${esc(full_name)}</span></div>
        <div class="r">
          <span class="l">Email</span>
          <span class="v">
            <a href="mailto:${esc(email)}" style="color:#059669">${esc(email)}</a>
          </span>
        </div>
        <div class="r"><span class="l">Phone</span><span class="v">${esc(String(phone))}</span></div>
        ${wa ? `
        <div class="r">
          <span class="l">WhatsApp</span>
          <span class="v">
            <a href="https://wa.me/${wa}" style="color:#25d366">${esc(whatsapp)}</a>
          </span>
        </div>` : ""}
        ${nationality?`<div class="r"><span class="l">Nationality</span><span class="v">${esc(nationality)}</span></div>`:""}
        ${country?`<div class="r"><span class="l">Country</span><span class="v">${esc(country)}</span></div>`:""}
      </div>

      <div class="bx">
        <div class="bt">🗺️ Trip</div>
        <div class="r"><span class="l">Type</span><span class="v">${esc(booking_type)}</span></div>
        <div class="r"><span class="l">Destination</span><span class="v">${esc(trip)}</span></div>
        ${travel_date?`<div class="r"><span class="l">Departure</span><span class="v">${fmtDate(travel_date)}</span></div>`:""}
        ${return_date?`<div class="r"><span class="l">Return</span><span class="v">${fmtDate(return_date)}</span></div>`:""}
        ${flexible_dates?`<div class="r"><span class="l">Flexible Dates</span><span class="v" style="color:#059669">✓ Yes</span></div>`:""}
        <div class="r">
          <span class="l">Travelers</span>
          <span class="v">
            ${esc(String(number_of_travelers))} total
            ${number_of_adults?`(${number_of_adults} adults${number_of_children?`, ${number_of_children} children`:""})`:""}
          </span>
        </div>
        ${accommodation_type?`<div class="r"><span class="l">Accommodation</span><span class="v">${esc(accommodation_type)}</span></div>`:""}
        ${dietary_requirements?`<div class="r"><span class="l">Dietary</span><span class="v">${esc(dietary_requirements)}</span></div>`:""}
        <div class="r">
          <span class="l">Status</span>
          <span class="v"><span class="bd b-pending">⏳ ${esc(status)}</span></span>
        </div>
        <div class="r">
          <span class="l">Submitted</span>
          <span class="v">${fmtDateTime(created_at||new Date())}</span>
        </div>
      </div>

      ${special_requests?`
      <div class="bx" style="background:#fffbeb;border-color:#fde68a">
        <div class="bt" style="color:#92400e">💬 Special Requests</div>
        <p style="font-size:13px;color:#78350f;margin:0;white-space:pre-wrap">
          ${esc(special_requests)}
        </p>
      </div>`:""}

      <div style="text-align:center;margin-top:22px">
        <a href="${CFG.appUrl}/admin/bookings" class="btn btn-g">Open Admin</a>
        <a href="mailto:${esc(email)}" class="btn btn-o">Reply to Customer</a>
        ${wa?`<a href="https://wa.me/${wa}" class="btn btn-o"
               style="background:#f0fff4;border-color:#25d366;color:#15803d">
               WhatsApp</a>`:""}
      </div>`,
  });

  return sendEmail({
    to:      adminEmail,
    replyTo: email,
    subject: `🔔 New Booking: ${booking_number} — ${full_name} → ${trip}`,
    html,
  });
}

/* ══════════════════════════════════════════════════════
   VERIFY CONNECTION
══════════════════════════════════════════════════════ */
async function verifyConnection() {
  if (CFG.resendApiKey) {
    try {
      const r = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${CFG.resendApiKey}` },
      });
      if (r.ok) { console.log("[Email] ✅ Resend verified"); return true; }
    } catch (e) { console.warn("[Email] Resend check failed:", e.message); }
  }
  const s = getSmtp();
  if (s) {
    try {
      await s.verify();
      console.log("[Email] ✅ SMTP verified");
      return true;
    } catch (e) { console.warn("[Email] SMTP check failed:", e.message); }
  }
  console.warn("[Email] ⚠️ No provider verified — console fallback active");
  return false;
}

/* ══════════════════════════════════════════════════════
   EXPORTS  —  exact match to bookingsController imports
══════════════════════════════════════════════════════ */
module.exports = {
  sendVerificationCode,
  sendBookingConfirmation,
  sendBookingStatusUpdate,
  sendBookingCancellation,
  sendAdminBookingNotification,
  sendEmail,
  verifyConnection,
};
