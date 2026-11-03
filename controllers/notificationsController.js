// backend/controllers/notificationsController.js
"use strict";

/*
 * Central notifications engine.
 *
 * Responsibilities:
 *   1. createNotificationInternal(...)  — used by bookingsController & server.js
 *      socket broadcast. Inserts an in-app notification for a user (or a
 *      broadcast/role audience), emits a realtime socket event and (for
 *      individual user notifications) sends an email.
 *   2. Admin activity aggregation — many users doing the SAME activity
 *      (e.g. 10+ bookings, 10+ reviews) are collapsed into ONE compiled
 *      admin notification that lists the participants instead of spamming
 *      the admin dashboard with one row per user.
 *   3. Admin email digests — the compiled admin notification is also emailed
 *      to every admin so it lands in their inbox.
 *
 * Every function is safe to fire-and-forget:  fn({...}).catch(() => {})
 */

const { query }  = require("../config/db");
const logger     = require("../utils/logger");

/* ── Push (optional) ──────────────────────────────────────────────────────── */
let pushUtility = null
try {
  pushUtility = require("../utils/push")
} catch { /* web-push not installed */ }

/* ── Email (optional) ──────────────────────────────────────────────────────── */
let sendEmail = null;
try {
  const eu = require("../utils/email");
  sendEmail = (eu && typeof eu.sendEmail === "function") ? eu.sendEmail : null;
} catch { /* email not configured */ }

/* ── Socket.io (optional) ───────────────────────────────────────────────────── */
const getIO = () => {
  try {
    const socketBus = require("../utils/socketBus");
    const io = socketBus?.getIO?.() || null;
    if (io) return io;
  } catch { /* no socketBus */ }
  // Fallback handled by callers passing req.app.get('io')
  return null;
};

/* ── Helpers ────────────────────────────────────────────────────────────────── */
const toInt = (v, fb = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fb;
};

const ADMIN_ROLES = ["admin", "manager"];
const EMAIL_LOGO_URL = process.env.EMAIL_LOGO_URL || "https://www.altuverasafaris.com/altuvera.png";
const profileInitials = (name, email) => {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length) return words[0].slice(0, 2).toUpperCase();
  return String(email || "U").trim().slice(0, 1).toUpperCase() || "U";
};
const escapeEmailAttribute = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const profileHeader = (name, email, avatarUrl) => {
  const rawAvatar = String(avatarUrl || "");
  const safeAvatar = /^https:\/\//i.test(rawAvatar) ? escapeEmailAttribute(rawAvatar) : "";
  const initials = escapeEmailAttribute(profileInitials(name, email).replace(/[^a-z0-9]/gi, "") || "U");
  const avatar = safeAvatar
    ? '<img src="' + safeAvatar + '" width="54" height="54" alt="Recipient profile" style="display:block;width:54px;height:54px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.85);" />'
    : '<table role="presentation" cellpadding="0" cellspacing="0" width="54" height="54" style="width:54px;height:54px;border-radius:50%;background:#d1fae5;"><tr><td align="center" valign="middle" style="font-weight:800;color:#065f46;font-family:Arial,sans-serif;">' + initials + '</td></tr></table>';
  return '<table data-altuvera-email-header="true" role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>' +
    '<td width="124"><img src="' + escapeEmailAttribute(EMAIL_LOGO_URL) + '" width="112" height="56" alt="Altuvera Safaris logo" style="display:block;width:112px;height:56px;object-fit:contain;background:#fff;padding:3px;border-radius:10px;" /></td>' +
    '<td style="padding:0 10px;color:#fff;font-family:Arial,sans-serif;"><p style="margin:0;font-size:18px;font-weight:800;">Altuvera Safaris</p><p style="margin:4px 0 0;color:#a7f3d0;font-size:10px;letter-spacing:1px;">AFRICAN ADVENTURES</p></td>' +
    '<td align="right" width="58">' + avatar + '</td></tr></table>';
};

const getAdminRecipients = async () => {
  try {
    const res = await query(
`SELECT id, email, full_name, avatar_url
         FROM users
        WHERE role = ANY($1)
          AND email IS NOT NULL AND email <> ''
          AND (preferences->>'emailNotifications' IS DISTINCT FROM 'false'
               OR preferences IS NULL)
        ORDER BY id`,
      [ADMIN_ROLES],
    );
    return res.rows.filter((r) => r.email);
  } catch (err) {
    logger.warn("[Notifications] getAdminRecipients:", err.message);
    return [];
  }
};

const escapeLoginEmailHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

const formatLoginEmailDate = (value) => {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";
};

/* Dedicated responsive sign-in alert. Uses simple text glyph icons rather than
 * emoji, and table-based layout so the message remains stable in email clients. */
