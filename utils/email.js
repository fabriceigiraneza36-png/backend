// utils/email.js
// ═══════════════════════════════════════════════════════════════════════════
// Centralized email utility — production-grade with SendGrid & SMTP support
// Features:
//   • Auto IPv4 + retry for SMTP
//   • OTP masking in logs
//   • SendGrid primary (HTTPS) with SMTP fallback
//   • Comprehensive error hints
// ═══════════════════════════════════════════════════════════════════════════

"use strict";

const nodemailer = require("nodemailer");
const logger     = require("./logger");

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const getEmailConfig = () => {
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = parseInt(process.env.SMTP_PORT, 10) || 587;
  const smtpUser = (process.env.SMTP_USER || "").trim();
  const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const smtpFrom = process.env.SMTP_FROM  || null;

  const isConfigured = Boolean(
    smtpUser &&
    smtpPass &&
    !smtpUser.includes("your-email") &&
    !smtpPass.includes("your-app-password"),
  );

  return { smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, isConfigured };
};

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORTER (SMTP)
// ═══════════════════════════════════════════════════════════════════════════

let _transporter = null;
let _transporterConfig = null;

const getTransporter = () => {
  const config = getEmailConfig();

  if (!config.isConfigured) return null;

  const configKey = `${config.smtpHost}:${config.smtpPort}:${config.smtpUser}`;
  if (_transporter && _transporterConfig === configKey) return _transporter;

  _transporter = nodemailer.createTransport({
    host:   config.smtpHost,
    port:   config.smtpPort,
    family: 4,                           // Force IPv4
    secure: config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
    tls: {
      rejectUnauthorized: true,
    },
    pool:           true,
    maxConnections: 5,
    maxMessages:    100,
    rateDelta:      1000,
    rateLimit:      5,
    connectionTimeout: 10_000,
    greetingTimeout:   10_000,
    socketTimeout:     30_000,
  });

  _transporterConfig = configKey;

  // Non-blocking connection test
  _transporter.verify((err) => {
    if (err) {
      logger.error("❌ SMTP connection failed:", {
        message: err.message,
        host:    config.smtpHost,
        port:    config.smtpPort,
        user:    config.smtpUser,
        hint:    err.message.includes("ENETUNREACH")
          ? "IPv6 routing issue — verify IPv4 egress allowed"
          : undefined,
      });
    } else {
      logger.info(`✅ SMTP connected → ${config.smtpHost}:${config.smtpPort} (IPv4)`);
    }
  });

  return _transporter;
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

const escape = (value) =>
  String(value ?? "")
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;");

const MAX_EMAIL_RETRIES = 3;
const RETRY_DELAYS_MS   = [200, 500, 1000];

const isTransientNetworkError = (err) => {
  if (!err || !err.code) return false;
  const transient = [
    'ENOTFOUND','ENETUNREACH','ECONNREFUSED','ETIMEDOUT',
    'ECONNRESET','EPIPE','ESOCKETTIMEDOUT','EHOSTUNREACH',
  ];
  return transient.includes(err.code);
};

const maskSensitiveInfo = (str) => {
  if (typeof str !== 'string') return str;
  return str.replace(/\b\d{6,}\b/g, '******');
};

// ═══════════════════════════════════════════════════════════════════════════
// SMTP SEND (IPv4 + retry)
// ═══════════════════════════════════════════════════════════════════════════

async function sendEmailSMTP({ to, subject, html, text, from }) {
  const config = getEmailConfig();
  let transporter = getTransporter();

  // — Unconfigured SMTP —
  if (!transporter) {
    if (process.env.NODE_ENV !== "production") {
      logger.info("[Email DEV] SMTP not configured — email not sent", { to, subject });
      return { delivered: false, fallback: "console" };
    }
    const msg = "SMTP service not configured — cannot send email in production";
    logger.error(`[Email] ${msg}`, { host: config.smtpHost, port: config.smtpPort });
    throw new Error(msg);
  }

  const mailOptions = {
    from: from || config.smtpFrom || `"${process.env.APP_NAME || "Altuvera"}" <${config.smtpUser}>`,
    to,
    subject,
    html,
    text: text || (html ? html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : ""),
  };

  let attempt = 0;
  let lastError;

  while (true) {
    try {
      const info = await transporter.sendMail(mailOptions);
      logger.info("✅ Email sent (SMTP)", {
        to,
        subject: maskSensitiveInfo(subject),
        messageId: info.messageId,
        attempt: attempt + 1,
      });
      return { delivered: true, messageId: info.messageId };
    } catch (err) {
      lastError = err;
      const isTransient = isTransientNetworkError(err);
      const isAuth      = err.code === 'EAUTH' || err.responseCode === 535;

      logger.warn(`[Email] ❌ SMTP attempt ${attempt + 1} failed: ${err.message}`);

      if (isAuth || !isTransient) break;        // don't retry
      if (attempt >= MAX_EMAIL_RETRIES) break;  // max retries

      const delay = RETRY_DELAYS_MS[attempt] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      await new Promise(r => setTimeout(r, delay));

      // Recreate transporter to clear stale connections
      _transporter = null;
      transporter = getTransporter();
      attempt++;
    }
  }

  const err = lastError;
  if (err && ['EAUTH','ECONNECTION','ETIMEDOUT'].includes(err.code)) {
    logger.warn("[Email] Resetting SMTP transporter due to persistent error");
    _transporter = null;
  }

  let hint = null;
  if (err) {
    if (err.code === 'EAUTH' || err.responseCode === 535) {
      hint = "SMTP authentication failed — verify credentials / use App Password if 2FA enabled";
    } else if (['ENOTFOUND','ENETUNREACH','EHOSTUNREACH'].includes(err.code)) {
      hint = "DNS/network error — check SMTP_HOST and IPv4 egress";
    } else if (err.code === 'ECONNREFUSED') {
      hint = "SMTP server refused connection — check SMTP_HOST and SMTP_PORT";
    } else if (err.code === 'ETIMEDOUT') {
      hint = "Connection timed out — firewall may be blocking outbound SMTP";
    }
  }

  logger.error(`[Email] ❌ SMTP failed after ${attempt + 1} attempt(s): ${err.message}`, { code: err?.code, hint });
  throw err;
}

// ═══════════════════════════════════════════════════════════════════════════
// SENDGRID (HTTPS) — bypasses Render's SMTP block
// ═══════════════════════════════════════════════════════════════════════════

let _sgEnabled = false;
let _sgWarned  = false;

function checkSendGridEnabled() {
  if (_sgEnabled) return true;
  if (_sgWarned) return false;

  const key = process.env.SENDGRID_API_KEY;
  if (!key || key.length < 10) {
    if (process.env.NODE_ENV !== 'production') {
      logger.info('[Email] SENDGRID_API_KEY not set — SMTP-only mode');
    }
    _sgWarned = true;
    return false;
  }

  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(key);
    _sgEnabled = true;
    logger.info('[Email] ✅ SendGrid mail client initialized');
    return true;
  } catch (err) {
    logger.warn('[Email] SendGrid init failed:', err.message);
    _sgWarned = true;
    return false;
  }
}

