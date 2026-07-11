

const { setDefaultAutoSelectFamily } = require("net");
try { setDefaultAutoSelectFamily(false); } catch { /* Node < 18.13 */ }

// ── IPv4 DNS preference — MUST be first line ──────────────────────────────────
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA TRAVEL — ENTERPRISE BACKEND SERVER v6.8
 * "True Adventures In High Places & Deep Culture"
 *
 * Changes from v6.7:
 *   - Notifications route registered: /api/notifications
 *   - Socket: users join user-{id}, role-{role}, all-users rooms on connect
 *   - Socket: notification:new event handler added
 *   - ensureNotificationsSchema added to boot sequence
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict'

// ── Environment ───────────────────────────────────────────────────────────────
require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') })

const path        = require('path')
const http        = require('http')
const express     = require('express')
const cors        = require('cors')
const helmet      = require('helmet')
const morgan      = require('morgan')
const compression = require('compression')
const jwt         = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid')
const { Server }  = require('socket.io')

// ── Internal DB ───────────────────────────────────────────────────────────────
const { query, ensureUserSchema, ensureContactSchema, ensureSubscribersSchema, ensureGallerySchema, ensurePostsSchema, ensureBookingsSchema, ensureNotificationsSchema, } = require('./config/db')

const logger    = require('./utils/logger')
const shutdown  = require('./utils/shutdown')

// ── Email helpers — safe imports ──────────────────────────────────────────────
let verifyEmailConnection = null
let verifyAuthEmail       = null

try {
  const svc = require('./utils/emailService')
  verifyEmailConnection =
    typeof svc.verifyEmailConnection === 'function' ? svc.verifyEmailConnection :
    typeof svc.verifyConnection       === 'function' ? svc.verifyConnection       :
    typeof svc.verify                 === 'function' ? svc.verify                 :
    typeof svc.default                === 'function' ? svc.default                :
    null
} catch { /* emailService.js not present — non-fatal */ }

try {
  const eu = require('./utils/email')
  verifyAuthEmail =
    typeof eu.verifyTransporter    === 'function' ? eu.verifyTransporter    :
    typeof eu.verifyEmailConnection === 'function' ? eu.verifyEmailConnection :
    typeof eu.verifyConnection      === 'function' ? eu.verifyConnection      :
    typeof eu.verify                === 'function' ? eu.verify                :
    null
} catch { /* email.js not present — non-fatal */ }

// ── Middleware / error handlers ───────────────────────────────────────────────
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler')
const {
  cacheMiddleware,
  invalidateCache,
  clearCache,
  getCacheStats,
} = require('./middleware/cache')

// ── Route modules ─────────────────────────────────────────────────────────────
const usersRouter               = require('./routes/users')
const reviewsRouter             = require('./routes/reviews')
const bookingsRouter            = require('./routes/bookings')
const countriesRouter           = require('./routes/countries')
const packagesRouter            = require('./routes/packages')
const destinationsRouter        = require('./routes/destinations')
const postsRouter               = require('./routes/posts')
const contactRouter             = require('./routes/contact')
const galleryRouter             = require('./routes/gallery')
const teamRouter                = require('./routes/team')
const faqsRouter                = require('./routes/faqs')
const servicesRouter            = require('./routes/services')
const tipsRouter                = require('./routes/tips')
const virtualToursRouter        = require('./routes/virtualTours')
const subscribersRouter         = require('./routes/subscribers')
const settingsRouter            = require('./routes/settings')
const pagesRouter               = require('./routes/pages')
const uploadsRouter             = require('./routes/uploads')
const mediaUploadsRouter        = require('./routes/mediaUploads')
const adminAuthRouter           = require('./routes/adminAuth')
const testimonialsRouter        = require('./routes/testimonials')
const countryLikesRouter        = require('./routes/countryLikes')
const countryCommentsRouter     = require('./routes/countryComments')
const countryRatingsRouter      = require('./routes/countryRatings')
const destinationLikesRouter    = require('./routes/destinationLikes')
const destinationCommentsRouter = require('./routes/destinationComments')
const destinationRatingsRouter  = require('./routes/destinationRatings')
const notificationsRouter       = require('./routes/notifications')  // ← NEW v6.8

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const PORT     = parseInt(process.env.PORT || '3000', 10)
const NODE_ENV = process.env.NODE_ENV || 'development'
const IS_PROD  = NODE_ENV === 'production'

