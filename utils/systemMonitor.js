/**
 * ALTUVERA System Monitor
 * Real-time monitoring, metrics collection, and reporting
 */

const os = require("os");
const logger = require("./logger");

let dbQuery = null;
try {
  dbQuery = require("../config/db").query;
} catch (e) {
  // Database not available
}

class SystemMonitor {
  constructor(serverName) {
    this.serverName = serverName;
    this.startTime = Date.now();
    this.metrics = {
      requests: {
        total: 0,
        success: 0,
        errors: 0,
        byMethod: {},
        byRoute: {},
        byStatusCode: {},
      },
      performance: {
        avgResponseTime: 0,
        maxResponseTime: 0,
        minResponseTime: Infinity,
        totalResponseTime: 0,
        requestCount: 0,
      },
      errors: [],
      security: {
        blockedRequests: 0,
        events: [],
      },
      events: [],
    };
    
    this.routeHealth = new Map();
  }

  async initialize() {
    logger.info("System Monitor initialized");
    this.healthCheckInterval = setInterval(() => this.performHealthChecks(), 60000);
    this.cleanupInterval = setInterval(() => this.cleanupOldData(), 3600000);
    return true;
  }

  recordRequest(req) {
    this.metrics.requests.total++;
    const method = req.method;
    this.metrics.requests.byMethod[method] = (this.metrics.requests.byMethod[method] || 0) + 1;
    const route = this.normalizeRoute(req.path);
    this.metrics.requests.byRoute[route] = (this.metrics.requests.byRoute[route] || 0) + 1;
  }

  recordResponse(req, res, duration) {
    const statusCode = res.statusCode;
    this.metrics.requests.byStatusCode[statusCode] = (this.metrics.requests.byStatusCode[statusCode] || 0) + 1;
    
    if (statusCode >= 200 && statusCode < 400) {
      this.metrics.requests.success++;
    } else if (statusCode >= 400) {
      this.metrics.requests.errors++;
    }
    
    this.metrics.performance.totalResponseTime += duration;
    this.metrics.performance.requestCount++;
    this.metrics.performance.avgResponseTime = 
      this.metrics.performance.totalResponseTime / this.metrics.performance.requestCount;
    
    if (duration > this.metrics.performance.maxResponseTime) {
      this.metrics.performance.maxResponseTime = duration;
    }
    if (duration < this.metrics.performance.minResponseTime) {
      this.metrics.performance.minResponseTime = duration;
    }
    
    const route = this.normalizeRoute(req.path);
    this.updateRouteHealth(route, statusCode, duration);
  }

  recordError(err, req, type = "REQUEST_ERROR") {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      type,
      message: err?.message || String(err),
      stack: err?.stack,
      url: req?.url,
      method: req?.method,
      ip: req?.ip,
      requestId: req?.id,
    };
    
