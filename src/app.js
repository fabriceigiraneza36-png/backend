// src/app.js
require('express-async-errors');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const xss = require('xss-clean');
const hpp = require('hpp');

const env = require('./config/env');
const logger = require('./utils/logger');
const corsMiddleware = require('./middleware/cors.middleware');
const requestLogger = require('./middleware/logger.middleware');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler.middleware');
const { apiLimiter } = require('./middleware/rateLimiter.middleware');
const routes = require('./routes');
const { healthCheck } = require('./database/pool');
const JobScheduler = require('./jobs');
const { analyzeRoutes, formatRouteDiagnostics } = require('./utils/routeDiagnostics');
const { authenticate, requireAdmin, requireRole } = require('./middleware/auth.middleware');

const app = express();

// Trust proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(xss());
app.use(hpp());

// CORS
app.use(corsMiddleware);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Compression
app.use(compression());

// Logging
app.use(requestLogger);

// Rate limiting
app.use('/api', apiLimiter);

// API routes
app.use(`/api/${env.apiVersion}`, routes);

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully...`);
  
  const AnalyticsService = require('./services/analytics.service');
  await AnalyticsService.shutdown();
  
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const startServer = async () => {
  try {
    const resolveRouteAccess = (route) => {
      if (route.group === 'users' || route.group === 'payments' || route.group === 'admin') {
        return 'protected';
      }

      if (route.group === 'auth') {
        if (
          route.path.endsWith('/auth/me') ||
          route.path.endsWith('/auth/logout') ||
          route.path.endsWith('/auth/logout-all')
        ) {
          return 'protected';
        }
        return 'public';
      }

      if (route.group === 'subscriptions') {
        if (
          route.path.endsWith('/subscriptions/plans') ||
          route.path.includes('/subscriptions/plans/:slug')
        ) {
          return 'public';
        }
        return 'protected';
      }

      return 'public';
    };

    const routeReport = analyzeRoutes(
      [{ base: '', label: 'core', router: routes }, ...routes.routeMounts],
      `/api/${env.apiVersion}`,
      {
        authMiddleware: [authenticate, requireAdmin, requireRole],
        accessResolver: resolveRouteAccess,
      }
    );
    logger.info(`\n${formatRouteDiagnostics(routeReport)}`);

    if (routeReport.summary.failed > 0 || routeReport.summary.erroneous > 0) {
      throw new Error(
        `Route diagnostics failed (failed=${routeReport.summary.failed}, erroneous=${routeReport.summary.erroneous})`
      );
    }

    if (routeReport.summary.duplicate > 0) {
      logger.warn(`Duplicate route signatures detected: ${routeReport.summary.duplicate}`);
    }

    // Check database connection
    const dbHealthy = await healthCheck();
    if (!dbHealthy) {
      throw new Error('Database connection failed');
    }
    
    logger.info('Database connected successfully');

    // Initialize job scheduler
    JobScheduler.init();

    // Start listening
    app.listen(env.port, () => {
      logger.info(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🚀 Altuvera Backend Server Started                 ║
║                                                       ║
║   Environment: ${env.nodeEnv.padEnd(37)}║
║   Port: ${String(env.port).padEnd(44)}║
║   API Version: ${env.apiVersion.padEnd(38)}║
║   URL: http://localhost:${env.port.toString().padEnd(31)}║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app;
