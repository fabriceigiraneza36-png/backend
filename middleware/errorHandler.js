const logger = require("../utils/logger");

class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const notFound = (req, res, next) => {
  const error = new AppError(`Resource not found: ${req.originalUrl}`, 404, "NOT_FOUND");
  next(error);
};

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let code = err.code || "INTERNAL_ERROR";
  let message = err.message || "An unexpected error occurred";
  
  if (statusCode >= 500) {
    logger.error(`Server Error: ${message}`, { 
      path: req.path, 
      method: req.method,
      stack: err.stack 
    });
  }
  
  // Handle specific errors
  if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    code = "INVALID_TOKEN";
    message = "Invalid authentication token";
  } else if (err.name === "TokenExpiredError") {
    statusCode = 401;
    code = "TOKEN_EXPIRED";
    message = "Authentication token has expired";
  } else if (err.code === "23505") {
    statusCode = 409;
    code = "DUPLICATE_ENTRY";
    message = "A record with this value already exists";
  } else if (err.code === "23503") {
    statusCode = 400;
    code = "INVALID_REFERENCE";
    message = "Referenced record does not exist";
  }
  
  const response = {
    success: false,
    error: {
      code,
      message: process.env.NODE_ENV === "production" && statusCode === 500 
        ? "An internal server error occurred" 
        : message,
    },
    meta: {
      requestId: req.id,
      timestamp: new Date().toISOString(),
      path: req.path,
    },
  };
  
  if (process.env.NODE_ENV === "development") {
    response.error.stack = err.stack;
  }
  
  res.status(statusCode).json(response);
};

module.exports = { AppError, notFound, errorHandler };