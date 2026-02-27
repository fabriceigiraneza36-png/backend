/**
 * routes/auth.js - Authentication routes
 * Adapted for Sequelize/PostgreSQL with proper model import
 */

const router = require("express").Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect } = require("../middleware/auth");
const { sendVerificationCode } = require("../utils/sendEmail");
const { authLimiter, verifyLimiter } = require("../middleware/rateLimiter");
const asyncHandler = require("../middleware/asyncHandler");
const { validateEmail, validateName } = require("../utils/validators");
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');

// ═══════════════════════════════════════════════════
// HELPER: Generate JWT Token
// ═══════════════════════════════════════════════════
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "30d",
  });
};

const shouldExposeDevOtp =
  process.env.NODE_ENV !== "production" &&
  process.env.AUTH_EXPOSE_OTP_IN_RESPONSE === "true";

const withDevOtp = (data, delivery) => {
  if (!delivery?.fallback || !shouldExposeDevOtp) return data;
  return {
    ...data,
    devVerificationCode: delivery.code,
    delivery: delivery.fallback,
  };
};

const verificationMessage = (normalMessage, delivery) =>
  delivery?.fallback
    ? "Verification code generated in development mode. Check backend logs."
    : normalMessage;

// ═══════════════════════════════════════════════════
// POST /api/auth/register
// Create account + send verification code
// ═══════════════════════════════════════════════════
router.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, fullName } = req.body;

    // Validation
    if (!email || !fullName) {
      return res.status(400).json({
        success: false,
        error: "Email and full name are required.",
      });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        error: "Please provide a valid email address.",
      });
    }

    if (!validateName(fullName)) {
      return res.status(400).json({
        success: false,
        error: "Full name must be between 2 and 50 characters.",
      });
    }

    // Check existing user
    const existingUser = await User.findOne({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: "An account with this email already exists. Please sign in.",
      });
    }

    // Create new user
    const user = await User.create({
      email: email.toLowerCase(),
      fullName: fullName.trim(),
      isVerified: false
    });

    // Generate and send verification code
    const code = user.generateVerificationCode();
    await user.save();

    const delivery = await sendVerificationCode(user.email, code, user.fullName);

    res.status(201).json({
      success: true,
      message: verificationMessage(
        "Account created! Verification code sent to your email.",
        delivery
      ),
      data: withDevOtp({
        email: user.email,
        fullName: user.fullName,
        requiresVerification: true,
      }, delivery),
    });
  })
);

// ═══════════════════════════════════════════════════
// POST /api/auth/login
// Validate credentials + send verification code
// ═══════════════════════════════════════════════════
router.post(
  "/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, fullName } = req.body;

    // Validation
    if (!email || !fullName) {
      return res.status(400).json({
        success: false,
        error: "Email and full name are required.",
      });
    }

    // Find user
    const user = await User.findOne({
      where: { email: email.toLowerCase() },
      attributes: [
        'id', 'email', 'fullName', 'verificationCode', 
        'codeExpiry', 'codeAttempts', 'lastCodeSentAt', 
        'isVerified', 'avatar', 'phone', 'bio', 'role'
      ]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "No account found with this email. Please register first.",
      });
    }

    // Verify full name (case-insensitive)
    if (user.fullName.toLowerCase() !== fullName.trim().toLowerCase()) {
      return res.status(401).json({
        success: false,
        error: "The name doesn't match our records. Please try again.",
      });
    }

    // Rate limit check
    if (!user.canSendCode()) {
      const waitTime = Math.ceil(
        (60000 - (Date.now() - new Date(user.lastCodeSentAt).getTime())) / 1000
      );
      return res.status(429).json({
        success: false,
        error: `Please wait ${waitTime} seconds before requesting a new code.`,
      });
    }

    // Generate and send code
    const code = user.generateVerificationCode();
    await user.save();

    const delivery = await sendVerificationCode(user.email, code, user.fullName);

    res.json({
      success: true,
      message: verificationMessage("Verification code sent to your email.", delivery),
      data: withDevOtp({
        email: user.email,
        requiresVerification: true,
      }, delivery),
    });
  })
);

