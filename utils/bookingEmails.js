// utils/bookingEmails.js
/**
 * Booking Email Notification System
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides all booking-related email templates and send functions:
 *
 *  sendBookingVerificationLink   — email link verification (no OTP)
 *  sendBookingReceivedEmail      — confirms receipt to user
 *  sendAdminBookingNotification  — alerts admin of new/verified booking
 *  sendBookingConfirmation       — booking confirmed by admin
 *  sendBookingStatusUpdate       — generic status change
 *  sendBookingCancellation       — booking cancelled
 *  sendTripCountdownEmail        — X days until departure
 *  sendBookingReminderEmail      — payment / action reminder
 *
 * All functions are safe — they log warnings instead of throwing so
 * a broken email never kills an API response.
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const logger = require("./logger");

/* ── resolve the best available send function ───────────────────────────── */
let _send = null;

const EMAIL_MODULE_PATHS = [
  "../utils/email",
  "../services/emailService",
  "../utils/emailService",
  "../services/email",
];

for (const p of EMAIL_MODULE_PATHS) {
  try {
    const mod = require(p);
    // prefer the richer sendEmail from utils/email.js (handles SendGrid/Resend/SMTP)
    if (typeof mod.sendEmail === "function") {
      _send = mod.sendEmail;
      logger.info(`[BookingEmails] Using sendEmail from: ${p}`);
      break;
    }
  } catch { /* try next */ }
}

if (!_send) {
  logger.warn("[BookingEmails] No email sender found — all booking emails will be skipped");
  _send = async () => ({ success: false, error: "No email sender configured" });
}

/* ── environment ────────────────────────────────────────────────────────── */
const APP_NAME     = process.env.APP_NAME     || "Altuvera Safaris";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.altuverasafaris.com";
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL  || process.env.SMTP_USER || "altuverasafari@gmail.com";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || process.env.SMTP_USER || "altuverasafari@gmail.com";
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || "+250 788 000 000";
const WHATSAPP_URL  = process.env.WHATSAPP_URL  || "https://wa.me/250788000000";
const YEAR          = new Date().getFullYear();

/* ══════════════════════════════════════════════════════════════════════════
   HTML HELPERS
══════════════════════════════════════════════════════════════════════════ */
const esc = (v = "") =>
  String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  } catch { return String(d); }
};

const fmtDateTime = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZoneName: "short",
    });
  } catch { return String(d); }
};

const daysUntil = (date) => {
  if (!date) return null;
  const diff = new Date(date) - new Date();
  return Math.ceil(diff / 86400000);
};

