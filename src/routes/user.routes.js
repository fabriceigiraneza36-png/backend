// src/routes/user.routes.js
const express = require('express');
const UserController = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validateBody } = require('../middleware/validator.middleware');
const { schemas } = require('../utils/validators');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

router.get('/profile', UserController.getProfile);
router.patch('/profile', validateBody('updateUser'), UserController.updateProfile);
router.get('/preferences', UserController.getPreferences);
router.patch('/preferences', validateBody('updatePreferences'), UserController.updatePreferences);
router.delete('/account', UserController.deleteAccount);
router.get('/sessions', UserController.getSessions);
router.delete('/sessions/:sessionId', UserController.revokeSession);

module.exports = router;