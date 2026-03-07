/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *    █████╗ ██╗  ████████╗██╗   ██╗██╗   ██╗███████╗██████╗  █████╗
 *   ██╔══██╗██║  ╚══██╔══╝██║   ██║██║   ██║██╔════╝██╔══██╗██╔══██╗
 *   ███████║██║     ██║   ██║   ██║██║   ██║█████╗  ██████╔╝███████║
 *   ██╔══██║██║     ██║   ██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██╔══██║
 *   ██║  ██║███████╗██║   ╚██████╔╝ ╚████╔╝ ███████╗██║  ██║██║  ██║
 *   ╚═╝  ╚═╝╚══════╝╚═╝    ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝
 *
 *   ALTUVERA TRAVEL - Enterprise Backend Server v4.0
 *   Production-Ready | High-Performance | Self-Monitoring | Cluster-Ready
 * ═══════════════════════════════════════════════════════════════════════════════
 */

"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const path = require("path");
const fs = require("fs");
const os = require("os");
const cluster = require("cluster");
const { EventEmitter } = require("events");
const http = require("http");


// Add this near the top of server.js, before database connection
console.log('🔍 ENV CHECK:');
console.log('- DATABASE_URL exists:', !!process.env.DATABASE_URL);
if (process.env.DATABASE_URL) {
  // Log sanitized version (hide password)
  const sanitized = process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@');
  console.log('- DATABASE_URL:', sanitized);
  
  // Check if there's any hidden character
  console.log('- DATABASE_URL length:', process.env.DATABASE_URL.length);
  console.log('- First 10 chars:', process.env.DATABASE_URL.substring(0, 10));
}
console.log('- NODE_ENV:', process.env.NODE_ENV);

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION - Centralized & Validated
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Server
  name: "ALTUVERA",
  version: "4.0.0",
  port: parseInt(process.env.PORT, 10) || 5000,
  env: process.env.NODE_ENV || "development",
  get isDev() {
    return this.env === "development";
  },
  get isProd() {
    return this.env === "production";
  },
  startTime: new Date(),

  // CORS
  corsOrigins: (
    process.env.CORS_ORIGINS ||
    "http://localhost:5173,http://localhost:3000,http://localhost:3001"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // File Upload
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 50 * 1024 * 1024, // 50MB
  maxJsonSize: "10mb",
  maxUrlEncodedSize: "10mb",

  // Cluster
  clusterMode: process.env.CLUSTER_MODE === "true",
  workersCount:
    parseInt(process.env.WORKERS_COUNT, 10) || Math.max(2, os.cpus().length),

  // Performance
  keepAliveTimeout: 65000,
  headersTimeout: 66000,
  requestTimeout: 30000,

  // Rate Limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // requests per window
  },

  // Database
  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    name: process.env.DB_NAME || "altuvera",
    user: process.env.DB_USER || "fabrice",
    password: process.env.DB_PASSWORD || "2004",
    pool: {
      max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
      min: parseInt(process.env.DB_POOL_MIN, 10) || 5,
      acquire: 30000,
      idle: 10000,
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLORS - Terminal output formatting
// ═══════════════════════════════════════════════════════════════════════════════

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
};

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGER - Enhanced logging with levels and colors
// ═══════════════════════════════════════════════════════════════════════════════

