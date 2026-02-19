'use strict';

const cluster = require('cluster');
const os = require('os');
const dotenv = require('dotenv');

dotenv.config();

const numCPUs = Math.min(os.cpus().length, parseInt(process.env.CLUSTER_WORKERS || '4', 10));
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && cluster.isPrimary) {
  console.log(`🚀 Primary process ${process.pid} is running`);
  console.log(`🔄 Forking ${numCPUs} workers...`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`⚠️ Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork();
  });

  cluster.on('online', (worker) => {
    console.log(`✅ Worker ${worker.process.pid} is online`);
  });
} else {
  const app = require('./src/app');
  const { db } = require('./src/config/database');

  const PORT = process.env.PORT || 5000;

  const startServer = async () => {
    try {
      // Test database connection
      await db.raw('SELECT 1');
      console.log('✅ PostgreSQL connected successfully');

      const server = app.listen(PORT, () => {
        console.log(
          `🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT} (PID: ${process.pid})`
        );
      });

      // Graceful shutdown
      const gracefulShutdown = async (signal) => {
        console.log(`\n${signal} received. Starting graceful shutdown...`);

        server.close(async () => {
          console.log('🔌 HTTP server closed');

          try {
            await db.destroy();
            console.log('🔌 Database connections closed');
          } catch (err) {
            console.error('Error closing database:', err);
          }

          process.exit(0);
        });

        // Force close after 30 seconds
        setTimeout(() => {
          console.error('⚠️ Forcefully shutting down');
          process.exit(1);
        }, 30000);
      };

      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));
      process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      });
      process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        gracefulShutdown('UNCAUGHT_EXCEPTION');
      });
    } catch (error) {
      console.error('❌ Failed to start server:', error.message);
      process.exit(1);
    }
  };

  startServer();
}