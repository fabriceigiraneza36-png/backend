/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALTUVERA TRAVEL - AUTH MIDDLEWARE v2.0
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * CRITICAL FIX:
 *   adminProtect previously queried admin_users table exclusively AND required
 *   decoded.type === 'admin'. If your admin tokens have role='admin' in the
 *   users table instead, every request was rejected with 403 → which the
 *   frontend's notFoundHandler then converted to 404.
 *
 *   New behaviour:
 *   - Accepts tokens where decoded.type === 'admin' (admin_users table)
 *   - OR decoded.role === 'admin' / 'superadmin' (users table)
 *   - Falls back gracefully if admin_users table doesn't exist
 *
 * Exports:
 *   protect         — valid JWT (user OR admin)
 *   adminOnly       — valid JWT with admin role/type
 *   adminProtect    — alias of adminOnly (backward compat)
 *   optionalAuth    — attaches user if token valid, never blocks
 *   requireVerified — must be called after protect
 *   selfOrAdmin     — factory: allows self-access or admin
 *   extractToken    — utility (used by socket auth)
 *   verifyToken     — utility (used by socket auth)
 */

"use strict";

const jwt    = require("jsonwebtoken");
const { query } = require("../config/db");
const logger = require("../utils/logger");

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const ADMIN_ROLES = new Set([
  "admin",
  "superadmin",
  "super_admin",
  "moderator",
  "editor",
]);

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract JWT from:
 *   1. Authorization: Bearer <token>  (primary)
 *   2. x-auth-token header            (legacy)
 *   3. Cookie: token=<token>          (cookie-based sessions)
 *   4. ?token= query param            (dev/debug only, never in production)
 */
const extractToken = (req) => {
  // Authorization header (most common)
  const authHeader =
    req.headers.authorization ||
    req.headers.Authorization ||
    "";

  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim() || null;
  }

  // x-auth-token header (some older clients)
  if (req.headers["x-auth-token"]) {
    return String(req.headers["x-auth-token"]).trim() || null;
  }

  // Cookie (cookie-based sessions)
  if (req.cookies?.token) {
    return String(req.cookies.token).trim() || null;
  }
  if (req.cookies?.adminToken) {
    return String(req.cookies.adminToken).trim() || null;
  }

  // Query param — development only
  if (process.env.NODE_ENV !== "production" && req.query?.token) {
    return String(req.query.token).trim() || null;
  }

  return null;
};

/**
 * Verify a JWT and return the decoded payload.
 * Returns null instead of throwing so callers can decide how to respond.
 */
const verifyToken = (token) => {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
};

/**
 * Determine whether a decoded JWT payload belongs to an admin.
 *
 * Handles all token shapes used across the codebase:
 *   { type: 'admin' }           — admin_users tokens
 *   { role: 'admin' }           — users table with admin role
 *   { role: 'superadmin' }      — superadmins
 *   { isAdmin: true }           — legacy tokens
 */
const isAdminDecoded = (decoded) => {
  if (!decoded) return false;
  if (decoded.type    === "admin") return true;
  if (decoded.isAdmin === true)    return true;
  if (decoded.role && ADMIN_ROLES.has(decoded.role)) return true;
  return false;
};

/**
 * Fetch the account record from the database.
 *
 * Strategy:
 *   1. If decoded.type === 'admin' → try admin_users first, then users as fallback
 *   2. Otherwise → query users table directly
 *
 * This handles cases where:
 *   - admin_users table doesn't exist yet
 *   - Admins are stored in the users table with role='admin'
 */
