// backend/controllers/pushController.js
// ═══════════════════════════════════════════════════════════════════════════════
// Push Notifications Controller
// ═══════════════════════════════════════════════════════════════════════════════

const { query } = require('../config/db')
const pushUtil  = require('../utils/push')
const logger    = require('../utils/logger')
const { getUserBrowserPushEnabled, setUserBrowserPushEnabled } = require('../utils/pushSettings')

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/push/subscribe
   Body: { endpoint, p256dh, auth, userAgent }
   Returns: stored subscription (without sensitive keys spammed back)
   ───────────────────────────────────────────────────────────────────────────── */
exports.subscribe = async (req, res) => {
  try {
    const accountId   = req.admin?.id || req.user?.id
    const accountEmail = req.admin?.email || req.user?.email || ''
    if (!accountId) return res.status(401).json({ success: false, message: 'Sign in to enable push notifications.' })
    const { endpoint, p256dh, auth, userAgent } = req.body || {}

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ success: false, message: 'endpoint, p256dh, and auth are required.' })
    }

    // A browser endpoint belongs to the currently signed-in account (traveller,
    // manager, or admin). Reassign it on account changes rather than retaining
    // an endpoint under a previous account.
    await query(
      `DELETE FROM push_subscriptions WHERE endpoint=$1 AND admin_id<>$2`,
      [endpoint, accountId],
    )

    const existing = await query(
      `UPDATE push_subscriptions
         SET admin_email=$1, p256dh=$2, auth=$3, user_agent=$4, updated_at=NOW()
       WHERE endpoint=$5 AND admin_id=$6
       RETURNING id`,
      [accountEmail, p256dh, auth, userAgent || null, endpoint, accountId],
    )

    let subId
    if (existing.rows[0]) {
      subId = existing.rows[0].id
    } else {
      const inserted = await query(
        `INSERT INTO push_subscriptions (admin_id, admin_email, endpoint, p256dh, auth, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [accountId, accountEmail, endpoint, p256dh, auth, userAgent || null],
      )
      subId = inserted.rows[0]?.id
    }

    logger.info(`[Push] Account ${accountId} subscribed (subId=${subId})`)
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
    const accountId = req.admin?.id || req.user?.id
    const { endpoint } = req.body || {}
    if (!accountId) return res.status(401).json({ success: false, message: 'Sign in to manage push notifications.' })

    if (!endpoint) {
      return res.status(400).json({ success: false, message: 'endpoint is required.' })
    }

    await query(`DELETE FROM push_subscriptions WHERE endpoint=$1 AND admin_id=$2`, [endpoint, accountId])
    logger.info(`[Push] Account ${accountId} unsubscribed`)
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
   Returns the current account's subscriptions
   ───────────────────────────────────────────────────────────────────────────── */
exports.mySubscriptions = async (req, res) => {
  try {
    const accountId = req.admin?.id || req.user?.id
    if (!accountId) return res.status(401).json({ success: false, message: 'Sign in to view push subscriptions.' })
    const { rows } = await query(
      `SELECT id, endpoint, created_at FROM push_subscriptions WHERE admin_id=$1 ORDER BY created_at DESC`,
      [accountId],
    )
    return res.json({ success: true, data: rows })
  } catch (err) {
    logger.error('[Push] mySubscriptions failed:', err.message)
    return res.status(500).json({ success: false, message: 'Failed to load subscriptions.' })
  }
}


/* ─────────────────────────────────────────────────────────────────────────────
   Admin-managed end-user browser push delivery.
   Admin/manager notifications are always delivered when subscribed; this
   switch only controls browser pushes to regular Altuvera users.
   ───────────────────────────────────────────────────────────────────────────── */
exports.userDeliveryStatus = async (_req, res) => {
  try {
    return res.json({ success: true, enabled: await getUserBrowserPushEnabled() })
  } catch (err) {
    logger.error('[Push] user delivery status failed:', err.message)
    return res.status(500).json({ success: false, message: 'Could not load browser notification delivery status.' })
  }
}

exports.getUserDeliverySettings = async (_req, res) => {
  try {
    return res.json({
      success: true,
      enabled: await getUserBrowserPushEnabled(),
      adminAlwaysEnabled: true,
    })
  } catch (err) {
    logger.error('[Push] admin settings read failed:', err.message)
    return res.status(500).json({ success: false, message: 'Could not load user browser notification settings.' })
  }
}

exports.updateUserDeliverySettings = async (req, res) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'enabled must be a boolean.' })
    }
    const updated = await setUserBrowserPushEnabled(req.body.enabled, req.admin?.id || req.user?.id || null)
    return res.json({
      success: true,
      enabled: Boolean(updated.enabled),
      updatedAt: updated.updated_at,
      adminAlwaysEnabled: true,
    })
  } catch (err) {
    logger.error('[Push] admin settings update failed:', err.message)
    return res.status(500).json({ success: false, message: 'Could not update user browser notification settings.' })
  }
}
