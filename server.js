'use strict';

const cluster = require('cluster');
const os = require('os');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

/**
 * Advanced Cluster Manager with robust error handling,
 * worker health monitoring, and graceful shutdown
 */
class ClusterManager {
  constructor() {
    this.workers = new Map();
    this.workerStats = new Map();
    this.isShuttingDown = false;
    this.restartQueue = [];
    this.maxRestarts = parseInt(process.env.MAX_WORKER_RESTARTS || '5', 10);
    this.restartWindow = parseInt(process.env.RESTART_WINDOW || '60000', 10); // 1 minute
    this.healthCheckInterval = parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000', 10); // 30 seconds
    this.shutdownTimeout = parseInt(process.env.SHUTDOWN_TIMEOUT || '30000', 10); // 30 seconds
    
    this.config = {
      numWorkers: this.calculateWorkerCount(),
      isProduction: process.env.NODE_ENV === 'production',
      enableClustering: process.env.ENABLE_CLUSTERING !== 'false',
      port: parseInt(process.env.PORT || '5000', 10),
      host: process.env.HOST || '0.0.0.0',
    };

    this.startTime = Date.now();
    this.setupProcessHandlers();
  }

  calculateWorkerCount() {
    const cpuCount = os.cpus().length;
    const envWorkers = parseInt(process.env.CLUSTER_WORKERS || '0', 10);
    const maxWorkers = parseInt(process.env.MAX_WORKERS || String(cpuCount), 10);
    
    // Auto-calculate based on available memory and CPUs
    if (envWorkers === 0) {
      const totalMemGB = os.totalmem() / (1024 ** 3);
      const workersBasedOnMemory = Math.floor(totalMemGB / 0.5); // 512MB per worker
      return Math.min(cpuCount, workersBasedOnMemory, maxWorkers);
    }
    
    return Math.min(envWorkers, cpuCount, maxWorkers);
  }

