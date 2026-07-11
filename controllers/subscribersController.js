/**
 * controllers/subscribersController.js
 * ═══════════════════════════════════════════════════════════════════════════════
 * Full subscriber management — safe requires, no created_at dependency
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { query }  = require('../config/db');
const logger     = require('../utils/logger');

// ── Safe require: paginate helper ─────────────────────────────────────────────
let paginate;
try {
  ({ paginate } = require('../utils/helpers'));
} catch {
  // Inline fallback
  paginate = (total, page, limit) => {
    const p   = Math.max(1, parseInt(page,  10) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    return {
      total,
      page:        p,
      limit:       lim,
      offset:      (p - 1) * lim,
      total_pages: Math.ceil(total / lim),
      has_next:    p < Math.ceil(total / lim),
      has_prev:    p > 1,
    };
  };
}

// ── Safe require: email sender ────────────────────────────────────────────────
let _sendEmail = null;
const EMAIL_PATHS = [
  '../utils/emailService',
  '../services/emailService',
  '../utils/email',
  '../services/email',
];
for (const p of EMAIL_PATHS) {
  try {
    const mod = require(p);
    _sendEmail = mod.sendEmail || mod.default || null;
    if (_sendEmail) {
      logger.info(`[Subscribers] Email service loaded from: ${p}`);
      break;
    }
  } catch { /* try next */ }
}
if (!_sendEmail) {
  logger.warn('[Subscribers] No email service found — welcome emails will be skipped');
  _sendEmail = async () => ({ success: false, error: 'Email service not configured' });
}

// ── Safe require: email templates ─────────────────────────────────────────────
let welcomeSubscriberEmail = null;
const TEMPLATE_PATHS = [
  '../utils/emailTemplates',
  '../services/emailTemplates',
  '../utils/templates',
];
for (const p of TEMPLATE_PATHS) {
  try {
    const mod = require(p);
    welcomeSubscriberEmail = mod.welcomeSubscriberEmail || mod.welcome || null;
    if (welcomeSubscriberEmail) break;
  } catch { /* try next */ }
}
if (!welcomeSubscriberEmail) {
  // Inline fallback template
  welcomeSubscriberEmail = (email, name) => `
    <!DOCTYPE html>
    <html>
    <body style="font-family:sans-serif;background:#f0fdf4;padding:40px 20px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;">
        <h1 style="color:#15803D;">Welcome to Altuvera Travel! 🌿</h1>
        <p>Hi ${name || 'Explorer'},</p>
        <p>Thank you for subscribing. We'll keep you updated with the best travel experiences from Rwanda and beyond.</p>
        <p style="color:#6B7280;font-size:13px;">If you didn't subscribe, you can safely ignore this email.</p>
      </div>
    </body>
    </html>
  `;
}

// ── Column existence cache ────────────────────────────────────────────────────
// Avoids repeated information_schema queries after first check
const _colCache = new Map();

