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

async function sendPushToSubscription (subscription, payload) {
  if (!pushReady) throw new Error('Web Push is not initialized. Configure stable VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the backend.')
  if (!subscription) throw new Error('Push subscription is missing.')
  try {
    const result = await webpush.sendNotification(subscription, JSON.stringify(payload))
    return result
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      logger.info('[Push] Subscription expired/gone, will be cleaned by retry')
    } else {
      logger.warn('[Push] sendNotification failed:', { statusCode: err.statusCode || null, message: err.message, endpoint: String(subscription.endpoint || '').slice(0, 90) })
    }
    throw err
  }
}

async function sendPushToSubscriptions (subscriptions, payload) {
  const results = []
  for (const sub of subscriptions) {
    try {
      const res = await sendPushToSubscription(sub, payload)
      results.push({ endpoint: sub.endpoint, success: true, result: res })
    } catch {
      results.push({ endpoint: sub.endpoint, success: false, statusCode: null })
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
