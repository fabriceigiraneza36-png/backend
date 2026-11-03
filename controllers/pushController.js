// backend/controllers/pushController.js
// ═══════════════════════════════════════════════════════════════════════════════
// Push Notifications Controller
// ═══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto')
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
    const accountId   = req.admin?.id || req.user?.id
    const accountEmail = req.admin?.email || req.user?.email || ''
    if (!accountId) return res.status(401).json({ success: false, message: 'Sign in to enable push notifications.' })
    const { endpoint, p256dh, auth, userAgent } = req.body || {}

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ success: false, message: 'endpoint, p256dh, and auth are required.' })
    }

    // A browser endpoint belongs to the currently signed-in admin only.
    // Reassign it on account changes rather than leaving a previous admin subscribed.
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
   Returns current admin's subscriptions
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
   POST /api/push/test
   Sends a test push notification to all of current admin's subscriptions.
   ───────────────────────────────────────────────────────────────────────────── */
// Browser receipts prove that the service worker received the push and that
// showNotification() resolved. Push-provider acceptance alone is not delivery.
let testDeliverySchemaPromise = null

async function ensureTestDeliverySchema () {
  if (!testDeliverySchemaPromise) {
    testDeliverySchemaPromise = (async () => {
      await query('CREATE TABLE IF NOT EXISTS push_test_deliveries (\n' +
        'id BIGSERIAL PRIMARY KEY,\n' +
        'test_id UUID NOT NULL,\n' +
        'admin_id INTEGER NOT NULL,\n' +
        'subscription_id INTEGER NOT NULL,\n' +
        'provider_accepted BOOLEAN NOT NULL DEFAULT FALSE,\n' +
        'provider_status INTEGER,\n' +
        'provider_error TEXT,\n' +
        'browser_received_at TIMESTAMPTZ,\n' +
        'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n' +
        'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n' +
        'UNIQUE (test_id, subscription_id)\n' +
        ')')
      await query('CREATE INDEX IF NOT EXISTS idx_push_test_deliveries_admin_test ' +
        'ON push_test_deliveries (admin_id, test_id)')
      await query("DELETE FROM push_test_deliveries WHERE created_at < NOW() - INTERVAL '30 days'").catch(() => {})
    })().catch((err) => {
      testDeliverySchemaPromise = null
      throw err
    })
  }
  return testDeliverySchemaPromise
}

function receiptTokenFor (testId, subscriptionId, adminId) {
  const secret = process.env.PUSH_RECEIPT_SECRET || process.env.JWT_SECRET
  if (!secret) throw new Error('Push receipt signing secret is not configured.')
  return crypto.createHmac('sha256', String(secret))
    .update(String(testId) + ':' + String(subscriptionId) + ':' + String(adminId))
    .digest('hex')
}

