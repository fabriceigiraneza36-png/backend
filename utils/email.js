const nodemailer = require("nodemailer");
const logger = require("./logger");

const getEmailConfig = () => {
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = parseInt(process.env.SMTP_PORT, 10) || 587;
  const smtpUser = process.env.SMTP_USER || "";
  const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const isConfigured = Boolean(
    smtpUser &&
      smtpPass &&
      !smtpUser.includes("your-email") &&
      !smtpPass.includes("your-app-password"),
  );

  return { smtpHost, smtpPort, smtpUser, smtpPass, isConfigured };
};

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

const sendEmail = async ({ to, subject, html, from } = {}) => {
  const config = getEmailConfig();

  if (!config.isConfigured) {
    logger.warn("Email not configured; skipping send", { to, subject });
    return { delivered: false, fallback: "console" };
  }

  const transporter = createTransporter(config);

  const mailOptions = {
    from:
      from ||
      process.env.SMTP_FROM ||
      `"${process.env.APP_NAME || "Altuvera"}" <${config.smtpUser}>`,
    to,
    subject,
    html,
  };

  await transporter.sendMail(mailOptions);
  return { delivered: true };
};

const escape = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

const buildSimpleBookingHtml = (booking, heading) => {
  const appName = escape(process.env.APP_NAME || "Altuvera Travel");
  const bookingNumber = escape(booking?.booking_number || booking?.bookingNumber);
  const status = escape(booking?.status || "pending");
  const name = escape(booking?.full_name || booking?.fullName || "Traveler");
  const travelDate = escape(booking?.travel_date || booking?.travelDate || "");
  const destination = escape(booking?.destination_name || booking?.destinationName || "");
  const service = escape(booking?.service_name || booking?.serviceName || "");

  return `
    <div style="font-family:Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
      <h2>${escape(heading)}</h2>
      <p>Hi ${name},</p>
      <p>Your booking <strong>${bookingNumber}</strong> is <strong>${status}</strong>.</p>
      <ul>
        ${travelDate ? `<li><strong>Travel date:</strong> ${travelDate}</li>` : ""}
        ${destination ? `<li><strong>Destination:</strong> ${destination}</li>` : ""}
        ${service ? `<li><strong>Service:</strong> ${service}</li>` : ""}
      </ul>
      <p style="color:#666;font-size:12px">${appName}</p>
    </div>
  `;
};

const sendBookingConfirmation = async (booking) =>
  sendEmail({
    to: booking?.email,
    subject: `Booking confirmation ${booking?.booking_number || ""}`.trim(),
    html: buildSimpleBookingHtml(booking, "Booking Confirmation"),
  });

const sendBookingStatusUpdate = async (booking) =>
  sendEmail({
    to: booking?.email,
    subject: `Booking update ${booking?.booking_number || ""}`.trim(),
    html: buildSimpleBookingHtml(booking, "Booking Status Update"),
  });

const sendBookingCancellation = async (booking) =>
  sendEmail({
    to: booking?.email,
    subject: `Booking cancelled ${booking?.booking_number || ""}`.trim(),
    html: buildSimpleBookingHtml(booking, "Booking Cancelled"),
  });

const sendAdminBookingNotification = async (booking) =>
  sendEmail({
    to: process.env.ADMIN_EMAIL || process.env.EMAIL_FROM || process.env.SMTP_USER,
    subject: `New booking ${booking?.booking_number || ""}`.trim(),
    html: buildSimpleBookingHtml(booking, "New Booking Received"),
  });

const sendContactNotification = async ({ name, email, subject, message } = {}) =>
  sendEmail({
    to: process.env.ADMIN_EMAIL || process.env.EMAIL_FROM || process.env.SMTP_USER,
    subject: `New contact: ${subject || "Message"}`,
    html: `
      <div style="font-family:Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
        <h2>New Contact Message</h2>
        <p><strong>Name:</strong> ${escape(name)}</p>
        <p><strong>Email:</strong> ${escape(email)}</p>
        <p><strong>Subject:</strong> ${escape(subject)}</p>
        <p><strong>Message:</strong><br/>${escape(message).replace(/\n/g, "<br/>")}</p>
      </div>
    `,
  });

const sendContactReply = async ({ to, subject, html } = {}) =>
  sendEmail({
    to,
    subject: subject || "Thanks for contacting us",
    html:
      html ||
      `<div style="font-family:Segoe UI,Roboto,Arial,sans-serif">We received your message and will get back to you shortly.</div>`,
  });

module.exports = {
  sendEmail,
  sendBookingConfirmation,
  sendBookingStatusUpdate,
  sendBookingCancellation,
  sendAdminBookingNotification,
  sendContactNotification,
  sendContactReply,
};
