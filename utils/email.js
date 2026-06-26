// utils/email.js
// ═══════════════════════════════════════════════════════════════════════════
// Gmail SMTP Email Service — Nodemailer + Gmail App Password
// IPv4-first guaranteed (server.js sets dns.setDefaultResultOrder ipv4first)
// ═══════════════════════════════════════════════════════════════════════════

"use strict";

const nodemailer = require("nodemailer");
const logger     = require("./logger");

const APP_NAME     = process.env.APP_NAME     || "Altuvera";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://altuvera.com";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || process.env.SMTP_USER;
const FROM_ADDRESS  = process.env.SMTP_FROM
  || `"${APP_NAME}" <${process.env.SMTP_USER}>`;

// ── Transporter (singleton — reused across calls) ─────────────────────────
let _transporter = null;

const getTransporter = () => {
  if (_transporter) return _transporter;

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error(
      "[Email] SMTP_USER and SMTP_PASS must be set in environment variables.",
    );
  }

  _transporter = nodemailer.createTransport({
    service: "gmail",          // uses Gmail's known host/port/TLS settings
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS, // Gmail App Password (16-char, no spaces)
    },
    // Force IPv4 — Render and some cloud hosts resolve IPv6 by default
    // which can cause Gmail SMTP connections to hang or be refused
    family: 4,
    pool: true,                // reuse connections
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,              // max 5 messages/second
    socketTimeout: 15_000,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
  });

  // Verify on first creation (non-blocking — just logs)
  _transporter.verify((err) => {
    if (err) {
      logger.warn("[Email] SMTP connection verify failed:", err.message);
      // Reset so next call retries
      _transporter = null;
    } else {
      logger.info("[Email] ✅ Gmail SMTP transporter ready");
    }
  });

  return _transporter;
};

// ── Core sendEmail ────────────────────────────────────────────────────────
/**
 * Send an email via Gmail SMTP.
 *
 * @param {object} opts
 * @param {string}   opts.to       — recipient email
 * @param {string}   opts.subject  — email subject
 * @param {string}   opts.html     — HTML body
 * @param {string}  [opts.text]    — plain-text fallback (auto-generated if omitted)
 * @param {string}  [opts.from]    — override sender (defaults to FROM_ADDRESS)
 * @param {string}  [opts.replyTo] — reply-to address
 * @returns {Promise<object>}        nodemailer info object
 */
const sendEmail = async ({ to, subject, html, text, from, replyTo } = {}) => {
  if (!to)      throw new Error("sendEmail: 'to' is required");
  if (!subject) throw new Error("sendEmail: 'subject' is required");
  if (!html)    throw new Error("sendEmail: 'html' is required");

  const transporter = getTransporter();

  const mailOptions = {
    from:    from    || FROM_ADDRESS,
    to,
    subject,
    html,
    text:    text    || htmlToPlainText(html),
    replyTo: replyTo || SUPPORT_EMAIL,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info("[Email] ✅ Sent:", {
      to,
      subject,
      messageId: info.messageId,
    });
    return info;
  } catch (err) {
    // Reset transporter on auth/connection errors so next call retries
    if (
      err.code === "EAUTH"         ||
      err.code === "ECONNECTION"   ||
      err.code === "ETIMEDOUT"     ||
      err.responseCode === 535
    ) {
      logger.warn("[Email] Transporter error — resetting:", err.message);
      _transporter = null;
    }
    logger.error("[Email] ❌ Send failed:", { to, subject, error: err.message });
    throw err;
  }
};

// ── HTML → plain text (simple strip) ─────────────────────────────────────
const htmlToPlainText = (html = "") =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 2000);

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

const year = new Date().getFullYear();