async function columnExists(table, column) {
  const key = `${table}.${column}`;
  if (_colCache.has(key)) return _colCache.get(key);

  try {
    const { rows } = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = $1
         AND column_name  = $2
       LIMIT 1`,
      [table, column],
    );
    const exists = rows.length > 0;
    _colCache.set(key, exists);
    return exists;
  } catch {
    _colCache.set(key, false);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/subscribers — Subscribe
// ═══════════════════════════════════════════════════════════════════════════════

exports.subscribe = async (req, res, next) => {
  try {
    const {
      email,
      name   = null,
      source = 'website',
      userId = null,
    } = req.body;

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Invalid email address' });
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const userAgent = req.headers['user-agent'] || null;

    // ── Check existing ────────────────────────────────────────────────────────
    const existing = await query(
      `SELECT id, is_active, welcome_sent, name, user_id FROM subscribers WHERE email = $1`,
      [cleanEmail],
    );

    const isExisting  = existing.rows.length > 0;
    const wasActive   = isExisting && existing.rows[0].is_active;
    const welcomeSent = isExisting && existing.rows[0].welcome_sent;

    if (wasActive) {
      return res.status(200).json({
        success:           true,
        message:           'You are already subscribed!',
        alreadySubscribed: true,
      });
    }

    let subscriberRow;

    if (isExisting) {
      // ── Re-subscribe ──────────────────────────────────────────────────────
      const result = await query(
        `UPDATE subscribers
           SET is_active       = true,
               subscribed_at   = NOW(),
               resubscribed_at = NOW(),
               unsubscribed_at = NULL,
               name            = COALESCE($2, name),
               source          = COALESCE($3, source),
               user_id         = COALESCE($4, user_id),
               ip_address      = $5,
               user_agent      = $6,
               updated_at      = NOW()
         WHERE email = $1
         RETURNING *`,
        [cleanEmail, name || null, source, userId || null, ipAddress, userAgent],
      );
      subscriberRow = result.rows[0];
      logger.info(`[Subscribers] Re-subscribed: ${cleanEmail}`);

    } else {
      // ── New subscriber — build INSERT dynamically ─────────────────────────
      // Never assumes which columns exist. Checks at runtime (cached).
      const fields = ['email', 'name', 'source', 'user_id',
                      'ip_address', 'user_agent', 'is_active',
                      'welcome_sent', 'subscribed_at', 'updated_at'];
      const values = [cleanEmail, name || null, source, userId || null,
                      ipAddress, userAgent, true, false, new Date(), new Date()];

      // Add created_at only if the column actually exists
      const hasCreatedAt = await columnExists('subscribers', 'created_at');
      if (hasCreatedAt) {
        fields.push('created_at');
        values.push(new Date());
      }

      const cols         = fields.map(f => `"${f}"`).join(', ');
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

      const result = await query(
        `INSERT INTO subscribers (${cols}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      subscriberRow = result.rows[0];
      logger.info(`[Subscribers] New subscriber: ${cleanEmail}`);
    }

    // ── Update user subscribed flag ───────────────────────────────────────────
    if (userId) {
      query(
        `UPDATE users SET subscribed = true, updated_at = NOW() WHERE id = $1`,
        [userId],
      ).catch(err =>
        logger.warn(`[Subscribers] Failed to update user subscribed flag: ${err.message}`)
      );
    }

    // ── Send welcome email (non-blocking) ─────────────────────────────────────
    if (!welcomeSent) {
      sendWelcomeEmail(subscriberRow.id, cleanEmail, name).catch(err => {
        logger.error(`[Subscribers] sendWelcomeEmail threw: ${err.message}`);
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Subscribed successfully! Please check your inbox for a welcome email.',
      subscriber: {
        id:           subscriberRow.id,
        email:        subscriberRow.email,
        name:         subscriberRow.name,
        subscribedAt: subscriberRow.subscribed_at,
      },
    });

  } catch (err) {
    logger.error('[Subscribers] subscribe error:', err);
    next(err);
  }
};

// ── Internal: send welcome email & update DB ──────────────────────────────────

async function sendWelcomeEmail(subscriberId, email, name) {
  try {
    logger.info(`[Subscribers] Sending welcome email to ${email}...`);

    const htmlBody = welcomeSubscriberEmail(email, name);
    const result   = await _sendEmail(
      email,
      '🌿 Welcome to Altuvera Travel — Your Adventure Begins!',
      htmlBody,
    );

    if (result && result.success) {
      await query(
        `UPDATE subscribers
           SET welcome_sent    = true,
               welcome_sent_at = NOW(),
               welcome_error   = NULL,
               updated_at      = NOW()
         WHERE id = $1`,
        [subscriberId],
      ).catch(() => {});
      logger.info(`[Subscribers] ✅ Welcome email sent to ${email}`);
    } else {
      await query(
        `UPDATE subscribers
           SET welcome_sent  = false,
               welcome_error = $2,
               updated_at    = NOW()
         WHERE id = $1`,
        [subscriberId, (result && result.error) || 'Unknown error'],
      ).catch(() => {});
      logger.warn(`[Subscribers] ⚠️  Welcome email failed for ${email}`);
    }

    return result || { success: false };
  } catch (err) {
    await query(
      `UPDATE subscribers
         SET welcome_error = $2, updated_at = NOW()
       WHERE id = $1`,
      [subscriberId, err.message],
    ).catch(() => {});
    logger.error(`[Subscribers] sendWelcomeEmail error for ${email}: ${err.message}`);
    return { success: false, error: err.message };
    // Note: NOT re-throwing — welcome email failure must never affect subscription
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/subscribers/unsubscribe/:email
// DELETE /api/subscribers/unsubscribe/:email
// ═══════════════════════════════════════════════════════════════════════════════

exports.unsubscribe = async (req, res, next) => {
  try {
    const email = decodeURIComponent(req.params.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const result = await query(
      `UPDATE subscribers
         SET is_active       = false,
             unsubscribed_at = NOW(),
             updated_at      = NOW()
       WHERE email = $1
       RETURNING id, email`,
      [email],
    );

    if (result.rows.length === 0) {
      if (req.method === 'GET') return res.send(unsubscribeHtml(email, false));
      return res.status(404).json({ success: false, error: 'Email not found' });
    }

    logger.info(`[Subscribers] Unsubscribed: ${email}`);

    if (req.method === 'GET') return res.send(unsubscribeHtml(email, true));
    return res.json({ success: true, message: 'Unsubscribed successfully' });

  } catch (err) {
    logger.error('[Subscribers] unsubscribe error:', err.message);
    next(err);
  }
};

function unsubscribeHtml(email, success) {
  const frontendUrl = process.env.FRONTEND_URL || 'https://www.altuverasafaris.com';

  if (success) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Unsubscribed — Altuvera Travel</title>
</head>
<body style="margin:0;padding:0;background:#F0FDF4;font-family:'Segoe UI',sans-serif;
             display:flex;justify-content:center;align-items:center;min-height:100vh;">
  <div style="background:#fff;border-radius:24px;box-shadow:0 4px 24px rgba(22,163,74,0.1);
              padding:56px 48px;max-width:440px;width:90%;text-align:center;">
    <div style="font-size:56px;margin-bottom:20px;">👋</div>
    <h2 style="color:#14532D;font-size:24px;margin:0 0 12px;">You've Been Unsubscribed</h2>
    <p style="color:#5A7A5A;line-height:1.7;margin:0 0 8px;">
      We've removed <strong>${email}</strong> from our mailing list.
    </p>
    <p style="color:#5A7A5A;line-height:1.7;margin:0 0 32px;">
      We're sorry to see you go!
    </p>
    <a href="${frontendUrl}"
       style="display:inline-block;padding:14px 36px;
              background:linear-gradient(135deg,#15803D,#22C55E);
              color:#fff;text-decoration:none;border-radius:50px;
              font-weight:700;font-size:15px;">
      Visit Our Website
    </a>
    <p style="color:#9CA3AF;font-size:13px;margin-top:24px;">
      Changed your mind? You can always resubscribe on our website.
    </p>
  </div>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Not Found — Altuvera Travel</title>
</head>
<body style="margin:0;padding:0;background:#FEF2F2;font-family:'Segoe UI',sans-serif;
             display:flex;justify-content:center;align-items:center;min-height:100vh;">
  <div style="background:#fff;border-radius:24px;padding:56px 48px;
              max-width:440px;width:90%;text-align:center;">
    <div style="font-size:56px;margin-bottom:20px;">🤔</div>
    <h2 style="color:#991B1B;margin:0 0 12px;">Email Not Found</h2>
    <p style="color:#6B7280;">
      We couldn't find <strong>${email}</strong> in our list.
    </p>
    <a href="${frontendUrl}"
       style="display:inline-block;margin-top:24px;padding:14px 36px;
              background:#15803D;color:#fff;text-decoration:none;
              border-radius:50px;font-weight:700;">
      Go Home
    </a>
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/subscribers  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, is_active, search, source } = req.query;

    const params = [];
    const where  = [];
    let   idx    = 1;

    if (is_active !== undefined) {
      where.push(`is_active = $${idx++}`);
      params.push(is_active === 'true');
    }
    if (search) {
      where.push(`(email ILIKE $${idx} OR name ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (source) {
      where.push(`source = $${idx++}`);
      params.push(source);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await query(
      `SELECT COUNT(*) FROM subscribers ${whereClause}`,
      params,
    );

    const total      = parseInt(countRes.rows[0].count, 10);
    const pagination = paginate(total, page, limit);

    params.push(pagination.limit, pagination.offset);

    const dataRes = await query(
      `SELECT
         id, email, name, source, is_active,
         welcome_sent, welcome_sent_at, welcome_error,
         subscribed_at, unsubscribed_at, resubscribed_at,
         updated_at, ip_address, tags
       FROM subscribers
       ${whereClause}
       ORDER BY subscribed_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    return res.json({
      success:    true,
      data:       dataRes.rows,
      pagination,
      stats: {
        total,
        active: dataRes.rows.filter(r => r.is_active).length,
      },
    });
  } catch (err) {
    logger.error('[Subscribers] getAll error:', err.message);
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/subscribers/stats  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.getStats = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*)                                                    AS total,
        COUNT(*) FILTER (WHERE is_active = true)                   AS active,
        COUNT(*) FILTER (WHERE is_active = false)                  AS unsubscribed,
        COUNT(*) FILTER (WHERE welcome_sent = true)                AS welcome_sent,
        COUNT(*) FILTER (WHERE welcome_sent = false AND is_active) AS welcome_pending,
        COUNT(*) FILTER (WHERE welcome_error IS NOT NULL)          AS welcome_failed,
        COUNT(*) FILTER (
          WHERE subscribed_at >= CURRENT_DATE
        )                                                           AS today,
        COUNT(*) FILTER (
          WHERE subscribed_at >= CURRENT_DATE - INTERVAL '7 days'
        )                                                           AS this_week,
        COUNT(*) FILTER (
          WHERE subscribed_at >= CURRENT_DATE - INTERVAL '30 days'
        )                                                           AS this_month
      FROM subscribers
    `);

    return res.json({ success: true, stats: rows[0] });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/subscribers/:id  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.remove = async (req, res, next) => {
  try {
    const result = await query(
      `DELETE FROM subscribers WHERE id = $1 RETURNING id, email`,
      [req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Subscriber not found' });
    }

    logger.info(`[Subscribers] Deleted: ${result.rows[0].email}`);
    return res.json({ success: true, message: 'Subscriber deleted' });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/subscribers/resend-welcome/:id  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.sendNewsletter = async (req, res, next) => {
  try {
    const { subject, body, html: rawHtml } = req.body || {};

    if (!subject || !String(subject).trim()) {
      return res.status(422).json({ success: false, error: 'Subject is required.' });
    }
    if (!body || !String(body).trim()) {
      return res.status(422).json({ success: false, error: 'Body is required.' });
    }

    const cleanSubject = String(subject).trim();
    const textBody     = String(body).trim();

    const htmlBody = rawHtml && String(rawHtml).trim()
      ? String(rawHtml)
      : `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f0fdf4;padding:40px 20px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;">
    <h1 style="color:#15803D;margin-top:0;">${cleanSubject}</h1>
    <div style="color:#1f2937;line-height:1.7;white-space:pre-wrap;">${textBody.replace(/</g, '&lt;')}</div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;" />
    <p style="color:#9CA3AF;font-size:12px;">
      You're receiving this because you subscribed to Altuvera Travel updates.<br/>
      <a href="${process.env.FRONTEND_URL || 'https://www.altuverasafaris.com'}/unsubscribe" style="color:#15803D;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;

    const { rows: subs } = await query(
      `SELECT id, email, name FROM subscribers WHERE is_active = true ORDER BY id`,
    );

    if (!subs.length) {
      return res.json({
        success: true,
        message: 'No active subscribers to send to.',
        sent: 0, failed: 0, total: 0,
      });
    }

    let sent = 0, failed = 0;
    const errors = [];

    for (const sub of subs) {
      try {
        const result = await _sendEmail(sub.email, cleanSubject, htmlBody);
        if (result && result.success === false) throw new Error(result.error || 'Send failed');
        sent++;
      } catch (err) {
        failed++;
        if (errors.length < 5) errors.push({ email: sub.email, error: err.message });
      }
      if (subs.length > 10) await new Promise((r) => setTimeout(r, 120));
    }

    logger.info(`[Subscribers] Newsletter sent: ${sent} ok, ${failed} failed`);

    return res.json({
      success: true,
      message: `Newsletter sent to ${sent} subscriber(s).`,
      sent, failed, total: subs.length,
      errors: failed ? errors : undefined,
    });
  } catch (err) {
    logger.error('[Subscribers] sendNewsletter error:', err);
    next(err);
  }
};

exports.resendWelcome = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, name FROM subscribers WHERE id = $1`,
      [req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Subscriber not found' });
    }

    const subscriber = rows[0];

    await query(
      `UPDATE subscribers
         SET welcome_sent = false, welcome_error = NULL
       WHERE id = $1`,
      [subscriber.id],
    );

    const result = await sendWelcomeEmail(
      subscriber.id,
      subscriber.email,
      subscriber.name,
    );

    return res.json({
      success:   result.success,
      message:   result.success
        ? 'Welcome email resent successfully'
        : 'Failed to send email',
      messageId: result.messageId || null,
      error:     result.error     || null,
    });
  } catch (err) {
    next(err);
  }
};