// ═══════════════════════════════════════════════════
// POST /api/auth/verify-code
// Verify OTP code and return JWT
// ═══════════════════════════════════════════════════
router.post(
  "/verify-code",
  verifyLimiter,
  asyncHandler(async (req, res) => {
    const { email, code } = req.body;
    const sanitizedCode = String(code || "").replace(/\D/g, "").slice(0, 6);

    // Validation
    if (!email || !sanitizedCode) {
      return res.status(400).json({
        success: false,
        error: "Email and verification code are required.",
      });
    }

    const user = await User.findOne({
      where: { email: email.toLowerCase() },
      attributes: [
        'id', 'email', 'fullName', 'verificationCode', 
        'codeExpiry', 'codeAttempts', 'isVerified', 
        'avatar', 'phone', 'bio', 'role'
      ]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found.",
      });
    }

    // Verify code
    const result = user.verifyCode(sanitizedCode);

    if (!result.valid) {
      await user.save(); // Save incremented attempts
      return res.status(401).json({
        success: false,
        error: result.message,
      });
    }

    // Code valid - clear it and mark verified
    user.verificationCode = null;
    user.codeExpiry = null;
    user.codeAttempts = 0;
    user.isVerified = true;
    await user.save();

    // Generate JWT
    const token = generateToken(user.id);

    res.json({
      success: true,
      message: "Successfully verified!",
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          avatar: user.avatar,
          phone: user.phone,
          bio: user.bio,
          role: user.role,
          isVerified: user.isVerified,
        },
      },
    });
  })
);

// ═══════════════════════════════════════════════════
// POST /api/auth/resend-code
// Resend verification code
// ═══════════════════════════════════════════════════
router.post(
  "/resend-code",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required.",
      });
    }

    const user = await User.findOne({
      where: { email: email.toLowerCase() },
      attributes: ['id', 'email', 'fullName', 'lastCodeSentAt']
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found.",
      });
    }

    // Rate limit check
    if (!user.canSendCode()) {
      const waitTime = Math.ceil(
        (60000 - (Date.now() - new Date(user.lastCodeSentAt).getTime())) / 1000
      );
      return res.status(429).json({
        success: false,
        error: `Please wait ${waitTime} seconds before requesting a new code.`,
      });
    }

    const code = user.generateVerificationCode();
    await user.save();

    const delivery = await sendVerificationCode(user.email, code, user.fullName);

    res.json({
      success: true,
      message: verificationMessage("New verification code sent to your email.", delivery),
      data: withDevOtp({ email: user.email }, delivery),
    });
  })
);

// ═══════════════════════════════════════════════════
// POST /api/auth/check-email
// Check if email exists
// ═══════════════════════════════════════════════════
router.post(
  "/check-email",
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required.",
      });
    }

    const user = await User.findOne({
      where: { email: email.toLowerCase() }
    });

    res.json({
      success: true,
      data: {
        exists: !!user,
      },
    });
  })
);

// ═══════════════════════════════════════════════════
// GET /api/auth/me
// Get current user (protected)
// ═══════════════════════════════════════════════════
router.get(
  "/me",
  protect,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: {
        user: {
          id: req.user.id,
          email: req.user.email,
          fullName: req.user.fullName,
          avatar: req.user.avatar,
          phone: req.user.phone,
          bio: req.user.bio,
          role: req.user.role,
          isVerified: req.user.isVerified,
          createdAt: req.user.createdAt,
        },
      },
    });
  })
);

// ═══════════════════════════════════════════════════
// PUT /api/auth/profile
// Update user profile (protected)
// ═══════════════════════════════════════════════════
router.put(
  "/profile",
  protect,
  asyncHandler(async (req, res) => {
    const allowedFields = ["fullName", "phone", "bio", "avatar"];
    const updates = {};

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Validate fullName if provided
    if (updates.fullName && !validateName(updates.fullName)) {
      return res.status(400).json({
        success: false,
        error: "Full name must be between 2 and 50 characters.",
      });
    }

    // Update user
    await User.update(updates, {
      where: { id: req.user.id },
      individualHooks: true
    });

    // Fetch updated user
    const updatedUser = await User.findByPk(req.user.id, {
      attributes: { exclude: ['verificationCode', 'codeExpiry', 'codeAttempts', 'lastCodeSentAt'] }
    });

    res.json({
      success: true,
      message: "Profile updated successfully.",
      data: {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          fullName: updatedUser.fullName,
          avatar: updatedUser.avatar,
          phone: updatedUser.phone,
          bio: updatedUser.bio,
          role: updatedUser.role,
          isVerified: updatedUser.isVerified,
        },
      },
    });
  })
);

// ═══════════════════════════════════════════════════
// POST /api/auth/logout
// Logout user (protected)
// ═══════════════════════════════════════════════════
router.post("/logout", protect, (req, res) => {
  res.json({
    success: true,
    message: "Logged out successfully.",
  });
});

// ═══════════════════════════════════════════════════
// DELETE /api/auth/me
// Delete account (protected)
// ═══════════════════════════════════════════════════
router.delete("/me", protect, asyncHandler(async (req, res) => {
  await User.destroy({
    where: { id: req.user.id }
  });
  
  res.json({
    success: true,
    message: "Account deleted successfully.",
  });
}));

