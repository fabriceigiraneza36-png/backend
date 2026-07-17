// backend/routes/notificationTest.js
"use strict";

const express = require("express");
const router  = express.Router();
const { query } = require("../config/db");
const logger    = require("../utils/logger");

/* ─────────────────────────────────────────────────────────────
   Only active in development — auto-disabled in production
───────────────────────────────────────────────────────────────*/
const IS_DEV = process.env.NODE_ENV !== "production";

/* ─────────────────────────────────────────────────────────────
   HELPER — create a notification row and emit via Socket.io
───────────────────────────────────────────────────────────────*/
const createAndEmit = async (req, payload) => {
  const {
    title,
    message,
    type         = "system",
    category     = "system",
    priority     = "normal",
    targetScope  = "all",          // 'all' hits every connected socket room
    targetRole   = null,
    userId       = null,
    userEmail    = null,
    actionUrl    = null,
    actionLabel  = null,
    metadata     = {},
  } = payload;

  /* 1. Persist */
  const result = await query(
    `INSERT INTO notifications (
       user_id, user_email,
       sender_type, sender_id, sender_name,
       type, category, title, message,
       action_url, action_label,
       priority, target_scope, target_role,
       metadata
     ) VALUES (
       $1, $2,
       'system', NULL, 'Test System',
       $3, $4, $5, $6,
       $7, $8,
       $9, $10, $11,
       $12
     ) RETURNING *`,
    [
      userId, userEmail,
      type, category, title, message,
      actionUrl, actionLabel,
      priority, targetScope, targetRole,
      JSON.stringify(metadata),
    ],
  );

  const notif = result.rows[0];

  /* 2. Emit via Socket.io */
  const io = req.app?.get?.("io");
  if (io) {
    if (targetScope === "all") {
      io.to("all-users").emit("notification:new", notif);
      io.to("admins").emit("notification:new", notif);
      io.emit("notification:new", notif);           // catch-all
    } else if (targetScope === "role" && targetRole) {
      io.to(`role-${targetRole}`).emit("notification:new", notif);
      io.to("admins").emit("notification:new", notif);
    } else if (targetScope === "admin") {
      io.to("admins").emit("notification:new", notif);
      io.to("admin-room").emit("notification:new", notif);
    } else if (userId) {
      io.to(`user-${userId}`).emit("notification:new", notif);
    }

    /* Always ping admin panel with a dedicated event */
    io.to("admins").emit("notification:admin-ping", {
      ...notif,
      _test: true,
      _sentAt: new Date().toISOString(),
    });
  }

  logger.info(
    `[NotifTest] Created & emitted: id=${notif.id} scope=${targetScope} type=${type}`,
  );

  return notif;
};

/* ─────────────────────────────────────────────────────────────
   GET /api/test/notifications/ping
   Quick smoke-test — no DB write, just socket emit
───────────────────────────────────────────────────────────────*/
router.get("/ping", (req, res) => {
  const io = req.app?.get?.("io");
  if (!io) {
    return res.status(503).json({ success: false, message: "Socket.io not available" });
  }

  const payload = {
    id:          0,
    type:        "system",
    category:    "system",
    title:       "🔔 Socket Ping Test",
    message:     `Socket is working! Server time: ${new Date().toISOString()}`,
    target_scope: "all",
    is_read:     false,
    created_at:  new Date().toISOString(),
    _test:       true,
  };

  io.emit("notification:new", payload);
  io.to("admins").emit("notification:admin-ping", payload);

  const rooms = [];
  io.sockets.adapter.rooms.forEach((_, key) => rooms.push(key));

  return res.json({
    success:   true,
    message:   "Socket ping emitted to all connections",
    payload,
    connectedSockets: io.engine.clientsCount,
    rooms: rooms.slice(0, 30),   // first 30 room names
  });
});

