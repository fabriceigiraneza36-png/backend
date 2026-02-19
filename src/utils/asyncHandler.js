// src/utils/asyncHandler.js
/**
 * Async handler wrapper to avoid try-catch blocks
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;