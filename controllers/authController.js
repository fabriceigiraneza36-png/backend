// controllers/authController.js
// ═══════════════════════════════════════════════════════════════════════════
// Passwordless Auth — OTP via Gmail · Google OAuth · GitHub OAuth
// ═══════════════════════════════════════════════════════════════════════════

"use strict";

const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const crypto  = require("crypto");
const https   = require("https");
const http    = require("http");

const { query }    = require("../config/db");
const {
  sendEmail,
  sendOtpEmail,
  sendWelcomeEmail,
  sendActivityAlert,
}                  = require("../utils/email");
const logger       = require("../utils/logger");
const { validateEmail, validateName } = require("../utils/validators");

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const APP_NAME               = process.env.APP_NAME             || "Altuvera";
const FRONTEND_URL           = process.env.FRONTEND_URL         || "https://altuvera.com";
const JWT_SECRET             = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET     = process.env.JWT_REFRESH_SECRET   || JWT_SECRET;
const JWT_EXPIRES_IN         = process.env.JWT_EXPIRES_IN       || "7d";
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "30d";
const OTP_EXPIRY_MINUTES     = 10;
const OTP_MAX_ATTEMPTS       = 5;
const CODE_COOLDOWN_MS       = 60_000;
const SOCIAL_HTTP_TIMEOUT_MS = parseInt(
  process.env.SOCIAL_AUTH_TIMEOUT_MS || "8000", 10,
);

const ipv4HttpsAgent = new https.Agent({ family: 4, keepAlive: true });
const ipv4HttpAgent  = new http.Agent({  family: 4, keepAlive: true });

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const generateOTP = () => crypto.randomInt(100_000, 999_999).toString();

const generateToken = (entity, type = "user") =>
  jwt.sign(
    {
      id:           entity.id,
      email:        entity.email,
      role:         entity.role || (type === "admin" ? "admin" : "user"),
      type,
      tokenVersion: entity.token_version ?? 0,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );

const generateRefreshToken = (entity, type = "user") =>
  jwt.sign(
    {
      id:           entity.id,
      type,
      tokenType:    "refresh",
      tokenVersion: entity.token_version ?? 0,
    },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN },
  );

const sanitizeUser = (row) => {
  if (!row) return null;
  const {
    verification_code, code_expiry, code_attempts,
    last_code_sent_at, google_id, github_id,
    token_version, password_hash,
    ...safe
  } = row;
  return {
    id:            safe.id,
    email:         safe.email,
    username:      safe.username,
    fullName:      safe.full_name,
    full_name:     safe.full_name,
    name:          safe.full_name,
    avatar:        safe.avatar_url,
    avatarUrl:     safe.avatar_url,
    avatar_url:    safe.avatar_url,
    phone:         safe.phone,
    bio:           safe.bio,
    role:          safe.role,
    authProvider:  safe.auth_provider,
    auth_provider: safe.auth_provider,
    isVerified:    safe.is_verified,
    is_verified:   safe.is_verified,
    emailVerified: safe.is_verified,
    isActive:      safe.is_active,
    preferences:   safe.preferences,
    lastLogin:     safe.last_login,
    loginCounter:  safe.login_counter  ?? 0,
    login_counter: safe.login_counter  ?? 0,
    subscribed:    safe.subscribed     ?? false,
    createdAt:     safe.created_at,
    updatedAt:     safe.updated_at,
  };
};

const isRateLimited = (row, ms = CODE_COOLDOWN_MS) =>
  row.last_code_sent_at &&
  Date.now() - new Date(row.last_code_sent_at).getTime() < ms;

const getRemainingCooldown = (row) => {
  if (!row.last_code_sent_at) return 0;
  return Math.ceil(
    (CODE_COOLDOWN_MS -
      (Date.now() - new Date(row.last_code_sent_at).getTime())) / 1000,
  );
};

const handleError = (res, err, message = "Operation failed", status = 500) => {
  logger.error(`[Auth] ${message}:`, { error: err.message });
  return res.status(err.status || status).json({
    success: false,
    message: err.message || message,
  });
};

const respondWithAuth = (res, user, isNew = false, statusCode = 200) =>
  res.status(statusCode).json({
    success: true,
    data: {
      token:        generateToken(user, "user"),
      refreshToken: generateRefreshToken(user, "user"),
      user:         sanitizeUser(user),
      isNewUser:    isNew,
      loginCounter: user.login_counter ?? 0,
    },
  });