const buildSignInSuccessEmailHtml = ({
  recipientName = "",
  loginAt = null,
  expiresAt = null,
}) => {
  const esc = escapeLoginEmailHtml;
  const firstName = String(recipientName || "").trim().split(/\s+/)[0] || "";
  const baseUrl = String(process.env.FRONTEND_URL || "https://www.altuverasafaris.com").replace(/\/+$/, "");
  const securityUrl = esc(baseUrl + "/account/security");
  const loginTimeLabel = formatLoginEmailDate(loginAt);
  const expiryLabel = formatLoginEmailDate(expiresAt);
  const logoUrl = esc(EMAIL_LOGO_URL);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Sign-in successful | Altuvera Safaris</title>
  <style>
    body{margin:0!important;padding:0!important;width:100%!important;background:#f3f7f4;color:#173326;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}
    img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
    a{color:#087a50}
    @media only screen and (max-width:620px){
      .outer-pad{padding:16px 8px!important}
      .card{width:100%!important;border-radius:16px!important}
      .header-pad{padding:22px 18px!important}
      .content-pad{padding:26px 18px!important}
      .footer-pad{padding:18px!important}
      .brand-logo{width:92px!important;height:auto!important}
      .brand-name{font-size:17px!important}
      .main-title{font-size:25px!important}
      .detail-label{width:112px!important}
      .cta-link{display:block!important;text-align:center!important}
    }
  </style>
</head>
<body>
  <div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all;">
    Your Altuvera Safaris account was signed in successfully. Review your recent session details.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f3f7f4;">
    <tr>
      <td align="center" class="outer-pad" style="padding:36px 14px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="card" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e1ebe4;border-radius:22px;overflow:hidden;">
          <tr>
            <td class="header-pad" bgcolor="#064e3b" style="padding:24px 30px;background:#064e3b;background-image:linear-gradient(135deg,#063d2e 0%,#087a50 100%);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="112" valign="middle" style="width:112px;">
                    <a href="${esc(baseUrl)}" style="text-decoration:none;">
                      <img class="brand-logo" src="${logoUrl}" width="108" alt="Altuvera Safaris" style="display:block;width:108px;max-width:100%;height:auto;max-height:58px;object-fit:contain;background:#ffffff;border-radius:9px;padding:4px;">
                    </a>
                  </td>
                  <td valign="middle" style="padding-left:15px;">
                    <p class="brand-name" style="margin:0;color:#ffffff;font-size:19px;line-height:1.3;font-weight:800;overflow-wrap:anywhere;">Altuvera Safaris</p>
                    <p style="margin:4px 0 0;color:#b9f2d4;font-size:10px;line-height:1.5;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">True adventure in high places &amp; deep culture</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="content-pad" style="padding:38px 38px 34px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
                <tr>
                  <td valign="middle" width="40" height="40" align="center" style="width:40px;height:40px;border-radius:50%;background:#e8f7ef;border:1px solid #b9e8ce;color:#087a50;font-size:22px;font-weight:700;line-height:40px;">&#10003;</td>
                  <td valign="middle" style="padding-left:11px;color:#087a50;font-size:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;">Account security notification</td>
                </tr>
              </table>
              <h1 class="main-title" style="margin:0 0 12px;color:#123b2c;font-size:29px;line-height:1.2;font-weight:800;letter-spacing:-.5px;">You’re signed in</h1>
              <p style="margin:0 0 10px;color:#344f42;font-size:16px;line-height:1.65;">Hello${firstName ? ", <strong>" + esc(firstName) + "</strong>" : ""},</p>
              <p style="margin:0;color:#52685d;font-size:15px;line-height:1.75;overflow-wrap:anywhere;">Your Altuvera Safaris account was signed in successfully. You can continue exploring your account and travel plans.</p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:26px 0 0;background:#f7fbf8;border:1px solid #dcebe1;border-radius:15px;">
                <tr>
                  <td colspan="2" style="padding:17px 18px 8px;color:#174b35;font-size:11px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;">Recent session</td>
                </tr>
                <tr>
                  <td width="34" valign="top" style="width:34px;padding:10px 0 14px 18px;color:#087a50;font-size:18px;line-height:1.4;">&#8599;</td>
                  <td valign="top" style="padding:10px 18px 14px 10px;">
                    <p style="margin:0 0 4px;color:#64796d;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;">Sign-in time</p>
                    <p style="margin:0;color:#183d2d;font-size:14px;line-height:1.5;overflow-wrap:anywhere;">${esc(loginTimeLabel)}</p>
                  </td>
                </tr>
                <tr>
                  <td width="34" valign="top" style="width:34px;padding:12px 0 17px 18px;border-top:1px solid #e4eee7;color:#087a50;font-size:18px;line-height:1.4;">&#9719;</td>
                  <td valign="top" style="padding:12px 18px 17px 10px;border-top:1px solid #e4eee7;">
                    <p style="margin:0 0 4px;color:#64796d;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;">Session scheduled to expire</p>
                    <p style="margin:0;color:#183d2d;font-size:14px;line-height:1.5;overflow-wrap:anywhere;">${esc(expiryLabel)}</p>
                  </td>
                </tr>
              </table>

              <p style="margin:23px 0 0;color:#52685d;font-size:14px;line-height:1.7;">If this sign-in was yours, no action is needed. If you don’t recognize it, review your account security.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:23px 0 0;">
                <tr>
                  <td bgcolor="#087a50" style="background:#087a50;border-radius:999px;">
                    <a class="cta-link" href="${securityUrl}" style="display:inline-block;padding:14px 24px;color:#ffffff!important;font-size:14px;line-height:1.3;font-weight:700;text-decoration:none;border-radius:999px;">Review account security <span aria-hidden="true">&#8594;</span></a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="footer-pad" style="padding:20px 30px;background:#f7faf8;border-top:1px solid #e5eee8;">
              <p style="margin:0 0 6px;color:#546b5e;font-size:12px;line-height:1.6;">Need help? Contact <a href="mailto:info@altuverasafaris.com" style="color:#087a50;font-weight:700;text-decoration:none;overflow-wrap:anywhere;">info@altuverasafaris.com</a>.</p>
              <p style="margin:0;color:#82938a;font-size:11px;line-height:1.6;">This is an automated account-security message from Altuvera Safaris. Please do not reply.</p>
              <p style="margin:12px 0 0;color:#9aa79f;font-size:10px;line-height:1.5;">© ${new Date().getFullYear()} Altuvera Safaris. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const sendUserEmail = async (notif, recipientEmail, recipientName) => {
  if (!sendEmail || !recipientEmail) return;

  // Keep routine in-app activity in the notification center instead of emailing
  // users for every small event. Email is reserved for actionable conversations,
  // security alerts, and genuinely urgent travel/booking changes.
  const category = String(notif.category || "").toLowerCase();
  const type = String(notif.type || "").toLowerCase();
  const isSecurityNotification = category === "security" || type.includes("security");
  const shouldEmail =
    isSecurityNotification ||
    (category === "messages" && (
      notif.priority === "high" ||
      type.includes("new_conversation") ||
      type.includes("conversation_request")
    )) ||
    (category === "travel_updates" && notif.priority === "high") ||
    (category === "booking" && notif.priority === "high");
  if (!shouldEmail) return;

  try {
    const prefResult = await query(
      "SELECT full_name, avatar_url, preferences FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [recipientEmail],
    ).catch(() => ({ rows: [] }));
    const recipient = prefResult.rows?.[0] || {};
    const preferences = recipient.preferences && typeof recipient.preferences === "object"
      ? recipient.preferences : {};
    if (preferences.emailNotifications === false && !isSecurityNotification) return;

    // Personalize only with interests the guest has actually saved or liked.
    const savedInterestValues = [
      preferences.likedAttractions,
      preferences.favoriteAttractions,
      preferences.attractionsLiked,
      preferences.likedDestinations,
      preferences.favorites,
      preferences.wishlist,
    ].flatMap((value) => Array.isArray(value) ? value : value ? [value] : []);
    const savedInterests = savedInterestValues
      .map((value) => typeof value === "string" ? value : value?.name || value?.title || value?.label || "")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const likedResult = await query(
      `SELECT d.name, MAX(dl.updated_at) AS last_liked
         FROM destination_likes dl
         JOIN destinations d ON d.id = dl.destination_id
         JOIN users u ON u.id = dl.user_id
        WHERE LOWER(u.email) = LOWER($1)
        GROUP BY d.id, d.name
        ORDER BY last_liked DESC
        LIMIT 3`,
      [recipientEmail],
    ).catch(() => ({ rows: [] }));
    const likedDestinations = (likedResult.rows || []).map((row) => row.name).filter(Boolean);
    const interests = [...new Set([...savedInterests, ...likedDestinations])].slice(0, 3);

    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
    }[char]));
    const title = escapeHtml(notif.title || "A message from Altuvera Safaris");
    const message = escapeHtml(notif.message || "").replace(/\n/g, "<br>");
    const actionUrl = String(notif.action_url || "");
    const isTravelContext = category === "booking" || category === "travel_updates" ||
      type.includes("booking") || type.includes("travel");
    const personalization = isTravelContext && interests.length
      ? `<aside style="margin:20px 0 0;padding:14px 16px;border-radius:10px;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;font-size:13px;line-height:1.6"><strong>Your travel interests</strong><br>You've shown interest in ${interests.map(escapeHtml).join(", ")}. We'll use these saved interests to make relevant travel guidance more useful.</aside>`
      : "";
    const safeActionUrl = /^https:\/\//i.test(actionUrl)
      ? escapeHtml(actionUrl)
      : escapeHtml(`${(process.env.FRONTEND_URL || "https://www.altuverasafaris.com").replace(/\/$/, "")}/${actionUrl.replace(/^\//, "")}`);
    const action = notif.action_url
      ? `<p style="margin:26px 0 8px"><a href="${safeActionUrl}" style="display:inline-block;padding:12px 20px;background:#047857;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">${escapeHtml(notif.action_label || "View details")}</a></p>`
      : "";

    const isSignInSuccess = type === "login_success";
    const loginHtml = isSignInSuccess
      ? buildSignInSuccessEmailHtml({
          recipientName: recipient.full_name || recipientName || "",
          loginAt: notif.metadata?.lastLoginAt,
          expiresAt: notif.metadata?.sessionExpiresAt,
        })
      : null;
    const loginText = isSignInSuccess
      ? [
          "You’re signed in to Altuvera Safaris.",
          "",
          recipient.full_name || recipientName ? "Hello " + (recipient.full_name || recipientName) + "," : "Hello,",
          "Your Altuvera Safaris account was signed in successfully.",
          "Sign-in time: " + formatLoginEmailDate(notif.metadata?.lastLoginAt),
          "Session scheduled to expire: " + formatLoginEmailDate(notif.metadata?.sessionExpiresAt),
          "",
          "If you don’t recognize this sign-in, review your account security:",
          (process.env.FRONTEND_URL || "https://www.altuverasafaris.com").replace(/\/+$/, "") + "/account/security",
          "",
          "Need help? info@altuverasafaris.com",
          "This is an automated account-security message. Please do not reply.",
        ].join("\n")
      : undefined;

    await sendEmail({
      to: recipientEmail,
      subject: isSignInSuccess ? "You’re signed in — Altuvera Safaris" : (notif.title || "A message from Altuvera Safaris"),
      replyTo: "info@altuverasafaris.com",
      recipientName: recipient.full_name || recipientName || "",
      ...(isSignInSuccess ? { text: loginText, html: loginHtml } : {
        recipientAvatarUrl: recipient.avatar_url || "",
        html: `<!doctype html><html lang="en"><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;padding:24px 12px">
          <main style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
            <header style="background:#064e3b;padding:18px 22px;color:#fff">${profileHeader(recipient.full_name || recipientName, recipientEmail, recipient.avatar_url)}<h1 style="margin:16px 0 0;font-size:22px">${title}</h1></header>
            <section style="padding:26px;line-height:1.7;font-size:15px"><p style="margin-top:0">${recipient.full_name ? `Hello ${escapeHtml(recipient.full_name)},` : "Hello,"}</p><p>${message}</p>${personalization}${action}</section>
            <footer style="padding:18px 26px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;line-height:1.6">This is an important account or travel message from Altuvera Safaris. Manage email preferences in your account settings.<br><a href="mailto:info@altuverasafaris.com" style="color:#047857">info@altuverasafaris.com</a></footer>
          </main></body></html>`,
      }),
    });

    await query(
      "UPDATE notifications SET email_sent = true, email_sent_at = NOW() WHERE id = $1",
      [notif.id],
    ).catch(() => {});
  } catch (err) {
    logger.warn("[Notifications] sendUserEmail:", err.message);
  }
};


