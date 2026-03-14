/**
 * middleware/auth.js
 */

const jwt = require("jsonwebtoken");
const { query } = require("../config/db");

// ═══════════════════════════════════════════════════
// Protect routes - verify JWT
// ═══════════════════════════════════════════════════
exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized. No token provided.",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Determine table based on token type
    const isAdmin = decoded.type === "admin" || decoded.role === "admin";
    const table = isAdmin ? "admin_users" : "users";
    
    const result = await query(`SELECT * FROM ${table} WHERE id = $1`, [decoded.id]);

    // Enforce token invalidation via token version
    const tokenVersionFromToken =
      decoded.tokenVersion ?? decoded.token_version ?? decoded.tv ?? null;

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "User not found.",
      });
    }

    const entity = result.rows[0];

    if (entity.is_active === false) {
      return res.status(401).json({
        success: false,
        message: "Account has been deactivated.",
      });
    }

    // Token version check (logout / token invalidation)
    const currentTokenVersion =
      entity.token_version ?? entity.tokenVersion ?? 0;
    if (
      tokenVersionFromToken !== null &&
      currentTokenVersion !== null &&
      tokenVersionFromToken !== currentTokenVersion
    ) {
      return res.status(401).json({
        success: false,
        message: "Session invalidated. Please sign in again.",
      });
    }

    req.user = entity;
    req.userType = isAdmin ? "admin" : "user";
    
    next();
  } catch (err) {
    const message = err.name === "TokenExpiredError" 
      ? "Token expired. Please login again." 
      : "Not authorized. Invalid token.";
      
    return res.status(401).json({
      success: false,
      message,
    });
  }
};

// ═══════════════════════════════════════════════════
// Admin only middleware
// ═══════════════════════════════════════════════════
exports.adminOnly = (req, res, next) => {
  if (req.userType === "admin" || req.user?.role === "admin" || req.user?.username) {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges required.",
    });
  }
};

// ═══════════════════════════════════════════════════
// Optional: Role-based access
// ═══════════════════════════════════════════════════
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user?.role}' is not authorized.`,
      });
    }
    next();
  };
};