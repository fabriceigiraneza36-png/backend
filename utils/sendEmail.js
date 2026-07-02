const { Resend } = require("resend");

// ============================================================
// CONFIGURATION & UTILITIES
// ============================================================

const getEmailConfig = () => {
  const resendApiKey = process.env.RESEND_API_KEY || "";
  const fromDomain   = process.env.RESEND_FROM_DOMAIN || "altuvera.com";
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

const buildBanner = (emoji, title, subtitle) => `
  <tr>
    <td style="background:${sharedStyles.bannerGradient};padding:52px 44px;text-align:center;">
      <div style="width:72px;height:72px;margin:0 auto 20px;border-radius:20px;background:rgba(255,255,255,0.15);line-height:72px;font-size:36px;backdrop-filter:blur(10px);">
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
      © ${currentYear} East Africa Explorer. All rights reserved.
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

const buildVerificationEmailHtml = (code, fullName, supportEmail) => {
  const safeName = fullName || "Traveler";

  const content = `
    ${buildBanner("🔐", "Altuvera", "Secure Travel Platform")}

    <tr>
      <td style="padding:48px 44px 36px;text-align:center;">
        ${buildIconCircle("✉️", 80)}
        <h2 style="margin:0 0 14px;font-size:26px;font-weight:700;color:${sharedStyles.textPrimary};line-height:1.3;">
          Hello${safeName !== "Traveler" ? `, ${escapeHtml(safeName)}` : ""}!
        </h2>
        <p style="margin:0;font-size:16px;color:${sharedStyles.textSecondary};line-height:1.75;max-width:440px;display:inline-block;">
          We received a request to access your account. Use the verification code below to continue securely.
        </p>
      </td>
    </tr>

    ${buildDivider()}

    <tr>
      <td style="padding:36px 44px;text-align:center;">
        ${buildSectionLabel("Your Verification Code")}

        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
          <tr>
            <td style="background:linear-gradient(135deg,${sharedStyles.greenPale},${sharedStyles.greenMint});border-radius:20px;padding:28px 56px;border:2px solid ${sharedStyles.greenBorder};box-shadow:0 4px 20px rgba(22,163,74,0.08);">
              <p style="margin:0;font-family:'Courier New',monospace;font-size:44px;font-weight:800;color:${sharedStyles.greenMid};letter-spacing:10px;">
                ${code}
              </p>
            </td>
          </tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td style="padding:12px 28px;background-color:${sharedStyles.warningBg};border-radius:28px;border:1px solid ${sharedStyles.warningBorder};">
              <p style="margin:0;font-size:14px;color:${sharedStyles.warningText};font-weight:600;">
                ⏱️ This code expires in 10 minutes
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:0 44px 36px;">
        ${buildInfoCard("🔒", "Security Reminder", "Never share this code with anyone. Altuvera will never ask for your code via phone, SMS, or email.")}
      </td>
    </tr>

    <tr>
      <td style="background:linear-gradient(135deg,${sharedStyles.greenPale},rgba(255,255,255,0.95));padding:32px 44px;text-align:center;">
        <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:${sharedStyles.greenDark};">
          Didn't request this code?
        </p>
        <p style="margin:0;font-size:14px;color:${sharedStyles.textSecondary};line-height:1.65;">
          If you didn't request this verification, simply ignore this email. The code will expire automatically.
        </p>
      </td>
    </tr>

    <tr>
      <td style="padding:32px 44px;">
        ${buildInfoCard("💬", "Need Help?", `Contact our support team at <a href="mailto:${supportEmail}" style="color:${sharedStyles.greenMid};font-weight:700;text-decoration:none;">${supportEmail}</a>`)}
      </td>
    </tr>

    ${buildFooter([
      "This verification code was requested for your Altuvera account.",
      "This is an automated message — please do not reply.",
    ])}`;

  return buildOuterWrapper(content);
};

const buildWelcomeSubscriberEmailHtml = (email) => {
  const validatedEmail = validateEmail(email);
  const siteUrl        = getEnvVar("SITE_URL", "http://localhost:3000");
  const unsubscribeUrl = `${siteUrl}/api/subscribers/unsubscribe/${safeEncodeURI(validatedEmail)}`;
  const exploreUrl     = `${siteUrl}/explore`;

  const content = `
    ${buildBanner("🌿", "East Africa Explorer", "Premium Safari & Adventures")}

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
          You've joined <strong style="color:${sharedStyles.greenMid};">10+ adventurers</strong> who receive exclusive travel inspiration, insider tips, and members-only offers.
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
        ${buildInfoCard("🎁", "Exclusive Offers", "Members-only discounts and early access to new safari experiences")}
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
        "We respect your inbox — expect 1–2 emails per week, maximum.",
      ],
      true,
      unsubscribeUrl
    )}`;

  return buildOuterWrapper(content);
};

const buildUnsubscribeConfirmationEmailHtml = (email) => {
  const validatedEmail = validateEmail(email);
  const siteUrl        = getEnvVar("SITE_URL", "http://localhost:3000");
  const resubscribeUrl = `${siteUrl}/explore`;
  const supportEmail   = getEnvVar("ADMIN_EMAIL", "fabriceigiraneza36@gmail.com");

  const content = `
    ${buildBanner("🌿", "East Africa Explorer", "Premium Safari & Adventures")}

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
      "The East Africa Explorer Team"
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
    `Altuvera <noreply@${config.fromDomain}>`;

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

async function sendVerificationCode(email, code, fullName) {
  const config       = getEmailConfig();
  const supportEmail = getEnvVar("ADMIN_EMAIL", "support@altuvera.com");

  if (!config.isConfigured && config.devFallback) {
    console.warn(
      `[DEV FALLBACK] Resend not configured. Code for ${email}: ${code}`
    );
    return { delivered: false, fallback: "console", code };
  }

  const result = await sendEmail(
    {
      to:      email,
      subject: "🔐 Your Altuvera Verification Code",
      html:    buildVerificationEmailHtml(code, fullName, supportEmail),
      text:    `Your Altuvera verification code is: ${code}\n\nValid for 10 minutes. Do not share this code.`,
    },
    `✅ Verification code sent to ${email}`
  );

  if (!result.delivered && result.fallback) {
    result.code = code;
  }
  return result;
}

async function sendWelcomeEmail(email) {
  const validatedEmail = validateEmail(email);

  return sendEmail(
    {
      from:    `East Africa Explorer <hello@${getEmailConfig().fromDomain}>`,
      to:      validatedEmail,
      subject: "🌿 Welcome to East Africa Explorer! Your Adventure Begins",
      html:    buildWelcomeSubscriberEmailHtml(validatedEmail),
      text:    `Welcome to East Africa Explorer! Visit us at ${getEnvVar("SITE_URL", "http://localhost:3000")}/explore`,
    },
    `✅ Welcome email sent to ${validatedEmail}`
  );
}

async function sendUnsubscribeConfirmation(email) {
  const validatedEmail = validateEmail(email);

  return sendEmail(
    {
      from:    `East Africa Explorer <hello@${getEmailConfig().fromDomain}>`,
      to:      validatedEmail,
      subject: "👋 You've Been Unsubscribed • East Africa Explorer",
      html:    buildUnsubscribeConfirmationEmailHtml(validatedEmail),
      text:    "You have been successfully unsubscribed from East Africa Explorer emails.",
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