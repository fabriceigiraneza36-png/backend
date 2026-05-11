/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA TRAVEL - AUTH MIDDLEWARE
 * Supports: user JWT, admin JWT, optional auth, admin-only, self-or-admin
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const jwt    = require('jsonwebtoken');
const { query } = require('../config/db');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER — Extract Bearer token
// ═══════════════════════════════════════════════════════════════════════════════

const extractToken = (req) => {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7).trim();
  if (req.cookies?.token)            return req.cookies.token;
  return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER — Verify JWT, throw structured error on failure
// ═══════════════════════════════════════════════════════════════════════════════

const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    const error     = new Error(isExpired ? 'Session expired.' : 'Invalid token.');
    error.statusCode = 401;
    error.code       = isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    throw error;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER — Fetch user or admin from DB based on decoded token
// ═══════════════════════════════════════════════════════════════════════════════

const fetchUserFromToken = async (decoded) => {
  const isAdmin = decoded.type === 'admin';
  const table   = isAdmin ? 'admin_users' : 'users';

  const result = await query(`SELECT * FROM ${table} WHERE id = $1`, [decoded.id]);

  if (!result.rows[0]) {
    const error = new Error('Account not found.');
    error.statusCode = 401;
    error.code       = 'USER_NOT_FOUND';
    throw error;
  }

  const user = result.rows[0];

  if (!user.is_active) {
    const error = new Error('Account deactivated.');
    error.statusCode = 401;
    error.code       = 'ACCOUNT_DEACTIVATED';
    throw error;
  }

  // Token version check — only when both sides have numeric version
  const dv = decoded.tokenVersion;
  const sv = user.token_version;
  if (typeof dv === 'number' && typeof sv === 'number' && dv !== sv) {
    const error = new Error('Session invalidated. Please log in again.');
    error.statusCode = 401;
    error.code       = 'TOKEN_INVALIDATED';
    throw error;
  }

  return { user, isAdmin };
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER — Attach decoded user to req (shared by protect + adminOnly + adminProtect)
// ═══════════════════════════════════════════════════════════════════════════════

const attachUser = async (req, token) => {
  const decoded             = verifyToken(token);
  const { user, isAdmin }   = await fetchUserFromToken(decoded);

  req.user     = user;
  req.userType = isAdmin ? 'admin' : 'user';
  if (isAdmin) {
    req.admin    = user;
    req.adminUser = user;
  }
  return { user, isAdmin };
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: protect
// Requires a valid JWT (user OR admin). Sets req.user, req.userType.
// Admin tokens also set req.admin + req.adminUser.
// ═══════════════════════════════════════════════════════════════════════════════

const protect = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
        code:    'NO_TOKEN',
      });
    }

    await attachUser(req, token);

    logger.debug('[Auth] protect — authenticated', {
      userId:   req.user.id,
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
// Can be used standalone OR after protect.
// Accepts admin_users token OR users with role admin/superadmin.
// Sets req.admin + req.adminUser for downstream controllers.
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
          code:    'NO_TOKEN',
        });
      }
      await attachUser(req, token);
    }

    const role    = req.user.role || '';
    const isAdmin =
      req.userType === 'admin' ||
      role === 'admin'         ||
      role === 'superadmin'    ||
      role === 'super_admin'   ||
      role === 'moderator'     ||
      role === 'editor';

    if (!isAdmin) {
      logger.warn('[Auth] adminOnly — access denied', {
        userId:   req.user.id,
        role,
        userType: req.userType,
        path:     req.path,
      });
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required.',
        code:    'FORBIDDEN',
      });
    }

    if (!req.admin)     req.admin     = req.user;
    if (!req.adminUser) req.adminUser = req.user;

    logger.debug('[Auth] adminOnly — admin authenticated', {
      adminId:  req.user.id,
      role,
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
// MIDDLEWARE: adminProtect
// Strict admin-only guard — only accepts tokens with type === 'admin'.
// Looks up admin_users table. Sets req.adminUser + req.admin.
// Used by message controller and other strict-admin routes.
// ═══════════════════════════════════════════════════════════════════════════════

const adminProtect = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Admin token required.',
        code:    'NO_TOKEN',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: err.name === 'TokenExpiredError'
          ? 'Session expired.'
          : 'Invalid token.',
        code: err.name === 'TokenExpiredError'
          ? 'TOKEN_EXPIRED'
          : 'INVALID_TOKEN',
      });
    }

    if (decoded.type !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required.',
        code:    'FORBIDDEN',
      });
    }

    const result = await query(
      `SELECT * FROM admin_users WHERE id = $1 AND is_active = true`,
      [decoded.id],
    );

    if (!result.rows[0]) {
      return res.status(401).json({
        success: false,
        message: 'Admin account not found or deactivated.',
        code:    'USER_NOT_FOUND',
      });
    }

    const admin     = result.rows[0];
    req.admin       = admin;
    req.adminUser   = admin;
    req.user        = admin;
    req.userType    = 'admin';

    logger.debug('[Auth] adminProtect — admin verified', {
      adminId: admin.id,
      role:    admin.role,
      path:    req.path,
    });

    next();
  } catch (err) {
    logger.error('[Auth] adminProtect — error', { error: err.message });
    return res.status(500).json({
      success: false,
      message: 'Authentication failed.',
      code:    'AUTH_ERROR',
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: optionalAuth
// Never blocks. Silently attaches req.user if token valid, else req.user = null.
// Admin tokens also populate req.admin + req.adminUser.
// ═══════════════════════════════════════════════════════════════════════════════

const optionalAuth = async (req, res, next) => {
  req.user      = null;
  req.userType  = null;
  req.admin     = null;
  req.adminUser = null;

  try {
    const token = extractToken(req);
    if (!token) return next();

    await attachUser(req, token);

    logger.debug('[Auth] optionalAuth — user attached', {
      userId:   req.user.id,
      userType: req.userType,
      path:     req.path,
    });
  } catch (err) {
    // Silent fail
    req.user      = null;
    req.userType  = null;
    req.admin     = null;
    req.adminUser = null;
  }

  next();
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
      code:    'NO_TOKEN',
    });
  }
  if (!req.user.is_verified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification required.',
      code:    'EMAIL_NOT_VERIFIED',
    });
  }
  next();
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: selfOrAdmin
// Must be used AFTER protect.
// Allows a user to access only their own resource, or any admin to access any.
// Usage: router.get('/:id', protect, selfOrAdmin('id'), controller)
// ═══════════════════════════════════════════════════════════════════════════════

const selfOrAdmin = (paramKey = 'id') => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
      code:    'NO_TOKEN',
    });
  }

  const targetId = parseInt(req.params[paramKey], 10);
  const role     = req.user.role || '';
  const isAdmin  =
    req.userType === 'admin' ||
    role === 'admin'         ||
    role === 'superadmin'    ||
    role === 'super_admin';

  if (!isAdmin && req.user.id !== targetId) {
    return res.status(403).json({
      success: false,
      message: 'Access denied.',
      code:    'FORBIDDEN',
    });
  }

  next();
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  protect,
  adminOnly,
  adminProtect,
  optionalAuth,
  requireVerified,
  selfOrAdmin,
  // Aliases used by legacy controllers
  extractToken,
  verifyToken,
};