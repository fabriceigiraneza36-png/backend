// controllers/authController.js
"use strict";

const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");
const crypto = require("crypto");
const https  = require("https");
const http   = require("http");

const { query }   = require("../config/db");
const {
  sendEmail,
  sendOtpEmail,
  sendWelcomeEmail,
  sendActivityAlert,
} = require("../utils/email");
const logger = require("../utils/logger");
const { validateEmail, validateName } = require("../utils/validators");

/* ════════════════════════════════════════════════════════════════
   CONFIG
════════════════════════════════════════════════════════════════ */
const APP_NAME               = process.env.APP_NAME              || "Altuvera";
const FRONTEND_URL           = process.env.FRONTEND_URL          || "https://altuvera.com";
const JWT_SECRET             = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET     = process.env.JWT_REFRESH_SECRET    || JWT_SECRET;
const JWT_EXPIRES_IN         = process.env.JWT_EXPIRES_IN        || "7d";
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "30d";
const OTP_EXPIRY_MINUTES     = 10;
const OTP_MAX_ATTEMPTS       = 5;
const CODE_COOLDOWN_MS       = 60_000;
const SOCIAL_TIMEOUT_MS      = parseInt(process.env.SOCIAL_AUTH_TIMEOUT_MS || "8000", 10);

/* Force IPv4 to avoid ENETUNREACH on dual-stack hosts */
const ipv4HttpsAgent = new https.Agent({ family: 4, keepAlive: true });
const ipv4HttpAgent  = new http.Agent({  family: 4, keepAlive: true });

/* ════════════════════════════════════════════════════════════════
   JWT / TOKEN HELPERS
════════════════════════════════════════════════════════════════ */
const _assertJwtSecret = () => {
  if (!JWT_SECRET) {
    const err  = new Error("JWT_SECRET environment variable is not set.");
    err.status = 500;
    throw err;
  }
};

const generateToken = (entity, type = "user") => {
  _assertJwtSecret();
  return jwt.sign(
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
};

const generateRefreshToken = (entity, type = "user") => {
  _assertJwtSecret();
  return jwt.sign(
    {
      id:           entity.id,
      type,
      tokenType:    "refresh",
      tokenVersion: entity.token_version ?? 0,
    },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN },
  );
};

