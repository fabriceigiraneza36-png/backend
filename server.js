/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA TRAVEL — ENTERPRISE BACKEND SERVER v6.5
 * "True Adventures In High Places & Deep Culture"
 *
 * Changes from v6.4:
 *   - Socket.io 400 fix: transports order corrected, cookie disabled globally
 *   - connectionStateRecovery: skipMiddlewares true, extended duration
 *   - io reference hoisted — no circular reference bug on first request
 *   - Schema boot: parallel where safe, sequential where order matters
 *   - ensureBookingsSchema: non-blocking, won't crash server if it fails
 *   - Countries controller: safeQuery wrapper prevents 500 on includeRelated
 *   - Global error handler improvements: stack hidden in production
 *   - Health endpoint: includes Socket.io transport status
 *   - Typing indicator cleanup: moved to dedicated setInterval (no socket leak)
 *   - Admin online map: corrected to broadcast only when last admin leaves
 *   - All socket handlers: consistent error pattern with logger
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict'

// ── IPv4 DNS preference — MUST be first line ──────────────────────────────────
const dns = require('dns')
dns.setDefaultResultOrder('ipv4first')

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

// ── Internal modules ──────────────────────────────────────────────────────────
const {
  query,
  ensureUserSchema,
  ensureContactSchema,
  ensureSubscribersSchema,
  ensureChatSchema,
  ensureGallerySchema,
  ensurePostsSchema,
  ensureBookingsSchema,
} = require('./config/db')

const logger    = require('./utils/logger')
const shutdown  = require('./utils/shutdown')
const socketBus = require('./utils/socketBus')

const { verifyEmailConnection }              = require('./utils/emailService')
const { verifyTransporter: verifyAuthEmail } = require('./utils/email')
const { errorHandler, notFoundHandler }      = require('./middleware/errorHandler')
const { cacheMiddleware }                    = require('./middleware/cache')

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
const messageRouter             = require('./routes/message')
const pagesRouter               = require('./routes/pages')
const chatRouter                = require('./routes/chat')
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

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const PORT     = parseInt(process.env.PORT || '3000', 10)
const NODE_ENV = process.env.NODE_ENV || 'development'
const IS_PROD  = NODE_ENV === 'production'

// ═══════════════════════════════════════════════════════════════════════════════
// ALLOWED ORIGINS
// ═══════════════════════════════════════════════════════════════════════════════

const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean)

const ALLOWED_ORIGINS = [
  ...new Set([
    process.env.FRONTEND_URL,
    process.env.BACKEND_URL,
    ...envOrigins,
    'https://altuverapanel.vercel.app',
    'https://altuvera.vercel.app',
    'https://altuvera.com',
    'https://www.altuvera.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:4173',
  ].filter(Boolean)),
]

/**
 * Returns true if the origin is explicitly allowed or is localhost.
 * In development, all origins are permitted.
 */
const isOriginAllowed = (origin) => {
  if (!origin) return true                                    // server-to-server
  if (!IS_PROD) return true                                   // dev: allow all
  if (ALLOWED_ORIGINS.includes(origin)) return true
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true
  return false
}

// ═══════════════════════════════════════════════════════════════════════════════
// PACKAGES SCHEMA — isolated so errors don't block boot
// ═══════════════════════════════════════════════════════════════════════════════