const baseTemplate = ({
  preheader = "",
  title     = "",
  subtitle  = "",
  body      = "",
  ctaText   = "",
  ctaUrl    = "",
  recipientName = "",
  footerNote    = "",
}) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escHtml(title)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings>
    <o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
  </noscript><![endif]-->
  <style>
    body,table,td,p,a,li{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    table,td{mso-table-lspace:0;mso-table-rspace:0;}
    img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
    body{margin:0;padding:0;width:100%!important;min-width:100%;
         background:#f4f4f5;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,
                     Helvetica,Arial,sans-serif;}
    .wrapper{width:100%;table-layout:fixed;background:#f4f4f5;padding:40px 0;}
    .container{max-width:520px;background:#ffffff;
               border-radius:20px;
               box-shadow:0 8px 30px rgba(0,0,0,0.07),0 2px 8px rgba(0,0,0,0.04);}
    .header-cell{background:#059669;border-radius:20px 20px 0 0;
                 padding:28px 24px;text-align:center;}
    .body-cell{padding:36px 32px;}
    .footer-cell{background:#f9fafb;padding:22px 24px;
                 border-radius:0 0 20px 20px;
                 border-top:1px solid #e5e7eb;text-align:center;}
    .otp-box{background:#f3f4f6;border-radius:12px;
             padding:18px 28px;display:inline-block;
             margin:0 auto 16px;}
    .otp-code{font-family:'Courier New',Courier,monospace;
              font-size:38px;font-weight:700;
              letter-spacing:10px;color:#059669;
              display:block;text-align:center;}
    .cta-btn{display:inline-block;padding:14px 36px;
             background:#059669;color:#ffffff!important;
             text-decoration:none;border-radius:40px;
             font-size:15px;font-weight:700;
             mso-padding-alt:0;text-align:center;}
    @media only screen and (max-width:600px){
      .wrapper{padding:0!important;}
      .container{border-radius:0!important;
                 box-shadow:none!important;}
      .body-cell{padding:28px 20px!important;}
      .otp-code{font-size:30px!important;letter-spacing:6px!important;}
    }
  </style>
</head>
<body>
  <div style="display:none;max-height:0;overflow:hidden;
              font-size:1px;color:#f4f4f5;line-height:1px;">
    ${escHtml(preheader)}&nbsp;
    ${"&zwnj;&nbsp;".repeat(40)}
  </div>

  <div class="wrapper">
    <table role="presentation" border="0" cellpadding="0"
           cellspacing="0" width="100%">
      <tr><td align="center" style="padding:0 16px;">
        <table role="presentation" border="0" cellpadding="0"
               cellspacing="0" width="520" class="container">

          <!-- HEADER -->
          <tr><td class="header-cell">
            <a href="${FRONTEND_URL}" style="text-decoration:none;">
              <span style="color:#ffffff;font-size:26px;font-weight:800;
                           letter-spacing:-0.5px;">${escHtml(APP_NAME)}</span>
            </a>
          </td></tr>

          <!-- BODY -->
          <tr><td class="body-cell">
            ${recipientName
              ? `<p style="margin:0 0 18px;font-size:15px;color:#374151;font-weight:500;">
                   Hello ${escHtml(recipientName)},
                 </p>`
              : ""}
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;
                        color:#111827;line-height:1.3;">
              ${escHtml(title)}
            </h1>
            ${subtitle
              ? `<p style="margin:0 0 22px;font-size:14px;color:#6b7280;
                           line-height:1.6;">
                   ${escHtml(subtitle)}
                 </p>`
              : ""}

            ${body}

            ${ctaText && ctaUrl
              ? `<table role="presentation" border="0" cellpadding="0"
                        cellspacing="0" style="margin:28px auto 0;">
                   <tr><td align="center">
                     <a href="${ctaUrl}" class="cta-btn">${escHtml(ctaText)}</a>
                   </td></tr>
                 </table>`
              : ""}

            ${footerNote
              ? `<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;
                           border-top:1px solid #e5e7eb;padding-top:18px;
                           line-height:1.6;">
                   ${footerNote}
                 </p>`
              : ""}
          </td></tr>

          <!-- FOOTER -->
          <tr><td class="footer-cell">
            <p style="margin:0 0 10px;font-size:12px;">
              <a href="${FRONTEND_URL}"
                 style="color:#4b5563;text-decoration:none;margin:0 8px;">Home</a>
              <span style="color:#d1d5db;">|</span>
              <a href="mailto:${SUPPORT_EMAIL}"
                 style="color:#4b5563;text-decoration:none;margin:0 8px;">Support</a>
            </p>
            <p style="margin:0;font-size:11px;color:#9ca3af;">
              &copy; ${year} ${escHtml(APP_NAME)}. All rights reserved.
            </p>
          </td></tr>

        </table>
      </td></tr>
    </table>
  </div>
</body>
</html>`;

// ── HTML escape ───────────────────────────────────────────────────────────
const escHtml = (str = "") =>
  String(str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;");

// ═══════════════════════════════════════════════════════════════════════════
// OTP EMAIL
// ═══════════════════════════════════════════════════════════════════════════

const OTP_CONFIG = {
  verify:          { title: "Verify Your Email",     subtitle: "Enter the code below to activate your account" },
  login:           { title: "Your Sign-In Code",     subtitle: "Use this one-time code to sign in securely" },
  resend:          { title: "New Verification Code", subtitle: "Here is your fresh verification code" },
  reverification:  { title: "Security Check Required", subtitle: "Confirm your identity to continue" },
};

const buildOtpHtml = ({
  otp,
  recipientName,
  purpose      = "verify",
  expiryMinutes = 10,
}) => {
  const cfg = OTP_CONFIG[purpose] || OTP_CONFIG.verify;

  return baseTemplate({
    preheader:     `Your ${APP_NAME} code: ${otp} — valid for ${expiryMinutes} minutes`,
    title:         cfg.title,
    subtitle:      cfg.subtitle,
    recipientName,
    body: `
      <p style="margin:0 0 22px;font-size:14px;color:#4b5563;line-height:1.7;">
        This code is valid for
        <strong style="color:#111827;">${expiryMinutes} minutes</strong>.
        Do not share it with anyone.
      </p>

      <table role="presentation" border="0" cellpadding="0"
             cellspacing="0" width="100%" style="margin:0 0 20px;">
        <tr><td align="center">
          <div class="otp-box">
            <span class="otp-code">${escHtml(otp)}</span>
          </div>
        </td></tr>
      </table>

      <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;">
        Expires in
        <span style="font-weight:700;color:#374151;">${expiryMinutes} min</span>
      </p>
    `,
    footerNote:
      "Didn't request this code? You can safely ignore this email — " +
      "your account remains secure.",
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// WELCOME EMAIL
// ═══════════════════════════════════════════════════════════════════════════

const buildWelcomeHtml = ({ recipientName }) =>
  baseTemplate({
    preheader:    `Welcome to ${APP_NAME}! Your adventure starts now.`,
    title:        `Welcome to ${APP_NAME}! 🎉`,
    subtitle:     "Your account is verified and ready to go.",
    recipientName,
    body: `
      <p style="margin:0 0 18px;font-size:15px;color:#4b5563;line-height:1.7;">
        We are thrilled to have you join us. Discover curated East African
        adventures — from the Serengeti to Zanzibar to Kilimanjaro and beyond.
      </p>
      <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.7;">
        Start exploring our handpicked destinations and create memories
        that last a lifetime.
      </p>
    `,
    ctaText: "Start Exploring →",
    ctaUrl:  `${FRONTEND_URL}/destinations`,
    footerNote:
      "You are receiving this because you created an account on " +
      `${APP_NAME}. If this wasn't you, please contact us immediately.`,
  });

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVITY ALERT EMAIL
// ═══════════════════════════════════════════════════════════════════════════

const ACTIVITY_TITLES = {
  profile_updated: "Your Profile Was Updated",
  account_deleted: "Your Account Has Been Deleted",
};

const buildActivityAlertHtml = ({ recipientName, activityType }) =>
  baseTemplate({
    preheader:    `Account activity on ${APP_NAME}`,
    title:        ACTIVITY_TITLES[activityType] || "Account Activity",
    subtitle:     "We detected the following activity on your account.",
    recipientName,
    body: `
      <p style="margin:0 0 16px;font-size:14px;color:#4b5563;line-height:1.7;">
        <strong>Activity:</strong> ${escHtml(ACTIVITY_TITLES[activityType] || activityType)}<br>
        <strong>Time:</strong> ${new Date().toLocaleString("en-US", {
          dateStyle: "long",
          timeStyle: "short",
        })}
      </p>
      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
        If you did not perform this action, please contact our support team
        immediately at
        <a href="mailto:${SUPPORT_EMAIL}"
           style="color:#059669;">${SUPPORT_EMAIL}</a>.
      </p>
    `,
    footerNote:
      "This is an automated security notification from " + APP_NAME + ".",
  });

// ═══════════════════════════════════════════════════════════════════════════
// CONTACT NOTIFICATION (admin receives new contact message)
// ═══════════════════════════════════════════════════════════════════════════

const buildContactNotificationHtml = (message) => {
  const priorityLabel = {
    urgent: "🔴 URGENT",
    high:   "🟠 HIGH",
    normal: "🟢 Normal",
    low:    "⚪ Low",
  }[message.priority] || "🟢 Normal";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>New Contact Message</title>
  <style>
    body{margin:0;padding:0;background:#f4f4f5;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;}
    .wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:16px;
          box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;}
    .hd{background:linear-gradient(135deg,#064e3b,#059669);
        padding:28px 32px;text-align:center;color:#fff;}
    .bd{padding:32px;}
    .ft{background:#f9fafb;padding:20px 32px;text-align:center;
        border-top:1px solid #e5e7eb;}
    .box{background:#f0fdf4;border-radius:10px;padding:18px 20px;margin-bottom:20px;}
    .box-amber{background:#fffbeb;border-radius:10px;padding:18px 20px;margin-bottom:20px;}
    .quote{background:#f9fafb;border-left:4px solid #059669;
           padding:14px 16px;border-radius:0 8px 8px 0;
           white-space:pre-wrap;word-break:break-word;}
    .btn{display:inline-block;background:#059669;color:#fff!important;
         padding:12px 28px;border-radius:8px;text-decoration:none;
         font-weight:700;font-size:14px;}
    p{margin:0 0 10px;font-size:14px;color:#374151;line-height:1.6;}
    h3{margin:0 0 12px;font-size:15px;font-weight:700;}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hd">
      <p style="margin:0;font-size:22px;font-weight:800;">📬 New Contact Message</p>
      <p style="margin:6px 0 0;font-size:13px;opacity:.85;">${priorityLabel}</p>
    </div>
    <div class="bd">
      <div class="box">
        <h3 style="color:#064e3b;">Sender</h3>
        <p><strong>Name:</strong> ${escHtml(message.full_name)}</p>
        <p><strong>Email:</strong>
          <a href="mailto:${escHtml(message.email)}"
             style="color:#059669;">${escHtml(message.email)}</a></p>
        ${message.phone
          ? `<p><strong>Phone:</strong>
               <a href="tel:${escHtml(message.phone)}"
                  style="color:#059669;">${escHtml(message.phone)}</a></p>`
          : ""}
      </div>

      ${message.trip_type || message.travel_date || message.number_of_travelers
        ? `<div class="box-amber">
             <h3 style="color:#92400e;">🌍 Trip Details</h3>
             ${message.trip_type
               ? `<p><strong>Type:</strong> ${escHtml(message.trip_type)}</p>` : ""}
             ${message.travel_date
               ? `<p><strong>Date:</strong>
                    ${new Date(message.travel_date).toLocaleDateString("en-US",
                      {weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>` : ""}
             ${message.number_of_travelers
               ? `<p><strong>Travelers:</strong> ${escHtml(String(message.number_of_travelers))}</p>` : ""}
           </div>`
        : ""}

      ${message.subject
        ? `<p style="margin-bottom:4px;font-size:11px;text-transform:uppercase;
                     letter-spacing:.05em;color:#9ca3af;">Subject</p>
           <p style="font-size:16px;font-weight:700;color:#111827;margin-bottom:20px;">
             ${escHtml(message.subject)}</p>`
        : ""}

      <p style="margin-bottom:6px;font-size:11px;text-transform:uppercase;
                letter-spacing:.05em;color:#9ca3af;">Message</p>
      <div class="quote">
        <p style="margin:0;color:#374151;">${escHtml(message.message)}</p>
      </div>

      <div style="text-align:center;margin-top:28px;">
        <a href="${FRONTEND_URL}/admin/messages/${message.id}" class="btn">
          View in Dashboard →
        </a>
      </div>
    </div>
    <div class="ft">
      <p style="margin:0;font-size:12px;color:#6b7280;">
        Received: ${new Date(message.created_at || Date.now()).toLocaleString("en-US",
          {dateStyle:"full",timeStyle:"short"})}
      </p>
      <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">
        Message #${message.id} · Source: ${escHtml(message.source || "website")}
      </p>
    </div>
  </div>
</body>
</html>`;
};

// ═══════════════════════════════════════════════════════════════════════════
// CONTACT REPLY (send reply to contact sender)
// ═══════════════════════════════════════════════════════════════════════════

const buildContactReplyHtml = ({
  toName, subject, body: replyBody, originalMessage, fromName,
}) =>
  baseTemplate({
    preheader:    `Reply from ${APP_NAME}: ${subject}`,
    title:        escHtml(subject),
    recipientName: toName,
    body: `
      <div style="font-size:15px;color:#374151;line-height:1.8;
                  white-space:pre-wrap;word-break:break-word;margin-bottom:24px;">
        ${escHtml(replyBody)}
      </div>

      ${originalMessage
        ? `<div style="margin-top:24px;padding-top:20px;
                       border-top:1px solid #e5e7eb;">
             <p style="margin:0 0 8px;font-size:11px;color:#9ca3af;
                        text-transform:uppercase;letter-spacing:.05em;">
               Your original message
             </p>
             <div style="background:#f9fafb;padding:14px 16px;border-radius:8px;
                         border-left:3px solid #d1d5db;">
               <p style="margin:0;font-size:13px;color:#6b7280;
                          line-height:1.6;white-space:pre-wrap;">
                 ${escHtml(originalMessage.slice(0, 500))}${
                   originalMessage.length > 500 ? "…" : ""}
               </p>
             </div>
           </div>`
        : ""}

      <div style="margin-top:28px;">
        <p style="margin:0;font-size:14px;color:#374151;">
          Warm regards,<br>
          <strong>${escHtml(fromName)}</strong><br>
          <span style="color:#059669;">${escHtml(APP_NAME)} Team</span>
        </p>
      </div>
    `,
    footerNote:
      `You are receiving this reply because you contacted ${APP_NAME}. ` +
      "If you have further questions, simply reply to this email.",
  });

// ═══════════════════════════════════════════════════════════════════════════
// NAMED SEND FUNCTIONS (used by routes/controllers)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send OTP verification / login code.
 * Called by authController for every OTP flow.
 */
const sendOtpEmail = async ({
  to, recipientName, otp, purpose = "verify", expiryMinutes = 10,
}) => {
  const subjectMap = {
    verify:         `${otp} — Verify your ${APP_NAME} account`,
    login:          `${otp} — Your ${APP_NAME} sign-in code`,
    resend:         `${otp} — New ${APP_NAME} verification code`,
    reverification: `${otp} — ${APP_NAME} security check`,
  };

  return sendEmail({
    to,
    subject: subjectMap[purpose] || `${otp} — ${APP_NAME} verification code`,
    html:    buildOtpHtml({ otp, recipientName, purpose, expiryMinutes }),
  });
};

/**
 * Send welcome email after first successful verification.
 */
const sendWelcomeEmail = async ({ to, recipientName }) =>
  sendEmail({
    to,
    subject: `Welcome to ${APP_NAME}! 🎉`,
    html:    buildWelcomeHtml({ recipientName }),
  });

/**
 * Send account activity security alert.
 */
const sendActivityAlert = async ({ to, recipientName, activityType }) =>
  sendEmail({
    to,
    subject: `${ACTIVITY_TITLES[activityType] || "Account Activity"} — ${APP_NAME}`,
    html:    buildActivityAlertHtml({ recipientName, activityType }),
  });

/**
 * Send contact form notification to admin.
 */
const sendContactNotification = async (message) =>
  sendEmail({
    to:      process.env.ADMIN_EMAIL || process.env.SMTP_USER,
    subject: `${message.priority === "urgent" ? "🔴 URGENT: " : ""}New Contact: ${
      message.subject || message.full_name}`,
    html:    buildContactNotificationHtml(message),
    replyTo: message.email,
  });

/**
 * Send reply to a contact form sender.
 */
const sendContactReply = async ({
  to, toName, subject, body, originalMessage, fromName, fromEmail,
}) =>
  sendEmail({
    to,
    subject,
    html:    buildContactReplyHtml({ toName, subject, body, originalMessage, fromName }),
    replyTo: fromEmail || process.env.SMTP_USER,
  });

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // ── Core (used by authController) ─────────────────────────────────────
  sendEmail,
  sendOtpEmail,
  sendWelcomeEmail,
  sendActivityAlert,

  // ── Contact routes ─────────────────────────────────────────────────────
  sendContactNotification,
  sendContactReply,

  // ── HTML builders (exported for tests / admin preview) ─────────────────
  buildOtpHtml,
  buildWelcomeHtml,
  buildActivityAlertHtml,
  buildContactNotificationHtml,
  buildContactReplyHtml,
};