function safeReceiptTokenMatch (supplied, expected) {
  if (!/^[a-f0-9]{64}$/i.test(String(supplied || ''))) return false
  const left = Buffer.from(String(supplied), 'hex')
  const right = Buffer.from(expected, 'hex')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/* POST /api/push/test — send a real push and track browser receipts. */
exports.test = async (req, res) => {
  try {
    const adminId = Number(req.admin?.id || req.user?.id)
    if (!Number.isSafeInteger(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: 'Admin authentication is required.' })
    }

    await ensureTestDeliverySchema()
    const { rows } = await query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE admin_id=$1 ORDER BY updated_at DESC',
      [adminId],
    )

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: 'No browser subscriptions are registered for this admin. Re-enable or sync push notifications in this browser first.',
        total: 0,
        providerAccepted: 0,
        browserReceived: 0,
      })
    }

    if (!pushUtil.getVapidPublicKey()) {
      return res.status(503).json({
        success: false,
        message: 'Web Push is not configured on the backend. Stable VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY values are required.',
        total: rows.length,
        providerAccepted: 0,
        browserReceived: 0,
      })
    }

    if (!(process.env.PUSH_RECEIPT_SECRET || process.env.JWT_SECRET)) {
      return res.status(503).json({
        success: false,
        message: 'Browser receipt verification is not configured on the backend.',
        total: rows.length,
        providerAccepted: 0,
        browserReceived: 0,
      })
    }

    const testId = crypto.randomUUID()
    await Promise.all(rows.map((subscription) => query(
      'INSERT INTO push_test_deliveries (test_id, admin_id, subscription_id) VALUES ($1, $2, $3)',
      [testId, adminId, subscription.id],
    )))

    const backendBase = String(process.env.BACKEND_URL || 'https://backend-jd8f.onrender.com')
      .replace(/\/+$/, '')
      .replace(/\/api$/, '')
    const receiptUrl = backendBase + '/api/push/test-receipt'

    let providerAccepted = 0
    let providerFailed = 0

    for (const subscription of rows) {
      let accepted = false
      let providerStatus = null
      let providerError = null

      // Remove legacy/incomplete records before attempting Web Push. These were
      // observed in production logs and cannot be sent without both encryption keys.
      if (!subscription.p256dh || !subscription.auth) {
        providerFailed += 1
        providerError = 'Stored browser subscription is incomplete; this browser must sync a fresh subscription.'
        await query(
          'DELETE FROM push_subscriptions WHERE id=$1 AND admin_id=$2',
          [subscription.id, adminId],
        ).catch((deleteErr) => logger.warn('[Push] Could not remove incomplete subscription:', deleteErr.message))
        await query(
          'UPDATE push_test_deliveries SET provider_accepted=FALSE, provider_status=NULL, provider_error=$1, updated_at=NOW() ' +
          'WHERE test_id=$2 AND admin_id=$3 AND subscription_id=$4',
          [providerError, testId, adminId, subscription.id],
        )
        continue
      }

      try {
        const payload = {
          title: 'Altuvera Admin — Browser Test',
          body: 'This is a real push test. Your browser received the notification request.',
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'altuvera-admin-test-' + testId + '-' + subscription.id,
          data: {
            url: '/notifications',
            testId,
            subscriptionId: subscription.id,
            adminId,
            receiptToken: receiptTokenFor(testId, subscription.id, adminId),
            receiptUrl,
          },
        }

        const result = await pushUtil.sendPushToSubscription(subscription, payload)
        accepted = true
        providerStatus = Number(result && result.statusCode) || 201
        providerAccepted += 1
      } catch (err) {
        providerError = String((err && err.message) || 'Push provider rejected the subscription.')
        providerStatus = Number(err && err.statusCode) || null
        providerFailed += 1

        if (providerStatus === 404 || providerStatus === 410) {
          await query('DELETE FROM push_subscriptions WHERE id=$1 AND admin_id=$2', [subscription.id, adminId])
            .catch((deleteErr) => logger.warn('[Push] Could not remove expired subscription:', deleteErr.message))
        }
      }

      await query(
        'UPDATE push_test_deliveries SET provider_accepted=$1, provider_status=$2, provider_error=$3, updated_at=NOW() ' +
        'WHERE test_id=$4 AND admin_id=$5 AND subscription_id=$6',
        [accepted, providerStatus, providerError, testId, adminId, subscription.id],
      )
    }

    logger.info('[Push] Browser test ' + testId + ' for admin ' + adminId +
      ': provider accepted ' + providerAccepted + '/' + rows.length + '; browser receipts pending.')

    return res.status(200).json({
      success: true,
      testId,
      total: rows.length,
      providerAccepted,
      providerFailed,
      browserReceived: 0,
      message: 'Push requests have been processed. Waiting for each browser service worker to confirm receipt.',
    })
  } catch (err) {
    logger.error('[Push] test failed:', err.message)
    return res.status(500).json({ success: false, message: err.message || 'Test push failed.' })
  }
}

