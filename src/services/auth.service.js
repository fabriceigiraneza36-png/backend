// src/services/auth.service.js
const { UserModel, SessionModel } = require('../models');
const { queryOne, withTransaction } = require('../database/pool');
const {
  generateAccessToken,
  generateRefreshToken,
  generateMagicLinkToken,
  hashToken,
  verifyToken,
} = require('../utils/crypto');
const { parseDuration } = require('../utils/helpers');
const env = require('../config/env');
const EmailService = require('./email.service');
const AnalyticsService = require('./analytics.service');
const { EVENTS } = require('../config/constants');

class AuthService {
  /**
   * Register a new user
   */
  static async register({ email, username, fullName }) {
    // Check if email exists
    const existingEmail = await UserModel.findByEmail(email);
    if (existingEmail) {
      throw { status: 409, message: 'Email already registered' };
    }

    // Check if username exists
    const existingUsername = await UserModel.findByUsername(username);
    if (existingUsername) {
      throw { status: 409, message: 'Username already taken' };
    }

    // Create user
    const user = await UserModel.create({ email, username, fullName });

    // Create user preferences
    await queryOne(
      'INSERT INTO user_preferences (user_id) VALUES ($1)',
      [user.id]
    );

    // Track event
    await AnalyticsService.track({
      userId: user.id,
      eventName: EVENTS.USER_REGISTERED,
      properties: { method: 'email' },
    });

    // Send welcome email
    await EmailService.sendWelcomeEmail(user);

    // Generate magic link for verification
    const magicLink = await this.createMagicLink(email, 'verification');

    return { user, magicLink };
  }

  /**
   * Login with magic link
   */
  static async requestMagicLink(email) {
    let user = await UserModel.findByEmail(email);
    
    if (!user) {
      // For security, don't reveal if user exists
      // But we'll just return success anyway
      return { success: true };
    }

    const magicLink = await this.createMagicLink(email, 'login');
    
    // Send magic link email
    await EmailService.sendMagicLinkEmail(user, magicLink.url);

    return { success: true };
  }

  /**
   * Create magic link
   */
  static async createMagicLink(email, purpose = 'login') {
    const token = generateMagicLinkToken();
    const tokenHash = hashToken(token);
    const expiresIn = parseDuration(env.magicLinkExpiresIn || '15m');
    const expiresAt = new Date(Date.now() + expiresIn);

    const user = await UserModel.findByEmail(email);

    await queryOne(
      `INSERT INTO magic_links (user_id, email, token_hash, purpose, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user?.id, email, tokenHash, purpose, expiresAt]
    );

    const url = `${env.frontendUrl}/auth/verify?token=${token}`;

    return { token, url, expiresAt };
  }

  /**
   * Verify magic link and login
   */
  static async verifyMagicLink(token, ipAddress, userAgent) {
    const tokenHash = hashToken(token);

    const magicLink = await queryOne(
      `SELECT * FROM magic_links
       WHERE token_hash = $1
       AND used_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP`,
      [tokenHash]
    );

    if (!magicLink) {
      throw { status: 400, message: 'Invalid or expired magic link' };
    }

    // Mark as used
    await queryOne(
      'UPDATE magic_links SET used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [magicLink.id]
    );

    // Get or create user
    let user = await UserModel.findByEmail(magicLink.email);

    if (!user) {
      throw { status: 404, message: 'User not found' };
    }

    // Verify user if needed
    if (!user.is_verified && magicLink.purpose === 'verification') {
      user = await UserModel.verify(user.id);
    }

    // Update last login
    await UserModel.updateLastLogin(user.id);

    // Generate tokens
    const tokens = await this.generateTokens(user, ipAddress, userAgent);

    // Track event
    await AnalyticsService.track({
      userId: user.id,
      eventName: EVENTS.USER_LOGIN,
      properties: { method: 'magic_link' },
      ipAddress,
      userAgent,
    });

    return { user, ...tokens };
  }

  /**
   * Generate access and refresh tokens
   */
  static async generateTokens(user, ipAddress, userAgent) {
    const accessPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };

    const refreshPayload = {
      userId: user.id,
      type: 'refresh',
    };

    const accessToken = generateAccessToken(accessPayload);
    const refreshToken = generateRefreshToken(refreshPayload);

    // Store session
    const accessExpiresAt = new Date(Date.now() + parseDuration('7d'));
    const refreshExpiresAt = new Date(Date.now() + parseDuration('30d'));

    await SessionModel.create({
      userId: user.id,
      token: accessToken,
      tokenType: 'access',
      ipAddress,
      userAgent,
      expiresAt: accessExpiresAt,
    });

    await SessionModel.create({
      userId: user.id,
      token: refreshToken,
      tokenType: 'refresh',
      ipAddress,
      userAgent,
      expiresAt: refreshExpiresAt,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExpiresAt.getTime(),
    };
  }

  /**
   * Refresh access token
   */
  static async refreshTokens(refreshToken, ipAddress, userAgent) {
    const session = await SessionModel.findByToken(refreshToken);

    if (!session) {
      throw { status: 401, message: 'Invalid refresh token' };
    }

    const user = await UserModel.findById(session.user_id);

    if (!user || !user.is_active) {
      throw { status: 401, message: 'User not found or inactive' };
    }

    // Revoke old refresh token
    await SessionModel.revokeByToken(refreshToken);

    // Generate new tokens
    return this.generateTokens(user, ipAddress, userAgent);
  }

  /**
   * Logout
   */
  static async logout(token) {
    await SessionModel.revokeByToken(token);
    return { success: true };
  }

  /**
   * Logout from all devices
   */
  static async logoutAll(userId) {
    await SessionModel.revokeAllForUser(userId);
    return { success: true };
  }

  /**
   * Validate token
   */
  static async validateToken(token) {
    try {
      const decoded = verifyToken(token);
      const session = await SessionModel.findByToken(token);

      if (!session) {
        return { valid: false };
      }

      const user = await UserModel.findById(decoded.userId);

      if (!user || !user.is_active) {
        return { valid: false };
      }

      return { valid: true, user, decoded };
    } catch (error) {
      return { valid: false };
    }
  }
}

module.exports = AuthService;