// scripts/test-smtp.js — Run with: node scripts/test-smtp.js
"use strict";

require("dotenv").config();

const { testSmtp, verifySmtp, sendEmail } = require("../utils/email");
const logger = require("../utils/logger");

(async () => {
  console.log("\n══════════════════════════════════════════");
  console.log("  Altuvera SMTP Diagnostic Tool");
  console.log("══════════════════════════════════════════\n");

  console.log("Environment:");
  console.log(`  SMTP_HOST  = ${process.env.SMTP_HOST  || "(not set — defaulting to smtp.gmail.com)"}`);
  console.log(`  SMTP_PORT  = ${process.env.SMTP_PORT  || "(not set — defaulting to 587)"}`);
  console.log(`  SMTP_SECURE= ${process.env.SMTP_SECURE || "(not set — defaulting to false)"}`);
  console.log(`  SMTP_USER  = ${process.env.SMTP_USER  || "❌ NOT SET"}`);
  console.log(`  SMTP_PASS  = ${process.env.SMTP_PASS  ? `✅ set (${process.env.SMTP_PASS.length} chars, ends …${process.env.SMTP_PASS.slice(-4)})` : "❌ NOT SET"}`);
  console.log(`  SMTP_FROM  = ${process.env.SMTP_FROM  || "(not set)"}`);
  console.log(`  ADMIN_EMAIL= ${process.env.ADMIN_EMAIL || "(not set)"}`);
  console.log("");

  /* ── Validate App Password format ── */
  const pass = process.env.SMTP_PASS || "";
  const passNoSpaces = pass.replace(/\s/g, "");
  if (passNoSpaces.length === 16 && pass.includes(" ")) {
    console.warn("⚠️  WARNING: SMTP_PASS contains spaces — for Gmail App Passwords,");
    console.warn("    store WITHOUT spaces: 16 consecutive characters.");
    console.warn(`    Current (${pass.length} chars with spaces) → correct (${passNoSpaces.length} chars): ${passNoSpaces}`);
    console.warn("");
  } else if (passNoSpaces.length !== 16 && process.env.SMTP_PASS) {
    console.warn(`⚠️  WARNING: SMTP_PASS is ${passNoSpaces.length} chars.`);
    console.warn("    Gmail App Passwords are exactly 16 characters.");
    console.warn("    Regenerate at: https://myaccount.google.com/apppasswords");
    console.warn("");
  } else if (passNoSpaces.length === 16) {
    console.log("✅ SMTP_PASS looks like a valid Gmail App Password (16 chars).");
    console.log("");
  }

  /* ── Step 1: verify connection ── */
  console.log("Step 1: Verifying SMTP connection…");
  const verified = await verifySmtp();

  if (!verified) {
    console.error("\n❌ SMTP connection FAILED.\n");
    console.error("Common causes for Gmail SMTP 535 AUTH error:");
    console.error("  1. 2-Step Verification is NOT enabled on the Google account.");
    console.error("     → Enable at: https://myaccount.google.com/security");
    console.error("  2. SMTP_PASS is the account password, not an App Password.");
    console.error("     → Generate App Password: https://myaccount.google.com/apppasswords");
    console.error("  3. App Password was revoked (happens if 2FA is toggled off/on).");
    console.error("     → Regenerate the App Password.");
    console.error("  4. 'Less secure app access' was relied upon (discontinued by Google).");
    console.error("     → Must use App Password with 2FA instead.");
    console.error("  5. Spaces in the SMTP_PASS env var.");
    console.error("     → Remove all spaces from the 16-char password.\n");
    process.exit(1);
  }

  console.log("✅ SMTP connection verified.\n");

  /* ── Step 2: send test email ── */
  const testTo = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
  console.log(`Step 2: Sending test email to ${testTo}…`);

  try {
    const info = await sendEmail({
      to:      testTo,
      subject: `[Altuvera] SMTP Test ✅ — ${new Date().toISOString()}`,
      html: `
        <div style="font-family:Arial,sans-serif;padding:32px;background:#f0fdf4;">
          <div style="max-width:480px;margin:0 auto;background:white;
                      border-radius:16px;padding:32px;
                      border:1.5px solid #a7f3d0;">
            <h2 style="color:#064e3b;margin:0 0 16px;">✅ SMTP Test Successful</h2>
            <p style="color:#4b5563;line-height:1.7;">
              Your Altuvera backend email configuration is working correctly.
            </p>
            <table style="width:100%;border-collapse:collapse;margin-top:20px;">
              <tr>
                <td style="padding:8px 12px;background:#f0fdf4;font-size:12px;
                            font-weight:700;color:#6b7280;border-radius:6px 0 0 6px;">
                  SMTP Host
                </td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;">
                  ${process.env.SMTP_HOST || "smtp.gmail.com"}:${process.env.SMTP_PORT || 587}
                </td>
              </tr>
              <tr>
                <td style="padding:8px 12px;background:#f0fdf4;font-size:12px;font-weight:700;color:#6b7280;">
                  Sent From
                </td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;">
                  ${process.env.SMTP_USER}
                </td>
              </tr>
              <tr>
                <td style="padding:8px 12px;background:#f0fdf4;font-size:12px;font-weight:700;color:#6b7280;">
                  Timestamp
                </td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;">
                  ${new Date().toUTCString()}
                </td>
              </tr>
            </table>
          </div>
        </div>
      `,
      text: `SMTP Test OK — ${new Date().toUTCString()}\nHost: ${process.env.SMTP_HOST || "smtp.gmail.com"}`,
    });

    console.log(`\n✅ Test email sent successfully!`);
    console.log(`   MessageId: ${info.messageId}`);
    console.log(`   Check inbox: ${testTo}`);
    console.log(`   (also check spam folder)\n`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Test email FAILED: ${err.message}\n`);
    process.exit(1);
  }
})();