/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA TRAVEL - ENTERPRISE BACKEND SERVER v6.0
 * "True Adventures In High Places & Deep Culture"
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require("dotenv").config();
const path = require("path");

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const { query, ensureContactSchema } = require("./config/db");
const logger = require("./utils/logger");
const swaggerUi = require("swagger-ui-express");
const shutdown = require("./utils/shutdown");
const AppError = require("./utils/AppError");

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════

const usersRouter = require("./routes/users");
const bookingsRouter = require("./routes/bookings");
const countriesRouter = require("./routes/countries");
const destinationsRouter = require("./routes/destinations");
const postsRouter = require("./routes/posts");
const contactRouter = require("./routes/contact");
const galleryRouter = require("./routes/gallery");
const teamRouter = require("./routes/team");
const faqsRouter = require("./routes/faqs");
const servicesRouter = require("./routes/services");
const tipsRouter = require("./routes/tips");
const virtualToursRouter = require("./routes/virtualTours");
const subscribersRouter = require("./routes/subscribers");
const settingsRouter = require("./routes/settings");
const messageRouter = require("./routes/message");
const pagesRouter = require("./routes/pages");
const uploadsRouter = require("./routes/uploads");
const mediaUploadsRouter = require("./routes/mediaUploads");

// Social auth routes
const adminAuthRouter = require("./routes/adminAuth");

// WebAuthn authentication routes
const webauthnRouter = require("./routes/webauthn");

// Like/Comment/Rating routes
const countryLikesRouter = require("./routes/countryLikes");
const countryCommentsRouter = require("./routes/countryComments");
const countryRatingsRouter = require("./routes/countryRatings");
const destinationLikesRouter = require("./routes/destinationLikes");
const destinationCommentsRouter = require("./routes/destinationComments");
const destinationRatingsRouter = require("./routes/destinationRatings");

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════

const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");
const { rateLimiter } = require("./middleware/rateLimiter");
const { securityHeaders } = require("./middleware/security");
const { cacheMiddleware } = require("./middleware/cache");

// ═══════════════════════════════════════════════════════════════════════════════
// APP CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

// Trust proxy (for rate limiting behind reverse proxy)
app.set("trust proxy", 1);
const cleanRoutePath = (path) => {
  if (!path) return "";
  return path
    .replace(/\\/g, "")
    .replace(/\/+$/, "")
    .replace(/\/\//g, "/")
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ":param")
    .replace(/\(\[\^\\\/\]\+\?\)/g, ":param")
    .replace(/\^/, "")
    .replace(/\$\/i$/, "")
    .replace(/\$$/, "")
    .replace(/\(\?=\/\|\$\)/g, "");
};

const collectRoutes = (stack, prefix = "") => {
  const routes = [];

  stack.forEach((layer) => {
    if (layer.route && layer.route.path) {
      const routePath = cleanRoutePath(prefix + layer.route.path);
      const methods = Object.keys(layer.route.methods).map((method) => method.toUpperCase());

      methods.forEach((method) => {
        routes.push({
          method,
          path: routePath || "/",
          auth: "public",
          category: "general",
          description: layer.route.stack?.[0]?.name || `${method} ${routePath}`
        });
      });
    } else if (layer.name === "router" && layer.handle && layer.handle.stack) {
      const nestedPrefix = cleanRoutePath(layer.regexp?.source ? layer.regexp.source : "");
      routes.push(...collectRoutes(layer.handle.stack, prefix + nestedPrefix));
    }
  });

  return routes;
};

const generateApiDocs = () => {
  const routes = collectRoutes(app._router.stack).map((route) => ({
    method: route.method,
    path: route.path,
    auth: route.auth,
    category: route.category,
    description: route.description
  }));

  const docs = {
    total: routes.length,
    byMethod: {},
    byCategory: {},
    byAuth: { public: [], protected: [], admin: [] },
    routes
  };

  routes.forEach((route) => {
    docs.byMethod[route.method] = (docs.byMethod[route.method] || 0) + 1;
    docs.byCategory[route.category] = (docs.byCategory[route.category] || 0) + 1;
    docs.byAuth[route.auth] = docs.byAuth[route.auth] || [];
    docs.byAuth[route.auth].push(`${route.method} ${route.path}`);
  });

  return docs;
};

const buildOpenApiSpec = () => {
  const docs = generateApiDocs();
  const paths = {};

  docs.routes.forEach((route) => {
    paths[route.path] = paths[route.path] || {};
    paths[route.path][route.method.toLowerCase()] = {
      summary: route.description,
      tags: [route.category],
      responses: {
        "200": { description: "Successful response" },
        "400": { description: "Bad request" },
        "401": { description: "Authentication required" },
        "404": { description: "Resource not found" }
      },
      security: route.auth === "public" ? [] : [{ bearerAuth: [] }]
    };
  });

  return {
    openapi: "3.0.1",
    info: {
      title: "Altuvera Travel API",
      version: "6.0",
      description: "Interactive API documentation for the Altuvera Travel backend"
    },
    servers: [{ url: process.env.BACKEND_URL || `http://localhost:${PORT}` }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      }
    },
    paths
  };
};
// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
const envOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(o => o.trim())
  : [];

const allowedOrigins = [
  process.env.FRONTEND_URL,
  ...envOrigins,
  "https://altuvera.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174" // ✅ your current frontend
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests without origin (like Postman, curl, mobile apps)
    if (!origin) return callback(null, true);

    // Allow any localhost in development
    if (origin.startsWith("http://localhost")) {
      return callback(null, true);
    }

    // Exact match check (safe & reliable)
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Block everything else
    return callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin"
  ]
};

app.use(cors(corsOptions));
// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cacheMiddleware(120));

