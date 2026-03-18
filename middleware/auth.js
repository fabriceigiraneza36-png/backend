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
  return res.status(403).json({ success: false, message: "Admin access required." });
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

module.exports = { protect, adminOnly, optionalAuth };