/**
 * utils/emailService.js
 * Robust SMTP email sender with full logging & error recovery
 */

const nodemailer = require('nodemailer');
const logger     = require('./logger');

// ── Build transporter ────────────────────────────────────────────────────────

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  const config = {
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Critical for Gmail on Render/cloud hosts:
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    },
    // Connection timeouts
    connectionTimeout: 10000, // 10s
    greetingTimeout:   10000,
    socketTimeout:     15000,
  };

  transporter = nodemailer.createTransport(config);

  logger.info(`[Email] Transporter created — ${config.host}:${config.port}`);
  return transporter;
};

// ── Verify SMTP on startup ───────────────────────────────────────────────────

const verifyEmailConnection = async () => {
  try {
    const t = getTransporter();
    await t.verify();
    logger.info('[Email] ✅ SMTP connection verified successfully');
    return true;
  } catch (err) {
    logger.warn(`[Email] ⚠️  SMTP verification failed: ${err.message}`);
    logger.warn('[Email] Emails will still be attempted but may fail');
    return false;
  }
};

// ── Core send function ───────────────────────────────────────────────────────

/**
 * Send an email
 * @param {string} to        - Recipient email
 * @param {string} subject   - Email subject
 * @param {string} html      - HTML body
 * @param {object} options   - Extra nodemailer options (cc, bcc, attachments…)
 * @returns {{ success, messageId, error }}
 */
const sendEmail = async (to, subject, html, options = {}) => {
  const fromAddress =
    process.env.SMTP_FROM ||
    `"Altuvera Travel" <${process.env.SMTP_USER}>`;

  const mailOptions = {
    from:    fromAddress,
    to,
    subject,
    html,
    // Plain-text fallback (strip HTML tags)
    text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    ...options,
  };

  try {
    logger.info(`[Email] Sending to ${to} | subject: "${subject}"`);

    const t      = getTransporter();
    const result = await t.sendMail(mailOptions);

    logger.info(
      `[Email] ✅ Sent successfully to ${to} | messageId: ${result.messageId}`,
    );

    return { success: true, messageId: result.messageId };
  } catch (err) {
    logger.error(`[Email] ❌ Failed to send to ${to}: ${err.message}`);
    logger.error(`[Email] Error code: ${err.code || 'UNKNOWN'}`);

    // Reset transporter on auth/connection errors so next attempt rebuilds it
    if (
      err.code === 'EAUTH' ||
      err.code === 'ECONNECTION' ||
      err.code === 'ETIMEDOUT' ||
      err.responseCode === 535
    ) {
      logger.warn('[Email] Resetting transporter due to connection/auth error');
      transporter = null;
    }

    return { success: false, error: err.message, code: err.code };
  }
};

module.exports = { sendEmail, verifyEmailConnection, getTransporter };