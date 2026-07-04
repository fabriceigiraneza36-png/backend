/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * NOTIFICATIONS CONTROLLER v1.0
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Handles:
 *   - Admin: create / broadcast / reply to user replies
 *   - User:  fetch inbox / mark read / react / reply / delete
 *   - System: internal helpers used by bookingsController
 *
 * Socket events emitted:
 *   notification:new      → user-{id} room  (individual)
 *   notification:new      → all-users room  (broadcast)
 *   notification:updated  → user-{id} room  (read/reaction/reply)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { query }  = require('../config/db');
const socketBus  = require('../utils/socketBus');
const logger     = require('../utils/logger');

/* ── Safe email import ─────────────────────────────────────────────────────── */
let sendEmail = null;
try {
  const eu = require('../utils/email');
  sendEmail = typeof eu.sendEmail === 'function' ? eu.sendEmail : null;
} catch { /* non-fatal */ }

/* ═══════════════════════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════════════════════ */

const VALID_TYPES = new Set([
  'booking_created', 'booking_updated', 'booking_confirmed',
  'booking_cancelled', 'booking_deleted',
  'new_destination', 'new_country', 'new_post', 'new_package',
  'promotion', 'system', 'warning', 'alert', 'general',
]);

const VALID_PRIORITIES  = new Set(['low', 'normal', 'high', 'urgent']);
const VALID_CATEGORIES  = new Set(['booking', 'content', 'account', 'marketing', 'system', 'general']);
const VALID_SCOPES      = new Set(['individual', 'all', 'role', 'segment']);
const VALID_REACTIONS   = new Set(['like', 'dislike']);

const safeInt = (v, def, min = 1, max = 9999) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

/* ═══════════════════════════════════════════════════════════════════════════════
   INTERNAL HELPER — emit to correct socket room(s)
═══════════════════════════════════════════════════════════════════════════════ */

