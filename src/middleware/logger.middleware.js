// src/middleware/logger.middleware.js
const morgan = require('morgan');
const logger = require('../utils/logger');
const env = require('../config/env');

// Custom token for user ID
morgan.token('user-id', (req) => req.user?.id || 'anonymous');

// Custom token for response time with colors
morgan.token('colored-status', (req, res) => {
  const status = res.statusCode;
  const color = status >= 500 ? 31 : status >= 400 ? 33 : status >= 300 ? 36 : 32;
  return `\x1b[${color}m${status}\x1b[0m`;
});

// Custom format
const format = env.nodeEnv === 'production'
  ? ':remote-addr - :user-id [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" - :response-time ms'
  : ':method :url :colored-status :response-time ms - :res[content-length] - :user-id';

// Stream to winston
const stream = {
  write: (message) => logger.http(message.trim()),
};

const requestLogger = morgan(format, { stream });

module.exports = requestLogger;