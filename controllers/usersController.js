/**
 * controllers/usersController.js
 * User authentication and management controller
 * Using raw PostgreSQL queries
 */

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { query } = require("../config/db");
const { sendEmail } = require("../utils/email");
const logger = require("../utils/logger");

// Generate JWT token
const generateToken = (user, expiresIn = "7d") => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email,
      type: "user" 
    },
    process.env.JWT_SECRET,
    { expiresIn }
  );
};

// Generate refresh token
const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString("hex");
};

// Hash token for storage
const hashToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

/**
 * Register new user with email/password
 */
exports.register = async (req, res, next) => {
  try {
    const { email, password, full_name } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        error: "Email and password are required" 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false,
        error: "Password must be at least 6 characters" 
      });
    }

    // Check if email exists
    const existing = await query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ 
        success: false,
        error: "An account with this email already exists" 
      });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);
    
    // Generate verification token
    const verification_token = crypto.randomBytes(32).toString("hex");

    // Create user
    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, verification_token, auth_provider)
       VALUES ($1, $2, $3, $4, 'email')
       RETURNING id, email, full_name, avatar_url, is_verified, created_at`,
      [email.toLowerCase(), password_hash, full_name || null, verification_token]
    );

    const user = result.rows[0];

    // Send verification email (non-blocking)
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verification_token}`;
    sendEmail({
      to: user.email,
      subject: "Verify your email - ALTUVERA",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #16a34a;">Welcome to ALTUVERA!</h2>
          <p>Hi ${user.full_name || "there"},</p>
          <p>Thanks for signing up! Please verify your email address by clicking the button below:</p>
          <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #16a34a; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">Verify Email</a>
          <p>Or copy this link: ${verifyUrl}</p>
          <p>This link expires in 24 hours.</p>
          <p>If you didn't create this account, you can safely ignore this email.</p>
        </div>
      `,
    }).catch(err => logger.error("Failed to send verification email:", err));

    // Generate token
    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: "Account created successfully. Please check your email to verify your account.",
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          avatar_url: user.avatar_url,
          is_verified: user.is_verified,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Login with email/password
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        error: "Email and password are required" 
      });
    }

    // Find user
    const result = await query(
      `SELECT id, email, password_hash, full_name, avatar_url, is_verified, is_active, auth_provider
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ 
        success: false,
        error: "Invalid email or password" 
      });
    }

    const user = result.rows[0];

    // Check if account is active
    if (!user.is_active) {
      return res.status(401).json({ 
        success: false,
        error: "This account has been deactivated" 
      });
    }

    // Check if user registered with OAuth
    if (user.auth_provider !== "email" && !user.password_hash) {
      return res.status(401).json({ 
        success: false,
        error: `This account uses ${user.auth_provider} login. Please sign in with ${user.auth_provider}.` 
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false,
        error: "Invalid email or password" 
      });
    }

    // Update last login
    await query(
      "UPDATE users SET last_login = NOW() WHERE id = $1",
      [user.id]
    );

    // Generate token
    const token = generateToken(user);

    logger.info(`User logged in: ${user.email}`);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          avatar_url: user.avatar_url,
          is_verified: user.is_verified,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Google OAuth authentication
 */
