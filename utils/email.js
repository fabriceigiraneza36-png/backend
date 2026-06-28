// utils/email.js
// ═══════════════════════════════════════════════════════════════════════════
// Email Service — Gmail SMTP (App Password) · pure Nodemailer · no OAuth2
// Works on Render with SMTP_* environment variables.
// ═══════════════════════════════════════════════════════════════════════════
"use strict";

const nodemailer = require("nodemailer");
const logger     = require("./logger");

// ── Constants ─────────────────────────────────────────────────────────────
const APP_NAME      = process.env.APP_NAME      || "Altuvera";
const FRONTEND_URL  = process.env.FRONTEND_URL  || "https://altuvera.vercel.app";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL
  || process.env.SMTP_USER
  || "altuverasafari@gmail.com";
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL
  || process.env.SMTP_USER
  || "altuverasafari@gmail.com";
const FROM_ADDRESS  = process.env.SMTP_FROM
  || `"${APP_NAME}" <${process.env.SMTP_USER || SUPPORT_EMAIL}>`;
const year          = new Date().getFullYear();

// ── Activity labels ───────────────────────────────────────────────────────
const ACTIVITY_LABELS = {
  profile_updated:  "Your Profile Was Updated",
  account_deleted:  "Your Account Has Been Deleted",
  login_new_device: "New Sign-In Detected",
};

// ── Priority labels ───────────────────────────────────────────────────────
const PRIORITY_LABELS = {
  urgent: "🔴 URGENT",
  high:   "🟠 HIGH",
  normal: "🟢 Normal",
  low:    "⚪ Low",
};

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORT — Gmail SMTP via App Password
// Works on Render: uses port 587 (STARTTLS).
// Render does NOT block outbound port 587 to smtp.gmail.com.
// ═══════════════════════════════════════════════════════════════════════════

let _transporter = null;

/**
 * Validate that required SMTP env vars are present.
 * Called once on first send — throws a clear error if misconfigured.
 */
const assertSmtpConfig = () => {
  const missing = ["SMTP_USER", "SMTP_PASS"].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `[Email] Missing required environment variables: ${missing.join(", ")}\n` +
      "Set these in your Render dashboard → Environment:\n" +
      "  SMTP_HOST=smtp.gmail.com\n" +
      "  SMTP_PORT=587\n" +
      "  SMTP_SECURE=false\n" +
      "  SMTP_USER=altuverasafari@gmail.com\n" +
      "  SMTP_PASS=<16-char Gmail App Password>\n" +
      "  SMTP_FROM=Altuvera Travel <altuverasafari@gmail.com>\n" +
      "  ADMIN_EMAIL=altuverasafari@gmail.com\n" +
      "  SUPPORT_EMAIL=altuverasafari@gmail.com",
    );
  }
};

/**
 * Build (or return cached) Nodemailer SMTP transporter.
 */
const getTransporter = () => {
  if (_transporter) return _transporter;

  assertSmtpConfig();

  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || "smtp.gmail.com",
    port:   parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },

    // ── CRITICAL: force IPv4 ──────────────────────────────────────────
    // Render's network cannot reach Gmail over IPv6.
    // "smtp.gmail.com" resolves to both IPv4 + IPv6 — we must pin IPv4.
    family: 4,

    tls: {
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
    pool:              true,
    maxConnections:    3,
    maxMessages:       100,
    socketTimeout:     30_000,
    connectionTimeout: 30_000,
    greetingTimeout:   15_000,
  });

  _transporter.verify((err) => {
    if (err) {
      logger.warn("[Email] ⚠️  SMTP verify failed:", err.message);
      _transporter = null;
    } else {
      logger.info(
        `[Email] ✅ SMTP ready — ${process.env.SMTP_USER} via ${
          process.env.SMTP_HOST || "smtp.gmail.com"
        }:${process.env.SMTP_PORT || 587} (IPv4)`
      );
    }
  });

  return _transporter;
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

const esc = (str = "") =>
  String(str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;");

const htmlToText = (html = "") =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 3000);