/* ══════════════════════════════════════════════════════════════════════════
   BASE EMAIL WRAPPER
   (matches the green/white brand used throughout the site)
══════════════════════════════════════════════════════════════════════════ */
const baseEmail = ({
  preheader = "",
  headerEmoji = "✈️",
  headerTitle = APP_NAME,
  headerSubtitle = "Premium Safari Adventures",
  recipientName = "",
  body = "",
  ctaText = "",
  ctaUrl = "",
  ctaSecondaryText = "",
  ctaSecondaryUrl = "",
  footerExtra = "",
  accentColor = "#059669",
  accentLight = "#f0fdf4",
  accentBorder = "#a7f3d0",
}) => `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${esc(headerTitle)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings>
  <o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;width:100%;background:#f0fdf4;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
  -webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

  <!-- preheader -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;
    font-size:1px;line-height:1px;color:#f0fdf4;">
    ${esc(preheader)}&nbsp;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="background:#f0fdf4;padding:32px 0 48px;">
    <tr><td align="center" style="padding:0 16px;">

      <!-- card -->
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
        style="max-width:560px;width:100%;background:#fff;border-radius:24px;
          overflow:hidden;box-shadow:0 8px 40px rgba(5,150,105,.12);">

        <!-- ── HEADER ───────────────────────────────────────────────── -->
        <tr>
          <td style="background:linear-gradient(135deg,#064e3b 0%,#047857 60%,#059669 100%);
            padding:40px 32px;text-align:center;">
            <div style="font-size:44px;margin-bottom:12px;line-height:1;">
              ${headerEmoji}
            </div>
            <a href="${FRONTEND_URL}" style="text-decoration:none;">
              <span style="font-size:26px;font-weight:900;color:#fff;
                letter-spacing:-0.5px;font-family:'Georgia',serif;">
                ${esc(headerTitle)}
              </span>
            </a>
            <p style="margin:6px 0 0;font-size:11px;font-weight:700;
              color:rgba(255,255,255,.65);letter-spacing:2px;text-transform:uppercase;">
              ${esc(headerSubtitle)}
            </p>
          </td>
        </tr>

        <!-- ── BODY ─────────────────────────────────────────────────── -->
        <tr>
          <td style="padding:36px 36px 28px;">
            ${recipientName ? `
            <p style="margin:0 0 20px;font-size:15px;color:#374151;">
              Hello, <strong style="color:#0f172a;">${esc(recipientName)}</strong> 👋
            </p>` : ""}
            ${body}

            ${ctaText && ctaUrl ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
              style="margin-top:28px;">
              <tr><td align="center">
                <a href="${esc(ctaUrl)}"
                  style="display:inline-block;padding:15px 40px;
                    background:linear-gradient(135deg,${accentColor},#047857);
                    color:#fff;text-decoration:none;border-radius:50px;
                    font-size:15px;font-weight:800;
                    box-shadow:0 4px 18px rgba(5,150,105,.35);">
                  ${esc(ctaText)}
                </a>
              </td></tr>
              ${ctaSecondaryText && ctaSecondaryUrl ? `
              <tr><td align="center" style="padding-top:14px;">
                <a href="${esc(ctaSecondaryUrl)}"
                  style="display:inline-block;padding:11px 28px;
                    color:${accentColor};text-decoration:none;
                    border:1.5px solid ${accentBorder};border-radius:50px;
                    font-size:13px;font-weight:700;background:#fff;">
                  ${esc(ctaSecondaryText)}
                </a>
              </td></tr>` : ""}
            </table>` : ""}
          </td>
        </tr>

        <!-- ── FOOTER ───────────────────────────────────────────────── -->
        <tr>
          <td style="background:#f8fafc;padding:24px 36px;border-top:1px solid #f1f5f9;
            border-radius:0 0 24px 24px;text-align:center;">
            ${footerExtra ? `<p style="margin:0 0 14px;font-size:12.5px;
              color:#64748b;line-height:1.65;">${footerExtra}</p>` : ""}
            <p style="margin:0 0 10px;">
              <a href="${WHATSAPP_URL}" target="_blank"
                style="display:inline-flex;align-items:center;gap:6px;
                  padding:8px 20px;background:#25D366;color:#fff;
                  text-decoration:none;border-radius:20px;font-size:12.5px;font-weight:700;">
                💬 Chat on WhatsApp
              </a>
            </p>
            <p style="margin:10px 0 0;font-size:11px;color:#94a3b8;">
              <a href="${FRONTEND_URL}" style="color:#94a3b8;text-decoration:none;">
                ${esc(APP_NAME)}
              </a>
              &nbsp;·&nbsp;
              <a href="mailto:${SUPPORT_EMAIL}" style="color:#94a3b8;text-decoration:none;">
                ${SUPPORT_EMAIL}
              </a>
              &nbsp;·&nbsp;
              © ${YEAR}
            </p>
          </td>
        </tr>

      </table>
      <!-- end card -->

    </td></tr>
  </table>
</body></html>`;

/* ══════════════════════════════════════════════════════════════════════════
   BOOKING DETAIL ROW — used in info tables
══════════════════════════════════════════════════════════════════════════ */
const detailRow = (icon, label, value, highlight = false) =>
  value
    ? `<tr>
        <td style="padding:11px 14px;border-bottom:1px solid #f1f5f9;
          width:36px;text-align:center;font-size:18px;vertical-align:top;">
          ${icon}
        </td>
        <td style="padding:11px 14px 11px 0;border-bottom:1px solid #f1f5f9;
          vertical-align:top;">
          <p style="margin:0 0 2px;font-size:11px;font-weight:700;
            color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;">
            ${esc(label)}
          </p>
          <p style="margin:0;font-size:14.5px;font-weight:${highlight ? "800" : "600"};
            color:${highlight ? "#059669" : "#111827"};">
            ${esc(String(value))}
          </p>
        </td>
       </tr>`
    : "";

const detailTable = (rows) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:16px;
      overflow:hidden;margin:20px 0;">
    <tbody>${rows}</tbody>
   </table>`;

