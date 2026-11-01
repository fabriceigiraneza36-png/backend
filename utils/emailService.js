"use strict";

// Compatibility adapter: all application email sends go through utils/email.js.
// This preserves the legacy positional signature while sharing one provider
// policy, encrypted PostgreSQL outbox, idempotency, retry and audit behavior.
const core = require("./email");

const sendEmail = (to, subject, html, options = {}) =>
  core.sendEmail(to, subject, html, options);

const verifyEmailConnection = async () => {
  if (typeof core.verifySmtp === "function") return core.verifySmtp();
  return false;
};

module.exports = {
  sendEmail,
  verifyEmailConnection,
  verifyConnection: verifyEmailConnection,
  verify: verifyEmailConnection,
  getTransporter: core.getTransporter,
  default: sendEmail,
};
