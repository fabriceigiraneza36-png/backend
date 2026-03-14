const logger = require("./logger");
const monitor = require("./monitor");

module.exports = (server, database) => {
  const shutdown = async (signal) => {
    logger.info(
      `\x1b[33m${signal} received. Starting graceful shutdown...\x1b[0m`,
    );

    server.close(async () => {
      logger.info("HTTP server closed");

      try {
        if (database && database.close) {
          await database.close();
          logger.info("Database connection closed");
        }

        monitor.cleanup();
        logger.info("Graceful shutdown complete");
        process.exit(0);
      } catch (err) {
        logger.error("Error during shutdown:", err);
        process.exit(1);
      }
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};