    this.metrics.errors.push(errorEntry);
    if (this.metrics.errors.length > 100) {
      this.metrics.errors = this.metrics.errors.slice(-100);
    }
  }

  recordSecurityEvent(type, details) {
    this.metrics.security.blockedRequests++;
    this.metrics.security.events.push({
      timestamp: new Date().toISOString(),
      type,
      details,
    });
    
    if (this.metrics.security.events.length > 50) {
      this.metrics.security.events = this.metrics.security.events.slice(-50);
    }
  }

  recordEvent(type, details) {
    this.metrics.events.push({
      timestamp: new Date().toISOString(),
      type,
      details,
    });
    
    if (this.metrics.events.length > 100) {
      this.metrics.events = this.metrics.events.slice(-100);
    }
  }

  normalizeRoute(path) {
    return path
      .replace(/\/\d+/g, "/:id")
      .replace(/\/[a-f0-9-]{36}/g, "/:uuid")
      .split("?")[0];
  }

  updateRouteHealth(route, statusCode, duration) {
    if (!this.routeHealth.has(route)) {
      this.routeHealth.set(route, {
        requests: 0,
        errors: 0,
        avgDuration: 0,
        totalDuration: 0,
        lastStatus: statusCode,
        lastCheck: new Date().toISOString(),
      });
    }
    
    const health = this.routeHealth.get(route);
    health.requests++;
    health.totalDuration += duration;
    health.avgDuration = health.totalDuration / health.requests;
    health.lastStatus = statusCode;
    health.lastCheck = new Date().toISOString();
    
    if (statusCode >= 400) {
      health.errors++;
    }
  }

  async getHealthStatus() {
    const dbHealth = await this.checkDatabaseHealth();
    const memoryUsage = process.memoryUsage();
    const cpuUsage = os.loadavg();
    
    const errorRate = this.metrics.requests.total > 0 
      ? (this.metrics.requests.errors / this.metrics.requests.total) * 100 
      : 0;
    
    let status = "healthy";
    const issues = [];
    
    if (errorRate > 10) {
      status = "unhealthy";
      issues.push(`High error rate: ${errorRate.toFixed(2)}%`);
    } else if (errorRate > 5) {
      status = "degraded";
      issues.push(`Elevated error rate: ${errorRate.toFixed(2)}%`);
    }
    
    if (!dbHealth.connected) {
      status = "unhealthy";
      issues.push("Database connection failed");
    }
    
    const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    if (memoryUsagePercent > 90) {
      status = "unhealthy";
      issues.push(`High memory usage: ${memoryUsagePercent.toFixed(2)}%`);
    } else if (memoryUsagePercent > 75) {
      if (status === "healthy") status = "degraded";
      issues.push(`Elevated memory usage: ${memoryUsagePercent.toFixed(2)}%`);
    }
    
    return {
      status,
      timestamp: new Date().toISOString(),
      server: this.serverName,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      uptimeFormatted: this.formatUptime(Date.now() - this.startTime),
      checks: {
        database: dbHealth,
        memory: {
          status: memoryUsagePercent < 75 ? "ok" : memoryUsagePercent < 90 ? "warning" : "critical",
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + " MB",
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + " MB",
          percentage: memoryUsagePercent.toFixed(2) + "%",
        },
        cpu: {
          status: cpuUsage[0] < 0.7 ? "ok" : cpuUsage[0] < 0.9 ? "warning" : "critical",
          load: cpuUsage.map(l => l.toFixed(2)),
        },
        requests: {
          total: this.metrics.requests.total,
          errorRate: errorRate.toFixed(2) + "%",
          avgResponseTime: this.metrics.performance.avgResponseTime.toFixed(2) + " ms",
        },
      },
      issues,
    };
  }

  async checkDatabaseHealth() {
    if (!dbQuery) {
      return { connected: false, error: "Database module not loaded", status: "unknown" };
    }
    
    try {
      const start = Date.now();
      await dbQuery("SELECT 1 as health_check");
      const duration = Date.now() - start;
      
      return {
        connected: true,
        responseTime: duration + " ms",
        status: duration < 100 ? "ok" : duration < 500 ? "slow" : "critical",
      };
    } catch (err) {
      return {
        connected: false,
        error: err.message,
        status: "critical",
      };
    }
  }

  async performHealthChecks() {
    const health = await this.getHealthStatus();
    if (health.status !== "healthy") {
      logger.warn(`System health: ${health.status}`, health.issues);
    }
  }

  getMetrics() {
    return {
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      requests: this.metrics.requests,
      performance: {
        avgResponseTime: this.metrics.performance.avgResponseTime.toFixed(2) + " ms",
        maxResponseTime: this.metrics.performance.maxResponseTime + " ms",
        minResponseTime: this.metrics.performance.minResponseTime === Infinity 
          ? "N/A" 
          : this.metrics.performance.minResponseTime + " ms",
      },
      errors: {
        total: this.metrics.errors.length,
        recent: this.metrics.errors.slice(-5),
      },
      security: {
        blockedRequests: this.metrics.security.blockedRequests,
        recentEvents: this.metrics.security.events.slice(-5),
      },
      routeHealth: Object.fromEntries(this.routeHealth),
    };
  }

  async generateReport() {
    const health = await this.getHealthStatus();
    const metrics = this.getMetrics();
    
    let dbStats = {};
    if (dbQuery) {
      try {
        const tables = await dbQuery(`
          SELECT relname as table_name, n_live_tup as row_count
          FROM pg_stat_user_tables ORDER BY n_live_tup DESC
        `);
        dbStats.tables = tables.rows;
        
        const dbSize = await dbQuery(`
          SELECT pg_size_pretty(pg_database_size(current_database())) as size
        `);
        dbStats.size = dbSize.rows[0]?.size;
      } catch (err) {
        dbStats.error = err.message;
      }
    }
    
    return {
      reportId: `RPT-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      server: {
        name: this.serverName,
        version: "2.0.0",
        environment: process.env.NODE_ENV,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      health,
      metrics,
      database: dbStats,
      summary: {
        status: health.status,
        uptime: health.uptimeFormatted,
        totalRequests: this.metrics.requests.total,
        successRate: this.metrics.requests.total > 0 
          ? ((this.metrics.requests.success / this.metrics.requests.total) * 100).toFixed(2) + "%" 
          : "N/A",
        avgResponseTime: this.metrics.performance.avgResponseTime.toFixed(2) + " ms",
        activeRoutes: this.routeHealth.size,
        recentErrors: this.metrics.errors.length,
        securityEvents: this.metrics.security.events.length,
      },
    };
  }

  async generateAsciiReport() {
    const report = await this.generateReport();
    const h = report.health;
    const s = report.summary;
    
    const statusIcon = h.status === "healthy" ? "✅" : h.status === "degraded" ? "⚠️" : "❌";
    
    const topRoutes = Array.from(this.routeHealth.entries())
      .sort((a, b) => b[1].requests - a[1].requests)
      .slice(0, 10);
    
    const recentErrors = this.metrics.errors.slice(-5);
    
    let ascii = `
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║     █████╗ ██╗  ████████╗██╗   ██╗██╗   ██╗███████╗██████╗  █████╗            ║
║    ██╔══██╗██║  ╚══██╔══╝██║   ██║██║   ██║██╔════╝██╔══██╗██╔══██╗           ║
║    ███████║██║     ██║   ██║   ██║██║   ██║█████╗  ██████╔╝███████║           ║
║    ██╔══██║██║     ██║   ██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██╔══██║           ║
║    ██║  ██║███████╗██║   ╚██████╔╝ ╚████╔╝ ███████╗██║  ██║██║  ██║           ║
║    ╚═╝  ╚═╝╚══════╝╚═╝    ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝           ║
║                                                                               ║
║                       📊 SYSTEM STATUS REPORT 📊                              ║
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Report ID: ${report.reportId.padEnd(62)}║
║  Generated: ${report.generatedAt.padEnd(62)}║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │                         SYSTEM HEALTH                                  │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║                                                                               ║
║    ${statusIcon} Status:          ${h.status.toUpperCase().padEnd(52)}║
║    ⏱️  Uptime:          ${s.uptime.padEnd(52)}║
║    📊 Total Requests:  ${String(s.totalRequests).padEnd(52)}║
║    ✅ Success Rate:    ${s.successRate.padEnd(52)}║
║    ⚡ Avg Response:    ${s.avgResponseTime.padEnd(52)}║
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │                       RESOURCE USAGE                                   │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║                                                                               ║
║    🧠 Memory:          ${(h.checks.memory.heapUsed + " / " + h.checks.memory.heapTotal).padEnd(52)}║
║    💻 CPU Load:        ${h.checks.cpu.load.join(", ").padEnd(52)}║
║    🗄️  Database:        ${(h.checks.database.connected ? "Connected" : "Disconnected").padEnd(52)}║
║    📦 DB Size:         ${(report.database.size || "Unknown").padEnd(52)}║
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │                      REQUEST BREAKDOWN                                 │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║                                                                               ║`;

    const methods = this.metrics.requests.byMethod;
    for (const [method, count] of Object.entries(methods)) {
      const percentage = this.metrics.requests.total > 0 
        ? ((count / this.metrics.requests.total) * 100).toFixed(1) 
        : 0;
      const bar = "█".repeat(Math.min(20, Math.round(percentage / 5))) + "░".repeat(Math.max(0, 20 - Math.round(percentage / 5)));
      ascii += `\n║    ${method.padEnd(8)} ${bar} ${String(count).padStart(6)} (${percentage}%)`.padEnd(78) + `║`;
    }

    ascii += `
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │                       TOP ROUTES                                       │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║                                                                               ║`;

    for (const [route, stats] of topRoutes) {
      const errorRate = stats.requests > 0 ? ((stats.errors / stats.requests) * 100).toFixed(1) : "0.0";
      const statusIcon = parseFloat(errorRate) < 5 ? "✅" : parseFloat(errorRate) < 20 ? "⚠️" : "❌";
      ascii += `\n║    ${statusIcon} ${route.substring(0, 30).padEnd(30)} ${String(stats.requests).padStart(6)} reqs`.padEnd(78) + `║`;
    }

    if (topRoutes.length === 0) {
      ascii += `\n║    No route data collected yet`.padEnd(78) + `║`;
    }

    ascii += `
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │                      RECENT ERRORS                                     │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║                                                                               ║`;

    if (recentErrors.length > 0) {
      for (const err of recentErrors) {
        const time = new Date(err.timestamp).toLocaleTimeString();
        const msg = (err.message || "Unknown error").substring(0, 45);
        ascii += `\n║    ❌ [${time}] ${msg.padEnd(50)}`.padEnd(78) + `║`;
      }
    } else {
      ascii += `\n║    ✅ No recent errors - System running smoothly!`.padEnd(78) + `║`;
    }

    ascii += `
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  🛡️  Security Events: ${String(this.metrics.security.blockedRequests).padEnd(52)}║
║  📝 Logged Events:   ${String(this.metrics.events.length).padEnd(52)}║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝

                    Generated by ALTUVERA System Monitor v2.0.0
`;

    return ascii;
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  cleanupOldData() {
    const oneHourAgo = Date.now() - 3600000;
    this.metrics.errors = this.metrics.errors.filter(
      e => new Date(e.timestamp).getTime() > oneHourAgo
    );
    this.metrics.security.events = this.metrics.security.events.filter(
      e => new Date(e.timestamp).getTime() > oneHourAgo
    );
  }

  shutdown() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
  }
}

module.exports = SystemMonitor;