/**
 * ALTUVERA Route Checker
 */

class RouteChecker {
  constructor(app, config) {
    this.app = app;
    this.config = config;
    this.routes = [];
  }

  extractRoutes() {
    const routes = [];
    
    const processStack = (stack, basePath = "") => {
      if (!stack) return;
      
      stack.forEach((layer) => {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods);
          methods.forEach((method) => {
            routes.push({
              method: method.toUpperCase(),
              path: basePath + layer.route.path,
              middleware: layer.route.stack?.map(s => s.name).filter(n => n && n !== "<anonymous>") || [],
            });
          });
        } else if (layer.name === "router" && layer.handle?.stack) {
          let routerPath = "";
          if (layer.regexp) {
            routerPath = layer.regexp.source
              .replace("^\\", "")
              .replace("\\/?(?=\\/|$)", "")
              .replace(/\\\//g, "/")
              .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ":param");
          }
          processStack(layer.handle.stack, basePath + routerPath);
        }
      });
    };
    
    if (this.app._router?.stack) {
      processStack(this.app._router.stack);
    }
    
    this.routes = routes;
    return routes;
  }

  async checkAllRoutes() {
    this.extractRoutes();
    
    const routeCategories = {
      api: [],
      system: [],
      static: [],
    };
    
    this.routes.forEach((route) => {
      if (route.path.includes("/system") || route.path.includes("/health") || route.path.includes("/monitor")) {
        routeCategories.system.push(route);
      } else if (route.path.startsWith("/api")) {
        routeCategories.api.push(route);
      } else {
        routeCategories.static.push(route);
      }
    });
    
    const apiByResource = {};
    routeCategories.api.forEach((route) => {
      const parts = route.path.split("/").filter(Boolean);
      const resource = parts[1] || "root";
      if (!apiByResource[resource]) {
        apiByResource[resource] = [];
      }
      apiByResource[resource].push(route);
    });
    
    return {
      timestamp: new Date().toISOString(),
      server: this.config?.name || "ALTUVERA",
      summary: {
        totalRoutes: this.routes.length,
        apiRoutes: routeCategories.api.length,
        systemRoutes: routeCategories.system.length,
        resources: Object.keys(apiByResource).length,
      },
      categories: {
        api: {
          count: routeCategories.api.length,
          byResource: Object.fromEntries(
            Object.entries(apiByResource).map(([key, routes]) => [
              key,
              {
                count: routes.length,
                endpoints: routes.map(r => ({
                  method: r.method,
                  path: r.path,
                  protected: r.middleware?.includes("authenticate") || false,
                })),
              },
            ])
          ),
        },
        system: {
          count: routeCategories.system.length,
          endpoints: routeCategories.system.map(r => ({
            method: r.method,
            path: r.path,
          })),
        },
      },
      allRoutes: this.routes.map(r => ({
        method: r.method,
        path: r.path,
        protected: r.middleware?.includes("authenticate") || false,
      })),
    };
  }
}

module.exports = RouteChecker;