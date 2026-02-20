// src/routes/auth.routes.js
const express = require('express');
const AuthController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authLimiter } = require('../middleware/rateLimiter.middleware');
const { validateBody } = require('../middleware/validator.middleware');
const { schemas } = require('../utils/validators');

const router = express.Router();

router.post('/register', authLimiter, validateBody('register'), AuthController.register);
router.post('/magic-link', authLimiter, validateBody('login'), AuthController.requestMagicLink);
router.post('/verify', authLimiter, AuthController.verifyMagicLink);
router.post('/refresh', authLimiter, AuthController.refresh);
router.post('/logout', authenticate, AuthController.logout);
router.post('/logout-all', authenticate, AuthController.logoutAll);
router.get('/me', authenticate, AuthController.me);

module.exports = router;