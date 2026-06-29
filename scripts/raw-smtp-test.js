// scripts/raw-smtp-test.js
// Tests Gmail SMTP with zero abstraction layers
require("dotenv").config();

const nodemailer = require("nodemailer");

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

console.log("User:", user);
console.log("Pass length:", pass?.length);
console.log("Pass (last 4):", pass?.slice(-4));
console.log("Pass has spaces:", pass?.includes(" "));
console.log("");

const transporter = nodemailer.createTransport({
  host:   "smtp.gmail.com",
  port:   587,
  secure: false,
  family: 4,
  auth: {
    user,
    pass,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

console.log("Verifying…");

transporter.verify((err, success) => {
  if (err) {
    console.error("❌ VERIFY FAILED:");
    console.error("  Message:", err.message);
    console.error("  Code:",    err.code);
    console.error("  Response:", err.response);
    console.error("  ResponseCode:", err.responseCode);

    // Extra diagnosis
    if (err.responseCode === 535) {
      console.error("\n535 = Google rejected the password.");
      console.error("This is ALWAYS a Google account configuration issue.");
      console.error("\nCheck at: https://myaccount.google.com/apppasswords");
      console.error("The page must exist and 2FA must be fully enabled.");
    }

    process.exit(1);
  }

  console.log("✅ VERIFY SUCCESS!");

  transporter.sendMail({
    from:    `"Test" <${user}>`,
    to:      user,
    subject: "Raw SMTP Test",
    text:    "If you see this, SMTP works!",
  }, (sendErr, info) => {
    if (sendErr) {
      console.error("❌ SEND FAILED:", sendErr.message);
      process.exit(1);
    }
    console.log("✅ EMAIL SENT! MessageId:", info.messageId);
    console.log("Check inbox:", user);
    process.exit(0);
  });
});