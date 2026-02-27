/**
 * ALTUVERA Security Middleware
 * Advanced security features and threat protection
 */

const rateLimit = require("express-rate-limit");
const logger = require("../utils/logger");

// Rate limiting configurations
const createRateLimiter = (options) => rateLimit({
  windowMs: options.windowMs || 15 * 60 * 1000,
  max: options.max || 100,
  message: {
    error: options.message || "Too many requests, please try again later.",
    retryAfter: Math.ceil((options.windowMs || 900000) / 1000),
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.headers["x-forwarded-for"] || "unknown";
  },
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit exceeded: ${req.ip} - ${req.path}`);
    res.status(429).json(options.message);
  },
});

// IP blacklist
const blacklistedIPs = new Set();

// Suspicious patterns for attack detection
const suspiciousPatterns = [
  /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
  /<script[^>]*>[\s\S]*?<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /\.\.\/|\.\.\\/, 
  /etc\/passwd/,
  /cmd\.exe|powershell/i,
];

// Main security middleware
const securityMiddleware = (monitor) => {
  return (req, res, next) => {
    // Check blacklisted IPs
    if (blacklistedIPs.has(req.ip)) {
      if (monitor && monitor.recordSecurityEvent) {
        monitor.recordSecurityEvent("BLACKLISTED_IP", { ip: req.ip, path: req.path });
      }
      return res.status(403).json({ error: "Access denied" });
    }
    
    // Check for suspicious patterns
    const checkString = JSON.stringify({
      url: req.url,
      query: req.query,
      body: req.body,
    });
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(checkString)) {
        if (monitor && monitor.recordSecurityEvent) {
          monitor.recordSecurityEvent("SUSPICIOUS_PATTERN", {
            ip: req.ip,
            path: req.path,
            pattern: pattern.toString(),
          });
        }
        logger.warn(`Suspicious pattern detected from ${req.ip}: ${req.path}`);
        break;
      }
    }
    
    // Check for common attack paths
    const attackPaths = [
      "/wp-admin", "/wp-login", "/xmlrpc.php",
      "/phpmyadmin", "/pma",
      "/.env", "/.git",
      "/admin/config", "/manager/html",
    ];
    
    if (attackPaths.some(path => req.path.toLowerCase().includes(path))) {
      if (monitor && monitor.recordSecurityEvent) {
        monitor.recordSecurityEvent("ATTACK_PATH_PROBE", {
          ip: req.ip,
          path: req.path,
        });
      }
      return res.status(404).json({ error: "Not found" });
    }
    
    // Add security headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    
    next();
  };
};

// Rate limiters
const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many API requests, please try again later.",
});

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts, please try again in 15 minutes.",
});

const contactLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many messages sent, please try again later.",
});

const uploadLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Too many uploads, please try again later.",
});

module.exports = {
  securityMiddleware,
  apiLimiter,
  authLimiter,
  contactLimiter,
  uploadLimiter,
  blacklistedIPs,
};