// ═══════════════════════════════════════════════════════════════════════════
// SOCIAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

let googleOAuthClient = null;
const getGoogleOAuthClient = () => {
  if (!googleOAuthClient) {
    const { OAuth2Client } = require("google-auth-library");
    googleOAuthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }
  return googleOAuthClient;
};

const fetchJsonOrThrow = async (url, options = {}, provider = "oauth") => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOCIAL_HTTP_TIMEOUT_MS);

  try {
    const isHttps = url.startsWith("https://");
    const agent   = isHttps ? ipv4HttpsAgent : ipv4HttpAgent;

    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      agent:  () => agent,
    });

    const raw = await res.text();
    let body  = {};
    try   { body = raw ? JSON.parse(raw) : {}; }
    catch { body = { raw }; }

    if (!res.ok) {
      const err  = new Error(body?.message || `${provider} failed (${res.status})`);
      err.status = 401;
      throw err;
    }

    return body;
  } catch (err) {
    if (err.name === "AbortError") {
      const e  = new Error(`${provider} request timed out`);
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const upsertSocialUser = async ({
  provider, providerId, email, name, avatar, phone, bio,
}) => {
  const col = { google: "google_id", github: "github_id" }[provider];
  if (!col) throw new Error(`Unsupported provider: ${provider}`);

  const e   = (email  || "").trim().toLowerCase();
  const n   = (name   || "").trim() || e.split("@")[0] || "User";
  const pid = String(providerId || "").trim();

  if (!pid) {
    const err  = new Error(`${provider} account ID missing`);
    err.status = 401;
    throw err;
  }
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    const err  = new Error("Valid email required");
    err.status = 400;
    throw err;
  }

  const upsertResult = await query(
    `INSERT INTO users (
       email, full_name, avatar_url, ${col},
       auth_provider, phone, bio,
       is_verified, is_active, last_login, role,
       login_counter
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,true,true,NOW(),'user',0)
     ON CONFLICT (email) DO UPDATE SET
       ${col}        = EXCLUDED.${col},
       full_name     = COALESCE(NULLIF(EXCLUDED.full_name,''),  users.full_name),
       avatar_url    = COALESCE(NULLIF(EXCLUDED.avatar_url,''), users.avatar_url),
       phone         = COALESCE(NULLIF(EXCLUDED.phone,''),      users.phone),
       bio           = COALESCE(NULLIF(EXCLUDED.bio,''),        users.bio),
       auth_provider = CASE
                         WHEN users.auth_provider IS NULL OR users.auth_provider = 'email'
                         THEN EXCLUDED.auth_provider
                         ELSE users.auth_provider
                       END,
       is_verified   = true,
       is_active     = true,
       last_login    = NOW()
     RETURNING *, (xmax = 0) AS is_new_row`,
    [e, n, avatar || null, pid, provider, phone || null, bio || null],
  );

  const user  = upsertResult.rows[0];
  const isNew = Boolean(user.is_new_row);

  if (isNew) {
    sendWelcomeEmail({
      to:            user.email,
      recipientName: user.full_name || "",
    }).catch((err) => logger.warn("[Auth] Welcome email failed:", err.message));
  }

  return { user, isNew };
};

const incrementLoginCounter = async (userId) => {
  const result = await query(
    `UPDATE users
        SET login_counter = COALESCE(login_counter, 0) + 1,
            last_login    = NOW()
      WHERE id = $1
      RETURNING *`,
    [userId],
  );
  return result.rows[0];
};

// ═══════════════════════════════════════════════════════════════════════════
// REGISTER
// ═══════════════════════════════════════════════════════════════════════════

exports.register = async (req, res) => {
  try {
    const { email, fullName, full_name, phone, bio, avatar } = req.body;
    const name            = (fullName || full_name || "").trim();
    const normalizedEmail = (email || "").trim().toLowerCase();

    if (!normalizedEmail)
      return res.status(400).json({ success: false, message: "Email is required" });
    if (validateEmail && !validateEmail(normalizedEmail))
      return res.status(400).json({ success: false, message: "Invalid email address" });
    if (name && validateName && !validateName(name))
      return res.status(400).json({ success: false, message: "Name must be 2–50 characters" });

    let result = await query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);

    if (result.rows.length > 0) {
      const existing = result.rows[0];
      if (existing.is_verified)
        return res.status(409).json({ success: false, message: "Account exists. Please sign in." });
      if (isRateLimited(existing))
        return res.status(429).json({
          success: false,
          message: `Wait ${getRemainingCooldown(existing)} seconds before requesting a new code.`,
        });

      if (name || phone || bio || avatar) {
        await query(
          `UPDATE users SET
             full_name  = COALESCE(NULLIF($1,''), full_name),
             phone      = COALESCE(NULLIF($2,''), phone),
             bio        = COALESCE(NULLIF($3,''), bio),
             avatar_url = COALESCE(NULLIF($4,''), avatar_url)
           WHERE id = $5`,
          [name, phone || null, bio || null, avatar || null, existing.id],
        );
      }

      const otp = generateOTP();
      await query(
        `UPDATE users SET
           verification_code = $1,
           code_expiry       = NOW() + ($2 || ' minutes')::interval,
           code_attempts     = 0,
           last_code_sent_at = NOW()
         WHERE id = $3`,
        [otp, OTP_EXPIRY_MINUTES, existing.id],
      );

      await sendOtpEmail({
        to:            normalizedEmail,
        recipientName: name || existing.full_name || "",
        otp,
        purpose:       "verify",
        expiryMinutes: OTP_EXPIRY_MINUTES,
      });

      return res.json({
        success: true,
        message: "Verification code sent. Check your inbox.",
        data:    { email: normalizedEmail },
      });
    }

    // New user
    result = await query(
      `INSERT INTO users
         (email, full_name, phone, bio, avatar_url, is_verified, auth_provider, login_counter)
       VALUES ($1,$2,$3,$4,$5,false,'email',0)
       RETURNING *`,
      [normalizedEmail, name || null, phone || null, bio || null, avatar || null],
    );

    const user = result.rows[0];
    const otp  = generateOTP();

    await query(
      `UPDATE users SET
         verification_code = $1,
         code_expiry       = NOW() + ($2 || ' minutes')::interval,
         code_attempts     = 0,
         last_code_sent_at = NOW()
       WHERE id = $3`,
      [otp, OTP_EXPIRY_MINUTES, user.id],
    );

    await sendOtpEmail({
      to:            normalizedEmail,
      recipientName: name || "",
      otp,
      purpose:       "verify",
      expiryMinutes: OTP_EXPIRY_MINUTES,
    });

    return res.status(201).json({
      success: true,
      message: "Account created! Verification code sent to your inbox.",
      data:    { email: normalizedEmail, requiresVerification: true },
    });
  } catch (err) {
    handleError(res, err, "Registration failed");
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// LOGIN  — always sends OTP, no reverification gate
// ═══════════════════════════════════════════════════════════════════════════

exports.login = async (req, res) => {
  try {
    const { email, fullName, full_name } = req.body;
    const name            = (fullName || full_name || "").trim();
    const normalizedEmail = (email || "").trim().toLowerCase();

    if (!normalizedEmail)
      return res.status(400).json({ success: false, message: "Email is required" });

    let result = await query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
    let isNew  = false;

    if (result.rows.length === 0) {
      result = await query(
        `INSERT INTO users (email, full_name, is_verified, auth_provider, login_counter)
         VALUES ($1,$2,false,'email',0)
         RETURNING *`,
        [normalizedEmail, name || null],
      );
      isNew = true;
    }

    const user = result.rows[0];

    if (!user.is_active)
      return res.status(401).json({
        success: false,
        message: "Account deactivated. Contact support.",
      });

    if (isRateLimited(user))
      return res.status(429).json({
        success: false,
        message: `Please wait ${getRemainingCooldown(user)} seconds before requesting a new code.`,
      });

    const otp     = generateOTP();
    const purpose = isNew ? "verify" : "login";

    await query(
      `UPDATE users SET
         verification_code = $1,
         code_expiry       = NOW() + ($2 || ' minutes')::interval,
         code_attempts     = 0,
         last_code_sent_at = NOW()
       WHERE id = $3`,
      [otp, OTP_EXPIRY_MINUTES, user.id],
    );

    await sendOtpEmail({
      to:            normalizedEmail,
      recipientName: user.full_name || name || "",
      otp,
      purpose,
      expiryMinutes: OTP_EXPIRY_MINUTES,
    });

    return res.json({
      success: true,
      message: "Verification code sent to your inbox.",
      data: {
        email:     normalizedEmail,
        isNewUser: isNew,
      },
    });
  } catch (err) {
    handleError(res, err, "Login failed");
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// VERIFY CODE
// ═══════════════════════════════════════════════════════════════════════════

exports.verifyCode = async (req, res) => {
  try {
    const { email, code } = req.body;
    const sanitizedCode   = String(code || "").replace(/\D/g, "").slice(0, 6);
    const normalizedEmail = (email || "").trim().toLowerCase();

    if (!normalizedEmail || !sanitizedCode)
      return res.status(400).json({ success: false, message: "Email and code are required" });
    if (sanitizedCode.length !== 6)
      return res.status(400).json({ success: false, message: "Enter a valid 6-digit code" });

    const result = await query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: "Account not found" });

    const user = result.rows[0];

    if ((user.code_attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
      await query(
        "UPDATE users SET verification_code = NULL, code_expiry = NULL WHERE id = $1",
        [user.id],
      );
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Please request a new code.",
      });
    }

    const codeMatches = user.verification_code === sanitizedCode;
    const notExpired  = user.code_expiry && new Date(user.code_expiry) > new Date();

    if (!codeMatches || !notExpired) {
      await query(
        "UPDATE users SET code_attempts = COALESCE(code_attempts,0) + 1 WHERE id = $1",
        [user.id],
      );
      const remaining = OTP_MAX_ATTEMPTS - ((user.code_attempts ?? 0) + 1);

      if (!notExpired && codeMatches) {
        return res.status(401).json({
          success: false,
          message: "Code has expired. Please request a new one.",
        });
      }

      return res.status(401).json({
        success: false,
        message: remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
          : "Too many attempts. Please request a new code.",
      });
    }

    const isFirstVerification = !user.is_verified;

    const updated = await query(
      `UPDATE users SET
         is_verified       = true,
         verification_code = NULL,
         code_expiry       = NULL,
         code_attempts     = 0,
         last_login        = NOW(),
         login_counter     = COALESCE(login_counter, 0) + 1
       WHERE id = $1
       RETURNING *`,
      [user.id],
    );

    const freshUser = updated.rows[0];

    if (isFirstVerification) {
      sendWelcomeEmail({
        to:            user.email,
        recipientName: user.full_name || "",
      }).catch(() => {});
    }

    return res.json({
      success: true,
      message: isFirstVerification ? "Account verified! Welcome!" : "Signed in successfully!",
      data: {
        token:        generateToken(freshUser, "user"),
        refreshToken: generateRefreshToken(freshUser, "user"),
        user:         sanitizeUser(freshUser),
        isNewUser:    isFirstVerification,
        loginCounter: freshUser.login_counter,
      },
    });
  } catch (err) {
    handleError(res, err, "Verification failed");
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// RESEND CODE
// ═══════════════════════════════════════════════════════════════════════════

exports.resendCode = async (req, res) => {
  try {
    const normalizedEmail = (req.body.email || "").trim().toLowerCase();
    if (!normalizedEmail)
      return res.status(400).json({ success: false, message: "Email is required" });

    const result = await query(
      `SELECT id, email, full_name, last_code_sent_at, is_active
         FROM users WHERE email = $1`,
      [normalizedEmail],
    );

    // Anti-enumeration: always respond success
    if (result.rows.length === 0)
      return res.json({
        success: true,
        message: "If an account exists, a new code has been sent.",
      });

    const user = result.rows[0];

    if (!user.is_active)
      return res.status(401).json({ success: false, message: "Account deactivated." });

    if (isRateLimited(user))
      return res.status(429).json({
        success: false,
        message: `Please wait ${getRemainingCooldown(user)} seconds before requesting again.`,
      });

    const otp = generateOTP();

    await query(
      `UPDATE users SET
         verification_code = $1,
         code_expiry       = NOW() + '15 minutes'::interval,
         code_attempts     = 0,
         last_code_sent_at = NOW()
       WHERE id = $2`,
      [otp, user.id],
    );

    await sendOtpEmail({
      to:            user.email,
      recipientName: user.full_name || "",
      otp,
      purpose:       "resend",
      expiryMinutes: 15,
    });

    return res.json({
      success: true,
      message: "New verification code sent. Valid for 15 minutes.",
    });
  } catch (err) {
    handleError(res, err, "Resend failed");
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// CHECK EMAIL
// ═══════════════════════════════════════════════════════════════════════════

exports.checkEmail = async (req, res) => {
  try {
    const normalizedEmail = (req.body.email || "").trim().toLowerCase();
    if (!normalizedEmail)
      return res.status(400).json({ success: false, message: "Email is required" });

    const result = await query(
      "SELECT id, is_verified, auth_provider FROM users WHERE email = $1",
      [normalizedEmail],
    );
    return res.json({
      success: true,
      data: {
        exists:     result.rows.length > 0,
        isVerified: result.rows[0]?.is_verified  || false,
        provider:   result.rows[0]?.auth_provider || null,
      },
    });
  } catch (err) {
    handleError(res, err, "Email check failed");
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GOOGLE AUTH  — no reverification gate
// ═══════════════════════════════════════════════════════════════════════════

exports.googleAuth = async (req, res) => {
  try {
    const { credential, idToken, phone, bio, avatar } = req.body;
    const rawCredential = (credential || idToken || "").trim();

    if (!rawCredential)
      return res.status(400).json({ success: false, message: "Google credential is required" });
    if (!process.env.GOOGLE_CLIENT_ID)
      return res.status(500).json({ success: false, message: "Google auth not configured on server" });

    let payload;
    try {
      const client = getGoogleOAuthClient();
      const ticket = await client.verifyIdToken({
        idToken:  rawCredential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      logger.error("[Google Auth] Token verify failed:", err.message);
      return res.status(401).json({
        success: false,
        message: "Invalid Google credential. Please try again.",
      });
    }

    if (!payload?.sub || !payload?.email)
      return res.status(401).json({ success: false, message: "Could not get account info from Google" });
    if (payload.email_verified === false)
      return res.status(401).json({ success: false, message: "Please verify your Google email first" });

    const email      = payload.email.toLowerCase();
    const providerId = String(payload.sub).trim();
    const name       = (payload.name || email.split("@")[0] || "User").trim();

    const { user, isNew } = await upsertSocialUser({
      provider: "google", providerId, email, name,
      avatar: avatar || payload.picture, phone, bio,
    });

    const freshUser = await incrementLoginCounter(user.id);
    logger.info("[Google Auth] Success:", { email: freshUser.email, isNew });
    return respondWithAuth(res, freshUser, isNew);
  } catch (err) {
    handleError(res, err, "Google auth failed");
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE GOOGLE SIGN-UP  — no reverification gate
// ═══════════════════════════════════════════════════════════════════════════

exports.completeGoogleSignUp = async (req, res) => {
  try {
    const { credential, idToken, fullName, phone, bio, avatar } = req.body;
    const rawCredential = (credential || idToken || "").trim();

    if (!rawCredential)
      return res.status(400).json({ success: false, message: "Google credential is required" });
    if (!process.env.GOOGLE_CLIENT_ID)
      return res.status(500).json({ success: false, message: "Google auth not configured" });

    let payload;
    try {
      const client = getGoogleOAuthClient();
      const ticket = await client.verifyIdToken({
        idToken:  rawCredential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      return res.status(401).json({ success: false, message: "Invalid Google credential." });
    }

    if (!payload?.sub || !payload?.email)
      return res.status(401).json({ success: false, message: "Could not get account info from Google" });

    const email      = payload.email.toLowerCase();
    const providerId = String(payload.sub).trim();
    const name       = (fullName || payload.name || email.split("@")[0] || "User").trim();

    const { user, isNew } = await upsertSocialUser({
      provider: "google", providerId, email, name,
      avatar: avatar || payload.picture,
      phone:  phone  || null,
      bio:    bio    || null,
    });

    const freshUser = await incrementLoginCounter(user.id);
    logger.info("[Google Auth] Signup complete:", { email: freshUser.email, isNew });
    return respondWithAuth(res, freshUser, isNew);
  } catch (err) {
    handleError(res, err, "Google signup failed");
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GITHUB AUTH  — no reverification gate
// ═══════════════════════════════════════════════════════════════════════════

exports.githubAuth = async (req, res) => {
  try {
    const { code, phone, bio } = req.body;
    if (!code)
      return res.status(400).json({ success: false, message: "GitHub code is required" });
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET)
      return res.status(500).json({ success: false, message: "GitHub auth not configured" });

    const tokenData = await fetchJsonOrThrow(
      "https://github.com/login/oauth/access_token",
      {
        method:  "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body:    JSON.stringify({
          client_id:     process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      },
      "GitHub token exchange",
    );

    if (!tokenData.access_token)
      return res.status(401).json({ success: false, message: "GitHub did not return an access token." });

    const ghHeaders = {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept:        "application/vnd.github.v3+json",
      "User-Agent":  APP_NAME,
    };

    const gh = await fetchJsonOrThrow(
      "https://api.github.com/user", { headers: ghHeaders }, "GitHub profile",
    );

    let ghEmail = gh.email;
    if (!ghEmail) {
      const emails = await fetchJsonOrThrow(
        "https://api.github.com/user/emails", { headers: ghHeaders }, "GitHub emails",
      );
      const list = Array.isArray(emails) ? emails : [];
      ghEmail = list.find((e) => e.primary && e.verified)?.email
             || list.find((e) => e.verified)?.email
             || list[0]?.email;
    }

    if (!ghEmail)
      return res.status(400).json({ success: false, message: "Could not retrieve email from GitHub" });

    const email      = ghEmail.toLowerCase();
    const providerId = String(gh.id).trim();
    const name       = (gh.name || gh.login || email.split("@")[0] || "User").trim();

    const { user, isNew } = await upsertSocialUser({
      provider: "github", providerId, email, name,
      avatar: gh.avatar_url, phone, bio: bio || gh.bio,
    });

    const freshUser = await incrementLoginCounter(user.id);
    logger.info("[GitHub Auth] Success:", { email: freshUser.email, isNew });
    return respondWithAuth(res, freshUser, isNew);
  } catch (err) {
    handleError(res, err, "GitHub auth failed");
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GITHUB OAUTH REDIRECTS
// ═══════════════════════════════════════════════════════════════════════════

exports.githubSignInInit = async (req, res) => {
  try {
    if (!process.env.GITHUB_CLIENT_ID)
      return res.status(500).json({ success: false, message: "GitHub auth not configured" });
    const redirectUri = `${process.env.BACKEND_URL}/api/users/github/callback`;
    res.redirect(
      `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email`,
    );
  } catch (err) {
    res.redirect(`${process.env.FRONTEND_URL}/?error=github_init_failed`);
  }
};

exports.githubSignUpInit = exports.githubSignInInit;

exports.githubCallback = async (req, res) => {
  const FRONTEND = process.env.FRONTEND_URL || "https://altuvera.vercel.app";
  try {
    const { code } = req.query;
    if (!code || !process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET)
      return res.redirect(`${FRONTEND}/auth/github/callback?error=github_auth_failed`);

    const tokenData = await fetchJsonOrThrow(
      "https://github.com/login/oauth/access_token",
      {
        method:  "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body:    JSON.stringify({
          client_id:     process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      },
      "GitHub token exchange",
    );

    if (!tokenData.access_token)
      return res.redirect(`${FRONTEND}/auth/github/callback?error=github_token_failed`);

    const ghHeaders = {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept:        "application/vnd.github.v3+json",
      "User-Agent":  APP_NAME,
    };

    const gh = await fetchJsonOrThrow(
      "https://api.github.com/user", { headers: ghHeaders }, "GitHub profile",
    );

    let ghEmail = gh.email;
    if (!ghEmail) {
      const emails = await fetchJsonOrThrow(
        "https://api.github.com/user/emails", { headers: ghHeaders }, "GitHub emails",
      );
      const list = Array.isArray(emails) ? emails : [];
      ghEmail = list.find((e) => e.primary && e.verified)?.email
             || list.find((e) => e.verified)?.email
             || list[0]?.email;
    }

    if (!ghEmail || !gh.id)
      return res.redirect(`${FRONTEND}/auth/github/callback?error=github_profile_failed`);

    const email      = ghEmail.toLowerCase();
    const providerId = String(gh.id).trim();
    const name       = (gh.name || gh.login || email.split("@")[0] || "User").trim();

    const { user, isNew } = await upsertSocialUser({
      provider: "github", providerId, email, name,
      avatar: gh.avatar_url, phone: null, bio: gh.bio,
    });

    const freshUser = await incrementLoginCounter(user.id);
    const jwtToken  = generateToken(freshUser, "user");

    return res.redirect(
      `${FRONTEND}/auth/github/callback?` +
      new URLSearchParams({ code: jwtToken, provider: "github", isNew: String(isNew) }),
    );
  } catch (err) {
    logger.error("[GitHub Callback] Error:", err.message);
    return res.redirect(`${FRONTEND}/auth/github/callback?error=github_callback_failed`);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET ME
// ═══════════════════════════════════════════════════════════════════════════

exports.getMe = (req, res) =>
  res.json({ success: true, data: sanitizeUser(req.user) });

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE PROFILE
// ═══════════════════════════════════════════════════════════════════════════

exports.updateProfile = async (req, res) => {
  try {
    const { id } = req.user;
    const { full_name, fullName, avatar_url, avatar, phone, bio, preferences } = req.body;
    const resolvedName   = full_name  || fullName || null;
    const resolvedAvatar = avatar_url || avatar   || null;

    if (resolvedName && validateName && !validateName(resolvedName))
      return res.status(400).json({ success: false, message: "Name must be 2–50 characters." });

    const result = await query(
      `UPDATE users SET
         full_name   = COALESCE(NULLIF($1,''), full_name),
         avatar_url  = COALESCE(NULLIF($2,''), avatar_url),
         phone       = COALESCE($3, phone),
         bio         = COALESCE($4, bio),
         preferences = COALESCE($5::jsonb, preferences),
         updated_at  = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        resolvedName,
        resolvedAvatar,
        phone       || null,
        bio         || null,
        preferences
          ? typeof preferences === "string" ? preferences : JSON.stringify(preferences)
          : null,
        id,
      ],
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: "User not found" });

    sendActivityAlert({
      to:            result.rows[0].email,
      recipientName: result.rows[0].full_name || "",
      activityType:  "profile_updated",
    }).catch(() => {});

    return res.json({
      success: true,
      message: "Profile updated successfully.",
      data:    { user: sanitizeUser(result.rows[0]) },
    });
  } catch (err) {
    handleError(res, err, "Profile update failed");
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// REFRESH TOKEN
// ═══════════════════════════════════════════════════════════════════════════

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ success: false, message: "Refresh token is required" });

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: err.name === "TokenExpiredError"
          ? "Session expired. Please sign in again."
          : "Invalid refresh token.",
      });
    }

    if (decoded.tokenType !== "refresh")
      return res.status(401).json({ success: false, message: "Invalid token type" });

    const table  = decoded.type === "admin" ? "admin_users" : "users";
    const result = await query(`SELECT * FROM ${table} WHERE id = $1`, [decoded.id]);

    if (result.rows.length === 0)
      return res.status(401).json({ success: false, message: "Account not found." });

    const entity = result.rows[0];
    if (!entity.is_active)
      return res.status(401).json({ success: false, message: "Account deactivated." });

    if (
      typeof decoded.tokenVersion === "number" &&
      typeof entity.token_version === "number" &&
      decoded.tokenVersion !== entity.token_version
    ) {
      return res.status(401).json({
        success: false,
        message: "Session invalidated. Please sign in again.",
      });
    }

    return res.json({
      success: true,
      data: {
        token:        generateToken(entity, decoded.type),
        refreshToken: generateRefreshToken(entity, decoded.type),
      },
    });
  } catch (err) {
    handleError(res, err, "Token refresh failed", 401);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN AUTH
// ═══════════════════════════════════════════════════════════════════════════

exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail     = (email || "").trim().toLowerCase();

    if (!normalizedEmail || !password)
      return res.status(400).json({ success: false, message: "Email and password are required." });

    const result = await query(
      "SELECT * FROM admin_users WHERE email = $1",
      [normalizedEmail],
    );
    if (result.rows.length === 0)
      return res.status(401).json({ success: false, message: "Invalid credentials." });

    const admin = result.rows[0];
    if (!admin.is_active)
      return res.status(401).json({ success: false, message: "Account deactivated." });

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch)
      return res.status(401).json({ success: false, message: "Invalid credentials." });

    let freshAdmin = admin;
    try {
      const updated = await query(
        `UPDATE admin_users
           SET last_login    = NOW(),
               token_version = COALESCE(token_version, 0) + 1
         WHERE id = $1
         RETURNING *`,
        [admin.id],
      );
      freshAdmin = updated.rows[0];
    } catch (updateErr) {
      logger.warn("[adminLogin] token_version column missing:", updateErr.message);
      await query("UPDATE admin_users SET last_login = NOW() WHERE id = $1", [admin.id]);
      freshAdmin = { ...admin, last_login: new Date(), token_version: 0 };
    }

    return res.json({
      success: true,
      data: {
        token:        generateToken(freshAdmin, "admin"),
        refreshToken: generateRefreshToken(freshAdmin, "admin"),
        user:         sanitizeUser(freshAdmin),
      },
    });
  } catch (err) {
    handleError(res, err, "Admin login failed");
  }
};

exports.adminRegister = async (req, res) => {
  try {
    const { email, username, password, full_name, fullName, role } = req.body;
    const normalizedEmail    = (email    || "").trim().toLowerCase();
    const normalizedUsername = (username || "").trim();
    const resolvedName       = full_name || fullName || null;

    if (!normalizedEmail || !normalizedUsername || !password)
      return res.status(400).json({
        success: false,
        message: "Email, username, and password are required.",
      });

    const existing = await query(
      "SELECT id FROM admin_users WHERE email = $1 OR username = $2",
      [normalizedEmail, normalizedUsername],
    );
    if (existing.rows.length > 0)
      return res.status(409).json({ success: false, message: "Admin account already exists." });

    const passwordHash = await bcrypt.hash(password, 12);
    const created      = await query(
      `INSERT INTO admin_users (email, username, password_hash, full_name, role, is_active)
       VALUES ($1,$2,$3,$4,$5,true)
       RETURNING *`,
      [normalizedEmail, normalizedUsername, passwordHash, resolvedName, role || "admin"],
    );

    return res.status(201).json({
      success: true,
      data:    { user: sanitizeUser(created.rows[0]) },
    });
  } catch (err) {
    handleError(res, err, "Admin registration failed");
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword)
      return res.status(400).json({ success: false, message: "Both passwords are required." });

    const isMatch = await bcrypt.compare(oldPassword, req.user.password_hash);
    if (!isMatch)
      return res.status(401).json({ success: false, message: "Current password is incorrect." });

    const newHash = await bcrypt.hash(newPassword, 12);
    await query(
      "UPDATE admin_users SET password_hash = $1 WHERE id = $2",
      [newHash, req.user.id],
    );
    return res.json({ success: true, message: "Password updated successfully." });
  } catch (err) {
    handleError(res, err, "Password change failed");
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════════════════════════

exports.logout = async (req, res) => {
  try {
    if (req.user?.id) {
      const table = req.userType === "admin" ? "admin_users" : "users";
      try {
        await query(
          `UPDATE ${table}
             SET token_version = COALESCE(token_version, 0) + 1
           WHERE id = $1`,
          [req.user.id],
        );
      } catch (updateErr) {
        logger.warn("[logout] token_version update failed:", updateErr.message);
      }
    }
    return res.json({ success: true, message: "Signed out successfully." });
  } catch {
    return res.json({ success: true, message: "Signed out." });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DELETE ACCOUNT
// ═══════════════════════════════════════════════════════════════════════════

exports.deleteAccount = async (req, res) => {
  try {
    const { id, email, full_name } = req.user;
    const table = req.userType === "admin" ? "admin_users" : "users";

    if (email) {
      sendActivityAlert({
        to:            email,
        recipientName: full_name || "",
        activityType:  "account_deleted",
      }).catch(() => {});
    }

    await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    return res.json({ success: true, message: "Account deleted successfully." });
  } catch (err) {
    handleError(res, err, "Account deletion failed");
  }
};

// ── Export email builders for admin use ──────────────────────────────────
exports._emailBuilders = require("../utils/email");