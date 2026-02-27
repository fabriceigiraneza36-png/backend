const jwt = require("jsonwebtoken");
const { query } = require("../config/db");

// Protect routes - require authenticated admin
exports.protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.split(" ")[1] : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Not authorized. Please log in.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type && decoded.type !== "admin") {
      return res.status(401).json({
        success: false,
        error: "Invalid token type.",
      });
    }

    const result = await query(
      `SELECT id, username, email, full_name, role, avatar_url, is_active
       FROM admin_users
       WHERE id = $1`,
      [decoded.id]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(401).json({
        success: false,
        error: "Admin user not found or inactive.",
      });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: "Invalid or expired token.",
    });
  }
};

// Alias for consistency
exports.authenticate = exports.protect;

// Authorize specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    const role = req.user?.role;
    const hasAccess = roles.includes(role) || role === "superadmin";

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: "You don't have permission to perform this action.",
      });
    }
    next();
  };
};
