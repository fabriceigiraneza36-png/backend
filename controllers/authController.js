// controllers/authController.js
// ═══════════════════════════════════════════════════════════════════════════
// Passwordless Auth — Users have email + name only, NO passwords
// Auth methods: OTP code via email, Google OAuth, GitHub OAuth
// ═══════════════════════════════════════════════════════════════════════════

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { query } = require("../config/db");
const { sendEmail } = require("../utils/email");
const logger = require("../utils/logger");
const { validateEmail, validateName } = require("../utils/validators");

// ═════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═════════════════════════════════════════════════════════════════════════════

const APP_NAME = process.env.APP_NAME || "Altuvera";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://altuvera.com";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@altuvera.com";
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "30d";
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const CODE_COOLDOWN_MS = 60000;
const SOCIAL_HTTP_TIMEOUT_MS = parseInt(process.env.SOCIAL_AUTH_TIMEOUT_MS || "8000", 10);

// ═════════════════════════════════════════════════════════════════════════════
// 🎨 EMAIL TEMPLATES
// ═════════════════════════════════════════════════════════════════════════════

const buildEmailTemplate = ({
  preheader = "", title = "", subtitle = "", body = "",
  ctaText = "", ctaUrl = "", recipientName = "", footerNote = "",
}) => {
  const year = new Date().getFullYear();
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body, table, td, p, a { -webkit-text-size-adjust: 100%; }
    table { border-collapse: collapse; }
    body {
      margin: 0; padding: 0; width: 100%; background-color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    }
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .content-pad { padding: 24px 20px !important; }
      .otp-code { font-size: 32px !important; letter-spacing: 4px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5;">
  <div style="display:none; max-height:0; overflow:hidden;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" class="container" width="520" cellpadding="0" cellspacing="0"
               style="max-width:520px; width:100%; background:#fff; border-radius:24px; box-shadow:0 8px 20px rgba(0,0,0,0.05);">
          <tr>
            <td align="center" style="background:#059669; border-radius:24px 24px 0 0; padding:32px 24px;">
              <a href="${FRONTEND_URL}" style="text-decoration:none; color:#fff; font-size:24px; font-weight:700;">${APP_NAME}</a>
            </td>
          </tr>
          <tr>
            <td align="center" class="content-pad" style="padding:36px 32px;">
              ${recipientName ? `<p style="margin:0 0 16px; font-size:16px; color:#111827; font-weight:500;">Hello ${recipientName},</p>` : ""}
              <h1 style="margin:0 0 8px; font-size:24px; font-weight:600; color:#111827;">${title}</h1>
              ${subtitle ? `<p style="margin:0 0 24px; font-size:15px; color:#6b7280;">${subtitle}</p>` : ""}
              ${body}
              ${ctaText && ctaUrl ? `
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:32px auto 0;">
                <tr><td align="center">
                  <a href="${ctaUrl}" style="display:inline-block; padding:14px 36px; background:#059669; color:#fff; text-decoration:none; border-radius:40px; font-size:16px; font-weight:600;">${ctaText}</a>
                </td></tr>
              </table>` : ""}
              ${footerNote ? `<p style="margin:24px 0 0; font-size:13px; color:#9ca3af; border-top:1px solid #e5e7eb; padding-top:20px;">${footerNote}</p>` : ""}
            </td>
          </tr>
          <tr>
            <td align="center" style="background:#f9fafb; padding:24px; border-radius:0 0 24px 24px;">
              <p style="margin:0 0 12px; font-size:13px;">
                <a href="${FRONTEND_URL}" style="color:#4b5563; text-decoration:none; margin:0 10px;">Home</a>
                <span style="color:#d1d5db;">|</span>
                <a href="mailto:${SUPPORT_EMAIL}" style="color:#4b5563; text-decoration:none; margin:0 10px;">Support</a>
              </p>
              <p style="margin:0; font-size:12px; color:#9ca3af;">&copy; ${year} ${APP_NAME}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const buildOtpEmail = ({ otp, recipientName, purpose = "verify", expiryMinutes = OTP_EXPIRY_MINUTES }) => {
  const cfg = {
    verify: { title: "Verify Your Email", sub: "Enter the code below to verify your account" },
    login: { title: "Your Sign-In Code", sub: "Use this code to sign in" },
    resend: { title: "New Verification Code", sub: "Here's your fresh code" },
  }[purpose] || { title: "Verification Code", sub: "" };

  return buildEmailTemplate({
    preheader: `Your code is ${otp}`,
    title: cfg.title,
    subtitle: cfg.sub,
    recipientName,
    body: `
      <p style="margin:0 0 24px; font-size:15px; color:#4b5563;">Valid for <strong>${expiryMinutes} minutes</strong>.</p>
      <div style="background:#f3f4f6; border-radius:12px; padding:16px 24px; margin:0 auto 16px; display:inline-block;">
        <span class="otp-code" style="font-family:'Courier New',monospace; font-size:36px; font-weight:700; letter-spacing:8px; color:#059669;">${otp}</span>
      </div>
      <p style="margin:0; font-size:13px; color:#6b7280;">Expires in ${expiryMinutes} minutes</p>
    `,
    footerNote: "Didn't request this? Safely ignore this email.",
  });
};

const buildWelcomeEmail = ({ recipientName }) => {
  return buildEmailTemplate({
    preheader: `Welcome to ${APP_NAME}!`,
    title: `Welcome to ${APP_NAME}!`,
    subtitle: "Your account is verified and ready",
    recipientName,
    body: `<p style="margin:0 0 24px; font-size:15px; color:#4b5563;">We're thrilled to have you. Start exploring curated East African experiences.</p>`,
    ctaText: "Start Exploring →",
    ctaUrl: `${FRONTEND_URL}/destinations`,
  });
};

const buildActivityAlertEmail = ({ recipientName, activityType }) => {
  const titles = { profile_updated: "Profile Updated", account_deleted: "Account Deleted" };
  return buildEmailTemplate({
    preheader: `${titles[activityType] || "Activity"} on your account`,
    title: titles[activityType] || "Account Activity",
    subtitle: "We detected activity on your account",
    recipientName,
    body: `<p style="margin:0; font-size:15px; color:#4b5563;">Time: ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>`,
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// 🛠️ HELPERS
// ═════════════════════════════════════════════════════════════════════════════

const generateOTP = () => crypto.randomInt(100000, 999999).toString();

const generateToken = (entity, type = "user") => {
  return jwt.sign(
    { id: entity.id, email: entity.email, role: entity.role || (type === "admin" ? "admin" : "user"), type, tokenVersion: entity.token_version ?? 0 },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

const generateRefreshToken = (entity, type = "user") => {
  return jwt.sign(
    { id: entity.id, type, tokenType: "refresh", tokenVersion: entity.token_version ?? 0 },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );
};

const sanitizeUser = (row) => {
  if (!row) return null;
  const { verification_code, code_expiry, code_attempts, last_code_sent_at, google_id, github_id, token_version, ...safe } = row;
  return {
    id: safe.id,
    email: safe.email,
    fullName: safe.full_name,
    full_name: safe.full_name,
    name: safe.full_name,
    avatar: safe.avatar_url,
    avatarUrl: safe.avatar_url,
    avatar_url: safe.avatar_url,
    phone: safe.phone,
    bio: safe.bio,
    role: safe.role,
    authProvider: safe.auth_provider,
    auth_provider: safe.auth_provider,
    isVerified: safe.is_verified,
    is_verified: safe.is_verified,
    emailVerified: safe.is_verified,
    isActive: safe.is_active,
    preferences: safe.preferences,
    lastLogin: safe.last_login,
    createdAt: safe.created_at,
    updatedAt: safe.updated_at,
  };
};

const isRateLimited = (row, ms = CODE_COOLDOWN_MS) =>
  row.last_code_sent_at && Date.now() - new Date(row.last_code_sent_at).getTime() < ms;

const getRemainingCooldown = (row) => {
  if (!row.last_code_sent_at) return 0;
  return Math.ceil((CODE_COOLDOWN_MS - (Date.now() - new Date(row.last_code_sent_at).getTime())) / 1000);
};

const handleError = (res, err, message = "Operation failed", status = 500) => {
  logger.error(`[Auth] ${message}:`, { error: err.message });
  return res.status(err.status || status).json({
    success: false,
    message: err.message || message,
  });
};

const sendOtpEmail = async (email, otp, name, purpose = "verify") => {
  return sendEmail({
    to: email,
    subject: purpose === "login" ? `Sign In Code: ${otp}` : `Verification Code: ${otp}`,
    html: buildOtpEmail({ otp, recipientName: name, purpose }),
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// SOCIAL HELPERS
// ═════════════════════════════════════════════════════════════════════════════

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
  const timeout = setTimeout(() => controller.abort(), SOCIAL_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const raw = await res.text();
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
    if (!res.ok) {
      const err = new Error(body?.message || `${provider} failed (${res.status})`);
      err.status = 401;
      throw err;
    }
    return body;
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error(`${provider} request timed out`);
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
};

const upsertSocialUser = async ({ provider, providerId, email, name, avatar, phone, bio }) => {
  const col = { google: "google_id", github: "github_id" }[provider];
  if (!col) throw new Error(`Unsupported provider: ${provider}`);

  const e = (email || "").trim().toLowerCase();
  const n = (name || "").trim() || e.split("@")[0] || "User";
  const pid = String(providerId || "").trim();

  if (!pid) { const err = new Error(`${provider} account ID missing`); err.status = 401; throw err; }
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { const err = new Error("Valid email required"); err.status = 400; throw err; }

  let result = await query(`SELECT * FROM users WHERE ${col} = $1 OR email = $2`, [pid, e]);
  let user;
  let isNew = false;

  if (result.rows.length > 0) {
    user = result.rows[0];
    result = await query(
      `UPDATE users SET ${col} = $1, full_name = COALESCE(NULLIF($2,''), full_name),
       avatar_url = COALESCE(NULLIF($3,''), avatar_url), phone = COALESCE(NULLIF($4,''), phone),
       bio = COALESCE(NULLIF($5,''), bio),
       auth_provider = CASE WHEN auth_provider = 'email' OR auth_provider IS NULL THEN $6::auth_provider_type ELSE auth_provider END,
       is_verified = true, is_active = true, last_login = NOW()
       WHERE id = $7 RETURNING *`,
      [pid, n, avatar || null, phone || null, bio || null, provider, user.id]
    );
    user = result.rows[0];
  } else {
    result = await query(
      `INSERT INTO users (email, full_name, avatar_url, ${col}, auth_provider, is_verified, is_active, last_login, phone, bio, role)
       VALUES ($1,$2,$3,$4,$5::auth_provider_type, true, true, NOW(), $6, $7, 'user') RETURNING *`,
      [e, n, avatar || null, pid, provider, phone || null, bio || null]
    );
    user = result.rows[0];
    isNew = true;
  }

  if (isNew) {
    sendEmail({ to: user.email, subject: `Welcome to ${APP_NAME}!`, html: buildWelcomeEmail({ recipientName: user.full_name }) }).catch(() => {});
  }

  return { user, isNew };
};

const respondWithAuth = (res, user, isNew = false, statusCode = 200) => {
  res.status(statusCode).json({
    success: true,
    data: {
      token: generateToken(user, "user"),
      refreshToken: generateRefreshToken(user, "user"),
      user: sanitizeUser(user),
      isNewUser: isNew,
    },
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// 👤 REGISTER (email + name → OTP)
// ═════════════════════════════════════════════════════════════════════════════

exports.register = async (req, res) => {
  try {
    const { email, fullName, full_name, phone, bio, avatar } = req.body;
    const name = (fullName || full_name || "").trim();
    const normalizedEmail = (email || "").trim().toLowerCase();

    if (!normalizedEmail) return res.status(400).json({ success: false, message: "Email is required" });
    if (validateEmail && !validateEmail(normalizedEmail)) return res.status(400).json({ success: false, message: "Invalid email address" });
    if (name && validateName && !validateName(name)) return res.status(400).json({ success: false, message: "Name must be 2–50 characters" });

    let result = await query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);

    if (result.rows.length > 0) {
      const existing = result.rows[0];
      if (existing.is_verified) return res.status(409).json({ success: false, message: "Account exists. Please sign in." });
      if (isRateLimited(existing)) return res.status(429).json({ success: false, message: `Wait ${getRemainingCooldown(existing)} seconds.` });

      await query(
        `UPDATE users SET full_name=COALESCE(NULLIF($1,''),full_name), phone=COALESCE(NULLIF($2,''),phone),
         bio=COALESCE(NULLIF($3,''),bio), avatar_url=COALESCE(NULLIF($4,''),avatar_url) WHERE id=$5`,
        [name, phone || null, bio || null, avatar || null, existing.id]
      );

      const otp = generateOTP();
      await query("UPDATE users SET verification_code=$1, code_expiry=$2, code_attempts=0, last_code_sent_at=NOW() WHERE id=$3",
        [otp, new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000), existing.id]);

      await sendOtpEmail(normalizedEmail, otp, name || existing.full_name, "verify");
      return res.json({ success: true, message: "Verification code sent.", data: { email: normalizedEmail } });
    }

    result = await query(
      `INSERT INTO users (email, full_name, phone, bio, avatar_url, is_verified, auth_provider)
       VALUES ($1,$2,$3,$4,$5,false,'email') RETURNING *`,
      [normalizedEmail, name || null, phone || null, bio || null, avatar || null]
    );

    const user = result.rows[0];
    const otp = generateOTP();
    await query("UPDATE users SET verification_code=$1, code_expiry=$2, code_attempts=0, last_code_sent_at=NOW() WHERE id=$3",
      [otp, new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000), user.id]);

    await sendOtpEmail(normalizedEmail, otp, name, "verify");
    res.status(201).json({ success: true, message: "Account created! Code sent.", data: { email: normalizedEmail, requiresVerification: true } });
  } catch (err) { handleError(res, err, "Registration failed"); }
};

// ═════════════════════════════════════════════════════════════════════════════
// 🔑 LOGIN (email → OTP, auto-creates if new)
// ═════════════════════════════════════════════════════════════════════════════

exports.login = async (req, res) => {
  try {
    const { email, fullName, full_name } = req.body;
    const name = (fullName || full_name || "").trim();
    const normalizedEmail = (email || "").trim().toLowerCase();

    if (!normalizedEmail) return res.status(400).json({ success: false, message: "Email is required" });

    let result = await query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
    let isNew = false;

    if (result.rows.length === 0) {
      result = await query("INSERT INTO users (email, full_name, is_verified, auth_provider) VALUES ($1,$2,false,'email') RETURNING *",
        [normalizedEmail, name || null]);
      isNew = true;
    }

    const user = result.rows[0];
    if (!user.is_active) return res.status(401).json({ success: false, message: "Account deactivated." });
    if (isRateLimited(user)) return res.status(429).json({ success: false, message: `Wait ${getRemainingCooldown(user)} seconds.` });

    const otp = generateOTP();
    await query("UPDATE users SET verification_code=$1, code_expiry=$2, code_attempts=0, last_code_sent_at=NOW() WHERE id=$3",
      [otp, new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000), user.id]);

    await sendOtpEmail(normalizedEmail, otp, user.full_name || name, isNew ? "verify" : "login");
    res.json({ success: true, message: "Verification code sent.", data: { email: normalizedEmail, isNewUser: isNew } });
  } catch (err) { handleError(res, err, "Login failed"); }
};

// ═════════════════════════════════════════════════════════════════════════════
// ✅ VERIFY CODE → JWT
// ═════════════════════════════════════════════════════════════════════════════

exports.verifyCode = async (req, res) => {
  try {
    const { email, code } = req.body;
    const sanitizedCode = String(code || "").replace(/\D/g, "").slice(0, 6);
    const normalizedEmail = (email || "").trim().toLowerCase();

    if (!normalizedEmail || !sanitizedCode) return res.status(400).json({ success: false, message: "Email and code required" });
    if (sanitizedCode.length !== 6) return res.status(400).json({ success: false, message: "Enter a valid 6-digit code" });

    const result = await query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "User not found" });

    const user = result.rows[0];

    if (user.code_attempts >= OTP_MAX_ATTEMPTS) {
      await query("UPDATE users SET verification_code=NULL, code_expiry=NULL WHERE id=$1", [user.id]);
      return res.status(429).json({ success: false, message: "Too many attempts. Request a new code." });
    }

    if (user.verification_code !== sanitizedCode || !user.code_expiry || new Date(user.code_expiry) < new Date()) {
      await query("UPDATE users SET code_attempts = code_attempts + 1 WHERE id=$1", [user.id]);
      const remaining = OTP_MAX_ATTEMPTS - (user.code_attempts + 1);
      return res.status(401).json({
        success: false,
        message: remaining > 0 ? `Invalid or expired code. ${remaining} attempt${remaining !== 1 ? "s" : ""} left.` : "Too many attempts. Request a new code.",
      });
    }

    const isFirst = !user.is_verified;
    await query("UPDATE users SET is_verified=true, verification_code=NULL, code_expiry=NULL, code_attempts=0, last_login=NOW() WHERE id=$1", [user.id]);

    if (isFirst) {
      sendEmail({ to: user.email, subject: `Welcome to ${APP_NAME}! 🎉`, html: buildWelcomeEmail({ recipientName: user.full_name }) }).catch(() => {});
    }

    res.json({
      success: true,
      message: isFirst ? "Account verified!" : "Signed in!",
      data: {
        token: generateToken(user, "user"),
        refreshToken: generateRefreshToken(user, "user"),
        user: sanitizeUser({ ...user, is_verified: true }),
        isNewUser: isFirst,
      },
    });
  } catch (err) { handleError(res, err, "Verification failed"); }
};

// ═════════════════════════════════════════════════════════════════════════════
// 🔄 RESEND CODE
// ═════════════════════════════════════════════════════════════════════════════

exports.resendCode = async (req, res) => {
  try {
    const normalizedEmail = (req.body.email || "").trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ success: false, message: "Email required" });

    const result = await query("SELECT id, email, full_name, last_code_sent_at FROM users WHERE email=$1", [normalizedEmail]);
    if (result.rows.length === 0) return res.json({ success: true, message: "If an account exists, a new code was sent." });

    const user = result.rows[0];
    if (isRateLimited(user)) return res.status(429).json({ success: false, message: `Wait ${getRemainingCooldown(user)}s.` });

    const otp = generateOTP();
    await query("UPDATE users SET verification_code=$1, code_expiry=$2, code_attempts=0, last_code_sent_at=NOW() WHERE id=$3",
      [otp, new Date(Date.now() + 15 * 60000), user.id]);

    await sendOtpEmail(user.email, otp, user.full_name, "resend");
    res.json({ success: true, message: "New code sent." });
  } catch (err) { handleError(res, err, "Resend failed"); }
};

// ═════════════════════════════════════════════════════════════════════════════
// 📧 CHECK EMAIL
// ═════════════════════════════════════════════════════════════════════════════

exports.checkEmail = async (req, res) => {
  try {
    const normalizedEmail = (req.body.email || "").trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ success: false, message: "Email required" });

    const result = await query("SELECT id, is_verified, auth_provider::TEXT FROM users WHERE email=$1", [normalizedEmail]);
    res.json({
      success: true,
      data: {
        exists: result.rows.length > 0,
        isVerified: result.rows[0]?.is_verified || false,
        provider: result.rows[0]?.auth_provider || null,
      },
    });
  } catch (err) { handleError(res, err, "Check failed"); }
};

// ═════════════════════════════════════════════════════════════════════════════
// 🌐 GOOGLE AUTH
// ═════════════════════════════════════════════════════════════════════════════

exports.googleAuth = async (req, res) => {
  try {
    const { credential, phone, bio, avatar } = req.body;
    if (!credential) return res.status(400).json({ success: false, message: "Google credential required" });
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(500).json({ success: false, message: "Google auth not configured" });

    const client = getGoogleOAuthClient();
    const ticket = await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload() || {};

    if (!payload.sub || !payload.email || payload.email_verified === false)
      return res.status(401).json({ success: false, message: "Google account missing verified email." });

    const authResult = await upsertSocialUser({
      provider: "google", providerId: String(payload.sub),
      email: payload.email, name: payload.name, avatar: avatar || payload.picture, phone, bio,
    });

    respondWithAuth(res, authResult.user, authResult.isNew);
  } catch (err) { handleError(res, err, "Google auth failed"); }
};

// ═════════════════════════════════════════════════════════════════════════════
// 🐙 GITHUB AUTH
// ═════════════════════════════════════════════════════════════════════════════

exports.githubAuth = async (req, res) => {
  try {
    const { code, phone, bio } = req.body;
    if (!code) return res.status(400).json({ success: false, message: "GitHub code required" });
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET)
      return res.status(500).json({ success: false, message: "GitHub auth not configured" });

    const tokenData = await fetchJsonOrThrow("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code }),
    }, "GitHub token exchange");

    if (!tokenData.access_token) return res.status(401).json({ success: false, message: "GitHub token exchange failed." });

    const ghHeaders = { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github.v3+json", "User-Agent": APP_NAME };
    const gh = await fetchJsonOrThrow("https://api.github.com/user", { headers: ghHeaders }, "GitHub profile");

    let ghEmail = gh.email;
    if (!ghEmail) {
      const emails = await fetchJsonOrThrow("https://api.github.com/user/emails", { headers: ghHeaders }, "GitHub emails");
      const list = Array.isArray(emails) ? emails : [];
      ghEmail = list.find(e => e.primary && e.verified)?.email || list.find(e => e.verified)?.email || list[0]?.email;
    }

    if (!ghEmail) return res.status(400).json({ success: false, message: "Could not get email from GitHub" });
    if (!gh.id) return res.status(401).json({ success: false, message: "GitHub account ID missing." });

    const authResult = await upsertSocialUser({
      provider: "github", providerId: String(gh.id),
      email: ghEmail, name: gh.name || gh.login, avatar: gh.avatar_url, phone, bio: bio || gh.bio,
    });

    respondWithAuth(res, authResult.user, authResult.isNew);
  } catch (err) { handleError(res, err, "GitHub auth failed"); }
};

// ═════════════════════════════════════════════════════════════════════════════
// 👤 GET ME
// ═════════════════════════════════════════════════════════════════════════════

exports.getMe = async (req, res) => {
  res.json({ success: true, data: { user: sanitizeUser(req.user) } });
};

// ═════════════════════════════════════════════════════════════════════════════
// ✏️ UPDATE PROFILE
// ═════════════════════════════════════════════════════════════════════════════

exports.updateProfile = async (req, res) => {
  try {
    const { id } = req.user;
    const { full_name, fullName, avatar_url, avatar, phone, bio, preferences } = req.body;
    const resolvedName = full_name || fullName || null;
    const resolvedAvatar = avatar_url || avatar || null;

    if (resolvedName && validateName && !validateName(resolvedName))
      return res.status(400).json({ success: false, message: "Name must be 2–50 characters." });

    const result = await query(
      `UPDATE users SET full_name=COALESCE(NULLIF($1,''),full_name), avatar_url=COALESCE(NULLIF($2,''),avatar_url),
       phone=COALESCE($3,phone), bio=COALESCE($4,bio),
       preferences=COALESCE($5::jsonb,preferences) WHERE id=$6 RETURNING *`,
      [resolvedName, resolvedAvatar, phone || null, bio || null,
       preferences ? (typeof preferences === "string" ? preferences : JSON.stringify(preferences)) : null, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "User not found" });

    sendEmail({
      to: result.rows[0].email,
      subject: `Profile Updated — ${APP_NAME}`,
      html: buildActivityAlertEmail({ recipientName: result.rows[0].full_name, activityType: "profile_updated" }),
    }).catch(() => {});

    res.json({ success: true, message: "Profile updated.", data: { user: sanitizeUser(result.rows[0]) } });
  } catch (err) { handleError(res, err, "Profile update failed"); }
};

// ═════════════════════════════════════════════════════════════════════════════
// 🔄 REFRESH TOKEN
// ═════════════════════════════════════════════════════════════════════════════

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: "Refresh token required" });

    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    if (decoded.tokenType !== "refresh") return res.status(401).json({ success: false, message: "Invalid token type" });

    const table = decoded.type === "admin" ? "admin_users" : "users";
    const result = await query(`SELECT * FROM ${table} WHERE id=$1`, [decoded.id]);
    if (result.rows.length === 0 || !result.rows[0].is_active)
      return res.status(401).json({ success: false, message: "Account unavailable" });

    const entity = result.rows[0];
    if (decoded.tokenVersion !== undefined && entity.token_version !== decoded.tokenVersion)
      return res.status(401).json({ success: false, message: "Session invalidated." });

    res.json({ success: true, data: { token: generateToken(entity, decoded.type), refreshToken: generateRefreshToken(entity, decoded.type) } });
  } catch (err) {
    if (err.name === "TokenExpiredError") return res.status(401).json({ success: false, message: "Session expired." });
    handleError(res, err, "Token refresh failed", 401);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 🚪 LOGOUT
// ═════════════════════════════════════════════════════════════════════════════

exports.logout = async (req, res) => {
  try {
    if (req.user?.id) {
      await query("UPDATE users SET token_version = COALESCE(token_version,0)+1 WHERE id=$1", [req.user.id]);
    }
    res.json({ success: true, message: "Signed out." });
  } catch (err) {
    res.json({ success: true, message: "Signed out." });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 🗑️ DELETE ACCOUNT
// ═════════════════════════════════════════════════════════════════════════════

exports.deleteAccount = async (req, res) => {
  try {
    const { id, email, full_name } = req.user;

    if (email) {
      sendEmail({ to: email, subject: `Account Deleted — ${APP_NAME}`,
        html: buildActivityAlertEmail({ recipientName: full_name, activityType: "account_deleted" }),
      }).catch(() => {});
    }

    await query("DELETE FROM users WHERE id=$1", [id]);
    res.json({ success: true, message: "Account deleted." });
  } catch (err) { handleError(res, err, "Deletion failed"); }
};

exports._emailBuilders = { buildEmailTemplate, buildOtpEmail, buildWelcomeEmail, buildActivityAlertEmail };