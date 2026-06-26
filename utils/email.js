// utils/email.js
// ═══════════════════════════════════════════════════════════════════════════
// Email Service — Gmail API (HTTPS) primary · Gmail SMTP fallback (dev only)
// Uses Google's HTTPS API on Render (SMTP ports 25/465/587 are blocked).
// Pure Google — zero third-party email services.
// ═══════════════════════════════════════════════════════════════════════════
"use strict";

const nodemailer = require("nodemailer");
const logger     = require("./logger");

// ── Constants ─────────────────────────────────────────────────────────────
const APP_NAME      = process.env.APP_NAME      || "Altuvera";
const FRONTEND_URL  = process.env.FRONTEND_URL  || "https://altuvera.com";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL
  || process.env.SMTP_USER
  || "altuverasafari@gmail.com";
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL
  || process.env.SMTP_USER
  || "altuverasafari@gmail.com";
const FROM_ADDRESS  = process.env.SMTP_FROM
  || `"${APP_NAME}" <${process.env.SMTP_USER || SUPPORT_EMAIL}>`;
const IS_PROD       = process.env.NODE_ENV === "production";
const year          = new Date().getFullYear();

// ── Activity labels (shared across functions) ─────────────────────────────
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
// TRANSPORT FACTORY
// Strategy:
//   Production (Render) → Gmail API via OAuth2 + HTTPS (port 443, never blocked)
//   Development         → Gmail SMTP App Password (port 587, works locally)
// ═══════════════════════════════════════════════════════════════════════════

let _transporter   = null;
let _transportType = "none";

// ── Gmail API sender (production — pure HTTPS, no SMTP) ───────────────────
// Sends via https://gmail.googleapis.com using OAuth2 access tokens.
// Requires: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
// Get these from Google Cloud Console → OAuth2 → Gmail API scope.

const sendViaGmailApi = async ({ to, subject, html, text, replyTo }) => {
  const { google } = require("googleapis");

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground", // redirect URI used during setup
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  });

  // Get a fresh access token (cached internally by googleapis)
  const { token: accessToken } = await oauth2Client.getAccessToken();
  if (!accessToken) throw new Error("Gmail API: Failed to obtain access token");

  // Build RFC 2822 message
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const fromHeader = FROM_ADDRESS;

  const rawParts = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    replyTo ? `Reply-To: ${replyTo}` : "",
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    text || htmlToText(html),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    html,
    ``,
    `--${boundary}--`,
  ].filter((l) => l !== undefined).join("\r\n");

  // Base64url encode (required by Gmail API)
  const encoded = Buffer.from(rawParts)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const res = await gmail.users.messages.send({
    userId:      "me",
    requestBody: { raw: encoded },
  });

  return {
    messageId: res.data?.id || "gmail-api",
    response:  res.data,
  };
};

// ── Gmail SMTP transporter (dev only) ─────────────────────────────────────
const createSmtpTransporter = () => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error(
      "[Email] Dev SMTP requires SMTP_USER + SMTP_PASS (Gmail App Password).",
    );
  }

  const t = nodemailer.createTransport({
    service:           "gmail",   // resolves smtp.gmail.com:587 automatically
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    family:            4,         // force IPv4
    pool:              true,
    maxConnections:    3,
    maxMessages:       50,
    socketTimeout:     15_000,
    connectionTimeout: 15_000,
    greetingTimeout:   10_000,
  });

  // Non-blocking verify
  t.verify((err) => {
    if (err) {
      logger.warn("[Email] SMTP verify failed:", err.message);
    } else {
      logger.info("[Email] ✅ Gmail SMTP ready (dev)");
    }
  });

  return t;
};

// ── Determine which strategy to use ──────────────────────────────────────
const hasGmailApiCreds = () =>
  !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  );

const hasSmtpCreds = () =>
  !!(process.env.SMTP_USER && process.env.SMTP_PASS);

// ═══════════════════════════════════════════════════════════════════════════
// CORE sendEmail
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send an email via Gmail (API in production, SMTP in dev).
 * Always throws on failure — callers decide whether to re-throw or swallow.
 */
