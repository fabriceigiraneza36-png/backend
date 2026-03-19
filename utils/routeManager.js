/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ROUTE MANAGER - Centralized Route Registry & Management
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require("./logger");

class RouteManager {
  constructor() {
    this.routes = {
      GET: [],
      POST: [],
      PUT: [],
      PATCH: [],
      DELETE: []
    };
    this.routeDetails = {};
  }

  /**
   * Register a new route
   */
  register(method, path, handler, options = {}) {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    
    const routeEntry = {
      method: normalizedMethod,
      path: normalizedPath,
      handler: handler.name || "anonymous",
      middleware: options.middleware || [],
      auth: options.auth || "public",
      description: options.description || "",
      category: options.category || "general"
    };

    this.routes[normalizedMethod].push({
      path: normalizedPath,
      handler: handler,
      middleware: options.middleware || [],
      auth: options.auth,
      description: options.description,
      category: options.category
    });

    // Store detailed info for documentation
    const routeKey = `${normalizedMethod}:${normalizedPath}`;
    this.routeDetails[routeKey] = routeEntry;

    return this;
  }

  /**
   * Register GET route
   */
  get(path, handler, options = {}) {
    return this.register("GET", path, handler, { ...options, method: "GET" });
  }

  /**
   * Register POST route
   */
  post(path, handler, options = {}) {
    return this.register("POST", path, handler, { ...options, method: "POST" });
  }

  /**
   * Register PUT route
   */
  put(path, handler, options = {}) {
    return this.register("PUT", path, handler, { ...options, method: "PUT" });
  }

  /**
   * Register PATCH route
   */
  patch(path, handler, options = {}) {
    return this.register("PATCH", path, handler, { ...options, method: "PATCH" });
  }

  /**
   * Register DELETE route
   */
  delete(path, handler, options = {}) {
    return this.register("DELETE", path, handler, { ...options, method: "DELETE" });
  }

  /**
   * Mount all routes to an Express router
   */
  mount(router) {
    for (const [method, routes] of Object.entries(this.routes)) {
      for (const route of routes) {
        try {
          const middlewares = route.middleware || [];
          router[method.toLowerCase()](route.path, ...middlewares, route.handler);
        } catch (err) {
          logger.error(`Failed to mount route ${method} ${route.path}:`, err.message);
        }
      }
    }
    return this;
  }

  /**
   * Get all routes as array
   */
  getAllRoutes() {
    const allRoutes = [];
    for (const [method, routes] of Object.entries(this.routes)) {
      for (const route of routes) {
        allRoutes.push({
          method,
          path: route.path,
          handler: route.handler?.name || "anonymous",
          auth: route.auth,
          category: route.category,
          description: route.description
        });
      }
    }
    return allRoutes;
  }

  /**
   * Get routes by category
   */
  getRoutesByCategory(category) {
    return this.getAllRoutes().filter(r => r.category === category);
  }

  /**
   * Get routes by auth type
   */
  getRoutesByAuth(authType) {
    return this.getAllRoutes().filter(r => r.auth === authType);
  }

  /**
   * Generate API documentation
   */
  generateDocs() {
    const routes = this.getAllRoutes();
    const docs = {
      total: routes.length,
      byMethod: {},
      byCategory: {},
      byAuth: { public: [], protected: [], admin: [] },
      routes: routes
    };

    // Count by method
    for (const route of routes) {
      docs.byMethod[route.method] = (docs.byMethod[route.method] || 0) + 1;
      docs.byCategory[route.category] = (docs.byCategory[route.category] || 0) + 1;
      docs.byAuth[route.auth] = docs.byAuth[route.auth] || [];
      docs.byAuth[route.auth].push(`${route.method} ${route.path}`);
    }

    return docs;
  }

  /**
   * Print routes to console
   */
  printRoutes() {
    const routes = this.getAllRoutes();
    console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
    console.log("║                    REGISTERED API ROUTES                        ║");
    console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

    const grouped = {};
    for (const route of routes) {
      if (!grouped[route.path]) {
        grouped[route.path] = [];
      }
      grouped[route.path].push(route.method);
    }

    for (const [path, methods] of Object.entries(grouped)) {
      const methodStr = methods.join(", ");
      const auth = routes.find(r => r.path === path)?.auth || "public";
      const authIcon = auth === "admin" ? "🔒" : auth === "protected" ? "🔑" : "🌐";
      console.log(`  ${authIcon} ${methodStr.padEnd(15)} ${path}`);
    }

    console.log(`\n  Total: ${routes.length} routes\n`);
  }

  /**
   * Check if route exists
   */
  routeExists(method, path) {
    const routeKey = `${method.toUpperCase()}:${path}`;
    return !!this.routeDetails[routeKey];
  }

  /**
   * Get route info
   */
  getRouteInfo(method, path) {
    const routeKey = `${method.toUpperCase()}:${path}`;
    return this.routeDetails[routeKey] || null;
  }
}

// Create singleton instance
const routeManager = new RouteManager();

module.exports = routeManager;
module.exports.RouteManager = RouteManager;