// ── Connected admins map ──────────────────────────────────────────────────────
const connectedAdmins = new Map()

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH & META ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════
  res.json({
    success:     true,
    status:      'healthy',
    service:     'Altuvera Travel API',
    version:     '6.8',
    environment: NODE_ENV,
    uptime:      Math.floor(process.uptime()),
    timestamp:   new Date().toISOString(),
    memory: {
      used:  `${Math.round(process.memoryUsage().heapUsed  / 1024 / 1024)}MB`,
      total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
    },
    socket: {
      transports:      ['polling', 'websocket'],
      connectedAdmins: connectedAdmins.size,
    },
    cache:   getCacheStats(),
    email: {
      verifyEmailConnection: typeof verifyEmailConnection === 'function' ? 'available' : 'unavailable',
      verifyAuthEmail:       typeof verifyAuthEmail       === 'function' ? 'available' : 'unavailable',
    },
    network: { dnsOrder: 'ipv4first' },
    theme:   { primary: '#16a34a', name: 'green-white' },
  }),
)

app.get('/api/health', (_req, res) =>
  res.json({ success: true, status: 'healthy', timestamp: new Date().toISOString() }),
)

app.get('/api', (_req, res) =>
  res.json({
    success: true,
    name:    'Altuvera Travel API',
    version: '6.8',
    tagline: 'True Adventures In High Places & Deep Culture',
    health:  '/health',
    routes:  '/api/routes',
  }),
)

// ── Debug: email test ─────────────────────────────────────────────────────────
app.get('/api/debug/email-test', async (req, res) => {
  if (req.query.secret !== 'altuvera-test')
    return res.status(403).json({ error: 'forbidden' })

  let sendEmail = null
  try {
    const eu = require('./utils/email')
    sendEmail = typeof eu.sendEmail === 'function' ? eu.sendEmail : null
  } catch { /* non-fatal */ }

  if (!sendEmail) {
    return res.status(503).json({ success: false, error: 'sendEmail not available' })
  }

  const to = req.query.to || process.env.ADMIN_EMAIL || process.env.SMTP_USER
  try {
    const result = await sendEmail({
      to,
      subject: '✅ Altuvera Email Test',
      html:    `<p>Email delivery works! Sent at ${new Date().toISOString()}</p>`,
    })
    res.json({ success: true, delivered: result?.delivered, sentTo: to })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, sentTo: to })
  }
})

