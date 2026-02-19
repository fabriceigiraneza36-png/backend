// src/config/constants.js
module.exports = {
  // User Roles
  ROLES: {
    USER: 'user',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin',
  },
  
  // Subscription Status
  SUBSCRIPTION_STATUS: {
    ACTIVE: 'active',
    CANCELED: 'canceled',
    EXPIRED: 'expired',
    TRIAL: 'trial',
    PAST_DUE: 'past_due',
    PAUSED: 'paused',
  },
  
  // Payment Status
  PAYMENT_STATUS: {
    PENDING: 'pending',
    COMPLETED: 'completed',
    FAILED: 'failed',
    REFUNDED: 'refunded',
  },
  
  // Plan Intervals
  PLAN_INTERVALS: {
    MONTHLY: 'monthly',
    YEARLY: 'yearly',
    LIFETIME: 'lifetime',
  },
  
  // Session Types
  SESSION_TYPES: {
    ACCESS: 'access',
    REFRESH: 'refresh',
    MAGIC_LINK: 'magic_link',
    PASSWORD_RESET: 'password_reset',
  },
  
  // Analytics Events
  EVENTS: {
    USER_REGISTERED: 'user_registered',
    USER_LOGIN: 'user_login',
    SUBSCRIPTION_CREATED: 'subscription_created',
    SUBSCRIPTION_CANCELED: 'subscription_canceled',
    PAYMENT_COMPLETED: 'payment_completed',
    PAGE_VIEW: 'page_view',
  },
  
  // Pagination
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  
  // Cache TTL (in seconds)
  CACHE_TTL: {
    SHORT: 60,
    MEDIUM: 300,
    LONG: 3600,
    DAY: 86400,
  },
};