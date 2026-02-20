// src/controllers/user.controller.js
const { UserModel } = require('../models');
const ApiResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const Pagination = require('../utils/pagination');
const { queryOne } = require('../database/pool');

class UserController {
  /**
   * Get current user profile
   * GET /api/v1/users/profile
   */
  static getProfile = asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.user.id);
    
    return ApiResponse.success(res, {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.full_name,
      avatarUrl: user.avatar_url,
      role: user.role,
      isVerified: user.is_verified,
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at,
      metadata: user.metadata,
    });
  });

  /**
   * Update current user profile
   * PATCH /api/v1/users/profile
   */
  static updateProfile = asyncHandler(async (req, res) => {
    const updates = req.validatedBody;
    
    // Check username availability if changing
    if (updates.username) {
      const existing = await UserModel.findByUsername(updates.username);
      if (existing && existing.id !== req.user.id) {
        return ApiResponse.badRequest(res, 'Username already taken');
      }
    }
    
    const updatedUser = await UserModel.update(req.user.id, updates);
    
    return ApiResponse.success(res, {
      id: updatedUser.id,
      email: updatedUser.email,
      username: updatedUser.username,
      fullName: updatedUser.full_name,
      avatarUrl: updatedUser.avatar_url,
    }, 'Profile updated successfully');
  });

  /**
   * Get user preferences
   * GET /api/v1/users/preferences
   */
  static getPreferences = asyncHandler(async (req, res) => {
    const preferences = await queryOne(
      'SELECT * FROM user_preferences WHERE user_id = $1',
      [req.user.id]
    );
    
    if (!preferences) {
      return ApiResponse.notFound(res, 'Preferences not found');
    }
    
    return ApiResponse.success(res, preferences);
  });

  /**
   * Update user preferences
   * PATCH /api/v1/users/preferences
   */
  static updatePreferences = asyncHandler(async (req, res) => {
    const updates = req.validatedBody;
    
    const preferences = await queryOne(
      `UPDATE user_preferences 
       SET ${Object.keys(updates).map((k, i) => `${k.replace(/[A-Z]/g, m => '_' + m.toLowerCase())} = $${i + 1}`).join(', ')}
       WHERE user_id = $${Object.keys(updates).length + 1}
       RETURNING *`,
      [...Object.values(updates), req.user.id]
    );
    
    return ApiResponse.success(res, preferences, 'Preferences updated successfully');
  });

  /**
   * Delete user account
   * DELETE /api/v1/users/account
   */
  static deleteAccount = asyncHandler(async (req, res) => {
    await UserModel.delete(req.user.id);
    
    return ApiResponse.success(res, null, 'Account deleted successfully');
  });

  /**
   * Get user sessions
   * GET /api/v1/users/sessions
   */
  static getSessions = asyncHandler(async (req, res) => {
    const SessionModel = require('../models/session.model');
    const sessions = await SessionModel.findByUserId(req.user.id);
    
    return ApiResponse.success(res, sessions);
  });

  /**
   * Revoke a session
   * DELETE /api/v1/users/sessions/:sessionId
   */
  static revokeSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const SessionModel = require('../models/session.model');
    
    await require('../database/pool').query(
      'UPDATE sessions SET is_revoked = true WHERE id = $1 AND user_id = $2',
      [sessionId, req.user.id]
    );
    
    return ApiResponse.success(res, null, 'Session revoked successfully');
  });
}

module.exports = UserController;