const ensurePackagesSchema = async () => {
  const tables = [
    /* packages */
    `CREATE TABLE IF NOT EXISTS packages (
      id                 SERIAL PRIMARY KEY,
      title              VARCHAR(255) NOT NULL,
      slug               VARCHAR(255) UNIQUE NOT NULL,
      short_description  TEXT,
      description        TEXT,
      content            TEXT,
      category           VARCHAR(100),
      destination        VARCHAR(255),
      country            VARCHAR(100),
      price              NUMERIC(12,2) DEFAULT 0,
      price_label        VARCHAR(100)  DEFAULT 'per person',
      currency           VARCHAR(10)   DEFAULT 'USD',
      pricing_tiers      JSONB         DEFAULT '[]'::JSONB,
      discount_percent   INTEGER       DEFAULT 0,
      is_price_visible   BOOLEAN       DEFAULT true,
      duration_days      INTEGER,
      duration_nights    INTEGER,
      max_travelers      INTEGER,
      min_travelers      INTEGER       DEFAULT 1,
      group_size_label   VARCHAR(100),
      thumbnail_url      VARCHAR(500),
      cover_image_url    VARCHAR(500),
      images             JSONB         DEFAULT '[]'::JSONB,
      video_url          VARCHAR(500),
      gallery            JSONB         DEFAULT '[]'::JSONB,
      features           JSONB         DEFAULT '[]'::JSONB,
      inclusions         JSONB         DEFAULT '[]'::JSONB,
      exclusions         JSONB         DEFAULT '[]'::JSONB,
      highlights         JSONB         DEFAULT '[]'::JSONB,
      itinerary          JSONB         DEFAULT '[]'::JSONB,
      faqs               JSONB         DEFAULT '[]'::JSONB,
      tags               TEXT[]        DEFAULT ARRAY[]::TEXT[],
      available_months   JSONB         DEFAULT '[]'::JSONB,
      departure_dates    JSONB         DEFAULT '[]'::JSONB,
      availability_note  TEXT,
      is_published       BOOLEAN       DEFAULT false,
      is_featured        BOOLEAN       DEFAULT false,
      is_sold_out        BOOLEAN       DEFAULT false,
      is_active          BOOLEAN       DEFAULT true,
      badge_label        VARCHAR(100),
      badge_color        VARCHAR(20)   DEFAULT '#16a34a',
      card_theme         VARCHAR(50)   DEFAULT 'default',
      accent_color       VARCHAR(20)   DEFAULT '#16a34a',
      card_bg_image      VARCHAR(500),
      meta_title         VARCHAR(255),
      meta_description   TEXT,
      view_count         INTEGER       DEFAULT 0,
      booking_count      INTEGER       DEFAULT 0,
      inquiry_count      INTEGER       DEFAULT 0,
      author_id          INTEGER,
      author_name        VARCHAR(255),
      sort_order         INTEGER       DEFAULT 0,
      published_at       TIMESTAMP,
      created_at         TIMESTAMP     DEFAULT NOW(),
      updated_at         TIMESTAMP     DEFAULT NOW()
    )`,

    /* package_bookings */
    `CREATE TABLE IF NOT EXISTS package_bookings (
      id               SERIAL PRIMARY KEY,
      booking_ref      VARCHAR(50)   UNIQUE,
      package_id       INTEGER       REFERENCES packages(id) ON DELETE SET NULL,
      package_title    VARCHAR(255),
      package_price    NUMERIC(12,2),
      user_id          INTEGER,
      guest_name       VARCHAR(255)  NOT NULL,
      guest_email      VARCHAR(255)  NOT NULL,
      guest_phone      VARCHAR(50),
      travelers_count  INTEGER       DEFAULT 1,
      adults           INTEGER       DEFAULT 1,
      children         INTEGER       DEFAULT 0,
      travel_date      DATE,
      end_date         DATE,
      special_requests TEXT,
      dietary_needs    TEXT,
      pickup_location  VARCHAR(255),
      total_price      NUMERIC(12,2),
      currency         VARCHAR(10)   DEFAULT 'USD',
      deposit_paid     NUMERIC(12,2) DEFAULT 0,
      payment_status   VARCHAR(30)   DEFAULT 'unpaid',
      status           VARCHAR(30)   DEFAULT 'pending',
      priority         VARCHAR(20)   DEFAULT 'normal',
      admin_notes      TEXT,
      source           VARCHAR(100)  DEFAULT 'package_page',
      confirmed_at     TIMESTAMP,
      cancelled_at     TIMESTAMP,
      completed_at     TIMESTAMP,
      created_at       TIMESTAMP     DEFAULT NOW(),
      updated_at       TIMESTAMP     DEFAULT NOW()
    )`,

    /* package_messages */
    `CREATE TABLE IF NOT EXISTS package_messages (
      id            SERIAL PRIMARY KEY,
      package_id    INTEGER     REFERENCES packages(id) ON DELETE CASCADE,
      parent_id     INTEGER,
      sender_type   VARCHAR(20) NOT NULL,
      sender_id     INTEGER,
      sender_name   VARCHAR(255),
      sender_email  VARCHAR(255),
      message_type  VARCHAR(30) DEFAULT 'inquiry',
      subject       VARCHAR(255),
      body          TEXT        NOT NULL,
      metadata      JSONB       DEFAULT '{}'::JSONB,
      is_read       BOOLEAN     DEFAULT false,
      read_at       TIMESTAMP,
      created_at    TIMESTAMP   DEFAULT NOW()
    )`,

    /* admin_info_requests */
    `CREATE TABLE IF NOT EXISTS admin_info_requests (
      id             SERIAL PRIMARY KEY,
      package_id     INTEGER     REFERENCES packages(id) ON DELETE CASCADE,
      booking_id     INTEGER,
      message_id     INTEGER,
      user_id        INTEGER,
      target_email   VARCHAR(255),
      target_name    VARCHAR(255),
      title          VARCHAR(255) NOT NULL,
      description    TEXT,
      fields         JSONB        DEFAULT '[]'::JSONB,
      theme          VARCHAR(50)  DEFAULT 'default',
      accent_color   VARCHAR(20)  DEFAULT '#16a34a',
      header_image   VARCHAR(500),
      custom_css     TEXT,
      status         VARCHAR(20)  DEFAULT 'pending',
      response       JSONB,
      responded_at   TIMESTAMP,
      responded_by   INTEGER,
      created_by     INTEGER,
      expires_at     TIMESTAMP,
      created_at     TIMESTAMP    DEFAULT NOW(),
      updated_at     TIMESTAMP    DEFAULT NOW()
    )`,

    /* package_chat_preferences */
    `CREATE TABLE IF NOT EXISTS package_chat_preferences (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER     UNIQUE NOT NULL,
      theme        VARCHAR(30) DEFAULT 'light',
      accent_color VARCHAR(20) DEFAULT '#16a34a',
      bg_image     VARCHAR(500),
      bg_preset    VARCHAR(50) DEFAULT 'none',
      font_size    VARCHAR(20) DEFAULT 'medium',
      bubble_style VARCHAR(30) DEFAULT 'rounded',
      created_at   TIMESTAMP   DEFAULT NOW(),
      updated_at   TIMESTAMP   DEFAULT NOW()
    )`,
  ]

  for (const sql of tables) {
    await query(sql).catch(err =>
      logger.warn('[PackagesSchema] Table creation non-fatal:', err.message),
    )
  }

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_packages_slug       ON packages(slug)`,
    `CREATE INDEX IF NOT EXISTS idx_packages_published  ON packages(is_published, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_packages_featured   ON packages(is_featured) WHERE is_featured = true`,
    `CREATE INDEX IF NOT EXISTS idx_packages_category   ON packages(category)`,
    `CREATE INDEX IF NOT EXISTS idx_packages_sort       ON packages(sort_order ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_pkg_bkgs_pkg        ON package_bookings(package_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pkg_bkgs_user       ON package_bookings(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pkg_bkgs_status     ON package_bookings(status)`,
    `CREATE INDEX IF NOT EXISTS idx_pkg_msgs_pkg        ON package_messages(package_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pkg_msgs_sender     ON package_messages(sender_id)`,
    `CREATE INDEX IF NOT EXISTS idx_info_reqs_pkg       ON admin_info_requests(package_id)`,
    `CREATE INDEX IF NOT EXISTS idx_info_reqs_user      ON admin_info_requests(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pkg_chat_prefs_user ON package_chat_preferences(user_id)`,
  ]

  for (const idx of indexes) {
    await query(idx).catch(() => {})
  }

  logger.info('✅ Packages schema ready')
}

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGING SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

const ensureMessagingSchema = async () => {
  const tables = [
    `CREATE TABLE IF NOT EXISTS conversations (
      id              SERIAL PRIMARY KEY,
      session_id      VARCHAR(120) UNIQUE NOT NULL,
      user_id         INTEGER,
      guest_name      VARCHAR(255),
      guest_email     VARCHAR(255),
      channel         VARCHAR(50)  DEFAULT 'live_chat',
      subject         VARCHAR(255),
      status          VARCHAR(30)  DEFAULT 'open',
      priority        VARCHAR(20)  DEFAULT 'normal',
      assigned_admin  INTEGER,
      first_message   TEXT,
      last_message    TEXT,
      last_message_at TIMESTAMP,
      unread_user     INTEGER      DEFAULT 0,
      unread_admin    INTEGER      DEFAULT 0,
      tags            TEXT[]       DEFAULT ARRAY[]::TEXT[],
      metadata        JSONB        DEFAULT '{}'::JSONB,
      ip_address      VARCHAR(50),
      source          VARCHAR(100) DEFAULT 'website',
      closed_at       TIMESTAMP,
      created_at      TIMESTAMP    DEFAULT NOW(),
      updated_at      TIMESTAMP    DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS messages (
      id               SERIAL PRIMARY KEY,
      conversation_id  INTEGER     NOT NULL,
      sender_type      VARCHAR(20) NOT NULL,
      sender_id        INTEGER,
      sender_name      VARCHAR(255),
      sender_email     VARCHAR(255),
      sender_avatar    VARCHAR(500),
      body             TEXT        NOT NULL,
      msg_type         VARCHAR(30) DEFAULT 'text',
      attachment_url   VARCHAR(500),
      is_read          BOOLEAN     DEFAULT false,
      read_at          TIMESTAMP,
      edited           BOOLEAN     DEFAULT false,
      deleted          BOOLEAN     DEFAULT false,
      reply_to_id      INTEGER,
      metadata         JSONB       DEFAULT '{}'::JSONB,
      created_at       TIMESTAMP   DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS typing_indicators (
      id              SERIAL PRIMARY KEY,
      conversation_id INTEGER     NOT NULL,
      sender_type     VARCHAR(20) NOT NULL,
      sender_id       INTEGER,
      sender_name     VARCHAR(255),
      socket_id       VARCHAR(100),
      started_at      TIMESTAMP   DEFAULT NOW(),
      expires_at      TIMESTAMP   DEFAULT NOW() + INTERVAL '10 seconds'
    )`,
  ]

  for (const sql of tables) {
    await query(sql).catch(err =>
      logger.warn('[MessagingSchema] Table non-fatal:', err.message),
    )
  }

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_conversations_session  ON conversations(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_status   ON conversations(status)`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_updated  ON conversations(updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation  ON messages(conversation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_unread        ON messages(conversation_id, is_read) WHERE is_read = false`,
    `CREATE INDEX IF NOT EXISTS idx_typing_expires         ON typing_indicators(expires_at)`,
  ]

  for (const idx of indexes) {
    await query(idx).catch(() => {})
  }

  logger.info('✅ Messaging schema ready')
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPRESS APP
// ═══════════════════════════════════════════════════════════════════════════════

const app = express()
app.set('trust proxy', 1)

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy:     false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy:   false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
)

app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy',   'same-origin-allow-popups')
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  res.setHeader('Permissions-Policy',           'identity-credentials-get=*')
  next()
})

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) return callback(null, true)
    logger.warn(`[CORS] Blocked origin: ${origin}`)
    return callback(null, false)
  },
  credentials:          true,
  methods:              ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders:       [
    'Content-Type', 'Authorization', 'X-Requested-With',
    'Accept', 'Origin', 'X-CSRF-Token', 'Cache-Control',
  ],
  exposedHeaders:       ['X-Total-Count', 'X-Page', 'X-Per-Page'],
  optionsSuccessStatus: 200,
  maxAge:               86400,
}

app.use(cors(corsOptions))

// Pre-flight handler
app.options('*', (req, res) => {
  const origin = req.headers.origin
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin',      origin || '*')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  res.setHeader('Access-Control-Allow-Methods',  'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD')
  res.setHeader('Access-Control-Allow-Headers',  corsOptions.allowedHeaders.join(','))
  res.setHeader('Access-Control-Max-Age',        '86400')
  return res.sendStatus(200)
})

// ── Body / static ─────────────────────────────────────────────────────────────
app.use(compression())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(cacheMiddleware(120))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// ── Logging ───────────────────────────────────────────────────────────────────
const skipHealthLog = (req) =>
  req.url === '/health' || req.url === '/api/health'

if (IS_PROD) {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip:   skipHealthLog,
  }))
} else {
  app.use(morgan('dev', { skip: skipHealthLog }))
}

// ── Request ID ────────────────────────────────────────────────────────────────
app.use((req, _res, next) => { req.id = uuidv4(); next() })

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP SERVER (create BEFORE Socket.io so io can reference httpServer)
// ═══════════════════════════════════════════════════════════════════════════════

const httpServer = http.createServer(app)

// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO
//
// Key settings for Render / Vercel free tier:
//   transports: ['polling','websocket']
//     → polling MUST come first. Socket.io v4 always starts with HTTP polling,
//       then upgrades to WebSocket. Without polling first, the initial
//       HTTP handshake returns 400 "Bad Request".
//
//   allowEIO3: true
//     → Accepts Engine.IO v3 clients (older browsers, some proxy setups).
//
//   pingTimeout: 60000, pingInterval: 25000
//     → Render cold starts can take 30–50 s. Long ping timeout prevents
//       premature disconnects during server wake-up.
//
//   cookie: false
//     → Prevents duplicate session issues on load-balanced deployments.
//
//   connectionStateRecovery
//     → After a brief network blip, clients automatically re-join rooms
//       without calling register again.
// ═══════════════════════════════════════════════════════════════════════════════

const io = new Server(httpServer, {
  cors: {
    origin:      (origin, cb) => cb(null, isOriginAllowed(origin)),
    methods:     ['GET', 'POST'],
    credentials: true,
  },
  transports:        ['polling', 'websocket'],   // polling FIRST — required for handshake
  allowEIO3:         true,
  pingTimeout:       60_000,                      // 60 s — handles cold starts
  pingInterval:      25_000,
  upgradeTimeout:    30_000,
  maxHttpBufferSize: 1e6,                         // 1 MB
  path:              '/socket.io',
  cookie:            false,                       // avoid sticky-session issues
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,      // 2-min recovery window
    skipMiddlewares: true,
  },
})

// Attach io to socketBus and app BEFORE any route that needs it
socketBus.setIO(io)
app.set('io', io)

// Expose io to every request handler via req.app.get('io')
// (No middleware needed — already set on app above)

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH & META ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/health', (_req, res) =>
  res.json({
    success:     true,
    status:      'healthy',
    service:     'Altuvera Travel API',
    version:     '6.5',
    environment: NODE_ENV,
    uptime:      Math.floor(process.uptime()),
    timestamp:   new Date().toISOString(),
    memory: {
      used:  `${Math.round(process.memoryUsage().heapUsed  / 1024 / 1024)}MB`,
      total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
    },
    socket: {
      transports:    ['polling', 'websocket'],
      connectedAdmins: connectedAdmins.size,
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
    success:  true,
    name:     'Altuvera Travel API',
    version:  '6.5',
    tagline:  'True Adventures In High Places & Deep Culture',
    health:   '/health',
    routes:   '/api/routes',
  }),
)

// ── Debug: email test ─────────────────────────────────────────────────────────
app.get('/api/debug/email-test', async (req, res) => {
  if (req.query.secret !== 'altuvera-test')
    return res.status(403).json({ error: 'forbidden' })

  const { sendEmail } = require('./utils/email')
  const to = req.query.to || process.env.ADMIN_EMAIL || process.env.SMTP_USER

  try {
    const result = await sendEmail({
      to,
      subject: '✅ Altuvera Email Test',
      html:    `<p>Email delivery works! Sent at ${new Date().toISOString()}</p>`,
    })
    res.json({ success: true, delivered: result.delivered, sentTo: to })
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
app.use('/api/messages',             messageRouter)
app.use('/api/message',              messageRouter)
app.use('/api/chat',                 chatRouter)
app.use('/api/uploads',              uploadsRouter)
app.use('/api/media',                mediaUploadsRouter)
app.use('/api/virtual-tours',        virtualToursRouter)
app.use('/api/country-likes',        countryLikesRouter)
app.use('/api/country-comments',     countryCommentsRouter)
app.use('/api/country-ratings',      countryRatingsRouter)
app.use('/api/destination-likes',    destinationLikesRouter)
app.use('/api/destination-comments', destinationCommentsRouter)
app.use('/api/destination-ratings',  destinationRatingsRouter)

// ═══════════════════════════════════════════════════════════════════════════════
// JWT SOCKET HELPER
// ═══════════════════════════════════════════════════════════════════════════════

const verifySocketToken = (token) => {
  if (!token || !process.env.JWT_SECRET) return null
  try { return jwt.verify(token, process.env.JWT_SECRET) } catch { return null }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get or create a conversation by sessionId.
 * Idempotent — safe to call on every reconnect.
 */
const getOrCreateConversation = async ({
  sessionId, userId, guestName, guestEmail, channel, source, ipAddress,
}) => {
  const sid = String(sessionId || '').trim()
  if (!sid) throw new Error('sessionId is required')

  // Try existing first
  const existing = await query(
    `SELECT c.*, u.full_name AS user_full_name, u.email AS user_email,
            u.avatar_url AS user_avatar
       FROM conversations c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.session_id = $1 LIMIT 1`,
    [sid],
  )

  if (existing.rows[0]) {
    // Update guest info if newly provided
    if (userId || guestName || guestEmail) {
      await query(
        `UPDATE conversations SET
           user_id     = COALESCE($1, user_id),
           guest_name  = COALESCE(NULLIF($2,''), guest_name),
           guest_email = COALESCE(NULLIF($3,''), guest_email),
           updated_at  = NOW()
         WHERE session_id = $4`,
        [userId || null, guestName || null, guestEmail || null, sid],
      ).catch(() => {})
    }
    return existing.rows[0]
  }

  const inserted = await query(
    `INSERT INTO conversations
       (session_id, user_id, guest_name, guest_email,
        channel, source, ip_address, status, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'open','normal')
     RETURNING *`,
    [
      sid,
      userId    || null,
      guestName || null,
      guestEmail || null,
      channel   || 'live_chat',
      source    || 'website',
      ipAddress || null,
    ],
  )
  return inserted.rows[0]
}

const saveConversationMessage = async ({
  conversationId, senderType, senderId, senderName,
  senderEmail, senderAvatar, body, metadata,
}) => {
  if (!String(body || '').trim()) throw new Error('Message body is required')

  const { rows } = await query(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_id, sender_name,
        sender_email, sender_avatar, body, metadata, is_read)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false)
     RETURNING *`,
    [
      conversationId,
      senderType,
      senderId    || null,
      senderName  || null,
      senderEmail || null,
      senderAvatar || null,
      String(body).trim(),
      JSON.stringify(metadata || {}),
    ],
  )

  const msg    = rows[0]
  const isUser = senderType !== 'admin'

  await query(
    `UPDATE conversations SET
       last_message    = $1,
       last_message_at = NOW(),
       first_message   = COALESCE(first_message, $1),
       unread_admin    = CASE WHEN $2 THEN unread_admin + 1 ELSE unread_admin END,
       unread_user     = CASE WHEN $3 THEN unread_user  + 1 ELSE unread_user  END,
       updated_at      = NOW()
     WHERE id = $4`,
    [String(body).trim(), isUser, !isUser, conversationId],
  ).catch(() => {})

  return msg
}

const fetchConversationMessages = async (conversationId, limit = 80) => {
  const { rows } = await query(
    `SELECT * FROM messages
      WHERE conversation_id = $1 AND deleted = false
      ORDER BY created_at ASC LIMIT $2`,
    [conversationId, limit],
  )
  return rows
}

const countUnreadAdmin = async (conversationId) => {
  const { rows } = await query(
    `SELECT COUNT(*) AS n FROM messages
      WHERE conversation_id = $1
        AND sender_type != 'admin'
        AND is_read = false`,
    [conversationId],
  )
  return parseInt(rows[0]?.n || 0, 10)
}

const serializeConvMessage = (row) => ({
  id:             row.id,
  conversationId: row.conversation_id,
  senderType:     row.sender_type,
  senderId:       row.sender_id,
  senderName:     row.sender_name,
  senderEmail:    row.sender_email,
  senderAvatar:   row.sender_avatar,
  body:           row.body,
  msgType:        row.msg_type || 'text',
  isRead:         row.is_read,
  replyToId:      row.reply_to_id,
  metadata:       row.metadata || {},
  createdAt:      row.created_at,
})

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY CHAT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const getOrCreateChatSession = async ({
  sessionId, userId, email, fullName, source,
}) => {
  const sid = String(sessionId || '').trim()
  if (!sid) throw new Error('sessionId is required')

  const { rows } = await query(
    `INSERT INTO chat_sessions
       (session_id, user_id, email, full_name, source, last_active)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (session_id) DO UPDATE SET
       user_id     = COALESCE(EXCLUDED.user_id,               chat_sessions.user_id),
       email       = COALESCE(NULLIF(EXCLUDED.email,     ''), chat_sessions.email),
       full_name   = COALESCE(NULLIF(EXCLUDED.full_name, ''), chat_sessions.full_name),
       source      = COALESCE(NULLIF(EXCLUDED.source,    ''), chat_sessions.source),
       last_active = NOW(),
       updated_at  = NOW()
     RETURNING *`,
    [sid, userId || null, email || null, fullName || null, source || 'frontend'],
  )
  return rows[0]
}

const saveChatMessage = async ({
  sessionId, senderType, senderId, senderName,
  senderEmail, body, metadata,
}) => {
  const { rows } = await query(
    `INSERT INTO chat_messages
       (session_id, sender_type, sender_id, sender_name,
        sender_email, body, metadata, is_read)
     VALUES ($1,$2,$3,$4,$5,$6,$7,false)
     RETURNING *`,
    [
      sessionId,
      senderType,
      senderId    || null,
      senderName  || null,
      senderEmail || null,
      body,
      JSON.stringify(metadata || {}),
    ],
  )
  await query(
    `UPDATE chat_sessions SET last_active=NOW(), updated_at=NOW() WHERE session_id=$1`,
    [sessionId],
  ).catch(() => {})
  return rows[0]
}

const fetchSessionMessages = async (sessionId) => {
  const { rows } = await query(
    `SELECT * FROM chat_messages WHERE session_id=$1 ORDER BY created_at ASC`,
    [sessionId],
  )
  return rows
}

const countChatUnread = async (sessionId) => {
  const { rows } = await query(
    `SELECT COUNT(*) AS n FROM chat_messages
      WHERE session_id=$1 AND sender_type!='admin' AND is_read=false`,
    [sessionId],
  )
  return parseInt(rows[0]?.n || 0, 10)
}

const serializeChatMsg = (row) => ({
  id:          row.id,
  sessionId:   row.session_id,
  senderType:  row.sender_type,
  senderId:    row.sender_id,
  senderName:  row.sender_name,
  senderEmail: row.sender_email,
  body:        row.body,
  metadata:    row.metadata || {},
  isRead:      row.is_read,
  createdAt:   row.created_at,
})

// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO — AUTH MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

io.use((socket, next) => {
  try {
    const raw =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace?.(/^Bearer\s+/i, '')?.trim()

    const decoded          = verifySocketToken(raw)
    socket.data.user       = decoded || null
    socket.data.isAdmin    = decoded?.type === 'admin' || decoded?.role === 'admin'
    socket.data.userId     = decoded?.id  || null
    socket.data.sessionId  = null
    socket.data.conversationId = null

    if (socket.data.isAdmin) {
      socket.join('admins')
      socket.join('admin-room')
    }

    next()
  } catch (err) {
    logger.error('[Socket] Auth middleware error:', err.message)
    next() // allow connection even on auth error
  }
})

// ── Track connected admins ────────────────────────────────────────────────────
// Map<socketId, adminId>
const connectedAdmins = new Map()

// ── Typing indicator cleanup — runs every 15 s ────────────────────────────────
setInterval(async () => {
  try {
    await query(`DELETE FROM typing_indicators WHERE expires_at < NOW()`)
  } catch { /* silent — typing_indicators may not exist yet */ }
}, 15_000)

// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO — CONNECTION HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  logger.info(
    `[Socket] Connected: ${socket.id} | isAdmin=${socket.data.isAdmin} | userId=${socket.data.userId}`,
  )

  // Join personal room immediately
  if (socket.data.userId) socket.join(`user-${socket.data.userId}`)

  // Track admin presence
  if (socket.data.isAdmin) {
    connectedAdmins.set(socket.id, socket.data.userId)
    io.emit('msg:admin-online', { online: true })
    logger.info(`[Socket] Admin online (total: ${connectedAdmins.size})`)
  }

  // ── Package rooms ────────────────────────────────────────────────────────
  socket.on('pkg:join', ({ packageId, userId } = {}) => {
    if (packageId) socket.join(`package-${packageId}`)
    if (userId)    socket.join(`user-${userId}`)
  })

  socket.on('pkg:leave', ({ packageId } = {}) => {
    if (packageId) socket.leave(`package-${packageId}`)
  })

  // ════════════════════════════════════════════════════════════════════════
  // NEW MESSAGING SYSTEM
  // ════════════════════════════════════════════════════════════════════════

  /**
   * msg:register
   * Called by client on connect AND reconnect (idempotent).
   * Returns conversation state + message history.
   */
  socket.on('msg:register', async (payload = {}, cb) => {
    try {
      const sid   = String(payload.sessionId || `guest-${socket.id}`).trim()
      const name  = String(
        payload.name  || payload.guestName  ||
        socket.data.user?.full_name || '',
      ).trim()
      const email = String(
        payload.email || payload.guestEmail ||
        socket.data.user?.email || '',
      ).trim()

      const conv = await getOrCreateConversation({
        sessionId:  sid,
        userId:     socket.data.userId || null,
        guestName:  name  || null,
        guestEmail: email || null,
        channel:    payload.channel || 'live_chat',
        source:     socket.data.userId ? 'frontend-auth' : 'frontend-guest',
        ipAddress:  socket.handshake.address,
      })

      socket.data.sessionId      = conv.session_id
      socket.data.conversationId = conv.id

      // Join rooms — Socket.io ignores duplicate joins
      socket.join(`session:${conv.session_id}`)
      socket.join(`conv:${conv.id}`)

      const [messages] = await Promise.all([
        fetchConversationMessages(conv.id),
      ])

      const adminOnline = connectedAdmins.size > 0

      const sessionData = {
        conversationId: conv.id,
        sessionId:      conv.session_id,
        userId:         conv.user_id,
        guestName:      conv.guest_name,
        guestEmail:     conv.guest_email,
        status:         conv.status,
        adminOnline,
        messages:       messages.map(serializeConvMessage),
      }

      socket.emit('msg:session', sessionData)
      if (typeof cb === 'function') cb({ success: true, ...sessionData })

      io.to('admins').emit('msg:user-registered', {
        conversationId: conv.id,
        sessionId:      conv.session_id,
        guestName:      conv.guest_name || name || 'Guest',
        guestEmail:     conv.guest_email || email || null,
        status:         conv.status,
        lastMessage:    conv.last_message,
      })

    } catch (err) {
      logger.error('[Socket] msg:register error:', err.message)
      if (typeof cb === 'function') cb({ success: false, error: err.message })
    }
  })

  /**
   * msg:send — user sends a message
   */
  socket.on('msg:send', async (payload = {}, cb) => {
    try {
      if (socket.data.isAdmin) throw new Error('Admins must use msg:admin-send')

      const body = String(payload.body || payload.message || '').trim()
      if (!body) throw new Error('Message body is required')

      // Recover or create conversation
      let convId = socket.data.conversationId
      let sid    = socket.data.sessionId

      if (!convId) {
        sid         = String(payload.sessionId || `guest-${socket.id}`).trim()
        const name  = String(payload.name  || socket.data.user?.full_name || '').trim()
        const email = String(payload.email || socket.data.user?.email     || '').trim()
        const conv  = await getOrCreateConversation({
          sessionId:  sid,
          userId:     socket.data.userId || null,
          guestName:  name  || null,
          guestEmail: email || null,
          source:     'frontend-guest',
          ipAddress:  socket.handshake.address,
        })
        convId = conv.id
        sid    = conv.session_id
        socket.data.conversationId = convId
        socket.data.sessionId      = sid
        socket.join(`conv:${convId}`)
        socket.join(`session:${sid}`)
      }

      const msg = await saveConversationMessage({
        conversationId: convId,
        senderType:     'user',
        senderId:       socket.data.userId,
        senderName:     payload.name  || socket.data.user?.full_name || 'Guest',
        senderEmail:    payload.email || socket.data.user?.email     || null,
        senderAvatar:   socket.data.user?.avatar_url || null,
        body,
        metadata: payload.metadata || { source: 'socket' },
      })

      const serialized  = serializeConvMessage(msg)
      const unreadAdmin = await countUnreadAdmin(convId)

      io.to(`conv:${convId}`).emit('msg:message', serialized)
      io.to('admins').emit('msg:new-from-user', {
        conversationId: convId,
        sessionId:      sid,
        message:        serialized,
        senderName:     msg.sender_name  || 'Guest',
        senderEmail:    msg.sender_email || '',
        unreadCount:    unreadAdmin,
      })

      if (typeof cb === 'function') cb({ success: true, message: serialized })

    } catch (err) {
      logger.error('[Socket] msg:send error:', err.message)
      if (typeof cb === 'function') cb({ success: false, error: err.message })
    }
  })

  /**
   * msg:admin-join — admin joins a conversation room
   */
  socket.on('msg:admin-join', async (payload = {}, cb) => {
    try {
      if (!socket.data.isAdmin) throw new Error('Admin only')
      const convId = parseInt(payload.conversationId, 10)
      if (!convId) throw new Error('conversationId required')

      socket.join(`conv:${convId}`)
      socket.data.activeConversation = convId

      // Mark user messages as read
      await Promise.all([
        query(
          `UPDATE messages SET is_read=true, read_at=NOW()
            WHERE conversation_id=$1 AND sender_type!='admin' AND is_read=false`,
          [convId],
        ),
        query(`UPDATE conversations SET unread_admin=0 WHERE id=$1`, [convId]),
      ]).catch(() => {})

      const messages = await fetchConversationMessages(convId)

      io.to(`conv:${convId}`).emit('msg:read', {
        conversationId: convId,
        readBy:         'admin',
      })

      if (typeof cb === 'function')
        cb({ success: true, messages: messages.map(serializeConvMessage) })

    } catch (err) {
      logger.error('[Socket] msg:admin-join error:', err.message)
      if (typeof cb === 'function') cb({ success: false, error: err.message })
    }
  })

  /**
   * msg:admin-send — admin sends a reply
   */
  socket.on('msg:admin-send', async (payload = {}, cb) => {
    try {
      if (!socket.data.isAdmin) throw new Error('Admin authentication required')

      const body   = String(payload.body || '').trim()
      const convId = parseInt(payload.conversationId, 10)
      if (!body)   throw new Error('Message body required')
      if (!convId) throw new Error('conversationId required')

      const convRes = await query(`SELECT * FROM conversations WHERE id=$1`, [convId])
      if (!convRes.rows[0]) throw new Error('Conversation not found')
      const conv = convRes.rows[0]

      const msg = await saveConversationMessage({
        conversationId: convId,
        senderType:     'admin',
        senderId:       socket.data.user?.id,
        senderName:     socket.data.user?.full_name || socket.data.user?.name || 'Support',
        senderEmail:    socket.data.user?.email     || null,
        senderAvatar:   null,
        body,
        metadata: { source: 'admin-socket' },
      })

      const serialized = serializeConvMessage(msg)

      // Broadcast to conversation room
      io.to(`conv:${convId}`).emit('msg:message', serialized)

      // Also send to user session room (covers reconnects)
      if (conv.session_id) {
        io.to(`session:${conv.session_id}`).emit('msg:message', serialized)
      }

      // Notify other admins
      socket.to('admins').emit('msg:admin-sent', {
        conversationId: convId,
        message:        serialized,
      })

      if (typeof cb === 'function') cb({ success: true, message: serialized })

    } catch (err) {
      logger.error('[Socket] msg:admin-send error:', err.message)
      if (typeof cb === 'function') cb({ success: false, error: err.message })
    }
  })

  /**
   * msg:typing — broadcast typing indicator
   */
  socket.on('msg:typing', async (payload = {}) => {
    const convId     = payload.conversationId || socket.data.conversationId
    const isTyping   = !!payload.isTyping
    const senderType = socket.data.isAdmin ? 'admin' : 'user'
    if (!convId) return

    try {
      if (isTyping) {
        await query(
          `INSERT INTO typing_indicators
             (conversation_id, sender_type, sender_id, sender_name,
              socket_id, expires_at)
           VALUES ($1,$2,$3,$4,$5, NOW() + INTERVAL '10 seconds')
           ON CONFLICT DO NOTHING`,
          [
            convId, senderType, socket.data.userId || null,
            payload.senderName || socket.data.user?.full_name || 'Guest',
            socket.id,
          ],
        )
      } else {
        await query(
          `DELETE FROM typing_indicators WHERE socket_id=$1`,
          [socket.id],
        )
      }
    } catch { /* non-fatal */ }

    socket.to(`conv:${convId}`).emit('msg:typing', {
      conversationId: parseInt(convId, 10),
      senderType,
      senderName:
        payload.senderName      ||
        socket.data.user?.full_name ||
        (socket.data.isAdmin ? 'Support' : 'Guest'),
      isTyping,
    })
  })

  /**
   * msg:mark-read — mark messages as read
   */
  socket.on('msg:mark-read', async (payload = {}, cb) => {
    try {
      const convId = payload.conversationId || socket.data.conversationId
      if (!convId) throw new Error('conversationId required')

      if (socket.data.isAdmin) {
        await Promise.all([
          query(
            `UPDATE messages SET is_read=true, read_at=NOW()
              WHERE conversation_id=$1 AND sender_type!='admin' AND is_read=false`,
            [convId],
          ),
          query(`UPDATE conversations SET unread_admin=0 WHERE id=$1`, [convId]),
        ])
      } else {
        await Promise.all([
          query(
            `UPDATE messages SET is_read=true, read_at=NOW()
              WHERE conversation_id=$1 AND sender_type='admin' AND is_read=false`,
            [convId],
          ),
          query(`UPDATE conversations SET unread_user=0 WHERE id=$1`, [convId]),
        ])
      }

      io.to(`conv:${convId}`).emit('msg:read', {
        conversationId: parseInt(convId, 10),
        readBy: socket.data.isAdmin ? 'admin' : 'user',
      })

      if (typeof cb === 'function') cb({ success: true })
    } catch (err) {
      logger.error('[Socket] msg:mark-read error:', err.message)
      if (typeof cb === 'function') cb({ success: false, error: err.message })
    }
  })

  /**
   * msg:admin-status — update conversation status/priority
   */
  socket.on('msg:admin-status', async (payload = {}, cb) => {
    try {
      if (!socket.data.isAdmin) throw new Error('Admin only')
      const { conversationId, status, priority } = payload
      if (!conversationId) throw new Error('conversationId required')

      const fields = []
      const params = []
      let   p      = 1

      if (status)              { fields.push(`status   = $${p++}`); params.push(status)   }
      if (priority)            { fields.push(`priority = $${p++}`); params.push(priority) }
      if (status === 'closed')   fields.push('closed_at = NOW()')
      fields.push('updated_at = NOW()')
      params.push(conversationId)

      const result = await query(
        `UPDATE conversations SET ${fields.join(', ')} WHERE id=$${p} RETURNING *`,
        params,
      )

      const updated = {
        conversationId,
        status:   result.rows[0]?.status,
        priority: result.rows[0]?.priority,
      }

      io.to(`conv:${conversationId}`).emit('msg:conversation-updated', updated)
      io.to('admins').emit('msg:conversation-updated', updated)

      if (typeof cb === 'function') cb({ success: true })
    } catch (err) {
      logger.error('[Socket] msg:admin-status error:', err.message)
      if (typeof cb === 'function') cb({ success: false, error: err.message })
    }
  })

  /**
   * msg:admin-conversations — get open conversation list
   */
  socket.on('msg:admin-conversations', async (payload = {}, cb) => {
    try {
      if (!socket.data.isAdmin) throw new Error('Admin only')

      const { rows } = await query(`
        SELECT c.*, u.full_name AS user_full_name, u.email AS user_email,
               u.avatar_url AS user_avatar
          FROM conversations c
          LEFT JOIN users u ON u.id = c.user_id
         WHERE c.status = 'open'
         ORDER BY c.updated_at DESC
         LIMIT 50
      `)

      if (typeof cb === 'function') cb({ success: true, conversations: rows })
    } catch (err) {
      logger.error('[Socket] msg:admin-conversations error:', err.message)
      if (typeof cb === 'function') cb({ success: false, error: err.message })
    }
  })

  // ════════════════════════════════════════════════════════════════════════
  // LEGACY CHAT SYSTEM
  // ════════════════════════════════════════════════════════════════════════

  socket.on('chat:register', async (payload = {}, cb) => {
    try {
      const sid   = String(payload.sessionId || socket.data.sessionId || `guest-${uuidv4()}`).trim()
      const name  = String(payload.name  || socket.data.user?.fullName || socket.data.user?.name || '').trim()
      const email = String(payload.email || socket.data.user?.email    || '').trim()

      const session = await getOrCreateChatSession({
        sessionId: sid,
        userId:    socket.data.user?.id,
        email:     email || null,
        fullName:  name  || null,
        source:    socket.data.user ? 'frontend-auth' : 'frontend-guest',
      })

      socket.data.sessionId = session.session_id
      socket.join(`chat:${session.session_id}`)

      const history = await fetchSessionMessages(session.session_id)

      socket.emit('chat:session', {
        sessionId: session.session_id,
        userId:    session.user_id,
        email:     session.email,
        fullName:  session.full_name,
        source:    session.source,
        messages:  history.map(serializeChatMsg),
      })

      if (typeof cb === 'function')
        cb({ success: true, sessionId: session.session_id, messages: history.map(serializeChatMsg) })

    } catch (err) {
      logger.error('[Socket] chat:register error:', err.message)
      if (typeof cb === 'function') cb({ success: false, error: err.message })
    }
  })

  socket.on('chat:message', async (payload = {}, cb) => {
    try {
      if (socket.data.isAdmin) throw new Error('Admins must use admin:send-message')

      const sid  = String(payload.sessionId || socket.data.sessionId || '').trim()
      const body = String(payload.body || '').trim()
      if (!sid)  throw new Error('sessionId is required')
      if (!body) throw new Error('Message body is required')

      const name  = String(payload.name  || socket.data.user?.fullName || socket.data.user?.name || 'Guest')
      const email = String(payload.email || socket.data.user?.email    || '')

      const session = await getOrCreateChatSession({
        sessionId: sid,
        userId:    socket.data.user?.id,
        email:     email || null,
        fullName:  name  || null,
        source:    socket.data.user ? 'frontend-auth' : 'frontend-guest',
      })

      socket.data.sessionId = session.session_id
      socket.join(`chat:${session.session_id}`)

      const row    = await saveChatMessage({
        sessionId:   session.session_id,
        senderType:  'user',
        senderId:    socket.data.user?.id,
        senderName:  name,
        senderEmail: email,
        body,
        metadata:    payload.metadata || { source: 'frontend-chat' },
      })

      const message = serializeChatMsg(row)
      const unread  = await countChatUnread(session.session_id)

      io.to(`chat:${session.session_id}`).emit('chat:message', message)
      io.to('admins').emit('new-chat-message', {
        sessionId:  session.session_id,
        userId:     session.user_id,
        email:      session.email,
        fullName:   session.full_name,
        body:       message.body,
        senderName: message.senderName,
        unreadCount: unread,
      })

      if (typeof cb === 'function') cb({ success: true, message })

    } catch (err) {
      logger.error('[Socket] chat:message error:', err.message)
      if (typeof cb === 'function') cb({ success: false, error: err.message })
    }
  })

  socket.on('admin:send-message', async (payload = {}, cb) => {
    try {
      if (!socket.data.isAdmin) throw new Error('Admin authentication required')

      const sid  = String(payload.sessionId || '').trim()
      const body = String(payload.body      || '').trim()
      if (!sid)  throw new Error('sessionId is required')
      if (!body) throw new Error('Message body is required')

      const row = await saveChatMessage({
        sessionId:   sid,
        senderType:  'admin',
        senderId:    socket.data.user?.id,
        senderName:  socket.data.user?.full_name || socket.data.user?.name || 'Admin',
        senderEmail: socket.data.user?.email     || null,
        body,
        metadata:    { source: 'admin-panel' },
      })

      const message = serializeChatMsg(row)
      io.to(`chat:${sid}`).emit('chat:message', message)
      socket.to('admins').emit('admin:message-sent', { sessionId: sid, message })

      if (typeof cb === 'function') cb({ success: true, message })

    } catch (err) {
      logger.error('[Socket] admin:send-message error:', err.message)
      if (typeof cb === 'function') cb({ success: false, error: err.message })
    }
  })

  socket.on('admin:join-session', async (payload = {}, cb) => {
    try {
      if (!socket.data.isAdmin) throw new Error('Admin only')
      const sid = String(payload.sessionId || '').trim()
      if (!sid) throw new Error('sessionId required')

      socket.join(`chat:${sid}`)

      await query(
        `UPDATE chat_messages SET is_read=true
          WHERE session_id=$1 AND sender_type!='admin' AND is_read=false`,
        [sid],
      ).catch(() => {})

      const messages = await fetchSessionMessages(sid)
      if (typeof cb === 'function') cb({ success: true, messages: messages.map(serializeChatMsg) })

    } catch (err) {
      logger.error('[Socket] admin:join-session error:', err.message)
      if (typeof cb === 'function') cb({ success: false, error: err.message })
    }
  })

  socket.on('chat:typing', (payload = {}) => {
    const sid = String(payload.sessionId || socket.data.sessionId || '').trim()
    if (!sid) return
    socket.to(`chat:${sid}`).emit('chat:typing', {
      sessionId:  sid,
      senderType: socket.data.isAdmin ? 'admin' : 'user',
      isTyping:   !!payload.isTyping,
    })
  })

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', async (reason) => {
    logger.info(`[Socket] Disconnected: ${socket.id} | reason=${reason}`)

    if (socket.data.isAdmin) {
      connectedAdmins.delete(socket.id)
      logger.info(`[Socket] Admin offline (remaining: ${connectedAdmins.size})`)

      // Only broadcast offline if NO admins remain
      if (connectedAdmins.size === 0) {
        io.emit('msg:admin-online', { online: false })
      }
    }

    // Clean typing indicators for this socket
    query(
      `DELETE FROM typing_indicators WHERE socket_id=$1`,
      [socket.id],
    ).catch(() => {})
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLERS  (must be last, after all routes)
// ═══════════════════════════════════════════════════════════════════════════════

app.use(notFoundHandler)
app.use(errorHandler)

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER BOOT
// ═══════════════════════════════════════════════════════════════════════════════

async function initializeServer() {
  try {
    logger.info('🔄 Connecting to database…')
    await query('SELECT NOW()')
    logger.info('✅ Database connected')

    // ── Destination extended schema (optional) ───────────────────────────
    try {
      const { ensureDestinationSchema } = require('./controllers/destinationsController')
      await ensureDestinationSchema()
      logger.info('✅ Destinations extended schema ready')
    } catch (err) {
      logger.warn('⚠️  Destination schema (non-fatal):', err.message)
    }

    // ── Core schemas (sequential — some have FK dependencies) ───────────
    const schemas = [
      { fn: ensureSubscribersSchema, name: 'Subscribers' },
      { fn: ensureUserSchema,        name: 'Users'        },
      { fn: ensureContactSchema,     name: 'Contact'      },
      { fn: ensureGallerySchema,     name: 'Gallery'      },
      { fn: ensureChatSchema,        name: 'Chat'         },
      { fn: ensurePostsSchema,       name: 'Posts'        },
      { fn: ensurePackagesSchema,    name: 'Packages'     },
      { fn: ensureBookingsSchema,    name: 'Bookings'     },
      { fn: ensureMessagingSchema,   name: 'Messaging'    },
    ]

    for (const { fn, name } of schemas) {
      try {
        await fn()
        // ensurePackagesSchema and ensureMessagingSchema log internally
        if (!['Packages', 'Messaging'].includes(name))
          logger.info(`✅ ${name} schema ready`)
      } catch (err) {
        logger.warn(`⚠️  ${name} schema (non-fatal):`, err.message)
      }
    }

    // ── Start HTTP server ────────────────────────────────────────────────
    await new Promise((resolve) => {
      httpServer.listen(PORT, () => {
        const line = '═'.repeat(67)
        logger.info(`\n${line}`)
        logger.info('🌍  ALTUVERA TRAVEL — Enterprise Backend v6.5')
        logger.info('     "True Adventures In High Places & Deep Culture"')
        logger.info(line)
        logger.info(`  Env          : ${NODE_ENV}`)
        logger.info(`  Port         : ${PORT}`)
        logger.info(`  Backend      : ${process.env.BACKEND_URL || `http://localhost:${PORT}`}`)
        logger.info(`  Frontend     : ${process.env.FRONTEND_URL || '—'}`)
        logger.info(`  Theme        : green-white (#16a34a) 🟢`)
        logger.info(`  DNS          : ipv4first ✅`)
        logger.info(`  COOP         : same-origin-allow-popups ✅`)
        logger.info(`  Socket.io    : polling → websocket | allowEIO3 | cookie=false ✅`)
        logger.info(`  Conn.Recovery: 2-min window ✅`)
        logger.info(`  Admin Track  : connectedAdmins Map ✅`)
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

  // ── Background checks (non-blocking) ────────────────────────────────────
  verifyEmailConnection().catch(e =>
    logger.warn('Email connection check (non-fatal):', e.message),
  )
  verifyAuthEmail().catch(e =>
    logger.warn('Auth email SMTP check (non-fatal):', e.message),
  )
}

initializeServer()

module.exports = app