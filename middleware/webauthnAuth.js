/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * JWT AUTHENTICATION MIDDLEWARE
 * ═══════════════════════════════════════════════════════════════════════════════
 * Validates JWT tokens and attaches user info to request
 */

const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

/**
 * Middleware to verify JWT token
 * Attaches user information to req.user
 */
exports.authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new AppError('No token provided', 401));
    }

    const token = authHeader.slice(7);

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return next(new AppError('Token has expired', 401));
      }
      if (error.name === 'JsonWebTokenError') {
        return next(new AppError('Invalid token', 401));
      }
      throw error;
    }

    // Check if session is revoked
    const session = await query(
      `SELECT * FROM webauthn_sessions 
       WHERE token_jti = $1 AND user_id = $2`,
      [decoded.jti, decoded.sub]
    );

    if (session.rows.length === 0) {
      return next(new AppError('Session not found', 401));
    }

    const sessionRecord = session.rows[0];

    if (sessionRecord.revoked) {
      return next(new AppError('Session has been revoked', 401));
    }

    if (new Date(sessionRecord.expires_at) < new Date()) {
      return next(new AppError('Session has expired', 401));
    }

    // Attach user info to request
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      jti: decoded.jti,
      iat: decoded.iat,
      exp: decoded.exp,
    };

    next();
  } catch (error) {
    logger.error('Authentication middleware error', { error });
    next(new AppError('Authentication failed', 500));
  }
};

/**
 * Optional middleware - doesn't fail if no token, but sets req.user if valid
 */
exports.optionalAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice(7);

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      // Invalid token, just skip
      return next();
    }

    // Check if session exists and is valid
    const session = await query(
      `SELECT * FROM webauthn_sessions 
       WHERE token_jti = $1 AND user_id = $2 
       AND revoked = false 
       AND expires_at > NOW()`,
      [decoded.jti, decoded.sub]
    );

    if (session.rows.length > 0) {
      req.user = {
        id: decoded.sub,
        email: decoded.email,
        jti: decoded.jti,
      };
    }

    next();
  } catch (error) {
    logger.error('Optional auth middleware error', { error });
    next();
  }
};

/**
 * Admin-only middleware (can be extended)
 */
exports.adminMiddleware = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }

  // Add admin check logic here if needed
  next();
};
