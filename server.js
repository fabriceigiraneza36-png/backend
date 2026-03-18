/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 *       █████╗ ██╗  ████████╗██╗   ██╗██╗   ██╗███████╗██████╗  █████╗
 *      ██╔══██╗██║  ╚══██╔══╝██║   ██║██║   ██║██╔════╝██╔══██╗██╔══██╗
 *      ███████║██║     ██║   ██║   ██║██║   ██║█████╗  ██████╔╝███████║
 *      ██╔══██║██║     ██║   ██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██╔══██║
 *      ██║  ██║███████╗██║   ╚██████╔╝ ╚████╔╝ ███████╗██║  ██║██║  ██║
 *      ╚═╝  ╚═╝╚══════╝╚═╝    ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝
 *
 *      ALTUVERA TRAVEL - Enterprise Backend Server v6.0
 *
 *      "True Adventures In High Places & Deep Culture"
 *
 *      Features:
 *      ├── Advanced Error Handling & Self-Healing
 *      ├── Comprehensive Security Hardening
 *      ├── Real-time Health Monitoring
 *      ├── Automatic Database Reconnection
 *      ├── Memory & Performance Optimization
 *      ├── Request Validation & Sanitization
 *      ├── Graceful Shutdown Management
 *      └── Production-Ready Logging
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */

"use strict";

// Ensure proper initialization order
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");

// Import logger utility
const logger = require("./utils/logger");

// Import monitor utility for tracking
const monitor = require("./utils/monitor");

// Ensure schema migrations for missing columns
const { ensureDestinationsSchema } = require("./config/db");

// Require a module without crashing the process if it is missing.
// Used for optional modules/config that may not exist in all environments.
const safeRequire = (modulePath) => {
  try {
    return require(modulePath);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (err && err.code === "MODULE_NOT_FOUND") {
      logger.warn(`Optional module not found: ${modulePath}`, { error: msg });
      return null;
    }
    logger.error(`Failed to load module: ${modulePath}`, { error: msg });
    return null;
  }
};

// Initialize Express app
const app = express();

// Load configuration with validation
const env = (() => {
  try {
    const envModule = require("./config/env");
    const requiredVars = ["PORT", "NODE_ENV", "DATABASE_URL"];
    const missing = requiredVars.filter(
      (v) => !envModule[v] && !process.env[v],
    );
    if (missing.length > 0) {
      console.warn(
        `⚠️  Missing env vars: ${missing.join(", ")}. Using defaults.`,
      );
    }
    return {
      PORT: envModule.PORT || process.env.PORT || 3000,
      NODE_ENV: envModule.NODE_ENV || process.env.NODE_ENV || "development",
      CORS_ORIGINS: envModule.CORS_ORIGINS || process.env.CORS_ORIGINS || "*",
      DATABASE_URL: envModule.DATABASE_URL || process.env.DATABASE_URL,
      JWT_SECRET:
        envModule.JWT_SECRET ||
        process.env.JWT_SECRET ||
        crypto.randomBytes(32).toString("hex"),
      API_VERSION: envModule.API_VERSION || "v1",
      MAX_REQUEST_SIZE: envModule.MAX_REQUEST_SIZE || "10mb",
      RATE_LIMIT_WINDOW: envModule.RATE_LIMIT_WINDOW || 15 * 60 * 1000,
      RATE_LIMIT_MAX: envModule.RATE_LIMIT_MAX || 100,
      ENABLE_CLUSTERING: envModule.ENABLE_CLUSTERING || false,
      CLUSTER_WORKERS: envModule.CLUSTER_WORKERS || os.cpus().length,
      SSL_ENABLED: envModule.SSL_ENABLED || false,
      SSL_KEY_PATH: envModule.SSL_KEY_PATH,
      SSL_CERT_PATH: envModule.SSL_CERT_PATH,
      LOG_LEVEL: envModule.LOG_LEVEL || "info",
      ENABLE_SWAGGER: envModule.ENABLE_SWAGGER !== false,
      ...envModule,
    };
  } catch (err) {
    console.warn("⚠️  Config module not found. Using environment variables.");
    return {
      PORT: process.env.PORT || 3000,
      NODE_ENV: process.env.NODE_ENV || "development",
      CORS_ORIGINS: process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "*",
      DATABASE_URL: process.env.DATABASE_URL,
      JWT_SECRET:
        process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
      API_VERSION: "v1",
      MAX_REQUEST_SIZE: "10mb",
      RATE_LIMIT_WINDOW: 15 * 60 * 1000,
      RATE_LIMIT_MAX: 100,
      ENABLE_CLUSTERING: false,
      LOG_LEVEL: "info",
      ENABLE_SWAGGER: true,
    };
  }
})();

// Note: CORS, helmet, morgan, and compression are configured in ServerManager.setupMiddleware()
// Doing it here would cause conflicts. This app initialization is just for structure.

