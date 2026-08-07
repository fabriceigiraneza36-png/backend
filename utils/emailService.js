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

  // Use SendGrid if API key is provided, otherwise fall back to SMTP
  if (process.env.SENDGRID_API_KEY) {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    logger.info('[Email] Using SendGrid transporter');
    return {
      sendMail: async (mailOptions) => {
        try {
          const msg = {
            to: mailOptions.to,
            from: mailOptions.from || process.env.SENDGRID_FROM_EMAIL || `Altuvera Travel <${process.env.SMTP_USER}>`,
            subject: mailOptions.subject,
            html: mailOptions.html,
            text: mailOptions.text,
          };
          
            const result = await sgMail.send(msg);
            logger.info(`[Email] Sent successfully via SendGrid to ${mailOptions.to}`);
            return result[0]; // SendGrid returns an array, we want the first element
          } catch (err) {
            logger.error(`[Email] Error sending via SendGrid to ${mailOptions.to}: ${err.message}`);
            throw err;
        }
      }
    };
  }

  // Fallback to SMTP transporter
  const config = {
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    family: 4, // Force IPv4 — prevents ENETUNREACH errors
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Critical for Gmail on Render/cloud hosts:
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    },
    // Connection pool — reuse connections
    pool:           true,
    maxConnections: 5,
    maxMessages:    100,
    rateDelta:      1000,
    rateLimit:      5,
    // Timeouts
    connectionTimeout: 10000,
    greetingTimeout:   10000,
    socketTimeout:     30000,
  };

  transporter = nodemailer.createTransport(config);

  logger.info(`[Email] Transporter created — ${config.host}:${config.port} (IPv4 forced)`);
  return transporter;
};

// ── Verify connection on startup ───────────────────────────────────────────────

const verifyEmailConnection = async () => {
    // Use SendGrid verification if API key is provided
    if (process.env.SENDGRID_API_KEY) {
      try {
        // SendGrid doesn't have a direct verification method like SMTP
        // We'll just check if the API key is set
        if (process.env.SENDGRID_API_KEY) {
          logger.info('[Email] SendGrid API key configured');
          return true;
        }
      } catch (err) {
        logger.warn(`[Email] Warning: SendGrid verification failed: ${err.message}`);
        logger.warn('[Email] Emails will still be attempted but may fail');
        return false;
      }
    }

    // Fallback to SMTP verification
    try {
      const t = getTransporter();
      await t.verify();
      logger.info('[Email] � ✅ SMTP connection verified successfully');
      return true;
    } catch (err) {
      logger.warn(`[Email] Warning: SMTP verification failed: ${err.message}`);
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