// Static files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Logging
if (NODE_ENV === "production") {
  app.use(morgan("combined", {
    stream: { write: message => logger.http(message.trim()) }
  }));
} else {
  app.use(morgan("dev", {
    skip: (req) => req.url === "/health"
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// API INFO ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV
  });
});

// API info
app.get("/api", (req, res) => {
  res.json({
    success: true,
    name: "Altuvera Travel API",
    version: "6.0",
    tagline: "True Adventures In High Places & Deep Culture",
    endpoints: {
      health: "/health",
      docs: "/api/docs",
      routes: "/api/routes"
    },
    documentation: {
      baseUrl: process.env.BACKEND_URL || `http://localhost:${PORT}`,
      authType: "JWT with OTP verification",
      rateLimit: "100 requests per 15 minutes"
    }
  });
});

// API Routes list
app.get("/api/routes", (req, res) => {
  const docs = generateApiDocs();
  res.json({
    success: true,
    total: docs.total,
    byMethod: docs.byMethod,
    byCategory: docs.byCategory,
    routes: docs.routes.map((r) => ({
      method: r.method,
      path: r.path,
      auth: r.auth,
      category: r.category,
      description: r.description
    }))
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MOUNT ALL ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Users & Authentication
app.use("/api/users", usersRouter);
logger.info("📋 Mounted: /api/users");

// Bookings
app.use("/api/bookings", bookingsRouter);
logger.info("📋 Mounted: /api/bookings");

// Countries
app.use("/api/countries", countriesRouter);
logger.info("📋 Mounted: /api/countries");

// Country interactions
app.use("/api/country-likes", countryLikesRouter);
app.use("/api/country-comments", countryCommentsRouter);
app.use("/api/country-ratings", countryRatingsRouter);
logger.info("📋 Mounted: /api/country-likes, /api/country-comments, /api/country-ratings");

// Destinations
app.use("/api/destinations", destinationsRouter);
logger.info("📋 Mounted: /api/destinations");

// Destination interactions
app.use("/api/destination-likes", destinationLikesRouter);
app.use("/api/destination-comments", destinationCommentsRouter);
app.use("/api/destination-ratings", destinationRatingsRouter);
logger.info("📋 Mounted: /api/destination-likes, /api/destination-comments, /api/destination-ratings");

// Posts/Blog
app.use("/api/posts", postsRouter);
logger.info("📋 Mounted: /api/posts");

// Contact
app.use("/api/contact", contactRouter);
logger.info("📋 Mounted: /api/contact");

// Gallery
app.use("/api/gallery", galleryRouter);
logger.info("📋 Mounted: /api/gallery");

// Team
app.use("/api/team", teamRouter);
logger.info("📋 Mounted: /api/team");

// FAQs
app.use("/api/faqs", faqsRouter);
logger.info("📋 Mounted: /api/faqs");

// Services
app.use("/api/services", servicesRouter);
logger.info("📋 Mounted: /api/services");

// Tips
app.use("/api/tips", tipsRouter);
logger.info("📋 Mounted: /api/tips");

// Virtual Tours
app.use("/api/virtual-tours", virtualToursRouter);
logger.info("📋 Mounted: /api/virtual-tours");

// Subscribers
app.use("/api/subscribers", subscribersRouter);
logger.info("📋 Mounted: /api/subscribers");

// Pages
app.use("/api/pages", pagesRouter);
logger.info("📋 Mounted: /api/pages");

// Message alias for contact
app.use("/api/message", messageRouter);
logger.info("📋 Mounted: /api/message");

// Uploads
app.use("/api/uploads", uploadsRouter);
logger.info("📋 Mounted: /api/uploads");

// Media Uploads (Images for destinations, gallery, countries)
app.use("/api/media", mediaUploadsRouter);
logger.info("📋 Mounted: /api/media");

// Settings
app.use("/api/settings", settingsRouter);
logger.info("📋 Mounted: /api/settings");

// Admin Auth
app.use("/api/admin/auth", adminAuthRouter);
logger.info("📋 Mounted: /api/admin/auth");

// WebAuthn Authentication
app.use("/auth/webauthn", webauthnRouter);
logger.info("📋 Mounted: /auth/webauthn");

const swaggerSpec = buildOpenApiSpec();
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
app.get("/api/docs/openapi.json", (req, res) => res.json(buildOpenApiSpec()));

// ═══════════════════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

// Handle 404
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

async function initializeServer() {
  try {
    // Test database connection
    logger.info("🔄 Testing database connection...");
    await query("SELECT NOW()");
    logger.info("✅ Database connection established");

    // Ensure contact messaging schema exists before serving traffic
    await ensureContactSchema();
    logger.info("✅ Contact messaging schema ensured");

    // Start server
    const server = app.listen(PORT, () => {
      console.log("\n");
      logger.info("═══════════════════════════════════════════════════════════════════");
      logger.info("🌍 ALTUVERA TRAVEL - Enterprise Backend Server v6.0");
      logger.info('   "True Adventures In High Places & Deep Culture"');
      logger.info("═══════════════════════════════════════════════════════════════════");
      logger.info(`Environment: ${NODE_ENV}`);
      logger.info(`Port: ${PORT}`);
      logger.info("═══════════════════════════════════════════════════════════════════");
      logger.info(`🌐 Backend URL: ${process.env.BACKEND_URL || `http://localhost:${PORT}`}`);
      logger.info(`🌐 Frontend URL: ${process.env.FRONTEND_URL}`);
      logger.info("═══════════════════════════════════════════════════════════════════");
      console.log("\n");
    });

    // Graceful shutdown
    shutdown(server);

    return server;
  } catch (error) {
    logger.error("❌ Server initialization failed:", error);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

initializeServer();

module.exports = app;
