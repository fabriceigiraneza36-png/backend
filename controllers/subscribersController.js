/**
 * controllers/subscribersController.js
 * Full subscriber management with real email delivery & DB tracking
 */

const { query }                    = require('../config/db');
const { paginate }                 = require('../utils/helpers');
const { sendEmail }                = require('../utils/emailService');
const { welcomeSubscriberEmail }   = require('../utils/emailTemplates');
const logger                       = require('../utils/logger');

// ── Helper: generate unsubscribe URL ─────────────────────────────────────────

const getUnsubscribeUrl = (email) => {
  // Use BACKEND_URL for the actual unsubscribe API endpoint
  const base = process.env.BACKEND_URL || 'http://localhost:3000';
  return `${base}/api/subscribers/unsubscribe/${encodeURIComponent(email)}`;
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/subscribers — Subscribe
// ═══════════════════════════════════════════════════════════════════════════════

exports.subscribe = async (req, res, next) => {
  try {
    const {
      email,
      name   = null,
      source = 'website',
      userId = null,  // Optional: from authenticated user
    } = req.body;

    // ── Validate ─────────────────────────────────────────────────────────────
    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error:   'Email is required',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        error:   'Invalid email address',
      });
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const userAgent = req.headers['user-agent'] || null;

    // ── Check existing subscriber ─────────────────────────────────────────────
    const existing = await query(
      `SELECT id, is_active, welcome_sent, name, user_id FROM subscribers WHERE email = $1`,
      [cleanEmail],
    );

    const isExisting    = existing.rows.length > 0;
    const wasActive     = isExisting && existing.rows[0].is_active;
    const welcomeSent   = isExisting && existing.rows[0].welcome_sent;

    // Already active — don't spam them
    if (wasActive) {
      return res.status(200).json({
        success: true,
        message: 'You are already subscribed!',
        alreadySubscribed: true,
      });
    }

    // ── Upsert subscriber ─────────────────────────────────────────────────────
    let subscriberRow;

    if (isExisting) {
      // Re-subscribing (was unsubscribed before)
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
      // Brand new subscriber
      const result = await query(
        `INSERT INTO subscribers
           (email, name, source, user_id, ip_address, user_agent,
            is_active, welcome_sent, subscribed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, false, NOW(), NOW(), NOW())
         RETURNING *`,
        [cleanEmail, name || null, source, userId || null, ipAddress, userAgent],
      );
      subscriberRow = result.rows[0];
      logger.info(`[Subscribers] New subscriber: ${cleanEmail}`);
    }

    // ── Update user profile to mark as subscribed (if user_id provided) ──────────
    if (userId) {
      await query(
        `UPDATE users SET subscribed = true, updated_at = NOW() WHERE id = $1`,
        [userId],
      ).catch((err) => logger.warn(`[Subscribers] Failed to update user subscribed flag: ${err.message}`));
    }

    // ── Send welcome email ────────────────────────────────────────────────────
    // Only send if welcome has never been sent to this address
    if (!welcomeSent) {
      // Don't await — send async so response is instant
      sendWelcomeEmail(subscriberRow.id, cleanEmail, name).catch((err) => {
        logger.error(`[Subscribers] sendWelcomeEmail threw: ${err.message}`);
      });
    }

    // ── Respond immediately ───────────────────────────────────────────────────
    return res.status(201).json({
      success:       true,
      message:       'Subscribed successfully! Please check your inbox for a welcome email.',
      subscriber: {
        id:           subscriberRow.id,
        email:        subscriberRow.email,
        name:         subscriberRow.name,
        subscribedAt: subscriberRow.subscribed_at,
      },
    });
  } catch (err) {
    logger.error('[Subscribers] subscribe error:', err.message);
    next(err);
  }
};

// ── Internal: send welcome email & update DB record ──────────────────────────

async function sendWelcomeEmail(subscriberId, email, name) {
  try {
    logger.info(`[Subscribers] Sending welcome email to ${email}...`);

    const htmlBody = welcomeSubscriberEmail(email, name);

    const result = await sendEmail(
      email,
      '🌿 Welcome to Altuvera Travel — Your Adventure Begins!',
      htmlBody,
    );

    if (result.success) {
      // Mark welcome as sent in DB
      await query(
        `UPDATE subscribers
           SET welcome_sent    = true,
               welcome_sent_at = NOW(),
               welcome_error   = NULL,
               updated_at      = NOW()
         WHERE id = $1`,
        [subscriberId],
      );
      logger.info(`[Subscribers] ✅ Welcome email sent to ${email} | msgId: ${result.messageId}`);
    } else {
      // Store the error in DB for debugging
      await query(
        `UPDATE subscribers
           SET welcome_sent  = false,
               welcome_error = $2,
               updated_at    = NOW()
         WHERE id = $1`,
        [subscriberId, result.error || 'Unknown error'],
      );
      logger.warn(`[Subscribers] ⚠️  Welcome email failed for ${email}: ${result.error}`);
    }

    return result;
  } catch (err) {
    // Store error in DB
    await query(
      `UPDATE subscribers
         SET welcome_error = $2, updated_at = NOW()
       WHERE id = $1`,
      [subscriberId, err.message],
    ).catch(() => {});

    logger.error(`[Subscribers] sendWelcomeEmail error for ${email}: ${err.message}`);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/subscribers/unsubscribe/:email  (email link click)
// DELETE /api/subscribers/unsubscribe/:email  (API call)
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
      if (req.method === 'GET') {
        return res.send(unsubscribeHtml(email, false));
      }
      return res.status(404).json({ success: false, error: 'Email not found' });
    }

    logger.info(`[Subscribers] Unsubscribed: ${email}`);

    // Browser click (GET from email link)
    if (req.method === 'GET') {
      return res.send(unsubscribeHtml(email, true));
    }

    return res.json({ success: true, message: 'Unsubscribed successfully' });
  } catch (err) {
    logger.error('[Subscribers] unsubscribe error:', err.message);
    next(err);
  }
};

