// src/middleware/rateLimiter.middleware.js
const rateLimit = require('express-rate-limit');
const ApiResponse = require('../utils/response');
const env = require('../config/env');

/**
 * Create a rate limiter with custom options
 */
const createRateLimiter = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || env.rateLimit.windowMs,
    max: options.max || env.rateLimit.maxRequests,
    message: { 
      success: false, 
      message: 'Too many requests, please try again later' 
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise IP
      return req.user?.id || req.ip;
    },
    skip: (req) => {
      // Skip rate limiting for admins
      return req.user?.role === 'admin' || req.user?.role === 'super_admin';
    },
    handler: (req, res) => {
      return ApiResponse.error(res, 'Too many requests, please try again later', 429);
    },
    ...options,
  });
};

// Standard rate limiter
const standardLimiter = createRateLimiter();

// Strict limiter for auth endpoints
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { success: false, message: 'Too many authentication attempts' },
});

// API limiter for general API calls
const apiLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
});

// Strict limiter for sensitive operations
const strictLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
});

module.exports = {
  createRateLimiter,
  standardLimiter,
  authLimiter,
  apiLimiter,
  strictLimiter,
};