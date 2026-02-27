const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10),
  secure: false, // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS.replace(/\s+/g, ""), // strip spaces from app password
  },
});

// Verify connection on startup
transporter.verify().then(() => {
  console.log("✅ SMTP connection verified — ready to send emails");
}).catch((err) => {
  console.error("❌ SMTP connection failed:", err.message);
});

/**
 * Send an email
 * @param {string} to      – recipient email
 * @param {string} subject  – email subject
 * @param {string} html     – HTML body
 */
const sendEmail = async (to, subject, html) => {
  const mailOptions = {
    from: `"East Africa Explorer" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`📧 Email sent to ${to} — Message ID: ${info.messageId}`);
  return info;
};

module.exports = { sendEmail };