// ── Unsubscribe HTML page ─────────────────────────────────────────────────────

function unsubscribeHtml(email, success) {
  const frontendUrl = process.env.FRONTEND_URL || 'https://altuvera.vercel.app';

  if (success) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Unsubscribed — Altuvera Travel</title>
</head>
<body style="margin:0;padding:0;background:#F0FDF4;font-family:'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;">
  <div style="background:#fff;border-radius:24px;box-shadow:0 4px 24px rgba(22,163,74,0.1);padding:56px 48px;max-width:440px;width:90%;text-align:center;">
    <div style="font-size:56px;margin-bottom:20px;">👋</div>
    <h2 style="color:#14532D;font-size:24px;margin:0 0 12px;">You've Been Unsubscribed</h2>
    <p style="color:#5A7A5A;line-height:1.7;margin:0 0 8px;">
      We've removed <strong>${email}</strong> from our mailing list.
    </p>
    <p style="color:#5A7A5A;line-height:1.7;margin:0 0 32px;">
      You won't receive any more emails from us. We're sorry to see you go!
    </p>
    <a href="${frontendUrl}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#15803D,#22C55E);color:#fff;text-decoration:none;border-radius:50px;font-weight:700;font-size:15px;">
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
<body style="margin:0;padding:0;background:#FEF2F2;font-family:'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;">
  <div style="background:#fff;border-radius:24px;padding:56px 48px;max-width:440px;width:90%;text-align:center;">
    <div style="font-size:56px;margin-bottom:20px;">🤔</div>
    <h2 style="color:#991B1B;margin:0 0 12px;">Email Not Found</h2>
    <p style="color:#6B7280;">We couldn't find <strong>${email}</strong> in our list.</p>
    <a href="${frontendUrl}" style="display:inline-block;margin-top:24px;padding:14px 36px;background:#15803D;color:#fff;text-decoration:none;border-radius:50px;font-weight:700;">
      Go Home
    </a>
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/subscribers — Admin: list all
// ═══════════════════════════════════════════════════════════════════════════════

exports.getAll = async (req, res, next) => {
  try {
    const {
      page      = 1,
      limit     = 50,
      is_active,
      search,
      source,
    } = req.query;

    const params = [];
    const where  = [];
    let   idx    = 1;

    if (is_active !== undefined) {
      where.push(`is_active = $${idx++}`);
      params.push(is_active === 'true');
    }
    if (search) {
      where.push(`(email ILIKE $${idx++} OR name ILIKE $${idx - 1})`);
      params.push(`%${search}%`);
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
         ip_address, tags, created_at
       FROM subscribers
       ${whereClause}
       ORDER BY subscribed_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    return res.json({
      success: true,
      data:    dataRes.rows,
      pagination,
      stats: {
        total,
        active:   dataRes.rows.filter((r) => r.is_active).length,
      },
    });
  } catch (err) {
    logger.error('[Subscribers] getAll error:', err.message);
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/subscribers/stats — Admin: stats
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
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)         AS today,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')  AS this_week,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') AS this_month
      FROM subscribers
    `);

    return res.json({ success: true, stats: rows[0] });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/subscribers/:id — Admin: hard delete
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
// POST /api/subscribers/resend-welcome/:id — Admin: resend welcome email
// ═══════════════════════════════════════════════════════════════════════════════

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

    // Reset welcome_sent so the send function updates it
    await query(
      `UPDATE subscribers SET welcome_sent = false, welcome_error = NULL WHERE id = $1`,
      [subscriber.id],
    );

    // Send synchronously so admin gets result
    const result = await sendWelcomeEmail(subscriber.id, subscriber.email, subscriber.name);

    return res.json({
      success:   result.success,
      message:   result.success ? 'Welcome email resent successfully' : 'Failed to send email',
      messageId: result.messageId || null,
      error:     result.error     || null,
    });
  } catch (err) {
    next(err);
  }
};