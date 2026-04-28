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
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const msg =
        err.name === "TokenExpiredError"
          ? "Session expired."
          : "Invalid token.";
      return res.status(401).json({ success: false, message: msg });
    }

    const table = decoded.type === "admin" ? "admin_users" : "users";
    const result = await query(
      `SELECT * FROM ${table} WHERE id = $1`,
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Account not found.",
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: "Account deactivated.",
      });
    }

    // ✅ FIX: Only check tokenVersion if BOTH exist AND are defined
    // This prevents "Session invalidated" on fresh logins where
    // token_version may differ due to logout increments
    if (
      decoded.tokenVersion !== undefined &&
      decoded.tokenVersion !== null &&
      user.token_version !== undefined &&
      user.token_version !== null &&
      decoded.tokenVersion !== user.token_version
    ) {
      return res.status(401).json({
        success: false,
        message: "Session invalidated. Please log in again.",
      });
    }

    req.user = user;
    req.userType = decoded.type === "admin" ? "admin" : "user";
    next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Authentication error.",
    });
  }
};

const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  const role = req.user.role || "";
  const isAdmin =
    req.userType === "admin" ||
    role === "admin" ||
    role === "superadmin" ||   // ✅ Added superadmin
    role === "super_admin";

  if (isAdmin) return next();

  return res.status(403).json({
    success: false,
    message: "Admin privileges required.",
  });
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const table = decoded.type === "admin" ? "admin_users" : "users";
    const result = await query(
      `SELECT * FROM ${table} WHERE id = $1`,
      [decoded.id]
    );

    if (result.rows.length > 0 && result.rows[0].is_active) {
      req.user = result.rows[0];
      req.userType = decoded.type === "admin" ? "admin" : "user";
    }
  } catch {
    // Silent fail for optional auth
  }
  next();
};

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
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

    const session = await query(
      `SELECT * FROM webauthn_sessions WHERE token_jti = $1 AND user_id = $2`,
      [decoded.jti, decoded.sub]
    );

    if (session.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Session not found",
      });
    }

    const sessionRecord = session.rows[0];

    if (sessionRecord.revoked) {
      return res.status(401).json({
        success: false,
        message: "Session has been revoked",
      });
    }

    if (new Date(sessionRecord.expires_at) < new Date()) {
      return res.status(401).json({
        success: false,
        message: "Session has expired",
      });
    }

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      jti: decoded.jti,
      iat: decoded.iat,
      exp: decoded.exp,
    };

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Authentication failed",
    });
  }
};

module.exports = { protect, adminOnly, optionalAuth, authMiddleware };