  setupProcessHandlers() {
    // Handle uncaught exceptions in primary
    process.on('uncaughtException', (error) => {
      this.logError('Uncaught Exception in Primary', error);
      this.emergencyShutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logError('Unhandled Rejection in Primary', { reason, promise });
    });

    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
    process.on('SIGHUP', () => this.handleReload());
    
    // Handle warnings
    process.on('warning', (warning) => {
      console.warn('⚠️  Process Warning:', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack,
      });
    });
  }

  logInfo(message, data = {}) {
    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      pid: process.pid,
      message,
      ...data,
    };
    console.log(JSON.stringify(logData));
  }

  logError(message, error) {
    const timestamp = new Date().toISOString();
    console.error(JSON.stringify({
      timestamp,
      pid: process.pid,
      level: 'error',
      message,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        code: error.code,
      } : error,
    }));
  }

  initializeWorkerStats(workerId) {
    this.workerStats.set(workerId, {
      id: workerId,
      pid: null,
      startTime: Date.now(),
      restarts: 0,
      lastRestart: null,
      crashes: [],
      healthy: true,
      lastHealthCheck: Date.now(),
      memoryUsage: {},
      cpuUsage: {},
    });
  }

  recordWorkerCrash(workerId, code, signal) {
    const stats = this.workerStats.get(workerId);
    if (stats) {
      stats.crashes.push({
        timestamp: Date.now(),
        code,
        signal,
      });

      // Keep only last 10 crashes
      if (stats.crashes.length > 10) {
        stats.crashes.shift();
      }
    }
  }

  shouldRestartWorker(workerId) {
    const stats = this.workerStats.get(workerId);
    if (!stats) return true;

    const recentRestarts = stats.crashes.filter(
      crash => Date.now() - crash.timestamp < this.restartWindow
    ).length;

    if (recentRestarts >= this.maxRestarts) {
      this.logError(`Worker ${workerId} exceeded max restart limit`, {
        recentRestarts,
        maxRestarts: this.maxRestarts,
        window: this.restartWindow,
      });
      return false;
    }

    return true;
  }

  forkWorker() {
    const worker = cluster.fork();
    const workerId = worker.id;

    this.workers.set(workerId, worker);
    this.initializeWorkerStats(workerId);

    worker.on('message', (msg) => this.handleWorkerMessage(worker, msg));
    
    worker.on('online', () => {
      this.logInfo(`✅ Worker ${workerId} (PID: ${worker.process.pid}) is online`);
      const stats = this.workerStats.get(workerId);
      if (stats) {
        stats.pid = worker.process.pid;
        stats.healthy = true;
      }
    });

    worker.on('exit', (code, signal) => {
      this.handleWorkerExit(worker, code, signal);
    });

    worker.on('error', (error) => {
      this.logError(`Worker ${workerId} error`, error);
    });

    return worker;
  }

  handleWorkerMessage(worker, message) {
    if (!message || typeof message !== 'object') return;

    switch (message.type) {
      case 'health':
        this.updateWorkerHealth(worker.id, message.data);
        break;
      
      case 'metrics':
        this.updateWorkerMetrics(worker.id, message.data);
        break;
      
      case 'shutdown-complete':
        this.logInfo(`Worker ${worker.id} completed graceful shutdown`);
        break;
      
      case 'error':
        this.logError(`Worker ${worker.id} reported error`, message.data);
        break;

      default:
        this.logInfo(`Unknown message from worker ${worker.id}`, message);
    }
  }

  updateWorkerHealth(workerId, healthData) {
    const stats = this.workerStats.get(workerId);
    if (stats) {
      stats.healthy = healthData.healthy !== false;
      stats.lastHealthCheck = Date.now();
      stats.memoryUsage = healthData.memory || {};
      stats.cpuUsage = healthData.cpu || {};
    }
  }

  updateWorkerMetrics(workerId, metricsData) {
    const stats = this.workerStats.get(workerId);
    if (stats) {
      stats.metrics = metricsData;
    }
  }

  handleWorkerExit(worker, code, signal) {
    const workerId = worker.id;
    
    this.logInfo(`⚠️  Worker ${workerId} (PID: ${worker.process.pid}) died`, {
      code,
      signal,
      exitedAfterDisconnect: worker.exitedAfterDisconnect,
    });

    this.workers.delete(workerId);
    this.recordWorkerCrash(workerId, code, signal);

    // Don't restart if shutting down or if it was an intentional disconnect
    if (this.isShuttingDown || worker.exitedAfterDisconnect) {
      return;
    }

    // Check if we should restart
    if (this.shouldRestartWorker(workerId)) {
      this.logInfo(`🔄 Restarting worker ${workerId}...`);
      
      // Delay restart slightly to avoid rapid crash loops
      setTimeout(() => {
        if (!this.isShuttingDown) {
          this.forkWorker();
        }
      }, 1000);
    } else {
      this.logError(`Worker ${workerId} will not be restarted (crash limit exceeded)`);
      
      // If we have no workers left, perform emergency shutdown
      if (this.workers.size === 0) {
        this.logError('All workers have crashed. Initiating emergency shutdown.');
        this.emergencyShutdown();
      }
    }
  }

  startHealthMonitoring() {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.healthCheckInterval);
  }

  performHealthChecks() {
    const now = Date.now();
    
    for (const [workerId, stats] of this.workerStats.entries()) {
      const worker = this.workers.get(workerId);
      
      if (!worker) continue;

      // Check if worker is responsive
      const timeSinceLastCheck = now - stats.lastHealthCheck;
      
      if (timeSinceLastCheck > this.healthCheckInterval * 2) {
        this.logError(`Worker ${workerId} appears unresponsive`, {
          timeSinceLastCheck,
          lastHealthCheck: new Date(stats.lastHealthCheck).toISOString(),
        });
        
        // Kill and restart unresponsive worker
        this.restartWorker(worker);
      } else {
        // Request health status
        worker.send({ type: 'health-check' });
      }

      // Check memory usage
      const heapUsedMB = (stats.memoryUsage.heapUsed || 0) / (1024 ** 2);
      const heapTotalMB = (stats.memoryUsage.heapTotal || 0) / (1024 ** 2);
      
      if (heapUsedMB > 0 && heapTotalMB > 0) {
        const memoryUsagePercent = (heapUsedMB / heapTotalMB) * 100;
        
        if (memoryUsagePercent > 95) {
          this.logError(`Worker ${workerId} high memory usage`, {
            heapUsedMB: heapUsedMB.toFixed(2),
            heapTotalMB: heapTotalMB.toFixed(2),
            percentage: memoryUsagePercent.toFixed(2),
          });
        }
      }
    }
  }

  restartWorker(worker) {
    this.logInfo(`Restarting worker ${worker.id}...`);
    
    // Fork new worker before killing old one (zero-downtime restart)
    const newWorker = this.forkWorker();
    
    // Wait for new worker to be online
    newWorker.once('online', () => {
      // Gracefully disconnect old worker
      worker.disconnect();
      
      // Force kill if not exited within timeout
      setTimeout(() => {
        if (!worker.isDead()) {
          this.logInfo(`Force killing worker ${worker.id}`);
          worker.kill('SIGKILL');
        }
      }, 10000);
    });
  }

  async handleReload() {
    this.logInfo('🔄 Received SIGHUP - performing zero-downtime reload');
    
    const workers = Array.from(this.workers.values());
    
    for (const worker of workers) {
      await new Promise((resolve) => {
        const newWorker = this.forkWorker();
        
        newWorker.once('online', () => {
          worker.disconnect();
          setTimeout(resolve, 1000);
        });
      });
    }
    
    this.logInfo('✅ Zero-downtime reload completed');
  }

  async gracefulShutdown(signal) {
    if (this.isShuttingDown) {
      this.logInfo('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    this.logInfo(`\n${signal} received. Starting graceful shutdown of cluster...`);

    // Stop health monitoring
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    const shutdownPromises = [];

    // Send shutdown signal to all workers
    for (const [workerId, worker] of this.workers.entries()) {
      this.logInfo(`Shutting down worker ${workerId}...`);
      
      const shutdownPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => {
          this.logInfo(`Force killing worker ${workerId} (timeout)`);
          worker.kill('SIGKILL');
          resolve();
        }, this.shutdownTimeout);

        worker.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });

        worker.send({ type: 'shutdown' });
        worker.disconnect();
      });

      shutdownPromises.push(shutdownPromise);
    }

    // Wait for all workers to exit
    await Promise.all(shutdownPromises);

    this.logInfo('🔌 All workers shut down');
    this.printShutdownStats();
    
    process.exit(0);
  }

  emergencyShutdown() {
    this.logError('⚠️  EMERGENCY SHUTDOWN INITIATED');
    
    for (const worker of this.workers.values()) {
      try {
        worker.kill('SIGKILL');
      } catch (error) {
        this.logError('Error killing worker during emergency shutdown', error);
      }
    }
    
    process.exit(1);
  }

  printStartupBanner() {
    const uptime = Date.now() - this.startTime;
    
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🚀 ALTUVERA CLUSTER MANAGER - PRIMARY PROCESS               ║
║                                                                ║
║   Environment:       ${this.config.isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}                                 ║
║   Primary PID:       ${String(process.pid).padEnd(43)}║
║   Workers:           ${String(this.config.numWorkers).padEnd(43)}║
║   CPUs Available:    ${String(os.cpus().length).padEnd(43)}║
║   Total Memory:      ${(os.totalmem() / (1024 ** 3)).toFixed(2)}GB${' '.padEnd(38)}║
║   Free Memory:       ${(os.freemem() / (1024 ** 3)).toFixed(2)}GB${' '.padEnd(38)}║
║   Node Version:      ${process.version.padEnd(43)}║
║   Platform:          ${process.platform} (${os.arch()})${' '.padEnd(35 - process.platform.length - os.arch().length)}║
║   Startup Time:      ${uptime}ms${' '.padEnd(43 - String(uptime).length - 2)}║
║                                                                ║
║   Health Monitoring: ${this.healthCheckInterval / 1000}s intervals${' '.padEnd(35 - String(this.healthCheckInterval / 1000).length - 11)}║
║   Max Restarts:      ${this.maxRestarts} per ${this.restartWindow / 1000}s window${' '.padEnd(34 - String(this.maxRestarts).length - String(this.restartWindow / 1000).length - 10)}║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
    `);
  }

  printShutdownStats() {
    const totalUptime = Date.now() - this.startTime;
    const stats = Array.from(this.workerStats.values());
    const totalCrashes = stats.reduce((sum, s) => sum + s.crashes.length, 0);
    
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   CLUSTER SHUTDOWN STATISTICS                                  ║
║                                                                ║
║   Total Uptime:      ${(totalUptime / 1000).toFixed(2)}s${' '.padEnd(38 - String((totalUptime / 1000).toFixed(2)).length - 1)}║
║   Workers Managed:   ${this.workerStats.size.toString().padEnd(43)}║
║   Total Crashes:     ${totalCrashes.toString().padEnd(43)}║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
    `);
  }

  start() {
    if (!this.config.enableClustering || !this.config.isProduction) {
      this.logInfo('Clustering disabled - starting single process');
      require('./src/app');
      return;
    }

    this.printStartupBanner();

    // Fork workers
    for (let i = 0; i < this.config.numWorkers; i++) {
      this.forkWorker();
    }

    // Start health monitoring
    this.startHealthMonitoring();

    // Log cluster status periodically
    setInterval(() => {
      this.logClusterStatus();
    }, 300000); // Every 5 minutes
  }

  logClusterStatus() {
    const stats = {
      workers: this.workers.size,
      healthy: Array.from(this.workerStats.values()).filter(s => s.healthy).length,
      totalCrashes: Array.from(this.workerStats.values()).reduce((sum, s) => sum + s.crashes.length, 0),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };

    this.logInfo('Cluster Status', stats);
  }
}

