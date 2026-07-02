// utils/email.js — Unified SMTP sender with forced IPv4 DNS resolution
"use strict";

const nodemailer = require("nodemailer");
const dns        = require("dns").promises;
const logger     = require("./logger");
const { send: sendGridSend } = require("./sendgrid");
const { send: sendResendSend } = require("./resend");

/* ── Env constants ─────────────────────────────────────────────────────── */
const APP_NAME      = process.env.APP_NAME      || "Altuvera";
const FRONTEND_URL  = process.env.FRONTEND_URL  || "https://altuvera.vercel.app";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || process.env.SMTP_USER || "altuverasafari@gmail.com";
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL   || process.env.SMTP_USER || "altuverasafari@gmail.com";
const FROM_ADDRESS  = process.env.SMTP_FROM     || `"${APP_NAME}" <${process.env.SMTP_USER || SUPPORT_EMAIL}>`;
const YEAR          = new Date().getFullYear();

/* ── Transporter singleton ─────────────────────────────────────────────── */
let _transporter = null;
let _smtpIp      = null;
let _smtpIpExp   = 0;

const assertSmtpConfig = () => {
  const missing = ["SMTP_USER", "SMTP_PASS"].filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`[Email] Missing SMTP env vars: ${missing.join(", ")}`);
  }
};

/**
 * Resolve smtp.gmail.com to an IPv4 address explicitly.
 * Caches result for 1 hour. Fixes Render's IPv6 unreachable issue.
 */
const resolveSmtpHostV4 = async () => {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";

  if (_smtpIp && Date.now() < _smtpIpExp) return _smtpIp;

  const addresses = await dns.resolve4(host);
  if (!addresses.length) throw new Error(`No IPv4 for ${host}`);

  _smtpIp    = addresses[0];
  _smtpIpExp = Date.now() + 3600_000;
  logger.info(`[Email] Resolved ${host} → ${_smtpIp} (IPv4)`);
  return _smtpIp;
};

const buildTransporter = async () => {
  assertSmtpConfig();

  const port   = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = port === 465;
  const host   = process.env.SMTP_HOST || "smtp.gmail.com";

  const ipv4Host = await resolveSmtpHostV4();

  return nodemailer.createTransport({
    host:   ipv4Host,                // connect to IP directly — no DNS lookup
    port,
    secure,
    name:   "altuvera-backend",      // EHLO name
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    family: 4,
    tls: {
      servername: host,              // for cert validation against smtp.gmail.com
      rejectUnauthorized: process.env.NODE_ENV === "production",
      minVersion: "TLSv1.2",
    },
    pool:              true,
    maxConnections:    3,
    maxMessages:       100,
    rateDelta:         1000,
    rateLimit:         5,
    connectionTimeout: 30_000,
    greetingTimeout:   15_000,
    socketTimeout:     45_000,
  });
};

const getTransporter = async () => {
  if (_transporter) return _transporter;
  _transporter = await buildTransporter();
  return _transporter;
};

const resetTransporter = () => {
  if (_transporter) {
    try { _transporter.close(); } catch (_) {}
  }
  _transporter = null;
};

const verifySmtp = async () => {
  try {
    assertSmtpConfig();
    const t = await getTransporter();
    await t.verify();
    logger.info(
      `[Email] ✅ SMTP ready — ${process.env.SMTP_USER} via ${process.env.SMTP_HOST || "smtp.gmail.com"}:${process.env.SMTP_PORT || 587} (IPv4)`
    );
    return true;
  } catch (err) {
    logger.error(`[Email] ❌ SMTP verify failed: ${err.message}`);
    if (err.code === "EAUTH" || err.responseCode === 535) {
      logger.error("[Email] AUTH FAILURE — check SMTP_USER / SMTP_PASS App Password.");
    }
    resetTransporter();
    return false;
  }
};

/* ── HTML helpers ──────────────────────────────────────────────────────── */
const esc = (str = "") =>
  String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

const htmlToText = (html = "") =>
  html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ").trim().slice(0, 4000);

