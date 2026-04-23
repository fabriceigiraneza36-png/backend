/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WEBAUTHN AUTHENTICATION ROUTES
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const webauthnController = require('../controllers/webauthnController');
const { authMiddleware } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES - No authentication required
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /auth/webauthn/register-options
 * Generate registration options for new user
 */
router.post('/register-options', webauthnController.registerOptions);

/**
 * POST /auth/webauthn/register-verify
 * Verify registration response and create user
 */
router.post('/register-verify', webauthnController.registerVerify);

/**
 * POST /auth/webauthn/login-options
 * Generate authentication options for existing user
 */
router.post('/login-options', webauthnController.loginOptions);

/**
 * POST /auth/webauthn/login-verify
 * Verify authentication response and issue JWT
 */
router.post('/login-verify', webauthnController.loginVerify);

// ═══════════════════════════════════════════════════════════════════════════════
// PROTECTED ROUTES - Authentication required
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /auth/webauthn/me
 * Get current user profile
 */
router.get('/me', authMiddleware, webauthnController.getProfile);

/**
 * PATCH /auth/webauthn/profile
 * Update user profile
 */
router.patch('/profile', authMiddleware, webauthnController.updateProfile);

/**
 * POST /auth/webauthn/logout
 * Logout user (revoke session)
 */
router.post('/logout', authMiddleware, webauthnController.logout);

/**
 * DELETE /auth/webauthn/credential/:credentialId
 * Delete a specific credential
 */
router.delete('/credential/:credentialId', authMiddleware, webauthnController.deleteCredential);

module.exports = router;