/* ══════════════════════════════════════════════════════════════════════════
   BOOKING SUMMARY BLOCK
══════════════════════════════════════════════════════════════════════════ */
const bookingSummaryBlock = (booking) => {
  const dest    = booking.destination_name || booking.destination || null;
  const country = booking.country_name     || booking.country     || null;
  const service = booking.service_name     || booking.service     || null;
  const pkg     = booking.package_name     || booking.package     || null;

  const rows = [
    detailRow("📋", "Booking Reference", booking.booking_number, true),
    detailRow("📍", "Destination",       dest || country || service || pkg),
    detailRow("📅", "Departure",         fmtDate(booking.travel_date)),
    detailRow("🏁", "Return",            fmtDate(booking.return_date)),
    detailRow("👥", "Travellers",
      booking.number_of_travelers
        ? `${booking.number_of_travelers} person${booking.number_of_travelers > 1 ? "s" : ""}`
        : null),
    detailRow("🏨", "Accommodation",     booking.accommodation_type),
    detailRow("💬", "Special Requests",  booking.special_requests),
  ].join("");

  return rows ? detailTable(rows) : "";
};

/* ══════════════════════════════════════════════════════════════════════════
   STATUS BADGE
══════════════════════════════════════════════════════════════════════════ */
const statusBadge = (status = "pending") => {
  const map = {
    pending:   { bg: "#fffbeb", color: "#d97706", border: "#fde68a", label: "Pending Review" },
    confirmed: { bg: "#f0fdf4", color: "#059669", border: "#6ee7b7", label: "Confirmed ✓"    },
    completed: { bg: "#eff6ff", color: "#3b82f6", border: "#bfdbfe", label: "Completed"       },
    cancelled: { bg: "#fef2f2", color: "#dc2626", border: "#fca5a5", label: "Cancelled"       },
    "on-hold": { bg: "#f5f3ff", color: "#7c3aed", border: "#ddd6fe", label: "On Hold"         },
    refunded:  { bg: "#fff7ed", color: "#ea580c", border: "#fed7aa", label: "Refunded"        },
  };
  const s = map[status] || map.pending;
  return `<span style="display:inline-block;padding:5px 16px;background:${s.bg};
    color:${s.color};border:1.5px solid ${s.border};border-radius:20px;
    font-size:12.5px;font-weight:800;letter-spacing:.04em;">
    ${s.label}
  </span>`;
};

