const path = require("path");
const logger = require("./logger");

class RouteLoader {
  constructor(app) {
    this.app = app;
    this.loadedRoutes = [];
  }

  loadRoutes(routes) {
    logger.info("🚀 Loading routes...");
    routes.forEach((route) => {
      try {
        const routeModule = require(path.join(__dirname, "..", route.file));
        this.app.use(`/api${route.path}`, routeModule);
        this.loadedRoutes.push({ path: route.path, status: "loaded" });
        logger.info(`✅ Route mounted: /api${route.path}`);
      } catch (err) {
        logger.error(`❌ Failed to load route ${route.path}:`, err);
      }
    });
  }
}

module.exports = RouteLoader;
