/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA TRAVEL - ENTERPRISE BACKEND SERVER v6.1
 * "True Adventures In High Places & Deep Culture"
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require("dotenv").config({ path: require("path").resolve(process.cwd(), ".env") });
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const { query, ensureContactSchema } = require("./config/db");
const logger = require("./utils/logger");
const swaggerUi = require("swagger-ui-express");
const shutdown = require("./utils/shutdown");

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
const adminAuthRouter = require("./routes/adminAuth");
const webauthnRouter = require("./routes/webauthn");
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
const { cacheMiddleware } = require("./middleware/cache");

// ═══════════════════════════════════════════════════════════════════════════════
// APP CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

// Trust proxy
app.set("trust proxy", 1);

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY & CORS
// ═══════════════════════════════════════════════════════════════════════════════

// Security headers with Google OAuth support
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false, // ✅ Critical for Google OAuth
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Enhanced CORS with Google OAuth popup support
app.use((req, res, next) => {
  // ✅ Allow Google OAuth popups
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});

// CORS configuration
const envOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(o => o.trim())
  : [];

const allowedOrigins = [
  process.env.FRONTEND_URL,
  ...envOrigins,
  "https://altuvera.com",
  "https://www.altuvera.com",
  "https://altuvera.vercel.app",
  ...(NODE_ENV === "development" ? [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174"
  ] : [])
].filter(Boolean);

// ─── Replace corsOptions in server.js ──────────────────────────────────────

const corsOptions = {
  origin: (origin, callback) => {
    // ✅ Always allow - no origin means server-to-server or same origin
    if (!origin) return callback(null, true);

    // ✅ Always allow any localhost port in development
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // ✅ Always allow any localhost 127.0.0.1
    if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // ✅ Check allowed list
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }

    // ✅ Log but DON'T return 500 - return CORS error instead
    console.warn(`[CORS] Origin not in allowed list: ${origin}`);
    // In development, allow anyway to prevent 500 errors
    if (process.env.NODE_ENV !== "production") {
      return callback(null, true);
    }
    
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "X-CSRF-Token",
    "Cache-Control",
  ],
  exposedHeaders: ["X-Total-Count", "X-Page", "X-Per-Page"],
  optionsSuccessStatus: 200,
  maxAge: 86400,
};

// ✅ Apply CORS - must be BEFORE all routes
app.use(cors(corsOptions));

// ✅ Handle OPTIONS preflight for ALL routes
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-Requested-With,Accept,Origin"
  );
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Max-Age", "86400");
  res.sendStatus(200);
});
app.use(cors(corsOptions));

// Handle preflight requests
app.options("*", cors(corsOptions));

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cacheMiddleware(120));
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
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

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
  const routes = collectRoutes(app._router.stack);
  const docs = {
    total: routes.length,
    byMethod: {},
    byCategory: {},
    routes
  };
  routes.forEach((route) => {
    docs.byMethod[route.method] = (docs.byMethod[route.method] || 0) + 1;
    docs.byCategory[route.category] = (docs.byCategory[route.category] || 0) + 1;
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
        "401": { description: "Unauthorized" },
        "404": { description: "Not found" }
      },
      security: route.auth === "public" ? [] : [{ bearerAuth: [] }]
    };
  });
  return {
    openapi: "3.0.1",
    info: {
      title: "Altuvera Travel API",
      version: "6.1",
      description: "Interactive API documentation for Altuvera Travel backend"
    },
    servers: [{ url: process.env.BACKEND_URL || `http://localhost:${PORT}` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" }
      }
    },
    paths
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// API INFO ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV
  });
});

app.get("/api", (req, res) => {
  res.json({
    success: true,
    name: "Altuvera Travel API",
    version: "6.1",
    tagline: "True Adventures In High Places & Deep Culture",
    endpoints: {
      health: "/health",
      docs: "/api/docs",
      routes: "/api/routes"
    }
  });
});

app.get("/api/routes", (req, res) => {
  const docs = generateApiDocs();
  res.json({
    success: true,
    total: docs.total,
    byMethod: docs.byMethod,
    routes: docs.routes
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MOUNT ALL ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.use("/api/users", usersRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/countries", countriesRouter);
app.use("/api/country-likes", countryLikesRouter);
app.use("/api/country-comments", countryCommentsRouter);
app.use("/api/country-ratings", countryRatingsRouter);
app.use("/api/destinations", destinationsRouter);
app.use("/api/destination-likes", destinationLikesRouter);
app.use("/api/destination-comments", destinationCommentsRouter);
app.use("/api/destination-ratings", destinationRatingsRouter);
app.use("/api/posts", postsRouter);
app.use("/api/contact", contactRouter);
app.use("/api/gallery", galleryRouter);
app.use("/api/team", teamRouter);
app.use("/api/faqs", faqsRouter);
app.use("/api/services", servicesRouter);
app.use("/api/tips", tipsRouter);
app.use("/api/virtual-tours", virtualToursRouter);
app.use("/api/subscribers", subscribersRouter);
app.use("/api/pages", pagesRouter);
app.use("/api/message", messageRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/media", mediaUploadsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/admin/auth", adminAuthRouter);
app.use("/auth/webauthn", webauthnRouter);

// Swagger docs
const swaggerSpec = buildOpenApiSpec();
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
app.get("/api/docs/openapi.json", (req, res) => res.json(swaggerSpec));

logger.info("✅ All routes mounted successfully");

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

app.use(notFoundHandler);
app.use(errorHandler);

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

async function initializeServer() {
  try {
    logger.info("🔄 Testing database connection...");
    await query("SELECT NOW()");
    logger.info("✅ Database connected");

    await ensureContactSchema();
    logger.info("✅ Contact schema ensured");

    const server = app.listen(PORT, () => {
      console.log("\n");
      logger.info("═══════════════════════════════════════════════════════════════════");
      logger.info("🌍 ALTUVERA TRAVEL - Enterprise Backend v6.1");
      logger.info('   "True Adventures In High Places & Deep Culture"');
      logger.info("═══════════════════════════════════════════════════════════════════");
      logger.info(`Environment: ${NODE_ENV}`);
      logger.info(`Port: ${PORT}`);
      logger.info(`Backend: ${process.env.BACKEND_URL || `http://localhost:${PORT}`}`);
      logger.info(`Frontend: ${process.env.FRONTEND_URL}`);
      logger.info(`CORS Origins: ${allowedOrigins.join(", ")}`);
      logger.info("═══════════════════════════════════════════════════════════════════");
      console.log("\n");
    });

    shutdown(server);
    return server;
  } catch (error) {
    logger.error("❌ Server initialization failed:", error);
    process.exit(1);
  }
}

initializeServer();

module.exports = app;