async function sendEmailViaSendGrid({ to, subject, html, text, from }) {
  if (!checkSendGridEnabled()) {
    throw new Error("SendGrid not available — SENDGRID_API_KEY missing or invalid");
  }

  const sgMail = require('@sendgrid/mail');
  const fromEmail = from || process.env.SMTP_FROM || process.env.SMTP_USER || process.env.ADMIN_EMAIL || 'noreply@altuvera.com';

  const msg = {
    to,
    from: fromEmail,
    subject,
    html,
    text: text || (html ? html.replace(/<[^>]*>/g, ' ').trim() : ''),
  };

  try {
    const [response] = await sgMail.send(msg);
    const messageId = response.headers['x-message-id'] || response.headers['X-Message-Id'];
    logger.info('✅ Email sent (SendGrid)', {
      to,
      subject: maskSensitiveInfo(subject),
      messageId: messageId || 'unknown',
      status: response.statusCode,
    });
    return { delivered: true, messageId };
  } catch (err) {
    logger.error('❌ SendGrid send failed:', {
      to,
      subject: maskSensitiveInfo(subject),
      error: err.message,
      code: err.code,
    });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send email — unified entry point
 * Priority: SendGrid (if configured) → SMTP (fallback)
 */
const sendEmail = async ({ to, subject, html, text, from } = {}) => {
  // Validate required fields first
  if (!to || !subject) {
    const msg = `Missing required email fields: to=${to}, subject=${subject}`;
    logger.error(`[Email] ${msg}`);
    throw new Error(msg);
  }
  if (!html && !text) {
    throw new Error("Email body missing: either html or text must be provided");
  }

  // — Try SendGrid if key is present —
  if (process.env.SENDGRID_API_KEY) {
    try {
      return await sendEmailViaSendGrid({ to, subject, html, text, from });
    } catch (err) {
      logger.warn('[Email] SendGrid failed, falling back to SMTP:', err.message);
      // fall through
    }
  }

  // — SMTP fallback —
  return sendEmailSMTP({ to, subject, html, text, from });
};

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORTER VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

const verifyTransporter = async () => {
  if (process.env.SENDGRID_API_KEY) {
    try {
      checkSendGridEnabled();
      logger.info('[Email] ✅ SendGrid credentials verified');
      return true;
    } catch (e) {
      logger.warn('[Email] SendGrid verification failed:', e.message);
    }
  }

  const t = getTransporter();
  if (!t) {
    throw new Error("SMTP transporter not initialized — check SMTP credentials");
  }
  return new Promise((resolve, reject) => {
    t.verify((err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// BOOKING EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

const buildSimpleBookingHtml = (booking, heading) => {
  const appName       = escape(process.env.APP_NAME || "Altuvera Travel");
  const bookingNumber = escape(booking?.booking_number || booking?.bookingNumber || "—");
  const status        = escape(booking?.status        || "pending");
  const name          = escape(booking?.full_name     || booking?.fullName || "Traveler");
  const travelDate    = escape(booking?.travel_date   || booking?.travelDate || "");
  const destination   = escape(booking?.destination_name || booking?.destinationName || "");
  const service       = escape(booking?.service_name  || booking?.serviceName || "");

  return `
    <div style="font-family:Segoe UI,Roboto,Arial,sans-serif;line-height:1.6;color:#111;">
      <h2 style="color:#059669;">${escape(heading)}</h2>
      <p>Hi ${name},</p>
      <p>
        Your booking <strong>#${bookingNumber}</strong> is currently
        <strong style="color:#059669;">${status}</strong>.
      </p>
      <ul style="padding-left:20px;line-height:2;">
        ${travelDate  ? `<li><strong>Travel date:</strong> ${travelDate}</li>`  : ""}
        ${destination ? `<li><strong>Destination:</strong> ${destination}</li>` : ""}
        ${service     ? `<li><strong>Service:</strong> ${service}</li>`         : ""}
      </ul>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p style="color:#9ca3af;font-size:12px;">
        &copy; ${new Date().getFullYear()} ${appName} — all rights reserved
      </p>
    </div>
  `;
};

const sendBookingConfirmation = (booking) =>
  sendEmail({
    to:      booking?.email,
    subject: `Booking confirmation ${booking?.booking_number || ""}`.trim(),
    html:    buildSimpleBookingHtml(booking, "Booking Confirmed ✅"),
  });

const sendBookingStatusUpdate = (booking) =>
  sendEmail({
    to:      booking?.email,
    subject: `Booking update ${booking?.booking_number || ""}`.trim(),
    html:    buildSimpleBookingHtml(booking, "Booking Status Update"),
  });

const sendBookingCancellation = (booking) =>
  sendEmail({
    to:      booking?.email,
    subject: `Booking cancelled ${booking?.booking_number || ""}`.trim(),
    html:    buildSimpleBookingHtml(booking, "Booking Cancelled"),
  });

const sendAdminBookingNotification = (booking) =>
  sendEmail({
    to:      process.env.ADMIN_EMAIL || process.env.EMAIL_FROM || process.env.SMTP_USER,
    subject: `New booking ${booking?.booking_number || ""}`.trim(),
    html:    buildSimpleBookingHtml(booking, "New Booking Received 🌍"),
  });

const sendContactNotification = ({ name, email, subject: msgSubject, message } = {}) =>
  sendEmail({
    to:      process.env.ADMIN_EMAIL || process.env.EMAIL_FROM || process.env.SMTP_USER,
    subject: `New contact: ${msgSubject || "Message"}`,
    html: `
      <div style="font-family:Segoe UI,Roboto,Arial,sans-serif;line-height:1.6;color:#111;">
        <h2 style="color:#059669;">New Contact Message</h2>
        <p><strong>Name:</strong>    ${escape(name)}</p>
        <p><strong>Email:</strong>   ${escape(email)}</p>
        <p><strong>Subject:</strong> ${escape(msgSubject)}</p>
        <p><strong>Message:</strong><br>
          <span style="white-space:pre-wrap;">${escape(message)}</span>
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="color:#9ca3af;font-size:12px;">
          Sent via ${escape(process.env.APP_NAME || "Altuvera")} contact form
        </p>
      </div>
    `,
  });

const sendContactReply = ({ to, subject, html: bodyHtml } = {}) =>
  sendEmail({
    to,
    subject: subject || "Thanks for contacting us",
    html: bodyHtml || `
      <div style="font-family:Segoe UI,Roboto,Arial,sans-serif;line-height:1.6;">
        <p>We received your message and will get back to you shortly.</p>
        <p style="color:#9ca3af;font-size:12px;">
          — The ${escape(process.env.APP_NAME || "Altuvera")} Team
        </p>
      </div>
    `,
  });

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  sendEmail,
  sendBookingConfirmation,
  sendBookingStatusUpdate,
  sendBookingCancellation,
  sendAdminBookingNotification,
  sendContactNotification,
  sendContactReply,
  verifyTransporter,
  // Exposed for testing / health checks
  _getEmailConfig: getEmailConfig,
  _getTransporter: getTransporter,
};