const sendEmail = async ({
  to,
  subject,
  html,
  text,
  from,    // ignored for Gmail API (always sends as authed user)
  replyTo,
} = {}) => {
  if (!to)      throw new Error("sendEmail: 'to' is required");
  if (!subject) throw new Error("sendEmail: 'subject' is required");
  if (!html)    throw new Error("sendEmail: 'html' is required");

  const plainText = text || htmlToText(html);

  // ── Strategy A: Gmail API (production — HTTPS, never blocked) ─────────
  if (IS_PROD || hasGmailApiCreds()) {
    if (!hasGmailApiCreds()) {
      throw new Error(
        "[Email] Production requires Gmail API credentials.\n" +
        "Set these in Render environment variables:\n" +
        "  GMAIL_CLIENT_ID\n" +
        "  GMAIL_CLIENT_SECRET\n" +
        "  GMAIL_REFRESH_TOKEN\n" +
        "See setup guide below.",
      );
    }

    try {
      const info = await sendViaGmailApi({ to, subject, html, text: plainText, replyTo });
      logger.info("[Email] ✅ Sent via Gmail API:", {
        to, subject, messageId: info.messageId,
      });
      return info;
    } catch (err) {
      logger.error("[Email] ❌ Gmail API send FAILED:", {
        to, subject, error: err.message,
        code: err.code, status: err.status,
      });
      const friendly = new Error(
        `Failed to send email to ${to}. Gmail API error: ${err.message}`,
      );
      friendly.originalError = err;
      throw friendly;
    }
  }

  // ── Strategy B: Gmail SMTP (dev only — port 587, blocked on Render) ───
  if (!hasSmtpCreds()) {
    throw new Error(
      "[Email] No email credentials found.\n" +
      "For dev: set SMTP_USER + SMTP_PASS in .env\n" +
      "For prod: set GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN in Render",
    );
  }

  if (!_transporter) {
    _transporter   = createSmtpTransporter();
    _transportType = "gmail-smtp";
    logger.info("[Email] Using Gmail SMTP (dev — NOT for production on Render)");
  }

  try {
    const info = await _transporter.sendMail({
      from:    FROM_ADDRESS,
      to,
      subject,
      html,
      text:    plainText,
      replyTo: replyTo || SUPPORT_EMAIL,
    });
    logger.info("[Email] ✅ Sent via Gmail SMTP:", {
      to, subject, messageId: info.messageId,
    });
    return info;
  } catch (err) {
    // Reset transporter on connection errors
    if (
      ["EAUTH","ECONNECTION","ETIMEDOUT","ECONNREFUSED"].includes(err.code)
      || err.responseCode === 535
    ) {
      logger.warn("[Email] SMTP error — resetting transporter:", err.message);
      _transporter   = null;
      _transportType = "none";
    }

    logger.error("[Email] ❌ Gmail SMTP send FAILED:", {
      to, subject,
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
// BASE TEMPLATE
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
      -webkit-text-size-adjust:100%;
      -ms-text-size-adjust:100%;
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
      .container{
        border-radius:0!important;
        box-shadow:none!important;
      }
      .body-cell{padding:24px 16px!important;}
      .otp-code{
        font-size:32px!important;
        letter-spacing:8px!important;
      }
    }
  </style>
</head>
<body>
  <!-- Preheader (hidden preview text) -->
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
                 style="color:#4b5563;text-decoration:none;
                         margin:0 8px;">Home</a>
              <span style="color:#d1d5db;">|</span>
              <a href="mailto:${SUPPORT_EMAIL}"
                 style="color:#4b5563;text-decoration:none;
                         margin:0 8px;">Support</a>
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
    subtitle: "Confirm your identity to continue. Required periodically for security.",
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
      <!-- OTP Box -->
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

      <!-- Security notice -->
      <div class="warning-box">
        <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
          <strong>⚠️ Keep this code private.</strong>
          ${esc(APP_NAME)} staff will <em>never</em> ask for it.
          If you did not request this, you can safely ignore this email —
          your account has not been compromised.
        </p>
      </div>
    `,
    footerNote:
      `This code is valid for ${expiryMinutes} minutes and can only be ` +
      `used once. Need help? Contact ` +
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
    `Do NOT share this code with anyone.`,
    "",
    `If you did not request this, please ignore this email.`,
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
      `You are receiving this because you created an account on ` +
      `${esc(APP_NAME)}. If this wasn't you, please contact us immediately.`,
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
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">
          Activity
        </p>
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
// CONTACT NOTIFICATION TEMPLATE
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
      margin:0;padding:0;background:#f4f4f5;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',
                  Roboto,Arial,sans-serif;
    }
    .wrap{
      max-width:580px;margin:40px auto;background:#fff;
      border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);
      overflow:hidden;
    }
    .hd{
      background:linear-gradient(135deg,#064e3b,#059669);
      padding:28px 32px;text-align:center;
    }
    .bd{padding:32px;}
    .ft{
      background:#f9fafb;padding:18px 32px;
      border-top:1px solid #e5e7eb;text-align:center;
    }
    .box{
      background:#f0fdf4;border-radius:10px;
      padding:16px 20px;margin-bottom:18px;
    }
    .box-amber{
      background:#fffbeb;border-radius:10px;
      padding:16px 20px;margin-bottom:18px;
    }
    .quote{
      background:#f9fafb;border-left:4px solid #059669;
      padding:14px 16px;border-radius:0 8px 8px 0;
      white-space:pre-wrap;word-break:break-word;
    }
    .btn{
      display:inline-block;background:#059669;color:#fff!important;
      padding:12px 28px;border-radius:8px;text-decoration:none;
      font-weight:700;font-size:14px;
    }
    p{margin:0 0 8px;font-size:14px;color:#374151;line-height:1.6;}
    h3{margin:0 0 10px;font-size:14px;font-weight:700;color:#064e3b;}
    a{color:#059669;}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hd">
      <p style="margin:0;font-size:22px;font-weight:800;color:#fff;">
        📬 New Contact Message
      </p>
      <p style="margin:6px 0 0;font-size:13px;
                 color:rgba(255,255,255,0.75);">
        ${priority}
      </p>
    </div>

    <div class="bd">

      <!-- Sender -->
      <div class="box">
        <h3>👤 Sender</h3>
        <p><strong>Name:</strong> ${esc(msg.full_name)}</p>
        <p><strong>Email:</strong>
          <a href="mailto:${esc(msg.email)}">${esc(msg.email)}</a>
        </p>
        ${msg.phone
          ? `<p><strong>Phone:</strong>
               <a href="tel:${esc(msg.phone)}">${esc(msg.phone)}</a>
             </p>` : ""}
      </div>

      <!-- Trip details -->
      ${msg.trip_type || msg.travel_date || msg.number_of_travelers
        ? `<div class="box-amber">
             <h3>🌍 Trip Details</h3>
             ${msg.trip_type
               ? `<p><strong>Type:</strong> ${esc(msg.trip_type)}</p>` : ""}
             ${msg.travel_date
               ? `<p><strong>Date:</strong>
                    ${new Date(msg.travel_date).toLocaleDateString("en-US", {
                      weekday: "long", year: "numeric",
                      month:   "long", day: "numeric",
                    })}
                  </p>` : ""}
             ${msg.number_of_travelers
               ? `<p><strong>Travelers:</strong>
                    ${esc(String(msg.number_of_travelers))}
                  </p>` : ""}
           </div>` : ""}

      <!-- Subject -->
      ${msg.subject
        ? `<p style="font-size:11px;text-transform:uppercase;
                     letter-spacing:.05em;color:#9ca3af;margin-bottom:4px;">
             Subject
           </p>
           <p style="font-size:16px;font-weight:700;color:#111827;
                      margin-bottom:20px;">
             ${esc(msg.subject)}
           </p>` : ""}

      <!-- Message body -->
      <p style="font-size:11px;text-transform:uppercase;
                letter-spacing:.05em;color:#9ca3af;margin-bottom:6px;">
        Message
      </p>
      <div class="quote">
        <p style="margin:0;color:#374151;">${esc(msg.message)}</p>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-top:28px;">
        <a href="${FRONTEND_URL}/admin/messages/${esc(String(msg.id || ""))}"
           class="btn">
          View in Dashboard →
        </a>
      </div>

    </div>

    <div class="ft">
      <p style="margin:0;font-size:12px;color:#6b7280;">
        Received: ${received}
      </p>
      <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">
        Message #${esc(String(msg.id || ""))}
        · Source: ${esc(msg.source || "website")}
      </p>
    </div>
  </div>
</body>
</html>`;
};

// ═══════════════════════════════════════════════════════════════════════════
// CONTACT REPLY TEMPLATE
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
 * Send OTP — CRITICAL path. Always throws on failure.
 * The controller catches this and returns a real error to the client
 * instead of silently transitioning to the verify screen.
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
        `Welcome to ${APP_NAME}, ${recipientName || ""}!`,
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
 * Contact form notification to admin.
 */
const sendContactNotification = async (message) => {
  const isUrgent = message.priority === "urgent";
  return sendEmail({
    to:      ADMIN_EMAIL,
    subject: `${isUrgent ? "🔴 URGENT: " : ""}New Contact: ${
      message.subject || message.full_name}`,
    html:    buildContactNotificationHtml(message),
    replyTo: message.email,
  });
};

/**
 * Reply to a contact form sender.
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
  buildContactReplyHtml,
};