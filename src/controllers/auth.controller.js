// src/controllers/auth.controller.js
const AuthService = require('../services/auth.service');
const ApiResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

class AuthController {
  /**
   * Register a new user
   * POST /api/v1/auth/register
   */
  static register = asyncHandler(async (req, res) => {
    const { email, username, fullName } = req.validatedBody;
    
    const result = await AuthService.register({ email, username, fullName });
    
    return ApiResponse.created(res, {
      user: {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        fullName: result.user.full_name,
      },
    }, 'Registration successful. Please check your email to verify your account.');
  });

  /**
   * Request magic link
   * POST /api/v1/auth/magic-link
   */
  static requestMagicLink = asyncHandler(async (req, res) => {
    const { email } = req.validatedBody;
    
    await AuthService.requestMagicLink(email);
    
    return ApiResponse.success(res, null, 'Magic link sent to your email');
  });

  /**
   * Verify magic link and login
   * POST /api/v1/auth/verify
   */
  static verifyMagicLink = asyncHandler(async (req, res) => {
    const { token } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];
    
    const result = await AuthService.verifyMagicLink(token, ipAddress, userAgent);
    
    return ApiResponse.success(res, {
      user: {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        fullName: result.user.full_name,
        role: result.user.role,
        isVerified: result.user.is_verified,
      },
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    }, 'Login successful');
  });

  /**
   * Refresh access token
   * POST /api/v1/auth/refresh
   */
  static refresh = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];
    
    const result = await AuthService.refreshTokens(refreshToken, ipAddress, userAgent);
    
    return ApiResponse.success(res, result, 'Token refreshed successfully');
  });

  /**
   * Logout
   * POST /api/v1/auth/logout
   */
  static logout = asyncHandler(async (req, res) => {
    await AuthService.logout(req.token);
    
    return ApiResponse.success(res, null, 'Logged out successfully');
  });

  /**
   * Logout from all devices
   * POST /api/v1/auth/logout-all
   */
  static logoutAll = asyncHandler(async (req, res) => {
    await AuthService.logoutAll(req.user.id);
    
    return ApiResponse.success(res, null, 'Logged out from all devices');
  });

  /**
   * Get current user
   * GET /api/v1/auth/me
   */
  static me = asyncHandler(async (req, res) => {
    const SubscriptionService = require('../services/subscription.service');
    const subscriptionData = await SubscriptionService.getUserSubscription(req.user.id);
    
    return ApiResponse.success(res, {
      user: {
        id: req.user.id,
        email: req.user.email,
        username: req.user.username,
        fullName: req.user.full_name,
        avatarUrl: req.user.avatar_url,
        role: req.user.role,
        isVerified: req.user.is_verified,
        createdAt: req.user.created_at,
      },
      subscription: subscriptionData,
    });
  });
}

module.exports = AuthController;