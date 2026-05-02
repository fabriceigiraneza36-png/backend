/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA TRAVEL - AUTH MIDDLEWARE
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Extract Bearer token from Authorization header
// ═══════════════════════════════════════════════════════════════════════════════

const extractToken = (req) => {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  // Fallback: cookie (optional)
  if (req.cookies?.token) return req.cookies.token;
  return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Decode and verify JWT — throws structured error on failure
// ═══════════════════════════════════════════════════════════════════════════════

const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    const error = new Error(
      err.name === 'TokenExpiredError' ? 'Session expired.' : 'Invalid token.'
    );
    error.statusCode = 401;
    error.code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    throw error;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Fetch user/admin from DB based on decoded token type
// ═══════════════════════════════════════════════════════════════════════════════

const fetchUserFromToken = async (decoded) => {
  // Determine which table to query
  const isAdmin = decoded.type === 'admin';
  const table   = isAdmin ? 'admin_users' : 'users';

  const result = await query(
    `SELECT * FROM ${table} WHERE id = $1`,
    [decoded.id]
  );

  if (result.rows.length === 0) {
    const error = new Error('Account not found.');
    error.statusCode = 401;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  const user = result.rows[0];

  // Check account is active
  if (!user.is_active) {
    const error = new Error('Account deactivated.');
    error.statusCode = 401;
    error.code = 'ACCOUNT_DEACTIVATED';
    throw error;
  }

  // Token version check — only enforced when BOTH sides have a defined numeric version
  const decodedVersion = decoded.tokenVersion;
  const storedVersion  = user.token_version;

  if (
    typeof decodedVersion === 'number' &&
    typeof storedVersion  === 'number' &&
    decodedVersion !== storedVersion
  ) {
    const error = new Error('Session invalidated. Please log in again.');
    error.statusCode = 401;
    error.code = 'TOKEN_INVALIDATED';
    throw error;
  }

  return { user, isAdmin };
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: protect
// Requires a valid JWT. Sets req.user and req.userType.
// Used for all authenticated user AND admin routes.
// ═══════════════════════════════════════════════════════════════════════════════

const protect = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
        code: 'NO_TOKEN',
      });
    }

    const decoded = verifyToken(token);
    const { user, isAdmin } = await fetchUserFromToken(decoded);

    // Always set req.user — this is what all downstream controllers depend on
    req.user     = user;
    req.userType = isAdmin ? 'admin' : 'user';

    // Also set req.admin for admin routes that reference req.admin
    if (isAdmin) {
      req.admin = user;
    }

    logger.debug('[Auth] protect — user authenticated', {
      userId:   user.id,
      userType: req.userType,
      path:     req.path,
    });

    next();
  } catch (err) {
    logger.warn('[Auth] protect — failed', {
      error: err.message,
      code:  err.code,
      path:  req.path,
      ip:    req.ip,
    });

    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Authentication error.',
      code:    err.code    || 'AUTH_ERROR',
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: adminOnly
// Must be used AFTER protect, OR can be used standalone (calls protect logic).
// Accepts: admin_users table type OR users with admin/superadmin role.
// Sets req.admin for downstream admin controllers.
// ═══════════════════════════════════════════════════════════════════════════════

const adminOnly = async (req, res, next) => {
  try {
    // If protect already ran, req.user is set — skip re-fetching
    if (!req.user) {
      const token = extractToken(req);

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required.',
          code: 'NO_TOKEN',
        });
      }

      const decoded = verifyToken(token);
      const { user, isAdmin } = await fetchUserFromToken(decoded);

      req.user     = user;
      req.userType = isAdmin ? 'admin' : 'user';

      if (isAdmin) req.admin = user;
    }

    // Check admin privileges
    const role    = req.user.role || '';
    const isAdmin =
      req.userType === 'admin'    ||
      role === 'admin'            ||
      role === 'superadmin'       ||
      role === 'super_admin';

    if (!isAdmin) {
      logger.warn('[Auth] adminOnly — access denied', {
        userId:   req.user.id,
        role:     role,
        userType: req.userType,
        path:     req.path,
      });

      return res.status(403).json({
        success: false,
        message: 'Admin privileges required.',
        code: 'FORBIDDEN',
      });
    }

    // Ensure req.admin is set for controllers that reference req.admin
    if (!req.admin) {
      req.admin = req.user;
    }

    logger.debug('[Auth] adminOnly — admin authenticated', {
      adminId:  req.user.id,
      role:     role,
      userType: req.userType,
      path:     req.path,
    });

    next();
  } catch (err) {
    logger.warn('[Auth] adminOnly — failed', {
      error: err.message,
      code:  err.code,
      path:  req.path,
    });

    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Authentication error.',
      code:    err.code    || 'AUTH_ERROR',
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: optionalAuth
// Never blocks the request. Silently attaches req.user if token is valid.
// Sets req.user = null if no token or invalid token.
// ═══════════════════════════════════════════════════════════════════════════════

const optionalAuth = async (req, res, next) => {
  // Default: no user
  req.user     = null;
  req.userType = null;

  try {
    const token = extractToken(req);
    if (!token) return next();

    const decoded = verifyToken(token);
    const { user, isAdmin } = await fetchUserFromToken(decoded);

    req.user     = user;
    req.userType = isAdmin ? 'admin' : 'user';

    if (isAdmin) req.admin = user;

    logger.debug('[Auth] optionalAuth — user attached', {
      userId:   user.id,
      userType: req.userType,
      path:     req.path,
    });
  } catch (err) {
    // Silent fail — optional auth never blocks
    logger.debug('[Auth] optionalAuth — no valid user attached', {
      reason: err.message,
      path:   req.path,
    });

    req.user     = null;
    req.userType = null;
  }

  next();
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: authMiddleware (WebAuthn / session-based)
// Used for WebAuthn routes that require a session record in webauthn_sessions.
// Sets req.user with decoded JWT payload — does NOT fetch from users table.
// ═══════════════════════════════════════════════════════════════════════════════

const authMiddleware = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided.',
        code: 'NO_TOKEN',
      });
    }

    const decoded = verifyToken(token);

    // Validate against webauthn_sessions table
    const sessionResult = await query(
      `SELECT * FROM webauthn_sessions 
       WHERE token_jti = $1 
         AND user_id   = $2`,
      [decoded.jti, decoded.sub]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Session not found.',
        code: 'SESSION_NOT_FOUND',
      });
    }

    const session = sessionResult.rows[0];

    if (session.revoked) {
      return res.status(401).json({
        success: false,
        message: 'Session has been revoked.',
        code: 'SESSION_REVOKED',
      });
    }

    if (new Date(session.expires_at) < new Date()) {
      return res.status(401).json({
        success: false,
        message: 'Session has expired.',
        code: 'SESSION_EXPIRED',
      });
    }

    // Set minimal req.user from JWT payload (no DB user fetch needed here)
    req.user = {
      id:    decoded.sub,
      email: decoded.email,
      jti:   decoded.jti,
      iat:   decoded.iat,
      exp:   decoded.exp,
    };

    logger.debug('[Auth] authMiddleware — WebAuthn session valid', {
      userId: decoded.sub,
      jti:    decoded.jti,
      path:   req.path,
    });

    next();
  } catch (err) {
    logger.warn('[Auth] authMiddleware — failed', {
      error: err.message,
      code:  err.code,
      path:  req.path,
    });

    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Authentication failed.',
      code:    err.code    || 'AUTH_ERROR',
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: requireVerified
// Must be used AFTER protect. Blocks unverified email accounts.
// ═══════════════════════════════════════════════════════════════════════════════

const requireVerified = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
      code: 'NO_TOKEN',
    });
  }

  if (!req.user.is_verified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification required.',
      code: 'EMAIL_NOT_VERIFIED',
    });
  }

  next();
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: selfOrAdmin
// Must be used AFTER protect.
// Allows a user to access only their own resource, or admin to access any.
// Usage: router.get('/:id', protect, selfOrAdmin('id'), controller)
// ═══════════════════════════════════════════════════════════════════════════════

const selfOrAdmin = (paramKey = 'id') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
        code: 'NO_TOKEN',
      });
    }

    const targetId = parseInt(req.params[paramKey], 10);
    const role     = req.user.role || '';
    const isAdmin  =
      req.userType === 'admin' ||
      role === 'admin'         ||
      role === 'superadmin'    ||
      role === 'super_admin';

    const isSelf = req.user.id === targetId;

    if (!isAdmin && !isSelf) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
        code: 'FORBIDDEN',
      });
    }

    next();
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  protect,
  adminOnly,
  optionalAuth,
  authMiddleware,
  requireVerified,
  selfOrAdmin,
};