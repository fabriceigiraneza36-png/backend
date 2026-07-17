// controllers/contactController.js
"use strict";

const { query }  = require("../config/db");
const { paginate } = require("../utils/helpers");
const {
  sendContactNotification,
  sendContactReply,
} = require("../utils/email");
const { notifyContactMessage } = require("./notificationsController");

/* ════════════════════════════════════════════════════════════════
   SERIALIZER
════════════════════════════════════════════════════════════════ */
const serializeMessage = (row) => ({
  id:                 row.id,
  fullName:           row.full_name,
  email:              row.email,
  phone:              row.phone,
  subject:            row.subject,
  message:            row.message,
  messagePreview:     row.message_preview,
  tripType:           row.trip_type,
  travelDate:         row.travel_date,
  numberOfTravelers:  row.number_of_travelers,
  source:             row.source,
  ipAddress:          row.ip_address,
  userAgent:          row.user_agent,
  referrerUrl:        row.referrer_url,
  status:             row.status,
  isRead:             row.is_read,
  isStarred:          row.is_starred,
  priority:           row.priority,
  assignedTo:         row.assigned_to,
  assignedAt:         row.assigned_at,
  respondedAt:        row.responded_at,
  responseNotes:      row.response_notes,
  tags:               row.tags || [],
  createdAt:          row.created_at,
  updatedAt:          row.updated_at,
  readAt:             row.read_at,
  archivedAt:         row.archived_at,
  replyCount:         parseInt(row.reply_count || 0, 10),
});