/* ════════════════════════════════════════════════════════════════
   SERIALISER
════════════════════════════════════════════════════════════════ */
const sanitizeUser = (row) => {
  if (!row) return null;
  return {
    id:            row.id,
    email:         row.email,
    username:      row.username,
    fullName:      row.full_name,
    full_name:     row.full_name,
    name:          row.full_name,
    avatar:        row.avatar_url,
    avatarUrl:     row.avatar_url,
    avatar_url:    row.avatar_url,
    phone:         row.phone,
    bio:           row.bio,
    role:          row.role,
    authProvider:  row.auth_provider,
    auth_provider: row.auth_provider,
    isVerified:    row.is_verified,
    is_verified:   row.is_verified,
    emailVerified: row.is_verified,
    isActive:      row.is_active,
    preferences:   row.preferences,
    lastLogin:     row.last_login,
    loginCounter:  parseInt(row.login_counter  ?? 0, 10),
    login_counter: parseInt(row.login_counter  ?? 0, 10),
    subscribed:    row.subscribed ?? false,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
};

/* ════════════════════════════════════════════════════════════════
   RATE-LIMIT / COOLDOWN HELPERS
════════════════════════════════════════════════════════════════ */
const isRateLimited = (row, ms = CODE_COOLDOWN_MS) =>
  row.last_code_sent_at &&
  Date.now() - new Date(row.last_code_sent_at).getTime() < ms;

const getRemainingCooldown = (row) => {
  if (!row.last_code_sent_at) return 0;
  return Math.max(
    0,
    Math.ceil(
      (CODE_COOLDOWN_MS - (Date.now() - new Date(row.last_code_sent_at).getTime())) / 1000,
    ),
  );
};

/* ════════════════════════════════════════════════════════════════
   ERROR / RESPONSE HELPERS
════════════════════════════════════════════════════════════════ */
const handleError = (res, err, message = "Operation failed", status = 500) => {
  logger.error(`[Auth] ${message}:`, { error: err.message, stack: err.stack });
  return res.status(err.status || status).json({
    success: false,
    message: err.message || message,
    ...(process.env.NODE_ENV === "development" && { debug: err.stack }),
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
      loginCounter: parseInt(user.login_counter ?? 0, 10),
    },
  });

/* ════════════════════════════════════════════════════════════════
   OTP
════════════════════════════════════════════════════════════════ */
const generateOTP = () => crypto.randomInt(100_000, 999_999).toString();

const setOtp = (userId, otp, expiryMinutes = OTP_EXPIRY_MINUTES) =>
  query(
    `UPDATE users SET
       verification_code = $1,
       code_expiry       = NOW() + ($2 || ' minutes')::interval,
       code_attempts     = 0,
       last_code_sent_at = NOW()
     WHERE id = $3`,
    [otp, expiryMinutes, userId],
  );

/* ════════════════════════════════════════════════════════════════
   SOCIAL AUTH HELPERS
════════════════════════════════════════════════════════════════ */
let _googleClient = null;
const getGoogleClient = () => {
  if (!_googleClient) {
    const { OAuth2Client } = require("google-auth-library");
    _googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }
  return _googleClient;
};

const fetchJsonOrThrow = async (url, options = {}, label = "request") => {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SOCIAL_TIMEOUT_MS);

  try {
    const agent = url.startsWith("https://") ? ipv4HttpsAgent : ipv4HttpAgent;
    const res   = await fetch(url, { ...options, signal: ctrl.signal, agent: () => agent });

    const raw  = await res.text();
    let   body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }

    if (!res.ok) {
      const e  = new Error(body?.message || `${label} failed (HTTP ${res.status})`);
      e.status = 401;
      throw e;
    }
    return body;
  } catch (err) {
    if (err.name === "AbortError") {
      const e  = new Error(`${label} timed out after ${SOCIAL_TIMEOUT_MS}ms`);
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const upsertSocialUser = async ({ provider, providerId, email, name, avatar, phone, bio }) => {
  const col = { google: "google_id", github: "github_id" }[provider];
  if (!col) throw Object.assign(new Error(`Unsupported provider: ${provider}`), { status: 400 });

  const e   = (email  || "").trim().toLowerCase();
  const n   = (name   || "").trim() || e.split("@")[0] || "User";
  const pid = String(providerId || "").trim();

  if (!pid)
    throw Object.assign(new Error(`${provider} account ID missing`), { status: 401 });
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    throw Object.assign(new Error("Valid email required from OAuth provider"), { status: 400 });

  const result = await query(
    `INSERT INTO users (
       email, full_name, avatar_url, ${col},
       auth_provider, phone, bio,
       is_verified, is_active, last_login, role, login_counter
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

  const user  = result.rows[0];
  const isNew = Boolean(user.is_new_row);

  if (isNew) {
    sendWelcomeEmail({ to: user.email, recipientName: user.full_name || "" })
      .catch((err) => logger.warn("[Auth] Welcome email failed:", err.message));
  }

  return { user, isNew };
};

const incrementLoginCounter = async (userId) => {
  const r = await query(
    `UPDATE users
       SET login_counter = COALESCE(login_counter, 0) + 1, last_login = NOW()
     WHERE id = $1 RETURNING *`,
    [userId],
  );
  return r.rows[0];
};

/* ════════════════════════════════════════════════════════════════
   REGISTER
════════════════════════════════════════════════════════════════ */
exports.register = async (req, res) => {
  try {
    const { email, fullName, full_name, phone, bio, avatar } = req.body;
    const name  = ((fullName || full_name || "").trim()).slice(0, 100);
    const nEmail = ((email   || "").trim().toLowerCase());

    if (!nEmail)
      return res.status(400).json({ success: false, message: "Email is required." });
    if (validateEmail && !validateEmail(nEmail))
      return res.status(400).json({ success: false, message: "Invalid email address." });
    if (name && validateName && !validateName(name))
      return res.status(400).json({ success: false, message: "Name must be 2–50 characters." });

    const existing = await query("SELECT * FROM users WHERE email = $1", [nEmail]);

    if (existing.rows.length) {
      const user = existing.rows[0];
      if (user.is_verified)
        return res.status(409).json({ success: false, message: "Account exists. Please sign in." });
      if (isRateLimited(user))
        return res.status(429).json({
          success: false,
          message: `Wait ${getRemainingCooldown(user)} second(s) before requesting a new code.`,
        });

      /* Patch optional profile fields */
      if (name || phone || bio || avatar) {
        await query(
          `UPDATE users SET
             full_name  = COALESCE(NULLIF($1,''), full_name),
             phone      = COALESCE(NULLIF($2,''), phone),
             bio        = COALESCE(NULLIF($3,''), bio),
             avatar_url = COALESCE(NULLIF($4,''), avatar_url)
           WHERE id = $5`,
          [name, phone || null, bio || null, avatar || null, user.id],
        );
      }

      const otp = generateOTP();
      await setOtp(user.id, otp);
      await sendOtpEmail({ to: nEmail, recipientName: name || user.full_name || "", otp, purpose: "verify", expiryMinutes: OTP_EXPIRY_MINUTES });

      return res.json({ success: true, message: "Verification code sent. Check your inbox.", data: { email: nEmail } });
    }

    /* New user */
    const created = await query(
      `INSERT INTO users (email, full_name, phone, bio, avatar_url, is_verified, auth_provider, login_counter)
       VALUES ($1,$2,$3,$4,$5,false,'email',0) RETURNING *`,
      [nEmail, name || null, phone || null, bio || null, avatar || null],
    );

    const otp = generateOTP();
    await setOtp(created.rows[0].id, otp);
    await sendOtpEmail({ to: nEmail, recipientName: name || "", otp, purpose: "verify", expiryMinutes: OTP_EXPIRY_MINUTES });

    return res.status(201).json({
      success: true,
      message: "Account created! Check your inbox for the verification code.",
      data: { email: nEmail, requiresVerification: true },
    });
  } catch (err) {
    handleError(res, err, "Registration failed");
  }
};

/* ════════════════════════════════════════════════════════════════
   LOGIN — always OTP-based (passwordless)
════════════════════════════════════════════════════════════════ */
exports.login = async (req, res) => {
  try {
    const { email, fullName, full_name } = req.body;
    const name   = ((fullName || full_name || "").trim()).slice(0, 100);
    const nEmail = ((email   || "").trim().toLowerCase());

    if (!nEmail)
      return res.status(400).json({ success: false, message: "Email is required." });
    if (validateEmail && !validateEmail(nEmail))
      return res.status(400).json({ success: false, message: "Invalid email address." });

    let result = await query("SELECT * FROM users WHERE email = $1", [nEmail]);
    let isNew  = false;

    if (!result.rows.length) {
      result = await query(
        `INSERT INTO users (email, full_name, is_verified, auth_provider, login_counter)
         VALUES ($1,$2,false,'email',0) RETURNING *`,
        [nEmail, name || null],
      );
      isNew = true;
    }

    const user = result.rows[0];

    if (user.is_active === false)
      return res.status(401).json({ success: false, message: "Account deactivated. Contact support." });

    if (isRateLimited(user))
      return res.status(429).json({
        success: false,
        message: `Wait ${getRemainingCooldown(user)} second(s) before requesting a new code.`,
      });

    const otp     = generateOTP();
    const purpose = isNew ? "verify" : "login";

    await setOtp(user.id, otp);
    await sendOtpEmail({ to: nEmail, recipientName: user.full_name || name || "", otp, purpose, expiryMinutes: OTP_EXPIRY_MINUTES });

    return res.json({
      success: true,
      message: "Verification code sent to your inbox.",
      data: { email: nEmail, isNewUser: isNew },
    });
  } catch (err) {
    handleError(res, err, "Login failed");
  }
};

/* ════════════════════════════════════════════════════════════════
   VERIFY CODE
════════════════════════════════════════════════════════════════ */
exports.verifyCode = async (req, res) => {
  try {
    const code   = String(req.body.code   || "").replace(/\D/g, "").slice(0, 6);
    const nEmail = ((req.body.email || "").trim().toLowerCase());

    if (!nEmail || !code)
      return res.status(400).json({ success: false, message: "Email and code are required." });
    if (code.length !== 6)
      return res.status(400).json({ success: false, message: "Enter a valid 6-digit code." });

    const result = await query("SELECT * FROM users WHERE email = $1", [nEmail]);
    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Account not found." });

    const user = result.rows[0];

    if ((user.code_attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
      await query("UPDATE users SET verification_code = NULL, code_expiry = NULL WHERE id = $1", [user.id]);
      return res.status(429).json({ success: false, message: "Too many attempts. Request a new code." });
    }

    const codeOk   = user.verification_code === code;
    const notExpired = user.code_expiry && new Date(user.code_expiry) > new Date();

    if (!codeOk || !notExpired) {
      await query(
        "UPDATE users SET code_attempts = COALESCE(code_attempts, 0) + 1 WHERE id = $1", [user.id],
      );
      const remaining = OTP_MAX_ATTEMPTS - ((user.code_attempts ?? 0) + 1);

      if (codeOk && !notExpired)
        return res.status(401).json({ success: false, message: "Code expired. Request a new one." });

      return res.status(401).json({
        success: false,
        message: remaining > 0
          ? `Incorrect code — ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
          : "Too many attempts. Request a new code.",
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
       WHERE id = $1 RETURNING *`,
      [user.id],
    );

    const freshUser = updated.rows[0];

    if (isFirstVerification) {
      sendWelcomeEmail({ to: user.email, recipientName: user.full_name || "" }).catch(() => {});
    }

    return res.json({
      success: true,
      message: isFirstVerification ? "Account verified! Welcome to Altuvera!" : "Signed in successfully!",
      data: {
        token:        generateToken(freshUser, "user"),
        refreshToken: generateRefreshToken(freshUser, "user"),
        user:         sanitizeUser(freshUser),
        isNewUser:    isFirstVerification,
        loginCounter: parseInt(freshUser.login_counter, 10),
      },
    });
  } catch (err) {
    handleError(res, err, "Verification failed");
  }
};

/* ════════════════════════════════════════════════════════════════
   RESEND CODE
════════════════════════════════════════════════════════════════ */
exports.resendCode = async (req, res) => {
  try {
    const nEmail = ((req.body.email || "").trim().toLowerCase());
    if (!nEmail)
      return res.status(400).json({ success: false, message: "Email is required." });

    const result = await query(
      "SELECT id, email, full_name, last_code_sent_at, is_active FROM users WHERE email = $1",
      [nEmail],
    );

    /* Anti-enumeration */
    if (!result.rows.length)
      return res.json({ success: true, message: "If an account exists, a new code has been sent." });

    const user = result.rows[0];

    if (!user.is_active)
      return res.status(401).json({ success: false, message: "Account deactivated." });

    if (isRateLimited(user))
      return res.status(429).json({
        success: false,
        message: `Wait ${getRemainingCooldown(user)} second(s) before requesting again.`,
      });

    const otp = generateOTP();
    await setOtp(user.id, otp, 15);
    await sendOtpEmail({ to: user.email, recipientName: user.full_name || "", otp, purpose: "resend", expiryMinutes: 15 });

    return res.json({ success: true, message: "New code sent — valid for 15 minutes." });
  } catch (err) {
    handleError(res, err, "Resend failed");
  }
};

/* ════════════════════════════════════════════════════════════════
   CHECK EMAIL
════════════════════════════════════════════════════════════════ */
exports.checkEmail = async (req, res) => {
  try {
    const nEmail = ((req.body.email || "").trim().toLowerCase());
    if (!nEmail)
      return res.status(400).json({ success: false, message: "Email is required." });

    const result = await query(
      "SELECT id, is_verified, auth_provider FROM users WHERE email = $1", [nEmail],
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

/* ════════════════════════════════════════════════════════════════
   GOOGLE AUTH
════════════════════════════════════════════════════════════════ */
exports.googleAuth = async (req, res) => {
  try {
    const rawCredential = ((req.body.credential || req.body.idToken || "").trim());

    if (!rawCredential)
      return res.status(400).json({ success: false, message: "Google credential is required." });
    if (!process.env.GOOGLE_CLIENT_ID)
      return res.status(500).json({ success: false, message: "Google auth is not configured." });

    let payload;
    try {
      const ticket = await getGoogleClient().verifyIdToken({
        idToken:  rawCredential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      logger.error("[Google Auth] Token verify failed:", err.message);
      return res.status(401).json({ success: false, message: "Invalid Google credential. Please try again." });
    }

    if (!payload?.sub || !payload?.email)
      return res.status(401).json({ success: false, message: "Could not retrieve account info from Google." });
    if (payload.email_verified === false)
      return res.status(401).json({ success: false, message: "Your Google email is not verified." });

    const { user, isNew } = await upsertSocialUser({
      provider:   "google",
      providerId: payload.sub,
      email:      payload.email.toLowerCase(),
      name:       payload.name || payload.email.split("@")[0],
      avatar:     req.body.avatar || payload.picture,
      phone:      req.body.phone  || null,
      bio:        req.body.bio    || null,
    });

    const freshUser = await incrementLoginCounter(user.id);
    logger.info("[Google Auth] Success:", { email: freshUser.email, isNew });
    return respondWithAuth(res, freshUser, isNew);
  } catch (err) {
    handleError(res, err, "Google auth failed");
  }
};

/* ════════════════════════════════════════════════════════════════
   COMPLETE GOOGLE SIGN-UP
════════════════════════════════════════════════════════════════ */
exports.completeGoogleSignUp = async (req, res) => {
  try {
    const rawCredential = ((req.body.credential || req.body.idToken || "").trim());

    if (!rawCredential)
      return res.status(400).json({ success: false, message: "Google credential is required." });
    if (!process.env.GOOGLE_CLIENT_ID)
      return res.status(500).json({ success: false, message: "Google auth is not configured." });

    let payload;
    try {
      const ticket = await getGoogleClient().verifyIdToken({
        idToken:  rawCredential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ success: false, message: "Invalid Google credential." });
    }

    if (!payload?.sub || !payload?.email)
      return res.status(401).json({ success: false, message: "Could not retrieve account info from Google." });

    const { user, isNew } = await upsertSocialUser({
      provider:   "google",
      providerId: payload.sub,
      email:      payload.email.toLowerCase(),
      name:       (req.body.fullName || payload.name || payload.email.split("@")[0]).trim(),
      avatar:     req.body.avatar || payload.picture,
      phone:      req.body.phone  || null,
      bio:        req.body.bio    || null,
    });

    const freshUser = await incrementLoginCounter(user.id);
    logger.info("[Google Signup] Complete:", { email: freshUser.email, isNew });
    return respondWithAuth(res, freshUser, isNew);
  } catch (err) {
    handleError(res, err, "Google signup failed");
  }
};

/* ════════════════════════════════════════════════════════════════
   GITHUB AUTH (token exchange)
════════════════════════════════════════════════════════════════ */
exports.githubAuth = async (req, res) => {
  try {
    const { code, phone, bio } = req.body;
    if (!code)
      return res.status(400).json({ success: false, message: "GitHub code is required." });
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET)
      return res.status(500).json({ success: false, message: "GitHub auth is not configured." });

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

    const gh = await fetchJsonOrThrow("https://api.github.com/user", { headers: ghHeaders }, "GitHub profile");

    let ghEmail = gh.email;
    if (!ghEmail) {
      const emails = await fetchJsonOrThrow("https://api.github.com/user/emails", { headers: ghHeaders }, "GitHub emails");
      const list   = Array.isArray(emails) ? emails : [];
      ghEmail = list.find((e) => e.primary && e.verified)?.email
             || list.find((e) => e.verified)?.email
             || list[0]?.email;
    }

    if (!ghEmail)
      return res.status(400).json({ success: false, message: "Could not retrieve email from GitHub." });

    const { user, isNew } = await upsertSocialUser({
      provider:   "github",
      providerId: String(gh.id),
      email:      ghEmail.toLowerCase(),
      name:       gh.name || gh.login || ghEmail.split("@")[0],
      avatar:     gh.avatar_url,
      phone:      phone || null,
      bio:        bio || gh.bio || null,
    });

    const freshUser = await incrementLoginCounter(user.id);
    logger.info("[GitHub Auth] Success:", { email: freshUser.email, isNew });
    return respondWithAuth(res, freshUser, isNew);
  } catch (err) {
    handleError(res, err, "GitHub auth failed");
  }
};

/* ════════════════════════════════════════════════════════════════
   GITHUB OAUTH REDIRECT FLOW
════════════════════════════════════════════════════════════════ */
const GITHUB_CALLBACK_URL =
  process.env.GITHUB_CALLBACK_URL || "https://altuverasafaris.com/auth/github/callback";

exports.githubSignInInit = async (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID)
    return res.status(500).json({ success: false, message: "GitHub auth not configured." });
  const redirect = GITHUB_CALLBACK_URL;
  res.redirect(
    `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirect)}&scope=read:user,user:email`,
  );
};

exports.githubSignUpInit = exports.githubSignInInit;

exports.githubCallback = async (req, res) => {
  const FRONTEND = process.env.FRONTEND_URL || "https://altuverasafaris.com";
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

    const gh = await fetchJsonOrThrow("https://api.github.com/user", { headers: ghHeaders }, "GitHub profile");

    let ghEmail = gh.email;
    if (!ghEmail) {
      const emails = await fetchJsonOrThrow("https://api.github.com/user/emails", { headers: ghHeaders }, "GitHub emails");
      const list   = Array.isArray(emails) ? emails : [];
      ghEmail = list.find((e) => e.primary && e.verified)?.email
             || list.find((e) => e.verified)?.email
             || list[0]?.email;
    }

    if (!ghEmail || !gh.id)
      return res.redirect(`${FRONTEND}/auth/github/callback?error=github_profile_failed`);

    const { user, isNew } = await upsertSocialUser({
      provider:   "github",
      providerId: String(gh.id),
      email:      ghEmail.toLowerCase(),
      name:       gh.name || gh.login || ghEmail.split("@")[0],
      avatar:     gh.avatar_url,
      phone:      null,
      bio:        gh.bio || null,
    });

    const freshUser = await incrementLoginCounter(user.id);
    const token     = generateToken(freshUser, "user");

    return res.redirect(
      `${FRONTEND}/auth/github/callback?` +
      new URLSearchParams({ code: token, provider: "github", isNew: String(isNew) }),
    );
  } catch (err) {
    logger.error("[GitHub Callback] Error:", err.message);
    return res.redirect(`${FRONTEND}/auth/github/callback?error=github_callback_failed`);
  }
};

/* ════════════════════════════════════════════════════════════════
   GET ME
════════════════════════════════════════════════════════════════ */
exports.getMe = (req, res) =>
  res.json({ success: true, data: sanitizeUser(req.user) });

/* ════════════════════════════════════════════════════════════════
   UPDATE PROFILE
════════════════════════════════════════════════════════════════ */
exports.updateProfile = async (req, res) => {
  try {
    const { id }   = req.user;
    const body     = req.body || {};
    const name     = (body.full_name  || body.fullName  || "").trim().slice(0, 100) || null;
    const avatar   = (body.avatar_url || body.avatar    || "").trim().slice(0, 500) || null;
    const phone    = body.phone       != null ? String(body.phone).trim().slice(0, 30)  || null : undefined;
    const bio      = body.bio         != null ? String(body.bio).trim().slice(0, 1000)  || null : undefined;
    const prefs    = body.preferences != null
      ? (typeof body.preferences === "string" ? body.preferences : JSON.stringify(body.preferences))
      : undefined;

    if (name && validateName && !validateName(name))
      return res.status(400).json({ success: false, message: "Name must be 2–50 characters." });

    const result = await query(
      `UPDATE users SET
         full_name   = COALESCE(NULLIF($1,''), full_name),
         avatar_url  = COALESCE(NULLIF($2,''), avatar_url),
         phone       = COALESCE($3, phone),
         bio         = COALESCE($4, bio),
         preferences = COALESCE($5::jsonb, preferences),
         updated_at  = NOW()
       WHERE id = $6 RETURNING *`,
      [name, avatar, phone ?? null, bio ?? null, prefs ?? null, id],
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "User not found." });

    sendActivityAlert({ to: result.rows[0].email, recipientName: result.rows[0].full_name || "", activityType: "profile_updated" }).catch(() => {});

    return res.json({ success: true, message: "Profile updated.", data: { user: sanitizeUser(result.rows[0]) } });
  } catch (err) {
    handleError(res, err, "Profile update failed");
  }
};

/* ════════════════════════════════════════════════════════════════
   REFRESH TOKEN
════════════════════════════════════════════════════════════════ */
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ success: false, message: "Refresh token required." });

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
      return res.status(401).json({ success: false, message: "Invalid token type." });

    const table  = decoded.type === "admin" ? "admin_users" : "users";
    const result = await query(`SELECT * FROM ${table} WHERE id = $1`, [decoded.id]);

    if (!result.rows.length)
      return res.status(401).json({ success: false, message: "Account not found." });

    const entity = result.rows[0];

    if (!entity.is_active)
      return res.status(401).json({ success: false, message: "Account deactivated." });

    if (
      typeof decoded.tokenVersion === "number" &&
      typeof entity.token_version === "number" &&
      decoded.tokenVersion !== entity.token_version
    ) {
      return res.status(401).json({ success: false, message: "Session invalidated. Please sign in again." });
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

/* ════════════════════════════════════════════════════════════════
   ADMIN AUTH
════════════════════════════════════════════════════════════════ */
exports.adminLogin = async (req, res) => {
  try {
    const nEmail   = ((req.body.email    || "").trim().toLowerCase());
    const password = ((req.body.password || "").trim());

    if (!nEmail || !password)
      return res.status(400).json({ success: false, message: "Email and password are required." });

    const result = await query("SELECT * FROM admin_users WHERE email = $1", [nEmail]);
    if (!result.rows.length)
      return res.status(401).json({ success: false, message: "Invalid credentials." });

    const admin = result.rows[0];
    if (!admin.is_active)
      return res.status(401).json({ success: false, message: "Account deactivated." });

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch)
      return res.status(401).json({ success: false, message: "Invalid credentials." });

    let freshAdmin;
    try {
      const updated = await query(
        `UPDATE admin_users
           SET last_login = NOW(), token_version = COALESCE(token_version, 0) + 1
         WHERE id = $1 RETURNING *`,
        [admin.id],
      );
      freshAdmin = updated.rows[0];
    } catch {
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
    const nEmail    = ((req.body.email    || "").trim().toLowerCase());
    const nUsername = ((req.body.username || "").trim());
    const password  = ((req.body.password || "").trim());
    const name      = ((req.body.full_name || req.body.fullName || "").trim()).slice(0, 100) || null;
    const role      = req.body.role || "admin";

    if (!nEmail || !nUsername || !password)
      return res.status(400).json({ success: false, message: "Email, username, and password are required." });

    if (password.length < 8)
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });

    const exists = await query(
      "SELECT id FROM admin_users WHERE email = $1 OR username = $2", [nEmail, nUsername],
    );
    if (exists.rows.length)
      return res.status(409).json({ success: false, message: "Admin account already exists." });

    const hash    = await bcrypt.hash(password, 12);
    const created = await query(
      `INSERT INTO admin_users (email, username, password_hash, full_name, role, is_active)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
      [nEmail, nUsername, hash, name, role],
    );

    return res.status(201).json({ success: true, data: { user: sanitizeUser(created.rows[0]) } });
  } catch (err) {
    handleError(res, err, "Admin registration failed");
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword)
      return res.status(400).json({ success: false, message: "Both passwords are required." });
    if (newPassword.length < 8)
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters." });

    const ok = await bcrypt.compare(oldPassword, req.user.password_hash);
    if (!ok)
      return res.status(401).json({ success: false, message: "Current password is incorrect." });

    const hash = await bcrypt.hash(newPassword, 12);
    await query("UPDATE admin_users SET password_hash = $1 WHERE id = $2", [hash, req.user.id]);
    return res.json({ success: true, message: "Password updated successfully." });
  } catch (err) {
    handleError(res, err, "Password change failed");
  }
};

