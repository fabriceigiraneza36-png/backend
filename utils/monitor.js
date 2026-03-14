const { EventEmitter } = require("events");
const os = require("os");
const logger = require("./logger");

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
  }

  async initialize() {
    this._startMetricsCollection();
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
      });
      if (this.metrics.memory.samples.length > 100)
        this.metrics.memory.samples.shift();
    }, 30000);

    this._cpuInterval = setInterval(() => {
      const cpuUsage = process.cpuUsage();
      this.metrics.cpu.samples.push({
        timestamp: Date.now(),
        user: cpuUsage.user,
        system: cpuUsage.system,
      });
      if (this.metrics.cpu.samples.length > 100)
        this.metrics.cpu.samples.shift();
    }, 10000);
  }

  recordRequest(req) {
    this.metrics.requests.total++;
    this.metrics.requests.active++;
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
    if (this.metrics.response.times.length > 1000)
      this.metrics.response.times.shift();
    this._updateResponseStats();
  }

  recordError(error) {
    this.metrics.errors.push({
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
    if (this.metrics.errors.length > 100) this.metrics.errors.shift();
  }

  updateMemory() {
    const mem = process.memoryUsage();
    this.metrics.memory.samples.push({
      timestamp: Date.now(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
    });
    if (this.metrics.memory.samples.length > 100)
      this.metrics.memory.samples.shift();
  }

  _updateResponseStats() {
    const times = this.metrics.response.times;
    if (times.length === 0) return;
    const sorted = [...times].sort((a, b) => a - b);
    this.metrics.response.avg = times.reduce((a, b) => a + b, 0) / times.length;
    this.metrics.response.min = sorted[0];
    this.metrics.response.max = sorted[sorted.length - 1];
    this.metrics.response.p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  }

  getHealthStatus() {
    const mem = process.memoryUsage();
    return {
      status: "healthy",
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      memory: {
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
      },
      requests: this.metrics.requests,
      responseTime: { avg: Math.round(this.metrics.response.avg) },
    };
  }

  getDetailedStats() {
    return {
      ...this.metrics,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  cleanup() {
    if (this._memoryInterval) clearInterval(this._memoryInterval);
    if (this._cpuInterval) clearInterval(this._cpuInterval);
  }
}

module.exports = new SystemMonitor();
