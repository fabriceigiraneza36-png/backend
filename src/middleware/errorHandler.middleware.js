// src/middleware/errorHandler.middleware.js
const logger = require('../utils/logger');
const ApiResponse = require('../utils/response');
const env = require('../config/env');

/**
 * Global error handler
 */
const errorHandler = (err, req, res, next) => {
  // Log the error
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body,
    userId: req.user?.id,
  });

  // Handle known errors
  if (err.status) {
    return ApiResponse.error(res, err.message, err.status, err.errors);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return ApiResponse.unauthorized(res, 'Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    return ApiResponse.unauthorized(res, 'Token expired');
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return ApiResponse.badRequest(res, 'Validation failed', err.details);
  }

  // Database errors
  if (err.code === '23505') { // Unique violation
    return ApiResponse.error(res, 'Duplicate entry', 409);
  }

  if (err.code === '23503') { // Foreign key violation
    return ApiResponse.badRequest(res, 'Referenced resource not found');
  }

  // Default to 500 internal server error
  const message = env.nodeEnv === 'production' 
    ? 'Internal server error' 
    : err.message;

  return ApiResponse.serverError(res, message);
};

/**
 * 404 Not Found handler
 */
const notFoundHandler = (req, res) => {
  return ApiResponse.notFound(res, `Route ${req.method} ${req.url} not found`);
};

module.exports = {
  errorHandler,
  notFoundHandler,
};