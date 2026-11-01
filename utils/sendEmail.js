const { Resend } = require("resend");

// ============================================================
// CONFIGURATION & UTILITIES
// ============================================================

const getEmailConfig = () => {
  const resendApiKey = process.env.RESEND_API_KEY || "";
  const fromDomain   = process.env.RESEND_FROM_DOMAIN || "altuverasafaris.com";
  const isConfigured = Boolean(
    resendApiKey &&
    resendApiKey.startsWith("re_") &&
    !resendApiKey.includes("your-api-key")
  );
  const devFallback =
    process.env.NODE_ENV !== "production" &&
    process.env.AUTH_ALLOW_DEV_OTP_FALLBACK === "true";

  return { resendApiKey, fromDomain, isConfigured, devFallback };
};

// Singleton Resend client
let _resendClient = null;
const getResendClient = () => {
  const config = getEmailConfig();
  if (!config.isConfigured) return null;
  if (!_resendClient) {
    _resendClient = new Resend(config.resendApiKey);
  }
  return _resendClient;
};

// Reset client (e.g. after key rotation)
const resetResendClient = () => { _resendClient = null; };

const validateEmail = (email) => {
  if (email === null || email === undefined) {
    throw new TypeError(
      "Email parameter is required and cannot be null or undefined"
    );
  }
  if (typeof email !== "string") {
    throw new TypeError(`Email must be a string, received ${typeof email}`);
  }
  const trimmedEmail = email.trim();
  if (trimmedEmail.length === 0) {
    throw new TypeError("Email cannot be an empty string");
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    throw new TypeError(`Invalid email format: ${trimmedEmail}`);
  }
  return trimmedEmail;
};

const safeEncodeURI = (str) => {
  try {
    return encodeURIComponent(String(str || ""));
  } catch {
    return "";
  }
};

const getEnvVar = (key, fallback) => {
  try {
    return (
      (typeof process !== "undefined" && process.env && process.env[key]) ||
      fallback
    );
  } catch {
    return fallback;
  }
};

const escapeHtml = (str) =>
  String(str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;");

const EMAIL_LOGO_URL = getEnvVar("EMAIL_LOGO_URL", "https://www.altuverasafaris.com/altuvera.png");
const safeProfileImage = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
};
const profileInitials = (name, email) => {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return String(email || "U").trim().slice(0, 1).toUpperCase() || "U";
};

const getCurrentYear = () => {
  try {
    return new Date().getFullYear();
  } catch {
    return 2024;
  }
};

// ============================================================
// SHARED TEMPLATE COMPONENTS
// ============================================================

const sharedStyles = {
  bodyBg:         "#f0fdf4",
  cardBg:         "#ffffff",
  cardRadius:     "28px",
  cardShadow:     "0 8px 40px rgba(22,163,74,0.10)",
  bannerGradient: "linear-gradient(135deg,#14532d 0%,#15803d 40%,#22c55e 100%)",
  greenDark:      "#14532d",
  greenMid:       "#15803d",
  greenLight:     "#22c55e",
  greenPale:      "#f0fdf4",
  greenMint:      "#dcfce7",
  greenBorder:    "#bbf7d0",
  textPrimary:    "#0f1b0f",
  textSecondary:  "#4a6b52",
  textMuted:      "#6b8f72",
  white:          "#ffffff",
  warningBg:      "#fef3c7",
  warningBorder:  "#fde68a",
  warningText:    "#92400e",
  footerBg:       "#0c3b1e",
};

