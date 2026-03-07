/**
 * controllers/usersController.js
 * Redirecting to Unified Auth Controller
 */
const authController = require("./authController");

module.exports = {
  ...authController
};