/* ─────────────────────────────────────────────────────────────
   POST /api/test/notifications/send
   body: { title, message, type, targetScope, userId, userEmail }
───────────────────────────────────────────────────────────────*/
router.post("/send", async (req, res) => {
  if (!IS_DEV)
    return res.status(403).json({ success: false, message: "Dev only" });

  try {
    const notif = await createAndEmit(req, {
      title:       req.body.title       || "🧪 Test Notification",
      message:     req.body.message     || "This is a test notification from the backend.",
      type:        req.body.type        || "system",
      category:    req.body.category    || "system",
      priority:    req.body.priority    || "normal",
      targetScope: req.body.targetScope || "all",
      targetRole:  req.body.targetRole  || null,
      userId:      req.body.userId      || null,
      userEmail:   req.body.userEmail   || null,
      actionUrl:   req.body.actionUrl   || null,
      actionLabel: req.body.actionLabel || null,
      metadata:    req.body.metadata    || { source: "test-panel" },
    });

    return res.status(201).json({
      success: true,
      message: "Notification created and emitted",
      data:    notif,
    });
  } catch (err) {
    logger.error("[NotifTest] send error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/test/notifications/booking-created
   Simulates a new booking notification → admin
───────────────────────────────────────────────────────────────*/
router.post("/booking-created", async (req, res) => {
  if (!IS_DEV)
    return res.status(403).json({ success: false, message: "Dev only" });

  try {
    const guestName   = req.body.guestName   || "John Doe";
    const destination = req.body.destination || "Maasai Mara, Kenya";
    const date        = req.body.travelDate  || "2025-08-15";
    const travelers   = req.body.travelers   || 2;

    const notif = await createAndEmit(req, {
      title:       `📅 New Booking — ${destination}`,
      message:     `${guestName} just booked ${destination} for ${travelers} traveler(s) on ${date}.`,
      type:        "booking_created",
      category:    "booking",
      priority:    "high",
      targetScope: "admin",
      actionUrl:   "/admin/bookings",
      actionLabel: "View Booking",
      metadata:    { guestName, destination, date, travelers },
    });

    return res.status(201).json({
      success: true,
      message: "Booking notification sent to admin panel",
      data:    notif,
    });
  } catch (err) {
    logger.error("[NotifTest] booking-created error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/test/notifications/payment
   Simulates a payment notification → admin
───────────────────────────────────────────────────────────────*/
router.post("/payment", async (req, res) => {
  if (!IS_DEV)
    return res.status(403).json({ success: false, message: "Dev only" });

  try {
    const amount = req.body.amount || 1500;
    const user   = req.body.user   || "Jane Smith";

    const notif = await createAndEmit(req, {
      title:       `💳 Payment Received — $${amount}`,
      message:     `${user} completed a payment of $${amount} USD.`,
      type:        "payment_confirmed",
      category:    "booking",
      priority:    "high",
      targetScope: "admin",
      actionUrl:   "/admin/bookings",
      actionLabel: "View Payment",
      metadata:    { amount, user, currency: "USD" },
    });

    return res.status(201).json({
      success: true,
      message: "Payment notification sent to admin panel",
      data:    notif,
    });
  } catch (err) {
    logger.error("[NotifTest] payment error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/test/notifications/new-user
   Simulates user registration notification → admin
───────────────────────────────────────────────────────────────*/
router.post("/new-user", async (req, res) => {
  if (!IS_DEV)
    return res.status(403).json({ success: false, message: "Dev only" });

  try {
    const email    = req.body.email    || "newuser@example.com";
    const fullName = req.body.fullName || "New User";
    const provider = req.body.provider || "email";

    const notif = await createAndEmit(req, {
      title:       `👤 New User Registered`,
      message:     `${fullName} (${email}) signed up via ${provider}.`,
      type:        "user_registered",
      category:    "system",
      priority:    "normal",
      targetScope: "admin",
      actionUrl:   "/admin/users",
      actionLabel: "View Users",
      metadata:    { email, fullName, provider },
    });

    return res.status(201).json({
      success: true,
      message: "User registration notification sent to admin",
      data:    notif,
    });
  } catch (err) {
    logger.error("[NotifTest] new-user error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/test/notifications/contact-message
   Simulates a contact form submission notification → admin
───────────────────────────────────────────────────────────────*/
router.post("/contact-message", async (req, res) => {
  if (!IS_DEV)
    return res.status(403).json({ success: false, message: "Dev only" });

  try {
    const name    = req.body.name    || "Alice Johnson";
    const email   = req.body.email   || "alice@example.com";
    const subject = req.body.subject || "Trip enquiry";

    const notif = await createAndEmit(req, {
      title:       `✉️ New Contact Message`,
      message:     `${name} (${email}) sent a message: "${subject}"`,
      type:        "contact_message",
      category:    "system",
      priority:    "normal",
      targetScope: "admin",
      actionUrl:   "/admin/messages",
      actionLabel: "View Message",
      metadata:    { name, email, subject },
    });

    return res.status(201).json({
      success: true,
      message: "Contact notification sent to admin",
      data:    notif,
    });
  } catch (err) {
    logger.error("[NotifTest] contact-message error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/test/notifications/broadcast
   Sends to ALL connected users + admins
───────────────────────────────────────────────────────────────*/
router.post("/broadcast", async (req, res) => {
  if (!IS_DEV)
    return res.status(403).json({ success: false, message: "Dev only" });

  try {
    const notif = await createAndEmit(req, {
      title:       req.body.title   || "📢 System Announcement",
      message:     req.body.message || "This is a broadcast message to all users.",
      type:        "system",
      category:    "system",
      priority:    req.body.priority || "normal",
      targetScope: "all",
      actionUrl:   req.body.actionUrl || null,
      metadata:    { source: "broadcast-test" },
    });

    return res.status(201).json({
      success: true,
      message: "Broadcast sent to all connected clients",
      data:    notif,
    });
  } catch (err) {
    logger.error("[NotifTest] broadcast error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/test/notifications/status
   Shows socket rooms + recent notifications
───────────────────────────────────────────────────────────────*/
router.get("/status", async (req, res) => {
  try {
    const io = req.app?.get?.("io");

    /* Recent notifications */
    const recent = await query(
      `SELECT id, type, title, target_scope, is_read, created_at
         FROM notifications
        ORDER BY created_at DESC
        LIMIT 10`,
      [],
    ).catch(() => ({ rows: [] }));

    /* Socket rooms */
    const rooms = {};
    if (io) {
      io.sockets.adapter.rooms.forEach((sockets, roomName) => {
        rooms[roomName] = sockets.size;
      });
    }

    /* Unread count */
    const unreadRes = await query(
      `SELECT COUNT(*)::INT AS count FROM notifications
        WHERE deleted_at IS NULL AND is_read = false`,
      [],
    ).catch(() => ({ rows: [{ count: 0 }] }));

    return res.json({
      success: true,
      socket: {
        available:        !!io,
        connectedClients: io?.engine?.clientsCount ?? 0,
        rooms,
        adminRoom:        rooms["admins"]     ?? 0,
        adminRoomAlt:     rooms["admin-room"] ?? 0,
        allUsersRoom:     rooms["all-users"]  ?? 0,
      },
      notifications: {
        unreadTotal: unreadRes.rows[0]?.count ?? 0,
        recent:      recent.rows,
      },
    });
  } catch (err) {
    logger.error("[NotifTest] status error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;