// ═══════════════════════════════════════════════════
// POST /api/auth/google
// Google OAuth authentication
// ═══════════════════════════════════════════════════
router.post(
  "/google",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { credential } = req.body;
    
    if (!credential) {
      return res.status(400).json({
        success: false,
        error: "Google credential is required.",
      });
    }

    try {
      const { OAuth2Client } = require('google-auth-library');
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      
      const payload = ticket.getPayload();
      const email = payload.email;
      const fullName = payload.name;
      const avatar = payload.picture;

      let user = await User.findOne({ 
        where: { email: email.toLowerCase() } 
      });
      
      if (!user) {
        user = await User.create({
          email: email.toLowerCase(),
          fullName,
          avatar,
          isVerified: true,
          authProvider: 'google'
        });
      }

      const token = generateToken(user.id);

      res.json({
        success: true,
        message: "Google authentication successful!",
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            avatar: user.avatar,
            role: user.role,
            isVerified: user.isVerified,
          },
        },
      });
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: "Invalid Google credential.",
      });
    }
  })
);

// ═══════════════════════════════════════════════════
// POST /api/auth/github
// GitHub OAuth authentication
// ═══════════════════════════════════════════════════
router.post(
  "/github",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        error: "GitHub code is required.",
      });
    }

    try {
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });
      
      const tokenData = await tokenResponse.json();
      
      if (tokenData.error) {
        throw new Error(tokenData.error_description || 'GitHub authentication failed');
      }

      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
        },
      });
      
      const githubUser = await userResponse.json();
      
      let email = githubUser.email;
      if (!email) {
        const emailsResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
          },
        });
        const emails = await emailsResponse.json();
        const primaryEmail = emails.find(e => e.primary && e.verified);
        email = primaryEmail?.email;
      }

      if (!email) {
        throw new Error('Unable to fetch email from GitHub');
      }

      let user = await User.findOne({ 
        where: { email: email.toLowerCase() } 
      });
      
      if (!user) {
        user = await User.create({
          email: email.toLowerCase(),
          fullName: githubUser.name || githubUser.login,
          avatar: githubUser.avatar_url,
          isVerified: true,
          authProvider: 'github'
        });
      }

      const token = generateToken(user.id);

      res.json({
        success: true,
        message: "GitHub authentication successful!",
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            avatar: user.avatar,
            role: user.role,
            isVerified: user.isVerified,
          },
        },
      });
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: error.message || "GitHub authentication failed.",
      });
    }
  })
);

// ═══════════════════════════════════════════════════
// POST /api/auth/forgot-password
// Send password reset email
// ═══════════════════════════════════════════════════
router.post(
  "/forgot-password",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required.",
      });
    }

    const user = await User.findOne({ 
      where: { email: email.toLowerCase() } 
    });

    if (!user) {
      return res.json({
        success: true,
        message: "If an account exists with this email, you will receive a password reset link.",
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpire = Date.now() + 3600000;
    
    await user.save();

    res.json({
      success: true,
      message: "If an account exists with this email, you will receive a password reset link.",
    });
  })
);

// ═══════════════════════════════════════════════════
// POST /api/auth/reset-password
// Reset password with token
// ═══════════════════════════════════════════════════
router.post(
  "/reset-password",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: "Token and new password are required.",
      });
    }

    const resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      where: {
        resetPasswordToken,
        resetPasswordExpire: { [Op.gt]: Date.now() },
      }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired reset token.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.resetPasswordToken = null;
    user.resetPasswordExpire = null;
    
    await user.save();

    res.json({
      success: true,
      message: "Password reset successful.",
    });
  })
);

// ═══════════════════════════════════════════════════
// PUT /api/auth/change-password
// Change password (protected)
// ═══════════════════════════════════════════════════
router.put(
  "/change-password",
  protect,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: "Current password and new password are required.",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: "New password must be at least 6 characters.",
      });
    }

    const user = await User.findByPk(req.user.id, {
      attributes: { include: ['password'] }
    });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: "Current password is incorrect.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.json({
      success: true,
      message: "Password changed successfully.",
    });
  })
);

// ═══════════════════════════════════════════════════
// GET /api/auth/verify/:token
// Verify email
// ═══════════════════════════════════════════════════
router.get(
  "/verify/:token",
  asyncHandler(async (req, res) => {
    const { token } = req.params;

    const user = await User.findOne({
      where: { verificationToken: token }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired verification token.",
      });
    }

    user.isVerified = true;
    user.verificationToken = null;
    await user.save();

    res.json({
      success: true,
      message: "Email verified successfully.",
    });
  })
);

module.exports = router;