const emitNotification = (notification) => {
  try {
    const io = socketBus.getIO();
    if (!io) return;

    const scope = notification.target_scope || 'individual';

    if (scope === 'all') {
      // Emit to every connected user room
      io.emit('notification:new', notification);
    } else if (scope === 'individual' && notification.user_id) {
      io.to(`user-${notification.user_id}`).emit('notification:new', notification);
    } else if (scope === 'role' && notification.target_role) {
      // Rooms by role are joined on connect — emit to role room
      io.to(`role-${notification.target_role}`).emit('notification:new', notification);
    }
  } catch (err) {
    logger.warn('[Notifications] emitNotification non-fatal:', err.message);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   INTERNAL API — used by bookingsController & other controllers
   Creates a notification and emits it. Never throws.
═══════════════════════════════════════════════════════════════════════════════ */

const createNotificationInternal = async ({
  userId,
  userEmail,
  type        = 'general',
  title,
  message,
  actionUrl,
  actionLabel,
  metadata    = {},
  targetScope = 'individual',
  priority    = 'normal',
  category    = 'general',
  senderType  = 'system',
  senderId    = null,
  senderName  = 'Altuvera',
  sendEmailNotif = false,
  expiresAt   = null,
}) => {
  try {
    const { rows } = await query(
      `INSERT INTO notifications (
          user_id, user_email,
          sender_type, sender_id, sender_name,
          type, title, message,
          action_url, action_label,
          metadata, target_scope, priority, category,
          expires_at, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW()
        ) RETURNING *`,
      [
        userId      || null,
        userEmail   || null,
        senderType,
        senderId    || null,
        senderName  || 'Altuvera',
        VALID_TYPES.has(type)           ? type     : 'general',
        String(title   || '').slice(0, 255),
        String(message || ''),
        actionUrl   || null,
        actionLabel || null,
        JSON.stringify(metadata),
        VALID_SCOPES.has(targetScope)   ? targetScope : 'individual',
        VALID_PRIORITIES.has(priority)  ? priority    : 'normal',
        VALID_CATEGORIES.has(category)  ? category    : 'general',
        expiresAt   || null,
      ],
    );

    const notif = rows[0];
    if (notif) emitNotification(notif);

    // Optional email notification
    if (sendEmailNotif && sendEmail && userEmail) {
      sendEmail({
        to:      userEmail,
        subject: title,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
            <h2 style="color:#059669;">${title}</h2>
            <p style="color:#374151;line-height:1.6;">${message}</p>
            ${actionUrl ? `
              <a href="${actionUrl}"
                 style="display:inline-block;margin-top:16px;padding:12px 24px;
                        background:#059669;color:#fff;border-radius:8px;
                        text-decoration:none;font-weight:600;">
                ${actionLabel || 'View Details'}
              </a>
            ` : ''}
            <p style="margin-top:24px;font-size:12px;color:#9ca3af;">
              Altuvera Travel — True Adventures In High Places & Deep Culture
            </p>
          </div>
        `,
      }).catch((e) => logger.warn('[Notifications] Email send non-fatal:', e.message));
    }

    return notif;
  } catch (err) {
    logger.error('[Notifications] createNotificationInternal failed:', err.message);
    return null;
  }
};

/* Export for use in bookingsController etc. */
exports.createNotificationInternal = createNotificationInternal;

/* ═══════════════════════════════════════════════════════════════════════════════
   ADMIN: CREATE / SEND NOTIFICATION
   POST /api/notifications
═══════════════════════════════════════════════════════════════════════════════ */

exports.create = async (req, res, next) => {
  try {
    const adminId   = req.admin?.id || req.user?.id;
    const adminName = req.admin?.full_name || req.admin?.name ||
                      req.user?.full_name  || req.user?.name  || 'Admin';

    const {
      user_id,
      user_email,
      type        = 'general',
      title,
      message,
      action_url,
      action_label,
      image_url,
      metadata    = {},
      target_scope = 'individual',
      target_role,
      priority    = 'normal',
      category    = 'general',
      send_email  = false,
      expires_at,
      // For broadcast: array of user_ids
      user_ids,
    } = req.body;

    if (!title?.trim())   return res.status(400).json({ success: false, error: 'Title is required' });
    if (!message?.trim()) return res.status(400).json({ success: false, error: 'Message is required' });

    const scope = VALID_SCOPES.has(target_scope) ? target_scope : 'individual';

    // ── Broadcast to ALL users ────────────────────────────────────────────────
    if (scope === 'all') {
      const notif = await createNotificationInternal({
        userId:      null,
        userEmail:   null,
        type, title, message,
        actionUrl:   action_url,
        actionLabel: action_label,
        metadata,
        targetScope: 'all',
        priority, category,
        senderType:  'admin',
        senderId:    adminId,
        senderName:  adminName,
        expiresAt:   expires_at || null,
      });

      return res.status(201).json({
        success: true,
        message: 'Broadcast notification sent to all users',
        data:    notif,
      });
    }

    // ── Broadcast to ROLE ─────────────────────────────────────────────────────
    if (scope === 'role' && target_role) {
      const { rows: roleUsers } = await query(
        `SELECT id, email FROM users WHERE role = $1 AND is_active = true`,
        [target_role],
      );

      const created = [];
      for (const u of roleUsers) {
        const n = await createNotificationInternal({
          userId:      u.id,
          userEmail:   u.email,
          type, title, message,
          actionUrl:   action_url,
          actionLabel: action_label,
          metadata,
          targetScope: 'role',
          target_role,
          priority, category,
          senderType:  'admin',
          senderId:    adminId,
          senderName:  adminName,
          sendEmailNotif: Boolean(send_email),
          expiresAt:   expires_at || null,
        });
        if (n) created.push(n);
      }

      return res.status(201).json({
        success: true,
        message: `Notification sent to ${created.length} users with role "${target_role}"`,
        count:   created.length,
      });
    }

    // ── Multi-user array ──────────────────────────────────────────────────────
    if (Array.isArray(user_ids) && user_ids.length) {
      const { rows: targets } = await query(
        `SELECT id, email FROM users WHERE id = ANY($1::int[]) AND is_active = true`,
        [user_ids],
      );

      const created = [];
      for (const u of targets) {
        const n = await createNotificationInternal({
          userId:      u.id,
          userEmail:   u.email,
          type, title, message,
          actionUrl:   action_url,
          actionLabel: action_label,
          metadata,
          targetScope: 'individual',
          priority, category,
          senderType:  'admin',
          senderId:    adminId,
          senderName:  adminName,
          sendEmailNotif: Boolean(send_email),
          expiresAt:   expires_at || null,
        });
        if (n) created.push(n);
      }

      return res.status(201).json({
        success: true,
        message: `Notification sent to ${created.length} users`,
        count:   created.length,
      });
    }

    // ── Individual user ───────────────────────────────────────────────────────
    let resolvedUserId    = user_id    || null;
    let resolvedUserEmail = user_email || null;

    if (resolvedUserId) {
      const { rows } = await query(
        `SELECT id, email FROM users WHERE id = $1 AND is_active = true`,
        [resolvedUserId],
      );
      if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
      resolvedUserEmail = rows[0].email;
    } else if (resolvedUserEmail) {
      const { rows } = await query(
        `SELECT id, email FROM users WHERE email = $1 AND is_active = true`,
        [resolvedUserEmail.toLowerCase().trim()],
      );
      if (rows[0]) { resolvedUserId = rows[0].id; resolvedUserEmail = rows[0].email; }
    }

    const notif = await createNotificationInternal({
      userId:      resolvedUserId,
      userEmail:   resolvedUserEmail,
      type, title, message,
      actionUrl:   action_url,
      actionLabel: action_label,
      metadata,
      targetScope: 'individual',
      priority, category,
      senderType:  'admin',
      senderId:    adminId,
      senderName:  adminName,
      sendEmailNotif: Boolean(send_email),
      expiresAt:   expires_at || null,
    });

    return res.status(201).json({
      success: true,
      message: 'Notification sent',
      data:    notif,
    });
  } catch (err) {
    logger.error('[Notifications] create failed:', err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   ADMIN: GET ALL NOTIFICATIONS (admin inbox/outbox)
   GET /api/notifications/admin
═══════════════════════════════════════════════════════════════════════════════ */

exports.adminGetAll = async (req, res, next) => {
  try {
    const {
      page     = 1,
      limit    = 20,
      type,
      scope,
      priority,
      search,
      sortBy   = 'created_at',
      order    = 'desc',
    } = req.query;

    const params  = [];
    const conds   = [];
    const addP    = (val) => { params.push(val); return `$${params.length}`; };

    if (type)     conds.push(`n.type = ${addP(type)}`);
    if (scope)    conds.push(`n.target_scope = ${addP(scope)}`);
    if (priority) conds.push(`n.priority = ${addP(priority)}`);
    if (search) {
      const ph = addP(`%${search.trim()}%`);
      conds.push(`(n.title ILIKE ${ph} OR n.message ILIKE ${ph})`);
    }

    const where    = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const sortCol  = ['created_at','title','priority','type'].includes(sortBy) ? sortBy : 'created_at';
    const sortDir  = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const limitNum = safeInt(limit, 20, 1, 100);
    const pageNum  = safeInt(page,  1,  1, 9999);
    const offset   = (pageNum - 1) * limitNum;

    const countParams = [...params];
    const limitPh     = addP(limitNum);
    const offsetPh    = addP(offset);

    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM notifications n ${where}`, countParams),
      query(
        `SELECT
            n.*,
            u.full_name AS recipient_name,
            u.email     AS recipient_email
           FROM notifications n
           LEFT JOIN users u ON n.user_id = u.id
           ${where}
           ORDER BY n.${sortCol} ${sortDir}
           LIMIT ${limitPh} OFFSET ${offsetPh}`,
        params,
      ),
    ]);

    const total      = parseInt(countRes.rows[0].count, 10);
    const totalPages = Math.ceil(total / limitNum);

    return res.json({
      success: true,
      data:    dataRes.rows,
      pagination: {
        total, page: pageNum, limit: limitNum,
        total_pages: totalPages,
        has_next: pageNum < totalPages,
        has_prev: pageNum > 1,
      },
    });
  } catch (err) {
    logger.error('[Notifications] adminGetAll failed:', err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   ADMIN: REPLY TO USER'S REPLY
   POST /api/notifications/:id/admin-reply
═══════════════════════════════════════════════════════════════════════════════ */

exports.adminReply = async (req, res, next) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const adminId = req.admin?.id || req.user?.id;
    const { reply } = req.body;

    if (!reply?.trim())
      return res.status(400).json({ success: false, error: 'Reply text is required' });

    const { rows } = await query(
      `UPDATE notifications
         SET admin_reply        = $1,
             admin_replied_at   = NOW(),
             admin_replied_by   = $2,
             updated_at         = NOW()
         WHERE id = $3 RETURNING *`,
      [reply.trim(), adminId, id],
    );

    if (!rows[0])
      return res.status(404).json({ success: false, error: 'Notification not found' });

    // Emit update to user
    if (rows[0].user_id) {
      socketBus.getIO()
        ?.to(`user-${rows[0].user_id}`)
        .emit('notification:updated', rows[0]);
    }

    return res.json({ success: true, message: 'Reply sent', data: rows[0] });
  } catch (err) {
    logger.error('[Notifications] adminReply failed:', err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   ADMIN: DELETE NOTIFICATION
   DELETE /api/notifications/:id/admin
═══════════════════════════════════════════════════════════════════════════════ */

exports.adminDelete = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await query(
      `DELETE FROM notifications WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!rows[0])
      return res.status(404).json({ success: false, error: 'Notification not found' });
    return res.json({ success: true, message: 'Notification deleted' });
  } catch (err) { next(err); }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   ADMIN: STATS
   GET /api/notifications/admin/stats
═══════════════════════════════════════════════════════════════════════════════ */

exports.adminStats = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE is_read = false)              AS unread,
        COUNT(*) FILTER (WHERE target_scope = 'all')         AS broadcasts,
        COUNT(*) FILTER (WHERE type LIKE 'booking%')         AS booking_notifs,
        COUNT(*) FILTER (WHERE reply_text IS NOT NULL)       AS with_replies,
        COUNT(*) FILTER (WHERE admin_reply IS NOT NULL)      AS admin_replied,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS last_7_days
      FROM notifications
      WHERE deleted_at IS NULL
    `);
    return res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   USER: GET MY NOTIFICATIONS
   GET /api/notifications/my
═══════════════════════════════════════════════════════════════════════════════ */

exports.getMyNotifications = async (req, res, next) => {
  try {
    const userId    = req.user?.id;
    const userEmail = req.user?.email;
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const {
      page        = 1,
      limit       = 20,
      unread_only = false,
      type,
      category,
    } = req.query;

    const params  = [];
    const addP    = (val) => { params.push(val); return `$${params.length}`; };

    // User sees: notifications addressed to them OR broadcasts OR role-targeted
    const userRole = req.user?.role || 'user';
    const baseCond = `(
      (n.user_id = ${addP(userId)} AND n.target_scope = 'individual')
      OR n.target_scope = 'all'
      OR (n.target_scope = 'role' AND n.target_role = ${addP(userRole)})
    )`;

    const conds = [baseCond, `n.deleted_at IS NULL`];

    // Filter out expired
    conds.push(`(n.expires_at IS NULL OR n.expires_at > NOW())`);

    if (unread_only === 'true' || unread_only === true)
      conds.push(`n.is_read = false`);

    if (type)     conds.push(`n.type = ${addP(type)}`);
    if (category) conds.push(`n.category = ${addP(category)}`);

    const where    = `WHERE ${conds.join(' AND ')}`;
    const limitNum = safeInt(limit, 20, 1, 100);
    const pageNum  = safeInt(page,  1,  1, 9999);
    const offset   = (pageNum - 1) * limitNum;

    const countParams = [...params];
    const limitPh     = addP(limitNum);
    const offsetPh    = addP(offset);

    const [countRes, dataRes, unreadRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM notifications n ${where}`, countParams),
      query(
        `SELECT n.* FROM notifications n
           ${where}
           ORDER BY n.created_at DESC
           LIMIT ${limitPh} OFFSET ${offsetPh}`,
        params,
      ),
      // Unread count for badge
      query(
        `SELECT COUNT(*) FROM notifications n
           WHERE (
             (n.user_id = $1 AND n.target_scope = 'individual')
             OR n.target_scope = 'all'
             OR (n.target_scope = 'role' AND n.target_role = $2)
           )
           AND n.is_read = false
           AND n.deleted_at IS NULL
           AND (n.expires_at IS NULL OR n.expires_at > NOW())`,
        [userId, userRole],
      ),
    ]);

    const total      = parseInt(countRes.rows[0].count, 10);
    const unreadCount = parseInt(unreadRes.rows[0].count, 10);
    const totalPages = Math.ceil(total / limitNum);

    return res.json({
      success:      true,
      data:         dataRes.rows,
      unread_count: unreadCount,
      pagination: {
        total, page: pageNum, limit: limitNum,
        total_pages: totalPages,
        has_next: pageNum < totalPages,
        has_prev: pageNum > 1,
      },
    });
  } catch (err) {
    logger.error('[Notifications] getMyNotifications failed:', err.message);
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   USER: UNREAD COUNT
   GET /api/notifications/my/unread-count
═══════════════════════════════════════════════════════════════════════════════ */

exports.getUnreadCount = async (req, res, next) => {
  try {
    const userId   = req.user?.id;
    const userRole = req.user?.role || 'user';
    if (!userId) return res.status(401).json({ success: false, error: 'Auth required' });

    const { rows } = await query(
      `SELECT COUNT(*) FROM notifications
         WHERE (
           (user_id = $1 AND target_scope = 'individual')
           OR target_scope = 'all'
           OR (target_scope = 'role' AND target_role = $2)
         )
         AND is_read = false
         AND deleted_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId, userRole],
    );

    return res.json({ success: true, count: parseInt(rows[0].count, 10) });
  } catch (err) { next(err); }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   USER: MARK ONE AS READ
   PATCH /api/notifications/:id/read
═══════════════════════════════════════════════════════════════════════════════ */

exports.markRead = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const id     = parseInt(req.params.id, 10);

    const { rows } = await query(
      `UPDATE notifications
         SET is_read = true, read_at = NOW(), updated_at = NOW()
         WHERE id = $1
           AND (user_id = $2 OR target_scope IN ('all','role'))
           AND deleted_at IS NULL
         RETURNING *`,
      [id, userId],
    );

    if (!rows[0])
      return res.status(404).json({ success: false, error: 'Notification not found' });

    return res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   USER: MARK ALL AS READ
   PATCH /api/notifications/mark-all-read
═══════════════════════════════════════════════════════════════════════════════ */

exports.markAllRead = async (req, res, next) => {
  try {
    const userId   = req.user?.id;
    const userRole = req.user?.role || 'user';
    if (!userId) return res.status(401).json({ success: false, error: 'Auth required' });

    const { rowCount } = await query(
      `UPDATE notifications
         SET is_read = true, read_at = NOW(), updated_at = NOW()
         WHERE (
           (user_id = $1 AND target_scope = 'individual')
           OR target_scope = 'all'
           OR (target_scope = 'role' AND target_role = $2)
         )
         AND is_read = false
         AND deleted_at IS NULL`,
      [userId, userRole],
    );

    return res.json({
      success: true,
      message: `${rowCount} notification${rowCount !== 1 ? 's' : ''} marked as read`,
      count:   rowCount,
    });
  } catch (err) { next(err); }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   USER: REACT TO NOTIFICATION
   PATCH /api/notifications/:id/react
═══════════════════════════════════════════════════════════════════════════════ */

exports.react = async (req, res, next) => {
  try {
    const userId   = req.user?.id;
    const id       = parseInt(req.params.id, 10);
    const { reaction } = req.body;

    if (!VALID_REACTIONS.has(reaction))
      return res.status(400).json({ success: false, error: 'Reaction must be "like" or "dislike"' });

    const { rows } = await query(
      `UPDATE notifications
         SET reaction   = $1,
             reacted_at = NOW(),
             updated_at = NOW()
         WHERE id = $2
           AND (user_id = $3 OR target_scope IN ('all','role'))
           AND deleted_at IS NULL
         RETURNING *`,
      [reaction, id, userId],
    );

    if (!rows[0])
      return res.status(404).json({ success: false, error: 'Notification not found' });

    return res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   USER: REPLY TO NOTIFICATION
   POST /api/notifications/:id/reply
═══════════════════════════════════════════════════════════════════════════════ */

exports.reply = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const id     = parseInt(req.params.id, 10);
    const { reply } = req.body;

    if (!reply?.trim())
      return res.status(400).json({ success: false, error: 'Reply text is required' });

    const { rows } = await query(
      `UPDATE notifications
         SET reply_text  = $1,
             replied_at  = NOW(),
             updated_at  = NOW()
         WHERE id = $2
           AND (user_id = $3 OR target_scope IN ('all','role'))
           AND deleted_at IS NULL
         RETURNING *`,
      [reply.trim().slice(0, 2000), id, userId],
    );

    if (!rows[0])
      return res.status(404).json({ success: false, error: 'Notification not found' });

    // Notify admins of user reply via socket
    socketBus.toAdmins('notification:user-replied', {
      notificationId: id,
      userId,
      userName:       req.user?.full_name || req.user?.name || 'User',
      replyText:      reply.trim().slice(0, 200),
      notifTitle:     rows[0].title,
    });

    return res.json({ success: true, message: 'Reply sent', data: rows[0] });
  } catch (err) { next(err); }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   USER: SOFT DELETE (dismiss)
   DELETE /api/notifications/:id
═══════════════════════════════════════════════════════════════════════════════ */

exports.deleteOne = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const id     = parseInt(req.params.id, 10);

    const { rows } = await query(
      `UPDATE notifications
         SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1
           AND (user_id = $2 OR target_scope IN ('all','role'))
           AND deleted_at IS NULL
         RETURNING id`,
      [id, userId],
    );

    if (!rows[0])
      return res.status(404).json({ success: false, error: 'Notification not found' });

    return res.json({ success: true, message: 'Notification dismissed' });
  } catch (err) { next(err); }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   USER: CLEAR ALL (soft-delete all)
   DELETE /api/notifications/clear-all
═══════════════════════════════════════════════════════════════════════════════ */

exports.clearAll = async (req, res, next) => {
  try {
    const userId   = req.user?.id;
    const userRole = req.user?.role || 'user';

    const { rowCount } = await query(
      `UPDATE notifications
         SET deleted_at = NOW(), updated_at = NOW()
         WHERE (
           (user_id = $1 AND target_scope = 'individual')
           OR target_scope = 'all'
           OR (target_scope = 'role' AND target_role = $2)
         )
         AND deleted_at IS NULL`,
      [userId, userRole],
    );

    return res.json({
      success: true,
      message: `${rowCount} notification${rowCount !== 1 ? 's' : ''} cleared`,
      count:   rowCount,
    });
  } catch (err) { next(err); }
};