exports.googleAuth = async (req, res, next) => {
  try {
    const { credential, client_id } = req.body;

    if (!credential) {
      return res.status(400).json({ 
        success: false,
        error: "Google credential is required" 
      });
    }

    // Verify Google token
    const { OAuth2Client } = require("google-auth-library");
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      return res.status(401).json({ 
        success: false,
        error: "Invalid Google credential" 
      });
    }

    const { sub: google_id, email, name, picture } = payload;

    // Check if user exists by google_id or email
    let result = await query(
      "SELECT * FROM users WHERE google_id = $1 OR email = $2",
      [google_id, email.toLowerCase()]
    );

    let user;

    if (result.rows.length > 0) {
      user = result.rows[0];
      
      // Update Google ID if not set
      if (!user.google_id) {
        await query(
          "UPDATE users SET google_id = $1, avatar_url = COALESCE(avatar_url, $2), is_verified = true WHERE id = $3",
          [google_id, picture, user.id]
        );
      }
      
      // Update last login
      await query("UPDATE users SET last_login = NOW() WHERE id = $1", [user.id]);
    } else {
      // Create new user
      result = await query(
        `INSERT INTO users (email, full_name, avatar_url, google_id, auth_provider, is_verified)
         VALUES ($1, $2, $3, $4, 'google', true)
         RETURNING *`,
        [email.toLowerCase(), name, picture, google_id]
      );
      user = result.rows[0];
    }

    if (!user.is_active) {
      return res.status(401).json({ 
        success: false,
        error: "This account has been deactivated" 
      });
    }

    const token = generateToken(user);

    logger.info(`User logged in via Google: ${user.email}`);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          avatar_url: user.avatar_url,
          is_verified: user.is_verified,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GitHub OAuth authentication
 */
exports.githubAuth = async (req, res, next) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ 
        success: false,
        error: "GitHub authorization code is required" 
      });
    }

    // Exchange code for access token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      return res.status(401).json({ 
        success: false,
        error: "Failed to authenticate with GitHub" 
      });
    }

    const access_token = tokenData.access_token;

    // Get user info from GitHub
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const githubUser = await userResponse.json();

    // Get user email (might be private)
    let email = githubUser.email;
    if (!email) {
      const emailsResponse = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      const emails = await emailsResponse.json();
      const primaryEmail = emails.find(e => e.primary && e.verified);
      email = primaryEmail?.email;
    }

    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: "Could not retrieve email from GitHub. Please make your email public or use another sign-in method." 
      });
    }

    const github_id = String(githubUser.id);

    // Check if user exists
    let result = await query(
      "SELECT * FROM users WHERE github_id = $1 OR email = $2",
      [github_id, email.toLowerCase()]
    );

    let user;

    if (result.rows.length > 0) {
      user = result.rows[0];
      
      if (!user.github_id) {
        await query(
          "UPDATE users SET github_id = $1, avatar_url = COALESCE(avatar_url, $2), is_verified = true WHERE id = $3",
          [github_id, githubUser.avatar_url, user.id]
        );
      }
      
      await query("UPDATE users SET last_login = NOW() WHERE id = $1", [user.id]);
    } else {
      result = await query(
        `INSERT INTO users (email, full_name, avatar_url, github_id, auth_provider, is_verified)
         VALUES ($1, $2, $3, $4, 'github', true)
         RETURNING *`,
        [email.toLowerCase(), githubUser.name || githubUser.login, githubUser.avatar_url, github_id]
      );
      user = result.rows[0];
    }

    if (!user.is_active) {
      return res.status(401).json({ 
        success: false,
        error: "This account has been deactivated" 
      });
    }

    const token = generateToken(user);

    logger.info(`User logged in via GitHub: ${user.email}`);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          avatar_url: user.avatar_url,
          is_verified: user.is_verified,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get current user
 */
exports.getMe = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, email, full_name, avatar_url, phone, nationality, 
              is_verified, auth_provider, preferences, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: "User not found" 
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update current user
 */
exports.updateMe = async (req, res, next) => {
  try {
    const { full_name, avatar_url, phone, nationality, preferences } = req.body;

    const result = await query(
      `UPDATE users 
       SET full_name = COALESCE($1, full_name),
           avatar_url = COALESCE($2, avatar_url),
           phone = COALESCE($3, phone),
           nationality = COALESCE($4, nationality),
           preferences = COALESCE($5, preferences)
       WHERE id = $6
       RETURNING id, email, full_name, avatar_url, phone, nationality, is_verified, preferences`,
      [full_name, avatar_url, phone, nationality, preferences ? JSON.stringify(preferences) : null, req.user.id]
    );

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Change password
 */
exports.changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ 
        success: false,
        error: "Current password and new password are required" 
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ 
        success: false,
        error: "New password must be at least 6 characters" 
      });
    }

    const result = await query(
      "SELECT password_hash, auth_provider FROM users WHERE id = $1",
      [req.user.id]
    );

    const user = result.rows[0];

    if (user.auth_provider !== "email" && !user.password_hash) {
      return res.status(400).json({ 
        success: false,
        error: "Cannot change password for OAuth accounts" 
      });
    }

    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false,
        error: "Current password is incorrect" 
      });
    }

    const new_hash = await bcrypt.hash(new_password, 12);
    await query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [new_hash, req.user.id]
    );

    res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Verify email
 */
exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;

    const result = await query(
      `UPDATE users 
       SET is_verified = true, verification_token = NULL 
       WHERE verification_token = $1 AND is_verified = false
       RETURNING id, email`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid or expired verification link" 
      });
    }

    res.json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Forgot password
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: "Email is required" 
      });
    }

    const result = await query(
      "SELECT id, email, full_name FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    // Always return success to prevent email enumeration
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        message: "If an account with this email exists, you will receive a password reset link.",
      });
    }

    const user = result.rows[0];
    const reset_token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 3600000); // 1 hour

    await query(
      "UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3",
      [reset_token, expires, user.id]
    );

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${reset_token}`;
    
    sendEmail({
      to: user.email,
      subject: "Reset your password - ALTUVERA",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #16a34a;">Password Reset Request</h2>
          <p>Hi ${user.full_name || "there"},</p>
          <p>You requested to reset your password. Click the button below to set a new password:</p>
          <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #16a34a; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">Reset Password</a>
          <p>Or copy this link: ${resetUrl}</p>
          <p>This link expires in 1 hour.</p>
          <p>If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    }).catch(err => logger.error("Failed to send reset email:", err));

    res.json({
      success: true,
      message: "If an account with this email exists, you will receive a password reset link.",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Reset password
 */
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ 
        success: false,
        error: "Token and new password are required" 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false,
        error: "Password must be at least 6 characters" 
      });
    }

    const result = await query(
      `SELECT id FROM users 
       WHERE reset_token = $1 AND reset_token_expires > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid or expired reset token" 
      });
    }

    const password_hash = await bcrypt.hash(password, 12);

    await query(
      `UPDATE users 
       SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL 
       WHERE id = $2`,
      [password_hash, result.rows[0].id]
    );

    res.json({
      success: true,
      message: "Password reset successfully. You can now log in with your new password.",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Logout
 */
exports.logout = async (req, res, next) => {
  try {
    // Could invalidate refresh tokens here if implemented
    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete account
 */
exports.deleteAccount = async (req, res, next) => {
  try {
    const { password } = req.body;

    // For OAuth users, just confirm deletion
    const userResult = await query(
      "SELECT password_hash, auth_provider FROM users WHERE id = $1",
      [req.user.id]
    );

    const user = userResult.rows[0];

    // If email user, verify password
    if (user.auth_provider === "email" && user.password_hash) {
      if (!password) {
        return res.status(400).json({ 
          success: false,
          error: "Password is required to delete account" 
        });
      }

      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ 
          success: false,
          error: "Incorrect password" 
        });
      }
    }

    await query("DELETE FROM users WHERE id = $1", [req.user.id]);

    res.json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Check if email exists
 */
exports.checkEmail = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: "Email is required" 
      });
    }

    const result = await query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    res.json({
      success: true,
      exists: result.rows.length > 0,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Verify code (for OTP-based authentication)
 */
exports.verifyCode = async (req, res, next) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ 
        success: false,
        error: "Email and verification code are required" 
      });
    }

    // Find user
    const result = await query(
      `SELECT id, email, full_name, avatar_url, is_verified, 
              verification_code, code_expiry, code_attempts
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: "User not found" 
      });
    }

    const user = result.rows[0];

    // Check if code exists and not expired
    if (!user.verification_code) {
      return res.status(400).json({ 
        success: false,
        error: "No verification code found. Please request a new code." 
      });
    }

    if (new Date(user.code_expiry) < new Date()) {
      return res.status(400).json({ 
        success: false,
        error: "Verification code has expired. Please request a new code." 
      });
    }

    // Check attempts
    if (user.code_attempts >= 5) {
      return res.status(429).json({ 
        success: false,
        error: "Too many failed attempts. Please request a new code." 
      });
    }

    // Verify code
    if (user.verification_code !== code) {
      // Increment attempts
      await query(
        "UPDATE users SET code_attempts = code_attempts + 1 WHERE id = $1",
        [user.id]
      );
      
      return res.status(401).json({ 
        success: false,
        error: "Invalid verification code" 
      });
    }

    // Code valid - update user
    await query(
      `UPDATE users 
       SET is_verified = true, 
           verification_code = NULL, 
           code_expiry = NULL, 
           code_attempts = 0 
       WHERE id = $1`,
      [user.id]
    );

    // Generate token
    const token = generateToken(user);

    res.json({
      success: true,
      message: "Successfully verified!",
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          avatar_url: user.avatar_url,
          is_verified: true,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Resend verification code
 */
exports.resendCode = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: "Email is required" 
      });
    }

    // Find user
    const result = await query(
      `SELECT id, email, full_name, last_code_sent_at 
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: "User not found" 
      });
    }

    const user = result.rows[0];

    // Rate limit check (1 minute)
    if (user.last_code_sent_at) {
      const lastSent = new Date(user.last_code_sent_at);
      const now = new Date();
      const diffSeconds = (now - lastSent) / 1000;
      
      if (diffSeconds < 60) {
        const waitTime = Math.ceil(60 - diffSeconds);
        return res.status(429).json({ 
          success: false,
          error: `Please wait ${waitTime} seconds before requesting a new code.` 
        });
      }
    }

    // Generate new code
    const verification_code = Math.floor(100000 + Math.random() * 900000).toString();
    const code_expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Update user
    await query(
      `UPDATE users 
       SET verification_code = $1, 
           code_expiry = $2, 
           code_attempts = 0,
           last_code_sent_at = NOW() 
       WHERE id = $3`,
      [verification_code, code_expiry, user.id]
    );

    // Send email
    sendEmail({
      to: user.email,
      subject: "Your verification code - ALTUVERA",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #16a34a;">Your Verification Code</h2>
          <p>Hi ${user.full_name || "there"},</p>
          <p>Your verification code is:</p>
          <div style="font-size: 32px; font-weight: bold; color: #16a34a; text-align: center; padding: 20px; background: #f0fdf4; border-radius: 8px; margin: 20px 0;">
            ${verification_code}
          </div>
          <p>This code expires in 15 minutes.</p>
          <p>If you didn't request this code, you can safely ignore this email.</p>
        </div>
      `,
    }).catch(err => logger.error("Failed to send verification code email:", err));

    res.json({
      success: true,
      message: "New verification code sent to your email.",
    });
  } catch (err) {
    next(err);
  }
};