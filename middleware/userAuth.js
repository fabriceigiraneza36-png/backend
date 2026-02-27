const jwt = require("jsonwebtoken");
const { query } = require("../config/db");

/**
 * Authenticate user from JWT token
 */
const authenticateUser = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ 
        success: false,
        error: "Authentication required" 
      });
    }

    const token = header.split(" ")[1];
    
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ 
          success: false,
          error: "Token expired",
          code: "TOKEN_EXPIRED"
        });
      }
      return res.status(401).json({ 
        success: false,
        error: "Invalid token" 
      });
    }

    // Ensure it's a user token, not admin
    if (decoded.type !== "user") {
      return res.status(401).json({ 
        success: false,
        error: "Invalid token type" 
      });
    }

    const result = await query(
      "SELECT id, email, full_name, avatar_url, is_verified, is_active FROM users WHERE id = $1",
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ 
        success: false,
        error: "User not found" 
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ 
        success: false,
        error: "Account deactivated" 
      });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Optional user auth - attach user if token present
 */
const optionalUserAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    
    if (header && header.startsWith("Bearer ")) {
      const token = header.split(" ")[1];
      
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.type === "user") {
          const result = await query(
            "SELECT id, email, full_name, avatar_url, is_verified FROM users WHERE id = $1 AND is_active = true",
            [decoded.id]
          );
          
          if (result.rows.length > 0) {
            req.user = result.rows[0];
          }
        }
      } catch (_) {
        // Token invalid, continue without user
      }
    }
    
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { authenticateUser, optionalUserAuth };