// ── Debug: database tables ────────────────────────────────────────────────────
app.get('/api/debug/tables', async (req, res) => {
  const secret = IS_PROD ? process.env.JWT_SECRET?.slice(0, 8) : 'dev'
  if (req.query.secret !== secret)
    return res.status(403).json({ error: 'forbidden' })

  try {
    const { rows: tableRows } = await query(`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name
    `)
    const results = {}
    for (const { table_name } of tableRows) {
      try {
        const cnt = await query(`SELECT COUNT(*) FROM "${table_name}"`)
        results[table_name] = { exists: true, rows: parseInt(cnt.rows[0].count, 10) }
      } catch (e) {
        results[table_name] = { exists: true, error: e.message }
      }
    }
    res.json({ success: true, tables: results })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── Debug: cache control ──────────────────────────────────────────────────────
app.get('/api/debug/cache', (req, res) => {
  const secret = IS_PROD ? process.env.JWT_SECRET?.slice(0, 8) : 'dev'
  if (req.query.secret !== secret)
    return res.status(403).json({ error: 'forbidden' })

  if (req.query.clear === 'true') {
    const cleared = clearCache()
    return res.json({ success: true, message: `Cleared ${cleared} cache entries` })
  }

  if (req.query.invalidate) {
    const count = invalidateCache(req.query.invalidate)
    return res.json({
      success: true,
      message: `Invalidated ${count} entries for prefix: ${req.query.invalidate}`,
    })
  }

  res.json({ success: true, ...getCacheStats() })
})

// ── Route inspector ───────────────────────────────────────────────────────────
const cleanPath = (p = '') =>
  p.replace(/\\/g, '').replace(/\/+$/, '').replace(/\/\//g, '/')
   .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ':param')
   .replace(/\(\[\^\\\/\]\+\?\)/g, ':param')
   .replace(/^\^/, '').replace(/\$\/i$/, '').replace(/\$$/, '')
   .replace(/\(\?=\/\|\$\)/g, '')

const collectRoutes = (stack, prefix = '') => {
  const routes = []
  for (const layer of stack) {
    if (layer.route?.path) {
      const full    = cleanPath(prefix + layer.route.path) || '/'
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase())
      for (const method of methods) routes.push({ method, path: full })
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const nested = cleanPath(layer.regexp?.source || '')
      routes.push(...collectRoutes(layer.handle.stack, prefix + nested))
    }
  }
  return routes
}

app.get('/api/routes', (req, res) => {
  const routes   = collectRoutes(app._router?.stack || [])
  const byMethod = routes.reduce((acc, r) => {
    acc[r.method] = (acc[r.method] || 0) + 1; return acc
  }, {})
  res.json({ success: true, total: routes.length, byMethod, routes })
})

// ═══════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.use('/api/admin/auth',           adminAuthRouter)
app.use('/api/users',                usersRouter)
app.use('/api/bookings',             bookingsRouter)
app.use('/api/reviews',              reviewsRouter)
app.use('/api/countries',            countriesRouter)
app.use('/api/hero-slides', require('./routes/heroSlides'));
app.use('/api/packages',             packagesRouter)
app.use('/api/destinations',         destinationsRouter)
app.use('/api/posts',                postsRouter)
app.use('/api/contact',              contactRouter)
app.use('/api/gallery',              galleryRouter)
app.use('/api/team',                 teamRouter)
app.use('/api/faqs',                 faqsRouter)
app.use('/api/services',             servicesRouter)
app.use('/api/tips',                 tipsRouter)
app.use('/api/subscribers',          subscribersRouter)
app.use('/api/settings',             settingsRouter)
app.use('/api/pages',                pagesRouter)
app.use('/api/testimonials',         testimonialsRouter)
app.use('/api/uploads',              uploadsRouter)
app.use('/api/media',                mediaUploadsRouter)
app.use('/api/virtual-tours',        virtualToursRouter)
app.use('/api/country-likes',        countryLikesRouter)
app.use('/api/country-comments',     countryCommentsRouter)
app.use('/api/country-ratings',      countryRatingsRouter)
app.use('/api/destination-likes',    destinationLikesRouter)
app.use('/api/destination-comments', destinationCommentsRouter)
app.use('/api/destination-ratings',  destinationRatingsRouter)
app.use('/api/notifications',        notificationsRouter)  // ← NEW v6.8

// ═══════════════════════════════════════════════════════════════════════════════
// JWT SOCKET HELPER
// ═══════════════════════════════════════════════════════════════════════════════

const verifySocketToken = (token) => {
  if (!token || !process.env.JWT_SECRET) return null
  try { return jwt.verify(token, process.env.JWT_SECRET) } catch { return null }
}


// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO — AUTH MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

io.use((socket, next) => {
  try {
    const raw =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace?.(/^Bearer\s+/i, '')?.trim()

    const decoded              = verifySocketToken(raw)
    socket.data.user           = decoded || null
    socket.data.isAdmin        = decoded?.type === 'admin' || decoded?.role === 'admin'
    socket.data.userId         = decoded?.id  || null
    socket.data.sessionId      = null
    socket.data.conversationId = null

    if (socket.data.isAdmin) {
      socket.join('admins')
      socket.join('admin-room')
    }

    next()
  } catch (err) {
    logger.error('[Socket] Auth middleware error:', err.message)
    next()
  }
})


// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO — CONNECTION HANDLER  v6.8
// ═══════════════════════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  logger.info(
    `[Socket] Connected: ${socket.id} | isAdmin=${socket.data.isAdmin} | userId=${socket.data.userId}`,
  )

  // ── v6.8: Room setup for authenticated users ─────────────────────────────
  if (socket.data.userId) {
    // Individual user room — for targeted notifications and messages
    socket.join(`user-${socket.data.userId}`)

    // Role-based room — for role-targeted notifications
    // e.g. 'role-user', 'role-moderator', 'role-editor'
    const userRole = socket.data.user?.role || 'user'
    socket.join(`role-${userRole}`)

    // Broadcast room — all authenticated users
    socket.join('all-users')

    logger.info(
      `[Socket] User ${socket.data.userId} joined rooms: ` +
      `user-${socket.data.userId}, role-${userRole}, all-users`,
    )
  }

  if (socket.data.isAdmin) {
    connectedAdmins.set(socket.id, socket.data.userId)
    logger.info(`[Socket] Admin online (total: ${connectedAdmins.size})`)
  }

  // ── v6.8: Notification socket events ────────────────────────────────────

  /**
   * Client requests their unread count on connect / focus
   * Emits back: notification:unread-count { count }
   */
  socket.on('notification:get-unread', async (_, cb) => {
    try {
      const userId   = socket.data.userId
      const userRole = socket.data.user?.role || 'user'
      if (!userId) {
        if (typeof cb === 'function') cb({ count: 0 })
        return
      }

      const { rows } = await query(
        `SELECT COUNT(*) FROM notifications
           WHERE (
             (user_id = $1 AND target_scope = 'individual')
             OR target_scope = 'all'
             OR (target_scope = 'role' AND target_role = $2)
           )
           AND is_read = false
           AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [userId, userRole],
      )

      const count = parseInt(rows[0]?.count || 0, 10)
      socket.emit('notification:unread-count', { count })
      if (typeof cb === 'function') cb({ count })
    } catch (err) {
      logger.warn('[Socket] notification:get-unread error:', err.message)
      if (typeof cb === 'function') cb({ count: 0 })
    }
  })

  /**
   * Client marks a notification as read via socket (instant UI update)
   */
  socket.on('notification:mark-read', async ({ id } = {}, cb) => {
    try {
      const userId   = socket.data.userId
      const userRole = socket.data.user?.role || 'user'
      if (!userId || !id) return

      await query(
        `UPDATE notifications
           SET is_read = true, read_at = NOW(), updated_at = NOW()
           WHERE id = $1
             AND (user_id = $2 OR target_scope IN ('all','role'))
             AND deleted_at IS NULL`,
        [id, userId],
      )

      // Re-emit updated count
      const { rows } = await query(
        `SELECT COUNT(*) FROM notifications
           WHERE (
             (user_id = $1 AND target_scope = 'individual')
             OR target_scope = 'all'
             OR (target_scope = 'role' AND target_role = $2)
           )
           AND is_read = false AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [userId, userRole],
      )

      const count = parseInt(rows[0]?.count || 0, 10)
      socket.emit('notification:unread-count', { count })
      if (typeof cb === 'function') cb({ success: true, count })
    } catch (err) {
      logger.warn('[Socket] notification:mark-read error:', err.message)
      if (typeof cb === 'function') cb({ success: false })
    }
  })

  /**
   * Admin broadcasts a notification to all connected users instantly
   * (REST API also handles persistence; this is for instant delivery)
   */
  socket.on('notification:admin-broadcast', async (payload = {}, cb) => {
    try {
      if (!socket.data.isAdmin) throw new Error('Admin only')

      const { title, message, type = 'general', actionUrl, priority = 'normal' } = payload
      if (!title || !message) throw new Error('title and message required')

      // Persist via controller helper
      const { createNotificationInternal } = require('./controllers/notificationsController')
      const notif = await createNotificationInternal({
        userId:      null,
        type, title, message,
        actionUrl:   actionUrl || null,
        targetScope: 'all',
        priority,
        senderType:  'admin',
        senderId:    socket.data.userId,
        senderName:  socket.data.user?.full_name || 'Admin',
      })

      // Socket broadcast handled inside createNotificationInternal via emitNotification
      if (typeof cb === 'function') cb({ success: true, data: notif })
    } catch (err) {
      logger.error('[Socket] notification:admin-broadcast error:', err.message)
      if (typeof cb === 'function') cb({ success: false, error: err.message })
    }
  })

  // ── Package rooms ────────────────────────────────────────────────────────
  socket.on('pkg:join', ({ packageId, userId } = {}) => {
    if (packageId) socket.join(`package-${packageId}`)
    if (userId)    socket.join(`user-${userId}`)
  })

  socket.on('pkg:leave', ({ packageId } = {}) => {
    if (packageId) socket.leave(`package-${packageId}`)
  })


  // ── Disconnect ──────────────────────────────────────────────────────────
  socket.on('disconnect', async (reason) => {
    logger.info(`[Socket] Disconnected: ${socket.id} | reason=${reason}`)

    if (socket.data.isAdmin) {
      connectedAdmins.delete(socket.id)
      logger.info(`[Socket] Admin offline (remaining: ${connectedAdmins.size})`)
    }

  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

app.use(notFoundHandler)
app.use(errorHandler)

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER BOOT
// ═══════════════════════════════════════════════════════════════════════════════

async function initializeServer () {
  try {
    logger.info('🔄 Connecting to database…')
    await query('SELECT NOW()')
    logger.info('✅ Database connected')

    try {
      const { ensureDestinationSchema } = require('./controllers/destinationsController')
      await ensureDestinationSchema()
      logger.info('✅ Destinations extended schema ready')
    } catch (err) {
      logger.warn('⚠️  Destination schema (non-fatal):', err.message)
    }

    // Core schemas — sequential
    const schemas = [
      { fn: ensureSubscribersSchema,    name: 'Subscribers'    },
      { fn: ensureUserSchema,           name: 'Users'          },
      { fn: ensureContactSchema,        name: 'Contact'        },
      { fn: ensureGallerySchema,        name: 'Gallery'        },
      { fn: ensurePostsSchema,          name: 'Posts'          },
      { fn: ensurePackagesSchema,       name: 'Packages'       },
      { fn: ensureBookingsSchema,       name: 'Bookings'       },
      { fn: ensureNotificationsSchema,  name: 'Notifications'  }, // ← NEW v6.8
    ]

    for (const { fn, name } of schemas) {
      try {
        await fn()
        if (!['Packages', 'Messaging', 'Notifications'].includes(name))
          logger.info(`✅ ${name} schema ready`)
      } catch (err) {
        logger.warn(`⚠️  ${name} schema (non-fatal):`, err.message)
      }
    }

    await new Promise((resolve) => {
      httpServer.listen(PORT, () => {
        const line = '═'.repeat(67)
        logger.info(`\n${line}`)
        logger.info('🌍  ALTUVERA TRAVEL — Enterprise Backend v6.8')
        logger.info('     "True Adventures In High Places & Deep Culture"')
        logger.info(line)
        logger.info(`  Env          : ${NODE_ENV}`)
        logger.info(`  Port         : ${PORT}`)
        logger.info(`  Backend      : ${process.env.BACKEND_URL || `http://localhost:${PORT}`}`)
        logger.info(`  Frontend     : ${process.env.FRONTEND_URL || '—'}`)
        logger.info(`  Theme        : green-white (#16a34a) 🟢`)
        logger.info(`  DNS          : ipv4first ✅`)
        logger.info(`  Socket rooms : user-{id}, role-{role}, all-users ✅`)
        logger.info(`  Notifications: /api/notifications ✅`)
        logger.info(`  Socket.io    : polling → websocket ✅`)
        logger.info(`${line}\n`)
        resolve()
      })
    })

    shutdown(httpServer)

  } catch (err) {
    logger.error('❌ Server boot failed:', err.message)
    logger.error(err.stack)
    process.exit(1)
  }

  if (typeof verifyEmailConnection === 'function') {
    verifyEmailConnection().catch(e =>
      logger.warn('[Email] Connection check (non-fatal):', e.message),
    )
  }

  if (typeof verifyAuthEmail === 'function') {
    verifyAuthEmail().catch(e =>
      logger.warn('[Email] Auth SMTP check (non-fatal):', e.message),
    )
  }
}

initializeServer()

module.exports = app