const fetchAccount = async (decoded) => {
  const id = decoded?.id;
  if (!id) return null;

  // ── Admin token path ──────────────────────────────────────────────────────
  if (decoded.type === "admin") {
    // Try admin_users table first
    try {
      const r = await query(
        `SELECT *, 'admin' AS resolved_type
           FROM admin_users
          WHERE id = $1 AND is_active = true`,
        [id],
      );
      if (r.rows[0]) return { record: r.rows[0], isAdmin: true };
    } catch (err) {
      // admin_users table may not exist — fall through to users table
      logger.warn(
        "[Auth] admin_users table not accessible, falling back to users table:",
        err.message,
      );
    }

    // Fallback: check users table for role=admin
    try {
      const r = await query(
        `SELECT * FROM users WHERE id = $1 AND is_active = true`,
        [id],
      );
      if (r.rows[0] && ADMIN_ROLES.has(r.rows[0].role)) {
        return { record: r.rows[0], isAdmin: true };
      }
      if (r.rows[0]) {
        return { record: r.rows[0], isAdmin: false };
      }
    } catch (err) {
      logger.warn("[Auth] fetchAccount users fallback failed:", err.message);
    }

    return null;
  }

  // ── User token path ───────────────────────────────────────────────────────
  try {
    const r = await query(
      `SELECT * FROM users WHERE id = $1 AND is_active = true`,
      [id],
    );
    if (!r.rows[0]) return null;

    const record  = r.rows[0];
    const isAdmin = ADMIN_ROLES.has(record.role) || decoded.isAdmin === true;
    return { record, isAdmin };
  } catch (err) {
    logger.error("[Auth] fetchAccount error:", err.message);
    return null;
  }
};

/**
 * Core auth logic — shared by protect, adminOnly, adminProtect.
 *
 * Returns { record, isAdmin } or responds with an appropriate error.
 * Returns null on error (caller should return early).
 */
const authenticate = async (req, res, { requireAdmin = false } = {}) => {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({
      success: false,
      message: requireAdmin ? "Admin authentication required." : "Authentication required.",
      code:    "NO_TOKEN",
    });
    return null;
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
      code:    "INVALID_TOKEN",
    });
    return null;
  }

  // Token version check (optional — only when both sides carry the version)
  // This is a soft check; skip if the field isn't present.
  // (Hydrated below after DB fetch)

  // Require admin at the token level first (fast-fail before DB hit)
  if (requireAdmin && !isAdminDecoded(decoded)) {
    logger.warn(
      `[Auth] Admin required but token is not admin | ` +
      `id=${decoded.id} role=${decoded.role} type=${decoded.type} ` +
      `path=${req.path}`,
    );
    res.status(403).json({
      success: false,
      message: "Admin privileges required.",
      code:    "FORBIDDEN",
    });
    return null;
  }

  const result = await fetchAccount(decoded);

  if (!result) {
    res.status(401).json({
      success: false,
      message: "Account not found or deactivated.",
      code:    "USER_NOT_FOUND",
    });
    return null;
  }

  const { record, isAdmin } = result;

  // Token version check (post-DB)
  if (
    typeof decoded.tokenVersion === "number" &&
    typeof record.token_version === "number" &&
    decoded.tokenVersion !== record.token_version
  ) {
    res.status(401).json({
      success: false,
      message: "Session invalidated. Please log in again.",
      code:    "TOKEN_INVALIDATED",
    });
    return null;
  }

  // Require admin at the record level (role in DB)
  if (requireAdmin && !isAdmin) {
    logger.warn(
      `[Auth] Admin required but user role=${record.role} | ` +
      `id=${record.id} path=${req.path}`,
    );
    res.status(403).json({
      success: false,
      message: "Admin privileges required.",
      code:    "FORBIDDEN",
    });
    return null;
  }

  return { record, isAdmin, decoded };
};

// ═══════════════════════════════════════════════════════════════════════════════
// ATTACH HELPERS  (populate req.user / req.admin consistently)
// ═══════════════════════════════════════════════════════════════════════════════

