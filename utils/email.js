// utils/email.js
// ═══════════════════════════════════════════════════════════════════════════
// Centralized email utility
// ✅ IPv4 forced via:
//    1. dns.setDefaultResultOrder("ipv4first") in server.js (global)
//    2. family: 4 in nodemailer transport (belt-and-suspenders)
// ═══════════════════════════════════════════════════════════════════════════

"use strict";

const nodemailer = require("nodemailer");
const logger     = require("./logger");

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG READER
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
// SINGLETON TRANSPORTER
// ═══════════════════════════════════════════════════════════════════════════
// Created once and reused — avoids opening a new TCP connection per email.

let _transporter = null;
let _transporterConfig = null;

const getTransporter = () => {
  const config = getEmailConfig();

  if (!config.isConfigured) return null;

  // Re-create if SMTP config changed at runtime (edge case / hot reload)
  const configKey = `${config.smtpHost}:${config.smtpPort}:${config.smtpUser}`;
  if (_transporter && _transporterConfig === configKey) return _transporter;

  _transporter = nodemailer.createTransport({
    host:   config.smtpHost,
    port:   config.smtpPort,
    family: 4,                           // ✅ Force IPv4 — prevents ENETUNREACH
    secure: config.smtpPort === 465,     // true = TLS, false = STARTTLS (587)
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
    tls: {
      rejectUnauthorized: true,          // enforce valid TLS certs in production
    },
    // Connection pool — reuse connections, don't open a new one per email
    pool:           true,
    maxConnections: 5,
    maxMessages:    100,
    rateDelta:      1000,                // ms window for rate limiting
    rateLimit:      5,                   // max messages per rateDelta window
    // Timeouts
    connectionTimeout: 10_000,          // 10s to establish connection
    greetingTimeout:   10_000,          // 10s for SMTP greeting
    socketTimeout:     30_000,          // 30s socket idle timeout
  });

  _transporterConfig = configKey;

  // Verify on first creation (non-blocking)
  _transporter.verify((err) => {
    if (err) {
      logger.error("❌ SMTP connection failed:", {
        message: err.message,
        host:    config.smtpHost,
        port:    config.smtpPort,
        user:    config.smtpUser,
        hint:    err.message.includes("ENETUNREACH")
          ? "IPv6 connectivity issue — family:4 is set, check your SMTP_HOST env var"
          : undefined,
      });
    } else {
      logger.info(`✅ SMTP connected → ${config.smtpHost}:${config.smtpPort} (IPv4)`);
    }
  });

  return _transporter;
};

// ═══════════════════════════════════════════════════════════════════════════
// HTML ESCAPE HELPER
// ═══════════════════════════════════════════════════════════════════════════

const escape = (value) =>
  String(value ?? "")
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;");

// ═══════════════════════════════════════════════════════════════════════════
// CORE SEND FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a single email.
 *
 * @param {object} opts
 * @param {string}  opts.to       - Recipient address
 * @param {string}  opts.subject  - Email subject
 * @param {string}  [opts.html]   - HTML body
 * @param {string}  [opts.text]   - Plain-text body (auto-derived from html if omitted)
 * @param {string}  [opts.from]   - Sender (defaults to SMTP_FROM env / SMTP_USER)
 * @returns {Promise<{delivered: boolean, messageId?: string, fallback?: string}>}
 */
const sendEmail = async ({ to, subject, html, text, from } = {}) => {
  // Validate required fields
  if (!to || !subject) {
    logger.warn("[Email] Missing required fields (to / subject) — skipping", { to, subject });
    return { delivered: false, fallback: "missing-fields" };
  }
  if (!html && !text) {
    logger.warn("[Email] No html or text body provided — skipping", { to, subject });
    return { delivered: false, fallback: "no-body" };
  }

  const config      = getEmailConfig();
  const transporter = getTransporter();

  if (!transporter) {
    logger.warn("[Email] SMTP not configured — skipping send", { to, subject });
    // In development, log the email to console so developers can still see OTPs
    if (process.env.NODE_ENV !== "production") {
      logger.info("──────────────────────────────────────────");
      logger.info(`[Email DEV LOG] To: ${to}`);
      logger.info(`[Email DEV LOG] Subject: ${subject}`);
      if (text)  logger.info(`[Email DEV LOG] Text: ${text}`);
      if (html)  logger.info(`[Email DEV LOG] HTML: (rendered, check above)`);
      logger.info("──────────────────────────────────────────");
    }
    return { delivered: false, fallback: "console" };
  }

  const appName = process.env.APP_NAME || "Altuvera";
  const mailOptions = {
    from:    from || config.smtpFrom || `"${appName}" <${config.smtpUser}>`,
    to,
    subject,
    html,
    // Strip HTML tags for plain-text fallback if text not provided
    text: text || (html ? html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : ""),
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`✅ Email sent`, {
      to,
      subject,
      messageId: info.messageId,
      response:  info.response,
    });
    return { delivered: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`❌ Email failed`, {
      to,
      subject,
      error:   err.message,
      code:    err.code,
      command: err.command,
      // Actionable hints
      hint: err.message?.includes("ENETUNREACH")
        ? "IPv6 routing issue — verify family:4 is set and server has IPv4 outbound access"
        : err.message?.includes("ECONNREFUSED")
        ? "SMTP server refused connection — check SMTP_HOST and SMTP_PORT"
        : err.message?.includes("auth")
        ? "SMTP authentication failed — verify SMTP_USER and SMTP_PASS (use App Password for Gmail)"
        : undefined,
    });
    throw err; // re-throw so callers can handle / suppress as needed
  }
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

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════

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

const sendContactNotification = ({ name, email, subject, message } = {}) =>
  sendEmail({
    to:      process.env.ADMIN_EMAIL || process.env.EMAIL_FROM || process.env.SMTP_USER,
    subject: `New contact: ${subject || "Message"}`,
    html: `
      <div style="font-family:Segoe UI,Roboto,Arial,sans-serif;line-height:1.6;color:#111;">
        <h2 style="color:#059669;">New Contact Message</h2>
        <p><strong>Name:</strong>    ${escape(name)}</p>
        <p><strong>Email:</strong>   ${escape(email)}</p>
        <p><strong>Subject:</strong> ${escape(subject)}</p>
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

const sendContactReply = ({ to, subject, html } = {}) =>
  sendEmail({
    to,
    subject: subject || "Thanks for contacting us",
    html:    html    || `
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
  // Exposed for testing
  _getEmailConfig:   getEmailConfig,
  _getTransporter:   getTransporter,
};