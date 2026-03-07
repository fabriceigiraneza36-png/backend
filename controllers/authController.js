/**
 * controllers/authController.js
 * ═══════════════════════════════════════════════════════════════════════════
 * Unified Auth Controller with Professional Email Templates
 * ═══════════════════════════════════════════════════════════════════════════
 */

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { query } = require("../config/db");
const { sendEmail } = require("../utils/email");
const logger = require("../utils/logger");

// ═════════════════════════════════════════════════════════════════════════════
// 🎨 EMAIL TEMPLATE SYSTEM — Clean, Centered, Responsive
// ═════════════════════════════════════════════════════════════════════════════

const buildEmailTemplate = ({
  preheader = "",
  title = "",
  subtitle = "",
  body = "",
  ctaText = "",
  ctaUrl = "",
  recipientName = "",
  footerNote = "",
}) => {
  const appName = process.env.APP_NAME || "Altuvera";
  const appUrl = process.env.FRONTEND_URL || "https://altuvera.com";
  const supportEmail = process.env.SUPPORT_EMAIL || "support@altuvera.com";
  const year = new Date().getFullYear();

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${title}</title>
  <style>
    /* RESET */
    body, table, td, p, a, li { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }

    /* BASE */
    body {
      margin: 0;
      padding: 0;
      width: 100%;
      background-color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    /* RESPONSIVE */
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .content-pad { padding: 24px 20px !important; }
      .header-pad { padding: 24px 20px !important; }
      .footer-pad { padding: 24px 20px !important; }
      .otp-code { font-size: 32px !important; letter-spacing: 4px !important; }
      .title { font-size: 22px !important; }
      .cta-btn { padding: 14px 28px !important; font-size: 15px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5;">
  <!-- Preheader -->
  <div style="display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:#f4f4f5;">
    ${preheader}
  </div>

  <!-- Centered Wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <!-- Main Container -->
        <table role="presentation" class="container" width="520" cellpadding="0" cellspacing="0" style="max-width:520px; width:100%; background:#ffffff; border-radius:24px; box-shadow:0 8px 20px rgba(0,0,0,0.05);">

          <!-- Header -->
          <tr>
            <td align="center" class="header-pad" style="background:#059669; border-radius:24px 24px 0 0; padding: 32px 24px;">
              <a href="${appUrl}" style="text-decoration:none; color:#ffffff; font-size:24px; font-weight:700; letter-spacing:-0.02em;">${appName}</a>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td align="center" class="content-pad" style="padding: 36px 32px;">
              <!-- Greeting -->
              ${recipientName ? `
              <p style="margin:0 0 16px; font-size:16px; color:#111827; font-weight:500;">
                Hello ${recipientName},
              </p>
              ` : ""}

              <!-- Title -->
              <h1 class="title" style="margin:0 0 8px; font-size:24px; font-weight:600; color:#111827; line-height:1.3;">
                ${title}
              </h1>
              ${subtitle ? `<p style="margin:0 0 24px; font-size:15px; color:#6b7280;">${subtitle}</p>` : ""}

              <!-- Main Content -->
              ${body}

              <!-- CTA Button -->
              ${ctaText && ctaUrl ? `
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 32px auto 0;">
                <tr>
                  <td align="center">
                    <a href="${ctaUrl}" class="cta-btn" target="_blank"
                       style="display:inline-block; padding:14px 36px; background:#059669; color:#ffffff; text-decoration:none; border-radius:40px; font-size:16px; font-weight:600; letter-spacing:0.3px;">
                      ${ctaText}
                    </a>
                  </td>
                </tr>
              </table>
              ` : ""}

              <!-- Footer Note -->
              ${footerNote ? `
              <p style="margin:24px 0 0; font-size:13px; color:#9ca3af; border-top:1px solid #e5e7eb; padding-top:20px;">
                ${footerNote}
              </p>
              ` : ""}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" class="footer-pad" style="background:#f9fafb; padding: 24px; border-radius:0 0 24px 24px;">
              <p style="margin:0 0 12px; font-size:13px;">
                <a href="${appUrl}" style="color:#4b5563; text-decoration:none; margin:0 10px;">Home</a>
                <span style="color:#d1d5db;">|</span>
                <a href="${appUrl}/destinations" style="color:#4b5563; text-decoration:none; margin:0 10px;">Explore</a>
                <span style="color:#d1d5db;">|</span>
                <a href="mailto:${supportEmail}" style="color:#4b5563; text-decoration:none; margin:0 10px;">Support</a>
              </p>
              <p style="margin:0; font-size:12px; color:#9ca3af;">&copy; ${year} ${appName}. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

// ─── OTP CODE BLOCK (simplified, centered) ───
const otpBlock = (otp, expiryMinutes = 10) => `
  <p style="margin:0 0 8px; font-size:13px; font-weight:500; color:#6b7280; text-transform:uppercase; letter-spacing:1px;">Verification Code</p>
  <div style="background:#f3f4f6; border-radius:12px; padding:16px 24px; margin:0 auto 16px; display:inline-block;">
    <span class="otp-code" style="font-family:'Courier New',monospace; font-size:36px; font-weight:700; letter-spacing:8px; color:#059669;">${otp}</span>
  </div>
  <p style="margin:0 0 8px; font-size:13px; color:#6b7280;">Expires in ${expiryMinutes} minutes</p>
`;

// ─── INFO BOX (simplified alert) ───
const infoBox = (emoji, title, text, bgColor = "#f0fdf4", borderColor = "#d1fae5", textColor = "#047857") => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; margin:24px 0;">
    <tr>
      <td style="background:${bgColor}; border:1px solid ${borderColor}; border-radius:12px; padding:16px 20px; text-align:center;">
        <p style="margin:0 0 4px; font-size:14px; font-weight:600; color:${textColor};">${emoji} ${title}</p>
        <p style="margin:0; font-size:13px; color:${textColor}; opacity:0.9;">${text}</p>
      </td>
    </tr>
  </table>
`;

// ─── DETAIL ROW (two‑column minimal) ───
const detailRow = (items) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; margin:24px 0;">
    <tr>
      ${items.map(({ label, value }) => `
        <td align="center" style="width:50%; padding:0 6px;">
          <div style="background:#f9fafb; border-radius:10px; padding:12px 8px;">
            <p style="margin:0 0 2px; font-size:11px; font-weight:600; color:#9ca3af; text-transform:uppercase;">${label}</p>
            <p style="margin:0; font-size:14px; font-weight:500; color:#111827;">${value}</p>
          </div>
        </td>
      `).join("")}
    </tr>
  </table>
`;

// ─── STEP LIST (simple numbered steps) ───
const stepList = (steps) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; margin:24px 0;">
    ${steps.map(({ title, desc }, i) => `
    <tr>
      <td style="padding:12px 0; ${i < steps.length - 1 ? "border-bottom:1px solid #f3f4f6;" : ""}">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
          <tr>
            <td width="40" align="center" valign="top" style="padding-right:12px;">
              <span style="display:inline-block; width:28px; height:28px; background:#059669; color:#fff; font-size:14px; font-weight:600; border-radius:8px; line-height:28px;">${i + 1}</span>
            </td>
            <td valign="top">
              <p style="margin:0 0 2px; font-size:15px; font-weight:600; color:#111827;">${title}</p>
              <p style="margin:0; font-size:13px; color:#6b7280;">${desc}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    `).join("")}
  </table>
`;

// ═════════════════════════════════════════════════════════════════════════════
// 📧 SPECIFIC EMAIL BUILDERS
// ═════════════════════════════════════════════════════════════════════════════

const buildOtpEmail = ({ otp, recipientName, purpose = "verify", expiryMinutes = 10 }) => {
  const cfg = {
    verify: { title: "Verify Your Email", sub: "Enter the code below to verify your account" },
    login: { title: "Your Sign-In Code", sub: "Use this code to sign in to your account" },
    resend: { title: "New Verification Code", sub: "Here's your fresh code as requested" },
  }[purpose] || { title: "Verification Code", sub: "" };

  return buildEmailTemplate({
    preheader: `Your code is ${otp}`,
    title: cfg.title,
    subtitle: cfg.sub,
    recipientName,
    body: `
      <p style="margin:0 0 24px; font-size:15px; color:#4b5563;">Use the code below to continue. It's valid for <strong>${expiryMinutes} minutes</strong>.</p>
      ${otpBlock(otp, expiryMinutes)}
      ${infoBox("🛡️", "Security Notice", "Never share this code. We will never ask for it via phone or chat.")}
    `,
    footerNote: "Didn't request this? You can safely ignore this email.",
  });
};

const buildWelcomeEmail = ({ recipientName }) => {
  const appName = process.env.APP_NAME || "Altuvera";
  const appUrl = process.env.FRONTEND_URL || "https://altuvera.com";

  return buildEmailTemplate({
    preheader: `Welcome to ${appName}! Your account is ready.`,
    title: `Welcome to ${appName}!`,
    subtitle: "Your account is verified and ready to go",
    recipientName,
    body: `
      <p style="margin:0 0 24px; font-size:15px; color:#4b5563;">We're thrilled to have you! Here's how to get started:</p>
      ${stepList([
        { title: "Complete Your Profile", desc: "Add your photo and travel preferences." },
        { title: "Explore Destinations", desc: "Browse curated East African experiences." },
        { title: "Plan Your Adventure", desc: "Build your dream safari itinerary." },
      ])}
    `,
    ctaText: "Start Exploring →",
    ctaUrl: `${appUrl}/destinations`,
    footerNote: "Need help? Reply to this email anytime.",
  });
};

const buildPasswordResetEmail = ({ recipientName, resetUrl, expiryMinutes = 60 }) => {
  return buildEmailTemplate({
    preheader: "Reset your password",
    title: "Reset Your Password",
    subtitle: "Click below to create a new password",
    recipientName,
    body: `
      <p style="margin:0 0 20px; font-size:15px; color:#4b5563;">We received a password reset request. This link expires in <strong>${expiryMinutes} minutes</strong>.</p>
      ${detailRow([
        { label: "Requested", value: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) },
        { label: "Expires In", value: `${expiryMinutes} min` },
      ])}
      ${infoBox("⚠️", "Didn't request this?", "Ignore this email. Your password won't change unless you click the link.", "#fffbeb", "#fde68a", "#92400e")}
    `,
    ctaText: "Reset Password →",
    ctaUrl: resetUrl,
  });
};

const buildActivityAlertEmail = ({ recipientName, activityType, details = {} }) => {
  const types = {
    login: { title: "New Sign-In" },
    password_changed: { title: "Password Changed" },
    profile_updated: { title: "Profile Updated" },
    account_deleted: { title: "Account Deleted" },
  };
  const cfg = types[activityType] || types.login;
  const appUrl = process.env.FRONTEND_URL || "https://altuvera.com";

  const detailItems = [
    { label: "Activity", value: cfg.title },
    { label: "Time", value: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) },
  ];
  if (details.ip) detailItems.push({ label: "IP", value: details.ip });
  if (details.device) detailItems.push({ label: "Device", value: details.device });

  return buildEmailTemplate({
    preheader: `${cfg.title} on your account`,
    title: cfg.title,
    subtitle: "We detected activity on your account",
    recipientName,
    body: `
      <p style="margin:0 0 20px; font-size:15px; color:#4b5563;">Here are the details of the recent activity:</p>
      ${detailRow(detailItems.slice(0, 2))}
      ${detailItems.length > 2 ? detailRow(detailItems.slice(2)) : ""}
      ${infoBox("⚠️", "Wasn't you?", "Secure your account immediately by changing your password.", "#fffbeb", "#fde68a", "#92400e")}
    `,
    ctaText: "Review Security →",
    ctaUrl: `${appUrl}/settings/security`,
  });
};

const buildAdminWelcomeEmail = ({ recipientName, username }) => {
  const appUrl = process.env.FRONTEND_URL || "https://altuvera.com";

  return buildEmailTemplate({
    preheader: "Your admin account is ready",
    title: "Admin Account Created",
    subtitle: "Sign in and change your password",
    recipientName,
    body: `
      <p style="margin:0 0 20px; font-size:15px; color:#4b5563;">Your admin account has been set up. Here are your details:</p>
      ${detailRow([
        { label: "Username", value: username },
        { label: "Role", value: "Administrator" },
      ])}
      ${infoBox("🔑", "Important", "Please change your password after your first sign-in.")}
    `,
    ctaText: "Sign In to Dashboard →",
    ctaUrl: `${appUrl}/admin/login`,
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// 🛠️ HELPERS (unchanged)
// ═════════════════════════════════════════════════════════════════════════════

const generateToken = (entity, type = "user") => {
  return jwt.sign(
    { id: entity.id, email: entity.email, role: entity.role || (type === "admin" ? "admin" : "user"), type },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
};

const generateRefreshToken = (entity, type = "user") => {
  return jwt.sign(
    { id: entity.id, type, tokenType: "refresh" },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
};

const generateOTP = () => crypto.randomInt(100000, 999999).toString();

const sanitizeUser = (user) => {
  if (!user) return null;
  const { password_hash, verification_code, code_expiry, code_attempts, reset_token, reset_token_expires, verification_token, last_code_sent_at, google_id, github_id, ...safe } = user;
  return safe;
};

const getClientInfo = (req) => ({
  ip: req.ip || req.headers["x-forwarded-for"] || "unknown",
  device: req.headers["user-agent"]?.includes("Mobile") ? "Mobile" : "Desktop",
});

const isRateLimited = (user, ms = 60000) => {
  return user.last_code_sent_at && Date.now() - new Date(user.last_code_sent_at).getTime() < ms;
};

const SOCIAL_PROVIDER_COLUMNS = {
  google: "google_id",
  github: "github_id",
};

const SOCIAL_PROVIDER_NAMES = {
  google: "Google",
  github: "GitHub",
};

const SOCIAL_HTTP_TIMEOUT_MS = parseInt(
  process.env.SOCIAL_AUTH_TIMEOUT_MS || "8000",
  10,
);

let googleOAuthClient = null;

const getGoogleOAuthClient = () => {
  if (!googleOAuthClient) {
    const { OAuth2Client } = require("google-auth-library");
    googleOAuthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }
  return googleOAuthClient;
};

const normalizeOptionalText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeProviderId = (value) => normalizeOptionalText(String(value || ""));

const isValidEmail = (value) =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const normalizeSocialIdentity = ({ providerId, email, name, avatar, phone, bio }) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = normalizeOptionalText(name) || normalizedEmail.split("@")[0] || "User";
  return {
    providerId: normalizeProviderId(providerId),
    email: normalizedEmail,
    name: normalizedName,
    avatar: normalizeOptionalText(avatar),
    phone: normalizeOptionalText(phone),
    bio: normalizeOptionalText(bio),
  };
};

const fetchJsonOrThrow = async (url, options = {}, provider = "oauth") => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOCIAL_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const raw = await res.text();
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch (_) {
      body = { raw };
    }

    if (!res.ok) {
      const err = new Error(
        body?.error_description ||
          body?.message ||
          body?.error ||
          `${provider} request failed with status ${res.status}`,
      );
      err.status = 401;
      throw err;
    }

    return body;
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`${provider} request timed out`);
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
};

const upsertSocialUser = async ({
  provider,
  providerId,
  email,
  name,
  avatar,
  phone,
  bio,
}) => {
  const providerColumn = SOCIAL_PROVIDER_COLUMNS[provider];
  if (!providerColumn) {
    throw new Error(`Unsupported social provider: ${provider}`);
  }

  const normalized = normalizeSocialIdentity({
    providerId,
    email,
    name,
    avatar,
    phone,
    bio,
  });

  if (!normalized.providerId) {
    const err = new Error(`${SOCIAL_PROVIDER_NAMES[provider]} account id is missing`);
    err.status = 401;
    throw err;
  }

  if (!isValidEmail(normalized.email)) {
    const err = new Error("A valid email is required for social authentication");
    err.status = 400;
    throw err;
  }

  let result = await query(
    `SELECT * FROM users WHERE ${providerColumn} = $1 OR email = $2`,
    [normalized.providerId, normalized.email],
  );

  let user;
  let isNew = false;

  if (result.rows.length > 0) {
    user = result.rows[0];
    result = await query(
      `UPDATE users
       SET ${providerColumn} = $1,
           full_name = COALESCE($2, full_name),
           avatar_url = COALESCE($3, avatar_url),
           phone = COALESCE($4, phone),
           bio = COALESCE($5, bio),
           auth_provider = CASE WHEN auth_provider = 'email' OR auth_provider IS NULL THEN $6 ELSE auth_provider END,
           is_verified = true,
           is_active = true,
           last_login = NOW()
       WHERE id = $7
      RETURNING *`,
      [
        normalized.providerId,
        normalized.name,
        normalized.avatar,
        normalized.phone,
        normalized.bio,
        provider,
        user.id,
      ],
    );
    user = result.rows[0];
  } else {
    result = await query(
      `INSERT INTO users
       (email, full_name, avatar_url, ${providerColumn}, auth_provider, is_verified, is_active, last_login, phone, bio, role)
      VALUES ($1, $2, $3, $4, $5, true, true, NOW(), $6, $7, 'user')
       RETURNING *`,
      [
        normalized.email,
        normalized.name,
        normalized.avatar,
        normalized.providerId,
        provider,
        normalized.phone,
        normalized.bio,
      ],
    );
    user = result.rows[0];
    isNew = true;
  }

  if (isNew) {
    sendEmail({
      to: user.email,
      subject: `Welcome to ${process.env.APP_NAME || "Altuvera"}!`,
      html: buildWelcomeEmail({ recipientName: user.full_name }),
    }).catch(() => {});
  }

  return { user, isNew };
};

const respondSocialAuth = (res, { user, isNew }) => {
  res.json({
    success: true,
    data: {
      token: generateToken(user, "user"),
      refreshToken: generateRefreshToken(user, "user"),
      user: sanitizeUser(user),
      isNewUser: isNew,
    },
  });
};

const ensureSocialEnv = (provider) => {
  if (provider === "google" && !process.env.GOOGLE_CLIENT_ID) {
    const err = new Error("GOOGLE_CLIENT_ID is not configured");
    err.status = 500;
    throw err;
  }
  if (
    provider === "github" &&
    (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET)
  ) {
    const err = new Error(
      "GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not configured",
    );
    err.status = 500;
    throw err;
  }
};

const handleError = (res, err, message = "Operation failed", status = 500) => {
  logger.error(`[Auth] ${message}:`, { error: err.message, name: err.name });
  return res.status(err.status || status).json({
    success: false,
    error: err.name || "AuthError",
    message: err.message || message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// 👤 USER CONTROLLERS (unchanged)
// ═════════════════════════════════════════════════════════════════════════════

exports.register = async (req, res) => {
  try {
    const { email, fullName, full_name, phone, bio, role, avatar } = req.body;
    const name = fullName || full_name || null;

    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    let result = await query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    let user;

    if (result.rows.length > 0) {
      user = result.rows[0];
      if (user.is_verified) return res.status(409).json({ success: false, message: "Account exists. Please sign in." });
      if (isRateLimited(user)) return res.status(429).json({ success: false, message: "Please wait 60 seconds." });

      await query(
        `UPDATE users SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone), bio = COALESCE($3, bio), avatar_url = COALESCE($4, avatar_url) WHERE id = $5`,
        [name, phone, bio, avatar, user.id]
      );
    } else {
      result = await query(
        `INSERT INTO users (email, full_name, phone, bio, role, avatar_url, is_verified, auth_provider) VALUES ($1,$2,$3,$4,$5,$6,false,'email') RETURNING *`,
        [email.toLowerCase(), name, phone, bio, role || "user", avatar]
      );
      user = result.rows[0];
    }

    const otp = generateOTP();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    await query("UPDATE users SET verification_code=$1, code_expiry=$2, code_attempts=0, last_code_sent_at=NOW() WHERE id=$3", [otp, expiry, user.id]);

    await sendEmail({
      to: user.email,
      subject: `Your Verification Code: ${otp}`,
      html: buildOtpEmail({ otp, recipientName: name || user.full_name, purpose: "verify" }),
    });

    res.json({ success: true, message: "Verification code sent.", data: { email: email.toLowerCase() } });
  } catch (err) {
    handleError(res, err, "Registration failed");
  }
};

exports.login = async (req, res) => {
  try {
    const { email, fullName, full_name } = req.body;
    const name = fullName || full_name;

    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    let result = await query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    let isNew = false;

    if (result.rows.length === 0) {
      result = await query("INSERT INTO users (email, full_name, is_verified, auth_provider) VALUES ($1,$2,false,'email') RETURNING *", [email.toLowerCase(), name]);
      isNew = true;
    }

    const user = result.rows[0];
    if (!user.is_active) return res.status(401).json({ success: false, message: "Account deactivated." });
    if (isRateLimited(user)) return res.status(429).json({ success: false, message: "Please wait 60 seconds." });

    const otp = generateOTP();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    await query("UPDATE users SET verification_code=$1, code_expiry=$2, code_attempts=0, last_code_sent_at=NOW() WHERE id=$3", [otp, expiry, user.id]);

    await sendEmail({
      to: user.email,
      subject: `Sign In Code: ${otp}`,
      html: buildOtpEmail({ otp, recipientName: user.full_name || name, purpose: isNew ? "verify" : "login" }),
    });

    res.json({ success: true, message: "Verification code sent.", data: { email: email.toLowerCase(), isNewUser: isNew } });
  } catch (err) {
    handleError(res, err, "Login failed");
  }
};

exports.verifyCode = async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ success: false, message: "Email and code required" });

    const result = await query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "User not found" });

    const user = result.rows[0];

    if (user.code_attempts >= 5) {
      await query("UPDATE users SET verification_code=NULL, code_expiry=NULL WHERE id=$1", [user.id]);
      return res.status(429).json({ success: false, message: "Too many attempts. Request a new code." });
    }

    if (user.verification_code !== code || new Date(user.code_expiry) < new Date()) {
      await query("UPDATE users SET code_attempts = code_attempts + 1 WHERE id=$1", [user.id]);
      return res.status(401).json({ success: false, message: "Invalid or expired code." });
    }

    const isFirst = !user.is_verified;
    await query("UPDATE users SET is_verified=true, verification_code=NULL, code_expiry=NULL, code_attempts=0, last_login=NOW() WHERE id=$1", [user.id]);

    const token = generateToken(user, "user");
    const refreshToken = generateRefreshToken(user, "user");

    if (isFirst) {
      sendEmail({
        to: user.email,
        subject: `Welcome to ${process.env.APP_NAME || "Altuvera"}! 🎉`,
        html: buildWelcomeEmail({ recipientName: user.full_name }),
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: isFirst ? "Account verified!" : "Signed in!",
      data: { token, refreshToken, user: sanitizeUser({ ...user, is_verified: true }), isNewUser: isFirst },
    });
  } catch (err) {
    handleError(res, err, "Verification failed");
  }
};

exports.resendCode = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email required" });

    const result = await query("SELECT id, email, full_name, last_code_sent_at FROM users WHERE email=$1", [email.toLowerCase()]);
    if (result.rows.length === 0) return res.json({ success: true, message: "If an account exists, a new code was sent." });

    const user = result.rows[0];
    if (isRateLimited(user)) {
      const remaining = Math.ceil((60000 - (Date.now() - new Date(user.last_code_sent_at).getTime())) / 1000);
      return res.status(429).json({ success: false, message: `Wait ${remaining}s.` });
    }

    const otp = generateOTP();
    const expiry = new Date(Date.now() + 15 * 60 * 1000);

    await query("UPDATE users SET verification_code=$1, code_expiry=$2, code_attempts=0, last_code_sent_at=NOW() WHERE id=$3", [otp, expiry, user.id]);

    await sendEmail({
      to: user.email,
      subject: `New Code: ${otp}`,
      html: buildOtpEmail({ otp, recipientName: user.full_name, purpose: "resend", expiryMinutes: 15 }),
    });

    res.json({ success: true, message: "New code sent." });
  } catch (err) {
    handleError(res, err, "Resend failed");
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 🌐 SOCIAL AUTH (unchanged)
// ═════════════════════════════════════════════════════════════════════════════

exports.googleAuth = async (req, res) => {
  try {
    const { credential, phone, bio, avatar } = req.body;
    if (!credential) return res.status(400).json({ success: false, message: "Google credential required" });
    ensureSocialEnv("google");

    const client = getGoogleOAuthClient();
    const ticket = await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload() || {};
    const { sub: googleId, email, name, picture, email_verified: emailVerified } = payload;

    if (!googleId || !email || emailVerified === false) {
      return res.status(401).json({
        success: false,
        message: "Google account is missing a verified email.",
      });
    }

    const authResult = await upsertSocialUser({
      provider: "google",
      providerId: String(googleId),
      email,
      name,
      avatar: avatar || picture,
      phone,
      bio,
    });

    respondSocialAuth(res, authResult);
  } catch (err) {
    handleError(res, err, "Google auth failed");
  }
};

exports.githubAuth = async (req, res) => {
  try {
    const { code, phone, bio } = req.body;
    if (!code) return res.status(400).json({ success: false, message: "GitHub code required" });
    ensureSocialEnv("github");

    const tokenData = await fetchJsonOrThrow(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      },
      "GitHub token exchange",
    );

    if (!tokenData.access_token) {
      return res.status(401).json({
        success: false,
        message: "GitHub did not return an access token.",
      });
    }

    const ghHeaders = {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": process.env.APP_NAME || "altuvera-backend",
    };

    const gh = await fetchJsonOrThrow(
      "https://api.github.com/user",
      { headers: ghHeaders },
      "GitHub profile fetch",
    );

    let email = gh.email;
    if (!email) {
      const emailsResponse = await fetchJsonOrThrow(
        "https://api.github.com/user/emails",
        { headers: ghHeaders },
        "GitHub email fetch",
      );
      const emails = Array.isArray(emailsResponse) ? emailsResponse : [];
      email =
        emails.find((e) => e.primary && e.verified)?.email ||
        emails.find((e) => e.verified)?.email ||
        emails.find((e) => e.primary)?.email ||
        emails[0]?.email;
    }
    if (!email) return res.status(400).json({ success: false, message: "Could not get email from GitHub" });
    if (!gh.id) {
      return res.status(401).json({
        success: false,
        message: "GitHub account id missing in response.",
      });
    }

    const authResult = await upsertSocialUser({
      provider: "github",
      providerId: String(gh.id),
      email,
      name: gh.name || gh.login,
      avatar: gh.avatar_url,
      phone,
      bio: bio || gh.bio,
    });

    respondSocialAuth(res, authResult);
  } catch (err) {
    handleError(
      res,
      err,
      `${SOCIAL_PROVIDER_NAMES.github} auth failed`,
    );
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 🔒 ADMIN CONTROLLERS (unchanged)
// ═════════════════════════════════════════════════════════════════════════════

exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: "Credentials required" });

    const result = await query("SELECT * FROM admin_users WHERE email=$1", [email.toLowerCase()]);
    if (result.rows.length === 0) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const admin = result.rows[0];
    if (!admin.is_active) return res.status(403).json({ success: false, message: "Account deactivated" });

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) return res.status(401).json({ success: false, message: "Invalid credentials" });

    await query("UPDATE admin_users SET last_login=NOW() WHERE id=$1", [admin.id]);

    res.json({
      success: true,
      data: {
        token: generateToken(admin, "admin"),
        refreshToken: generateRefreshToken(admin, "admin"),
        user: { id: admin.id, email: admin.email, role: admin.role, full_name: admin.full_name, username: admin.username },
      },
    });
  } catch (err) {
    handleError(res, err, "Admin login failed");
  }
};

exports.adminRegister = async (req, res) => {
  try {
    const { username, email, password, full_name, role } = req.body;
    if (!username || !email || !password) return res.status(400).json({ success: false, message: "Required fields missing" });
    if (password.length < 8) return res.status(400).json({ success: false, message: "Password min 8 characters" });

    const exists = await query("SELECT id FROM admin_users WHERE email=$1 OR username=$2", [email.toLowerCase(), username.toLowerCase()]);
    if (exists.rows.length > 0) return res.status(409).json({ success: false, message: "Admin already exists" });

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      "INSERT INTO admin_users (username,email,password_hash,full_name,role) VALUES ($1,$2,$3,$4,$5) RETURNING id,username,email,full_name,role",
      [username.toLowerCase(), email.toLowerCase(), hash, full_name, role || "admin"]
    );

    const admin = result.rows[0];
    sendEmail({
      to: admin.email,
      subject: `Admin Account Created — ${process.env.APP_NAME || "Altuvera"}`,
      html: buildAdminWelcomeEmail({ recipientName: admin.full_name || admin.username, username: admin.username }),
    }).catch(() => {});

    res.status(201).json({ success: true, data: admin });
  } catch (err) {
    handleError(res, err, "Admin registration failed");
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 🔄 TOKEN & ACCOUNT MANAGEMENT (unchanged)
// ═════════════════════════════════════════════════════════════════════════════

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: "Refresh token required" });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    if (decoded.tokenType !== "refresh") return res.status(401).json({ success: false, message: "Invalid token" });

    const table = decoded.type === "admin" ? "admin_users" : "users";
    const result = await query(`SELECT * FROM ${table} WHERE id=$1`, [decoded.id]);
    if (result.rows.length === 0 || !result.rows[0].is_active) return res.status(401).json({ success: false, message: "Account unavailable" });

    const entity = result.rows[0];
    res.json({ success: true, data: { token: generateToken(entity, decoded.type), refreshToken: generateRefreshToken(entity, decoded.type) } });
  } catch (err) {
    if (err.name === "TokenExpiredError") return res.status(401).json({ success: false, message: "Session expired. Sign in again." });
    handleError(res, err, "Token refresh failed", 401);
  }
};

exports.getMe = async (req, res) => {
  res.json({ success: true, data: sanitizeUser(req.user) });
};

exports.updateProfile = async (req, res) => {
  try {
    const { id } = req.user;
    const { full_name, fullName, avatar_url, avatar, phone, bio, preferences } = req.body;
    const isAdmin = Boolean(req.user.username);
    const table = isAdmin ? "admin_users" : "users";

    const result = await query(
      `UPDATE ${table} SET full_name=COALESCE($1,full_name), avatar_url=COALESCE($2,avatar_url), phone=COALESCE($3,phone), bio=COALESCE($4,bio), preferences=COALESCE($5,preferences) WHERE id=$6 RETURNING *`,
      [full_name || fullName, avatar_url || avatar, phone, bio, preferences ? (typeof preferences === "string" ? preferences : JSON.stringify(preferences)) : null, id]
    );

    const updated = sanitizeUser(result.rows[0]);

    if (!isAdmin) {
      sendEmail({
        to: updated.email,
        subject: `Profile Updated — ${process.env.APP_NAME || "Altuvera"}`,
        html: buildActivityAlertEmail({ recipientName: updated.full_name, activityType: "profile_updated", details: getClientInfo(req) }),
      }).catch(() => {});
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    handleError(res, err, "Profile update failed");
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { id } = req.user;
    const { current_password, new_password, password } = req.body;
    const current = current_password || password;

    if (!current || !new_password) return res.status(400).json({ success: false, message: "Both passwords required" });
    if (new_password.length < 8) return res.status(400).json({ success: false, message: "Min 8 characters" });

    const isAdmin = Boolean(req.user.username);
    const table = isAdmin ? "admin_users" : "users";
    const result = await query(`SELECT password_hash, email, full_name FROM ${table} WHERE id=$1`, [id]);
    const entity = result.rows[0];

    if (!entity?.password_hash) return res.status(400).json({ success: false, message: "No password set (social login)" });

    const match = await bcrypt.compare(current, entity.password_hash);
    if (!match) return res.status(401).json({ success: false, message: "Wrong current password" });

    await query(`UPDATE ${table} SET password_hash=$1 WHERE id=$2`, [await bcrypt.hash(new_password, 12), id]);

    sendEmail({
      to: entity.email,
      subject: `Password Changed — ${process.env.APP_NAME || "Altuvera"}`,
      html: buildActivityAlertEmail({ recipientName: entity.full_name, activityType: "password_changed", details: getClientInfo(req) }),
    }).catch(() => {});

    res.json({ success: true, message: "Password updated." });
  } catch (err) {
    handleError(res, err, "Password change failed");
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email required" });

    const safe = { success: true, message: "If an account exists, reset instructions were sent." };
    const result = await query("SELECT id, email, full_name FROM users WHERE email=$1", [email.toLowerCase()]);
    if (result.rows.length === 0) return res.json(safe);

    const user = result.rows[0];
    const token = crypto.randomBytes(32).toString("hex");
    await query("UPDATE users SET reset_token=$1, reset_token_expires=$2 WHERE id=$3", [token, new Date(Date.now() + 3600000), user.id]);

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    await sendEmail({
      to: email,
      subject: `Reset Password — ${process.env.APP_NAME || "Altuvera"}`,
      html: buildPasswordResetEmail({ recipientName: user.full_name, resetUrl }),
    });

    res.json(safe);
  } catch (err) {
    handleError(res, err, "Forgot password failed");
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ success: false, message: "Token and password required" });
    if (password.length < 8) return res.status(400).json({ success: false, message: "Min 8 characters" });

    const result = await query("SELECT id, email, full_name FROM users WHERE reset_token=$1 AND reset_token_expires > NOW()", [token]);
    if (result.rows.length === 0) return res.status(400).json({ success: false, message: "Invalid or expired reset link." });

    const user = result.rows[0];
    await query("UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2", [await bcrypt.hash(password, 12), user.id]);

    sendEmail({
      to: user.email,
      subject: `Password Changed — ${process.env.APP_NAME || "Altuvera"}`,
      html: buildActivityAlertEmail({ recipientName: user.full_name, activityType: "password_changed" }),
    }).catch(() => {});

    res.json({ success: true, message: "Password reset. You can sign in now." });
  } catch (err) {
    handleError(res, err, "Reset failed");
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    const result = await query("UPDATE users SET is_verified=true, verification_token=NULL WHERE verification_token=$1 RETURNING id, email, full_name", [token]);
    if (result.rows.length === 0) return res.status(400).json({ success: false, message: "Invalid verification link." });

    sendEmail({
      to: result.rows[0].email,
      subject: `Welcome to ${process.env.APP_NAME || "Altuvera"}!`,
      html: buildWelcomeEmail({ recipientName: result.rows[0].full_name }),
    }).catch(() => {});

    res.json({ success: true, message: "Email verified!" });
  } catch (err) {
    handleError(res, err, "Verification failed");
  }
};

exports.checkEmail = async (req, res) => {
  try {
    const result = await query("SELECT id, is_verified, auth_provider FROM users WHERE email=$1", [req.body.email?.toLowerCase()]);
    res.json({ success: true, data: { exists: result.rows.length > 0, isVerified: result.rows[0]?.is_verified || false, provider: result.rows[0]?.auth_provider || null } });
  } catch (err) {
    handleError(res, err, "Check failed");
  }
};

exports.logout = (req, res) => res.json({ success: true, message: "Signed out." });

exports.deleteAccount = async (req, res) => {
  try {
    const { id, email, full_name, username } = req.user;
    const isAdmin = Boolean(username);
    const table = isAdmin ? "admin_users" : "users";

    if (email) {
      sendEmail({
        to: email,
        subject: `Account Deleted — ${process.env.APP_NAME || "Altuvera"}`,
        html: buildActivityAlertEmail({ recipientName: full_name, activityType: "account_deleted", details: getClientInfo(req) }),
      }).catch(() => {});
    }

    await query(`DELETE FROM ${table} WHERE id=$1`, [id]);
    res.json({ success: true, message: "Account deleted." });
  } catch (err) {
    handleError(res, err, "Deletion failed");
  }
};

// Export email builders for reuse
exports._emailBuilders = { buildEmailTemplate, buildOtpEmail, buildWelcomeEmail, buildPasswordResetEmail, buildActivityAlertEmail, buildAdminWelcomeEmail };
