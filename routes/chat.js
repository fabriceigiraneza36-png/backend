// routes/message.js  — replaces existing messageRouter
// Handles both /api/messages and /api/chat (unified)
"use strict";

const router     = require("express").Router();
const { protect, adminOnly } = require("../middleware/auth");
const { query }  = require("../config/db");

/* ══════════════════════════════════════════════════════════════
   SERIALISERS
══════════════════════════════════════════════════════════════ */
const serializeConv = (row) => ({
  id:            row.id,
  sessionId:     row.session_id,
  userId:        row.user_id        ?? null,
  guestName:     row.guest_name     ?? row.user_full_name ?? null,
  guestEmail:    row.guest_email    ?? row.user_email     ?? null,
  userAvatar:    row.user_avatar    ?? null,
  channel:       row.channel        ?? "live_chat",
  status:        row.status         ?? "open",
  priority:      row.priority       ?? "normal",
  assignedAdmin: row.assigned_admin ?? null,
  lastMessage:   row.last_message   ?? null,
  lastMessageAt: row.last_message_at ?? null,
  unreadAdmin:   parseInt(row.unread_admin ?? 0, 10),
  unreadUser:    parseInt(row.unread_user  ?? 0, 10),
  tags:          row.tags           ?? [],
  source:        row.source         ?? null,
  deletedAt:     row.deleted_at     ?? null,
  deletedBy:     row.deleted_by     ?? null,
  createdAt:     row.created_at,
  updatedAt:     row.updated_at,
});

const serializeMsg = (row) => ({
  id:             row.id,
  conversationId: row.conversation_id,
  sessionId:      row.session_id ?? null,   // joined from conv
  senderType:     row.sender_type,
  senderId:       row.sender_id    ?? null,
  senderName:     row.sender_name  ?? null,
  senderEmail:    row.sender_email ?? null,
  senderAvatar:   row.sender_avatar ?? null,
  body:           row.body,
  msgType:        row.msg_type     ?? "text",
  isRead:         Boolean(row.is_read),
  isEdited:       Boolean(row.edited),
  isDeleted:      Boolean(row.deleted),
  replyToId:      row.reply_to_id  ?? null,
  metadata:       row.metadata     ?? {},
  createdAt:      row.created_at,
});

/* ══════════════════════════════════════════════════════════════
   EMIT HELPER — sends to all rooms a user might be in
══════════════════════════════════════════════════════════════ */
const broadcastToConv = (req, conv, event, payload) => {
  const io = req.app.get("io");
  if (!io) return;
  try {
    // Room 1: conv room (socket joins this on msg:register)
    io.to(`conv:${conv.id}`).emit(event, payload);
    // Room 2: session room (MessagingContext joins this)
    if (conv.session_id) {
      io.to(`session:${conv.session_id}`).emit(event, payload);
    }
    // Room 3: user room (authenticated users)
    if (conv.user_id) {
      io.to(`user-${conv.user_id}`).emit(event, payload);
    }
    // Room 4: all admins for sidebar updates
    if (event !== "msg:message") return;
    io.to("admins").emit("msg:new-from-user", {
      conversationId: conv.id,
      sessionId:      conv.session_id,
      message:        payload,
    });
  } catch (err) {
    console.error("[broadcastToConv]", err.message);
  }
};

/* ══════════════════════════════════════════════════════════════
   LOOK UP CONVERSATION — by id, sessionId, or userId
══════════════════════════════════════════════════════════════ */
const findConv = async (identifier) => {
  let row = null;

  // numeric id
  if (/^\d+$/.test(String(identifier))) {
    const r = await query(
      `SELECT c.*, u.full_name AS user_full_name, u.email AS user_email,
              u.avatar_url AS user_avatar
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.id = $1 LIMIT 1`,
      [parseInt(identifier, 10)],
    );
    row = r.rows[0] ?? null;
  }

  // session_id string
  if (!row) {
    const r = await query(
      `SELECT c.*, u.full_name AS user_full_name, u.email AS user_email,
              u.avatar_url AS user_avatar
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.session_id = $1 LIMIT 1`,
      [String(identifier)],
    );
    row = r.rows[0] ?? null;
  }

  return row;
};

