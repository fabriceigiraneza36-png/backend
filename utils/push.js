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

    if (!vapidPrivateKey) {
      const keys = webpush.generateVAPIDKeys()
      vapidPublicKey  = keys.publicKey
      vapidPrivateKey = keys.privateKey
      logger.warn('[Push] VAPID keys not found in env. Generated ephemeral keys. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env for production.')
    }

    webpush.setVapidDetails(
      'mailto:admin@altuvera.com',
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
  if (!pushReady || !subscription) return null
  try {
    const result = await webpush.sendNotification(subscription, JSON.stringify(payload))
    return result
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      logger.info('[Push] Subscription expired/gone, will be cleaned by retry')
    } else {
      logger.warn('[Push] sendNotification failed:', err.message)
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
      results.push({ endpoint: sub.endpoint, success: false })
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
