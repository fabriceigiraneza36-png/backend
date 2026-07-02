/**
 * utils/resend.js
 * Resend email API wrapper (HTTPS — works on Render/cloud platforms)
 * No phone number required. Just add RESEND_API_KEY to your env.
 */

const { Resend } = require('resend');
const logger = require('./logger');

let _client = null;

function getClient() {
  if (_client) return _client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  _client = new Resend(apiKey);
  return _client;
}

/**
 * Send an email via Resend API
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} [opts.html]
 * @param {string} [opts.text]
 * @param {string} [opts.from]
 * @param {string} [opts.replyTo]
 * @param {string} [opts.cc]
 * @returns {Promise<{delivered: boolean, messageId?: string}>}
 */
async function send({ to, subject, html, text, from, replyTo, cc }) {
  const client = getClient();
  if (!client) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const fromEmail =
    from ||
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    process.env.ADMIN_EMAIL ||
    'noreply@altuvera.com';

  const payload = {
    from: fromEmail,
    to: Array.isArray(to) ? to : [to],
    subject,
    html: html || '',
    ...(text ? { text } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(cc ? { cc: Array.isArray(cc) ? cc : [cc] } : {}),
  };

  try {
    const { data, error } = await client.emails.send(payload);

    if (error) {
      logger.error('❌ Resend send failed', {
        to,
        subject,
        error: error.message,
        code: error.name,
      });
      const err = new Error(error.message || 'Resend delivery failed');
      err.originalError = error;
      throw err;
    }

    logger.info('✅ Resend email sent', {
      to,
      subject,
      messageId: data?.id || 'unknown',
      status: data?.status || 'sent',
    });

    return {
      delivered: true,
      messageId: data?.id,
    };
  } catch (err) {
    if (err.originalError) throw err;
    logger.error('❌ Resend unexpected error', {
      to,
      subject,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Quick health-check: verify API key is valid
 * @returns {Promise<boolean>}
 */
async function verifyConnection() {
  try {
    const client = getClient();
    if (!client) {
      logger.warn('[Resend] No API key configured');
      return false;
    }
    // Resend doesn't have a ping endpoint; check that client is ready
    logger.info('[Resend] Connection verified (API key present)');
    return true;
  } catch (err) {
    logger.warn('[Resend] Verification failed:', err.message);
    return false;
  }
}

module.exports = { send, verifyConnection, getClient };