const Logger = {
  _getTimestamp() {
    return new Date().toISOString();
  },

  _format(level, color, emoji, message, meta = null) {
    const timestamp = this._getTimestamp();
    const metaStr = meta
      ? ` ${COLORS.dim}${JSON.stringify(meta)}${COLORS.reset}`
      : "";
    return `${COLORS.dim}[${timestamp}]${COLORS.reset} ${color}${emoji} ${level}${COLORS.reset}: ${message}${metaStr}`;
  },

  info(message, meta) {
    console.log(this._format("INFO", COLORS.green, "✅", message, meta));
  },

  warn(message, meta) {
    console.warn(this._format("WARN", COLORS.yellow, "⚠️", message, meta));
  },

  error(message, meta) {
    console.error(this._format("ERROR", COLORS.red, "❌", message, meta));
  },

  debug(message, meta) {
    if (CONFIG.isDev) {
      console.log(this._format("DEBUG", COLORS.blue, "🔍", message, meta));
    }
  },

  http(message) {
    console.log(`${COLORS.cyan}🌐 HTTP${COLORS.reset}: ${message}`);
  },

  success(message, meta) {
    console.log(this._format("SUCCESS", COLORS.green, "🎉", message, meta));
  },

  startup(message) {
    console.log(`${COLORS.magenta}🚀 STARTUP${COLORS.reset}: ${message}`);
  },

  route(message, status = "ok") {
    const config = {
      ok: { emoji: "✓", color: COLORS.green },
      warn: { emoji: "⚠", color: COLORS.yellow },
      error: { emoji: "✗", color: COLORS.red },
    };
    const { emoji, color } = config[status] || config.ok;
    console.log(`${color}   ${emoji} ${message}${COLORS.reset}`);
  },

  request(req, res, duration) {
    const status = res.statusCode;
    const color =
      status >= 500 ? COLORS.red : status >= 400 ? COLORS.yellow : COLORS.green;
    console.log(
      `${color}${req.method} ${req.originalUrl} ${status} ${duration}ms${COLORS.reset}`,
    );
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM MONITOR - Real-time metrics and health tracking
// ═══════════════════════════════════════════════════════════════════════════════

class SystemMonitor extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.metrics = {
      requests: { total: 0, success: 0, failed: 0, active: 0 },
      response: { times: [], avg: 0, min: Infinity, max: 0, p95: 0, p99: 0 },
      errors: [],
      routes: new Map(),
      memory: { samples: [] },
      cpu: { samples: [] },
    };
    this.startTime = Date.now();
    this.initialized = false;
  }


// In DatabaseManager.initialize() - find the DATABASE_URL usage and fix it:

async initialize() {
    const databaseUrl = process.env.DATABASE_URL || null;
    
    if (databaseUrl) {
      // Use DATABASE_URL connection string
      Logger.info("Using DATABASE_URL for connection");
      this.sequelize = new Sequelize(databaseUrl, {
        dialect: "postgres",
        protocol: "postgres",
        logging: CONFIG.isDev ? (msg) => Logger.debug(msg) : false,
        pool: CONFIG.db.pool,
        dialectOptions: {
          statement_timeout: 30000,
          idle_in_transaction_session_timeout: 30000,
          connectTimeout: 10000,
          // Only add SSL if needed (e.g., for Render, Railway, etc.)
          // ssl: { require: true, rejectUnauthorized: false },
        },
        define: {
          timestamps: true,
          underscored: true,
          freezeTableName: true,
        },
        benchmark: CONFIG.isDev,
        retry: { max: 3 },
      });
    } else {
      // Use individual config values
      Logger.info("Using individual DB config for connection");
      this.sequelize = new Sequelize(
        CONFIG.db.name,
        CONFIG.db.user,
        CONFIG.db.password,
        {
          host: CONFIG.db.host,
          port: CONFIG.db.port,
          dialect: "postgres",
          protocol: "postgres",
          logging: CONFIG.isDev ? (msg) => Logger.debug(msg) : false,
          pool: CONFIG.db.pool,
          dialectOptions: {
            statement_timeout: 30000,
            idle_in_transaction_session_timeout: 30000,
            connectTimeout: 10000,
          },
          define: {
            timestamps: true,
            underscored: true,
            freezeTableName: true,
          },
          benchmark: CONFIG.isDev,
          retry: { max: 3 },
        }
      );
    }

    global.sequelize = this.sequelize;
    return this;
  }

  _startMetricsCollection() {
    this._memoryInterval = setInterval(() => {
      const mem = process.memoryUsage();
      this.metrics.memory.samples.push({
        timestamp: Date.now(),
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external,
      });
      if (this.metrics.memory.samples.length > 100) {
        this.metrics.memory.samples.shift();
      }
    }, 30000);

    this._cpuInterval = setInterval(() => {
      const cpuUsage = process.cpuUsage();
      this.metrics.cpu.samples.push({
        timestamp: Date.now(),
        user: cpuUsage.user,
        system: cpuUsage.system,
      });
      if (this.metrics.cpu.samples.length > 100) {
        this.metrics.cpu.samples.shift();
      }
    }, 10000);
  }

  recordRequest(req) {
    this.metrics.requests.total++;
    this.metrics.requests.active++;

    const routeKey = `${req.method} ${req.baseUrl}${req.path}`;
    if (!this.metrics.routes.has(routeKey)) {
      this.metrics.routes.set(routeKey, {
        count: 0,
        errors: 0,
        times: [],
        avgTime: 0,
      });
    }
    this.metrics.routes.get(routeKey).count++;
  }

  recordResponse(req, res, duration) {
    this.metrics.requests.active = Math.max(
      0,
      this.metrics.requests.active - 1,
    );

    if (res.statusCode >= 400) {
      this.metrics.requests.failed++;
    } else {
      this.metrics.requests.success++;
    }

    this.metrics.response.times.push(duration);
    if (this.metrics.response.times.length > 1000) {
      this.metrics.response.times.shift();
    }

    this._updateResponseStats();

    const routeKey = `${req.method} ${req.baseUrl}${req.path}`;
    const routeStats = this.metrics.routes.get(routeKey);
    if (routeStats) {
      if (res.statusCode >= 400) routeStats.errors++;
      routeStats.times.push(duration);
      if (routeStats.times.length > 100) routeStats.times.shift();
      routeStats.avgTime =
        routeStats.times.reduce((a, b) => a + b, 0) / routeStats.times.length;
    }
  }

  _updateResponseStats() {
    const times = this.metrics.response.times;
    if (times.length === 0) return;

    const sorted = [...times].sort((a, b) => a - b);
    this.metrics.response.avg = times.reduce((a, b) => a + b, 0) / times.length;
    this.metrics.response.min = sorted[0];
    this.metrics.response.max = sorted[sorted.length - 1];
    this.metrics.response.p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    this.metrics.response.p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
  }

  recordError(err, req = null, type = "REQUEST_ERROR") {
    const errorRecord = {
      timestamp: new Date().toISOString(),
      type,
      message: err.message,
      stack: CONFIG.isDev ? err.stack : undefined,
      path: req?.originalUrl || req?.path,
      method: req?.method,
      requestId: req?.id,
      statusCode: err.statusCode || err.status || 500,
    };

    this.metrics.errors.push(errorRecord);
    if (this.metrics.errors.length > 100) {
      this.metrics.errors.shift();
    }

    if (this.listenerCount("error") > 0) {
      this.emit("error", errorRecord);
    }
    return errorRecord;
  }

  recordSecurityEvent(type, details) {
    Logger.warn(`Security Event: ${type}`, details);
    this.emit("security", {
      type,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  async getHealthStatus() {
    const mem = process.memoryUsage();
    const memUsagePercent = (mem.heapUsed / mem.heapTotal) * 100;

    let status = "healthy";
    const issues = [];

    if (memUsagePercent > 90) {
      status = "unhealthy";
      issues.push("Memory usage critical (>90%)");
    } else if (memUsagePercent > 75) {
      status = "degraded";
      issues.push("Memory usage high (>75%)");
    }

    const errorRate =
      this.metrics.requests.total > 0
        ? (this.metrics.requests.failed / this.metrics.requests.total) * 100
        : 0;
    if (errorRate > 10) {
      status = status === "healthy" ? "degraded" : status;
      issues.push(`High error rate (${errorRate.toFixed(1)}%)`);
    }

    if (this.metrics.response.avg > 2000) {
      status = status === "healthy" ? "degraded" : status;
      issues.push(
        `Slow avg response (${this.metrics.response.avg.toFixed(0)}ms)`,
      );
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      uptimeFormatted: this._formatUptime(Date.now() - this.startTime),
      issues,
      metrics: {
        requests: { ...this.metrics.requests },
        responseTime: {
          avg: Math.round(this.metrics.response.avg),
          min:
            this.metrics.response.min === Infinity
              ? 0
              : this.metrics.response.min,
          max: this.metrics.response.max,
          p95: Math.round(this.metrics.response.p95),
          p99: Math.round(this.metrics.response.p99),
        },
        memory: {
          heapUsed: this._formatBytes(mem.heapUsed),
          heapTotal: this._formatBytes(mem.heapTotal),
          rss: this._formatBytes(mem.rss),
          usagePercent: `${memUsagePercent.toFixed(1)}%`,
        },
        errorCount: this.metrics.errors.length,
        errorRate: `${errorRate.toFixed(2)}%`,
      },
    };
  }

  getMetrics() {
    const topRoutes = Array.from(this.metrics.routes.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([route, data]) => ({
        route,
        count: data.count,
        errors: data.errors,
        avgTime: Math.round(data.avgTime),
      }));

    return {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      requests: { ...this.metrics.requests },
      responseTime: {
        avg: Math.round(this.metrics.response.avg),
        min:
          this.metrics.response.min === Infinity
            ? 0
            : this.metrics.response.min,
        max: this.metrics.response.max,
        p95: Math.round(this.metrics.response.p95),
        p99: Math.round(this.metrics.response.p99),
      },
      topRoutes,
      recentErrors: this.metrics.errors.slice(-10),
      memory: process.memoryUsage(),
    };
  }

  async generateReport() {
    const health = await this.getHealthStatus();
    const metrics = this.getMetrics();

    return {
      server: {
        name: CONFIG.name,
        version: CONFIG.version,
        environment: CONFIG.env,
        nodeVersion: process.version,
        pid: process.pid,
      },
      health,
      metrics,
      system: {
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        totalMemory: this._formatBytes(os.totalmem()),
        freeMemory: this._formatBytes(os.freemem()),
        loadAvg: os.loadavg(),
        hostname: os.hostname(),
      },
      summary: {
        totalRequests: this.metrics.requests.total,
        successRate:
          this.metrics.requests.total > 0
            ? `${((this.metrics.requests.success / this.metrics.requests.total) * 100).toFixed(2)}%`
            : "N/A",
        avgResponseTime: `${Math.round(this.metrics.response.avg)}ms`,
        errorsTotal: this.metrics.errors.length,
      },
    };
  }

  cleanup() {
    if (this._memoryInterval) clearInterval(this._memoryInterval);
    if (this._cpuInterval) clearInterval(this._cpuInterval);
  }

  _formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }

  _formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [
      days > 0 ? `${days}d` : null,
      hours > 0 ? `${hours}h` : null,
      minutes > 0 ? `${minutes}m` : null,
      `${secs}s`,
    ]
      .filter(Boolean)
      .join(" ");
  }
}
// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE MANAGER - PostgreSQL with connection pooling & SSL verify-full
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE MANAGER - PostgreSQL with connection pooling & SSL support
// ═══════════════════════════════════════════════════════════════════════════════

const { Sequelize } = require("sequelize");

class DatabaseManager {
  constructor() {
    this.sequelize = null;
    this.connected = false;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.retryDelay = 3000; // initial delay in ms
  }

  async initialize() {
    // Check if DATABASE_URL exists (for cloud deployments like Render)
    if (process.env.DATABASE_URL) {
      Logger.info("Using DATABASE_URL for connection");
      
      // Log sanitized URL for debugging
      const sanitizedUrl = process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@');
      Logger.debug(`Connection string: ${sanitizedUrl}`);
      
      this.sequelize = new Sequelize(process.env.DATABASE_URL, {
        dialect: "postgres",
        protocol: "postgres",
        logging: CONFIG.isDev ? (msg) => Logger.debug(msg) : false,
        pool: CONFIG.db.pool,
        dialectOptions: {
          ssl: {
            require: true,
            rejectUnauthorized: false // Critical for cloud databases like Neon
          },
          statement_timeout: 30000,
          idle_in_transaction_session_timeout: 30000,
          connectTimeout: 10000
        },
        define: {
          timestamps: true,
          underscored: true,
          freezeTableName: true,
        },
        benchmark: CONFIG.isDev,
        retry: {
          max: 3,
        },
      });
    } else {
      // Fall back to individual connection parameters
      Logger.info("Using individual connection parameters");
      
      this.sequelize = new Sequelize(
        CONFIG.db.name,
        CONFIG.db.user,
        CONFIG.db.password,
        {
          host: CONFIG.db.host,
          port: CONFIG.db.port,
          dialect: "postgres",
          protocol: "postgres",
          logging: CONFIG.isDev ? (msg) => Logger.debug(msg) : false,
          pool: CONFIG.db.pool,
          dialectOptions: {
            statement_timeout: 30000,
            idle_in_transaction_session_timeout: 30000,
            connectTimeout: 10000,
            ssl: CONFIG.isProd ? {
              require: true,
              rejectUnauthorized: false
            } : false
          },
          define: {
            timestamps: true,
            underscored: true,
            freezeTableName: true,
          },
          benchmark: CONFIG.isDev,
          retry: {
            max: 3,
          },
        }
      );
    }

    global.sequelize = this.sequelize; // make globally accessible
    return this;
  }

  async connect() {
    while (this.retryCount < this.maxRetries) {
      try {
        await this.sequelize.authenticate();
        this.connected = true;

        // ✅ Auto-sync tables in development
        if (CONFIG.isDev) {
          Logger.info("Synchronizing database schema...");
          await this.sequelize.sync({ alter: true });
          Logger.success("Database schema synchronized");
        }

        // Log connection details safely
        const connectionDetails = process.env.DATABASE_URL 
          ? { 
              host: 'from DATABASE_URL', 
              database: 'from DATABASE_URL',
              pool: CONFIG.db.pool.max 
            }
          : {
              host: CONFIG.db.host,
              database: CONFIG.db.name,
              pool: CONFIG.db.pool.max
            };

        Logger.success("Database connected successfully", connectionDetails);
        return true;
      } catch (error) {
        this.retryCount++;
        
        // Enhanced error logging
        Logger.error(
          `Database connection failed (attempt ${this.retryCount}/${this.maxRetries})`,
          { 
            error: error.message,
            code: error.code,
            errno: error.errno,
            syscall: error.syscall
          }
        );

        // Specific SSL error guidance
        if (error.message.includes('ssl') || error.message.includes('SSL')) {
          Logger.warn("SSL connection issue detected. Make sure SSL is enabled for your database provider.");
          Logger.warn("Current SSL config: { require: true, rejectUnauthorized: false }");
        }

        // Connection timeout guidance
        if (error.message.includes('timeout') || error.code === 'ETIMEDOUT') {
          Logger.warn("Connection timeout. Check if your database allows connections from Render's IP ranges.");
        }

        // Authentication error guidance
        if (error.message.includes('password') || error.message.includes('authentication')) {
          Logger.warn("Authentication failed. Check your database username and password.");
        }

        if (this.retryCount >= this.maxRetries) {
          // Log final error with full details before throwing
          Logger.error("═".repeat(60));
          Logger.error("FATAL: All database connection attempts failed");
          Logger.error("═".repeat(60));
          Logger.error(`Connection string type: ${process.env.DATABASE_URL ? 'DATABASE_URL' : 'Individual params'}`);
          if (process.env.DATABASE_URL) {
            const maskedUrl = process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@');
            Logger.error(`Connection string: ${maskedUrl}`);
          }
          throw new Error(
            `Failed to connect to database after ${this.maxRetries} attempts: ${error.message}`
          );
        }

        Logger.warn(`Retrying in ${this.retryDelay / 1000}s...`);
        await this._sleep(this.retryDelay);
        this.retryDelay *= 1.5; // exponential backoff
      }
    }
  }

  async healthCheck() {
    if (!this.sequelize) {
      return {
        status: "unhealthy",
        connected: false,
        error: "Not initialized",
      };
    }

    try {
      const start = Date.now();
      await this.sequelize.query("SELECT 1");
      const latency = Date.now() - start;

      return {
        status: latency < 100 ? "healthy" : "degraded",
        connected: true,
        latency: `${latency}ms`,
      };
    } catch (error) {
      return { status: "unhealthy", connected: false, error: error.message };
    }
  }

  async close() {
    if (this.sequelize) {
      await this.sequelize.close();
      this.connected = false;
      Logger.info("Database connection closed");
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export a single instance
const databaseManager = new DatabaseManager();
module.exports = databaseManager;


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE LOADER - Intelligent route mounting with validation
// ═══════════════════════════════════════════════════════════════════════════════

class RouteLoader {
  constructor(app, monitor) {
    this.app = app;
    this.monitor = monitor;
    this.loadedRoutes = [];
    this.failedRoutes = [];
    this.routeStats = {};
  }

  getRouteDefinitions() {
    return [
      {
        path: "/admin/auth",
        file: "./routes/adminAuth",
        description: "Admin Authentication",
        priority: 0,
      },
      {
        path: "/auth",
        file: "./routes/auth",
        description: "User Authentication",
        priority: 1,
      },
      {
        path: "/users",
        file: "./routes/users",
        description: "User Management",
        optional: true,
      },
      {
        path: "/countries",
        file: "./routes/countries",
        description: "Countries Management",
      },
      {
        path: "/destinations",
        file: "./routes/destinations",
        description: "Travel Destinations",
      },
      { path: "/posts", file: "./routes/posts", description: "Blog Posts" },
      { path: "/tips", file: "./routes/tips", description: "Travel Tips" },
      {
        path: "/services",
        file: "./routes/services",
        description: "Travel Services",
      },
      { path: "/team", file: "./routes/team", description: "Team Members" },
      {
        path: "/gallery",
        file: "./routes/gallery",
        description: "Photo Gallery",
      },
      {
        path: "/bookings",
        file: "./routes/bookings",
        description: "Booking Management",
      },
      { path: "/faqs", file: "./routes/faqs", description: "FAQs" },
      {
        path: "/contact",
        file: "./routes/contact",
        description: "Contact Messages",
      },
      { path: "/pages", file: "./routes/pages", description: "Static Pages" },
      {
        path: "/virtual-tours",
        file: "./routes/virtualTours",
        description: "Virtual Tours",
      },
      {
        path: "/subscribers",
        file: "./routes/subscribers",
        description: "Newsletter Subscribers",
      },
      {
        path: "/settings",
        file: "./routes/settings",
        description: "Site Settings",
      },
      {
        path: "/uploads",
        file: "./routes/uploads",
        description: "Cloudinary Uploads",
      },
    ];
  }

  async loadAllRoutes() {
    Logger.startup("Loading API routes...");
    console.log("");

    const definitions = this.getRouteDefinitions().sort(
      (a, b) => (a.priority || 99) - (b.priority || 99),
    );

    const results = { loaded: 0, failed: 0, skipped: 0 };

    for (const routeDef of definitions) {
      const result = await this._loadRoute(routeDef);

      switch (result.status) {
        case "loaded":
          results.loaded++;
          this.loadedRoutes.push(result);
          Logger.route(
            `${routeDef.path.padEnd(20)} → ${routeDef.description} (${result.endpoints} endpoints)`,
            "ok",
          );
          break;
        case "skipped":
          results.skipped++;
          Logger.route(
            `${routeDef.path.padEnd(20)} → Skipped (optional)`,
            "warn",
          );
          break;
        case "failed":
          results.failed++;
          this.failedRoutes.push(result);
          Logger.route(
            `${routeDef.path.padEnd(20)} → FAILED: ${result.error}`,
            "error",
          );
          break;
      }
    }

    console.log("");
    Logger.startup(
      `Routes: ${results.loaded} loaded ✓ | ${results.failed} failed ✗ | ${results.skipped} skipped ○`,
    );

    return results;
  }

  async _loadRoute(routeDef) {
    const { path: routePath, file, description, optional = false } = routeDef;
    const fullPath = `/api${routePath}`;

    try {
      const absolutePath = require.resolve(file);
      Logger.debug(`Loading: ${absolutePath}`);

      if (CONFIG.isDev && require.cache[absolutePath]) {
        delete require.cache[absolutePath];
      }

      const routeModule = require(file);

      if (!routeModule || typeof routeModule !== "function") {
        throw new Error(
          `Invalid export: expected express.Router(), got ${typeof routeModule}`,
        );
      }

      if (!routeModule.stack) {
        throw new Error("Module is not a valid Express router (missing stack)");
      }

      const endpoints = this._countEndpoints(routeModule);

      this.app.use(fullPath, routeModule);

      Logger.debug(`Mounted: ${fullPath} with ${endpoints} endpoints`);

      this.routeStats[fullPath] = {
        description,
        endpoints,
        loadedAt: new Date().toISOString(),
        status: "active",
        file: absolutePath,
      };

      return {
        status: "loaded",
        path: fullPath,
        description,
        endpoints,
        file: absolutePath,
      };
    } catch (err) {
      if (
        (err.code === "MODULE_NOT_FOUND" ||
          err.code === "ERR_MODULE_NOT_FOUND") &&
        optional
      ) {
        return {
          status: "skipped",
          path: fullPath,
          description,
          reason: "Optional module not found",
        };
      }

      if (CONFIG.isDev) {
        Logger.error(`Failed to load route ${routePath}:`, {
          error: err.message,
          stack: err.stack,
        });
      }

      return {
        status: "failed",
        path: fullPath,
        description,
        error: err.message,
        stack: CONFIG.isDev ? err.stack : undefined,
      };
    }
  }

  _countEndpoints(router) {
    let count = 0;
    if (router.stack) {
      for (const layer of router.stack) {
        if (layer.route) {
          count += Object.keys(layer.route.methods).filter(
            (m) => layer.route.methods[m],
          ).length;
        } else if (layer.name === "router" && layer.handle?.stack) {
          count += this._countEndpoints(layer.handle);
        }
      }
    }
    return count;
  }

  getStatus() {
    return {
      loaded: this.loadedRoutes.length,
      failed: this.failedRoutes.length,
      routes: this.routeStats,
      failures: this.failedRoutes.map((f) => ({
        path: f.path,
        error: f.error,
        description: f.description,
      })),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPRESS APP FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

function createApp(monitor) {
  const app = express();

  app.set("trust proxy", CONFIG.isProd ? 1 : false);
  app.set("x-powered-by", false);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY MIDDLEWARE
  // ═══════════════════════════════════════════════════════════════════════════

  app.use(
    helmet({
      contentSecurityPolicy: CONFIG.isProd ? undefined : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  // CORS
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        if (CONFIG.corsOrigins.includes(origin) || CONFIG.isDev) {
          return callback(null, true);
        }

        monitor.recordSecurityEvent("CORS_BLOCKED", { origin });
        callback(new Error(`CORS blocked: ${origin}`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-API-Key",
        "X-Request-ID",
      ],
      exposedHeaders: ["X-Total-Count", "X-Page-Count", "X-Request-ID"],
      maxAge: 86400,
    }),
  );

  // Compression
  app.use(
    compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers["x-no-compression"]) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // ✅ CRITICAL FIX: Body parsing BEFORE routes
  app.use(
    express.json({
      limit: CONFIG.maxJsonSize,
      strict: true,
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(
    express.urlencoded({
      extended: true,
      limit: CONFIG.maxUrlEncodedSize,
      parameterLimit: 10000,
    }),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // REQUEST TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  app.use((req, res, next) => {
    req.id =
      req.headers["x-request-id"] ||
      `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
    req.startTime = Date.now();

    res.setHeader("X-Request-ID", req.id);
    res.setHeader("X-Response-Time", "pending");
    res.setHeader("X-Powered-By", `${CONFIG.name}/${CONFIG.version}`);

    const originalWriteHead = res.writeHead;
    res.writeHead = function writeHeadWithResponseTime(...args) {
      if (!res.headersSent) {
        const duration = Date.now() - req.startTime;
        res.setHeader("X-Response-Time", `${duration}ms`);
      }
      return originalWriteHead.apply(this, args);
    };

    res.once("finish", () => {
      const duration = Date.now() - req.startTime;
      try {
        monitor.recordResponse(req, res, duration);
      } catch (monitorErr) {
        Logger.warn(`Monitor response recording failed: ${monitorErr.message}`);
      }
    });

    monitor.recordRequest(req);
    next();
  });

  // Morgan logging
  const morganFormat = CONFIG.isDev
    ? ":method :url :status :response-time ms - :res[content-length]"
    : "combined";

  app.use(
    morgan(morganFormat, {
      stream: { write: (msg) => Logger.http(msg.trim()) },
      skip: (req) =>
        [
          "/api/health",
          "/api/health/live",
          "/api/health/ready",
          "/favicon.ico",
        ].includes(req.url),
    }),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // STATIC FILES
  // ═══════════════════════════════════════════════════════════════════════════

  const uploadsDir = path.join(__dirname, CONFIG.uploadDir);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true});
    Logger.info("Created uploads directory", { path: uploadsDir });
  }

  app.use(
    "/uploads",
    express.static(uploadsDir, {
      maxAge: CONFIG.isProd ? "7d" : 0,
      etag: true,
      lastModified: true,
      index: false,
      dotfiles: "deny",
    }),
  );

  return app;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM ENDPOINTS SETUP
// ═══════════════════════════════════════════════════════════════════════════════

function setupSystemEndpoints(app, monitor, database, routeLoader) {
  app.get("/", (req, res) => {
    res.json({
      name: CONFIG.name,
      version: CONFIG.version,
      status: "online",
      message: "Welcome to ALTUVERA Travel API 🌍",
      documentation: "/api/docs",
      health: "/api/health",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api", (req, res) => {
    res.json({
      name: `${CONFIG.name} API`,
      version: CONFIG.version,
      status: "online",
      endpoints: {
        health: "/api/health",
        docs: "/api/docs",
        auth: "/api/auth",
        adminAuth: "/api/admin/auth",
      },
    });
  });

  app.get("/api/health", async (req, res) => {
    try {
      const [serverHealth, dbHealth] = await Promise.all([
        monitor.getHealthStatus(),
        database.healthCheck(),
      ]);

      const overall =
        dbHealth.status === "unhealthy" || serverHealth.status === "unhealthy"
          ? "unhealthy"
          : dbHealth.status === "degraded" || serverHealth.status === "degraded"
            ? "degraded"
            : "healthy";

      const statusCode = overall === "unhealthy" ? 503 : 200;

      res.status(statusCode).json({
        status: overall,
        timestamp: new Date().toISOString(),
        version: CONFIG.version,
        environment: CONFIG.env,
        server: serverHealth,
        database: dbHealth,
      });
    } catch (error) {
      res.status(503).json({
        status: "unhealthy",
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get("/api/health/live", (req, res) => {
    res.status(200).json({ status: "alive", timestamp: Date.now() });
  });

  app.get("/api/health/ready", async (req, res) => {
    const dbHealth = await database.healthCheck();
    const status = dbHealth.status === "healthy" ? 200 : 503;
    res.status(status).json({
      status: dbHealth.status === "healthy" ? "ready" : "not ready",
      database: dbHealth,
      timestamp: Date.now(),
    });
  });

  app.get("/api/system/metrics", (req, res) => {
    res.json(monitor.getMetrics());
  });

  app.get("/api/system/report", async (req, res) => {
    try {
      res.json(await monitor.generateReport());
    } catch (err) {
      res
        .status(500)
        .json({ error: "Failed to generate report", message: err.message });
    }
  });

  app.get("/api/system/info", (req, res) => {
    res.json({
      name: CONFIG.name,
      version: CONFIG.version,
      environment: CONFIG.env,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: process.uptime(),
      startTime: CONFIG.startTime.toISOString(),
      memory: process.memoryUsage(),
      cpus: os.cpus().length,
    });
  });

  app.get("/api/system/routes", (req, res) => {
    res.json(routeLoader.getStatus());
  });

  app.get("/api/monitor/ping", (req, res) => {
    res.json({
      pong: Date.now(),
      server: CONFIG.name,
      uptime: process.uptime(),
    });
  });

  app.get("/api/docs", (req, res) => {
    const routeStatus = routeLoader.getStatus();

    res.json({
      name: `${CONFIG.name} API Documentation`,
      version: CONFIG.version,
      baseUrl: `/api`,
      endpoints: {
        system: {
          "GET /": "API information",
          "GET /api": "API root",
          "GET /api/health": "Health check",
          "GET /api/health/live": "Liveness probe",
          "GET /api/health/ready": "Readiness probe",
          "GET /api/system/info": "Server information",
          "GET /api/system/metrics": "Real-time metrics",
          "GET /api/system/report": "Detailed system report",
          "GET /api/system/routes": "Route status",
          "GET /api/monitor/ping": "Ping/Pong",
        },
        api: Object.fromEntries(
          Object.entries(routeStatus.routes).map(([path, info]) => [
            path,
            {
              description: info.description,
              endpoints: info.endpoints,
              status: info.status,
            },
          ]),
        ),
      },
      failedRoutes: routeStatus.failures,
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLERS SETUP
// ═══════════════════════════════════════════════════════════════════════════════

function setupErrorHandlers(app, monitor) {
  app.use((req, res, next) => {
    const error = {
      success: false,
      error: "Not Found",
      message: `Cannot ${req.method} ${req.originalUrl}`,
      path: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
      requestId: req.id,
      suggestion: "Check the API documentation at /api/docs",
    };

    Logger.warn(`404: ${req.method} ${req.originalUrl}`);
    res.status(404).json(error);
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      Logger.warn(`[${req.id}] Error after headers sent: ${err.message}`);
      return next(err);
    }

    try {
      monitor.recordError(err, req);
    } catch (monitorErr) {
      Logger.warn(`Monitor error recording failed: ${monitorErr.message}`);
    }

    const statusCode = err.statusCode || err.status || 500;

    if (statusCode >= 500) {
      Logger.error(`[${req.id}] ${err.message}`, {
        path: req.originalUrl,
        method: req.method,
        stack: CONFIG.isDev ? err.stack : undefined,
      });
    } else {
      Logger.warn(`[${req.id}] ${err.message}`, {
        path: req.originalUrl,
        status: statusCode,
      });
    }

    const response = {
      success: false,
      error: err.name || "Error",
      code: err.code || "INTERNAL_ERROR",
      message:
        CONFIG.isProd && statusCode >= 500
          ? "Internal server error"
          : err.message,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    };

    if (err.details) response.details = err.details;
    if (CONFIG.isDev) response.stack = err.stack;

    res.status(statusCode).json(response);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// STARTUP BANNER
// ═══════════════════════════════════════════════════════════════════════════════

function printStartupBanner(routeResults) {
  const mem = process.memoryUsage();
  const banner = `
${COLORS.cyan}╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║     █████╗ ██╗  ████████╗██╗   ██╗██╗   ██╗███████╗██████╗  █████╗            ║
║    ██╔══██╗██║  ╚══██╔══╝██║   ██║██║   ██║██╔════╝██╔══██╗██╔══██╗           ║
║    ███████║██║     ██║   ██║   ██║██║   ██║█████╗  ██████╔╝███████║           ║
║    ██╔══██║██║     ██║   ██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██╔══██║           ║
║    ██║  ██║███████╗██║   ╚██████╔╝ ╚████╔╝ ███████╗██║  ██║██║  ██║           ║
║    ╚═╝  ╚═╝╚══════╝╚═╝    ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝           ║
║                                                                               ║
║                    🌍 EAST AFRICAN TRAVEL BACKEND SERVER 🌍                   ║
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   ${COLORS.green}🚀 Status: ONLINE${COLORS.cyan}         ${COLORS.white}📍 Port: ${CONFIG.port}${COLORS.cyan}                                    ║
║   ${COLORS.white}🌐 Environment: ${CONFIG.env.toUpperCase().padEnd(12)}${COLORS.cyan}${COLORS.white}📦 Version: ${CONFIG.version}${COLORS.cyan}                         ║
║   ${COLORS.white}💻 Node: ${process.version.padEnd(16)}${COLORS.cyan}${COLORS.white}🖥️  Platform: ${process.platform} ${process.arch}${COLORS.cyan}               ║
║   ${COLORS.white}🧠 Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB${COLORS.cyan}       ${COLORS.white}📂 PID: ${process.pid}${COLORS.cyan}                              ║
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   ${COLORS.yellow}📊 ROUTES:${COLORS.cyan} ${COLORS.green}${routeResults.loaded} loaded${COLORS.cyan} | ${COLORS.red}${routeResults.failed} failed${COLORS.cyan} | ${COLORS.yellow}${routeResults.skipped} skipped${COLORS.cyan}                           ║
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   ${COLORS.magenta}📡 ENDPOINTS:${COLORS.cyan}                                                             ║
║   ${COLORS.white}├─ API:        http://localhost:${CONFIG.port}/api${COLORS.cyan}                              ║
║   ${COLORS.white}├─ Health:     http://localhost:${CONFIG.port}/api/health${COLORS.cyan}                        ║
║   ${COLORS.white}├─ Docs:       http://localhost:${CONFIG.port}/api/docs${COLORS.cyan}                          ║
║   ${COLORS.white}├─ Auth:       http://localhost:${CONFIG.port}/api/auth${COLORS.cyan}                          ║
║   ${COLORS.white}└─ Admin Auth: http://localhost:${CONFIG.port}/api/admin/auth${COLORS.cyan}                    ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝${COLORS.reset}
`;
  console.log(banner);
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════════════

function setupGracefulShutdown(server, database, monitor) {
  let isShuttingDown = false;

  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log("");
    Logger.warn(`${signal} received. Starting graceful shutdown...`);

    server.close(async () => {
      Logger.info("HTTP server closed");

      try {
        await database.close();
        monitor.cleanup();

        const report = await monitor.generateReport();
        Logger.info("Final stats:", report.summary);

        Logger.success("Graceful shutdown complete");
        process.exit(0);
      } catch (err) {
        Logger.error("Error during shutdown:", { error: err.message });
        process.exit(1);
      }
    });

    setTimeout(() => {
      Logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 30000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    Logger.error("Uncaught Exception:", {
      message: err.message,
      stack: err.stack,
    });
    monitor.recordError(err, null, "UNCAUGHT_EXCEPTION");
    shutdown("UNCAUGHT_EXCEPTION");
  });

  process.on("unhandledRejection", (reason) => {
    Logger.error("Unhandled Rejection:", {
      reason: reason?.message || String(reason),
    });
    monitor.recordError(
      reason || new Error("Unhandled rejection"),
      null,
      "UNHANDLED_REJECTION",
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN STARTUP FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

async function startServer() {
  try {
    console.log("");
    Logger.startup("═".repeat(60));
    Logger.startup(`Starting ${CONFIG.name} v${CONFIG.version}...`);
    Logger.startup("═".repeat(60));
    console.log("");

    // 1. Initialize Monitor
    Logger.startup("Initializing system monitor...");
    const monitor = new SystemMonitor();
    await monitor.initialize();
    Logger.success("System monitor ready");

    // 2. Initialize Database
    Logger.startup("Connecting to database...");
    const database = new DatabaseManager();
    await database.initialize();
    await database.connect();

    // 3. Create Express App
    Logger.startup("Creating Express application...");
    const app = createApp(monitor);
    Logger.success("Express app created");

    // 4. Setup System Endpoints (BEFORE routes)
    const routeLoader = new RouteLoader(app, monitor);
    setupSystemEndpoints(app, monitor, database, routeLoader);
    Logger.success("System endpoints configured");

    // 5. Load API Routes
    console.log("");
    const routeResults = await routeLoader.loadAllRoutes();
    console.log("");

    // 6. Setup Error Handlers (AFTER routes)
    setupErrorHandlers(app, monitor);
    Logger.success("Error handlers configured");

    // Check for critical failures
    if (routeResults.failed > 0 && routeResults.loaded === 0) {
      throw new Error("All routes failed to load. Cannot start server.");
    }

    // 7. Start HTTP Server
    const server = http.createServer(app);

    server.keepAliveTimeout = CONFIG.keepAliveTimeout;
    server.headersTimeout = CONFIG.headersTimeout;
    server.timeout = CONFIG.requestTimeout;

    server.listen(CONFIG.port, "0.0.0.0", () => {
      printStartupBanner(routeResults);

      Logger.success("Server is ready and accepting connections!");
      Logger.info(`Local:   http://localhost:${CONFIG.port}`);
      Logger.info(`Network: http://${getLocalIP()}:${CONFIG.port}`);
      console.log("");
    });

    // 8. Setup Graceful Shutdown
    setupGracefulShutdown(server, database, monitor);

    global.server = server;
    global.monitor = monitor;
    global.database = database;

    return { app, server, monitor, database };
  } catch (err) {
    console.log("");
    Logger.error("═".repeat(60));
    Logger.error("FATAL: Failed to start server");
    Logger.error("═".repeat(60));
    Logger.error(err.message);
    if (CONFIG.isDev) {
      console.error(err.stack);
    }
    console.log("");
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// START THE SERVER
// ═══════════════════════════════════════════════════════════════════════════════

startServer();

module.exports = { createApp, CONFIG, Logger, databaseManager };