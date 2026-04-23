// middleware/auth.js
const jwt = require("jsonwebtoken");
const { query } = require("../config/db");

const extractToken = (req) => {
  const h = req.headers.authorization;
  return h && h.startsWith("Bearer ") ? h.slice(7) : null;
};

const protect = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ success: false, message: "Authentication required." });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const msg = err.name === "TokenExpiredError" ? "Session expired." : "Invalid token.";
      return res.status(401).json({ success: false, message: msg });
    }

    const table = decoded.type === "admin" ? "admin_users" : "users";
    const result = await query(`SELECT * FROM ${table} WHERE id = $1`, [decoded.id]);
    if (result.rows.length === 0) return res.status(401).json({ success: false, message: "Account not found." });

    const user = result.rows[0];
    if (!user.is_active) return res.status(401).json({ success: false, message: "Account deactivated." });
    if (decoded.tokenVersion !== undefined && user.token_version !== undefined && decoded.tokenVersion !== user.token_version)
      return res.status(401).json({ success: false, message: "Session invalidated." });

    req.user = user;
    req.userType = decoded.type === "admin" ? "admin" : "user";
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: "Authentication error." });
  }
};

const adminOnly = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Authentication required." });
  const role = req.user.role || "";
  if (req.userType === "admin" || role === "admin" || role === "super_admin") return next();
  return res.status(403).json({ success: false, message: "Admin privileges required." });
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return next();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const table = decoded.type === "admin" ? "admin_users" : "users";
    const result = await query(`SELECT * FROM ${table} WHERE id=$1`, [decoded.id]);
    if (result.rows.length > 0 && result.rows[0].is_active) {
      req.user = result.rows[0];
      req.userType = decoded.type === "admin" ? "admin" : "user";
    }
  } catch {}
  next();
};

// ═══════════════════════════════════════════════════════════════════════════════
// WEBAUTHN JWT MIDDLEWARE (NEW)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * WebAuthn-specific JWT authentication middleware
 * Used for /auth/webauthn routes
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    const token = authHeader.slice(7);

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      const msg =
        error.name === "TokenExpiredError"
          ? "Token has expired"
          : "Invalid token";
      return res.status(401).json({ success: false, message: msg });
    }

    // Check if session is revoked
    const session = await query(
      `SELECT * FROM webauthn_sessions 
       WHERE token_jti = $1 AND user_id = $2`,
      [decoded.jti, decoded.sub]
    );

    if (session.rows.length === 0) {
      return res.status(401).json({ success: false, message: "Session not found" });
    }

    const sessionRecord = session.rows[0];

    if (sessionRecord.revoked) {
      return res.status(401).json({ success: false, message: "Session has been revoked" });
    }

    if (new Date(sessionRecord.expires_at) < new Date()) {
      return res.status(401).json({ success: false, message: "Session has expired" });
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
    return res.status(500).json({ success: false, message: "Authentication failed" });
  }
};

module.exports = { protect, adminOnly, optionalAuth, authMiddleware };