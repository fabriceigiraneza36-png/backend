// backend/controllers/pushController.js
// ═══════════════════════════════════════════════════════════════════════════════
// Push Notifications Controller
// ═══════════════════════════════════════════════════════════════════════════════

const { query } = require('../config/db')
const pushUtil  = require('../utils/push')
const logger    = require('../utils/logger')

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/push/subscribe
   Body: { endpoint, p256dh, auth, userAgent }
   Returns: stored subscription (without sensitive keys spammed back)
   ───────────────────────────────────────────────────────────────────────────── */
exports.subscribe = async (req, res) => {
  try {
    const adminId   = req.admin?.id   || req.user?.id   || 0
    const adminEmail = req.admin?.email || req.user?.email || ''
    const { endpoint, p256dh, auth, userAgent } = req.body || {}

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ success: false, message: 'endpoint, p256dh, and auth are required.' })
    }

    const existing = await query(
      `UPDATE push_subscriptions
         SET p256dh=$1, auth=$2, user_agent=$3, updated_at=NOW()
       WHERE endpoint=$4 AND admin_id=$5
       RETURNING id`,
      [p256dh, auth, userAgent || null, endpoint, adminId],
    )

    let subId
    if (existing.rows[0]) {
      subId = existing.rows[0].id
    } else {
      const inserted = await query(
        `INSERT INTO push_subscriptions (admin_id, admin_email, endpoint, p256dh, auth, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [adminId, adminEmail, endpoint, p256dh, auth, userAgent || null],
      )
      subId = inserted.rows[0]?.id
    }

    logger.info(`[Push] Admin ${adminId} subscribed (subId=${subId})`)
    return res.json({ success: true, id: subId })
  } catch (err) {
    logger.error('[Push] subscribe failed:', err.message)
    return res.status(500).json({ success: false, message: 'Subscription failed.' })
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/push/unsubscribe
   Body: { endpoint }
   Returns: { success }
   ───────────────────────────────────────────────────────────────────────────── */
exports.unsubscribe = async (req, res) => {
  try {
    const adminId = req.admin?.id || req.user?.id || 0
    const { endpoint } = req.body || {}

    if (!endpoint) {
      return res.status(400).json({ success: false, message: 'endpoint is required.' })
    }

    await query(`DELETE FROM push_subscriptions WHERE endpoint=$1 AND admin_id=$2`, [endpoint, adminId])
    logger.info(`[Push] Admin ${adminId} unsubscribed`)
    return res.json({ success: true })
  } catch (err) {
    logger.error('[Push] unsubscribe failed:', err.message)
    return res.status(500).json({ success: false, message: 'Unsubscribe failed.' })
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/push/vapid-public-key
   Returns: { publicKey }
   ───────────────────────────────────────────────────────────────────────────── */
exports.getVapidPublicKey = async (req, res) => {
  try {
    return res.json({ publicKey: pushUtil.getVapidPublicKey() || '' })
  } catch {
    return res.json({ publicKey: '' })
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/push/my-subscriptions
   Returns current admin's subscriptions
   ───────────────────────────────────────────────────────────────────────────── */
exports.mySubscriptions = async (req, res) => {
  try {
    const adminId = req.admin?.id || req.user?.id || 0
    const { rows } = await query(
      `SELECT id, endpoint, created_at FROM push_subscriptions WHERE admin_id=$1 ORDER BY created_at DESC`,
      [adminId],
    )
    return res.json({ success: true, data: rows })
  } catch (err) {
    logger.error('[Push] mySubscriptions failed:', err.message)
    return res.status(500).json({ success: false, message: 'Failed to load subscriptions.' })
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/push/test
   Sends a test push notification to all of current admin's subscriptions.
   ───────────────────────────────────────────────────────────────────────────── */
exports.test = async (req, res) => {
  try {
    const adminId = req.admin?.id || req.user?.id || 0
    const { rows } = await query(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE admin_id=$1`,
      [adminId],
    )
    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'No push subscriptions found for your account. Enable push notifications first.' })
    }

    const payload = {
      title: 'Altuvera Admin — Test Push',
      body: 'This is a test notification. Push is working!',
      icon: '/favicon.ico',
      data: { url: '/notifications' },
    }

    const results = await pushUtil.sendPushToSubscriptions(rows, payload)
    const success = results.filter(r => r.success).length

    logger.info(`[Push] Test push sent to admin ${adminId}: ${success}/${rows.length} delivered`)
    return res.json({
      success: true,
      message: `Sent ${success}/${rows.length} push notifications.`,
    })
  } catch (err) {
    logger.error('[Push] test failed:', err.message)
    return res.status(500).json({ success: false, message: 'Test push failed.' })
  }
}