const sendAdminEmail = async (subject, html) => {
  if (!sendEmail) return;

  const admins = await getAdminRecipients();
  const recipients = admins.length
    ? admins
    : ((process.env.ADMIN_EMAIL || process.env.SMTP_USER)
        ? [{ email: process.env.ADMIN_EMAIL || process.env.SMTP_USER, full_name: "Admin" }]
        : []);

  await Promise.all(recipients.map((a) =>
    sendEmail({
      to:      a.email,
      subject,
      html: html.replace("{{name}}", a.full_name || "Admin"),
      recipientName: a.full_name || "Admin",
      recipientAvatarUrl: a.avatar_url || "",
    }).catch((e) => logger.warn("[Notifications] admin email failed:", e.message)),
  ));
};

/* ── Realtime emit ───────────────────────────────────────────────────────────── */
const emitNotification = (req, notif) => {
  try {
    const io = req?.app?.get?.("io") || getIO();
    if (!io) return;
    const { target_scope, target_role, user_id } = notif;

    if (target_scope === "all") {
      io.to("all-users").emit("notification:new", notif);
      io.to("admins").emit("notification:new", notif);
      io.to("admin-room").emit("notification:new", notif);
    } else if (target_scope === "admin") {
      io.to("admins").emit("notification:new", notif);
      io.to("admin-room").emit("notification:new", notif);
    } else if (target_scope === "role" && target_role) {
      io.to(`role-${target_role}`).emit("notification:new", notif);
      io.to("admins").emit("notification:new", notif);
    } else if (user_id) {
      io.to(`user-${user_id}`).emit("notification:new", notif);
    }
    // An admin's outgoing chat message creates a user-facing notification.
    // Do not echo it back as a new incoming-message alert for the admin.
    if (target_scope !== "admin" && notif.type !== "admin_message") {
      io.to("admins").emit("notification:admin-ping", notif);
    }
  } catch (err) {
    logger.warn("[Notifications] emitNotification:", err.message);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   CORE — create one notification row (user / broadcast / admin)
   ═══════════════════════════════════════════════════════════════════════════ */
const insertNotification = async ({
  userId       = null,
  userEmail    = null,
  senderType   = "system",
  senderId     = null,
  senderName   = "Altuvera",
  type         = "general",
  category     = "general",
  title,
  message,
  actionUrl    = null,
  actionLabel  = null,
  imageUrl     = null,
  priority     = "normal",
  targetScope  = "individual",
  targetRole   = null,
  targetSegment = null,
  metadata     = {},
  expiresAt    = null,
}) => {
  if (!title?.trim() || !message?.trim())
    throw new Error("title and message are required");

  const result = await query(
    `INSERT INTO notifications (
        user_id, user_email, sender_type, sender_id, sender_name,
        type, category, title, message,
        action_url, action_label, image_url,
        priority, target_scope, target_role, target_segment,
        metadata, expires_at
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,
        $10,$11,$12,
        $13,$14,$15,$16,
        $17,$18
      ) RETURNING *`,
    [
      userId,        userEmail,    senderType,    senderId,      senderName,
      type,          category,     title.trim(),  message.trim(),
      actionUrl,     actionLabel,  imageUrl,
      priority,      targetScope,  targetRole,    targetSegment,
      JSON.stringify(metadata),    expiresAt,
    ],
  );
  return result.rows[0];
};

const escapeAdminHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
}[char]));

