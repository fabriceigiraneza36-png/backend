// src/utils/helpers.js
const slugify = require('slugify');
const { addDays, addMonths, addYears, parseISO, format } = require('date-fns');

/**
 * Create a URL-friendly slug
 */
const createSlug = (text) => {
  return slugify(text, {
    lower: true,
    strict: true,
    trim: true,
  });
};

/**
 * Calculate subscription end date based on interval
 */
const calculateSubscriptionEndDate = (startDate, interval, intervalCount = 1) => {
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  
  switch (interval) {
    case 'daily':
      return addDays(start, intervalCount);
    case 'monthly':
      return addMonths(start, intervalCount);
    case 'yearly':
      return addYears(start, intervalCount);
    default:
      return addMonths(start, intervalCount);
  }
};

/**
 * Format date for display
 */
const formatDate = (date, formatString = 'yyyy-MM-dd HH:mm:ss') => {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, formatString);
};

/**
 * Parse duration string to milliseconds
 */
const parseDuration = (duration) => {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 0;
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  const multipliers = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000,
  };
  
  return value * multipliers[unit];
};

/**
 * Mask email address
 */
const maskEmail = (email) => {
  const [local, domain] = email.split('@');
  const maskedLocal = local.charAt(0) + '***' + local.charAt(local.length - 1);
  return `${maskedLocal}@${domain}`;
};

/**
 * Clean object by removing null/undefined values
 */
const cleanObject = (obj) => {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v != null)
  );
};

/**
 * Pick specific keys from object
 */
const pick = (obj, keys) => {
  return keys.reduce((acc, key) => {
    if (obj.hasOwnProperty(key)) {
      acc[key] = obj[key];
    }
    return acc;
  }, {});
};

/**
 * Omit specific keys from object
 */
const omit = (obj, keys) => {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !keys.includes(k))
  );
};

/**
 * Sleep for specified milliseconds
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry function with exponential backoff
 */
const retry = async (fn, maxRetries = 3, delay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(delay * Math.pow(2, i));
    }
  }
};

module.exports = {
  createSlug,
  calculateSubscriptionEndDate,
  formatDate,
  parseDuration,
  maskEmail,
  cleanObject,
  pick,
  omit,
  sleep,
  retry,
};