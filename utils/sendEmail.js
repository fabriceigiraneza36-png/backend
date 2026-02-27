const nodemailer = require("nodemailer");

// ============================================================
// CONFIGURATION & UTILITIES
// ============================================================

/**
 * Reads SMTP configuration from environment variables.
 * @returns {Object} SMTP config with flags for configured state and dev fallback.
 */
const getEmailConfig = () => {
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = parseInt(process.env.SMTP_PORT, 10) || 587;
  const smtpUser = process.env.SMTP_USER || "";
  const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const isConfigured = Boolean(
    smtpUser &&
      smtpPass &&
      !smtpUser.includes("your-email") &&
      !smtpPass.includes("your-app-password")
  );
  const devFallback =
    process.env.NODE_ENV !== "production" &&
    process.env.AUTH_ALLOW_DEV_OTP_FALLBACK === "true";

  return {
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    isConfigured,
    devFallback,
  };
};

/**
 * Creates a Nodemailer transporter based on the provided config.
 * @param {Object} config - Email configuration object.
 * @returns {Object} Nodemailer transporter.
 */
const createTransporter = (config) =>
  nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: config.isConfigured
      ? {
          user: config.smtpUser,
          pass: config.smtpPass,
        }
      : undefined,
  });

/**
 * Validates and sanitizes email input
 * @param {*} email - Input to validate
 * @returns {string} Sanitized email string
 * @throws {TypeError} If email is invalid
 */