/* ══════════════════════════════════════════════════════════════════════════
   SAFE SEND WRAPPER
══════════════════════════════════════════════════════════════════════════ */
const safeSend = async (to, subject, html, label = "") => {
  try {
    if (!to) {
      logger.warn(`[BookingEmails] ${label}: no recipient, skipping`);
      return { success: false, error: "No recipient" };
    }
    // utils/email.js accepts (opts) or (to, subject, html)
    const result = await _send({ to, subject, html });
    logger.info(`[BookingEmails] ✅ ${label} → ${to}`);
    return result || { success: true };
  } catch (err) {
    logger.error(`[BookingEmails] ❌ ${label} failed → ${to}: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   1.  BOOKING VERIFICATION LINK
   ─   Sent immediately after a guest (non-authenticated) submits a booking.
   ─   Admin is NOT notified until user clicks the link.
══════════════════════════════════════════════════════════════════════════ */
const sendBookingVerificationLink = async (booking, token) => {
  if (!booking?.email || !token) {
    logger.warn("[BookingEmails] sendBookingVerificationLink: missing email or token");
    return { success: false };
  }

  const verifyUrl = `${FRONTEND_URL}/api/bookings/verify-email/${token}`;
  // Fallback: use backend URL for the actual API call
  const apiUrl    = `${process.env.BACKEND_URL || "https://api.altuverasafaris.com"}/api/bookings/verify-email/${token}`;

  const html = baseEmail({
    preheader:   `Click to confirm your ${APP_NAME} booking — Ref ${booking.booking_number}`,
    headerEmoji:  "📧",
    headerTitle:  APP_NAME,
    headerSubtitle: "Confirm Your Booking Request",
    recipientName: booking.full_name,
    body: `
      <!-- intro -->
      <h2 style="margin:0 0 10px;font-size:22px;font-weight:900;color:#0f172a;
        font-family:'Georgia',serif;line-height:1.3;">
        One step to confirm your adventure! 🌍
      </h2>
      <p style="margin:0 0 20px;font-size:14.5px;color:#475569;line-height:1.7;">
        We've received your booking request. To send it to our travel team,
        please <strong>verify your email address</strong> by clicking the button below.
        Your booking is not confirmed until you click this link.
      </p>

      <!-- booking summary -->
      ${bookingSummaryBlock(booking)}

      <!-- verification box -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="margin:24px 0 0;background:#f0fdf4;border:2px solid #6ee7b7;
          border-radius:18px;overflow:hidden;">
        <tr>
          <td style="padding:28px 28px 20px;text-align:center;">
            <div style="font-size:36px;margin-bottom:12px;">🔐</div>
            <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#059669;
              text-transform:uppercase;letter-spacing:.08em;">
              Email Verification Required
            </p>
            <p style="margin:0 0 22px;font-size:13.5px;color:#475569;line-height:1.6;">
              This link expires in <strong>24 hours</strong>.
              You only need to click it once.
            </p>
            <a href="${apiUrl}"
              style="display:inline-block;padding:16px 44px;
                background:linear-gradient(135deg,#059669,#047857);
                color:#fff;text-decoration:none;border-radius:50px;
                font-size:16px;font-weight:900;
                box-shadow:0 6px 24px rgba(5,150,105,.4);
                letter-spacing:.02em;">
              ✅ Verify &amp; Confirm My Booking
            </a>
            <p style="margin:18px 0 0;font-size:11.5px;color:#94a3b8;">
              Button not working? Copy and paste this link into your browser:
            </p>
            <p style="margin:4px 0 0;font-size:11px;color:#059669;word-break:break-all;">
              <a href="${apiUrl}" style="color:#059669;">${apiUrl}</a>
            </p>
          </td>
        </tr>
      </table>

      <!-- what happens next -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="margin-top:24px;background:#fffbeb;border:1.5px solid #fde68a;
          border-radius:14px;">
        <tr>
          <td style="padding:18px 20px;">
            <p style="margin:0 0 12px;font-size:13px;font-weight:800;color:#92400e;">
              ⚡ What happens after verification?
            </p>
            ${[
              ["📨", "Your request is sent directly to our travel team"],
              ["📞", "We'll contact you within 24 hours to discuss your itinerary"],
              ["💰", "You'll receive a personalised quote — no payment required now"],
              ["🎉", "Once confirmed, your adventure begins!"],
            ].map(([icon, text]) =>
              `<p style="margin:0 0 7px;font-size:13px;color:#92400e;display:flex;
                align-items:center;gap:8px;">
                <span style="font-size:16px;">${icon}</span>
                <span>${esc(text)}</span>
              </p>`
            ).join("")}
          </td>
        </tr>
      </table>
    `,
    footerExtra: `
      This verification email was sent because someone submitted a booking on
      <a href="${FRONTEND_URL}" style="color:#059669;">${esc(APP_NAME)}</a>
      using this address. If this wasn't you, you can safely ignore this email.
    `,
  });

  return safeSend(
    booking.email,
    `Verify your booking — Ref ${booking.booking_number} | ${APP_NAME}`,
    html,
    "sendBookingVerificationLink",
  );
};

/* ══════════════════════════════════════════════════════════════════════════
   2.  BOOKING RECEIVED (user confirmation after verification or auth submit)
══════════════════════════════════════════════════════════════════════════ */
const sendBookingReceivedEmail = async (booking) => {
  if (!booking?.email) return { success: false };

  const html = baseEmail({
    preheader:    `We've received your booking — Ref ${booking.booking_number}. Our team will contact you within 24 hours.`,
    headerEmoji:  "🎉",
    headerTitle:  APP_NAME,
    headerSubtitle: "Booking Request Received",
    recipientName: booking.full_name,
    body: `
      <h2 style="margin:0 0 10px;font-size:22px;font-weight:900;color:#0f172a;
        font-family:'Georgia',serif;line-height:1.3;">
        Your booking is in our hands! 🌍
      </h2>
      <p style="margin:0 0 20px;font-size:14.5px;color:#475569;line-height:1.7;">
        Thank you for choosing <strong>${esc(APP_NAME)}</strong>.
        Our travel experts will review your request and contact you within
        <strong style="color:#059669;">24 hours</strong>
        to discuss your perfect itinerary.
      </p>

      ${bookingSummaryBlock(booking)}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="margin-top:20px;background:#f0fdf4;border:1.5px solid #a7f3d0;border-radius:14px;">
        <tr>
          <td style="padding:18px 20px;">
            <p style="margin:0 0 12px;font-size:13px;font-weight:800;color:#065f46;">
              📋 What happens next?
            </p>
            ${[
              ["📞", "Our team will call or WhatsApp you within 24 hours"],
              ["🗺️",  "We'll design a personalised itinerary for your group"],
              ["💵",  "You'll receive a custom quote — no payment required now"],
              ["✅",  "Once you're happy, we'll confirm your booking officially"],
            ].map(([icon, text]) =>
              `<p style="margin:0 0 7px;font-size:13px;color:#065f46;">
                <span style="font-size:16px;">${icon}</span>
                <span style="margin-left:8px;">${esc(text)}</span>
              </p>`
            ).join("")}
          </td>
        </tr>
      </table>
    `,
    ctaText:      "Track Your Booking",
    ctaUrl:       `${FRONTEND_URL}/my-bookings`,
    ctaSecondaryText: "Chat on WhatsApp",
    ctaSecondaryUrl:  WHATSAPP_URL,
    footerExtra: `
      Need to make changes? Contact us at
      <a href="mailto:${SUPPORT_EMAIL}" style="color:#059669;">${SUPPORT_EMAIL}</a>
      or <a href="${WHATSAPP_URL}" style="color:#059669;">WhatsApp</a>.
    `,
  });

  return safeSend(
    booking.email,
    `Booking received — Ref ${booking.booking_number} | ${APP_NAME}`,
    html,
    "sendBookingReceivedEmail",
  );
};

/* ══════════════════════════════════════════════════════════════════════════
   3.  ADMIN NOTIFICATION (after verification or auth booking)
══════════════════════════════════════════════════════════════════════════ */
const sendAdminBookingNotification = async (booking) => {
  const adminDashUrl = `${FRONTEND_URL}/admin/bookings/${booking.id}`;

  const html = baseEmail({
    preheader:    `New booking ${booking.booking_number} from ${booking.full_name}`,
    headerEmoji:  "📋",
    headerTitle:  `${APP_NAME} Admin`,
    headerSubtitle: "New Booking Alert",
    body: `
      <h2 style="margin:0 0 10px;font-size:20px;font-weight:900;color:#0f172a;
        font-family:'Georgia',serif;">
        New Booking Received
      </h2>
      <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6;">
        A new booking request has been submitted and verified.
        Please review and contact the customer.
      </p>

      ${detailTable([
        detailRow("📋", "Booking Ref",    booking.booking_number, true),
        detailRow("👤", "Customer Name",  booking.full_name),
        detailRow("📧", "Email",          booking.email),
        detailRow("📞", "Phone",          booking.phone),
        detailRow("📍", "Destination",    booking.destination_name || booking.destination),
        detailRow("📅", "Travel Date",    fmtDate(booking.travel_date)),
        detailRow("🏁", "Return Date",    fmtDate(booking.return_date)),
        detailRow("👥", "Travellers",     booking.number_of_travelers),
        detailRow("🏨", "Accommodation",  booking.accommodation_type),
        detailRow("🌍", "Nationality",    booking.nationality || booking.country),
        detailRow("💬", "Special Requests", booking.special_requests),
        detailRow("🕒", "Submitted",      fmtDateTime(booking.created_at)),
        detailRow("✅", "Email Verified", booking.email_verified ? "Yes" : "Pending"),
      ].join(""))}
    `,
    ctaText:      "Review Booking in Dashboard",
    ctaUrl:       adminDashUrl,
    ctaSecondaryText: `WhatsApp ${booking.full_name || "Customer"}`,
    ctaSecondaryUrl:  booking.phone
      ? `https://wa.me/${booking.phone.replace(/\D/g, "")}`
      : WHATSAPP_URL,
  });

  return safeSend(
    ADMIN_EMAIL,
    `📋 New Booking: ${booking.booking_number} — ${booking.full_name} | ${APP_NAME}`,
    html,
    "sendAdminBookingNotification",
  );
};

/* ══════════════════════════════════════════════════════════════════════════
   4.  BOOKING CONFIRMED (admin confirms the booking)
══════════════════════════════════════════════════════════════════════════ */
const sendBookingConfirmation = async (booking) => {
  if (!booking?.email) return { success: false };

  const days = daysUntil(booking.travel_date);

  const html = baseEmail({
    preheader:    `Your ${APP_NAME} adventure is confirmed! Ref ${booking.booking_number}`,
    headerEmoji:  "🎊",
    headerTitle:  APP_NAME,
    headerSubtitle: "Booking Confirmed!",
    recipientName: booking.full_name,
    body: `
      <h2 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#0f172a;
        font-family:'Georgia',serif;line-height:1.3;">
        Your adventure is officially confirmed! 🌍✈️
      </h2>
      <p style="margin:0 0 6px;font-size:14.5px;color:#475569;line-height:1.7;">
        We're thrilled to confirm your booking.
        ${days !== null && days > 0
          ? `Your adventure begins in <strong style="color:#059669;">${days} day${days !== 1 ? "s" : ""}</strong>.`
          : "Get ready for an unforgettable experience!"}
      </p>

      <p style="margin:0 0 20px;text-align:center;">
        ${statusBadge("confirmed")}
      </p>

      ${bookingSummaryBlock(booking)}

      ${booking.confirmation_code ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="margin:20px 0;background:#f0fdf4;border:2px solid #6ee7b7;border-radius:16px;">
        <tr>
          <td style="padding:20px;text-align:center;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#059669;
              text-transform:uppercase;letter-spacing:.1em;">Confirmation Code</p>
            <p style="margin:0;font-size:28px;font-weight:900;color:#047857;
              font-family:'Courier New',monospace;letter-spacing:6px;">
              ${esc(booking.confirmation_code)}
            </p>
            <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">
              Keep this code safe — you may need it for check-in
            </p>
          </td>
        </tr>
      </table>` : ""}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="margin-top:20px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;">
        <tr>
          <td style="padding:18px 20px;">
            <p style="margin:0 0 10px;font-size:13px;font-weight:800;color:#92400e;">
              📌 Important next steps
            </p>
            ${[
              ["🛂", "Ensure your passport is valid for at least 6 months"],
              ["💉", "Check vaccination requirements for your destination"],
              ["🎒", "We'll send you a detailed packing guide before departure"],
              ["📱", "Our guide will contact you 48 hours before your trip"],
            ].map(([icon, text]) =>
              `<p style="margin:0 0 7px;font-size:13px;color:#92400e;">
                <span style="font-size:15px;">${icon}</span>
                <span style="margin-left:8px;">${esc(text)}</span>
              </p>`
            ).join("")}
          </td>
        </tr>
      </table>
    `,
    ctaText:      "View My Booking",
    ctaUrl:       `${FRONTEND_URL}/my-bookings`,
    ctaSecondaryText: "Chat on WhatsApp",
    ctaSecondaryUrl:  WHATSAPP_URL,
    footerExtra: `
      Questions? Email us at
      <a href="mailto:${SUPPORT_EMAIL}" style="color:#059669;">${SUPPORT_EMAIL}</a>
      or call <strong>${SUPPORT_PHONE}</strong>.
    `,
  });

  return safeSend(
    booking.email,
    `✅ Adventure Confirmed! Ref ${booking.booking_number} | ${APP_NAME}`,
    html,
    "sendBookingConfirmation",
  );
};

/* ══════════════════════════════════════════════════════════════════════════
   5.  GENERIC STATUS UPDATE
══════════════════════════════════════════════════════════════════════════ */
const sendBookingStatusUpdate = async (booking, fromStatus, toStatus, reason = "") => {
  if (!booking?.email) return { success: false };

  const statusMessages = {
    pending:   "Your booking is pending review. Our team will contact you within 24 hours.",
    confirmed: "Great news — your booking has been confirmed!",
    "on-hold": "Your booking is temporarily on hold. We will be in touch shortly.",
    completed: "Your trip is marked as completed. We hope you had an amazing time!",
    cancelled: `Your booking has been cancelled.${reason ? " " + reason : ""}`,
    refunded:  "Your refund has been processed. Please allow 5–10 business days.",
  };

  const statusEmojis = {
    confirmed: "✅", "on-hold": "⏸️", completed: "🏆",
    cancelled: "❌", refunded: "💰", pending: "⏳",
  };

  const emoji = statusEmojis[toStatus] || "📋";
  const msg   = statusMessages[toStatus] || "Your booking status has been updated.";

  const html = baseEmail({
    preheader:    `Your booking ${booking.booking_number} status: ${toStatus}`,
    headerEmoji:  emoji,
    headerTitle:  APP_NAME,
    headerSubtitle: "Booking Status Update",
    recipientName: booking.full_name,
    body: `
      <h2 style="margin:0 0 10px;font-size:22px;font-weight:900;color:#0f172a;
        font-family:'Georgia',serif;line-height:1.3;">
        Booking Status Update ${emoji}
      </h2>

      <p style="margin:0 0 6px;text-align:center;">
        <span style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">
          Status changed: ${esc(fromStatus)} → ${esc(toStatus)}
        </span>
        ${statusBadge(toStatus)}
      </p>

      <p style="margin:20px 0;font-size:14.5px;color:#475569;line-height:1.7;">
        ${esc(msg)}
      </p>

      ${bookingSummaryBlock(booking)}

      ${reason ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="margin-top:16px;background:#fef2f2;border:1.5px solid #fca5a5;border-radius:12px;">
        <tr>
          <td style="padding:14px 18px;">
            <p style="margin:0 0 4px;font-size:12px;font-weight:700;
              color:#dc2626;text-transform:uppercase;letter-spacing:.07em;">Note</p>
            <p style="margin:0;font-size:13.5px;color:#7f1d1d;line-height:1.6;">
              ${esc(reason)}
            </p>
          </td>
        </tr>
      </table>` : ""}
    `,
    ctaText:  "View My Booking",
    ctaUrl:   `${FRONTEND_URL}/my-bookings`,
    footerExtra: `
      Questions? Contact us at
      <a href="mailto:${SUPPORT_EMAIL}" style="color:#059669;">${SUPPORT_EMAIL}</a>.
    `,
  });

  return safeSend(
    booking.email,
    `${emoji} Booking ${toStatus} — Ref ${booking.booking_number} | ${APP_NAME}`,
    html,
    `sendBookingStatusUpdate(${fromStatus}→${toStatus})`,
  );
};

/* ══════════════════════════════════════════════════════════════════════════
   6.  BOOKING CANCELLATION (shorthand)
══════════════════════════════════════════════════════════════════════════ */
const sendBookingCancellation = async (booking, reason = "") =>
  sendBookingStatusUpdate(booking, booking.status || "confirmed", "cancelled", reason);

/* ══════════════════════════════════════════════════════════════════════════
   7.  TRIP COUNTDOWN EMAIL
══════════════════════════════════════════════════════════════════════════ */
const sendTripCountdownEmail = async (booking) => {
  if (!booking?.email || !booking?.travel_date) return { success: false };

  const days = daysUntil(booking.travel_date);
  if (days === null || days < 0) return { success: false, error: "Past date" };

  // Only send at meaningful milestones
  const MILESTONES = [30, 14, 7, 3, 1];
  if (!MILESTONES.includes(days)) return { success: false, error: "Not a milestone" };

  const urgency =
    days === 1  ? "🚨 TOMORROW!"      :
    days <= 3   ? "🔥 Very Soon!"     :
    days <= 7   ? "⚡ This Week!"     :
    days <= 14  ? "📅 Two Weeks Away" :
                  "🗓️ One Month Away";

  const tips = {
    30: ["✈️ Book internal flights if needed", "🛂 Check visa requirements", "💉 Get any required vaccinations", "🎒 Start planning your packing list"],
    14: ["🧳 Start packing your essentials", "📱 Save our guide's contact details", "💊 Pack any prescription medications", "📷 Charge camera batteries and clear memory cards"],
    7:  ["🎒 Finalise your packing", "📋 Print copies of your booking confirmation", "💴 Get local currency if needed", "🌡️ Check the weather forecast for your destination"],
    3:  ["🧴 Pack toiletries and medications", "📱 Download offline maps", "🔋 Charge all devices", "⏰ Confirm your pickup time with our team"],
    1:  ["🛏️ Get a good night's sleep!", "⏰ Set your alarms", "📂 Have all documents ready", "🎉 Your adventure starts TOMORROW!"],
  };

  const html = baseEmail({
    preheader:   `${days} day${days !== 1 ? "s" : ""} until your adventure — ${booking.destination_name || "your trip"} awaits!`,
    headerEmoji: days === 1 ? "🚀" : "⏰",
    headerTitle: APP_NAME,
    headerSubtitle: "Your Trip Is Coming Up!",
    recipientName: booking.full_name,
    body: `
      <!-- countdown -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="margin-bottom:24px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);
          border:2px solid #6ee7b7;border-radius:20px;overflow:hidden;">
        <tr>
          <td style="padding:28px;text-align:center;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#059669;
              text-transform:uppercase;letter-spacing:.1em;">Countdown</p>
            <p style="margin:0;font-size:72px;font-weight:900;color:#047857;
              line-height:1;font-family:'Georgia',serif;">
              ${days}
            </p>
            <p style="margin:4px 0 8px;font-size:18px;font-weight:700;color:#065f46;">
              day${days !== 1 ? "s" : ""} to go!
            </p>
            <p style="margin:0;font-size:13px;font-weight:700;color:#059669;">
              ${urgency}
            </p>
          </td>
        </tr>
      </table>

      ${bookingSummaryBlock(booking)}

      <!-- tips -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="margin-top:20px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;">
        <tr>
          <td style="padding:18px 20px;">
            <p style="margin:0 0 12px;font-size:13px;font-weight:800;color:#92400e;">
              ✅ ${days <= 3 ? "Last-minute checklist" : "Pre-departure checklist"}
            </p>
            ${(tips[days] || tips[7]).map(tip =>
              `<p style="margin:0 0 8px;font-size:13.5px;color:#92400e;line-height:1.5;">
                ${esc(tip)}
              </p>`
            ).join("")}
          </td>
        </tr>
      </table>
    `,
    ctaText:          "View Booking Details",
    ctaUrl:           `${FRONTEND_URL}/my-bookings`,
    ctaSecondaryText: "Chat with Our Team",
    ctaSecondaryUrl:  WHATSAPP_URL,
    footerExtra: `
      Ref: <strong>${esc(booking.booking_number)}</strong> ·
      Departing <strong>${esc(fmtDate(booking.travel_date))}</strong>
    `,
  });

  return safeSend(
    booking.email,
    `${days === 1 ? "🚀 TOMORROW" : `⏰ ${days} days to go`} — ${booking.destination_name || "Your trip"} | ${APP_NAME}`,
    html,
    `sendTripCountdownEmail(${days}d)`,
  );
};

/* ══════════════════════════════════════════════════════════════════════════
   8.  RESEND VERIFICATION EMAIL
══════════════════════════════════════════════════════════════════════════ */
const sendResendVerificationEmail = async (booking, token) => {
  // Identical to verification link but with slightly different copy
  if (!booking?.email || !token) return { success: false };
  return sendBookingVerificationLink(
    { ...booking },
    token,
  );
};

/* ══════════════════════════════════════════════════════════════════════════
   9.  CANCELLATION REQUEST ACKNOWLEDGEMENT  (to user)
══════════════════════════════════════════════════════════════════════════ */
const sendCancellationRequestAck = async (booking, requestType = "cancellation") => {
  if (!booking?.email) return { success: false };

  const html = baseEmail({
    preheader:    `Your ${requestType} request for booking ${booking.booking_number} has been received`,
    headerEmoji:  "📝",
    headerTitle:  APP_NAME,
    headerSubtitle: `${requestType === "refund" ? "Refund" : "Cancellation"} Request Received`,
    recipientName: booking.full_name,
    body: `
      <h2 style="margin:0 0 10px;font-size:22px;font-weight:900;color:#0f172a;
        font-family:'Georgia',serif;">
        We've received your ${esc(requestType)} request
      </h2>
      <p style="margin:0 0 20px;font-size:14.5px;color:#475569;line-height:1.7;">
        Our team will review your request within <strong>24–48 hours</strong>
        and get back to you with a decision.
      </p>
      ${bookingSummaryBlock(booking)}
    `,
    ctaText:  "View My Booking",
    ctaUrl:   `${FRONTEND_URL}/my-bookings`,
  });

  return safeSend(
    booking.email,
    `${requestType === "refund" ? "Refund" : "Cancellation"} request received — Ref ${booking.booking_number} | ${APP_NAME}`,
    html,
    "sendCancellationRequestAck",
  );
};

/* ══════════════════════════════════════════════════════════════════════════
   EXPORTS
══════════════════════════════════════════════════════════════════════════ */
module.exports = {
  /* Core booking lifecycle */
  sendBookingVerificationLink,
  sendBookingReceivedEmail,
  sendAdminBookingNotification,
  sendBookingConfirmation,
  sendBookingStatusUpdate,
  sendBookingCancellation,
  sendTripCountdownEmail,
  /* Extras */
  sendResendVerificationEmail,
  sendCancellationRequestAck,
};