const buildOuterWrapper = (content) => `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <!--[if mso]>
  <style type="text/css">
    table, td { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${sharedStyles.bodyBg};font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:${sharedStyles.bodyBg};min-height:100vh;">
    <tr>
      <td align="center" valign="top" style="padding:48px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background-color:${sharedStyles.cardBg};border-radius:${sharedStyles.cardRadius};overflow:hidden;box-shadow:${sharedStyles.cardShadow};border:1px solid rgba(22,163,74,0.06);">
          ${content}
        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

const buildBanner = (emoji, title, subtitle, recipientName = "", recipientEmail = "", recipientAvatarUrl = "") => {
  const avatarUrl = safeProfileImage(recipientAvatarUrl);
  const avatar = avatarUrl
    ? '<img src="' + escapeHtml(avatarUrl) + '" width="58" height="58" alt="' + escapeHtml(recipientName || "Your profile") + '" style="display:block;width:58px;height:58px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,.9);" />'
    : '<table role="presentation" cellpadding="0" cellspacing="0" width="58" height="58" style="width:58px;height:58px;border-radius:50%;background:#d1fae5;border:3px solid rgba(255,255,255,.9);"><tr><td align="center" valign="middle" style="font-family:Arial,sans-serif;font-size:16px;font-weight:800;color:#065f46;">' + escapeHtml(profileInitials(recipientName, recipientEmail)) + '</td></tr></table>';

  return `
  <tr>
    <td style="background:${sharedStyles.bannerGradient};padding:36px 32px;text-align:center;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 auto 20px;">
        <tr>
          <td align="left" valign="middle" width="124">
            <img src="${escapeHtml(EMAIL_LOGO_URL)}" width="112" height="56" alt="Altuvera Safaris logo" style="display:block;width:112px;height:56px;object-fit:contain;border-radius:10px;background:#ffffff;padding:3px;" />
          </td>
          <td align="right" valign="middle" width="64">${avatar}</td>
        </tr>
      </table>
      <div style="width:64px;height:64px;margin:0 auto 16px;border-radius:18px;background:rgba(255,255,255,0.15);line-height:64px;font-size:32px;">
        ${emoji}
      </div>
      <h1 style="margin:0 0 8px;font-size:30px;font-weight:800;color:${sharedStyles.white};letter-spacing:-0.5px;line-height:1.2;">
        ${title}
      </h1>
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.75);letter-spacing:2px;text-transform:uppercase;font-weight:600;">
        ${subtitle}
      </p>
    </td>
  </tr>`;
};

const buildIconCircle = (emoji, size = 80) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
    <tr>
      <td style="width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,${sharedStyles.greenPale},${sharedStyles.greenMint});border:2px solid ${sharedStyles.greenBorder};text-align:center;vertical-align:middle;">
        <span style="font-size:${Math.round(size * 0.42)}px;line-height:${size}px;">${emoji}</span>
      </td>
    </tr>
  </table>`;

const buildDivider = () => `
  <tr>
    <td style="padding:0 44px;">
      <div style="height:1px;background:linear-gradient(90deg,transparent 0%,${sharedStyles.greenBorder} 50%,transparent 100%);"></div>
    </td>
  </tr>`;

const buildInfoCard = (emoji, title, description) => `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:14px;background:linear-gradient(135deg,rgba(240,253,244,0.7),rgba(255,255,255,0.9));border-radius:16px;border:1px solid ${sharedStyles.greenMint};">
    <tr>
      <td style="padding:18px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="width:48px;height:48px;border-radius:14px;background:${sharedStyles.white};border:1px solid ${sharedStyles.greenMint};text-align:center;vertical-align:middle;box-shadow:0 2px 8px rgba(22,163,74,0.06);">
              <span style="font-size:22px;line-height:48px;">${emoji}</span>
            </td>
            <td style="padding-left:16px;vertical-align:middle;">
              <p style="margin:0 0 3px;font-size:15px;font-weight:700;color:${sharedStyles.greenDark};">${title}</p>
              <p style="margin:0;font-size:13px;color:${sharedStyles.textSecondary};line-height:1.55;">${description}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;

const buildCtaButton = (url, text) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
    <tr>
      <td style="border-radius:50px;background:${sharedStyles.bannerGradient};padding:0;box-shadow:0 6px 24px rgba(22,163,74,0.20);">
        <a href="${url}" target="_blank" style="display:inline-block;padding:16px 44px;font-size:16px;font-weight:700;color:${sharedStyles.white};text-decoration:none;letter-spacing:0.3px;">
          ${text}
        </a>
      </td>
    </tr>
  </table>`;

