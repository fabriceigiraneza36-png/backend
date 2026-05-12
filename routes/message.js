// routes/message.js
const router = require("express").Router();
const ctrl = require("../controllers/messageController");
const { protect, adminProtect, optionalAuth } = require("../middleware/auth");
const { query } = require("../config/db");

// ─── USER LISTING FOR CHAT (admin sees all users) ────────────────────────────

// GET /api/messages/users — list all users for starting new conversations
router.get("/users", adminProtect, async (req, res) => {
  try {
    const { page = 1, limit = 50, search, online } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = ["1=1"];
    const params = [];
    let p = 1;

    if (search) {
      conditions.push(
        `(u.full_name ILIKE $${p} OR u.email ILIKE $${p} OR u.phone ILIKE $${p})`,
      );
      params.push(`%${search}%`);
      p++;
    }

    const where = conditions.join(" AND ");

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT
           u.id,
           u.email,
           u.full_name,
           u.avatar_url,
           u.phone,
           u.auth_provider,
           u.is_verified,
           u.is_active,
           u.last_login,
           u.created_at,
           -- Last conversation with this user
           (SELECT c.id FROM conversations c
            WHERE c.user_id = u.id
            ORDER BY c.updated_at DESC LIMIT 1
           ) AS last_conversation_id,
           -- Last conversation session_id
           (SELECT c.session_id FROM conversations c
            WHERE c.user_id = u.id
            ORDER BY c.updated_at DESC LIMIT 1
           ) AS last_session_id,
           -- Last message preview
           (SELECT m.body FROM messages m
            JOIN conversations c2 ON c2.id = m.conversation_id
            WHERE c2.user_id = u.id
            ORDER BY m.created_at DESC LIMIT 1
           ) AS last_message,
           -- Last message time
           (SELECT m.created_at FROM messages m
            JOIN conversations c2 ON c2.id = m.conversation_id
            WHERE c2.user_id = u.id
            ORDER BY m.created_at DESC LIMIT 1
           ) AS last_message_at,
           -- Unread count for admin
           (SELECT COUNT(*) FROM messages m
            JOIN conversations c3 ON c3.id = m.conversation_id
            WHERE c3.user_id = u.id
              AND m.sender_type = 'user'
              AND m.is_read = false
           )::int AS unread_count,
           -- Total messages
           (SELECT COUNT(*) FROM messages m
            JOIN conversations c4 ON c4.id = m.conversation_id
            WHERE c4.user_id = u.id
           )::int AS total_messages,
           -- Is online (had activity in last 5 minutes via last_login or conversation)
           CASE WHEN u.last_login > NOW() - INTERVAL '5 minutes' THEN true
                WHEN EXISTS (
                  SELECT 1 FROM conversations c5
                  WHERE c5.user_id = u.id
                    AND c5.updated_at > NOW() - INTERVAL '5 minutes'
                ) THEN true
                ELSE false
           END AS is_online
         FROM users u
         WHERE ${where}
         ORDER BY
           -- Users with unread messages first
           (SELECT COUNT(*) FROM messages m
            JOIN conversations c6 ON c6.id = m.conversation_id
            WHERE c6.user_id = u.id AND m.sender_type = 'user' AND m.is_read = false
           ) DESC,
           -- Then by last message time
           (SELECT MAX(m.created_at) FROM messages m
            JOIN conversations c7 ON c7.id = m.conversation_id
            WHERE c7.user_id = u.id
           ) DESC NULLS LAST,
           -- Then by last login
           u.last_login DESC NULLS LAST,
           -- Then by creation
           u.created_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, parseInt(limit), offset],
      ),
      query(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`, params),
    ]);

    const total = parseInt(countRes.rows[0]?.total || 0);

    res.json({
      success: true,
      data: dataRes.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── START CONVERSATION WITH SPECIFIC USER (admin initiates) ─────────────────

// POST /api/messages/start-with-user
router.post("/start-with-user", adminProtect, async (req, res) => {
  try {
    const { userId, message, subject } = req.body;
    const admin = req.adminUser;

    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "userId required" });
    if (!message?.trim())
      return res
        .status(400)
        .json({ success: false, message: "Message required" });

    // Get user info
    const userRes = await query(
      `SELECT id, email, full_name, avatar_url FROM users WHERE id = $1`,
      [userId],
    );
    if (!userRes.rows[0]) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    const user = userRes.rows[0];

    // Check for existing open conversation with this user
    let convRes = await query(
      `SELECT * FROM conversations
        WHERE user_id = $1 AND status = 'open'
        ORDER BY updated_at DESC LIMIT 1`,
      [userId],
    );

    let conv;
    const sessionId = `admin-to-user-${userId}-${Date.now()}`;

    if (convRes.rows.length > 0) {
      // Reuse existing conversation
      conv = convRes.rows[0];
    } else {
      // Create new conversation
      const insertRes = await query(
        `INSERT INTO conversations
           (session_id, user_id, guest_name, guest_email,
            subject, channel, source, status, priority, assigned_admin)
         VALUES ($1, $2, $3, $4, $5, 'direct_message', 'admin_initiated', 'open', 'normal', $6)
         RETURNING *`,
        [
          sessionId,
          userId,
          user.full_name,
          user.email,
          subject || `Message from ${admin.full_name || "Admin"}`,
          admin.id,
        ],
      );
      conv = insertRes.rows[0];
    }

    // Save admin's message
    const msgRes = await query(
      `INSERT INTO messages
         (conversation_id, sender_type, sender_id, sender_name,
          sender_email, sender_avatar, body, msg_type, metadata, is_read)
       VALUES ($1, 'admin', $2, $3, $4, $5, $6, 'text', $7, false)
       RETURNING *`,
      [
        conv.id,
        admin.id,
        admin.full_name || admin.username || "Support",
        admin.email,
        admin.avatar_url || null,
        message.trim(),
        JSON.stringify({ source: "admin-direct", initiatedBy: admin.id }),
      ],
    );

    // Update conversation
    await query(
      `UPDATE conversations SET
         last_message    = $1,
         last_message_at = NOW(),
         first_message   = COALESCE(first_message, $1),
         unread_user     = unread_user + 1,
         assigned_admin  = COALESCE(assigned_admin, $2),
         updated_at      = NOW()
       WHERE id = $3`,
      [message.trim(), admin.id, conv.id],
    );

    // Emit via socket to the user if they're connected
    const socketBus = require("../utils/socketBus");
    const io = socketBus.getIO();
    if (io) {
      // Emit to user's session room
      io.to(`user:${userId}`).emit("msg:message", {
        id: msgRes.rows[0].id,
        conversationId: conv.id,
        senderType: "admin",
        senderId: admin.id,
        senderName: admin.full_name || "Support",
        senderAvatar: admin.avatar_url,
        body: message.trim(),
        msgType: "text",
        isRead: false,
        createdAt: msgRes.rows[0].created_at,
      });

      // Notify user about new conversation
      io.to(`user:${userId}`).emit("msg:new-conversation", {
        conversationId: conv.id,
        sessionId: conv.session_id,
        from: admin.full_name || "Support",
        preview: message.trim().slice(0, 60),
      });
    }

    res.status(201).json({
      success: true,
      data: {
        conversation: conv,
        message: msgRes.rows[0],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET CONVERSATION WITH USER (admin) ──────────────────────────────────────

// GET /api/messages/user/:userId/conversation
router.get("/user/:userId/conversation", adminProtect, async (req, res) => {
  try {
    const { userId } = req.params;

    // Find or report no conversation
    const convRes = await query(
      `SELECT c.*,
              u.full_name AS user_full_name,
              u.email     AS user_email,
              u.avatar_url AS user_avatar,
              u.is_active AS user_is_active,
              u.last_login AS user_last_login,
              u.auth_provider AS user_auth_provider,
              u.is_verified AS user_is_verified
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.user_id = $1
        ORDER BY c.updated_at DESC
        LIMIT 1`,
      [userId],
    );

    if (!convRes.rows[0]) {
      // No conversation yet — return user info so admin can start one
      const userRes = await query(
        `SELECT id, email, full_name, avatar_url, phone,
                auth_provider, is_verified, is_active, last_login
           FROM users WHERE id = $1`,
        [userId],
      );

      if (!userRes.rows[0]) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      return res.json({
        success: true,
        data: {
          conversation: null,
          user: userRes.rows[0],
          messages: [],
        },
      });
    }

    const conv = convRes.rows[0];

    // Get messages
    const msgsRes = await query(
      `SELECT * FROM messages
        WHERE conversation_id = $1 AND deleted = false
        ORDER BY created_at ASC
        LIMIT 200`,
      [conv.id],
    );

    // Mark user messages as read
    await query(
      `UPDATE messages SET is_read = true, read_at = NOW()
        WHERE conversation_id = $1 AND sender_type = 'user' AND is_read = false`,
      [conv.id],
    );
    await query(`UPDATE conversations SET unread_admin = 0 WHERE id = $1`, [
      conv.id,
    ]);

    res.json({
      success: true,
      data: {
        conversation: conv,
        user: {
          id: conv.user_id,
          email: conv.user_email,
          full_name: conv.user_full_name,
          avatar_url: conv.user_avatar,
          is_active: conv.user_is_active,
          last_login: conv.user_last_login,
          auth_provider: conv.user_auth_provider,
          is_verified: conv.user_is_verified,
        },
        messages: msgsRes.rows,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── EXISTING ROUTES (keep all from before) ─────────────────────────────────

router.post("/start", protect, ctrl.startConversation);
router.post("/start-guest", ctrl.startConversation);
router.post("/conversations/:id/reply", optionalAuth, ctrl.userReply);
router.get("/session/:sessionId", ctrl.getBySession);
router.post("/conversations/:id/read", optionalAuth, ctrl.markRead);
router.get("/conversations", adminProtect, ctrl.getConversations);
router.get("/conversations/:id", adminProtect, ctrl.getConversation);

router.get(
  "/conversations/:id/messages",
  (req, res, next) => {
    const jwt = require("jsonwebtoken");
    const token = (req.headers.authorization || "")
      .replace("Bearer ", "")
      .trim();
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type === "admin") req.adminUser = decoded;
      } catch {}
    }
    next();
  },
  ctrl.getMessages,
);

router.post("/conversations/:id/admin-reply", adminProtect, ctrl.adminReply);
router.patch(
  "/conversations/:id/status",
  adminProtect,
  ctrl.updateConversationStatus,
);
router.post(
  "/conversations/:id/admin-read",
  adminProtect,
  (req, res, next) => {
    req.adminUser = req.admin;
    next();
  },
  ctrl.markRead,
);
router.delete("/conversations/:id", adminProtect, ctrl.deleteConversation);
router.get("/stats", adminProtect, ctrl.getStats);

module.exports = router;
