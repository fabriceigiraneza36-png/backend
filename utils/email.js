const nodemailer = require("nodemailer");
const logger = require("./logger");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send a generic email
 */
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const info = await transporter.sendMail({
      from: `"Travel App" <${process.env.EMAIL_FROM}>`,
      to,
      subject,
      html,
      text,
    });
    logger.info(`Email sent: ${info.messageId}`);
    return info;
  } catch (err) {
    logger.error("Email send error:", err);
    throw err;
  }
};

/**
 * Send booking confirmation to customer
 */
const sendBookingConfirmation = async (booking) => {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#2c3e50;">Booking Confirmation</h2>
      <p>Dear <strong>${booking.full_name}</strong>,</p>
      <p>Your booking has been received successfully!</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Booking Number</td>
            <td style="padding:8px;border:1px solid #ddd;">${booking.booking_number}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Travel Date</td>
            <td style="padding:8px;border:1px solid #ddd;">${booking.travel_date || "TBD"}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Travelers</td>
            <td style="padding:8px;border:1px solid #ddd;">${booking.number_of_travelers}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Status</td>
            <td style="padding:8px;border:1px solid #ddd;">${booking.status}</td></tr>
      </table>
      <p>We will review your request and get back to you within 24 hours.</p>
      <p>Thank you for choosing us!</p>
    </div>
  `;

  return sendEmail({
    to: booking.email,
    subject: `Booking Confirmation - ${booking.booking_number}`,
    html,
  });
};

/**
 * Notify admin about new contact message
 */
const sendContactNotification = async (contact) => {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2>New Contact Message</h2>
      <p><strong>From:</strong> ${contact.full_name} (${contact.email})</p>
      <p><strong>Phone:</strong> ${contact.phone || "N/A"}</p>
      <p><strong>Subject:</strong> ${contact.subject || "N/A"}</p>
      <hr/>
      <p>${contact.message}</p>
    </div>
  `;

  return sendEmail({
    to: process.env.ADMIN_EMAIL,
    subject: `New Contact: ${contact.subject || "No Subject"}`,
    html,
  });
};

module.exports = { sendEmail, sendBookingConfirmation, sendContactNotification };