/* GET /api/push/test/:testId — authenticated browser receipt status. */
exports.testStatus = async (req, res) => {
  try {
    const adminId = Number(req.admin?.id || req.user?.id)
    const testId = String(req.params.testId || '')
    if (!Number.isSafeInteger(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: 'Admin authentication is required.' })
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(testId)) {
      return res.status(400).json({ success: false, message: 'Invalid test identifier.' })
    }

    await ensureTestDeliverySchema()
    const { rows } = await query(
      'SELECT COUNT(*)::int AS total, ' +
      'COUNT(*) FILTER (WHERE provider_accepted)::int AS provider_accepted, ' +
      'COUNT(*) FILTER (WHERE NOT provider_accepted)::int AS provider_failed, ' +
      'COUNT(*) FILTER (WHERE browser_received_at IS NOT NULL)::int AS browser_received, ' +
      'COUNT(*) FILTER (WHERE provider_accepted AND browser_received_at IS NULL)::int AS awaiting_browser_receipt ' +
      'FROM push_test_deliveries WHERE test_id=$1 AND admin_id=$2',
      [testId, adminId],
    )

    const summary = rows[0] || {}
    const total = Number(summary.total || 0)
    if (!total) {
      return res.status(404).json({ success: false, message: 'This test was not found for the signed-in admin.' })
    }

    const providerAccepted = Number(summary.provider_accepted || 0)
    const providerFailed = Number(summary.provider_failed || 0)
    const browserReceived = Number(summary.browser_received || 0)
    const awaitingBrowserReceipt = Number(summary.awaiting_browser_receipt || 0)

    return res.json({
      success: true,
      testId,
      total,
      providerAccepted,
      providerFailed,
      browserReceived,
      awaitingBrowserReceipt,
      status: browserReceived === total ? 'browser_confirmed' : providerAccepted > 0 ? 'awaiting_browser_receipt' : 'failed',
      message: browserReceived + ' of ' + total + ' browser(s) confirmed the notification display request.',
    })
  } catch (err) {
    logger.error('[Push] test status failed:', err.message)
    return res.status(500).json({ success: false, message: 'Could not verify browser delivery.' })
  }
}

/* POST /api/push/test-receipt — HMAC-signed callback from the service worker. */
exports.testReceipt = async (req, res) => {
  try {
    const { testId, subscriptionId, adminId, receiptToken } = req.body || {}
    const normalizedAdminId = Number(adminId)
    const normalizedSubscriptionId = Number(subscriptionId)

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(testId || '')) ||
      !Number.isSafeInteger(normalizedAdminId) ||
      normalizedAdminId <= 0 ||
      !Number.isSafeInteger(normalizedSubscriptionId) ||
      normalizedSubscriptionId <= 0
    ) {
      return res.status(400).json({ success: false, message: 'Invalid browser receipt.' })
    }

    await ensureTestDeliverySchema()
    const { rows } = await query(
      'SELECT admin_id, provider_accepted, created_at FROM push_test_deliveries WHERE test_id=$1 AND subscription_id=$2',
      [testId, normalizedSubscriptionId],
    )
    const delivery = rows[0]
    if (!delivery || Number(delivery.admin_id) !== normalizedAdminId) {
      return res.status(404).json({ success: false, message: 'Push test delivery was not found.' })
    }
    if (Date.now() - new Date(delivery.created_at).getTime() > 10 * 60 * 1000) {
      return res.status(410).json({ success: false, message: 'The browser receipt window has expired.' })
    }

    const expectedToken = receiptTokenFor(testId, normalizedSubscriptionId, normalizedAdminId)
    if (!safeReceiptTokenMatch(receiptToken, expectedToken)) {
      return res.status(403).json({ success: false, message: 'Invalid browser receipt signature.' })
    }

    await query(
      'UPDATE push_test_deliveries SET browser_received_at=COALESCE(browser_received_at, NOW()), updated_at=NOW() ' +
      'WHERE test_id=$1 AND subscription_id=$2 AND admin_id=$3',
      [testId, normalizedSubscriptionId, normalizedAdminId],
    )

    return res.json({ success: true, browserReceived: true })
  } catch (err) {
    logger.error('[Push] browser receipt failed:', err.message)
    return res.status(500).json({ success: false, message: 'Browser receipt could not be recorded.' })
  }
}