const normalizeNotificationUser = (user) => {
  if (!user || typeof user !== "object") return null;
  const id = user.id ?? user.userId ?? user.user_id ?? null;
  const email = user.email ?? null;
  const name = user.full_name || user.fullName || user.name || email || "Traveller";
  const avatarUrl = user.avatar_url || user.avatarUrl || user.profile_image_url || user.picture || null;
  if (!id && !email && !avatarUrl) return null;
  return { id, email, name, avatarUrl };
};

const resolveNotificationUser = async (user, metadata = {}) => {
  const source = user || metadata.user || metadata.actor || null;
  let identity = normalizeNotificationUser(source);
  const userId = identity?.id || metadata.userId || metadata.user_id || null;
  const email = identity?.email || metadata.userEmail || metadata.user_email || metadata.email || null;
  if ((!identity || !identity.avatarUrl || !identity.name || identity.name === identity.email) && (userId || email)) {
    try {
      const result = await query(
        `SELECT id, email, full_name, avatar_url FROM users
          WHERE ${userId ? "id = $1" : "LOWER(email) = LOWER($1)"}
          LIMIT 1`,
        [userId || email],
      );
      if (result.rows[0]) identity = normalizeNotificationUser({ ...(source || {}), ...result.rows[0] });
    } catch (err) {
      logger.warn("[Notifications] Could not resolve notification user profile:", err.message);
    }
  }
  return identity;
};