const validateEmail = (email) => {
  if (email === null || email === undefined) {
    throw new TypeError("Email parameter is required and cannot be null or undefined");
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

/**
 * Safely encodes a string for URL usage
 * @param {string} str - String to encode
 * @returns {string} URL-encoded string
 */
const safeEncodeURI = (str) => {
  try {
    return encodeURIComponent(String(str || ""));
  } catch (error) {
    console.error("Error encoding URI component:", error);
    return "";
  }
};

/**
 * Gets environment variable with fallback
 * @param {string} key - Environment variable key
 * @param {string} fallback - Fallback value
 * @returns {string} Environment variable value or fallback
 */
const getEnvVar = (key, fallback) => {
  try {
    if (typeof process !== "undefined" && process.env && process.env[key]) {
      return process.env[key];
    }
    return fallback;
  } catch (error) {
    return fallback;
  }
};

/**
 * Escapes HTML entities in a string for security
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
const escapeHtml = (str) => {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

/**
 * Gets current year safely
 * @returns {number} Current year
 */
const getCurrentYear = () => {
  try {
    return new Date().getFullYear();
  } catch (error) {
    return 2024;
  }
};

// ============================================================
// EMAIL TEMPLATES
// ============================================================

/**
 * Builds verification code email with green/white theme
 * @param {string} code - The verification code
 * @param {string} fullName - Recipient's full name
 * @param {string} supportEmail - Support email address
 * @returns {string} HTML email body
 */
const buildVerificationEmailHtml = (code, fullName, supportEmail) => {
  const safeName = fullName || "Traveler";
  const currentYear = getCurrentYear();
  const siteUrl = getEnvVar("SITE_URL", "http://localhost:3000");

  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Your Altuvera Verification Code</title>
  <!--[if mso]>
  <style type="text/css">
    table, td { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#F0FDF4;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <!-- Outer wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F0FDF4;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Main card -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(22,163,74,0.08);">

          <!-- ═══════════ TOP GREEN BANNER ═══════════ -->
          <tr>
            <td style="background:linear-gradient(135deg,#15803D 0%,#16A34A 50%,#22C55E 100%);padding:48px 40px;text-align:center;">
              <div style="font-size:48px;margin-bottom:16px;">🔐</div>
              <h1 style="margin:0 0 8px;font-size:28px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;line-height:1.2;">
                Altuvera
              </h1>
              <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.8);letter-spacing:1.5px;text-transform:uppercase;font-weight:600;">
                Secure Travel Platform
              </p>
            </td>
          </tr>

          <!-- ═══════════ GREETING SECTION ═══════════ -->
          <tr>
            <td style="padding:48px 40px 32px;text-align:center;">
              <!-- Lock icon -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="width:72px;height:72px;border-radius:50%;background-color:#F0FDF4;border:2px solid #BBF7D0;text-align:center;vertical-align:middle;">
                    <span style="font-size:32px;line-height:72px;">✉️</span>
                  </td>
                </tr>
              </table>

              <h2 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0F1B0F;line-height:1.3;">
                Hello${safeName !== "Traveler" ? `, ${escapeHtml(safeName)}` : ""}!
              </h2>
              <p style="margin:0;font-size:16px;color:#5A7A5A;line-height:1.7;">
                We received a request to access your account. Use the verification code below to continue.
              </p>
            </td>
          </tr>

          <!-- ═══════════ DIVIDER ═══════════ -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background:linear-gradient(90deg,transparent,#BBF7D0,transparent);"></div>
            </td>
          </tr>

          <!-- ═══════════ VERIFICATION CODE ═══════════ -->
          <tr>
            <td style="padding:32px 40px;text-align:center;">
              <p style="margin:0 0 16px;font-size:13px;font-weight:700;color:#3F5C3F;text-transform:uppercase;letter-spacing:1.5px;">
                Your Verification Code
              </p>
              
              <!-- Code box -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#F0FDF4,#DCFCE7);border-radius:16px;padding:24px 48px;border:2px solid #BBF7D0;">
                    <p style="margin:0;font-family:'Courier New',monospace;font-size:42px;font-weight:800;color:#15803D;letter-spacing:8px;">
                      ${code}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Expiry notice -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="padding:12px 24px;background-color:#FEF3C7;border-radius:24px;border:1px solid #FDE68A;">
                    <p style="margin:0;font-size:14px;color:#92400E;font-weight:600;">
                      ⏱️ Valid for 10 minutes
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════ SECURITY NOTICE ═══════════ -->
          <tr>
            <td style="padding:0 40px 32px;">
              <!-- Security tip -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F0FDF4;border-radius:16px;border:1px solid #DCFCE7;">
                <tr>
                  <td style="padding:20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="width:44px;height:44px;border-radius:12px;background-color:#FFFFFF;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;">
                          <span style="font-size:20px;line-height:44px;">🔒</span>
                        </td>
                        <td style="padding-left:16px;vertical-align:middle;">
                          <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#166534;">Security Reminder</p>
                          <p style="margin:0;font-size:13px;color:#5A7A5A;line-height:1.5;">Never share this code with anyone. Altuvera will never ask for your code via phone or email.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════ DIDN'T REQUEST THIS ═══════════ -->
          <tr>
            <td style="background-color:#F0FDF4;padding:32px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#166534;">
                Didn't request this code?
              </p>
              <p style="margin:0;font-size:14px;color:#5A7A5A;line-height:1.6;">
                If you didn't request this verification, no action is needed. The code will expire automatically.
              </p>
            </td>
          </tr>

          <!-- ═══════════ SUPPORT SECTION ═══════════ -->
          <tr>
            <td style="padding:32px 40px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#FFFFFF;border-radius:16px;border:1px solid #DCFCE7;">
                <tr>
                  <td style="padding:20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="width:44px;height:44px;border-radius:12px;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;">
                          <span style="font-size:20px;line-height:44px;">💬</span>
                        </td>
                        <td style="padding-left:16px;vertical-align:middle;">
                          <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#166534;">Need Help?</p>
                          <p style="margin:0;font-size:13px;color:#5A7A5A;line-height:1.5;">
                            Contact our support team at 
                            <a href="mailto:${supportEmail}" style="color:#15803D;font-weight:600;text-decoration:none;">${supportEmail}</a>
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════ FOOTER ═══════════ -->
          <tr>
            <td style="background-color:#14532D;padding:32px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.7);line-height:1.6;">
                This verification code was requested for your Altuvera account.
              </p>
              <p style="margin:0 0 16px;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">
                This is an automated message. Please do not reply to this email.
              </p>
              <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.3);">
                © ${currentYear} Altuvera. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
        <!-- End main card -->

      </td>
    </tr>
  </table>

</body>
</html>`;
};

/**
 * Builds welcome email for new subscribers with green/white theme
 * @param {string} email - Subscriber's email address
 * @returns {string} HTML email body
 */
const buildWelcomeSubscriberEmailHtml = (email) => {
  const validatedEmail = validateEmail(email);
  const siteUrl = getEnvVar("SITE_URL", "http://localhost:3000");
  const unsubscribeUrl = `${siteUrl}/api/subscribers/unsubscribe/${safeEncodeURI(validatedEmail)}`;
  const exploreUrl = `${siteUrl}/explore`;
  const currentYear = getCurrentYear();

  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Welcome to East Africa Explorer</title>
  <!--[if mso]>
  <style type="text/css">
    table, td { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#F0FDF4;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <!-- Outer wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F0FDF4;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Main card -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(22,163,74,0.08);">

          <!-- ═══════════ TOP GREEN BANNER ═══════════ -->
          <tr>
            <td style="background:linear-gradient(135deg,#15803D 0%,#16A34A 50%,#22C55E 100%);padding:48px 40px;text-align:center;">
              <div style="font-size:48px;margin-bottom:16px;">🌿</div>
              <h1 style="margin:0 0 8px;font-size:28px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;line-height:1.2;">
                East Africa Explorer
              </h1>
              <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.8);letter-spacing:1.5px;text-transform:uppercase;font-weight:600;">
                Premium Safari & Adventures
              </p>
            </td>
          </tr>

          <!-- ═══════════ WELCOME SECTION ═══════════ -->
          <tr>
            <td style="padding:48px 40px 32px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="width:72px;height:72px;border-radius:50%;background-color:#F0FDF4;border:2px solid #BBF7D0;text-align:center;vertical-align:middle;">
                    <span style="font-size:32px;line-height:72px;">🎉</span>
                  </td>
                </tr>
              </table>

              <h2 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0F1B0F;line-height:1.3;">
                Welcome to the Family!
              </h2>
              <p style="margin:0 0 8px;font-size:16px;color:#5A7A5A;line-height:1.7;">
                Thank you so much for subscribing to our newsletter.
              </p>
              <p style="margin:0;font-size:16px;color:#5A7A5A;line-height:1.7;">
                You've joined <strong style="color:#15803D;">25,000+ adventurers</strong> who receive exclusive travel inspiration, insider tips, and members-only offers.
              </p>
            </td>
          </tr>

          <!-- ═══════════ DIVIDER ═══════════ -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background:linear-gradient(90deg,transparent,#BBF7D0,transparent);"></div>
            </td>
          </tr>

          <!-- ═══════════ WHAT YOU'LL RECEIVE ═══════════ -->
          <tr>
            <td style="padding:32px 40px;">
              <h3 style="margin:0 0 20px;font-size:18px;font-weight:700;color:#0F1B0F;text-align:center;">
                What You'll Receive
              </h3>

              <!-- Benefit 1 -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
                <tr>
                  <td style="width:44px;height:44px;border-radius:12px;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;">
                    <span style="font-size:20px;line-height:44px;">📸</span>
                  </td>
                  <td style="padding-left:16px;vertical-align:middle;">
                    <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#166534;">Destination Stories</p>
                    <p style="margin:0;font-size:13px;color:#5A7A5A;line-height:1.5;">Hand-picked destinations with stunning photography and insider knowledge</p>
                  </td>
                </tr>
              </table>

              <!-- Benefit 2 -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
                <tr>
                  <td style="width:44px;height:44px;border-radius:12px;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;">
                    <span style="font-size:20px;line-height:44px;">🎁</span>
                  </td>
                  <td style="padding-left:16px;vertical-align:middle;">
                    <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#166534;">Exclusive Offers</p>
                    <p style="margin:0;font-size:13px;color:#5A7A5A;line-height:1.5;">Members-only discounts and early access to new experiences</p>
                  </td>
                </tr>
              </table>

              <!-- Benefit 3 -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
                <tr>
                  <td style="width:44px;height:44px;border-radius:12px;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;">
                    <span style="font-size:20px;line-height:44px;">🦁</span>
                  </td>
                  <td style="padding-left:16px;vertical-align:middle;">
                    <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#166534;">Wildlife Updates</p>
                    <p style="margin:0;font-size:13px;color:#5A7A5A;line-height:1.5;">Migration tracking, conservation news, and wildlife photography tips</p>
                  </td>
                </tr>
              </table>

              <!-- Benefit 4 -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="width:44px;height:44px;border-radius:12px;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;">
                    <span style="font-size:20px;line-height:44px;">🗺️</span>
                  </td>
                  <td style="padding-left:16px;vertical-align:middle;">
                    <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#166534;">Travel Planning Tips</p>
                    <p style="margin:0;font-size:13px;color:#5A7A5A;line-height:1.5;">Expert advice on best seasons, packing guides, and itinerary ideas</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════ CTA BUTTON ═══════════ -->
          <tr>
            <td style="padding:16px 40px 40px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="border-radius:50px;background:linear-gradient(135deg,#15803D,#22C55E);padding:0;">
                    <a href="${exploreUrl}" target="_blank" style="display:inline-block;padding:16px 40px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.3px;">
                      Start Exploring →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════ QUOTE SECTION ═══════════ -->
          <tr>
            <td style="background-color:#F0FDF4;padding:32px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:16px;font-style:italic;color:#166534;line-height:1.6;">
                "The world is a book, and those who do not travel read only one page."
              </p>
              <p style="margin:0;font-size:13px;color:#5A7A5A;font-weight:600;">
                — Saint Augustine
              </p>
            </td>
          </tr>

          <!-- ═══════════ SOCIAL LINKS ═══════════ -->
          <tr>
            <td style="padding:32px 40px;text-align:center;">
              <p style="margin:0 0 16px;font-size:13px;font-weight:700;color:#3F5C3F;text-transform:uppercase;letter-spacing:1.5px;">
                Follow Our Journey
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="padding:0 8px;">
                    <a href="#" style="display:inline-block;width:40px;height:40px;border-radius:50%;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;line-height:40px;text-decoration:none;font-size:18px;">📘</a>
                  </td>
                  <td style="padding:0 8px;">
                    <a href="#" style="display:inline-block;width:40px;height:40px;border-radius:50%;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;line-height:40px;text-decoration:none;font-size:18px;">📷</a>
                  </td>
                  <td style="padding:0 8px;">
                    <a href="#" style="display:inline-block;width:40px;height:40px;border-radius:50%;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;line-height:40px;text-decoration:none;font-size:18px;">🐦</a>
                  </td>
                  <td style="padding:0 8px;">
                    <a href="#" style="display:inline-block;width:40px;height:40px;border-radius:50%;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;line-height:40px;text-decoration:none;font-size:18px;">▶️</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════ FOOTER ═══════════ -->
          <tr>
            <td style="background-color:#14532D;padding:32px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.7);line-height:1.6;">
                You're receiving this because <strong style="color:#86EFAC;">${escapeHtml(validatedEmail)}</strong> subscribed to our newsletter.
              </p>
              <p style="margin:0 0 16px;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">
                We respect your inbox. Expect 1-2 emails per week, maximum.
              </p>
              <a href="${unsubscribeUrl}" style="display:inline-block;padding:8px 24px;border-radius:20px;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.6);font-size:12px;text-decoration:none;font-weight:600;">
                Unsubscribe
              </a>
              <p style="margin:20px 0 0;font-size:11px;color:rgba(255,255,255,0.3);">
                © ${currentYear} East Africa Explorer. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
        <!-- End main card -->

      </td>
    </tr>
  </table>

</body>
</html>`;
};

/**
 * Builds unsubscribe confirmation email with green/white theme
 * @param {string} email - Subscriber's email address
 * @returns {string} HTML email body
 */
const buildUnsubscribeConfirmationEmailHtml = (email) => {
  const validatedEmail = validateEmail(email);
  const siteUrl = getEnvVar("SITE_URL", "http://localhost:3000");
  const resubscribeUrl = `${siteUrl}/explore`;
  const supportEmail = getEnvVar("ADMIN_EMAIL", "fabriceigiraneza36@gmail.com");
  const currentYear = getCurrentYear();

  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>You've Been Unsubscribed</title>
  <!--[if mso]>
  <style type="text/css">
    table, td { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#F0FDF4;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <!-- Outer wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F0FDF4;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Main card -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(22,163,74,0.08);">

          <!-- ═══════════ TOP GREEN BANNER ═══════════ -->
          <tr>
            <td style="background:linear-gradient(135deg,#15803D 0%,#16A34A 50%,#22C55E 100%);padding:48px 40px;text-align:center;">
              <div style="font-size:48px;margin-bottom:16px;">🌿</div>
              <h1 style="margin:0 0 8px;font-size:28px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;line-height:1.2;">
                East Africa Explorer
              </h1>
              <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.8);letter-spacing:1.5px;text-transform:uppercase;font-weight:600;">
                Premium Safari & Adventures
              </p>
            </td>
          </tr>

          <!-- ═══════════ GOODBYE SECTION ═══════════ -->
          <tr>
            <td style="padding:48px 40px 32px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="width:72px;height:72px;border-radius:50%;background-color:#F0FDF4;border:2px solid #BBF7D0;text-align:center;vertical-align:middle;">
                    <span style="font-size:32px;line-height:72px;">👋</span>
                  </td>
                </tr>
              </table>

              <h2 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0F1B0F;line-height:1.3;">
                We're Sorry to See You Go
              </h2>
              <p style="margin:0;font-size:16px;color:#5A7A5A;line-height:1.7;">
                You've been successfully unsubscribed from our newsletter. You won't receive any more emails from us.
              </p>
            </td>
          </tr>

          <!-- ═══════════ DIVIDER ═══════════ -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background:linear-gradient(90deg,transparent,#BBF7D0,transparent);"></div>
            </td>
          </tr>

          <!-- ═══════════ CONFIRMATION BOX ═══════════ -->
          <tr>
            <td style="padding:32px 40px;text-align:center;">
              <p style="margin:0 0 16px;font-size:13px;font-weight:700;color:#3F5C3F;text-transform:uppercase;letter-spacing:1.5px;">
                Unsubscribed Email
              </p>
              
              <!-- Email box -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#F0FDF4,#DCFCE7);border-radius:16px;padding:20px 32px;border:2px solid #BBF7D0;">
                    <p style="margin:0;font-size:16px;font-weight:700;color:#15803D;">
                      ${escapeHtml(validatedEmail)}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Success notice -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="padding:12px 24px;background-color:#DCFCE7;border-radius:24px;border:1px solid #BBF7D0;">
                    <p style="margin:0;font-size:14px;color:#166534;font-weight:600;">
                      ✓ Successfully removed from mailing list
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════ CHANGED YOUR MIND ═══════════ -->
          <tr>
            <td style="background-color:#F0FDF4;padding:32px 40px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
                <tr>
                  <td style="width:48px;height:48px;border-radius:50%;background-color:#FFFFFF;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;">
                    <span style="font-size:24px;line-height:48px;">💚</span>
                  </td>
                </tr>
              </table>

              <h3 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0F1B0F;">
                Changed Your Mind?
              </h3>
              <p style="margin:0 0 20px;font-size:14px;color:#5A7A5A;line-height:1.6;">
                You can always resubscribe to continue receiving travel inspiration and exclusive offers.
              </p>

              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="border-radius:50px;background:linear-gradient(135deg,#15803D,#22C55E);padding:0;">
                    <a href="${resubscribeUrl}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.3px;">
                      Resubscribe →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════ FEEDBACK SECTION ═══════════ -->
          <tr>
            <td style="padding:32px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#FFFFFF;border-radius:16px;border:1px solid #DCFCE7;">
                <tr>
                  <td style="padding:20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="width:44px;height:44px;border-radius:12px;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;">
                          <span style="font-size:20px;line-height:44px;">💬</span>
                        </td>
                        <td style="padding-left:16px;vertical-align:middle;">
                          <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#166534;">We'd Love Your Feedback</p>
                          <p style="margin:0;font-size:13px;color:#5A7A5A;line-height:1.5;">
                            Tell us why you left at 
                            <a href="mailto:${supportEmail}" style="color:#15803D;font-weight:600;text-decoration:none;">${supportEmail}</a>
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════ QUOTE SECTION ═══════════ -->
          <tr>
            <td style="padding:0 40px 32px;text-align:center;">
              <p style="margin:0 0 8px;font-size:16px;font-style:italic;color:#166534;line-height:1.6;">
                "Until we meet again on the savanna..."
              </p>
              <p style="margin:0;font-size:13px;color:#5A7A5A;font-weight:600;">
                — The East Africa Explorer Team
              </p>
            </td>
          </tr>

          <!-- ═══════════ FOOTER ═══════════ -->
          <tr>
            <td style="background-color:#14532D;padding:32px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.7);line-height:1.6;">
                This is a confirmation of your unsubscribe request.
              </p>
              <p style="margin:0 0 16px;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">
                No further action is needed. This is an automated message.
              </p>
              <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.3);">
                © ${currentYear} East Africa Explorer. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
        <!-- End main card -->

      </td>
    </tr>
  </table>

</body>
</html>`;
};

// ============================================================
// EMAIL SENDING FUNCTIONS
// ============================================================

/**
 * Generic email sending function
 * @param {Object} mailOptions - Nodemailer mail options
 * @param {string} logMessage - Success log message
 * @returns {Promise<Object>} Delivery status
 */
async function sendEmail(mailOptions, logMessage) {
  const emailConfig = getEmailConfig();
  const transporter = createTransporter(emailConfig);

  if (!emailConfig.isConfigured) {
    if (emailConfig.devFallback) {
      console.warn(`[DEV FALLBACK] SMTP not configured. Email to: ${mailOptions.to}`);
      return { delivered: false, fallback: "console" };
    }
    const configError = new Error(
      "Email service is not configured. Set valid SMTP_USER and SMTP_PASS."
    );
    configError.statusCode = 503;
    configError.code = "EMAIL_NOT_CONFIGURED";
    throw configError;
  }

  try {
    await transporter.sendMail(mailOptions);
    console.log(logMessage);
    return { delivered: true };
  } catch (error) {
    console.error("❌ Email send error:", error.message);

    if (emailConfig.devFallback) {
      console.warn(`[DEV FALLBACK] SMTP error (${error.message}). Email to: ${mailOptions.to}`);
      return { delivered: false, fallback: "console" };
    }

    const deliveryError = new Error("Failed to send email. Please try again.");
    deliveryError.statusCode = 503;
    deliveryError.code = "EMAIL_DELIVERY_FAILED";
    throw deliveryError;
  }
}

/**
 * Sends a verification code email
 * @param {string} email - Recipient's email address
 * @param {string} code - The verification code
 * @param {string} [fullName] - Recipient's full name (optional)
 * @returns {Promise<Object>} Delivery status
 */
async function sendVerificationCode(email, code, fullName) {
  const emailConfig = getEmailConfig();
  const supportEmail = getEnvVar("ADMIN_EMAIL", "fabriceigiraneza36@gmail.com");

  const mailOptions = {
    from: `"Altuvera" <${getEnvVar("SMTP_FROM", emailConfig.smtpUser || "verify@altuvera.com")}>`,
    to: email,
    subject: "🔐 Your Altuvera Verification Code",
    html: buildVerificationEmailHtml(code, fullName, supportEmail),
  };

  if (!emailConfig.isConfigured && emailConfig.devFallback) {
    console.warn(`[DEV FALLBACK] SMTP not configured. Code for ${email}: ${code}`);
    return { delivered: false, fallback: "console", code };
  }

  const result = await sendEmail(mailOptions, `✅ Verification code sent to ${email}`);

  if (!result.delivered && result.fallback) {
    result.code = code;
  }

  return result;
}

/**
 * Sends a welcome email to new subscribers
 * @param {string} email - Recipient's email address
 * @returns {Promise<Object>} Delivery status
 */
async function sendWelcomeEmail(email) {
  const validatedEmail = validateEmail(email);
  const emailConfig = getEmailConfig();

  const mailOptions = {
    from: `"East Africa Explorer" <${getEnvVar("SMTP_FROM", emailConfig.smtpUser || "hello@eastafricaexplorer.com")}>`,
    to: validatedEmail,
    subject: "🌿 Welcome to East Africa Explorer! Your Adventure Begins",
    html: buildWelcomeSubscriberEmailHtml(validatedEmail),
  };

  return sendEmail(mailOptions, `✅ Welcome email sent to ${validatedEmail}`);
}

/**
 * Sends an unsubscribe confirmation email
 * @param {string} email - Recipient's email address
 * @returns {Promise<Object>} Delivery status
 */
async function sendUnsubscribeConfirmation(email) {
  const validatedEmail = validateEmail(email);
  const emailConfig = getEmailConfig();

  const mailOptions = {
    from: `"East Africa Explorer" <${getEnvVar("SMTP_FROM", emailConfig.smtpUser || "hello@eastafricaexplorer.com")}>`,
    to: validatedEmail,
    subject: "👋 You've Been Unsubscribed • East Africa Explorer",
    html: buildUnsubscribeConfirmationEmailHtml(validatedEmail),
  };

  return sendEmail(mailOptions, `✅ Unsubscribe confirmation sent to ${validatedEmail}`);
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Email sending functions
  sendVerificationCode,
  sendWelcomeEmail,
  sendUnsubscribeConfirmation,

  // Email template builders
  buildVerificationEmailHtml,
  buildWelcomeSubscriberEmailHtml,
  buildUnsubscribeConfirmationEmailHtml,

  // Utilities
  validateEmail,
  getEmailConfig,
  escapeHtml,
};