/* ════════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || "").trim());

const sanitise = (str, max = 500) =>
  typeof str === "string" ? str.trim().slice(0, max) : "";

const parseBool = (v) => {
  if (v === undefined || v === null) return undefined;
  return v === true || v === "true" || v === "1" || v === 1;
};

const safeInt = (v, fallback = null) => {
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
};

const detectPriority = (subject = "", message = "") => {
  const s = subject.toLowerCase();
  const m = message.toLowerCase();
  if (["urgent", "asap", "emergency"].some((w) => s.includes(w) || m.includes(w)))
    return "urgent";
  if (["honeymoon", "anniversary", "special occasion"].some((w) => m.includes(w)))
    return "high";
  return "normal";
};

const parseDate = (raw) => {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
};

/* ════════════════════════════════════════════════════════════════
   PUBLIC — CREATE CONTACT MESSAGE   POST /api/contact
════════════════════════════════════════════════════════════════ */
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};

    /* ── Field normalisation (camelCase + snake_case from frontend) ── */
    const name      = sanitise(body.full_name   || body.name      || "", 120);
    const email     = sanitise(body.email                          || "", 254).toLowerCase();
    const phone     = sanitise(body.phone                          || "",  30) || null;
    const subject   = sanitise(body.subject                        || "", 300) || null;
    const message   = sanitise(body.message                        || "", 5000);
    const tripType  = sanitise(body.trip_type   || body.tripType   || "",  80) || null;
    const rawDate   =          body.travel_date || body.travelDate || null;
    const travelers = safeInt( body.number_of_travelers || body.travelers);
    const source    = sanitise(body.source || "website",  60);

    /* ── Validation ── */
    const errs = [];
    if (!name    || name.length    < 2)   errs.push("Name must be at least 2 characters.");
    if (!email)                            errs.push("Email address is required.");
    else if (!isValidEmail(email))         errs.push("Please enter a valid email address.");
    if (!message || message.length < 20)  errs.push("Message must be at least 20 characters.");

    if (errs.length)
      return res.status(422).json({ error: errs[0], errors: errs });

    const priority    = detectPriority(subject || "", message);
    const travelDate  = parseDate(rawDate);
    const ipAddress   = req.ip || req.connection?.remoteAddress || null;
    const userAgent   = (req.get("User-Agent") || "").slice(0, 500) || null;
    const referrerUrl = (req.get("Referer")    || "").slice(0, 500) || null;

    const result = await query(
      `INSERT INTO contact_messages (
         full_name, email, phone, subject, message,
         trip_type, travel_date, number_of_travelers,
         source, ip_address, user_agent, referrer_url, priority
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        name, email, phone, subject, message,
        tripType, travelDate, travelers,
        source, ipAddress, userAgent, referrerUrl, priority,
      ],
    );

    const saved = result.rows[0];

    /* ── Non-blocking email notification ── */
    sendContactNotification(saved).catch((err) =>
      console.error("[Contact] Notification email failed:", err.message),
    );

    /* ── Link to live chat conversation (so admin replies appear in the
           user's messaging portal) ── */
    const sessionId = (body.sessionId || "").trim();
    if (sessionId) {
      try {
        const io       = req.app?.get?.("io");
        const userId   = req.user?.id ?? null;

        const existing = await query(
          `SELECT * FROM conversations WHERE session_id = $1 LIMIT 1`,
          [sessionId],
        );

        let conv = existing.rows[0];
        if (!conv) {
          const ins = await query(
            `INSERT INTO conversations
               (session_id, user_id, guest_name, guest_email, channel, source, status)
             VALUES ($1,$2,$3,$4,'live_chat','contact_form','open')
             RETURNING *`,
            [sessionId, userId, name, email],
          );
          conv = ins.rows[0];
        } else {
          await query(
            `UPDATE conversations SET
               guest_name  = COALESCE(NULLIF($2,''), guest_name),
               guest_email = COALESCE(NULLIF($3,''), guest_email),
               updated_at  = NOW()
             WHERE id = $1`,
            [conv.id, name, email],
          ).catch(() => {});
        }

        const msgRes = await query(
          `INSERT INTO messages
             (conversation_id, sender_type, sender_id, sender_name, sender_email, body, is_read, metadata)
           VALUES ($1,'user',$2,$3,$4,$5,false,'{"source":"contact_form"}')
           RETURNING *`,
          [conv.id, userId, name, email, message],
        );

        await query(
          `UPDATE conversations SET
             last_message    = $1,
             last_message_at = NOW(),
             unread_admin    = unread_admin + 1,
             updated_at      = NOW()
           WHERE id = $2`,
          [message, conv.id],
        ).catch(() => {});

        if (io) {
          io.to("admins").emit("msg:user-registered", {
            conversationId: conv.id,
            sessionId:      conv.session_id,
            guestName:      name,
            guestEmail:     email,
            status:         conv.status,
            lastMessage:    message,
          });
          io.to("admins").emit("msg:new-from-user", {
            conversationId: conv.id,
            sessionId:      conv.session_id,
            message: {
              id: msgRes.rows[0].id,
              conversationId: conv.id,
              sessionId: conv.session_id,
              body: message,
              senderType: "user",
              senderName: name,
              senderEmail: email,
              isRead: false,
              createdAt: msgRes.rows[0].created_at,
            },
            senderName: name,
            senderEmail: email,
            unreadCount: 1,
          });
        }
      } catch (linkErr) {
        // Linking failure must never break contact submission
        console.error("[Contact] conversation link failed:", linkErr.message);
      }
    }

    /* ── In-app + admin notification ── */
    notifyContactMessage(
      { subject },
      { id: req.user?.id ?? null, email, name },
    ).catch(() => {});

    return res.status(201).json({
      success: true,
      message: "Thank you! Our team will respond within 24 hours.",
      data: { id: saved.id, createdAt: saved.created_at },
    });
  } catch (err) {
    console.error("[Contact] create error:", err);
    next(err);
  }
};

/* ════════════════════════════════════════════════════════════════
   ADMIN — GET ALL MESSAGES   GET /api/contact
════════════════════════════════════════════════════════════════ */
exports.getAll = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 20,
      status, priority,
      search, sort = "newest",
      from_date, to_date, assigned_to,
    } = req.query;

    const is_read    = parseBool(req.query.is_read    ?? req.query.isRead);
    const is_starred = parseBool(req.query.is_starred ?? req.query.isStarred);

    let where  = "WHERE 1=1";
    const params = [];
    let   idx    = 1;

    const push = (clause, val) => {
      where += ` ${clause.replace("?", `$${idx++}`)}`;
      params.push(val);
    };

    if (status      && status   !== "all") push("AND status = ?",      status);
    if (priority    && priority !== "all") push("AND priority = ?",     priority);
    if (is_read     !== undefined)         push("AND is_read = ?",      is_read);
    if (is_starred  !== undefined)         push("AND is_starred = ?",   is_starred);
    if (assigned_to)                       push("AND assigned_to = ?",  safeInt(assigned_to));
    if (from_date)                         push("AND created_at >= ?",  from_date);
    if (to_date)                           push("AND created_at <= ?",  `${to_date} 23:59:59`);

    if (search && search.trim()) {
      where += ` AND (
        full_name ILIKE $${idx} OR email ILIKE $${idx} OR
        subject   ILIKE $${idx} OR message ILIKE $${idx} OR
        phone     ILIKE $${idx}
      )`;
      params.push(`%${search.trim()}%`);
      idx++;
    }

    const ORDER = {
      oldest:   "created_at ASC",
      priority: `CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END ASC, created_at DESC`,
      unread:   "is_read ASC, created_at DESC",
      newest:   "created_at DESC",
    };
    const orderBy = ORDER[sort] || ORDER.newest;

    const countRes = await query(
      `SELECT COUNT(*) FROM contact_messages ${where}`, params,
    );
    const pagination = paginate(parseInt(countRes.rows[0].count, 10), page, limit);

    params.push(pagination.limit, pagination.offset);

    const result = await query(
      `SELECT
         cm.*,
         LEFT(cm.message, 150) ||
           CASE WHEN LENGTH(cm.message) > 150 THEN '...' ELSE '' END AS message_preview,
         (SELECT COUNT(*) FROM contact_replies cr WHERE cr.message_id = cm.id) AS reply_count
       FROM contact_messages cm
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    return res.json({
      data:       result.rows.map(serializeMessage),
      pagination,
    });
  } catch (err) {
    next(err);
  }
};

