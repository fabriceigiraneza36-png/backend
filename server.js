/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA TRAVEL - ENTERPRISE BACKEND SERVER v6.2
 * "True Adventures In High Places & Deep Culture"
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config({
  path: require('path').resolve(process.cwd(), '.env'),
});

const path        = require('path');
const http        = require('http');
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const compression = require('compression');
const jwt         = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Server }  = require('socket.io');

const { query, ensureContactSchema, ensureChatSchema } = require('./config/db');
const logger    = require('./utils/logger');
const shutdown  = require('./utils/shutdown');
const socketBus = require('./utils/socketBus');
const swaggerUi = require('swagger-ui-express');

// ── Middleware ──────────────────────────────────────────────────────────────────
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { cacheMiddleware }               = require('./middleware/cache');

// ── Routes ──────────────────────────────────────────────────────────────────────
const usersRouter               = require('./routes/users');
const bookingsRouter            = require('./routes/bookings');
const countriesRouter           = require('./routes/countries');
const destinationsRouter        = require('./routes/destinations');
const postsRouter               = require('./routes/posts');
const contactRouter             = require('./routes/contact');
const galleryRouter             = require('./routes/gallery');
const teamRouter                = require('./routes/team');
const faqsRouter                = require('./routes/faqs');
const servicesRouter            = require('./routes/services');
const tipsRouter                = require('./routes/tips');
const virtualToursRouter        = require('./routes/virtualTours');
const subscribersRouter         = require('./routes/subscribers');
const settingsRouter            = require('./routes/settings');
const messageRouter             = require('./routes/message');
const pagesRouter               = require('./routes/pages');
const chatRouter                = require('./routes/chat');
const uploadsRouter             = require('./routes/uploads');
const mediaUploadsRouter        = require('./routes/mediaUploads');
const adminAuthRouter           = require('./routes/adminAuth');
const webauthnRouter            = require('./routes/webauthn');
const countryLikesRouter        = require('./routes/countryLikes');
const countryCommentsRouter     = require('./routes/countryComments');
const countryRatingsRouter      = require('./routes/countryRatings');
const destinationLikesRouter    = require('./routes/destinationLikes');
const destinationCommentsRouter = require('./routes/destinationComments');
const destinationRatingsRouter  = require('./routes/destinationRatings');
const searchRoutes              = require('./routes/search.routes');

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const PORT     = parseInt(process.env.PORT || '5000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD  = NODE_ENV === 'production';

// ═══════════════════════════════════════════════════════════════════════════════
// ALLOWED ORIGINS
// ═══════════════════════════════════════════════════════════════════════════════

const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = [
  ...new Set([
    process.env.FRONTEND_URL,
    process.env.BACKEND_URL,
    ...envOrigins,
    // ✅ Always allow the admin panel
    'https://altuverapanel.vercel.app',
    'https://altuvera.vercel.app',
    'https://altuvera.com',
    'https://www.altuvera.com',
    // Dev origins
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:4173',
  ].filter(Boolean)),
];

// ── Origin checker ──────────────────────────────────────────────────────────────
const isOriginAllowed = (origin) => {
  if (!origin) return true; // server-to-server / Postman / curl
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPRESS APP
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
app.set('trust proxy', 1);

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY HEADERS
// ═══════════════════════════════════════════════════════════════════════════════

app.use(
  helmet({
    contentSecurityPolicy:    false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy:  false, // Required for Google OAuth popups
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ── OAuth popup support headers ────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy',   'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// CORS
// ═══════════════════════════════════════════════════════════════════════════════

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    logger.warn(`[CORS] Blocked: ${origin}`);
    // In non-production: warn but allow (prevents 500 errors during dev)
    if (!IS_PROD) return callback(null, true);
    return callback(null, false);
  },
  credentials:         true,
  methods:             ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders:      [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'X-CSRF-Token',
    'Cache-Control',
  ],
  exposedHeaders:      ['X-Total-Count', 'X-Page', 'X-Per-Page'],
  optionsSuccessStatus: 200,
  maxAge:               86400,
};

// ✅ CORS must be BEFORE all routes
app.use(cors(corsOptions));

// ✅ Explicit OPTIONS preflight handler (belt-and-suspenders)
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin',      origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
  res.setHeader('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(','));
  res.setHeader('Access-Control-Max-Age',       '86400');
  return res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cacheMiddleware(120));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Request logging ────────────────────────────────────────────────────────────
if (IS_PROD) {
  app.use(
    morgan('combined', {
      stream: { write: (msg) => logger.http(msg.trim()) },
      skip:   (req) => req.url === '/health' || req.url === '/api/health',
    })
  );
} else {
  app.use(
    morgan('dev', {
      skip: (req) => req.url === '/health',
    })
  );
}

// ── Request ID (tracing) ───────────────────────────────────────────────────────
app.use((req, _res, next) => {
  req.id = uuidv4();
  next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH & META ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/health', (_req, res) => {
  res.json({
    success:     true,
    status:      'healthy',
    service:     'Altuvera Travel API',
    version:     '6.2',
    environment: NODE_ENV,
    uptime:      Math.floor(process.uptime()),
    timestamp:   new Date().toISOString(),
    memory: {
      used:  `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
    },
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    success:   true,
    status:    'healthy',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api', (_req, res) => {
  res.json({
    success:  true,
    name:     'Altuvera Travel API',
    version:  '6.2',
    tagline:  'True Adventures In High Places & Deep Culture',
    docs:     '/api/docs',
    health:   '/health',
    routes:   '/api/routes',
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE INSPECTION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

const cleanPath = (p = '') =>
  p
    .replace(/\\/g, '')
    .replace(/\/+$/, '')
    .replace(/\/\//g, '/')
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ':param')
    .replace(/\(\[\^\\\/\]\+\?\)/g, ':param')
    .replace(/^\^/, '')
    .replace(/\$\/i$/, '')
    .replace(/\$$/, '')
    .replace(/\(\?=\/\|\$\)/g, '');

const collectRoutes = (stack, prefix = '') => {
  const routes = [];
  for (const layer of stack) {
    if (layer.route?.path) {
      const full    = cleanPath(prefix + layer.route.path) || '/';
      const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
      for (const method of methods) {
        routes.push({ method, path: full });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const nested = cleanPath(layer.regexp?.source || '');
      routes.push(...collectRoutes(layer.handle.stack, prefix + nested));
    }
  }
  return routes;
};

app.get('/api/routes', (req, res) => {
  const routes = collectRoutes(app._router?.stack || []);
  const byMethod = routes.reduce((acc, r) => {
    acc[r.method] = (acc[r.method] || 0) + 1;
    return acc;
  }, {});
  res.json({ success: true, total: routes.length, byMethod, routes });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SWAGGER / OPENAPI DOCS
// ═══════════════════════════════════════════════════════════════════════════════

const buildOpenApiSpec = () => {
  const routes = collectRoutes(app._router?.stack || []);
  const paths  = {};
  for (const route of routes) {
    paths[route.path] = paths[route.path] || {};
    paths[route.path][route.method.toLowerCase()] = {
      summary:   `${route.method} ${route.path}`,
      responses: {
        200: { description: 'Success' },
        401: { description: 'Unauthorized' },
        404: { description: 'Not found' },
        500: { description: 'Server error' },
      },
    };
  }
  return {
    openapi: '3.0.1',
    info: {
      title:       'Altuvera Travel API',
      version:     '6.2',
      description: 'Interactive API docs for Altuvera Travel backend',
    },
    servers: [{ url: process.env.BACKEND_URL || `http://localhost:${PORT}` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    paths,
  };
};

// Docs mounted after all routes (at server start)

// ═══════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Auth
app.use('/api/admin/auth', adminAuthRouter);
app.use('/auth/webauthn',  webauthnRouter);

// Core resources
app.use('/api/users',        usersRouter);
app.use('/api/bookings',     bookingsRouter);
app.use('/api/countries',    countriesRouter);
app.use('/api/destinations', destinationsRouter);
app.use('/api/posts',        postsRouter);
app.use('/api/contact',      contactRouter);
app.use('/api/gallery',      galleryRouter);
app.use('/api/team',         teamRouter);
app.use('/api/faqs',         faqsRouter);
app.use('/api/services',     servicesRouter);
app.use('/api/tips',         tipsRouter);
app.use('/api/subscribers',  subscribersRouter);
app.use('/api/settings',     settingsRouter);
app.use('/api/pages',        pagesRouter);
app.use('/api/message',      messageRouter);
app.use('/api/chat',         chatRouter);
app.use('/api/search',       searchRoutes);

// Media
app.use('/api/uploads', uploadsRouter);
app.use('/api/media',   mediaUploadsRouter);

// Virtual tours
app.use('/api/virtual-tours', virtualToursRouter);

// Social — countries
app.use('/api/country-likes',    countryLikesRouter);
app.use('/api/country-comments', countryCommentsRouter);
app.use('/api/country-ratings',  countryRatingsRouter);

// Social — destinations
app.use('/api/destination-likes',    destinationLikesRouter);
app.use('/api/destination-comments', destinationCommentsRouter);
app.use('/api/destination-ratings',  destinationRatingsRouter);

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP SERVER + SOCKET.IO
// ═══════════════════════════════════════════════════════════════════════════════

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin:      (origin, cb) => cb(null, isOriginAllowed(origin)),
    methods:     ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout:  60000,
  pingInterval: 25000,
  transports:  ['websocket', 'polling'],
});

socketBus.setIO(io);

// ── JWT verification for sockets ────────────────────────────────────────────────
const verifySocketToken = (token) => {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
};

// ── Chat DB helpers ────────────────────────────────────────────────────────────
const getOrCreateChatSession = async ({
  sessionId, userId, email, fullName, source,
}) => {
  const sid = String(sessionId || '').trim();
  if (!sid) throw new Error('sessionId is required');

  const { rows } = await query(
    `INSERT INTO chat_sessions
       (session_id, user_id, email, full_name, source, last_active)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (session_id) DO UPDATE SET
       user_id   = COALESCE(EXCLUDED.user_id,   chat_sessions.user_id),
       email     = COALESCE(NULLIF(EXCLUDED.email,     ''), chat_sessions.email),
       full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), chat_sessions.full_name),
       source    = COALESCE(NULLIF(EXCLUDED.source,    ''), chat_sessions.source),
       last_active = NOW(),
       updated_at  = NOW()
     RETURNING *`,
    [sid, userId || null, email || null, fullName || null, source || 'frontend']
  );
  return rows[0];
};

const saveChatMessage = async ({
  sessionId, senderType, senderId,
  senderName, senderEmail, body, metadata,
}) => {
  const { rows } = await query(
    `INSERT INTO chat_messages
       (session_id, sender_type, sender_id, sender_name, sender_email, body, metadata, is_read)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false)
     RETURNING *`,
    [sessionId, senderType, senderId || null,
     senderName || null, senderEmail || null,
     body, metadata || {}]
  );
  await query(
    `UPDATE chat_sessions SET last_active = NOW(), updated_at = NOW() WHERE session_id = $1`,
    [sessionId]
  );
  return rows[0];
};

const fetchSessionMessages = async (sessionId) => {
  const { rows } = await query(
    `SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  );
  return rows;
};

const countUnread = async (sessionId) => {
  const { rows } = await query(
    `SELECT COUNT(*) AS n FROM chat_messages
     WHERE session_id = $1 AND sender_type != 'admin' AND is_read = false`,
    [sessionId]
  );
  return parseInt(rows[0]?.n || '0', 10);
};

const serializeMsg = (row) => ({
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
});

// ── Socket auth middleware ──────────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token
    || socket.handshake.headers?.authorization?.split?.(' ')[1];

  const decoded       = verifySocketToken(token);
  socket.data.user    = decoded || null;
  socket.data.isAdmin = decoded?.type === 'admin';

  if (socket.data.isAdmin) socket.join('admins');
  next();
});

// ── Socket event handlers ──────────────────────────────────────────────────────
io.on('connection', (socket) => {
  logger.info(`[Socket] Connected: ${socket.id} | admin=${socket.data.isAdmin}`);

  // ── Register / resume chat session ──────────────────────────────────────────
  socket.on('chat:register', async (payload = {}, cb) => {
    try {
      const reqSid = String(payload.sessionId || socket.data.sessionId || '').trim();
      const sid    = reqSid || `guest-${uuidv4()}`;
      const name   = String(payload.name  || socket.data.user?.fullName || socket.data.user?.name  || '').trim();
      const email  = String(payload.email || socket.data.user?.email    || '').trim();

      const session = await getOrCreateChatSession({
        sessionId: sid,
        userId:    socket.data.user?.id,
        email:     email  || null,
        fullName:  name   || null,
        source:    socket.data.user ? 'frontend-auth' : 'frontend-guest',
      });

      socket.data.sessionId = session.session_id;
      socket.join(`chat:${session.session_id}`);

      const history = await fetchSessionMessages(session.session_id);
      socket.emit('chat:session', {
        sessionId: session.session_id,
        userId:    session.user_id,
        email:     session.email,
        fullName:  session.full_name,
        source:    session.source,
        messages:  history.map(serializeMsg),
      });

      if (typeof cb === 'function') {
        cb({ success: true, sessionId: session.session_id, messages: history.map(serializeMsg) });
      }
    } catch (err) {
      logger.error('[Socket] chat:register error:', err.message);
      if (typeof cb === 'function') cb({ success: false, error: err.message });
    }
  });

  // ── User sends a message ─────────────────────────────────────────────────────
  socket.on('chat:message', async (payload = {}, cb) => {
    try {
      if (socket.data.isAdmin) throw new Error('Admins must use admin:send-message');

      const sid  = String(payload.sessionId || socket.data.sessionId || '').trim();
      const body = String(payload.body || '').trim();
      if (!sid)  throw new Error('sessionId is required');
      if (!body) throw new Error('Message body is required');

      const name  = String(payload.name  || socket.data.user?.fullName || socket.data.user?.name  || 'Guest');
      const email = String(payload.email || socket.data.user?.email    || '');

      const session = await getOrCreateChatSession({
        sessionId: sid,
        userId:    socket.data.user?.id,
        email:     email || null,
        fullName:  name  || null,
        source:    socket.data.user ? 'frontend-auth' : 'frontend-guest',
      });

      socket.data.sessionId = session.session_id;
      socket.join(`chat:${session.session_id}`);

      const row     = await saveChatMessage({
        sessionId:   session.session_id,
        senderType:  'user',
        senderId:    socket.data.user?.id,
        senderName:  name,
        senderEmail: email,
        body,
        metadata:    payload.metadata || { source: 'frontend-chat' },
      });

      const message    = serializeMsg(row);
      const unread     = await countUnread(session.session_id);

      io.to(`chat:${session.session_id}`).emit('chat:message', message);
      io.to('admins').emit('new-chat-message', {
        sessionId: session.session_id,
        userId:    session.user_id,
        email:     session.email,
        fullName:  session.full_name,
        body:      message.body,
        senderName: message.senderName,
        unreadCount: unread,
      });

      if (typeof cb === 'function') cb({ success: true, message });
    } catch (err) {
      logger.error('[Socket] chat:message error:', err.message);
      if (typeof cb === 'function') cb({ success: false, error: err.message });
    }
  });

  // ── Admin replies ────────────────────────────────────────────────────────────
  socket.on('admin:send-message', async (payload = {}, cb) => {
    try {
      if (!socket.data.isAdmin) throw new Error('Admin authentication required');

      const sid  = String(payload.sessionId || '').trim();
      const body = String(payload.body || '').trim();
      if (!sid)  throw new Error('sessionId is required');
      if (!body) throw new Error('Message body is required');

      const row = await saveChatMessage({
        sessionId:   sid,
        senderType:  'admin',
        senderId:    socket.data.user?.id,
        senderName:  socket.data.user?.full_name || socket.data.user?.name || 'Admin',
        senderEmail: socket.data.user?.email || null,
        body,
        metadata: { source: 'admin-panel' },
      });

      const message = serializeMsg(row);
      io.to(`chat:${sid}`).emit('chat:message', message);

      if (typeof cb === 'function') cb({ success: true, message });
    } catch (err) {
      logger.error('[Socket] admin:send-message error:', err.message);
      if (typeof cb === 'function') cb({ success: false, error: err.message });
    }
  });

  // ── Admin joins a chat session room ─────────────────────────────────────────
  socket.on('admin:join-session', async (payload = {}, cb) => {
    try {
      if (!socket.data.isAdmin) throw new Error('Admin only');

      const sid = String(payload.sessionId || '').trim();
      if (!sid) throw new Error('sessionId required');

      socket.join(`chat:${sid}`);

      // Mark messages as read
      await query(
        `UPDATE chat_messages SET is_read = true
         WHERE session_id = $1 AND sender_type != 'admin' AND is_read = false`,
        [sid]
      );

      const messages = await fetchSessionMessages(sid);
      if (typeof cb === 'function') {
        cb({ success: true, messages: messages.map(serializeMsg) });
      }
    } catch (err) {
      if (typeof cb === 'function') cb({ success: false, error: err.message });
    }
  });

  // ── Typing indicators ────────────────────────────────────────────────────────
  socket.on('chat:typing', (payload = {}) => {
    const sid = String(payload.sessionId || socket.data.sessionId || '').trim();
    if (!sid) return;
    socket.to(`chat:${sid}`).emit('chat:typing', {
      sessionId:  sid,
      senderType: socket.data.isAdmin ? 'admin' : 'user',
      isTyping:   !!payload.isTyping,
    });
  });

  socket.on('disconnect', (reason) => {
    logger.info(`[Socket] Disconnected: ${socket.id} | reason=${reason}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLERS  (must be AFTER all routes)
// ═══════════════════════════════════════════════════════════════════════════════

app.use(notFoundHandler);
app.use(errorHandler);

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER BOOT
// ═══════════════════════════════════════════════════════════════════════════════

async function initializeServer() {
  try {
    // ── Database ───────────────────────────────────────────────────────────────
    logger.info('🔄 Connecting to database…');
    await query('SELECT NOW()');
    logger.info('✅ Database connected');

    await ensureContactSchema();
    logger.info('✅ Contact schema ready');

    await ensureChatSchema();
    logger.info('✅ Chat schema ready');

    // ── Swagger (mounted after routes so spec is complete) ─────────────────────
    try {
      const spec = buildOpenApiSpec();
      app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { explorer: true }));
      app.get('/api/docs/openapi.json', (_req, res) => res.json(spec));
      logger.info('✅ Swagger docs at /api/docs');
    } catch (swaggerErr) {
      logger.warn('⚠️  Swagger init failed (non-critical):', swaggerErr.message);
    }

    // ── Listen ─────────────────────────────────────────────────────────────────
    const server = httpServer.listen(PORT, () => {
      const divider = '═'.repeat(67);
      logger.info(`\n${divider}`);
      logger.info('🌍  ALTUVERA TRAVEL — Enterprise Backend v6.2');
      logger.info('     "True Adventures In High Places & Deep Culture"');
      logger.info(divider);
      logger.info(`  Env      : ${NODE_ENV}`);
      logger.info(`  Port     : ${PORT}`);
      logger.info(`  Backend  : ${process.env.BACKEND_URL || `http://localhost:${PORT}`}`);
      logger.info(`  Frontend : ${process.env.FRONTEND_URL || '—'}`);
      logger.info(`  CORS     : ${ALLOWED_ORIGINS.join(', ')}`);
      logger.info(`  Docs     : http://localhost:${PORT}/api/docs`);
      logger.info(`  Health   : http://localhost:${PORT}/health`);
      logger.info(`${divider}\n`);
    });

    // ── Graceful shutdown ──────────────────────────────────────────────────────
    shutdown(server);

    return server;
  } catch (err) {
    logger.error('❌ Server boot failed:', err.message);
    process.exit(1);
  }
}

initializeServer();

module.exports = app;