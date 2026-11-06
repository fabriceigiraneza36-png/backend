// backend/utils/push.js
// ═══════════════════════════════════════════════════════════════════════════════
// Web Push utilities via web-push
// ═══════════════════════════════════════════════════════════════════════════════

const webpush = require('web-push')
const logger  = require('./logger')

let vapidPublicKey  = null
let vapidPrivateKey = null
let pushReady       = false

function initPush () {
  try {
    vapidPublicKey  = process.env.VAPID_PUBLIC_KEY  || null
    vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || null

    if (!vapidPublicKey || !vapidPrivateKey) {
      pushReady = false
      if (process.env.NODE_ENV === 'production') {
        logger.error('[Push] Production VAPID keys are missing. Configure stable VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the backend environment; ephemeral keys invalidate existing subscriptions after restarts.')
        return
      }
      const keys = webpush.generateVAPIDKeys()
      vapidPublicKey  = keys.publicKey
      vapidPrivateKey = keys.privateKey
      logger.warn('[Push] Generated temporary VAPID keys for development only.')
    }

    webpush.setVapidDetails(
      'mailto:info@altuverasafaris.com',
      vapidPublicKey,
      vapidPrivateKey,
    )
    pushReady = true
    logger.info('[Push] Web Push initialized (vapid subject set)')
  } catch (err) {
    logger.warn('[Push] Initialization failed:', err.message)
  }
}

function getVapidPublicKey () {
  return vapidPublicKey
}

async function sendPushToSubscription (subscription, payload, sendOptions = {}) {
  if (!pushReady) throw new Error('Web Push is not initialized. Configure stable VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the backend.')
  if (!subscription?.endpoint) throw new Error('Push subscription endpoint is missing.')

  const keys = subscription.keys || {
    p256dh: subscription.p256dh,
    auth: subscription.auth,
  }
  if (!keys?.p256dh || !keys?.auth) {
    throw new Error('Push subscription is incomplete. Sync this browser again to store its encryption keys.')
  }
  const normalizedSubscription = {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
  }

  const ttl = Number.isInteger(sendOptions.TTL) && sendOptions.TTL >= 0
    ? sendOptions.TTL
    : 300
  const allowedUrgencies = ['very-low', 'low', 'normal', 'high']
  const urgency = allowedUrgencies.includes(sendOptions.urgency)
    ? sendOptions.urgency
    : 'normal'
  const options = { TTL: ttl, urgency }
  if (typeof sendOptions.topic === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(sendOptions.topic)) {
    options.topic = sendOptions.topic
  }

  try {
    return await webpush.sendNotification(normalizedSubscription, JSON.stringify(payload), options)
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      logger.info('[Push] Subscription expired/gone; the delivery layer will remove it.')
    } else {
      logger.warn('[Push] sendNotification failed:', {
        statusCode: err.statusCode || null,
        message: err.message,
        endpoint: String(subscription.endpoint || '').slice(0, 90),
      })
    }
    throw err
  }
}

async function sendPushToSubscriptions (subscriptions, payload, sendOptions = {}) {
  const results = []
  for (const sub of subscriptions) {
    try {
      const res = await sendPushToSubscription(sub, payload, sendOptions)
      results.push({ endpoint: sub.endpoint, success: true, result: res })
    } catch (err) {
      results.push({
        endpoint: sub.endpoint,
        success: false,
        statusCode: err.statusCode || null,
        error: err.message || 'Unknown Web Push delivery error',
      })
    }
  }
  return results
}

module.exports = {
  initPush,
  getVapidPublicKey,
  sendPushToSubscription,
  sendPushToSubscriptions,
}