/* ══════════════════════════════════════════════════════════════════════════
   CORE sendEmail
   ══════════════════════════════════════════════════════════════════════════ */
const sendEmail = async (toOrOpts, subjectArg, htmlArg, optsArg = {}) => {
  let to, subject, html, text, replyTo, cc;

  if (toOrOpts && typeof toOrOpts === "object" && !Array.isArray(toOrOpts)) {
    ({ to, subject, html, text, replyTo, cc } = toOrOpts);
  } else {
    to = toOrOpts; subject = subjectArg; html = htmlArg;
    ({ text, replyTo, cc } = optsArg);
  }

  if (!to)      throw new Error("sendEmail: 'to' is required");
  if (!subject) throw new Error("sendEmail: 'subject' is required");
  if (!html)    throw new Error("sendEmail: 'html' is required");

  const plainText = text || htmlToText(html);
  const RESET_CODES = ["EAUTH", "ECONNECTION", "ETIMEDOUT", "ECONNREFUSED", "ESOCKET", "ENETUNREACH"];

  try {
    if (process.env.SENDGRID_API_KEY) {
      try {
        const result = await sendGridSend({
          to,
          subject,
          html,
          text: plainText,
          ...(cc      ? { cc }      : {}),
          ...(replyTo ? { replyTo } : {}),
        });
        logger.info(`[Email] ✅ SendGrid delivered → ${to} | msgId: ${result.messageId || 'unknown'}`);
        return result;
      } catch (sgErr) {
        logger.warn(`[Email] SendGrid failed, falling back to Resend: ${sgErr.message}`);
      }
    }

    if (process.env.RESEND_API_KEY) {
      try {
        const result = await sendResendSend({
          to,
          subject,
          html,
          text: plainText,
          from: FROM_ADDRESS,
          ...(cc      ? { cc }      : {}),
          ...(replyTo ? { replyTo } : {}),
        });
        logger.info(`[Email] ✅ Resend delivered → ${to} | msgId: ${result.messageId || 'unknown'}`);
        return result;
      } catch (reErr) {
        logger.warn(`[Email] Resend failed, falling back to SMTP: ${reErr.message}`);
      }
    }

    logger.info(`[Email] Sending via SMTP → ${to} | "${subject}"`);
    const t = await getTransporter();
    const info = await t.sendMail({
      from: FROM_ADDRESS, to, subject, text: plainText, html,
      ...(cc      ? { cc }      : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    logger.info(`[Email] ✅ SMTP delivered → ${to} | msgId: ${info.messageId}`);
    return info;
  } catch (err) {
    logger.error(`[Email] ❌ FAILED → ${to} | ${err.message}`, {
      code: err.code, response: err.response,
    });
    if (RESET_CODES.includes(err.code) || err.responseCode === 535) {
      logger.warn("[Email] Resetting transporter after error");
      resetTransporter();
      _smtpIp = null;
    }
    const friendly = new Error(`Email delivery failed: ${err.message}`);
    friendly.originalError = err;
    throw friendly;
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   BASE TEMPLATE
   ══════════════════════════════════════════════════════════════════════════ */
const baseTemplate = ({
  preheader = "", title = "", subtitle = "", body = "",
  ctaText = "", ctaUrl = "", recipientName = "", footerNote = "",
}) => `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)}</title>
<style>
body,table,td,p,a,li{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0;mso-table-rspace:0;}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
body{margin:0;padding:0;width:100%!important;background:#f0fdf4;
     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;}
.wrapper{width:100%;table-layout:fixed;background:#f0fdf4;padding:40px 0;}
.container{max-width:520px;background:#ffffff;border-radius:20px;
           box-shadow:0 8px 30px rgba(5,150,105,.10);}
.hd{background:linear-gradient(135deg,#064e3b 0%,#047857 100%);
    border-radius:20px 20px 0 0;padding:32px 24px;text-align:center;}
.bd{padding:36px 32px;}
.ft{background:#f9fafb;padding:22px 24px;border-radius:0 0 20px 20px;
    border-top:1px solid #e5e7eb;text-align:center;}
.otp-box{background:#f0fdf4;border:2px solid #6ee7b7;border-radius:16px;
         padding:28px 40px;display:inline-block;}
.otp-code{font-family:'Courier New',monospace;font-size:44px;font-weight:900;
          letter-spacing:14px;color:#047857;display:block;text-align:center;}
.cta-btn{display:inline-block;padding:14px 36px;
         background:linear-gradient(135deg,#059669,#047857);
         color:#ffffff!important;text-decoration:none;border-radius:40px;
         font-size:15px;font-weight:700;}
.warn{background:#fffbeb;border-left:4px solid #f59e0b;
      border-radius:0 10px 10px 0;padding:14px 18px;margin:20px 0 0;}
@media only screen and (max-width:600px){
  .wrapper{padding:0!important;}.container{border-radius:0!important;}
  .bd{padding:24px 16px!important;}
  .otp-code{font-size:32px!important;letter-spacing:8px!important;}
}
</style></head>
<body>
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#f0fdf4;">
${esc(preheader)}
</div>
<div class="wrapper"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<tr><td align="center" style="padding:0 16px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="520" class="container">
  <tr><td class="hd">
    <a href="${FRONTEND_URL}" style="text-decoration:none;">
      <span style="color:#fff;font-size:28px;font-weight:800;">${esc(APP_NAME)}</span>
    </a>
    <p style="color:rgba(255,255,255,.68);margin:6px 0 0;font-size:12px;letter-spacing:2px;text-transform:uppercase;">
      Premium Safari Adventures
    </p>
  </td></tr>
  <tr><td class="bd">
    ${recipientName ? `<p style="margin:0 0 20px;font-size:15px;color:#374151;font-weight:500;">
      Hello, <strong>${esc(recipientName)}</strong> 👋
    </p>` : ""}
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#064e3b;line-height:1.3;">
      ${esc(title)}
    </h1>
    ${subtitle ? `<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.65;">
      ${esc(subtitle)}
    </p>` : ""}
    ${body}
    ${ctaText && ctaUrl ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:28px auto 0;">
      <tr><td align="center"><a href="${esc(ctaUrl)}" class="cta-btn">${esc(ctaText)}</a></td></tr>
    </table>` : ""}
    ${footerNote ? `<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;
      border-top:1px solid #e5e7eb;padding-top:18px;line-height:1.65;">
      ${footerNote}
    </p>` : ""}
  </td></tr>
  <tr><td class="ft">
    <p style="margin:0 0 8px;font-size:12px;">
      <a href="${FRONTEND_URL}" style="color:#6b7280;text-decoration:none;margin:0 8px;">Home</a>
      <span style="color:#d1d5db;">|</span>
      <a href="mailto:${SUPPORT_EMAIL}" style="color:#6b7280;text-decoration:none;margin:0 8px;">Support</a>
    </p>
    <p style="margin:0;font-size:11px;color:#9ca3af;">
      &copy; ${YEAR} ${esc(APP_NAME)}. All rights reserved.
    </p>
  </td></tr>
</table></td></tr></table></div></body></html>`;

/* ══════════════════════════════════════════════════════════════════════════
   OTP TEMPLATE
   ══════════════════════════════════════════════════════════════════════════ */
const OTP_SUBJECTS = {
  verify:         (c) => `${c} — Verify your ${APP_NAME} email`,
  login:          (c) => `${c} — Your ${APP_NAME} sign-in code`,
  resend:         (c) => `${c} — New ${APP_NAME} verification code`,
  reverification: (c) => `${c} — ${APP_NAME} security check`,
  booking:        (c) => `${c} — Confirm your ${APP_NAME} booking`,
};

const OTP_TITLES = {
  verify:         "Verify Your Email Address",
  login:          "Your Sign-In Code",
  resend:         "New Verification Code",
  reverification: "Security Verification Required",
  booking:        "Booking Email Verification",
};

const buildOtpHtml = ({ otp, recipientName = "", purpose = "verify", expiryMinutes = 10 }) =>
  baseTemplate({
    preheader:    `Your ${APP_NAME} code is ${otp} — expires in ${expiryMinutes} minutes`,
    title:        OTP_TITLES[purpose] || OTP_TITLES.verify,
    subtitle:     "Enter the code below to continue. Keep it private.",
    recipientName,
    body: `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
        <tr><td align="center">
          <div class="otp-box">
            <p style="margin:0 0 12px;font-size:11px;font-weight:700;text-transform:uppercase;
                       letter-spacing:2px;color:#6b7280;text-align:center;">Verification Code</p>
            <span class="otp-code">${esc(String(otp))}</span>
            <p style="margin:14px 0 0;font-size:12.5px;color:#9ca3af;text-align:center;">
              Expires in <strong style="color:#374151;">${expiryMinutes} minutes</strong>
            </p>
          </div>
        </td></tr>
      </table>
      <div class="warn">
        <p style="margin:0;font-size:13px;color:#92400e;line-height:1.55;">
          <strong>⚠️ Never share this code.</strong> ${esc(APP_NAME)} staff will never ask for it.
        </p>
      </div>
    `,
    footerNote: `This code is valid for ${expiryMinutes} minutes. Need help? <a href="mailto:${SUPPORT_EMAIL}" style="color:#059669;">${SUPPORT_EMAIL}</a>`,
  });

const buildOtpText = ({ otp, recipientName = "", purpose = "verify", expiryMinutes = 10 }) =>
  [
    `${APP_NAME} — ${OTP_TITLES[purpose] || "Verification"}`,
    "",
    recipientName ? `Hello ${recipientName},` : "Hello,",
    "",
    `Your verification code: ${otp}`,
    "",
    `Expires in ${expiryMinutes} minutes. Do not share this code.`,
    "",
    `— The ${APP_NAME} Team`,
  ].join("\n");

/* ══════════════════════════════════════════════════════════════════════════
   NAMED SEND FUNCTIONS
   ══════════════════════════════════════════════════════════════════════════ */

const sendOtpEmail = async ({ to, otp, recipientName = "", purpose = "verify", expiryMinutes = 10 }) => {
  if (!to)  throw new Error("sendOtpEmail: 'to' is required");
  if (!otp) throw new Error("sendOtpEmail: 'otp' is required");

  const subjectFn = OTP_SUBJECTS[purpose] || OTP_SUBJECTS.verify;
  return sendEmail({
    to,
    subject: subjectFn(otp),
    html:    buildOtpHtml({ otp, recipientName, purpose, expiryMinutes }),
    text:    buildOtpText({ otp, recipientName, purpose, expiryMinutes }),
  });
};

const sendWelcomeEmail = async ({ to, recipientName = "" }) => {
  if (!to) return;
  try {
    await sendEmail({
      to,
      subject: `Welcome to ${APP_NAME}! 🎉`,
      html:    baseTemplate({
        title:    `Welcome to ${APP_NAME}! 🎉`,
        subtitle: "Your account is verified and ready to use.",
        recipientName,
        body:     `<p style="font-size:15px;color:#4b5563;line-height:1.75;">Start exploring our handpicked destinations.</p>`,
        ctaText:  "Start Exploring →",
        ctaUrl:   `${FRONTEND_URL}/destinations`,
      }),
    });
  } catch (err) {
    logger.warn("[Email] sendWelcomeEmail failed (non-critical):", err.message);
  }
};

const sendBookingConfirmation = async (booking) => {
  if (!booking?.email) return;
  try {
    await sendEmail({
      to:      booking.email,
      subject: `✅ Booking Confirmed — Ref ${booking.booking_number} | ${APP_NAME}`,
      html:    baseTemplate({
        title:        "Booking Confirmed! 🎉",
        subtitle:     "Your adventure is booked.",
        recipientName: booking.full_name,
        body:         `<p style="font-size:14px;color:#6b7280;">Ref: <strong>${esc(booking.booking_number)}</strong></p>`,
        ctaText:      "Track My Booking",
        ctaUrl:       `${FRONTEND_URL}/my-bookings`,
      }),
    });
  } catch (err) {
    logger.warn("[Email] sendBookingConfirmation failed:", err.message);
  }
};

const sendBookingStatusUpdate = async (booking, fromStatus, toStatus, reason = "") => {
  if (!booking?.email) return;
  try {
    await sendEmail({
      to:      booking.email,
      subject: `Booking ${toStatus} — ${booking.booking_number} | ${APP_NAME}`,
      html:    baseTemplate({
        title:        `Booking ${toStatus}`,
        subtitle:     reason || `Your booking status has been updated.`,
        recipientName: booking.full_name,
        body:         `<p style="font-size:14px;color:#6b7280;">Ref: <strong>${esc(booking.booking_number)}</strong></p>`,
        ctaText:      "View Booking",
        ctaUrl:       `${FRONTEND_URL}/my-bookings`,
      }),
    });
  } catch (err) {
    logger.warn("[Email] sendBookingStatusUpdate failed:", err.message);
  }
};

const sendBookingCancellation = async (booking, reason = "") =>
  sendBookingStatusUpdate(booking, "confirmed", "cancelled", reason);

const sendAdminBookingNotification = async (booking) => {
  try {
    await sendEmail({
      to:      ADMIN_EMAIL,
      subject: `📋 New Booking ${booking.booking_number} — ${booking.full_name} | ${APP_NAME}`,
      html:    baseTemplate({
        title:        "New Booking Received",
        subtitle:     `From: ${booking.full_name} <${booking.email}>`,
        body:         `<p style="font-size:14px;">Ref: <strong>${esc(booking.booking_number)}</strong></p>`,
      }),
    });
  } catch (err) {
    logger.warn("[Email] sendAdminBookingNotification failed:", err.message);
  }
};

const sendActivityAlert = async ({ to, recipientName = "", activityType }) => {
  if (!to) return;
  try {
    await sendEmail({
      to,
      subject: `Account Activity — ${APP_NAME}`,
      html:    baseTemplate({
        title:        "Account Activity",
        subtitle:     `Activity: ${activityType}`,
        recipientName,
        body:         `<p style="font-size:13.5px;color:#6b7280;">If this wasn't you, contact ${SUPPORT_EMAIL}.</p>`,
      }),
    });
  } catch (err) {
    logger.warn("[Email] sendActivityAlert failed:", err.message);
  }
};