/* ════════════════════════════════════════════════════════════════
   LOGOUT
════════════════════════════════════════════════════════════════ */
exports.logout = async (req, res) => {
  try {
    if (req.user?.id) {
      const table = req.userType === "admin" ? "admin_users" : "users";
      await query(
        `UPDATE ${table} SET token_version = COALESCE(token_version, 0) + 1 WHERE id = $1`,
        [req.user.id],
      ).catch((e) => logger.warn("[logout] token_version update failed:", e.message));
    }
    return res.json({ success: true, message: "Signed out successfully." });
  } catch {
    return res.json({ success: true, message: "Signed out." });
  }
};

/* ════════════════════════════════════════════════════════════════
   DELETE ACCOUNT
════════════════════════════════════════════════════════════════ */
exports.deleteAccount = async (req, res) => {
  try {
    const { id, email, full_name } = req.user;
    const table = req.userType === "admin" ? "admin_users" : "users";

    if (email) {
      sendActivityAlert({ to: email, recipientName: full_name || "", activityType: "account_deleted" }).catch(() => {});
    }

    await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    return res.json({ success: true, message: "Account deleted successfully." });
  } catch (err) {
    handleError(res, err, "Account deletion failed");
  }
};

/* ── Re-export email builders for admin routes ── */
exports._emailBuilders = require("../utils/email");