const buildFooter = (lines, showUnsubscribe = false, unsubscribeUrl = "") => {
  const currentYear = getCurrentYear();
  let footerContent = lines
    .map(
      (line, i) =>
        `<p style="margin:0 0 ${i < lines.length - 1 ? "10px" : "0"};font-size:13px;color:rgba(255,255,255,${i === 0 ? "0.75" : "0.50"});line-height:1.65;">${line}</p>`
    )
    .join("");

  if (showUnsubscribe && unsubscribeUrl) {
    footerContent += `
      <div style="margin-top:20px;">
        <a href="${unsubscribeUrl}" style="display:inline-block;padding:10px 28px;border-radius:24px;border:1px solid rgba(255,255,255,0.18);color:rgba(255,255,255,0.55);font-size:12px;text-decoration:none;font-weight:600;letter-spacing:0.3px;">
          Unsubscribe
        </a>
      </div>`;
  }

  footerContent += `
    <p style="margin:24px 0 0;font-size:11px;color:rgba(255,255,255,0.25);letter-spacing:0.3px;">
      © ${currentYear} Altuvera Safaris. All rights reserved.
    </p>`;

  return `
  <tr>
    <td style="background:linear-gradient(135deg,${sharedStyles.footerBg},${sharedStyles.greenDark});padding:36px 44px;text-align:center;">
      ${footerContent}
    </td>
  </tr>`;
};

const buildQuoteSection = (quote, author) => `
  <tr>
    <td style="background:linear-gradient(135deg,${sharedStyles.greenPale},${sharedStyles.greenMint});padding:36px 44px;text-align:center;">
      <p style="margin:0 0 10px;font-size:17px;font-style:italic;color:${sharedStyles.greenDark};line-height:1.65;font-weight:500;">
        "${quote}"
      </p>
      <p style="margin:0;font-size:13px;color:${sharedStyles.textSecondary};font-weight:700;letter-spacing:0.3px;">
        — ${author}
      </p>
    </td>
  </tr>`;

const buildSectionLabel = (text) => `
  <p style="margin:0 0 16px;font-size:12px;font-weight:700;color:${sharedStyles.textMuted};text-transform:uppercase;letter-spacing:2px;text-align:center;">
    ${text}
  </p>`;

// ============================================================
// EMAIL TEMPLATES
// ============================================================