const notifyAdminsImmediately = async ({
  type,
  category,
  title,
  message,
  actionUrl = "/notifications",
  actionLabel = "Open in Admin",
  metadata = {},
  priority = "high",
  user = null,
  users: suppliedUsers = null,
}) => {
  const candidates = Array.isArray(suppliedUsers) && suppliedUsers.length
    ? suppliedUsers
    : [user || metadata.user || metadata.actor || null];
  const resolvedUsers = (await Promise.all(
    candidates.map((candidate) => resolveNotificationUser(candidate, metadata)),
  )).filter(Boolean);
  const notificationMetadata = { ...metadata };
  let imageUrl = null;
  if (resolvedUsers.length) {
    notificationMetadata.users = resolvedUsers;
    if (resolvedUsers.length === 1) {
      notificationMetadata.user = resolvedUsers[0];
      notificationMetadata.userId = resolvedUsers[0].id || notificationMetadata.userId || null;
    } else {
      notificationMetadata.compiled = true;
      notificationMetadata.count = resolvedUsers.length;
      notificationMetadata.userIds = resolvedUsers.map((item) => item.id).filter(Boolean);
      notificationMetadata.userId = resolvedUsers[0].id || null;
    }
    imageUrl = resolvedUsers[0].avatarUrl || null;
  }

  const notif = await insertNotification({
    senderType: "system",
    senderName: "Altuvera",
    type,
    category,
    title,
    message,
    actionUrl,
    actionLabel,
    imageUrl,
    priority,
    targetScope: "admin",
    metadata: notificationMetadata,
  });

  emitNotification(null, { ...notif, target_scope: "admin" });

  const adminPanelUrl =
    process.env.ADMIN_PANEL_URL ||
    process.env.ADMIN_URL ||
    "https://altuverapanel.vercel.app";
  const absoluteUrl = actionUrl && /^https?:\/\//i.test(actionUrl)
    ? actionUrl
    : `${adminPanelUrl.replace(/\/$/, "")}${actionUrl.startsWith("/") ? actionUrl : `/${actionUrl}`}`;

  await sendAdminEmail(
    title,
    `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a;">
      <div style="border-radius:14px;background:#ecfdf5;padding:20px;border:1px solid #a7f3d0;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#059669;">Altuvera Safaris Admin</p>
        <h2 style="margin:0 0 10px;color:#047857;">${escapeAdminHtml(title)}</h2>
        <p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">${escapeAdminHtml(message)}</p>
      </div>
      <a href="${escapeAdminHtml(absoluteUrl)}" style="display:inline-block;margin-top:20px;padding:12px 20px;background:#059669;color:#fff;text-decoration:none;border-radius:9px;font-weight:700;">${escapeAdminHtml(actionLabel)}</a>
      <p style="margin-top:24px;font-size:12px;color:#94a3b8;">This notification is linked directly to the relevant Altuvera admin workspace.</p>
    </div>`,
  ).catch((err) => logger.warn("[Notifications] admin email failed:", err.message));

  return notif;
};

const USER_ACTIVITY_BATCH_WINDOW_MS = 8000;
const pendingUserActivities = new Map();

const queueAdminUserActivity = (activity, user, message) => {
  const identity = normalizeNotificationUser(user);
  if (!identity) {
    logger.warn("[Notifications] User activity notification skipped: no user identity.");
    return;
  }
  const key = "user-activity:" + activity;
  let batch = pendingUserActivities.get(key);
  if (!batch) {
    batch = { activity, users: [], timer: null };
    pendingUserActivities.set(key, batch);
  }
  const uid = identity.id || (identity.email && identity.email.toLowerCase());
  if (uid && batch.users.some((item) => (item.id || item.email?.toLowerCase()) === uid)) return;
  batch.users.push(identity);
  if (!batch.timer) {
    batch.timer = setTimeout(() => flushAdminUserActivity(key), USER_ACTIVITY_BATCH_WINDOW_MS);
    if (typeof batch.timer.unref === "function") batch.timer.unref();
  }
};