/**
 * Worker Process Manager
 */
class WorkerProcess {
  constructor() {
    this.app = null;
    this.server = null;
    this.db = null;
    this.isShuttingDown = false;
    this.healthCheckInterval = null;

    this.setupProcessHandlers();
    this.setupIPCHandlers();
  }

  setupProcessHandlers() {
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception in Worker:', error);
      this.notifyPrimary('error', { type: 'uncaughtException', error: error.message });
      this.emergencyShutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection in Worker:', reason);
      this.notifyPrimary('error', { type: 'unhandledRejection', reason });
    });
  }

  setupIPCHandlers() {
    process.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'shutdown':
          this.gracefulShutdown('PRIMARY_REQUEST');
          break;
        
        case 'health-check':
          this.sendHealthStatus();
          break;
        
        default:
          console.log('Unknown message from primary:', msg);
      }
    });
  }

  notifyPrimary(type, data) {
    try {
      process.send({ type, data });
    } catch (error) {
      console.error('Failed to send message to primary:', error);
    }
  }

  sendHealthStatus() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    this.notifyPrimary('health', {
      healthy: !this.isShuttingDown,
      memory: memUsage,
      cpu: cpuUsage,
      uptime: process.uptime(),
      pid: process.pid,
    });
  }

  startHealthReporting() {
    this.healthCheckInterval = setInterval(() => {
      this.sendHealthStatus();
    }, 15000); // Report every 15 seconds
  }

  async start() {
    try {
      // Import app
      this.app = require('./src/app');
      
      // Import database
      const { db } = require('./src/config/database');
      this.db = db;

      const PORT = process.env.PORT || 5000;
      const HOST = process.env.HOST || '0.0.0.0';

      // Test database connection with retry
      let retries = 3;
      while (retries > 0) {
        try {
          await this.db.raw('SELECT 1');
          console.log('✅ PostgreSQL connected successfully');
          break;
        } catch (error) {
          retries--;
          if (retries === 0) throw error;
          console.log(`Database connection failed, retrying... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Start server
      this.server = this.app.listen(PORT, HOST, () => {
        console.log(
          `🚀 Worker ${process.pid} running in ${process.env.NODE_ENV || 'development'} mode on ${HOST}:${PORT}`
        );
        
        // Start health reporting
        this.startHealthReporting();
        
        // Notify primary
        this.notifyPrimary('ready', { pid: process.pid, port: PORT });
      });

      // Server error handling
      this.server.on('error', (error) => {
        console.error('Server error:', error);
        this.notifyPrimary('error', { type: 'serverError', error: error.message });
      });

      // Set timeouts
      this.server.timeout = 30000;
      this.server.keepAliveTimeout = 65000;
      this.server.headersTimeout = 66000;

    } catch (error) {
      console.error('❌ Failed to start worker:', error.message);
      this.notifyPrimary('error', { type: 'startupError', error: error.message });
      process.exit(1);
    }
  }

  async gracefulShutdown(signal) {
    if (this.isShuttingDown) {
      console.log('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    console.log(`\n${signal} received. Worker ${process.pid} shutting down gracefully...`);

    // Stop health reporting
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    const shutdownTimeout = setTimeout(() => {
      console.error('⚠️  Forced shutdown due to timeout');
      process.exit(1);
    }, 25000);

    try {
      // Stop accepting new connections
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(resolve);
        });
        console.log('🔌 HTTP server closed');
      }

      // Close database connections
      if (this.db) {
        await this.db.destroy();
        console.log('🔌 Database connections closed');
      }

      clearTimeout(shutdownTimeout);
      this.notifyPrimary('shutdown-complete', { pid: process.pid });
      
      console.log('✅ Worker shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  }

  emergencyShutdown() {
    console.error('⚠️  EMERGENCY SHUTDOWN');
    process.exit(1);
  }
}

// Main execution
if (cluster.isPrimary) {
  const manager = new ClusterManager();
  manager.start();
} else {
  const worker = new WorkerProcess();
  worker.start();
}

module.exports = cluster.isPrimary ? cluster : null;