const buildVerificationEmailHtml = (code, fullName, supportEmail, recipientEmail = "", recipientAvatarUrl = "") => {
  const normalizedCode = String(code ?? "").trim();
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new TypeError("Verification code must contain exactly six digits.");
  }

  const safeName = String(fullName || "Traveler").trim() || "Traveler";
  const greeting = safeName !== "Traveler" ? `, ${escapeHtml(safeName)}` : "";
  const siteUrl = String(getEnvVar("SITE_URL", "https://www.altuverasafaris.com")).replace(/\/+$/, "");
  const copyCodeUrl = `${siteUrl}/copy-code.html#${safeEncodeURI(normalizedCode)}`;
  const safeSupportEmail = escapeHtml(supportEmail || "info@altuverasafaris.com");

  // Keep one uninterrupted six-digit code near the beginning so mail clients
  // can identify it as an OTP without searching through decorative text.
  const content = `
    <tr>
      <td style="padding:32px 36px 12px;text-align:left;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="left" valign="middle">
              <img src="${escapeHtml(EMAIL_LOGO_URL)}" width="148" height="66" alt="Altuvera Safaris" style="display:block;width:148px;height:66px;object-fit:contain;" />
            </td>
          </tr>
        </table>

        <p style="margin:28px 0 10px;font-size:17px;color:${sharedStyles.textPrimary};line-height:1.5;font-weight:600;">
          Hi${greeting},
        </p>
        <h1 style="margin:0 0 12px;font-size:25px;font-weight:800;color:${sharedStyles.greenDark};line-height:1.25;letter-spacing:-0.3px;">
          Your Altuvera login code
        </h1>
        <p style="margin:0;font-size:15px;color:${sharedStyles.textSecondary};line-height:1.7;">
          Enter this one-time code to continue signing in to your Altuvera Safaris account.
        </p>
      </td>
    </tr>

    <tr>
      <td style="padding:22px 36px 8px;text-align:left;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${sharedStyles.greenBorder};border-radius:16px;background:${sharedStyles.greenPale};">
          <tr>
            <td align="center" style="padding:22px 16px 18px;">
              <p style="margin:0 0 10px;font-size:11px;font-weight:800;color:${sharedStyles.textMuted};letter-spacing:1.8px;text-transform:uppercase;">
                Verification code
              </p>
              <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:38px;font-weight:800;line-height:1.3;letter-spacing:7px;color:${sharedStyles.greenDark};white-space:nowrap;">
                ${normalizedCode}
              </p>
              <p style="margin:12px 0 0;font-size:12px;color:${sharedStyles.textSecondary};line-height:1.5;">
                Expires in 10 minutes
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:18px 36px 8px;text-align:left;">
        ${buildCtaButton(copyCodeUrl, "Copy code")}
        <p style="margin:12px 0 0;font-size:12px;color:${sharedStyles.textMuted};line-height:1.6;text-align:center;">
          Your email app may also offer its own Copy code shortcut. You can use that, or select the six digits above.
        </p>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 36px 12px;">
        <div style="height:1px;background:${sharedStyles.greenBorder};"></div>
        <p style="margin:18px 0 8px;font-size:14px;font-weight:700;color:${sharedStyles.greenDark};">
          Keep your account safe
        </p>
        <p style="margin:0;font-size:13px;color:${sharedStyles.textSecondary};line-height:1.7;">
          Never share this code with anyone. Altuvera Safaris will never ask you to read it out over the phone or send it in a message.
        </p>
      </td>
    </tr>

    <tr>
      <td style="padding:12px 36px 28px;">
        <p style="margin:0;font-size:13px;color:${sharedStyles.textSecondary};line-height:1.7;">
          Didn't request this code? You can safely ignore this email. The code will expire automatically.
        </p>
        <p style="margin:16px 0 0;font-size:12px;color:${sharedStyles.textMuted};line-height:1.6;">
          Need help? <a href="mailto:${safeSupportEmail}" style="color:${sharedStyles.greenMid};font-weight:700;text-decoration:none;">${safeSupportEmail}</a>
        </p>
      </td>
    </tr>

    ${buildFooter([
      "This one-time code was requested for your Altuvera Safaris account.",
      "This is an automated security message — please do not reply.",
    ])}`;

  return buildOuterWrapper(content);
};
const buildWelcomeSubscriberEmailHtml = (email) => {
  const validatedEmail = validateEmail(email);
  const siteUrl        = getEnvVar("SITE_URL", "https://www.altuverasafaris.com");
  const unsubscribeUrl = `${siteUrl}/api/subscribers/unsubscribe/${safeEncodeURI(validatedEmail)}`;
  const exploreUrl     = `${siteUrl}/explore`;

  const content = `
    ${buildBanner("🌿", "Altuvera Safaris", "Premium Safari & Adventures", "", validatedEmail)}

    <tr>
      <td style="padding:48px 44px 36px;text-align:center;">
        ${buildIconCircle("🎉", 80)}
        <h2 style="margin:0 0 14px;font-size:26px;font-weight:700;color:${sharedStyles.textPrimary};line-height:1.3;">
          Welcome to the Family!
        </h2>
        <p style="margin:0 0 10px;font-size:16px;color:${sharedStyles.textSecondary};line-height:1.75;">
          Thank you for subscribing to our newsletter.
        </p>
        <p style="margin:0;font-size:16px;color:${sharedStyles.textSecondary};line-height:1.75;">
          We'll share occasional destination inspiration, practical travel tips, and useful updates to help you plan an African adventure.
        </p>
      </td>
    </tr>

    ${buildDivider()}

    <tr>
      <td style="padding:36px 44px;">
        <h3 style="margin:0 0 24px;font-size:18px;font-weight:700;color:${sharedStyles.textPrimary};text-align:center;">
          What You'll Receive
        </h3>
        ${buildInfoCard("📸", "Destination Stories", "Hand-picked destinations with stunning photography and insider knowledge")}
        ${buildInfoCard("🎁", "Exclusive Offers", "Relevant offers and updates when available")}
        ${buildInfoCard("🦁", "Wildlife Updates", "Migration tracking, conservation news, and wildlife photography tips")}
        ${buildInfoCard("🗺️", "Travel Planning Tips", "Expert advice on best seasons, packing guides, and itinerary ideas")}
      </td>
    </tr>

    <tr>
      <td style="padding:8px 44px 44px;text-align:center;">
        ${buildCtaButton(exploreUrl, "Start Exploring →")}
      </td>
    </tr>

    ${buildQuoteSection(
      "The world is a book, and those who do not travel read only one page.",
      "Saint Augustine"
    )}

    <tr>
      <td style="padding:36px 44px;text-align:center;">
        ${buildSectionLabel("Follow Our Journey")}
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            ${["📘", "📷", "🐦", "▶️"]
              .map(
                (icon) => `
              <td style="padding:0 6px;">
                <a href="#" style="display:inline-block;width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,${sharedStyles.greenPale},${sharedStyles.greenMint});border:1px solid ${sharedStyles.greenBorder};text-align:center;line-height:44px;text-decoration:none;font-size:18px;box-shadow:0 2px 8px rgba(22,163,74,0.06);">${icon}</a>
              </td>`
              )
              .join("")}
          </tr>
        </table>
      </td>
    </tr>

    ${buildFooter(
      [
        `You're receiving this because <strong style="color:#86efac;">${escapeHtml(validatedEmail)}</strong> subscribed to our newsletter.`,
        "We respect your inbox. Expect occasional destination inspiration and practical travel guidance; unsubscribe at any time.",
      ],
      true,
      unsubscribeUrl
    )}`;

  return buildOuterWrapper(content);
};

const buildUnsubscribeConfirmationEmailHtml = (email) => {
  const validatedEmail = validateEmail(email);
  const siteUrl        = getEnvVar("SITE_URL", "https://www.altuverasafaris.com");
  const resubscribeUrl = `${siteUrl}/explore`;
  const supportEmail   = "info@altuverasafaris.com";

  const content = `
    ${buildBanner("🌿", "Altuvera Safaris", "Premium Safari & Adventures", "", validatedEmail)}

    <tr>
      <td style="padding:48px 44px 36px;text-align:center;">
        ${buildIconCircle("👋", 80)}
        <h2 style="margin:0 0 14px;font-size:26px;font-weight:700;color:${sharedStyles.textPrimary};line-height:1.3;">
          We're Sorry to See You Go
        </h2>
        <p style="margin:0;font-size:16px;color:${sharedStyles.textSecondary};line-height:1.75;max-width:440px;display:inline-block;">
          You've been successfully unsubscribed from our newsletter. You won't receive any more emails from us.
        </p>
      </td>
    </tr>

    ${buildDivider()}

    <tr>
      <td style="padding:36px 44px;text-align:center;">
        ${buildSectionLabel("Unsubscribed Email")}

        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
          <tr>
            <td style="background:linear-gradient(135deg,${sharedStyles.greenPale},${sharedStyles.greenMint});border-radius:20px;padding:22px 40px;border:2px solid ${sharedStyles.greenBorder};box-shadow:0 4px 20px rgba(22,163,74,0.08);">
              <p style="margin:0;font-size:16px;font-weight:700;color:${sharedStyles.greenMid};">
                ${escapeHtml(validatedEmail)}
              </p>
            </td>
          </tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td style="padding:12px 28px;background-color:${sharedStyles.greenMint};border-radius:28px;border:1px solid ${sharedStyles.greenBorder};">
              <p style="margin:0;font-size:14px;color:${sharedStyles.greenDark};font-weight:600;">
                ✓ Successfully removed from mailing list
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="background:linear-gradient(135deg,${sharedStyles.greenPale},rgba(255,255,255,0.95));padding:36px 44px;text-align:center;">
        ${buildIconCircle("💚", 56)}
        <h3 style="margin:0 0 10px;font-size:18px;font-weight:700;color:${sharedStyles.textPrimary};">
          Changed Your Mind?
        </h3>
        <p style="margin:0 0 24px;font-size:14px;color:${sharedStyles.textSecondary};line-height:1.65;">
          You can always resubscribe to continue receiving travel inspiration and exclusive offers.
        </p>
        ${buildCtaButton(resubscribeUrl, "Resubscribe →")}
      </td>
    </tr>

    <tr>
      <td style="padding:36px 44px;">
        ${buildInfoCard("💬", "We'd Love Your Feedback", `Tell us how we can improve at <a href="mailto:${supportEmail}" style="color:${sharedStyles.greenMid};font-weight:700;text-decoration:none;">${supportEmail}</a>`)}
      </td>
    </tr>

    ${buildQuoteSection(
      "Until we meet again on the savanna...",
      "The Altuvera Safaris Team"
    )}

    ${buildFooter([
      "This is a confirmation of your unsubscribe request.",
      "No further action is needed. This is an automated message.",
    ])}`;

  return buildOuterWrapper(content);
};

// ============================================================
// CORE SEND FUNCTION (Resend HTTP API — no SMTP ports needed)
// ============================================================

/**
 * @param {{ to: string, subject: string, html: string,
 *           text?: string, from?: string }} mailOptions
 * @param {string} logMessage
 * @returns {Promise<{ delivered: boolean, id?: string, fallback?: string }>}
 */
async function sendEmail(mailOptions, logMessage) {
  const config = getEmailConfig();

  // ── Dev fallback: just log, don't crash ──────────────────
  if (!config.isConfigured) {
    if (config.devFallback) {
      console.warn(
        `[DEV FALLBACK] Resend not configured. Email to: ${mailOptions.to}`
      );
      return { delivered: false, fallback: "console" };
    }
    const configError = new Error(
      "Email service is not configured. Set a valid RESEND_API_KEY."
    );
    configError.statusCode = 503;
    configError.code       = "EMAIL_NOT_CONFIGURED";
    throw configError;
  }

  const client = getResendClient();

  const fromAddress =
    mailOptions.from ||
    `Altuvera Safaris <info@altuverasafaris.com>`;

  // ── Retry loop (3 attempts) ──────────────────────────────
  const MAX_ATTEMPTS = 3;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { data, error } = await client.emails.send({
        from:    fromAddress,
        to:      mailOptions.to,
        subject: mailOptions.subject,
        html:    mailOptions.html,
        ...(mailOptions.text ? { text: mailOptions.text } : {}),
      });

      if (error) {
        // Resend returns errors in { error } shape — treat as thrown
        throw Object.assign(
          new Error(error.message || "Resend API error"),
          { statusCode: error.statusCode, code: "RESEND_API_ERROR" }
        );
      }

      console.log(`${logMessage} [id: ${data?.id}]`);
      return { delivered: true, id: data?.id };

    } catch (err) {
      lastError = err;
      console.warn(
        `[Email] Attempt ${attempt}/${MAX_ATTEMPTS} failed for ${mailOptions.to}: ${err.message}`
      );

      // Don't retry on config/auth errors — they won't self-heal
      const fatalCodes = ["RESEND_API_ERROR", "EMAIL_NOT_CONFIGURED"];
      const fatalStatuses = [401, 403, 422];
      if (
        fatalCodes.includes(err.code) ||
        fatalStatuses.includes(err.statusCode)
      ) {
        break;
      }

      // Exponential back-off: 1 s, 2 s
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      }
    }
  }

  // ── All attempts exhausted ───────────────────────────────
  console.error(`❌ Email send failed after ${MAX_ATTEMPTS} attempts:`, lastError?.message);

  if (config.devFallback) {
    console.warn(
      `[DEV FALLBACK] All attempts failed. Email to: ${mailOptions.to}`
    );
    return { delivered: false, fallback: "console" };
  }

  const deliveryError = new Error("Email delivery failed. Please try again.");
  deliveryError.statusCode = 503;
  deliveryError.code       = "EMAIL_DELIVERY_FAILED";
  throw deliveryError;
}

// ============================================================
// PUBLIC SENDING FUNCTIONS
// ============================================================

async function sendVerificationCode(email, code, fullName, recipientAvatarUrl = "") {
  const config = getEmailConfig();
  const supportEmail = "info@altuverasafaris.com";
  const normalizedCode = String(code ?? "").trim();

  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new TypeError("Verification code must contain exactly six digits.");
  }

  if (!config.isConfigured && config.devFallback) {
    console.warn(
      `[DEV FALLBACK] Resend not configured. Verification code generated for ${email}.`
    );
    return { delivered: false, fallback: "console", code: normalizedCode };
  }

  const result = await sendEmail(
    {
      to: email,
      subject: `${normalizedCode} - Your Altuvera login code`,
      html: buildVerificationEmailHtml(normalizedCode, fullName, supportEmail, email, recipientAvatarUrl),
      text: `Your Altuvera Safaris login code is:\n\n${normalizedCode}\n\nEnter this code to sign in. It expires in 10 minutes. Never share this code.`,
    },
    `✅ Verification code sent to ${email}`
  );

  if (!result.delivered && result.fallback) {
    result.code = normalizedCode;
  }
  return result;
}
async function sendWelcomeEmail(email) {
  const validatedEmail = validateEmail(email);

  return sendEmail(
    {
      from:    `Altuvera Safaris <info@altuverasafaris.com>`,
      to:      validatedEmail,
      subject: "Welcome to Altuvera Safaris",
      html:    buildWelcomeSubscriberEmailHtml(validatedEmail),
      text:    `Welcome to Altuvera Safaris! Visit us at ${getEnvVar("SITE_URL", "https://www.altuverasafaris.com")}/explore`,
    },
    `✅ Welcome email sent to ${validatedEmail}`
  );
}

async function sendUnsubscribeConfirmation(email) {
  const validatedEmail = validateEmail(email);

  return sendEmail(
    {
      from:    `Altuvera Safaris <info@altuverasafaris.com>`,
      to:      validatedEmail,
      subject: "Newsletter Unsubscribe Confirmed | Altuvera Safaris",
      html:    buildUnsubscribeConfirmationEmailHtml(validatedEmail),
      text:    "You have been successfully unsubscribed from Altuvera Safaris emails.",
    },
    `✅ Unsubscribe confirmation sent to ${validatedEmail}`
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Sending functions
  sendVerificationCode,
  sendWelcomeEmail,
  sendUnsubscribeConfirmation,

  // Template builders (for testing / custom use)
  buildVerificationEmailHtml,
  buildWelcomeSubscriberEmailHtml,
  buildUnsubscribeConfirmationEmailHtml,

  // Utilities
  validateEmail,
  getEmailConfig,
  escapeHtml,
  resetResendClient,
};