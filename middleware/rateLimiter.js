const rateLimit = require("express-rate-limit");
const AppError = require("../utils/AppError");

const limiter = (windowMs, max, message) =>
  rateLimit({
    windowMs: windowMs || 15 * 60 * 1000,
    max: max || 100,
    message:
      message ||
      "Too many requests from this IP, please try again in 15 minutes",
    handler: (req, res, next) => {
      next(new AppError(message || "Too many requests", 429));
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

module.exports = {
  generalLimiter: limiter(
    15 * 60 * 1000,
    1000,
    "Too many requests from this IP.",
  ),
  authLimiter: limiter(
    60 * 60 * 1000,
    20,
    "Too many login attempts, please try again in an hour.",
  ),
  verifyLimiter: limiter(
    15 * 60 * 1000,
    10,
    "Too many verification attempts, please try again later.",
  ),
  contactLimiter: limiter(
    60 * 60 * 1000,
    5,
    "Too many messages, please try again in an hour.",
  ),
};