const flushAdminUserActivity = async (key) => {
  const batch = pendingUserActivities.get(key);
  if (!batch) return;
  pendingUserActivities.delete(key);
  if (batch.timer) clearTimeout(batch.timer);
  const users = batch.users || [];
  if (!users.length) return;
  const count = users.length;
  const names = users.slice(0, 2).map((item) => item.name || item.email || "Traveller");
  const namesLabel = count <= 2
    ? names.join(" and ")
    : names.join(", ") + " and " + (count - 2) + " more";
  const isSignup = batch.activity === "user_registered";
  const title = isSignup
    ? (count > 1 ? "New travellers registered" : "New traveller registered")
    : (count > 1 ? "Travellers signed in" : "Traveller signed in");
  const message = isSignup
    ? namesLabel + (count > 1 ? " created Altuvera accounts." : " created an Altuvera account.")
    : namesLabel + (count > 1 ? " signed in successfully." : " signed in successfully.");
  try {
    await notifyAdminsImmediately({
      type: batch.activity,
      category: isSignup ? "user" : "security",
      title,
      message,
      actionUrl: users[0].id ? "/users?userId=" + encodeURIComponent(users[0].id) : "/users",
      actionLabel: count > 1 ? "View travellers" : "View traveller",
      metadata: {
        activity: batch.activity,
        compiled: count > 1,
        count,
        userId: users[0].id || null,
      },
      users,
      priority: "high",
    });
  } catch (err) {
    logger.warn("[Notifications] Could not flush grouped user activity:", err.message);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN ACTIVITY BATCH AGGREGATION
   When >= ADMIN_BATCH_THRESHOLD users perform the same activity within
   BATCH_WINDOW_MS, emit ONE compiled admin notification (plus an admin email)
   instead of individual rows.
   ═══════════════════════════════════════════════════════════════════════════ */
const ADMIN_BATCH_THRESHOLD = 10;       // > this many → compile into one
const BATCH_WINDOW_MS       = 5 * 60_000; // 5 minutes

const adminBatch = new Map(); // key -> { type, category, users:[], timer, template }

const listNames = (users, max = 8) => {
  const names = users.slice(0, max).map((u) => u.name || u.email || "Someone");
  if (users.length <= max) return names.join(", ");
  return `${names.join(", ")} and ${users.length - max} more`;
};

const flushAdminBatch = async (key) => {
  const batch = adminBatch.get(key);
  if (!batch) return;
  adminBatch.delete(key);
  if (batch.timer) clearTimeout(batch.timer);

  const { type, category, users, template } = batch;
  if (!users.length) return;

  const count    = users.length;
  const compiled = count > 1;
  const title    = template.title(count);
  const message  = template.message(listNames(users), count);

  try {
const notif = await insertNotification({
       senderType:  "system",
       senderName:  "Altuvera",
       type,
       category,
       title,
       message,
       targetScope: "role",
       targetRole: "admin",
       priority:    "high",
       metadata:    {
         activity:   key,
         count,
         userIds:    users.map((u) => u.id).filter(Boolean),
         compiled:   true,
       },
     });

    emitNotification(null, { ...notif, target_scope: "admin" });

    await sendAdminEmail(
      title,
      `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#0f172a;">
        <h2 style="color:#059669;">{{name}}, ${title}</h2>
        <p style="font-size:16px;line-height:1.6;">${message}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>
        <p style="font-size:12px;color:#94a3b8;">Altuvera Safaris — Admin Activity Digest</p>
      </div>`,
    ).catch(() => {});
  } catch (err) {
    logger.warn("[Notifications] flushAdminBatch:", err.message);
  }
};

/**
 * Record a single user's activity for admin visibility.
 * If the same activity reaches the threshold, a single compiled notification
 * is flushed; otherwise a debounced flush runs after BATCH_WINDOW_MS.
 */
const recordAdminActivity = (key, { type, category, user, template }) => {
  if (!key || !template) return;
  let batch = adminBatch.get(key);
  if (!batch) {
    batch = { type, category, users: [], template, timer: null };
    adminBatch.set(key, batch);
  }
  // de-dupe by user id
  const uid = user?.id ?? user?.email;
  if (uid && batch.users.some((u) => (u.id ?? u.email) === uid)) return;
  batch.users.push({
    id:    user?.id    ?? null,
    email: user?.email ?? null,
    name:  user?.name  ?? user?.fullName ?? user?.email ?? "Someone",
  });

  // Spec: notify admin ONCE when MORE THAN the threshold users do the same
  // activity. Compile every participant into a single row.
  if (batch.users.length > ADMIN_BATCH_THRESHOLD) {
    flushAdminBatch(key);
    return;
  }
  if (!batch.timer) {
    batch.timer = setTimeout(() => flushAdminBatch(key), BATCH_WINDOW_MS);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC — createNotificationInternal
   Signature mirrors every call site in the codebase:
   createNotificationInternal({ userId, userEmail, type, category, title,
     message, actionUrl, actionLabel, priority, targetScope, ... ,
     adminActivity?: { key, type, category, template } , actor?: {...} })
   ═══════════════════════════════════════════════════════════════════════════ */
const createNotificationInternal = async ({
  userId        = null,
  userEmail     = null,
  senderType    = "system",
  senderId      = null,
  senderName    = "Altuvera",
  type          = "general",
  category      = "general",
  title,
  message,
  actionUrl     = null,
  actionLabel   = null,
  imageUrl      = null,
  priority      = "normal",
  targetScope   = "individual",
  targetRole    = null,
  targetSegment = null,
  metadata      = {},
  expiresAt     = null,
  req           = null,        // optional — for socket emit via req.app
  actor         = null,        // { id, email, name } of the user who acted
  adminActivity = null,        // { key, type, category, template }
  skipUserEmail = false,
} = {}) => {
  // 1) In-app notification for the user (or audience)
  let notificationMetadata = metadata;
  let notificationImageUrl = imageUrl;
  if (targetScope !== "individual" && actor) {
    const identity = await resolveNotificationUser(actor, metadata);
    if (identity) {
      notificationMetadata = { ...metadata, user: identity, users: [identity], userId: identity.id || metadata.userId || null };
      notificationImageUrl = identity.avatarUrl || imageUrl;
    }
  }

  const notif = await insertNotification({
    userId, userEmail, senderType, senderId, senderName,
    type, category, title, message,
    actionUrl, actionLabel, imageUrl: notificationImageUrl,
    priority, targetScope, targetRole, targetSegment,
    metadata: notificationMetadata, expiresAt,
  });

  // 2) Realtime
  emitNotification(req, notif);

  // 2b) Web Push for the same audience as the in-app notification.
  // Each browser subscription is scoped to the authenticated account in admin_id.
  if (pushUtility && (
    targetScope === "individual" ||
    targetScope === "all" ||
    targetScope === "admin" ||
    (targetScope === "role" && targetRole)
  )) {
    ;(async () => {
      try {
        let sql = "SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps"
        const params = []
        if (targetScope === "individual") {
          if (userId) {
            params.push(userId)
            sql += ` WHERE ps.admin_id = $1`
          } else if (userEmail) {
            params.push(userEmail)
            sql += ` WHERE LOWER(ps.admin_email) = LOWER($1)`
          } else {
            return
          }
        } else if (targetScope === "admin") {
          sql += " JOIN users u ON u.id = ps.admin_id WHERE u.role = ANY($1)"
          params.push(["admin", "manager"])
        } else if (targetScope === "role" && targetRole) {
          sql += " JOIN users u ON u.id = ps.admin_id WHERE u.role = $1"
          params.push(targetRole)
        }
        const { rows } = await query(sql, params)
        if (!rows.length) return
        const isAdminNotice = targetScope === "admin" || (targetScope === "role" && ["admin", "manager"].includes(targetRole))
        const frontendBase = (process.env.FRONTEND_URL || "https://www.altuverasafaris.com").replace(/\/$/, "")
        const requestedUrl = actionUrl || (isAdminNotice ? "/notifications" : "/notifications")
        const url = /^https?:\/\//i.test(requestedUrl) ? requestedUrl : `${frontendBase}${requestedUrl.startsWith("/") ? requestedUrl : `/${requestedUrl}`}`
        await pushUtility.sendPushToSubscriptions(rows, {
          title: title || "Altuvera Safaris",
          body: message || "",
          icon: "/favicon.ico",
          badge: "/favicon.ico",
          data: { url, id: notif.id },
          requireInteraction: priority === "high",
        })
      } catch (err) {
        logger.warn("[Notifications] Web Push delivery failed:", err.message)
      }
    })()
  }

  // 3) Email the user (only for individual user notifications)
  if (!skipUserEmail && targetScope === "individual" && userEmail) {
    sendUserEmail(notif, userEmail, null).catch(() => {});
  }

  // 4) Admin activity aggregation
  if (adminActivity) {
    recordAdminActivity(adminActivity.key, {
      type:     adminActivity.type     || type,
      category: adminActivity.category || category,
      user:     actor || (userId ? { id: userId, email: userEmail } : null),
      template: adminActivity.template,
    });
  }

  return notif;
};

/* ═══════════════════════════════════════════════════════════════════════════
   CONVENIENCE BUILDERS for common user actions
   ═══════════════════════════════════════════════════════════════════════════ */

/* Booking created — notify the user + aggregate to admins */
const notifyBookingCreated = async (booking, user) => {
  const bookingId = booking?.id || booking?.booking_id || booking?.booking_number || "";
  const actionUrl = `/bookings?bookingId=${encodeURIComponent(bookingId)}`;
  const userNotif = await createNotificationInternal({
    userId: user?.id,
    userEmail: user?.email,
    type: "booking_created",
    category: "booking",
    title: `Congratulations ${user?.full_name || user?.name || booking?.full_name || "traveller"}! 🎉`,
    message: `Your booking ${booking?.booking_number ? `(${booking.booking_number}) ` : ""}has been received successfully and is pending review.`,
    actionUrl: "/my-bookings",
    actionLabel: "Track Booking",
    priority: "normal",
    actor: user,
    skipUserEmail: true,
  });
  await notifyAdminsImmediately({
    type: "booking_created",
    category: "booking",
    title: "New booking received 📅",
    message: `${booking?.full_name || booking?.email || "A traveller"} submitted booking ${booking?.booking_number || bookingId || ""}.`,
    actionUrl,
    actionLabel: "Open booking",
    user: user || {
      id: booking?.user_id || booking?.userId || null,
      email: booking?.email || null,
      full_name: booking?.full_name || null,
      avatar_url: booking?.avatar_url || booking?.avatarUrl || null,
    },
    metadata: { bookingId: booking?.id || null, bookingNumber: booking?.booking_number || null, userId: user?.id || booking?.user_id || booking?.userId || null },
  });
  return userNotif;
};

/* Package request — notify every admin immediately with a direct workspace target. */
const notifyPackageBookingCreated = async (booking, pkg, req = null) => {
  const traveller = booking?.full_name || booking?.email || "A traveller";
  const packageTitle = pkg?.title || "a package";
  const hasSpecialRequests = Boolean(booking?.special_requests);
  const actionPath = `/packages?packageId=${encodeURIComponent(booking?.package_id || pkg?.id || "")}&requestId=${encodeURIComponent(booking?.id || "")}`;

  // Package requests must also create a traveller-facing notification. The
  // booking route already sends the receipt email, but previously this helper
  // only notified admins, leaving authenticated users with no in-app alert.
  const userNotif = await createNotificationInternal({
    userId: booking?.user_id || null,
    userEmail: booking?.email || null,
    type: "package_request_created",
    category: "package",
    title: "Package request received 📦",
    message: `Your request for "${packageTitle}" was received and is pending review.`,
    actionUrl: `/my-bookings?bookingId=${encodeURIComponent(booking?.id || "")}&packageId=${encodeURIComponent(booking?.package_id || pkg?.id || "")}`,
    actionLabel: "Track request",
    priority: "normal",
    req,
    skipUserEmail: true, // booking receipt is sent by the booking email service
  });

  const notif = await createNotificationInternal({
    type: "package_request",
    category: "package",
    title: "New package request 📦",
    message: `${traveller} requested "${packageTitle}"${hasSpecialRequests ? " with special requests." : "."}`,
    actionUrl: actionPath,
    actionLabel: "Open package request",
    priority: "high",
    targetScope: "admin",
    metadata: {
      packageId: booking?.package_id || pkg?.id || null,
      bookingId: booking?.id || null,
      bookingNumber: booking?.booking_number || null,
      requestType: "package_booking",
      hasSpecialRequests,
      userId: booking?.user_id || booking?.userId || null,
    },
    actor: {
      id: booking?.user_id || booking?.userId || null,
      email: booking?.email || null,
      full_name: booking?.full_name || null,
      avatar_url: booking?.avatar_url || booking?.avatarUrl || null,
    },
    req,
  });

  // Send the same request immediately to the configured admin inbox.
  const adminPanelUrl =
    process.env.ADMIN_PANEL_URL ||
    process.env.ADMIN_URL ||
    "https://altuverapanel.vercel.app";
  const actionUrl = `${adminPanelUrl.replace(/\/$/, "")}${actionPath}`;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
  }[char]));

  sendAdminEmail(
    `New package request 📦 — ${packageTitle}`,
    `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a;">
      <div style="border-radius:14px;background:#ecfdf5;padding:20px;border:1px solid #a7f3d0;">
        <h2 style="margin:0 0 8px;color:#047857;">New Package Request 📦</h2>
        <p style="margin:0;font-size:15px;color:#334155;">{{name}}, a traveller has submitted a new package request.</p>
      </div>
      <div style="padding:20px 4px;">
        <p><strong>Traveller:</strong> ${escapeHtml(traveller)}</p>
        <p><strong>Package:</strong> ${escapeHtml(packageTitle)}</p>
        <p><strong>Booking reference:</strong> ${escapeHtml(booking?.booking_number || booking?.id || "Pending")}</p>
        <p><strong>Special requests:</strong> ${hasSpecialRequests ? escapeHtml(booking.special_requests) : "None"}</p>
      </div>
      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 20px;background:#059669;color:#fff;text-decoration:none;border-radius:9px;font-weight:700;">Open package request</a>
      <p style="margin-top:24px;font-size:12px;color:#94a3b8;">Altuvera Safaris — Admin notification</p>
    </div>`,
  ).catch((err) => logger.warn("[Notifications] package admin email failed:", err.message));

  return userNotif || notif;
};
/* Review posted — notify the user + aggregate to admins */
const notifyReviewPosted = async (review, user) => {
  const reviewId = review?.id || review?.review_id || null;
  const userNotif = await createNotificationInternal({
    userId: user?.id,
    userEmail: user?.email,
    type: "review_posted",
    category: "review",
    title: "Review submitted ✓",
    message: `Thanks! Your review for "${review?.title || "your experience"}" was posted.`,
    actionUrl: "/reviews",
    actionLabel: "View",
    actor: user,
  });
  await notifyAdminsImmediately({
    type: "review_posted",
    category: "review",
    title: "New review submitted ✍️",
    message: `${user?.name || user?.email || "A traveller"} submitted a new review.`,
    actionUrl: reviewId ? `/comments?commentId=${encodeURIComponent(reviewId)}` : "/comments",
    actionLabel: "Open review",
    metadata: { reviewId, userId: user?.id || null },
    user,
  });
  return userNotif;
};

/* User registered — welcome the user + notify admins */
const notifyUserRegistered = async (user) => {
  const userNotif = await createNotificationInternal({
    userId: user?.id,
    userEmail: user?.email,
    type: "user_registered",
    category: "user",
    title: "Welcome to Altuvera",
    message: "Your account is ready. Start exploring unforgettable African adventures.",
    actionUrl: "/destinations",
    actionLabel: "Explore destinations",
    actor: user,
  });
  queueAdminUserActivity("user_registered", user);

  return userNotif;
};

/* Successful sign-in — persist a user notification and alert the admin inbox.
 * The signed JWT expiry is recorded so both dashboards can show an accurate
 * session-expiry countdown instead of guessing a duration. */
const notifyUserLogin = async (user, sessionExpiresAt) => {
  const expiryLabel = sessionExpiresAt
    ? new Date(sessionExpiresAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"
    : "according to your account session settings";
  const metadata = {
    userId: user?.id || null,
    userEmail: user?.email || null,
    lastLoginAt: new Date().toISOString(),
    sessionExpiresAt: sessionExpiresAt || null,
  };
  const userNotif = await createNotificationInternal({
    userId: user?.id,
    userEmail: user?.email,
    type: "login_success",
    category: "security",
    title: "Sign-in successful",
    message: `You signed in successfully. This session is scheduled to expire ${expiryLabel}. You can review your account security at any time.`,
    actionUrl: "/account/security",
    actionLabel: "Review account security",
    priority: "high",
    metadata,
    actor: user,
  });
  queueAdminUserActivity("user_login_success", user);

  return userNotif;
};

/* Admin message — notify the user and deep-link directly to the conversation */
const notifyAdminMessage = async (conversationId, user, admin, messageBody) => {
  return createNotificationInternal({
    userId: user?.id,
    userEmail: user?.email,
    type: "admin_message",
    category: "messages",
    title: `New message from ${admin?.full_name || admin?.name || "Altuvera Team"} 💬`,
    message: String(messageBody || "You have a new message from the Altuvera team.").slice(0, 500),
    actionUrl: conversationId ? `/messages?conversationId=${encodeURIComponent(conversationId)}` : "/messages",
    actionLabel: "Open message",
    actor: admin,
    skipUserEmail: true,
    metadata: { conversationId: conversationId || null },
  });
};

/* Contact message — notify the user + admins (always single, high priority) */
const notifyContactMessage = async (contact, user) => {
  const contactId = contact?.id || contact?.message_id || null;
  const userNotif = await createNotificationInternal({
    userId: user?.id,
    userEmail: user?.email,
    type: "contact_message",
    category: "contact",
    title: `Thanks ${user?.name || user?.full_name || "for contacting Altuvera"}! 💬`,
    message: "Your contact message was received. Our team will review it and get back to you.",
    actionUrl: "/contact",
    actionLabel: "View message",
    actor: user,
    skipUserEmail: true,
  });
  await notifyAdminsImmediately({
    type: "contact_message",
    category: "contact",
    title: `New contact message from ${user?.name || user?.full_name || user?.email || "a visitor"} 💬`,
    message: `${user?.name || user?.full_name || user?.email || "A visitor"} has sent a contact message${contact?.subject ? ` about "${contact.subject}"` : ""}. Open it to review and reply.`,
    actionUrl: contactId ? `/contact?messageId=${encodeURIComponent(contactId)}` : "/contact",
    actionLabel: "Open message",
    metadata: { contactId, userId: user?.id || null },
    user,
  });
  return userNotif;
};

/* Admin broadcast (single, to a scope) */
const broadcastNotification = async ({
  type = "system", category = "system", title, message,
  targetScope = "all", targetRole = null,
  actionUrl = null, actionLabel = null, priority = "normal", metadata = {},
}) => {
  const notif = await insertNotification({
    senderType: "admin", senderName: "Altuvera",
    type, category, title, message,
    targetScope, targetRole, actionUrl, actionLabel, priority, metadata,
  });
  emitNotification(null, notif);

  if (pushUtility && (targetScope === "admin" || (targetScope === "role" && targetRole === "admin"))) {
    ;(async () => {
      try {
        const { rows } = await query(
          `SELECT endpoint, p256dh, auth FROM push_subscriptions`
        )
        if (rows.length) {
          await pushUtility.sendPushToSubscriptions(rows, {
            title: title || "Altuvera Admin",
            body: message || "",
            icon: "/favicon.ico",
            data: { url: actionUrl || "/notifications", id: notif.id },
          })
        }
      } catch {
        /* non-fatal */
      }
    })()
  }

  return notif;
};

/* ═══════════════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════════════ */
module.exports = {
  createNotificationInternal,
  broadcastNotification,
  notifyBookingCreated,
  notifyPackageBookingCreated,
  notifyReviewPosted,
  notifyUserRegistered,
  notifyUserLogin,
  notifyContactMessage,
  notifyAdminMessage,
  notifyAdminsImmediately,
  flushAdminBatch,
  flushAdminUserActivity,
  ADMIN_BATCH_THRESHOLD,
};