// ═══════════════════════════════════════════════════════════════════════════
// CORE sendEmail
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send an email via Gmail SMTP.
 * Always throws on failure — callers decide whether to re-throw or swallow.
 *
 * @param {{ to, subject, html, text?, replyTo?, cc? }} opts
 */
const sendEmail = async ({
  to,
  subject,
  html,
  text,
  replyTo,
  cc,
} = {}) => {
  if (!to)      throw new Error("sendEmail: 'to' is required");
  if (!subject) throw new Error("sendEmail: 'subject' is required");
  if (!html)    throw new Error("sendEmail: 'html' is required");

  const transporter = getTransporter();
  const plainText   = text || htmlToText(html);

  try {
    const info = await transporter.sendMail({
      from:    FROM_ADDRESS,
      to,
      cc:      cc || undefined,
      replyTo: replyTo || undefined,
      subject,
      text:    plainText,
      html,
    });

    logger.info("[Email] ✅ Sent:", {
      to,
      subject,
      messageId: info.messageId,
    });

    return info;

  } catch (err) {
    // Reset transporter on auth / connection errors so next call retries
    const resetCodes = [
      "EAUTH", "ECONNECTION", "ETIMEDOUT",
      "ECONNREFUSED", "ESOCKET",
    ];
    if (resetCodes.includes(err.code) || err.responseCode === 535) {
      logger.warn("[Email] Resetting transporter after error:", err.code || err.message);
      _transporter = null;
    }

    logger.error("[Email] ❌ Send FAILED:", {
      to,
      subject,
      error:    err.message,
      code:     err.code,
      response: err.response,
    });

    const friendly = new Error(
      `Failed to send email to ${to}. SMTP error: ${err.message}`,
    );
    friendly.originalError = err;
    throw friendly;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// BASE HTML TEMPLATE
// ═══════════════════════════════════════════════════════════════════════════

const baseTemplate = ({
  preheader     = "",
  title         = "",
  subtitle      = "",
  body          = "",
  ctaText       = "",
  ctaUrl        = "",
  recipientName = "",
  footerNote    = "",
}) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${esc(title)}</title>
  <style>
    body,table,td,p,a,li{
      -webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;
    }
    table,td{mso-table-lspace:0;mso-table-rspace:0;}
    img{border:0;outline:none;text-decoration:none;
        -ms-interpolation-mode:bicubic;}
    body{
      margin:0;padding:0;width:100%!important;
      background:#f4f4f5;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,
                  Helvetica,Arial,sans-serif;
    }
    .wrapper{
      width:100%;table-layout:fixed;
      background:#f4f4f5;padding:40px 0;
    }
    .container{
      max-width:520px;background:#ffffff;
      border-radius:20px;
      box-shadow:0 8px 30px rgba(0,0,0,0.07),
                 0 2px 8px rgba(0,0,0,0.04);
    }
    .header-cell{
      background:linear-gradient(135deg,#047857 0%,#059669 100%);
      border-radius:20px 20px 0 0;
      padding:32px 24px;text-align:center;
    }
    .body-cell{padding:36px 32px;}
    .footer-cell{
      background:#f9fafb;padding:22px 24px;
      border-radius:0 0 20px 20px;
      border-top:1px solid #e5e7eb;text-align:center;
    }
    .otp-box{
      background:#f0fdf4;border:2px solid #bbf7d0;
      border-radius:14px;padding:24px 32px;
      display:inline-block;margin:0 auto;
    }
    .otp-code{
      font-family:'Courier New',Courier,monospace;
      font-size:40px;font-weight:800;
      letter-spacing:12px;color:#059669;
      display:block;text-align:center;
    }
    .cta-btn{
      display:inline-block;padding:14px 36px;
      background:#059669;color:#ffffff!important;
      text-decoration:none;border-radius:40px;
      font-size:15px;font-weight:700;text-align:center;
    }
    .warning-box{
      background:#fefce8;border-left:4px solid #f59e0b;
      border-radius:0 8px 8px 0;
      padding:14px 16px;margin:20px 0 0;
    }
    @media only screen and (max-width:600px){
      .wrapper{padding:0!important;}
      .container{border-radius:0!important;box-shadow:none!important;}
      .body-cell{padding:24px 16px!important;}
      .otp-code{font-size:32px!important;letter-spacing:8px!important;}
    }
  </style>
</head>
<body>
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;
              font-size:1px;color:#f4f4f5;line-height:1px;">
    ${esc(preheader)}&nbsp;${"&zwnj;&nbsp;".repeat(50)}
  </div>

  <div class="wrapper">
    <table role="presentation" border="0"
           cellpadding="0" cellspacing="0" width="100%">
      <tr><td align="center" style="padding:0 16px;">
        <table role="presentation" border="0"
               cellpadding="0" cellspacing="0"
               width="520" class="container">

          <!-- HEADER -->
          <tr><td class="header-cell">
            <a href="${FRONTEND_URL}" style="text-decoration:none;">
              <span style="color:#ffffff;font-size:28px;font-weight:800;
                           letter-spacing:-0.5px;">${esc(APP_NAME)}</span>
            </a>
            <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;
                       font-size:12px;letter-spacing:2px;
                       text-transform:uppercase;">
              Premium Safari Adventures
            </p>
          </td></tr>

          <!-- BODY -->
          <tr><td class="body-cell">
            ${recipientName
              ? `<p style="margin:0 0 20px;font-size:15px;
                           color:#374151;font-weight:500;">
                   Hello, <strong>${esc(recipientName)}</strong>
                 </p>`
              : ""}

            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;
                        color:#111827;line-height:1.3;">
              ${esc(title)}
            </h1>

            ${subtitle
              ? `<p style="margin:0 0 24px;font-size:14px;
                           color:#6b7280;line-height:1.6;">
                   ${esc(subtitle)}
                 </p>`
              : ""}

            ${body}

            ${ctaText && ctaUrl
              ? `<table role="presentation" border="0"
                        cellpadding="0" cellspacing="0"
                        style="margin:28px auto 0;">
                   <tr><td align="center">
                     <a href="${esc(ctaUrl)}" class="cta-btn">
                       ${esc(ctaText)}
                     </a>
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
            <p style="margin:0 0 8px;font-size:12px;">
              <a href="${FRONTEND_URL}"
                 style="color:#4b5563;text-decoration:none;margin:0 8px;">
                Home
              </a>
              <span style="color:#d1d5db;">|</span>
              <a href="mailto:${SUPPORT_EMAIL}"
                 style="color:#4b5563;text-decoration:none;margin:0 8px;">
                Support
              </a>
            </p>
            <p style="margin:0;font-size:11px;color:#9ca3af;">
              &copy; ${year} ${esc(APP_NAME)}. All rights reserved.
            </p>
          </td></tr>

        </table>
      </td></tr>
    </table>
  </div>
</body>
</html>`;

// ═══════════════════════════════════════════════════════════════════════════
// OTP TEMPLATE
// ═══════════════════════════════════════════════════════════════════════════

const OTP_CONFIG = {
  verify: {
    title:    "Verify Your Email",
    subtitle: "Enter the code below to activate your account.",
  },
  login: {
    title:    "Your Sign-In Code",
    subtitle: "Use this one-time code to sign in securely.",
  },
  resend: {
    title:    "New Verification Code",
    subtitle: "Here is your refreshed verification code.",
  },
  reverification: {
    title:    "Security Check Required",
    subtitle: "Confirm your identity to continue.",
  },
};

const buildOtpHtml = ({
  otp,
  recipientName = "",
  purpose       = "verify",
  expiryMinutes = 10,
}) => {
  const cfg = OTP_CONFIG[purpose] || OTP_CONFIG.verify;
  return baseTemplate({
    preheader:    `Your ${APP_NAME} code: ${otp} — valid for ${expiryMinutes} minutes`,
    title:        cfg.title,
    subtitle:     cfg.subtitle,
    recipientName,
    body: `
      <table role="presentation" border="0" cellpadding="0"
             cellspacing="0" width="100%" style="margin:0 0 24px;">
        <tr><td align="center">
          <div class="otp-box">
            <p style="margin:0 0 10px;font-size:11px;font-weight:700;
                       text-transform:uppercase;letter-spacing:2px;
                       color:#6b7280;text-align:center;">
              Verification Code
            </p>
            <span class="otp-code">${esc(String(otp))}</span>
            <p style="margin:12px 0 0;font-size:12px;
                       color:#9ca3af;text-align:center;">
              Expires in
              <strong style="color:#374151;">${expiryMinutes} minutes</strong>
            </p>
          </div>
        </td></tr>
      </table>
      <div class="warning-box">
        <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
          <strong>⚠️ Keep this code private.</strong>
          ${esc(APP_NAME)} staff will <em>never</em> ask for it.
          If you did not request this, you can safely ignore this email.
        </p>
      </div>
    `,
    footerNote:
      `This code is valid for ${expiryMinutes} minutes and can only be used once. ` +
      `Need help? Contact ` +
      `<a href="mailto:${SUPPORT_EMAIL}" ` +
      `style="color:#059669;text-decoration:none;">${SUPPORT_EMAIL}</a>.`,
  });
};

const buildOtpText = ({
  otp,
  recipientName = "",
  purpose       = "verify",
  expiryMinutes = 10,
}) => {
  const cfg = OTP_CONFIG[purpose] || OTP_CONFIG.verify;
  return [
    `${APP_NAME} — ${cfg.title}`,
    "",
    recipientName ? `Hello ${recipientName},` : "Hello,",
    "",
    cfg.subtitle,
    "",
    `Your verification code: ${otp}`,
    "",
    `This code expires in ${expiryMinutes} minutes.`,
    "Do NOT share this code with anyone.",
    "",
    "If you did not request this, please ignore this email.",
    "",
    `— The ${APP_NAME} Team`,
    FRONTEND_URL,
  ].join("\n");
};

// ═══════════════════════════════════════════════════════════════════════════
// WELCOME TEMPLATE
// ═══════════════════════════════════════════════════════════════════════════

const buildWelcomeHtml = ({ recipientName = "" }) =>
  baseTemplate({
    preheader:    `Welcome to ${APP_NAME}! Your adventure starts now 🌍`,
    title:        `Welcome to ${APP_NAME}! 🎉`,
    subtitle:     "Your account is verified and ready to explore.",
    recipientName,
    body: `
      <p style="margin:0 0 16px;font-size:15px;color:#4b5563;line-height:1.7;">
        We are thrilled to have you on board.
        ${esc(APP_NAME)} is your gateway to Africa's most extraordinary
        adventures — from the Serengeti to Zanzibar, Kilimanjaro to the
        Volcanoes of Rwanda.
      </p>
      <p style="margin:0;font-size:15px;color:#4b5563;line-height:1.7;">
        Start exploring our handpicked destinations and craft your perfect
        safari experience.
      </p>
    `,
    ctaText:   "Start Exploring →",
    ctaUrl:    `${FRONTEND_URL}/destinations`,
    footerNote:
      `You are receiving this because you created an account on ${esc(APP_NAME)}. ` +
      "If this wasn't you, please contact us immediately.",
  });

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVITY ALERT TEMPLATE
// ═══════════════════════════════════════════════════════════════════════════

const buildActivityAlertHtml = ({ recipientName = "", activityType }) => {
  const label = ACTIVITY_LABELS[activityType] || "Account Activity";
  const when  = new Date().toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });

  return baseTemplate({
    preheader:    `Security alert — ${label} on your ${APP_NAME} account`,
    title:        label,
    subtitle:     "We detected the following activity on your account.",
    recipientName,
    body: `
      <div style="background:#f3f4f6;border-radius:10px;
                  padding:18px 20px;margin-bottom:20px;">
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Activity</p>
        <p style="margin:0;font-size:15px;font-weight:700;color:#111827;">
          ${esc(label)}
        </p>
        <p style="margin:8px 0 0;font-size:13px;color:#6b7280;">
          ${esc(when)}
        </p>
      </div>
      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
        If you did not perform this action, please contact
        <a href="mailto:${SUPPORT_EMAIL}"
           style="color:#059669;font-weight:600;">${SUPPORT_EMAIL}</a>
        immediately.
      </p>
    `,
    footerNote:
      `This is an automated security notification from ${esc(APP_NAME)}.`,
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// CONTACT NOTIFICATION TEMPLATE  (admin inbox)
// ═══════════════════════════════════════════════════════════════════════════

const buildContactNotificationHtml = (msg) => {
  const priority = PRIORITY_LABELS[msg.priority] || PRIORITY_LABELS.normal;
  const received = new Date(msg.created_at || Date.now()).toLocaleString(
    "en-US", { dateStyle: "full", timeStyle: "short" },
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>New Contact — ${esc(APP_NAME)}</title>
  <style>
    body{
      margin:0;padding:0;background:#f0fdf4;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',
                  Roboto,Arial,sans-serif;
    }
    .wrap{
      max-width:600px;margin:36px auto;background:#fff;
      border-radius:18px;
      box-shadow:0 6px 28px rgba(6,78,59,.10);
      overflow:hidden;
    }
    .hd{
      background:linear-gradient(135deg,#064e3b 0%,#059669 100%);
      padding:30px 36px;text-align:center;
    }
    .bd{padding:32px 36px;}
    .ft{
      background:#f9fafb;padding:18px 36px;
      border-top:1px solid #e5e7eb;text-align:center;
    }
    .section{
      background:#f0fdf4;border-radius:12px;
      padding:18px 20px;margin-bottom:18px;
    }
    .section-amber{
      background:#fffbeb;border-radius:12px;
      padding:18px 20px;margin-bottom:18px;
    }
    .row{
      display:flex;gap:10px;margin-bottom:8px;
      align-items:flex-start;
    }
    .key{
      min-width:110px;font-size:12px;font-weight:700;
      color:#6b7280;text-transform:uppercase;letter-spacing:.4px;
      padding-top:2px;flex-shrink:0;
    }
    .val{flex:1;font-size:14px;color:#111827;line-height:1.55;}
    .msg-box{
      background:#f8fffe;border:1.5px solid #a7f3d0;
      border-radius:12px;padding:18px 20px;
      font-size:14.5px;color:#1e293b;line-height:1.75;
      white-space:pre-wrap;word-break:break-word;
    }
    .sep{height:1px;background:#e5e7eb;margin:20px 0;}
    .btn{
      display:inline-block;padding:13px 28px;
      background:linear-gradient(135deg,#065f46,#047857);
      color:#fff!important;border-radius:12px;
      font-size:14px;font-weight:700;text-decoration:none;
      box-shadow:0 5px 16px rgba(6,78,59,.26);
    }
    h3{margin:0 0 12px;font-size:13px;font-weight:700;
       color:#065f46;text-transform:uppercase;letter-spacing:.4px;}
    p{margin:0 0 6px;font-size:14px;color:#374151;line-height:1.6;}
    a{color:#059669;}
  </style>
</head>
<body>
  <div class="wrap">

    <!-- Header -->
    <div class="hd">
      <p style="margin:0;font-size:24px;font-weight:800;color:#fff;">
        📬 New Contact Message
      </p>
      <p style="margin:8px 0 0;font-size:13px;
                 color:rgba(255,255,255,.75);">
        ${priority} · ${esc(APP_NAME)}
      </p>
    </div>

    <!-- Body -->
    <div class="bd">

      <!-- Sender -->
      <div class="section">
        <h3>👤 Sender Details</h3>
        <div class="row">
          <span class="key">Name</span>
          <span class="val"><strong>${esc(msg.full_name || msg.name || "—")}</strong></span>
        </div>
        <div class="row">
          <span class="key">Email</span>
          <span class="val">
            <a href="mailto:${esc(msg.email)}">${esc(msg.email)}</a>
          </span>
        </div>
        ${msg.phone
          ? `<div class="row">
               <span class="key">Phone</span>
               <span class="val">
                 <a href="tel:${esc(msg.phone)}">${esc(msg.phone)}</a>
               </span>
             </div>` : ""}
      </div>

      <!-- Trip details (optional) -->
      ${msg.trip_type || msg.travel_date || msg.number_of_travelers
        || msg.tripType || msg.travelDate || msg.travelers
        ? `<div class="section-amber">
             <h3>🌍 Trip Details</h3>
             ${msg.trip_type || msg.tripType
               ? `<div class="row">
                    <span class="key">Trip Type</span>
                    <span class="val">${esc(msg.trip_type || msg.tripType)}</span>
                  </div>` : ""}
             ${msg.travel_date || msg.travelDate
               ? `<div class="row">
                    <span class="key">Date</span>
                    <span class="val">${esc(msg.travel_date || msg.travelDate)}</span>
                  </div>` : ""}
             ${msg.number_of_travelers || msg.travelers
               ? `<div class="row">
                    <span class="key">Travelers</span>
                    <span class="val">
                      ${esc(String(msg.number_of_travelers || msg.travelers))}
                    </span>
                  </div>` : ""}
           </div>` : ""}

      <!-- Subject -->
      ${msg.subject
        ? `<div class="row" style="margin-bottom:16px;">
             <span class="key" style="padding-top:3px;">Subject</span>
             <span class="val" style="font-size:16px;font-weight:700;color:#111827;">
               ${esc(msg.subject)}
             </span>
           </div>` : ""}

      <div class="sep"></div>

      <!-- Message -->
      <h3 style="margin-bottom:10px;">💬 Message</h3>
      <div class="msg-box">${esc(msg.message || "")}</div>

      <!-- Reply CTA -->
      <div style="text-align:center;margin-top:28px;">
        <a href="mailto:${esc(msg.email)}?subject=Re: ${
          esc(msg.subject || "Your Inquiry")
        }" class="btn">
          ↩️ Reply to ${esc(msg.full_name || msg.name || "Sender")}
        </a>
      </div>

    </div>

    <!-- Footer -->
    <div class="ft">
      <p style="margin:0;font-size:12px;color:#6b7280;">
        Received: ${received}
      </p>
      <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">
        ${msg.id ? `Message #${esc(String(msg.id))} · ` : ""}
        Source: ${esc(msg.source || "website")}
      </p>
    </div>

  </div>
</body>
</html>`;
};

// ═══════════════════════════════════════════════════════════════════════════
// CONTACT AUTO-REPLY TEMPLATE  (confirmation to visitor)
// ═══════════════════════════════════════════════════════════════════════════

const buildContactAutoReplyHtml = ({ name = "", subject = "" }) =>
  baseTemplate({
    preheader:    `We got your message — ${APP_NAME} will reply within 2 hours`,
    title:        "✅ Message Received!",
    subtitle:     "Thank you for reaching out. We'll be in touch very soon.",
    recipientName: name,
    body: `
      <p style="margin:0 0 16px;font-size:15px;color:#4b5563;line-height:1.7;">
        Our safari experts have received your message and will respond within
        <strong>2 hours</strong> during working hours
        (Mon–Fri 8 AM – 6 PM EAT, Sat 9 AM – 2 PM EAT).
      </p>

      ${subject
        ? `<div style="background:#f0fdf4;border:1.5px solid #a7f3d0;
                       border-radius:13px;padding:16px 20px;margin-bottom:20px;">
             <p style="margin:0;font-size:12px;font-weight:700;color:#6b7280;
                        text-transform:uppercase;letter-spacing:.4px;
                        margin-bottom:4px;">Your subject</p>
             <p style="margin:0;font-size:15px;font-weight:700;color:#065f46;">
               ${esc(subject)}
             </p>
           </div>` : ""}

      <p style="margin:0 0 8px;font-size:14px;color:#6b7280;line-height:1.6;">
        Need a faster response? Reach us instantly on WhatsApp:
      </p>
      <table role="presentation" border="0" cellpadding="0"
             cellspacing="0" style="margin:0 0 20px;">
        <tr><td>
          <a href="https://wa.me/250792352409"
             style="display:inline-flex;align-items:center;gap:8px;
                    padding:11px 22px;background:#25D366;color:#fff!important;
                    border-radius:10px;font-size:14px;font-weight:700;
                    text-decoration:none;">
            💬 WhatsApp Us
          </a>
        </td></tr>
      </table>
    `,
    ctaText:   "View Our Safaris →",
    ctaUrl:    `${FRONTEND_URL}/destinations`,
    footerNote:
      `You're receiving this because you submitted a contact form on ` +
      `<a href="${FRONTEND_URL}" style="color:#059669;">${FRONTEND_URL}</a>. ` +
      "Simply reply to this email if you have follow-up questions.",
  });

// ═══════════════════════════════════════════════════════════════════════════
// CONTACT REPLY TEMPLATE  (staff → visitor reply)
// ═══════════════════════════════════════════════════════════════════════════

const buildContactReplyHtml = ({
  toName,
  subject,
  body:    replyBody,
  originalMessage,
  fromName,
}) =>
  baseTemplate({
    preheader:     `Reply from ${APP_NAME}: ${subject}`,
    title:          esc(subject),
    recipientName:  toName,
    body: `
      <div style="font-size:15px;color:#374151;line-height:1.8;
                  white-space:pre-wrap;word-break:break-word;
                  margin-bottom:24px;">
        ${esc(replyBody)}
      </div>

      ${originalMessage
        ? `<div style="margin-top:24px;padding-top:20px;
                       border-top:1px solid #e5e7eb;">
             <p style="margin:0 0 8px;font-size:11px;color:#9ca3af;
                        text-transform:uppercase;letter-spacing:.05em;">
               Your original message
             </p>
             <div style="background:#f9fafb;padding:14px 16px;
                         border-radius:8px;border-left:3px solid #d1d5db;">
               <p style="margin:0;font-size:13px;color:#6b7280;
                          line-height:1.6;white-space:pre-wrap;">
                 ${esc(originalMessage.slice(0, 500))}${
                   originalMessage.length > 500 ? "…" : ""}
               </p>
             </div>
           </div>` : ""}

      <div style="margin-top:28px;">
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
          Warm regards,<br>
          <strong>${esc(fromName)}</strong><br>
          <span style="color:#059669;">${esc(APP_NAME)} Team</span>
        </p>
      </div>
    `,
    footerNote:
      `You are receiving this reply because you contacted ${esc(APP_NAME)}. ` +
      "Simply reply to this email if you have further questions.",
  });

// ═══════════════════════════════════════════════════════════════════════════
// NAMED SEND FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send OTP — CRITICAL. Always throws on failure.
 */
const sendOtpEmail = async ({
  to,
  recipientName = "",
  otp,
  purpose       = "verify",
  expiryMinutes = 10,
}) => {
  if (!to)  throw new Error("sendOtpEmail: 'to' is required");
  if (!otp) throw new Error("sendOtpEmail: 'otp' is required");

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
    text:    buildOtpText({ otp, recipientName, purpose, expiryMinutes }),
  });
};

/**
 * Welcome email — non-critical. Logs failure, never throws.
 */
const sendWelcomeEmail = async ({ to, recipientName = "" }) => {
  if (!to) return;
  try {
    await sendEmail({
      to,
      subject: `Welcome to ${APP_NAME}! 🎉`,
      html:    buildWelcomeHtml({ recipientName }),
      text: [
        `Welcome to ${APP_NAME}${recipientName ? `, ${recipientName}` : ""}!`,
        "",
        "Your account is now active.",
        "",
        `Start exploring: ${FRONTEND_URL}/destinations`,
        "",
        `— The ${APP_NAME} Team`,
      ].join("\n"),
    });
  } catch (err) {
    logger.warn("[Email] sendWelcomeEmail failed (non-critical):", {
      to, error: err.message,
    });
  }
};

/**
 * Activity security alert — non-critical. Logs failure, never throws.
 */
const sendActivityAlert = async ({
  to, recipientName = "", activityType,
}) => {
  if (!to) return;
  const label = ACTIVITY_LABELS[activityType] || "Account Activity";
  try {
    await sendEmail({
      to,
      subject: `${label} — ${APP_NAME}`,
      html:    buildActivityAlertHtml({ recipientName, activityType }),
      text: [
        `${APP_NAME} — ${label}`,
        "",
        `Hi ${recipientName},`,
        "",
        `Activity detected: ${label}`,
        "",
        `If this wasn't you, contact ${SUPPORT_EMAIL} immediately.`,
        "",
        `— ${APP_NAME}`,
      ].join("\n"),
    });
  } catch (err) {
    logger.warn("[Email] sendActivityAlert failed (non-critical):", {
      to, activityType, error: err.message,
    });
  }
};

/**
 * Contact form notification → admin inbox.
 * Sends both admin notification AND auto-reply to visitor in parallel.
 *
 * @param {object} message  — contact form data (see field mapping inside)
 */
const sendContactNotification = async (message) => {
  const isUrgent  = message.priority === "urgent";
  const senderName = message.full_name || message.name || "Someone";

  // Fire both emails concurrently; auto-reply failure is non-critical
  const [adminResult] = await Promise.allSettled([
    // 1. Admin notification
    sendEmail({
      to:      ADMIN_EMAIL,
      replyTo: message.email || undefined,
      subject: `${isUrgent ? "🔴 URGENT: " : "📬 "}New Contact: ${
        message.subject || senderName
      } — ${APP_NAME}`,
      html: buildContactNotificationHtml(message),
      text: [
        `New contact message — ${APP_NAME}`,
        "",
        `From:    ${senderName}`,
        `Email:   ${message.email}`,
        message.phone ? `Phone:   ${message.phone}` : "",
        message.subject ? `Subject: ${message.subject}` : "",
        "",
        "Message:",
        message.message || "",
      ].filter((l) => l !== "").join("\n"),
    }),

    // 2. Auto-reply to visitor (non-critical — swallow failure)
    (async () => {
      if (!message.email) return;
      try {
        await sendEmail({
          to:      message.email,
          subject: `✅ We received your message — ${APP_NAME}`,
          html:    buildContactAutoReplyHtml({
            name:    senderName,
            subject: message.subject || "Your Inquiry",
          }),
          text: [
            `Hi ${senderName},`,
            "",
            `Thank you for contacting ${APP_NAME}!`,
            "We've received your message and will reply within 2 hours.",
            "",
            `Your subject: ${message.subject || "—"}`,
            "",
            "Need faster help? WhatsApp us: https://wa.me/250792352409",
            "",
            `— The ${APP_NAME} Team`,
            FRONTEND_URL,
          ].join("\n"),
        });
      } catch (err) {
        logger.warn("[Email] Auto-reply failed (non-critical):", {
          to: message.email, error: err.message,
        });
      }
    })(),
  ]);

  // Re-throw only if the admin notification itself failed
  if (adminResult.status === "rejected") {
    throw adminResult.reason;
  }

  return adminResult.value;
};

/**
 * Staff → visitor reply email.
 */
const sendContactReply = async ({
  to,
  toName,
  subject,
  body,
  originalMessage,
  fromName,
  fromEmail,
}) =>
  sendEmail({
    to,
    subject,
    html:    buildContactReplyHtml({ toName, subject, body, originalMessage, fromName }),
    replyTo: fromEmail || SUPPORT_EMAIL,
    text:    `${subject}\n\n${body}\n\n— ${fromName} · ${APP_NAME}`,
  });

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Core
  sendEmail,

  // Auth flows
  sendOtpEmail,
  sendWelcomeEmail,
  sendActivityAlert,

  // Contact
  sendContactNotification,
  sendContactReply,

  // HTML builders (tests / admin preview)
  buildOtpHtml,
  buildOtpText,
  buildWelcomeHtml,
  buildActivityAlertHtml,
  buildContactNotificationHtml,
  buildContactAutoReplyHtml,
  buildContactReplyHtml,
};