const attachToRequest = (req, record, isAdmin) => {
  req.user     = record;
  req.userType = isAdmin ? "admin" : "user";

  if (isAdmin) {
    req.admin     = record;
    req.adminUser = record;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: protect
// Requires a valid JWT (user OR admin).
// ═══════════════════════════════════════════════════════════════════════════════

const protect = async (req, res, next) => {
  try {
    const auth = await authenticate(req, res);
    if (!auth) return; // authenticate already sent the response

    const { record, isAdmin } = auth;
    attachToRequest(req, record, isAdmin);

    logger.debug("[Auth] protect ✓", {
      id:       record.id,
      userType: req.userType,
      path:     req.path,
    });

    next();
  } catch (err) {
    logger.error("[Auth] protect unexpected error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Authentication error.",
      code:    "AUTH_ERROR",
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: adminOnly
// Requires a valid JWT WITH admin role or type.
// Can be used standalone OR after protect (re-uses req.user if already set).
// ═══════════════════════════════════════════════════════════════════════════════

const adminOnly = async (req, res, next) => {
  try {
    // If protect already ran, validate the attached user's admin status
    if (req.user) {
      const role    = req.user.role || "";
      const isAdmin =
        req.userType === "admin" ||
        ADMIN_ROLES.has(role)    ||
        req.user.isAdmin === true;

      if (!isAdmin) {
        logger.warn("[Auth] adminOnly — access denied", {
          id:       req.user.id,
          role,
          userType: req.userType,
          path:     req.path,
        });
        return res.status(403).json({
          success: false,
          message: "Admin privileges required.",
          code:    "FORBIDDEN",
        });
      }

      // Ensure req.admin is populated
      if (!req.admin)     req.admin     = req.user;
      if (!req.adminUser) req.adminUser = req.user;
      req.userType = "admin";

      return next();
    }

    // protect hasn't run — authenticate from scratch
    const auth = await authenticate(req, res, { requireAdmin: true });
    if (!auth) return;

    const { record, isAdmin } = auth;
    attachToRequest(req, record, isAdmin);

    logger.debug("[Auth] adminOnly ✓", {
      id:   record.id,
      role: record.role,
      path: req.path,
    });

    next();
  } catch (err) {
    logger.error("[Auth] adminOnly unexpected error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Authentication error.",
      code:    "AUTH_ERROR",
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: adminProtect
// ─────────────────────────────────────────────────────────────────────────────
// Alias of adminOnly.
//
// Previously this was a stricter version that ONLY accepted decoded.type==='admin'
// and ONLY looked in admin_users. That caused 401/403 for admins stored in the
// users table. Now it behaves identically to adminOnly but logs the source.
// ═══════════════════════════════════════════════════════════════════════════════

const adminProtect = async (req, res, next) => {
  // Delegate entirely to adminOnly — same logic, same fallbacks
  return adminOnly(req, res, next);
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: optionalAuth
// Never blocks. Silently attaches req.user if token is valid.
// ═══════════════════════════════════════════════════════════════════════════════

const optionalAuth = async (req, res, next) => {
  // Reset to safe defaults
  req.user      = null;
  req.userType  = null;
  req.admin     = null;
  req.adminUser = null;

  try {
    const token = extractToken(req);
    if (!token) return next();

    const decoded = verifyToken(token);
    if (!decoded) return next();

    const result = await fetchAccount(decoded);
    if (!result) return next();

    attachToRequest(req, result.record, result.isAdmin);

    logger.debug("[Auth] optionalAuth — attached", {
      id:       result.record.id,
      userType: req.userType,
      path:     req.path,
    });
  } catch {
    // Silent — never block on optional auth
    req.user      = null;
    req.userType  = null;
    req.admin     = null;
    req.adminUser = null;
  }

  next();
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: requireVerified
// Must be used AFTER protect.
// ═══════════════════════════════════════════════════════════════════════════════

const requireVerified = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
      code:    "NO_TOKEN",
    });
  }
  if (!req.user.is_verified) {
    return res.status(403).json({
      success: false,
      message: "Email verification required.",
      code:    "EMAIL_NOT_VERIFIED",
    });
  }
  next();
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE FACTORY: selfOrAdmin
// Must be used AFTER protect.
// Allows a user to access only their own resource, or any admin to access any.
//
// Usage:
//   router.get('/:id', protect, selfOrAdmin('id'), controller)
// ═══════════════════════════════════════════════════════════════════════════════

const selfOrAdmin = (paramKey = "id") => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
      code:    "NO_TOKEN",
    });
  }

  const targetId = parseInt(req.params[paramKey], 10);
  const isAdmin  =
    req.userType === "admin" ||
    ADMIN_ROLES.has(req.user.role || "") ||
    req.user.isAdmin === true;

  if (!isAdmin && req.user.id !== targetId) {
    return res.status(403).json({
      success: false,
      message: "Access denied.",
      code:    "FORBIDDEN",
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
  adminProtect,     // alias — identical to adminOnly
  optionalAuth,
  requireVerified,
  selfOrAdmin,
  // Utilities (used by socket.io auth + adminAuth routes)
  extractToken,
  verifyToken,
  isAdminDecoded,
};