/* ════════════════════════════════════════════════════════════════
   ADMIN — GET SINGLE MESSAGE   GET /api/contact/:id
════════════════════════════════════════════════════════════════ */
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT cm.*,
         (SELECT COUNT(*) FROM contact_replies cr WHERE cr.message_id = cm.id) AS reply_count
       FROM contact_messages cm WHERE cm.id = $1`,
      [id],
    );

    if (!result.rows.length)
      return res.status(404).json({ error: "Message not found." });

    const repliesRes = await query(
      `SELECT * FROM contact_replies WHERE message_id = $1 ORDER BY created_at ASC`,
      [id],
    );

    /* Auto mark-read */
    if (!result.rows[0].is_read) {
      await query(
        `UPDATE contact_messages
           SET is_read = true, read_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id],
      );
      result.rows[0].is_read = true;
      result.rows[0].read_at = new Date();
    }

    return res.json({
      data: {
        ...serializeMessage(result.rows[0]),
        replies: repliesRes.rows.map((r) => ({
          id:           r.id,
          subject:      r.subject,
          body:         r.body,
          sentBy:       r.sent_by,
          sentByName:   r.sent_by_name,
          sentByEmail:  r.sent_by_email,
          status:       r.status,
          sentAt:       r.sent_at,
          createdAt:    r.created_at,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ════════════════════════════════════════════════════════════════
   ADMIN — UPDATE MESSAGE   PUT /api/contact/:id
════════════════════════════════════════════════════════════════ */
exports.update = async (req, res, next) => {
  try {
    const { id }  = req.params;
    const body    = req.body || {};
    const sets    = [];
    const values  = [];
    let   idx     = 1;

    const push = (expr, val) => {
      sets.push(expr.replace("?", `$${idx++}`));
      values.push(val);
    };

    if (body.status !== undefined) {
      push("status = ?", body.status);
      if (body.status === "archived") sets.push("archived_at = CURRENT_TIMESTAMP");
    }

    const readVal = parseBool(body.is_read ?? body.isRead);
    if (readVal !== undefined) {
      push("is_read = ?", readVal);
      if (readVal) sets.push("read_at = CURRENT_TIMESTAMP");
      else         sets.push("read_at = NULL");
    }

    const starredVal = parseBool(body.is_starred ?? body.isStarred);
    if (starredVal !== undefined) push("is_starred = ?", starredVal);

    if (body.priority        !== undefined) push("priority = ?",        body.priority);
    if (body.assigned_to     !== undefined) {
      push("assigned_to = ?", body.assigned_to);
      sets.push("assigned_at = CURRENT_TIMESTAMP");
    }
    if (body.response_notes  !== undefined) push("response_notes = ?",  body.response_notes);
    if (body.tags            !== undefined) push("tags = ?",            body.tags);

    if (!sets.length)
      return res.status(400).json({ error: "No fields to update." });

    values.push(id);
    const result = await query(
      `UPDATE contact_messages SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values,
    );

    if (!result.rows.length)
      return res.status(404).json({ error: "Message not found." });

    return res.json({ data: serializeMessage(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

/* ════════════════════════════════════════════════════════════════
   ADMIN — QUICK PATCH HELPERS
════════════════════════════════════════════════════════════════ */
const patchOne = (sql) => async (req, res, next) => {
  try {
    const result = await query(`${sql} WHERE id = $1 RETURNING *`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Message not found." });
    return res.json({ data: serializeMessage(result.rows[0]) });
  } catch (err) { next(err); }
};

exports.markRead   = patchOne(
  "UPDATE contact_messages SET is_read = true, read_at = CURRENT_TIMESTAMP, status = CASE WHEN status = 'new' THEN 'read' ELSE status END",
);
exports.markUnread = patchOne(
  "UPDATE contact_messages SET is_read = false, read_at = NULL",
);
exports.toggleStar = patchOne(
  "UPDATE contact_messages SET is_starred = NOT is_starred",
);
exports.archive    = patchOne(
  "UPDATE contact_messages SET status = 'archived', archived_at = CURRENT_TIMESTAMP",
);
exports.markSpam   = patchOne(
  "UPDATE contact_messages SET status = 'spam'",
);

/* ════════════════════════════════════════════════════════════════
   ADMIN — BULK UPDATE   POST /api/contact/bulk
════════════════════════════════════════════════════════════════ */
exports.bulkUpdate = async (req, res, next) => {
  try {
    const { ids, action, value } = req.body;

    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ error: "ids[] is required." });
    if (!action)
      return res.status(400).json({ error: "action is required." });

    const SQL_MAP = {
      markRead:   "UPDATE contact_messages SET is_read = true, read_at = CURRENT_TIMESTAMP WHERE id = ANY($1)",
      markUnread: "UPDATE contact_messages SET is_read = false, read_at = NULL WHERE id = ANY($1)",
      archive:    "UPDATE contact_messages SET status = 'archived', archived_at = CURRENT_TIMESTAMP WHERE id = ANY($1)",
      spam:       "UPDATE contact_messages SET status = 'spam' WHERE id = ANY($1)",
      delete:     "DELETE FROM contact_messages WHERE id = ANY($1)",
      setPriority:"UPDATE contact_messages SET priority = $2 WHERE id = ANY($1)",
      assignTo:   "UPDATE contact_messages SET assigned_to = $2, assigned_at = CURRENT_TIMESTAMP WHERE id = ANY($1)",
    };

    if (!SQL_MAP[action])
      return res.status(400).json({ error: `Unknown action: ${action}` });

    if ((action === "setPriority" || action === "assignTo") && value === undefined)
      return res.status(400).json({ error: `value is required for action "${action}".` });

    const params  = action === "setPriority" || action === "assignTo"
      ? [ids, value]
      : [ids];

    const result = await query(SQL_MAP[action] + " RETURNING id", params);

    return res.json({
      message:    `Updated ${result.rowCount} message(s).`,
      updatedIds: result.rows.map((r) => r.id),
      count:      result.rowCount,
    });
  } catch (err) {
    next(err);
  }
};

/* ════════════════════════════════════════════════════════════════
   ADMIN — REPLY   POST /api/contact/:id/reply
════════════════════════════════════════════════════════════════ */
exports.reply = async (req, res, next) => {
  try {
    const { id }        = req.params;
    const { subject, body } = req.body;

    if (!body?.trim())
      return res.status(400).json({ error: "Reply body is required." });

    const msgResult = await query(
      "SELECT * FROM contact_messages WHERE id = $1", [id],
    );
    if (!msgResult.rows.length)
      return res.status(404).json({ error: "Message not found." });

    const original   = msgResult.rows[0];
    const adminId    = req.user?.id   || null;
    const adminName  = req.user?.full_name || req.user?.name || "Safari Team";
    const adminEmail = req.user?.email || process.env.EMAIL_FROM || process.env.SMTP_USER;
    const replySubj  = subject || `Re: ${original.subject || "Your inquiry"}`;

    const replyResult = await query(
      `INSERT INTO contact_replies
         (message_id, subject, body, sent_by, sent_by_name, sent_by_email, status, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,'sent',CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, replySubj, body.trim(), adminId, adminName, adminEmail],
    );

    await query(
      `UPDATE contact_messages
         SET status = 'replied', responded_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id],
    );

    /* Non-blocking email */
    sendContactReply({
      to:              original.email,
      toName:          original.full_name,
      subject:         replySubj,
      body:            body.trim(),
      originalMessage: original.message,
      fromName:        adminName,
      fromEmail:       adminEmail,
    }).catch((err) =>
      console.error("[Contact] Reply email failed:", err.message),
    );

    return res.status(201).json({
      message: "Reply sent successfully.",
      data: {
        id:     replyResult.rows[0].id,
        sentAt: replyResult.rows[0].sent_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ════════════════════════════════════════════════════════════════
   ADMIN — STATS   GET /api/contact/stats
════════════════════════════════════════════════════════════════ */
exports.getStats = async (req, res, next) => {
  try {
    /* Try stats view first, fall back to manual aggregation */
    let stats = {};
    try {
      const r = await query("SELECT * FROM v_contact_stats LIMIT 1");
      stats   = r.rows[0] || {};
    } catch {
      const r = await query(`
        SELECT
          COUNT(*)                                            AS total_messages,
          COUNT(*) FILTER (WHERE status  = 'new')            AS new_messages,
          COUNT(*) FILTER (WHERE is_read = false)            AS unread_messages,
          COUNT(*) FILTER (WHERE status  = 'replied')        AS replied_messages,
          COUNT(*) FILTER (WHERE status  = 'archived')       AS archived_messages,
          COUNT(*) FILTER (WHERE status  = 'spam')           AS spam_messages,
          COUNT(*) FILTER (WHERE priority = 'urgent')        AS urgent_messages,
          COUNT(*) FILTER (WHERE priority = 'high')          AS high_priority_messages,
          COUNT(*) FILTER (WHERE is_starred = true)          AS starred_messages,
          COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)        AS today_messages,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - 7)         AS week_messages,
          COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())) AS month_messages,
          AVG(EXTRACT(EPOCH FROM (responded_at - created_at))/3600)
            FILTER (WHERE responded_at IS NOT NULL)          AS avg_response_hours
        FROM contact_messages
      `);
      stats = r.rows[0] || {};
    }

    const [dailyRes, sourceRes, tripRes] = await Promise.all([
      query(`
        SELECT DATE(created_at) AS date, COUNT(*) AS count
        FROM contact_messages
        WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY DATE(created_at) ORDER BY date ASC
      `),
      query(`
        SELECT source, COUNT(*) AS count
        FROM contact_messages
        GROUP BY source ORDER BY count DESC
      `),
      query(`
        SELECT trip_type, COUNT(*) AS count
        FROM contact_messages
        WHERE trip_type IS NOT NULL
        GROUP BY trip_type ORDER BY count DESC LIMIT 10
      `),
    ]);

    return res.json({
      data: {
        overview: {
          total:       parseInt(stats.total_messages    || 0, 10),
          new:         parseInt(stats.new_messages      || 0, 10),
          unread:      parseInt(stats.unread_messages   || 0, 10),
          replied:     parseInt(stats.replied_messages  || 0, 10),
          archived:    parseInt(stats.archived_messages || 0, 10),
          spam:        parseInt(stats.spam_messages     || 0, 10),
          urgent:      parseInt(stats.urgent_messages   || 0, 10),
          highPriority:parseInt(stats.high_priority_messages || 0, 10),
          starred:     parseInt(stats.starred_messages  || 0, 10),
        },
        timeframe: {
          today:     parseInt(stats.today_messages || 0, 10),
          thisWeek:  parseInt(stats.week_messages  || 0, 10),
          thisMonth: parseInt(stats.month_messages || 0, 10),
        },
        performance: {
          avgResponseHours: stats.avg_response_hours
            ? parseFloat(stats.avg_response_hours).toFixed(1) : null,
        },
        dailyTrend: dailyRes.rows.map((r) => ({ date: r.date, count: parseInt(r.count, 10) })),
        bySource:   sourceRes.rows.map((r) => ({ source: r.source, count: parseInt(r.count, 10) })),
        byTripType: tripRes.rows.map((r) => ({ tripType: r.trip_type, count: parseInt(r.count, 10) })),
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ════════════════════════════════════════════════════════════════
   ADMIN — DELETE   DELETE /api/contact/:id
════════════════════════════════════════════════════════════════ */
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;

    await query("DELETE FROM contact_replies WHERE message_id = $1", [id]);

    const result = await query(
      "DELETE FROM contact_messages WHERE id = $1 RETURNING id, full_name, email", [id],
    );
    if (!result.rows.length)
      return res.status(404).json({ error: "Message not found." });

    return res.json({ message: "Message deleted.", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

/* ════════════════════════════════════════════════════════════════
   ADMIN — EXPORT   GET /api/contact/export
════════════════════════════════════════════════════════════════ */
exports.export = async (req, res, next) => {
  try {
    const { format = "json", from_date, to_date, status } = req.query;

    let where  = "WHERE 1=1";
    const params = [];
    let   idx    = 1;

    if (from_date) { where += ` AND created_at >= $${idx++}`; params.push(from_date); }
    if (to_date)   { where += ` AND created_at <= $${idx++}`; params.push(`${to_date} 23:59:59`); }
    if (status && status !== "all") {
      where += ` AND status = $${idx++}`;
      params.push(status);
    }

    const result = await query(
      `SELECT * FROM contact_messages ${where} ORDER BY created_at DESC`, params,
    );

    if (format === "csv") {
      const HEADERS = [
        "ID","Full Name","Email","Phone","Subject","Message",
        "Trip Type","Travel Date","Travelers","Status","Priority",
        "Created At","Read At","Responded At",
      ];

      const q = (s) => `"${String(s || "").replace(/"/g, '""').slice(0, 500)}"`;

      const rows = [HEADERS.join(","), ...result.rows.map((r) =>
        [
          r.id, q(r.full_name), r.email, r.phone || "",
          q(r.subject), q(r.message), r.trip_type || "",
          r.travel_date || "", r.number_of_travelers || "",
          r.status, r.priority, r.created_at,
          r.read_at || "", r.responded_at || "",
        ].join(","),
      )];

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="contacts-${new Date().toISOString().split("T")[0]}.csv"`,
      );
      return res.send(rows.join("\n"));
    }

    return res.json({
      data:       result.rows.map(serializeMessage),
      count:      result.rows.length,
      exportedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};