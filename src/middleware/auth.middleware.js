// src/middleware/auth.middleware.js
const AuthService = require('../services/auth.service');
const ApiResponse = require('../utils/response');
const { ROLES } = require('../config/constants');

/**
 * Authenticate user via JWT token
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return ApiResponse.unauthorized(res, 'No token provided');
    }

    const token = authHeader.split(' ')[1];
    const { valid, user, decoded } = await AuthService.validateToken(token);

    if (!valid) {
      return ApiResponse.unauthorized(res, 'Invalid or expired token');
    }

    req.user = user;
    req.token = token;
    req.tokenData = decoded;
    
    next();
  } catch (error) {
    return ApiResponse.unauthorized(res, 'Authentication failed');
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { valid, user, decoded } = await AuthService.validateToken(token);
      
      if (valid) {
        req.user = user;
        req.token = token;
        req.tokenData = decoded;
      }
    }
    
    next();
  } catch (error) {
    next();
  }
};

/**
 * Check if user has required role
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return ApiResponse.unauthorized(res);
    }

    if (!roles.includes(req.user.role)) {
      return ApiResponse.forbidden(res, 'Insufficient permissions');
    }

    next();
  };
};

/**
 * Check if user is admin
 */
const requireAdmin = requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);

/**
 * Check if user is super admin
 */
const requireSuperAdmin = requireRole(ROLES.SUPER_ADMIN);

/**
 * Check if user has active subscription
 */
const requireSubscription = async (req, res, next) => {
  try {
    const SubscriptionService = require('../services/subscription.service');
    const { hasSubscription, isFreeTier } = await SubscriptionService.getUserSubscription(req.user.id);

    if (!hasSubscription && !isFreeTier) {
      return ApiResponse.forbidden(res, 'Active subscription required');
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Check feature access
 */
const requireFeature = (feature) => {
  return async (req, res, next) => {
    try {
      const SubscriptionService = require('../services/subscription.service');
      const hasAccess = await SubscriptionService.checkFeatureAccess(req.user.id, feature);

      if (!hasAccess) {
        return ApiResponse.forbidden(res, `Feature '${feature}' not available in your plan`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Check usage limit
 */
const checkUsageLimit = (limitKey) => {
  return async (req, res, next) => {
    try {
      const SubscriptionService = require('../services/subscription.service');
      const { allowed, limit, current, remaining } = await SubscriptionService.checkUsageLimit(
        req.user.id,
        limitKey
      );

      if (!allowed) {
        return ApiResponse.forbidden(res, `Usage limit reached for '${limitKey}'. Limit: ${limit}, Used: ${current}`);
      }

      req.usageInfo = { limit, current, remaining };
      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireSuperAdmin,
  requireSubscription,
  requireFeature,
  checkUsageLimit,
};