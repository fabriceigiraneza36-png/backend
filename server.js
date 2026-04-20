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
const { query } = require("./config/db");
const logger = require("./utils/logger");
const routeManager = require("./utils/routeManager");
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

// Social auth routes
const adminAuthRouter = require("./routes/adminAuth");

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

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGINS,
      "https://altuvera.vercel.app",
      "http://localhost:3000",
      "http://localhost:5173"
    ].filter(Boolean);
    
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin || allowedOrigins.some(o => origin.includes(o?.replace(/https?:\/\//, '')))) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"]
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
  const docs = routeManager.generateDocs();
  res.json({
    success: true,
    total: docs.total,
    byMethod: docs.byMethod,
    byCategory: docs.byCategory,
    routes: docs.routes.map(r => ({
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

// Settings
app.use("/api/settings", settingsRouter);
logger.info("📋 Mounted: /api/settings");

// Admin Auth
app.use("/api/admin/auth", adminAuthRouter);
logger.info("📋 Mounted: /api/admin/auth");

// ═══════════════════════════════════════════════════════════════════════════════
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