/* ══════════════════════════════════════════════════════════════
   1. GET /api/messages/conversations — Admin list
══════════════════════════════════════════════════════════════ */
router.get("/conversations", protect, adminOnly, async (req, res, next) => {
  try {
    const {
      status = "open", search, page = 1, limit = 30, sort = "updated_at",
    } = req.query;

    let where  = "WHERE 1=1";
    const params = [];
    let   idx    = 1;

    // Trash handling: only show deleted items when explicitly requested
    if (req.query.trash === "1" || req.query.trash === "true") {
      where += " AND c.deleted_at IS NOT NULL";
    } else {
      where += " AND c.deleted_at IS NULL";
    }

    if (status && status !== "all") {
      where += ` AND c.status = $${idx++}`;
      params.push(status);
    }

    if (search?.trim()) {
      where += ` AND (
        COALESCE(c.guest_name,'')  ILIKE $${idx}
        OR COALESCE(c.guest_email,'') ILIKE $${idx}
        OR COALESCE(u.full_name,'')   ILIKE $${idx}
        OR COALESCE(u.email,'')       ILIKE $${idx}
        OR COALESCE(c.last_message,'') ILIKE $${idx}
      )`;
      params.push(`%${search.trim()}%`);
      idx++;
    }

    const safeSort = ["updated_at", "created_at", "unread_admin"].includes(sort)
      ? sort : "updated_at";

    const countRes = await query(
      `SELECT COUNT(*) FROM conversations c LEFT JOIN users u ON u.id=c.user_id ${where}`,
      params,
    );
    const total  = parseInt(countRes.rows[0].count, 10);
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    params.push(parseInt(limit, 10), offset);
    const result = await query(
      `SELECT c.*,
              u.full_name AS user_full_name,
              u.email     AS user_email,
              u.avatar_url AS user_avatar
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
        ${where}
        ORDER BY c.${safeSort} DESC
        LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    return res.json({
      success: true,
      data:    result.rows.map(serializeConv),
      meta:    { total, page: parseInt(page, 10), pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   2. GET /api/messages/conversations/:id — Single conversation
══════════════════════════════════════════════════════════════ */
router.get("/conversations/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const conv = await findConv(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });

    const msgs = await query(
      `SELECT m.*, c.session_id
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = $1 AND m.deleted = false
        ORDER BY m.created_at ASC LIMIT 200`,
      [conv.id],
    );

    return res.json({
      success: true,
      data: {
        ...serializeConv(conv),
        messages: msgs.rows.map(serializeMsg),
      },
    });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   3. GET /api/messages/conversations/:id/messages
══════════════════════════════════════════════════════════════ */
router.get("/conversations/:id/messages", protect, adminOnly, async (req, res, next) => {
  try {
    const conv = await findConv(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });

    // Mark user messages as read when admin opens
    await query(
      `UPDATE messages SET is_read=true, read_at=NOW()
        WHERE conversation_id=$1 AND sender_type!='admin' AND is_read=false`,
      [conv.id],
    ).catch(() => {});
    await query(
      `UPDATE conversations SET unread_admin=0 WHERE id=$1`, [conv.id],
    ).catch(() => {});

    const msgs = await query(
      `SELECT m.*, c.session_id
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = $1 AND m.deleted = false
        ORDER BY m.created_at ASC`,
      [conv.id],
    );

    return res.json({ success: true, data: msgs.rows.map(serializeMsg) });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   4. POST /api/messages/conversations/:id/admin-reply
   Admin sends a message via HTTP → stored → broadcast via socket
══════════════════════════════════════════════════════════════ */
router.post("/conversations/:id/admin-reply", protect, adminOnly, async (req, res, next) => {
  try {
    const conv = await findConv(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });

    const body = (req.body.body || req.body.message || "").trim();
    if (!body) return res.status(422).json({ error: "Message body is required." });

    const admin = req.user;

    const result = await query(
      `INSERT INTO messages
         (conversation_id, sender_type, sender_id, sender_name,
          sender_email, body, metadata, is_read)
       VALUES ($1,'admin',$2,$3,$4,$5,$6,false)
       RETURNING *`,
      [
        conv.id,
        admin.id       ?? null,
        admin.full_name || admin.name || "Support",
        admin.email    ?? null,
        body,
        JSON.stringify({ source: "admin-http", ...req.body.metadata }),
      ],
    );

    const saved = result.rows[0];

    // Update conversation counters
    await query(
      `UPDATE conversations SET
         last_message    = $1,
         last_message_at = NOW(),
         unread_user     = unread_user + 1,
         updated_at      = NOW()
       WHERE id = $2`,
      [body, conv.id],
    ).catch(() => {});

    const serialized = { ...serializeMsg(saved), sessionId: conv.session_id };

    // Broadcast to user widget + admin sidebar
    broadcastToConv(req, conv, "msg:message", serialized);

    // Also emit via legacy chat:message for backward compat
    const io = req.app.get("io");
    if (io && conv.session_id) {
      io.to(`chat:${conv.session_id}`).emit("chat:message", serialized);
      io.to(`session:${conv.session_id}`).emit("message", serialized);
    }

    return res.status(201).json({ success: true, data: serialized });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   5. POST /api/messages/conversations/:id/admin-read
══════════════════════════════════════════════════════════════ */
router.post("/conversations/:id/admin-read", protect, adminOnly, async (req, res, next) => {
  try {
    const conv = await findConv(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });

    await Promise.all([
      query(
        `UPDATE messages SET is_read=true, read_at=NOW()
          WHERE conversation_id=$1 AND sender_type!='admin' AND is_read=false`,
        [conv.id],
      ),
      query(`UPDATE conversations SET unread_admin=0 WHERE id=$1`, [conv.id]),
    ]);

    // Tell user widget their messages were read
    broadcastToConv(req, conv, "msg:read", {
      conversationId: conv.id,
      sessionId:      conv.session_id,
      readBy:         "admin",
    });

    return res.json({ success: true });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   6. PATCH /api/messages/conversations/:id/status
══════════════════════════════════════════════════════════════ */
router.patch("/conversations/:id/status", protect, adminOnly, async (req, res, next) => {
  try {
    const conv = await findConv(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });

    const { status, priority } = req.body;
    const allowed = { status: ["open","closed","archived"], priority: ["low","normal","high","urgent"] };

    const sets   = [];
    const params = [];
    let   idx    = 1;

    if (status && allowed.status.includes(status)) {
      sets.push(`status=$${idx++}`); params.push(status);
      if (status === "closed") sets.push("closed_at=NOW()");
    }
    if (priority && allowed.priority.includes(priority)) {
      sets.push(`priority=$${idx++}`); params.push(priority);
    }
    if (!sets.length) return res.status(422).json({ error: "No valid fields." });

    sets.push("updated_at=NOW()");
    params.push(conv.id);

    const r = await query(
      `UPDATE conversations SET ${sets.join(",")} WHERE id=$${idx} RETURNING *`,
      params,
    );

    const updated = serializeConv({ ...r.rows[0], session_id: conv.session_id });

    // Notify user widget + admin sidebar
    broadcastToConv(req, conv, "msg:conversation-updated", updated);
    const io = req.app.get("io");
    if (io) io.to("admins").emit("msg:conversation-updated", updated);

    return res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   7d. DELETE /api/messages/conversations/trash (empty trash)
   Permanently deletes every trashed conversation.
   Registered BEFORE /conversations/:id so "trash" is not treated as an id.
   ══════════════════════════════════════════════════════════════ */
router.delete("/conversations/trash", protect, adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id FROM conversations WHERE deleted_at IS NOT NULL`);
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await query(`DELETE FROM messages WHERE conversation_id = ANY($1)`, [ids]);
      await query(`DELETE FROM conversations WHERE id = ANY($1)`, [ids]);
    }

    const io = req.app.get("io");
    if (io) io.to("admins").emit("msg:conversations-bulk-updated", { ids, action: "delete" });

    return res.json({ success: true, count: ids.length, message: `Emptied trash (${ids.length} deleted).` });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   7. DELETE /api/messages/conversations/:id
   Soft-deletes (moves to trash) by default. Pass ?permanent=true
   to hard-delete.
   ══════════════════════════════════════════════════════════════ */
router.delete("/conversations/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const conv = await findConv(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });

    const permanent = req.query.permanent === "true" || req.query.permanent === "1";

    if (permanent) {
      await query(`DELETE FROM messages     WHERE conversation_id=$1`, [conv.id]);
      await query(`DELETE FROM conversations WHERE id=$1`,             [conv.id]);
      return res.json({ success: true, message: "Conversation permanently deleted." });
    }

    await query(
      `UPDATE conversations SET deleted_at=$1, deleted_by=$2, updated_at=NOW() WHERE id=$3`,
      [new Date(), req.user?.id ?? null, conv.id],
    );

    const io = req.app.get("io");
    if (io) io.to("admins").emit("msg:conversation-updated", {
      conversationId: conv.id, deletedAt: new Date().toISOString(),
    });

    return res.json({ success: true, message: "Conversation moved to trash." });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   7b. PATCH /api/messages/conversations/:id/restore
   Restores a soft-deleted (trashed) conversation
   ══════════════════════════════════════════════════════════════ */
router.patch("/conversations/:id/restore", protect, adminOnly, async (req, res, next) => {
  try {
    const conv = await findConv(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });

    const r = await query(
      `UPDATE conversations SET deleted_at=NULL, deleted_by=NULL, updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [conv.id],
    );

    const io = req.app.get("io");
    if (io) io.to("admins").emit("msg:conversation-updated", {
      conversationId: conv.id, deletedAt: null,
    });

    return res.json({ success: true, data: serializeConv({ ...r.rows[0], session_id: conv.session_id }) });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   7c. POST /api/messages/conversations/bulk
   Bulk actions across many conversations:
     action: "trash"   -> soft delete
     action: "restore" -> restore from trash
     action: "delete"  -> permanent delete
   ══════════════════════════════════════════════════════════════ */
router.post("/conversations/bulk", protect, adminOnly, async (req, res, next) => {
  try {
    const { ids, action } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(422).json({ error: "ids[] is required." });
    if (!["trash", "restore", "delete"].includes(action))
      return res.status(422).json({ error: "action must be 'trash', 'restore' or 'delete'." });

    let result;
    if (action === "trash") {
      result = await query(
        `UPDATE conversations SET deleted_at=NOW(), deleted_by=$2, updated_at=NOW()
          WHERE id = ANY($1) RETURNING id`,
        [ids, req.user?.id ?? null],
      );
    } else if (action === "restore") {
      result = await query(
        `UPDATE conversations SET deleted_at=NULL, deleted_by=NULL, updated_at=NOW()
          WHERE id = ANY($1) RETURNING id`,
        [ids],
      );
    } else {
      await query(`DELETE FROM messages WHERE conversation_id = ANY($1)`, [ids]);
      result = await query(`DELETE FROM conversations WHERE id = ANY($1) RETURNING id`, [ids]);
    }

    const io = req.app.get("io");
    if (io) io.to("admins").emit("msg:conversations-bulk-updated", { ids, action });

    return res.json({
      success:  true,
      action,
      count:    result.rowCount,
      message:  `${action === "delete" ? "Permanently deleted" : action === "restore" ? "Restored" : "Moved to trash"} ${result.rowCount} conversation(s).`,
    });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   8. GET /api/messages/stats
══════════════════════════════════════════════════════════════ */
router.get("/stats", protect, adminOnly, async (req, res, next) => {
  try {
    const [convStats, msgStats] = await Promise.all([
      query(`
        SELECT
          COUNT(*)                                          AS total,
          COUNT(*) FILTER (WHERE status='open')             AS open,
          COUNT(*) FILTER (WHERE status='closed')           AS closed,
          SUM(unread_admin)                                 AS total_unread,
          COUNT(*) FILTER (WHERE updated_at >= NOW()-'1 day'::interval) AS today
        FROM conversations
      `),
      query(`
        SELECT COUNT(*) AS total_messages,
               COUNT(*) FILTER (WHERE is_read=false AND sender_type!='admin') AS unread_messages
        FROM messages WHERE deleted=false
      `),
    ]);

    const c = convStats.rows[0];
    const m = msgStats.rows[0];

    return res.json({
      success: true,
      data: {
        conversations: {
          total:       parseInt(c.total        ?? 0, 10),
          open:        parseInt(c.open         ?? 0, 10),
          closed:      parseInt(c.closed       ?? 0, 10),
          totalUnread: parseInt(c.total_unread ?? 0, 10),
          today:       parseInt(c.today        ?? 0, 10),
        },
        messages: {
          total:   parseInt(m.total_messages   ?? 0, 10),
          unread:  parseInt(m.unread_messages  ?? 0, 10),
        },
      },
    });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   9. GET /api/messages/users — List registered users for "New Chat" modal
══════════════════════════════════════════════════════════════ */
router.get("/users", protect, adminOnly, async (req, res, next) => {
  try {
    const { search, limit = 50 } = req.query;
    let where  = "WHERE is_active = true";
    const params = [];

    if (search?.trim()) {
      where += ` AND (full_name ILIKE $1 OR email ILIKE $1)`;
      params.push(`%${search.trim()}%`);
    }

    params.push(parseInt(limit, 10));
    const r = await query(
      `SELECT id, full_name, email, avatar_url, is_active,
              last_login, created_at
         FROM users ${where}
         ORDER BY last_login DESC NULLS LAST
         LIMIT $${params.length}`,
      params,
    );

    return res.json({ success: true, data: r.rows });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   10. POST /api/messages/start-with-user
   Admin starts / reopens a conversation with a specific user
══════════════════════════════════════════════════════════════ */
router.post("/start-with-user", protect, adminOnly, async (req, res, next) => {
  try {
    const { userId, message } = req.body;
    if (!userId) return res.status(422).json({ error: "userId is required." });

    const userRes = await query(
      `SELECT id, full_name, email, avatar_url FROM users WHERE id=$1 LIMIT 1`,
      [userId],
    );
    if (!userRes.rows[0]) return res.status(404).json({ error: "User not found." });

    const u    = userRes.rows[0];
    const sid  = `user_${u.id}`;

    // Upsert conversation
    const existing = await query(
      `SELECT * FROM conversations WHERE session_id=$1 LIMIT 1`, [sid],
    );

    let conv;
    if (existing.rows[0]) {
      // Re-open if closed
      const r = await query(
        `UPDATE conversations
           SET status='open', updated_at=NOW()
         WHERE session_id=$1 RETURNING *`,
        [sid],
      );
      conv = r.rows[0];
    } else {
      const r = await query(
        `INSERT INTO conversations
           (session_id, user_id, guest_name, guest_email, channel, source, status)
         VALUES ($1,$2,$3,$4,'live_chat','admin-initiated','open')
         RETURNING *`,
        [sid, u.id, u.full_name, u.email],
      );
      conv = r.rows[0];
    }

    const admin = req.user;
    let   msgs  = [];

    if (message?.trim()) {
      const r = await query(
        `INSERT INTO messages
           (conversation_id, sender_type, sender_id, sender_name,
            sender_email, body, metadata, is_read)
         VALUES ($1,'admin',$2,$3,$4,$5,$6,false)
         RETURNING *`,
        [
          conv.id,
          admin.id ?? null,
          admin.full_name || admin.name || "Support",
          admin.email ?? null,
          message.trim(),
          JSON.stringify({ source: "admin-initiated" }),
        ],
      );
      await query(
        `UPDATE conversations SET
           last_message=$1, last_message_at=NOW(), unread_user=unread_user+1
         WHERE id=$2`,
        [message.trim(), conv.id],
      ).catch(() => {});

      const serialized = { ...serializeMsg(r.rows[0]), sessionId: conv.session_id };
      msgs = [serialized];

      // Push to user widget immediately
      const io = req.app.get("io");
      if (io) {
        io.to(`user-${u.id}`).emit("msg:message",  serialized);
        io.to(`session:${sid}`).emit("msg:message", serialized);
        io.to(`conv:${conv.id}`).emit("msg:message", serialized);
        // Legacy rooms
        io.to(`chat:${sid}`).emit("chat:message", serialized);
      }
    } else {
      const r = await query(
        `SELECT * FROM messages WHERE conversation_id=$1 AND deleted=false
          ORDER BY created_at ASC LIMIT 100`,
        [conv.id],
      );
      msgs = r.rows.map((m) => ({ ...serializeMsg(m), sessionId: conv.session_id }));
    }

    // Notify admin sidebar
    const io = req.app.get("io");
    if (io) {
      io.to("admins").emit("msg:user-registered", {
        conversationId: conv.id,
        sessionId:      conv.session_id,
        guestName:      u.full_name,
        guestEmail:     u.email,
        status:         conv.status,
      });
    }

    return res.status(201).json({
      success: true,
      data: {
        ...serializeConv({ ...conv, user_full_name: u.full_name, user_email: u.email, user_avatar: u.avatar_url }),
        messages: msgs,
      },
    });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   11. GET /api/messages/user/:userId/conversation
═══════════════════════════════════════════════════════════════ */
router.get("/user/:userId/conversation", protect, adminOnly, async (req, res, next) => {
  try {
    const sid = `user_${req.params.userId}`;
    const r   = await query(
      `SELECT c.*, u.full_name AS user_full_name, u.email AS user_email,
              u.avatar_url AS user_avatar
         FROM conversations c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.session_id=$1 OR c.user_id=$2
        ORDER BY c.updated_at DESC LIMIT 1`,
      [sid, parseInt(req.params.userId, 10)],
    );

    if (!r.rows[0]) return res.status(404).json({ error: "No conversation found." });

    const conv = r.rows[0];
    const msgs = await query(
      `SELECT * FROM messages WHERE conversation_id=$1 AND deleted=false
        ORDER BY created_at ASC LIMIT 200`,
      [conv.id],
    );

    return res.json({
      success: true,
      data: {
        ...serializeConv(conv),
        messages: msgs.rows.map(serializeMsg),
      },
    });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════════
   BRIDGE: /api/chat/* → unified conversations table
   Keeps old chatController routes working without code changes
══════════════════════════════════════════════════════════════ */
router.get("/sessions",               protect, adminOnly, async (req, res, next) => {
  // Proxy to /conversations
  req.url = "/conversations";
  return router.handle(req, res, next);
});

router.get("/history/:sessionId",     async (req, res, next) => {
  try {
    const conv = await findConv(req.params.sessionId);
    if (!conv) return res.status(404).json({ error: "Session not found." });

    const msgs = await query(
      `SELECT * FROM messages WHERE conversation_id=$1 AND deleted=false
        ORDER BY created_at ASC`,
      [conv.id],
    );
    return res.json({
      success: true,
      data: {
        session:  serializeConv(conv),
        messages: msgs.rows.map(serializeMsg),
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;