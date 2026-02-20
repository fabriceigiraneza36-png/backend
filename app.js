// src/app.js
require('express-async-errors');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const xss = require('xss-clean');
const hpp = require('hpp');
const responseTime = require('response-time');
const { createTerminus } = require('@godaddy/terminus');
const http = require('http');

const env = require('./config/env');
const logger = require('./utils/logger');
const corsMiddleware = require('./middleware/cors.middleware');
const requestLogger = require('./middleware/logger.middleware');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler.middleware');
const { apiLimiter } = require('./middleware/rateLimiter.middleware');
const routes = require('./routes');
const { healthCheck, pool } = require('./database/pool');
const JobScheduler = require('./jobs');
const MetricsCollector = require('./utils/metrics');
const CircuitBreaker = require('./utils/circuitBreaker');

class ApplicationServer {
  constructor() {
    this.app = express();
    this.server = null;
    this.isShuttingDown = false;
    this.activeConnections = new Set();
    this.metricsCollector = new MetricsCollector();
    this.circuitBreaker = new CircuitBreaker();
    this.startTime = Date.now();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandlers();
  }

  setupMiddleware() {
    const { app } = this;

    // Trust proxy - essential for load balancers
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

    // Disable x-powered-by header
    app.disable('x-powered-by');

    // Enhanced security headers
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      referrerPolicy: { policy: 'same-origin' },
    }));

    // XSS and injection protection
    app.use(xss());
    app.use(hpp({
      whitelist: ['sort', 'filter', 'page', 'limit'] // Allow these params to have multiple values
    }));

    // CORS with fallback
    app.use(corsMiddleware);

    // Response time tracking
    app.use(responseTime((req, res, time) => {
      this.metricsCollector.recordResponseTime(req.method, req.path, time);
      res.setHeader('X-Response-Time', `${time.toFixed(2)}ms`);
    }));

    // Body parsing with error handling
    app.use(express.json({
      limit: '10mb',
      verify: (req, res, buf, encoding) => {
        try {
          JSON.parse(buf);
        } catch (e) {
          logger.warn('Invalid JSON received', { 
            ip: req.ip, 
            path: req.path,
            error: e.message 
          });
          throw new Error('Invalid JSON');
        }
      }
    }));

    app.use(express.urlencoded({ 
      extended: true, 
      limit: '10mb',
      parameterLimit: 10000 
    }));

    app.use(cookieParser(env.cookieSecret));

    // Compression with custom filter
    app.use(compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
      level: 6,
      threshold: 1024,
    }));

    // Request logging with correlation ID
    app.use((req, res, next) => {
      req.id = req.headers['x-request-id'] || 
               req.headers['x-correlation-id'] || 
               `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      res.setHeader('X-Request-ID', req.id);
      next();
    });

    app.use(requestLogger);

    // Track active connections
    app.use((req, res, next) => {
      const connectionId = Symbol('connection');
      this.activeConnections.add(connectionId);
      
      res.on('finish', () => {
        this.activeConnections.delete(connectionId);
      });
      
      next();
    });

    // Shutdown middleware
    app.use((req, res, next) => {
      if (this.isShuttingDown) {
        res.setHeader('Connection', 'close');
        return res.status(503).json({
          success: false,
          error: {
            message: 'Server is shutting down',
            code: 'SERVER_SHUTDOWN',
          }
        });
      }
      next();
    });

    // Rate limiting with custom key generator
    app.use('/api', apiLimiter);

    // Health check endpoint (before routes, no rate limiting)
    app.get('/health', this.healthCheckHandler.bind(this));
    app.get('/metrics', this.metricsHandler.bind(this));
    app.get('/ready', this.readinessHandler.bind(this));
  }

  setupRoutes() {
    // API routes with versioning
    this.app.use(`/api/${env.apiVersion}`, routes);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        success: true,
        data: {
          service: 'Altuvera Backend API',
          version: env.apiVersion,
          environment: env.nodeEnv,
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        }
      });
    });
  }

  setupErrorHandlers() {
    // 404 handler
    this.app.use(notFoundHandler);

    // Global error handler with fallback
    this.app.use(errorHandler);

    // Catch-all error handler (last resort)
    this.app.use((err, req, res, next) => {
      logger.error('Unhandled error in final handler', { 
        error: err,
        requestId: req.id,
        path: req.path,
        method: req.method,
      });

      if (res.headersSent) {
        return next(err);
      }

      res.status(500).json({
        success: false,
        error: {
          message: 'An unexpected error occurred',
          code: 'INTERNAL_SERVER_ERROR',
          requestId: req.id,
        }
      });
    });
  }

  async healthCheckHandler(req, res) {
    try {
      const dbHealthy = await healthCheck();
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();

      const health = {
        status: dbHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: `${Math.floor(uptime)}s`,
        checks: {
          database: dbHealthy ? 'ok' : 'failing',
          memory: memoryUsage.heapUsed < memoryUsage.heapTotal * 0.9 ? 'ok' : 'warning',
        },
        memory: {
          heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
          external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
        },
        activeConnections: this.activeConnections.size,
      };

      res.status(dbHealthy ? 200 : 503).json(health);
    } catch (error) {
      logger.error('Health check failed', { error });
      res.status(503).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async metricsHandler(req, res) {
    try {
      const metrics = await this.metricsCollector.getMetrics();
      res.json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      logger.error('Failed to retrieve metrics', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve metrics',
      });
    }
  }

  async readinessHandler(req, res) {
    try {
      const isReady = !this.isShuttingDown && await healthCheck();
      
      if (isReady) {
        res.status(200).json({ status: 'ready' });
      } else {
        res.status(503).json({ status: 'not ready' });
      }
    } catch (error) {
      res.status(503).json({ status: 'not ready', error: error.message });
    }
  }

  async gracefulShutdown(signal) {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    logger.info(`${signal} received, initiating graceful shutdown...`);

    const shutdownTimeout = setTimeout(() => {
      logger.error('Forced shutdown due to timeout');
      process.exit(1);
    }, 30000); // 30 second timeout

    try {
      // Stop accepting new requests
      logger.info('Stopping server from accepting new connections...');
      await new Promise((resolve) => {
        this.server.close(resolve);
      });

      // Wait for active connections to complete
      const maxWait = 20000; // 20 seconds
      const startWait = Date.now();
      
      while (this.activeConnections.size > 0 && (Date.now() - startWait) < maxWait) {
        logger.info(`Waiting for ${this.activeConnections.size} active connections to complete...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (this.activeConnections.size > 0) {
        logger.warn(`Forcing shutdown with ${this.activeConnections.size} active connections`);
      }

      // Stop job scheduler
      logger.info('Stopping job scheduler...');
      await JobScheduler.stop();

      // Shutdown analytics service
      logger.info('Shutting down analytics service...');
      const AnalyticsService = require('./services/analytics.service');
      await AnalyticsService.shutdown();

      // Close database connections
      logger.info('Closing database connections...');
      await pool.end();

      // Flush logs
      logger.info('Flushing logs...');
      await new Promise(resolve => {
        logger.on('finish', resolve);
        logger.end();
      });

      clearTimeout(shutdownTimeout);
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown', { error });
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  }

  setupProcessHandlers() {
    // Graceful shutdown handlers
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));

    // Uncaught exception handler
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', { 
        error,
        stack: error.stack,
      });
      
      // Give logger time to write
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    // Unhandled rejection handler
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection', { 
        reason,
        promise,
      });
    });

    // Warning handler
    process.on('warning', (warning) => {
      logger.warn('Process Warning', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack,
      });
    });

    // Memory monitoring
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      if (heapUsedPercent > 90) {
        logger.warn('High memory usage detected', {
          heapUsedPercent: heapUsedPercent.toFixed(2),
          heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        });
      }

      this.metricsCollector.recordMemoryUsage(memUsage);
    }, 60000); // Check every minute
  }

  async start() {
    try {
      // Validate environment configuration
      if (!env.isValid()) {
        throw new Error('Invalid environment configuration');
      }

      // Check database connection with retry logic
      let dbHealthy = false;
      let retries = 5;
      
      while (!dbHealthy && retries > 0) {
        dbHealthy = await healthCheck();
        
        if (!dbHealthy) {
          retries--;
          logger.warn(`Database health check failed, ${retries} retries remaining...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      if (!dbHealthy) {
        throw new Error('Database connection failed after multiple retries');
      }

      logger.info('✓ Database connected successfully');

      // Initialize job scheduler
      await JobScheduler.init();
      logger.info('✓ Job scheduler initialized');

      // Initialize metrics collector
      await this.metricsCollector.init();
      logger.info('✓ Metrics collector initialized');

      // Create HTTP server
      this.server = http.createServer(this.app);

      // Setup server timeout
      this.server.timeout = 30000; // 30 seconds
      this.server.keepAliveTimeout = 65000; // 65 seconds
      this.server.headersTimeout = 66000; // 66 seconds

      // Setup terminus for graceful shutdown
      createTerminus(this.server, {
        timeout: 25000,
        signals: ['SIGTERM', 'SIGINT'],
        healthChecks: {
          '/health': async () => {
            const healthy = await healthCheck();
            if (!healthy) {
              throw new Error('Database unhealthy');
            }
          },
        },
        onSignal: async () => {
          logger.info('Server is starting cleanup');
          await this.gracefulShutdown('TERMINUS');
        },
        onShutdown: async () => {
          logger.info('Cleanup finished, server is shutting down');
        },
        logger: (msg, err) => logger.error(msg, { error: err }),
      });

      // Setup process handlers
      this.setupProcessHandlers();

      // Start listening
      await new Promise((resolve, reject) => {
        this.server.listen(env.port, env.host || '0.0.0.0', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Success banner
      this.printStartupBanner();

      // Send startup metrics
      this.metricsCollector.recordServerStart();

    } catch (error) {
      logger.error('Failed to start server', { 
        error: error.message,
        stack: error.stack,
      });
      process.exit(1);
    }
  }

  printStartupBanner() {
    const uptimeMs = Date.now() - this.startTime;
    
    logger.info(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 Altuvera Backend Server - PRODUCTION READY              ║
║                                                               ║
║   Environment:    ${env.nodeEnv.padEnd(44)}║
║   Port:           ${String(env.port).padEnd(44)}║
║   Host:           ${(env.host || '0.0.0.0').padEnd(44)}║
║   API Version:    ${env.apiVersion.padEnd(44)}║
║   Process ID:     ${String(process.pid).padEnd(44)}║
║   Node Version:   ${process.version.padEnd(44)}║
║   Startup Time:   ${uptimeMs}ms${' '.repeat(44 - String(uptimeMs).length - 2)}║
║                                                               ║
║   Endpoints:                                                  ║
║   • API:          http://localhost:${env.port}/api/${env.apiVersion.padEnd(24)}║
║   • Health:       http://localhost:${env.port}/health${' '.repeat(29)}║
║   • Metrics:      http://localhost:${env.port}/metrics${' '.repeat(28)}║
║   • Ready:        http://localhost:${env.port}/ready${' '.repeat(30)}║
║                                                               ║
║   Features Enabled:                                           ║
║   ✓ Rate Limiting      ✓ CORS         ✓ Compression          ║
║   ✓ Security Headers   ✓ Logging      ✓ Metrics              ║
║   ✓ Circuit Breaker    ✓ Health Check ✓ Graceful Shutdown    ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `);
  }
}

// Create and start server
const server = new ApplicationServer();
server.start();

module.exports = server.app;