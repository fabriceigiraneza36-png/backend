const { createLogger, format, transports } = require("winston");
const path = require("path");
const fs = require("fs");

const logsDir = path.join(__dirname, "../logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const consoleFormat = format.combine(
  format.timestamp({ format: "HH:mm:ss" }),
  format.colorize({ all: true }),
  format.printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 && Object.keys(meta).some(k => k !== 'service') 
      ? " " + JSON.stringify(meta) 
      : "";
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

const fileFormat = format.combine(
  format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  format.errors({ stack: true }),
  format.json()
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  defaultMeta: { service: "altuvera-api" },
  transports: [
    new transports.Console({ format: consoleFormat }),
  ],
});

if (process.env.NODE_ENV === "production") {
  logger.add(new transports.File({
    filename: path.join(logsDir, "error.log"),
    level: "error",
    format: fileFormat,
    maxsize: 5242880,
    maxFiles: 5,
  }));
  
  logger.add(new transports.File({
    filename: path.join(logsDir, "combined.log"),
    format: fileFormat,
    maxsize: 5242880,
    maxFiles: 5,
  }));
}

logger.http = (message, meta) => logger.log("http", message, meta);

module.exports = logger;