const sendContactNotification = async (message) => {
  return sendEmail({
    to:      ADMIN_EMAIL,
    replyTo: message.email,
    subject: `📬 Contact from ${message.full_name || message.name} — ${APP_NAME}`,
    html:    baseTemplate({
      title:    `New Contact Message`,
      subtitle: `From: ${message.full_name || message.name} <${message.email}>`,
      body:     `<p style="font-size:14px;white-space:pre-wrap;">${esc(message.message || "")}</p>`,
    }),
  });
};

/* ── Test utility ──────────────────────────────────────────────────────── */
const testSmtp = async () => {
  const ok = await verifySmtp();
  if (!ok) return false;
  try {
    await sendEmail({
      to:      ADMIN_EMAIL,
      subject: `[${APP_NAME}] SMTP Test`,
      html:    `<p>SMTP test OK at ${new Date().toUTCString()}</p>`,
    });
    return true;
  } catch (err) {
    return false;
  }
};

/* ── Exports ───────────────────────────────────────────────────────────── */
module.exports = {
  sendEmail,
  verifySmtp,
  testSmtp,
  getTransporter,
  resetTransporter,
  sendOtpEmail,
  sendWelcomeEmail,
  sendActivityAlert,
  sendBookingConfirmation,
  sendBookingStatusUpdate,
  sendBookingCancellation,
  sendAdminBookingNotification,
  sendContactNotification,
  sendContactReply: async (opts) => sendEmail(opts),
  buildOtpHtml,
  buildOtpText,
};