// Ensure consistent base URL usage
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${env.PORT}`;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Update DatabaseManager to log the base URL
class DatabaseManager {
  constructor() {
    this.sequelize = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.healthCheckInterval = null;
  }

  async initialize() {
    try {
      logger.info(`🌐 Backend URL: ${BACKEND_URL}`);
      logger.info(`🌐 Frontend URL: ${FRONTEND_URL}`);
      const dbModule = safeRequire("./config/database");

      if (dbModule && dbModule.sequelize) {
        this.sequelize = dbModule.sequelize;
      } else {
        // Create sequelize instance if not provided
        const { Sequelize } = require("sequelize");

        this.sequelize = new Sequelize(env.DATABASE_URL, {
          dialect: "postgres",
          logging:
            env.NODE_ENV === "development" ? (msg) => logger.debug(msg) : false,
          pool: {
            max: 50, // Increased max connections for high traffic
            min: 10,
            acquire: 60000,
            idle: 5000,
            evict: 1000,
          },
          dialectOptions: {
            ssl:
              env.NODE_ENV === "production"
                ? {
                    require: true,
                    rejectUnauthorized: false,
                  }
                : false,
            connectTimeout: 60000,
          },
          retry: {
            max: 3,
            timeout: 30000,
          },
        });
      }

      await this.connect();
      this.startHealthCheck();

      return this.sequelize;
    } catch (err) {
      logger.error("Database initialization failed", { error: err.message });
      throw err;
    }
  }

  async connect() {
    try {
      await this.sequelize.authenticate();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.info("✅ Database connection established successfully");
      return true;
    } catch (err) {
      this.isConnected = false;
      logger.error("❌ Database connection failed", { error: err.message });
      throw err;
    }
  }

  async reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(
        "❌ Max reconnection attempts reached. Manual intervention required.",
      );
      return false;
    }

    this.reconnectAttempts++;
    logger.warn(
      `🔄 Attempting database reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`,
    );

    try {
      await this.connect();
      return true;
    } catch (err) {
      logger.error(`Reconnection attempt ${this.reconnectAttempts} failed`, {
        error: err.message,
      });

      // Exponential backoff
      const delay = Math.min(
        this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
        60000,
      );

      setTimeout(() => this.reconnect(), delay);
      return false;
    }
  }

  startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.sequelize.query("SELECT 1");

        if (!this.isConnected) {
          this.isConnected = true;
          logger.info("✅ Database connection restored");
        }
      } catch (err) {
        if (this.isConnected) {
          this.isConnected = false;
          logger.error(
            "❌ Database connection lost. Initiating reconnection...",
          );
          this.reconnect();
        }
      }
    }, 30000); // Check every 30 seconds
  }

  async shutdown() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    if (this.sequelize) {
      await this.sequelize.close();
      logger.info("Database connection closed");
    }
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE LOADER WITH VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

class RouteLoader {
  constructor(app) {
    this.app = app;
    this.loadedRoutes = [];
    this.failedRoutes = [];
  }

  loadRoutes(routes) {
    logger.info(`📂 Loading ${routes.length} route modules...`);

    routes.forEach(({ path: routePath, file }) => {
      try {
        const imported = require(`./${file}`);
        const router =
          imported && typeof imported === "object"
            ? imported.default || imported.router || imported
            : imported;

        if (typeof router !== "function") {
          throw new Error(
            `Invalid router export in ${file} (expected Express router)`,
          );
        }

        // Wrap each router to provide:
        // - a safe index route for modules that don't implement GET "/"
        // - a consistent 405 for unsupported methods at the module root
        const mountRouter = express.Router();

        const hasRoute = (candidate, method, route) => {
          try {
            const stack =
              candidate && Array.isArray(candidate.stack) ? candidate.stack : [];
            const lowerMethod = String(method || "").toLowerCase();

            return stack.some((layer) => {
              if (!layer || !layer.route) return false;
              const samePath = layer.route.path === route;
              const supportsMethod =
                layer.route.methods && layer.route.methods[lowerMethod];
              return samePath && supportsMethod;
            });
          } catch {
            return false;
          }
        };

        if (!hasRoute(router, "get", "/")) {
          mountRouter.get("/", (req, res) => {
            res.json({
              status: "success",
              resource: `/api${routePath}`,
              message: "Route module is reachable. Use documented sub-routes.",
            });
          });
        }

        mountRouter.use(router);

        mountRouter.all("/", (req, res, next) => {
          next(
            AppError.methodNotAllowed(
              `Method ${req.method} not allowed on /api${routePath}`,
            ),
          );
        });

        this.app.use(`/api${routePath}`, mountRouter);
        this.loadedRoutes.push({ path: routePath, file, router });
        logger.debug(`  ✓ Loaded: /api${routePath}`);
      } catch (err) {
        this.failedRoutes.push({ path: routePath, file, error: err.message });
        logger.warn(`  ✗ Failed to load: /api${routePath} - ${err.message}`);
      }
    });

    logger.info(
      `📊 Routes loaded: ${this.loadedRoutes.length}/${routes.length}`,
    );

    if (this.failedRoutes.length > 0) {
      logger.warn(
        `⚠️  Failed routes: ${this.failedRoutes.map((r) => r.path).join(", ")}`,
      );
    }

    return {
      loaded: this.loadedRoutes,
      failed: this.failedRoutes,
    };
  }

  getStatus() {
    return {
      loaded: this.loadedRoutes.length,
      failed: this.failedRoutes.length,
      routes: this.loadedRoutes.map((r) => r.path),
      failures: this.failedRoutes,
    };
  }

  getDocs() {
    const normalizeLayerPath = (layer) => {
      if (!layer || !layer.regexp) return "";
      let raw = layer.regexp.source;

      // Convert express regexp to a readable route fragment (best effort)
      raw = raw
        .replace(/\\\//g, "/")
        .replace(
          new RegExp("\\(\\?:\\(\\[\\^\\\\/\\]\\+\\?\\)\\)", "g"),
          ":param",
        )
        .replace(
          new RegExp("\\(\\?:\\(\\[\\^\\\\/\\]\\+\\?\\)\\+\\)", "g"),
          ":param+",
        )
        .replace(/\^|\$|\(|\)|\?|\+|\[|\]|\\/g, "");

      if (!raw.startsWith("/")) raw = "/" + raw;
      if (raw.endsWith("/")) raw = raw.slice(0, -1);

      return raw;
    };

    const extractRoutes = (router, basePath = "") => {
      const routes = [];
      const stack = router && Array.isArray(router.stack) ? router.stack : [];

      stack.forEach((layer) => {
        if (!layer) return;

        if (layer.route) {
          const routePath = layer.route.path;
          const supportedMethods = Object.keys(layer.route.methods || {})
            .filter((m) => layer.route.methods[m])
            .map((m) => m.toUpperCase());

          supportedMethods.forEach((method) => {
            routes.push({
              method,
              path: `/api${basePath}${routePath === "/" ? "" : routePath}`,
            });
          });
        } else if (layer.name === "router" && layer.handle) {
          const nestedBase = `${basePath}${normalizeLayerPath(layer)}`;
          routes.push(...extractRoutes(layer.handle, nestedBase));
        }
      });

      return routes;
    };

    const docs = this.loadedRoutes.map(({ path, file, router }) => {
      return {
        path: `/api${path}`,
        file,
        methods: extractRoutes(router, path),
      };
    });

    return docs;
  }

  getReport() {
    return {
      generatedAt: new Date().toISOString(),
      loaded: this.loadedRoutes.map(({ path, file }) => ({
        path,
        mount: `/api${path}`,
        file,
      })),
      failed: [...this.failedRoutes].map((r) => ({
        ...r,
        mount: `/api${r.path}`,
      })),
      docs: this.getDocs(),
    };
  }
}

const renderTextTable = (rows, columns) => {
  const pad = (str, width) => {
    const s = String(str ?? "");
    if (s.length >= width) return s.slice(0, Math.max(0, width - 1)) + "…";
    return s + " ".repeat(width - s.length);
  };

  const widths = columns.map((c) => {
    const values = rows.map((r) => String(r[c.key] ?? ""));
    return Math.min(
      90,
      Math.max(c.label.length, ...values.map((v) => v.length)),
    );
  });

  const header = columns.map((c, i) => pad(c.label, widths[i])).join("  ");
  const line = columns.map((_, i) => "-".repeat(widths[i])).join("  ");
  const body = rows
    .map((r) => columns.map((c, i) => pad(r[c.key], widths[i])).join("  "))
    .join("\n");

  return [header, line, body].filter(Boolean).join("\n");
};

const formatRoutesReportTables = (report) => {
  const docs = Array.isArray(report?.docs) ? report.docs : [];
  const failed = Array.isArray(report?.failed) ? report.failed : [];

  const routeRows = [];
  docs.forEach((moduleDoc) => {
    const moduleMount = moduleDoc.path;
    const file = moduleDoc.file;
    const methods = Array.isArray(moduleDoc.methods) ? moduleDoc.methods : [];

    methods.forEach((m) => {
      routeRows.push({
        module: moduleMount,
        method: String(m.method || "").toUpperCase(),
        path: m.path,
        file,
      });
    });
  });

  routeRows.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );

  const moduleSummary = docs
    .map((d) => ({
      mount: d.path,
      status: "LIVE",
      routes: Array.isArray(d.methods) ? d.methods.length : 0,
      file: d.file,
    }))
    .concat(
      failed.map((f) => ({
        mount: f.mount || `/api${f.path}`,
        status: "FAILED",
        routes: 0,
        file: f.file,
        error: f.error,
      })),
    )
    .sort((a, b) => a.mount.localeCompare(b.mount));

  const routesTable = renderTextTable(routeRows, [
    { key: "method", label: "METHOD" },
    { key: "path", label: "PATH" },
    { key: "module", label: "PARENT" },
  ]);

  const modulesTable = renderTextTable(moduleSummary, [
    { key: "mount", label: "MOUNT" },
    { key: "status", label: "STATUS" },
    { key: "routes", label: "ROUTES" },
    { key: "file", label: "FILE" },
    ...(failed.length ? [{ key: "error", label: "ERROR" }] : []),
  ]);

  return { routesTable, modulesTable, counts: { routes: routeRows.length, live: docs.length, failed: failed.length } };
};

// ═══════════════════════════════════════════════════════════════════════════════
// APP ERROR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class AppError extends Error {
  constructor(message, statusCode, errorCode = null) {
    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.errorCode = errorCode;
    this.isOperational = true;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, errorCode) {
    return new AppError(message, 400, errorCode);
  }

  static unauthorized(message = "Unauthorized access") {
    return new AppError(message, 401, "UNAUTHORIZED");
  }

  static forbidden(message = "Access forbidden") {
    return new AppError(message, 403, "FORBIDDEN");
  }

  static notFound(resource = "Resource") {
    return new AppError(`${resource} not found`, 404, "NOT_FOUND");
  }

  static conflict(message) {
    return new AppError(message, 409, "CONFLICT");
  }

  static tooManyRequests(message = "Too many requests") {
    return new AppError(message, 429, "RATE_LIMITED");
  }

  static methodNotAllowed(message = "Method not allowed") {
    return new AppError(message, 405, "METHOD_NOT_ALLOWED");
  }

  static internal(message = "Internal server error") {
    return new AppError(message, 500, "INTERNAL_ERROR");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Security Headers Middleware
 */
const securityMiddleware = (req, res, next) => {
  // Remove powered-by header
  res.removeHeader("X-Powered-By");

  // Additional security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=()",
  );

  // Request ID for tracing
  req.requestId = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("X-Request-ID", req.requestId);

  next();
};

/**
 * Request Sanitization Middleware
 */
const sanitizationMiddleware = (req, res, next) => {
  // Sanitize common attack vectors
  const sanitize = (obj) => {
    if (typeof obj !== "object" || obj === null) return obj;

    const sanitized = Array.isArray(obj) ? [] : {};

    for (const key of Object.keys(obj)) {
      // Block prototype pollution
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }

      let value = obj[key];

      // Recursively sanitize nested objects
      if (typeof value === "object" && value !== null) {
        value = sanitize(value);
      }

      // Basic XSS prevention for strings
      if (typeof value === "string") {
        value = value.replace(
          /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
          "",
        );
      }

      sanitized[key] = value;
    }

    return sanitized;
  };

  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  if (req.params) req.params = sanitize(req.params);

  next();
};

/**
 * Rate Limiter Implementation
 */
const createRateLimiter = (options = {}) => {
  const {
    windowMs = env.RATE_LIMIT_WINDOW,
    max = env.RATE_LIMIT_MAX,
    message = "Too many requests, please try again later",
    keyGenerator = (req) => req.ip,
    skip = () => false,
  } = options;

  const requests = new Map();

  // Cleanup old entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of requests) {
      if (now - data.startTime > windowMs) {
        requests.delete(key);
      }
    }
  }, windowMs);

  return (req, res, next) => {
    if (skip(req)) return next();

    const key = keyGenerator(req);
    const now = Date.now();

    let requestData = requests.get(key);

    if (!requestData || now - requestData.startTime > windowMs) {
      requestData = { count: 0, startTime: now };
    }

    requestData.count++;
    requests.set(key, requestData);

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader(
      "X-RateLimit-Remaining",
      Math.max(0, max - requestData.count),
    );
    res.setHeader(
      "X-RateLimit-Reset",
      new Date(requestData.startTime + windowMs).toISOString(),
    );

    if (requestData.count > max) {
      logger.warn(`Rate limit exceeded for ${key}`);
      return next(AppError.tooManyRequests(message));
    }

    next();
  };
};

/**
 * Request Timeout Middleware
 */
const timeoutMiddleware = (timeout = 30000) => {
  return (req, res, next) => {
    req.setTimeout(timeout, () => {
      if (!res.headersSent) {
        next(new AppError("Request timeout", 408, "TIMEOUT"));
      }
    });
    next();
  };
};

/**
 * Response Time Tracking Middleware
 */
const responseTimeMiddleware = (req, res, next) => {
  const startTime = process.hrtime.bigint();

  // Wrap res.end so we can set headers before the response is sent
  const originalEnd = res.end;
  res.end = function (...args) {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e6; // Convert to milliseconds

    try {
      if (!res.headersSent) {
        res.setHeader("X-Response-Time", `${duration.toFixed(2)}ms`);
      }
    } catch (e) {
      // Headers may already be sent in some edge cases
    }

    return originalEnd.apply(this, args);
  };

  res.on("finish", () => {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e6;

    // Log slow requests
    if (duration > 5000) {
      logger.warn(
        `Slow request detected: ${req.method} ${req.path} took ${duration.toFixed(2)}ms`,
      );
    }
  });

  next();
};

/**
 * Error Handling Middleware
 */
const errorMiddleware = (err, req, res, next) => {
  // Prevent setting headers if already sent
  if (res.headersSent) {
    logger.error("Error after headers sent:", { error: err.message });
    return next(err);
  }

  // Set defaults
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  // Log error
  monitor.recordError(err);

  if (env.NODE_ENV === "development") {
    logger.error(`${err.statusCode} - ${err.message}`, {
      path: req.path,
      method: req.method,
      stack: err.stack,
    });
  } else {
    logger.error(`${err.statusCode} - ${err.message}`, {
      path: req.path,
      method: req.method,
      requestId: req.requestId,
    });
  }

  // Handle specific error types
  let error = { ...err, message: err.message };

  // Sequelize validation error
  if (
    err.name === "SequelizeValidationError" ||
    err.name === "SequelizeUniqueConstraintError"
  ) {
    const messages =
      err.errors?.map((e) => e.message).join(", ") || err.message;
    error = new AppError(messages, 400, "VALIDATION_ERROR");
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    error = new AppError(
      "Invalid token. Please log in again.",
      401,
      "INVALID_TOKEN",
    );
  }

  if (err.name === "TokenExpiredError") {
    error = new AppError(
      "Your token has expired. Please log in again.",
      401,
      "TOKEN_EXPIRED",
    );
  }

  // Multer errors
  if (err.name === "MulterError") {
    error = new AppError(
      `File upload error: ${err.message}`,
      400,
      "UPLOAD_ERROR",
    );
  }

  // Syntax error in JSON
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    error = new AppError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  // Send response
  const response = {
    status: error.status,
    message: error.message,
    errorCode: error.errorCode,
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
  };

  // Include stack trace in development
  if (env.NODE_ENV === "development") {
    response.stack = err.stack;
    response.originalError = err.message;
  }

  // Include validation details if available
  if (err.errors) {
    response.errors = err.errors;
  }

  res.status(error.statusCode).json(response);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORS CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = env.CORS_ORIGINS.split(",").map((o) => o.trim());

    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    // Allow all in development
    if (env.NODE_ENV === "development") return callback(null, true);

    // Check if origin is allowed
    if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new AppError("Not allowed by CORS", 403, "CORS_ERROR"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-Request-ID",
    "Accept",
    "Origin",
  ],
  exposedHeaders: [
    "X-Request-ID",
    "X-Response-Time",
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
  ],
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

// ═══════════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

class GracefulShutdown {
  constructor(server, dbManager) {
    this.server = server;
    this.dbManager = dbManager;
    this.isShuttingDown = false;
    this.shutdownTimeout = 30000;

    this.setupHandlers();
  }

  setupHandlers() {
    // Handle various shutdown signals
    const signals = ["SIGTERM", "SIGINT", "SIGUSR2"];

    signals.forEach((signal) => {
      process.on(signal, () => this.shutdown(signal));
    });

    // Handle PM2 graceful reload
    process.on("message", (msg) => {
      if (msg === "shutdown") {
        this.shutdown("PM2_SHUTDOWN");
      }
    });
  }

  async shutdown(signal) {
    if (this.isShuttingDown) {
      logger.warn("Shutdown already in progress...");
      return;
    }

    this.isShuttingDown = true;
    logger.info(`\n🛑 ${signal} received. Starting graceful shutdown...`);

    // Set timeout for forced shutdown
    const forceShutdownTimeout = setTimeout(() => {
      logger.error("Forced shutdown due to timeout");
      process.exit(1);
    }, this.shutdownTimeout);

    try {
      // Stop accepting new connections
      logger.info("Stopping new connections...");
      this.server.close((err) => {
        if (err) {
          logger.error("Error closing server", { error: err.message });
        } else {
          logger.info("Server closed successfully");
        }
      });

      // Close database connection
      logger.info("Closing database connection...");
      await this.dbManager.shutdown();

      // Clear the timeout
      clearTimeout(forceShutdownTimeout);

      // Final cleanup
      logger.info("✅ Graceful shutdown completed");
      process.exit(0);
    } catch (err) {
      logger.error("Error during shutdown", { error: err.message });
      clearTimeout(forceShutdownTimeout);
      process.exit(1);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE DEFINITIONS (Auto-discovered + curated)
// ═══════════════════════════════════════════════════════════════════════════════

const getRouteFiles = () => {
  const routesDir = path.join(__dirname, "routes");
  try {
    const files = fs.readdirSync(routesDir);
    return files.filter((f) => f.endsWith(".js"));
  } catch (err) {
    logger.warn("Unable to read routes directory:", err.message);
    return [];
  }
};

const normalizeRoutePath = (fileName) => {
  const base = fileName.replace(/\.js$/, "");
  return (
    "/" +
    base
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/[_\s]+/g, "-")
      .toLowerCase()
  );
};

const curatedRouteDefinitions = [
  { path: "/admin/auth", file: "routes/adminAuth" },
  { path: "/users", file: "routes/users" },
  { path: "/countries", file: "routes/countries" },
  { path: "/destinations", file: "routes/destinations" },
  { path: "/posts", file: "routes/posts" },
  { path: "/tips", file: "routes/tips" },
  { path: "/services", file: "routes/services" },
  { path: "/team", file: "routes/team" },
  { path: "/gallery", file: "routes/gallery" },
  { path: "/bookings", file: "routes/bookings" },
  { path: "/faqs", file: "routes/faqs" },
  { path: "/contact", file: "routes/contact" },
  { path: "/message", file: "routes/message" },
  { path: "/pages", file: "routes/pages" },
  { path: "/virtual-tours", file: "routes/virtualTours" },
  { path: "/subscribers", file: "routes/subscribers" },
  { path: "/settings", file: "routes/settings" },
  { path: "/uploads", file: "routes/uploads" },
  // { path: "/reviews", file: "routes/reviews" },
  // { path: "/testimonials", file: "routes/testimonials" },
  // { path: "/newsletters", file: "routes/newsletters" },
];

const routeDefinitions = (() => {
  const existingFiles = new Set(
    curatedRouteDefinitions.map((r) => r.file.replace(/^routes\//, "") + ".js"),
  );

  const discovered = getRouteFiles()
    .filter((file) => !existingFiles.has(file))
    .map((file) => ({
      path: normalizeRoutePath(file),
      file: `routes/${file.replace(/\.js$/, "")}`,
    }));

  if (discovered.length > 0) {
    logger.info(
      `🔍 Auto-discovered ${discovered.length} new route(s): ${discovered
        .map((r) => r.path)
        .join(", ")}`,
    );
  }

  return [...curatedRouteDefinitions, ...discovered];
})();

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SERVER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class AltuveraServer {
  constructor() {
    this.app = express();
    this.server = null;
    this.dbManager = new DatabaseManager();
    this.routeLoader = null;
    this.isReady = false;
  }

  async initialize() {
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info("🌍 ALTUVERA TRAVEL - Enterprise Backend Server v6.0");
    logger.info('   "True Adventures In High Places & Deep Culture"');
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info(`Environment: ${env.NODE_ENV}`);
    logger.info(`Port: ${env.PORT}`);
    logger.info(
      "═══════════════════════════════════════════════════════════\n",
    );

    try {
      // Initialize database
      await this.dbManager.initialize();

      // Apply any missing schema changes (non-destructive)
      await ensureDestinationsSchema();

      // Setup Express app
      this.setupMiddleware();
      this.setupRoutes();
      this.setupErrorHandling();

      // Start server
      await this.startServer();

      // Setup graceful shutdown
      new GracefulShutdown(this.server, this.dbManager);

      // Start memory monitoring
      this.startMemoryMonitoring();

      this.isReady = true;

      logger.info(
        "\n═══════════════════════════════════════════════════════════",
      );
      logger.info("🚀 Server is ready to accept connections");
      logger.info(
        "═══════════════════════════════════════════════════════════\n",
      );

      return this;
    } catch (err) {
      logger.error("💥 Failed to initialize server", { error: err.message });
      throw err;
    }
  }

  setupMiddleware() {
    logger.info("⚙️  Setting up middleware...");

    // Trust proxy (for reverse proxies like nginx)
    this.app.set("trust proxy", 1);
    this.app.set("x-powered-by", false);

    // Security middleware
    this.app.use(securityMiddleware);
    this.app.use(
      helmet({
        contentSecurityPolicy: env.NODE_ENV === "production",
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" },
      }),
    );

    // CORS
    this.app.use(cors(corsOptions));
    this.app.options("*", cors(corsOptions));

    // Request parsing
    this.app.use(
      express.json({
        limit: env.MAX_REQUEST_SIZE,
        strict: true,
      }),
    );
    this.app.use(
      express.urlencoded({
        extended: true,
        limit: env.MAX_REQUEST_SIZE,
      }),
    );

    // Sanitization
    this.app.use(sanitizationMiddleware);

    // Compression
    this.app.use(
      compression({
        level: 6,
        threshold: 1024,
        filter: (req, res) => {
          if (req.headers["x-no-compression"]) return false;
          return compression.filter(req, res);
        },
      }),
    );

    // Logging
    const morganFormat =
      env.NODE_ENV === "development"
        ? "dev"
        : ":remote-addr - :method :url :status :response-time ms";

    this.app.use(
      morgan(morganFormat, {
        stream: { write: (msg) => logger.http(msg.trim()) },
        skip: (req) => req.url === "/api/health",
      }),
    );

    // Response time tracking
    this.app.use(responseTimeMiddleware);

    // Request timeout
    this.app.use(timeoutMiddleware(30000));

    // Monitoring middleware
    this.app.use((req, res, next) => {
      req.startTime = Date.now();

      res.on("finish", () => {
        const duration = Date.now() - req.startTime;
        monitor.recordResponse(req, res, duration);
      });

      monitor.recordRequest(req);
      next();
    });

    // Rate limiting for API routes
    this.app.use(
      "/api",
      createRateLimiter({
        windowMs: env.RATE_LIMIT_WINDOW,
        max: env.RATE_LIMIT_MAX,
        skip: (req) => req.path === "/health",
      }),
    );

    // Static files
    const uploadsPath = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadsPath)) {
      fs.mkdirSync(uploadsPath, { recursive: true });
    }
    this.app.use(
      "/uploads",
      express.static(uploadsPath, {
        maxAge: "1d",
        etag: true,
        lastModified: true,
      }),
    );

    logger.info("✅ Middleware configured successfully");
  }

  setupRoutes() {
    logger.info("📂 Setting up routes...");

    // Route loader
    this.routeLoader = new RouteLoader(this.app);
    this.routeLoader.loadRoutes(routeDefinitions);

    // Pretty routes report (dev-friendly)
    const shouldPrintRoutes =
      env.NODE_ENV === "development" || process.env.ROUTES_REPORT === "true";
    if (shouldPrintRoutes) {
      try {
        const report = this.routeLoader.getReport();
        const { routesTable, modulesTable, counts } =
          formatRoutesReportTables(report);

        logger.info(
          `\nâ•â•â•â•â•â•â•â• ROUTES OVERVIEW â•â•â•â•â•â•â•â•\n` +
            `${modulesTable}\n` +
            `\nâ•â•â•â•â•â•â•â• ROUTES (METHODS) â•â•â•â•â•â•â•â•\n` +
            `${routesTable}\n` +
            `\nSummary: ${counts.routes} routes â€¢ ${counts.live} live modules â€¢ ${counts.failed} failed modules\n`,
        );
      } catch (e) {
        logger.warn("Failed to render routes report:", e.message);
      }
    }

    // Backwards-compat: `/api/auth/*` now lives under `/api/users/*`.
    this.app.use("/api/auth", (req, res) => {
      const target = `/api/users${req.url || ""}`;
      return res.redirect(307, target);
    });

    // Health check endpoint
    this.app.get("/api/health", (req, res) => {
      const health = monitor.getHealthStatus();
      health.database = this.dbManager.getStatus();
      health.routes = this.routeLoader.getStatus();

      const statusCode = health.database.isConnected ? 200 : 503;
      res.status(statusCode).json(health);
    });

    // Real-time tracking endpoint
    const realTimeTracker = require("./utils/realTimeTracker");
    
    this.app.get("/api/tracking/stats", (req, res) => {
      if (env.NODE_ENV === "production" && !req.headers["x-admin-key"]) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(realTimeTracker.getStats());
    });

    this.app.get("/api/tracking/uploads", (req, res) => {
      if (env.NODE_ENV === "production" && !req.headers["x-admin-key"]) {
        return res.status(403).json({ error: "Access denied" });
      }
      const limit = parseInt(req.query.limit, 10) || 10;
      res.json(realTimeTracker.getRecentUploads(limit));
    });

    this.app.get("/api/tracking/events", (req, res) => {
      if (env.NODE_ENV === "production" && !req.headers["x-admin-key"]) {
        return res.status(403).json({ error: "Access denied" });
      }
      const limit = parseInt(req.query.limit, 10) || 20;
      res.json(realTimeTracker.getRecentEvents(limit));
    });

    this.app.get("/api/tracking/api-calls", (req, res) => {
      if (env.NODE_ENV === "production" && !req.headers["x-admin-key"]) {
        return res.status(403).json({ error: "Access denied" });
      }
      const limit = parseInt(req.query.limit, 10) || 10;
      res.json(realTimeTracker.getRecentAPICalls(limit));
    });

    // Detailed stats endpoint (protected)
    this.app.get("/api/stats", (req, res) => {
      // In production, you'd want to protect this endpoint
      if (env.NODE_ENV === "production" && !req.headers["x-admin-key"]) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(monitor.getDetailedStats());
    });

    // Root endpoint
    this.app.get("/", (req, res) => {
      res.json({
        name: "Altuvera Travel API",
        version: env.API_VERSION,
        status: "operational",
        documentation: "/api/docs",
        health: "/api/health",
      });
    });

    // API info endpoint
    this.app.get("/api", (req, res) => {
      res.json({
        name: "Altuvera Travel API",
        version: env.API_VERSION,
        description: "True Adventures In High Places & Deep Culture",
        endpoints: this.routeLoader.loadedRoutes.map((r) => `/api${r.path}`),
        documentation: "/api/docs",
      });
    });

    // API documentation endpoint (auto-generated)
    this.app.get("/api/docs", (req, res) => {
      res.json({
        name: "Altuvera Travel API",
        version: env.API_VERSION,
        generatedAt: new Date().toISOString(),
        routes: this.routeLoader.getDocs(),
      });
    });

    // API routes report endpoint (includes failed modules)
    this.app.get("/api/routes", (req, res) => {
      res.json(this.routeLoader.getReport());
    });

    // 404 handler - must be after all routes
    this.app.all("*", (req, res, next) => {
      next(AppError.notFound(`Route ${req.originalUrl}`));
    });

    logger.info("✅ Routes configured successfully");
  }

  setupErrorHandling() {
    logger.info("🛡️  Setting up error handling...");
    this.app.use(errorMiddleware);
    logger.info("✅ Error handling configured successfully");
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      try {
        // Create HTTP or HTTPS server
        if (env.SSL_ENABLED && env.SSL_KEY_PATH && env.SSL_CERT_PATH) {
          const sslOptions = {
            key: fs.readFileSync(env.SSL_KEY_PATH),
            cert: fs.readFileSync(env.SSL_CERT_PATH),
          };
          this.server = https.createServer(sslOptions, this.app);
          logger.info("🔒 SSL enabled");
        } else {
          this.server = http.createServer(this.app);
        }

        // Configure server
        this.server.keepAliveTimeout = 65000;
        this.server.headersTimeout = 66000;
        this.server.maxHeadersCount = 100;

        const basePort = Number(env.PORT) || 3000;
        const maxAttempts =
          env.NODE_ENV === "development"
            ? Math.max(1, Number(process.env.PORT_FALLBACK_ATTEMPTS) || 10)
            : 1;

        const tryListen = (port, attempt = 0) => {
          this.server.listen(port, "0.0.0.0", () => {
            logger.info(
              `\n🚀 Server running on port ${port} in ${env.NODE_ENV} mode`,
            );
            resolve(this.server);
          });

          this.server.once("error", (err) => {
            if (
              err &&
              err.code === "EADDRINUSE" &&
              env.NODE_ENV === "development" &&
              attempt + 1 < maxAttempts
            ) {
              const nextPort = port + 1;
              logger.warn(
                `Port ${port} is in use; retrying on ${nextPort} (${attempt + 2}/${maxAttempts})`,
              );
              setTimeout(() => tryListen(nextPort, attempt + 1), 250);
              return;
            }

            if (err.code === "EADDRINUSE") {
              logger.error(`Port ${port} is already in use`);
            } else if (err.code === "EACCES") {
              logger.error(`Port ${port} requires elevated privileges`);
            } else {
              logger.error("Server error", { error: err.message });
            }
            reject(err);
          });
        };

        // Start listening (with dev fallback to next ports)
        tryListen(basePort, 0);

        // Handle connection errors
        this.server.on("clientError", (err, socket) => {
          if (err.code === "ECONNRESET" || !socket.writable) return;
          socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        });
      } catch (err) {
        logger.error("Failed to start server", { error: err.message });
        reject(err);
      }
    });
  }

  startMemoryMonitoring() {
    // Update memory stats periodically
    setInterval(() => {
      monitor.updateMemory();

      // Check for memory leaks
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

      if (heapUsedMB > 500) {
        logger.warn(`High memory usage: ${heapUsedMB.toFixed(2)} MB`);
      }

      // Force garbage collection if available (requires --expose-gc flag)
      if (global.gc && heapUsedMB > 400) {
        logger.info("Running garbage collection...");
        global.gc();
      }
    }, 60000); // Every minute
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLUSTER MODE (Optional)
// ═══════════════════════════════════════════════════════════════════════════════

const startWithCluster = async () => {
  if (cluster.isMaster) {
    const numWorkers = env.CLUSTER_WORKERS;

    logger.info(`🔧 Master process ${process.pid} is running`);
    logger.info(`🔧 Starting ${numWorkers} workers...`);

    // Fork workers
    for (let i = 0; i < numWorkers; i++) {
      cluster.fork();
    }

    // Handle worker exit
    cluster.on("exit", (worker, code, signal) => {
      logger.warn(
        `Worker ${worker.process.pid} died (${signal || code}). Restarting...`,
      );
      cluster.fork();
    });

    // Handle worker messages
    cluster.on("message", (worker, message) => {
      logger.debug(`Message from worker ${worker.id}:`, message);
    });
  } else {
    // Workers run the server
    const server = new AltuveraServer();
    await server.initialize();
    logger.info(`🔧 Worker ${process.pid} started`);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

const main = async () => {
  try {
    if (env.ENABLE_CLUSTERING && env.NODE_ENV === "production") {
      await startWithCluster();
    } else {
      const server = new AltuveraServer();
      await server.initialize();
    }
  } catch (err) {
    logger.error("💥 Fatal error during startup", {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
};

// Start the server (only when run directly, not when imported for tests/scripts)
if (require.main === module) {
  main();
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS (for testing)
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  AltuveraServer,
  AppError,
  DatabaseManager,
  RouteLoader,
  createRateLimiter,
};
