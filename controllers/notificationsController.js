'use strict';

const { query }  = require('../config/db');
const logger     = require('../utils/logger');
const socketBus  = require('../utils/socketBus');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getIO = (req) => {
  try { return req?.app?.get('io') || socketBus.getIO?.() || null; }
  catch { return null; }
};

const emitToUser = (io, userId, event, payload) => {
  if (!io || !userId) return;
  try { io.to(`user-${userId}`).emit(event, payload); }
  catch (err) { logger.warn('[Notifications] emit error:', err.message); }
};

const emitToAdmins = (io, event, payload) => {
  if (!io) return;
  try {
    io.to('admins').emit(event, payload);
    io.to('admin-room').emit(event, payload);
  } catch (err) { logger.warn('[Notifications] admin emit error:', err.message); }
};

const normalizeRow = (row) => ({
  id:           row.id,
  userId:       row.user_id,
  type:         row.type          || 'general',
  category:     row.category      || 'general',
  title:        row.title         || '',
  message:      row.message       || '',
  actionUrl:    row.action_url    || null,
  actionLabel:  row.action_label  || null,
  isRead:       Boolean(row.is_read),
  readAt:       row.read_at       || null,
  reaction:     row.reaction      || null,
  replyText:    row.reply_text    || null,
  adminReply:   row.admin_reply   || null,
  metadata:     row.metadata      || {},
  priority:     row.priority      || 'normal',
  targetScope:  row.target_scope  || 'individual',
  targetRole:   row.target_role   || null,
  senderType:   row.sender_type   || 'system',
  senderName:   row.sender_name   || null,
  createdAt:    row.created_at,
  updatedAt:    row.updated_at,
  // snake_case aliases
  is_read:      Boolean(row.is_read),
  read_at:      row.read_at       || null,
  reply_text:   row.reply_text    || null,
  admin_reply:  row.admin_reply   || null,
  action_url:   row.action_url    || null,
  action_label: row.action_label  || null,
  created_at:   row.created_at,
  updated_at:   row.updated_at,
  // user info (from JOIN)
  user_full_name: row.user_full_name || null,
  user_email:     row.user_email     || null,
});

// ─── Internal helper ──────────────────────────────────────────────────────────

exports.createNotificationInternal = async ({
  userId       = null,
  type         = 'general',
  category     = 'general',
  title        = '',
  message      = '',
  actionUrl    = null,
  actionLabel  = null,
  metadata     = {},
  priority     = 'normal',
  targetScope  = 'individual',
  targetRole   = null,
  senderType   = 'system',
  senderId     = null,
  senderName   = null,
  io           = null,
  targetUserIds = [],   // NEW: for category-targeted sends
}) => {
  // If targetUserIds provided, insert one row per user
  if (targetUserIds && targetUserIds.length > 0) {
    const created = [];
    for (const uid of targetUserIds) {
      const { rows } = await query(
        `INSERT INTO notifications
           (user_id, type, category, title, message,
            action_url, action_label, metadata, priority,
            target_scope, target_role,
            sender_type, sender_id, sender_name,
            is_read, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 false, NOW(), NOW())
         RETURNING *`,
        [uid, type, category, title, message,
         actionUrl, actionLabel, JSON.stringify(metadata),
         priority, targetScope, targetRole,
         senderType, senderId, senderName],
      );
      const notif = normalizeRow(rows[0]);
      if (io) emitToUser(io, uid, 'notification:new', notif);
      created.push(notif);
    }
    // Update unread badges
    if (io) {
      for (const uid of targetUserIds) {
        const cnt = await query(
          `SELECT COUNT(*) FROM notifications
            WHERE user_id=$1 AND is_read=false AND deleted_at IS NULL`,
          [uid],
        );
        emitToUser(io, uid, 'notification:unread-count',
          { count: parseInt(cnt.rows[0].count, 10) });
      }
    }
    return created;
  }

  // Single notification
  const { rows } = await query(
    `INSERT INTO notifications
       (user_id, type, category, title, message,
        action_url, action_label, metadata, priority,
        target_scope, target_role,
        sender_type, sender_id, sender_name,
        is_read, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             false, NOW(), NOW())
     RETURNING *`,
    [userId, type, category, title, message,
     actionUrl, actionLabel, JSON.stringify(metadata),
     priority, targetScope, targetRole,
     senderType, senderId, senderName],
  );

  const notif = normalizeRow(rows[0]);

  if (io) {
    if (targetScope === 'individual' && userId) {
      emitToUser(io, userId, 'notification:new', notif);
      const cnt = await query(
        `SELECT COUNT(*) FROM notifications
          WHERE user_id=$1 AND is_read=false AND deleted_at IS NULL`,
        [userId],
      );
      emitToUser(io, userId, 'notification:unread-count',
        { count: parseInt(cnt.rows[0].count, 10) });
    } else if (targetScope === 'all') {
      io.to('all-users').emit('notification:new', notif);
    } else if (targetScope === 'role' && targetRole) {
      io.to(`role-${targetRole}`).emit('notification:new', notif);
    }
  }

  return notif;
};

// ═══════════════════════════════════════════════════════════════════════════════
// USER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

exports.getMyNotifications = async (req, res) => {
  try {
    const userId   = req.user.id;
    const userRole = req.user.role || 'user';
    const page     = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit    = Math.min(50, parseInt(req.query.limit || '20', 10));
    const offset   = (page - 1) * limit;
    const type     = req.query.type || null;

    let whereExtra = '';
    const params   = [userId, userRole, limit, offset];
    let p          = 5;

    if (type) {
      const types = type.split(',').map(t => t.trim()).filter(Boolean);
      whereExtra = ` AND n.type = ANY($${p}::text[])`;
      params.push(types); p++;
    }

    const { rows } = await query(
      `SELECT n.*
         FROM notifications n
        WHERE (
          (n.user_id = $1 AND n.target_scope = 'individual')
          OR n.target_scope = 'all'
          OR (n.target_scope = 'role' AND n.target_role = $2)
        )
        AND n.deleted_at IS NULL
        AND (n.expires_at IS NULL OR n.expires_at > NOW())
        ${whereExtra}
        ORDER BY n.created_at DESC
        LIMIT $3 OFFSET $4`,
      params,
    );

    const countResult = await query(
      `SELECT COUNT(*) FROM notifications n
        WHERE (
          (n.user_id = $1 AND n.target_scope = 'individual')
          OR n.target_scope = 'all'
          OR (n.target_scope = 'role' AND n.target_role = $2)
        )
        AND n.deleted_at IS NULL
        AND (n.expires_at IS NULL OR n.expires_at > NOW())`,
      [userId, userRole],
    );

    const unreadResult = await query(
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
    );

    res.json({
      success:      true,
      data:         rows.map(normalizeRow),
      unread_count: parseInt(unreadResult.rows[0].count, 10),
      pagination: {
        page,
        limit,
        total:       parseInt(countResult.rows[0].count, 10),
        total_pages: Math.ceil(parseInt(countResult.rows[0].count, 10) / limit),
      },
    });
  } catch (err) {
    logger.error('[Notifications] getMyNotifications:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const userId   = req.user.id;
    const userRole = req.user.role || 'user';
    const { rows } = await query(
      `SELECT COUNT(*) FROM notifications
        WHERE (
          (user_id = $1 AND target_scope = 'individual')
          OR target_scope = 'all'
          OR (target_scope = 'role' AND target_role = $2)
        )
        AND is_read = false AND deleted_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId, userRole],
    );
    res.json({ success: true, count: parseInt(rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.markRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    await query(
      `UPDATE notifications
          SET is_read=true, read_at=NOW(), updated_at=NOW()
        WHERE id=$1
          AND (user_id=$2 OR target_scope IN ('all','role'))
          AND deleted_at IS NULL`,
      [id, userId],
    );
    const io = getIO(req);
    if (io) {
      const userRole = req.user.role || 'user';
      const cnt = await query(
        `SELECT COUNT(*) FROM notifications
          WHERE (
            (user_id=$1 AND target_scope='individual')
            OR target_scope='all'
            OR (target_scope='role' AND target_role=$2)
          )
          AND is_read=false AND deleted_at IS NULL`,
        [userId, userRole],
      );
      emitToUser(io, userId, 'notification:unread-count',
        { count: parseInt(cnt.rows[0].count, 10) });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    const userId   = req.user.id;
    const userRole = req.user.role || 'user';
    await query(
      `UPDATE notifications
          SET is_read=true, read_at=NOW(), updated_at=NOW()
        WHERE (
          (user_id=$1 AND target_scope='individual')
          OR target_scope='all'
          OR (target_scope='role' AND target_role=$2)
        )
        AND is_read=false AND deleted_at IS NULL`,
      [userId, userRole],
    );
    const io = getIO(req);
    if (io) emitToUser(io, userId, 'notification:unread-count', { count: 0 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.react = async (req, res) => {
  try {
    const userId   = req.user.id;
    const { id }   = req.params;
    const reaction = req.body.reaction || null;
    await query(
      `UPDATE notifications
          SET reaction=$1, reacted_at=NOW(), updated_at=NOW()
        WHERE id=$2
          AND (user_id=$3 OR target_scope IN ('all','role'))
          AND deleted_at IS NULL`,
      [reaction, id, userId],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.reply = async (req, res) => {
  try {
    const userId    = req.user.id;
    const { id }    = req.params;
    const replyText = String(req.body.reply || req.body.replyText || '').trim();
    if (!replyText)
      return res.status(400).json({ success: false, message: 'Reply text required.' });

    const { rows } = await query(
      `UPDATE notifications
          SET reply_text=$1, replied_at=NOW(), updated_at=NOW()
        WHERE id=$2
          AND (user_id=$3 OR target_scope IN ('all','role'))
          AND deleted_at IS NULL
        RETURNING *`,
      [replyText, id, userId],
    );
    if (!rows[0])
      return res.status(404).json({ success: false, message: 'Notification not found.' });

    const io = getIO(req);
    if (io) {
      emitToAdmins(io, 'notification:user-replied', {
        notificationId: parseInt(id, 10),
        userId,
        replyText,
        userName: req.user.fullName || req.user.name || req.user.email,
        notification: normalizeRow(rows[0]),
      });
    }
    res.json({ success: true, data: normalizeRow(rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteOne = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    await query(
      `UPDATE notifications
          SET deleted_at=NOW(), updated_at=NOW()
        WHERE id=$1
          AND (user_id=$2 OR target_scope IN ('all','role'))
          AND deleted_at IS NULL`,
      [id, userId],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.clearAll = async (req, res) => {
  try {
    const userId   = req.user.id;
    const userRole = req.user.role || 'user';
    await query(
      `UPDATE notifications
          SET deleted_at=NOW(), updated_at=NOW()
        WHERE (
          (user_id=$1 AND target_scope='individual')
          OR target_scope='all'
          OR (target_scope='role' AND target_role=$2)
        )
        AND deleted_at IS NULL`,
      [userId, userRole],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKLIST REQUEST
// ═══════════════════════════════════════════════════════════════════════════════

exports.checklistRequest = async (req, res) => {
  try {
    const userId    = req.user.id;
    const userEmail = req.user.email;
    const userName  = req.user.fullName || req.user.full_name || req.user.name || userEmail;
    const { title, type, destination, travel_date, notes } = req.body;
    if (!type)
      return res.status(400).json({ success: false, message: 'Checklist type required.' });

    const io = getIO(req);

    await exports.createNotificationInternal({
      userId, type: 'checklist_request', category: 'checklist',
      title: title || `${type} Request Submitted`,
      message: `Your checklist request has been received. Our team will prepare your ${type} shortly.`,
      priority: 'normal', targetScope: 'individual', senderType: 'system', io,
    });

    const { rows: admins } = await query(
      `SELECT id FROM users WHERE role='admin' AND is_active=true LIMIT 20`,
    );
    for (const admin of admins) {
      await exports.createNotificationInternal({
        userId: admin.id, type: 'admin_checklist_request', category: 'admin',
        title: `📋 Checklist Request: ${type}`,
        message: `From: ${userName} (${userEmail})\nDestination: ${destination || 'Not specified'}\nTravel Date: ${travel_date || 'Not specified'}\nNotes: ${notes || 'None'}`,
        priority: 'high', targetScope: 'individual',
        senderType: 'user', senderId: userId, senderName: userName,
        metadata: { requesterId: userId, requesterName: userName, requesterEmail: userEmail, checklistType: type, destination, travelDate: travel_date, notes },
        io,
      });
    }

    if (io) {
      emitToAdmins(io, 'notification:new', {
        type: 'admin_checklist_request', category: 'admin',
        title: `📋 Checklist Request: ${type}`, message: `From ${userName}`,
        priority: 'high',
        metadata: { userId, userName, userEmail, type, destination, travel_date, notes },
        createdAt: new Date().toISOString(),
      });
    }

    res.json({ success: true, message: 'Checklist request submitted.' });
  } catch (err) {
    logger.error('[Notifications] checklistRequest:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

exports.adminGetAll = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(100, parseInt(req.query.limit || '30', 10));
    const offset = (page - 1) * limit;

    const conditions = ['n.deleted_at IS NULL'];
    const params     = [];
    let   p          = 1;

    if (req.query.type)   { conditions.push(`n.type=$${p++}`);         params.push(req.query.type); }
    if (req.query.scope)  { conditions.push(`n.target_scope=$${p++}`); params.push(req.query.scope); }
    if (req.query.userId) { conditions.push(`n.user_id=$${p++}`);      params.push(parseInt(req.query.userId, 10)); }
    if (req.query.unread === 'true') { conditions.push(`n.is_read=false`); }
    if (req.query.awaitingReply === 'true') {
      conditions.push(`n.reply_text IS NOT NULL AND n.admin_reply IS NULL`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const dataParams = [...params, limit, offset];

    const { rows } = await query(
      `SELECT n.*,
              u.full_name AS user_full_name,
              u.email     AS user_email
         FROM notifications n
         LEFT JOIN users u ON u.id = n.user_id
         ${where}
         ORDER BY n.created_at DESC
         LIMIT $${p++} OFFSET $${p++}`,
      dataParams,
    );

    const countRes = await query(
      `SELECT COUNT(*) FROM notifications n ${where}`, params,
    );

    res.json({
      success: true,
      data:    rows.map(normalizeRow),
      pagination: {
        page, limit,
        total:       parseInt(countRes.rows[0].count, 10),
        total_pages: Math.ceil(parseInt(countRes.rows[0].count, 10) / limit),
      },
    });
  } catch (err) {
    logger.error('[Notifications] adminGetAll:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.adminStats = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         COUNT(*)                                                       AS total,
         COUNT(*) FILTER (WHERE is_read=false)                          AS unread,
         COUNT(*) FILTER (WHERE type LIKE 'checklist%')                 AS checklist_requests,
         COUNT(*) FILTER (WHERE priority='high')                        AS high_priority,
         COUNT(*) FILTER (WHERE created_at > NOW()-INTERVAL '24h')      AS last_24h,
         COUNT(*) FILTER (WHERE reply_text IS NOT NULL
                            AND admin_reply IS NULL)                    AS awaiting_reply
       FROM notifications WHERE deleted_at IS NULL`,
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/notifications/admin/target-groups
 * Returns available targeting groups for the broadcast UI
 */
exports.adminGetTargetGroups = async (req, res) => {
  try {
    const [allUsers, withBookings, withConfirmed, withPending, newUsers] =
      await Promise.all([
        query(`SELECT COUNT(*) FROM users WHERE is_active=true`),
        query(`SELECT COUNT(DISTINCT user_id) FROM bookings WHERE user_id IS NOT NULL`),
        query(`SELECT COUNT(DISTINCT user_id) FROM bookings WHERE status='confirmed'`),
        query(`SELECT COUNT(DISTINCT user_id) FROM bookings WHERE status='pending'`),
        query(`SELECT COUNT(*) FROM users WHERE is_active=true AND created_at > NOW()-INTERVAL '7d'`),
      ]);

    res.json({
      success: true,
      groups: [
        { key: 'all',               label: 'All Users',             count: parseInt(allUsers.rows[0].count,     10), description: 'Send to every registered user' },
        { key: 'with_bookings',     label: 'Users with Bookings',   count: parseInt(withBookings.rows[0].count, 10), description: 'Users who have at least one booking' },
        { key: 'confirmed_booking', label: 'Confirmed Bookings',    count: parseInt(withConfirmed.rows[0].count,10), description: 'Users with confirmed bookings' },
        { key: 'pending_booking',   label: 'Pending Bookings',      count: parseInt(withPending.rows[0].count,  10), description: 'Users with pending bookings' },
        { key: 'new_users',         label: 'New Users (7 days)',     count: parseInt(newUsers.rows[0].count,     10), description: 'Users registered in the last 7 days' },
        { key: 'individual',        label: 'Specific User',         count: null, description: 'Target a single user by ID or email' },
      ],
    });
  } catch (err) {
    logger.error('[Notifications] adminGetTargetGroups:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/notifications
 * Admin creates/broadcasts a notification with advanced targeting
 */
exports.create = async (req, res) => {
  try {
    const {
      userId, userEmail, type, category, title, message,
      actionUrl, actionLabel, metadata, priority,
      targetScope, targetRole, targetGroup,
    } = req.body;

    if (!title || !message)
      return res.status(400).json({ success: false, message: 'title and message are required.' });

    const io         = getIO(req);
    const senderName = req.user?.full_name || req.user?.name || 'Admin';
    const senderId   = req.user?.id;

    // ── Resolve target user IDs based on targetGroup ──────────────────────
    let targetUserIds = [];
    let resolvedScope = targetScope || (userId ? 'individual' : 'all');

    if (targetGroup && targetGroup !== 'individual') {
      let groupQuery = '';
      switch (targetGroup) {
        case 'all':
          groupQuery = `SELECT id FROM users WHERE is_active=true`; break;
        case 'with_bookings':
          groupQuery = `SELECT DISTINCT user_id AS id FROM bookings WHERE user_id IS NOT NULL`; break;
        case 'confirmed_booking':
          groupQuery = `SELECT DISTINCT user_id AS id FROM bookings WHERE status='confirmed'`; break;
        case 'pending_booking':
          groupQuery = `SELECT DISTINCT user_id AS id FROM bookings WHERE status='pending'`; break;
        case 'new_users':
          groupQuery = `SELECT id FROM users WHERE is_active=true AND created_at > NOW()-INTERVAL '7d'`; break;
        default:
          groupQuery = `SELECT id FROM users WHERE is_active=true`;
      }
      const { rows: uRows } = await query(groupQuery);
      targetUserIds  = uRows.map(r => r.id);
      resolvedScope  = 'individual'; // send individually so each user's feed shows it
    } else if (userEmail && !userId) {
      // Resolve by email
      const { rows: uRows } = await query(
        `SELECT id FROM users WHERE email=$1 LIMIT 1`, [userEmail],
      );
      if (!uRows[0])
        return res.status(404).json({ success: false, message: 'User not found.' });
      targetUserIds = [uRows[0].id];
      resolvedScope = 'individual';
    } else if (userId) {
      targetUserIds = [userId];
      resolvedScope = 'individual';
    }

    const result = await exports.createNotificationInternal({
      userId:       targetUserIds.length === 1 ? targetUserIds[0] : null,
      type:         type         || 'general',
      category:     category     || 'general',
      title, message,
      actionUrl:    actionUrl    || null,
      actionLabel:  actionLabel  || null,
      metadata:     metadata     || {},
      priority:     priority     || 'normal',
      targetScope:  resolvedScope,
      targetRole:   targetRole   || null,
      senderType:   'admin',
      senderId,
      senderName,
      io,
      targetUserIds: targetUserIds.length > 1 ? targetUserIds : [],
    });

    // Emit count to admin panel
    if (io) {
      emitToAdmins(io, 'notification:broadcast-sent', {
        count:       Array.isArray(result) ? result.length : 1,
        title,
        targetGroup: targetGroup || resolvedScope,
      });
    }

    res.status(201).json({
      success: true,
      data:    result,
      sent:    Array.isArray(result) ? result.length : 1,
    });
  } catch (err) {
    logger.error('[Notifications] create:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/notifications/:id/admin-reply
 */
exports.adminReply = async (req, res) => {
  try {
    const { id }     = req.params;
    const adminReply = String(req.body.adminReply || req.body.admin_reply || '').trim();
    if (!adminReply)
      return res.status(400).json({ success: false, message: 'Reply text required.' });

    const { rows } = await query(
      `UPDATE notifications
          SET admin_reply=$1, admin_replied_at=NOW(), updated_at=NOW()
        WHERE id=$2 AND deleted_at IS NULL
        RETURNING *`,
      [adminReply, id],
    );
    if (!rows[0])
      return res.status(404).json({ success: false, message: 'Not found.' });

    const notif = normalizeRow(rows[0]);
    const io    = getIO(req);
    if (io && notif.userId) {
      emitToUser(io, notif.userId, 'notification:updated', notif);
      emitToUser(io, notif.userId, 'notification:admin-replied', {
        notificationId: notif.id,
        adminReply,
        adminName: req.user?.full_name || req.user?.name || 'Admin',
      });
    }
    res.json({ success: true, data: notif });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.adminDelete = async (req, res) => {
  try {
    await query(
      `UPDATE notifications SET deleted_at=NOW() WHERE id=$1`, [req.params.id],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.adminSendChecklist = async (req, res) => {
  try {
    const { userId, pdfUrl, tripTitle, requestNotifId } = req.body;
    if (!userId || !pdfUrl)
      return res.status(400).json({ success: false, message: 'userId and pdfUrl are required.' });

    const io    = getIO(req);
    const notif = await exports.createNotificationInternal({
      userId, type: 'checklist_ready', category: 'checklist',
      title:   '✅ Your Checklist is Ready!',
      message: `Your travel checklist${tripTitle ? ` for ${tripTitle}` : ''} is ready. Download it now!`,
      actionUrl: pdfUrl, actionLabel: 'Download PDF',
      priority: 'high', targetScope: 'individual',
      senderType: 'admin', senderId: req.user?.id,
      senderName: req.user?.full_name || 'Altuvera Team',
      metadata: { pdfUrl, tripTitle }, io,
    });

    if (requestNotifId) {
      await query(
        `UPDATE notifications
            SET metadata=metadata||'{"handled":true}'::jsonb, updated_at=NOW()
          WHERE id=$1`, [requestNotifId],
      );
    }
    res.json({ success: true, message: 'Checklist sent.', data: notif });
  } catch (err) {
    logger.error('[Notifications] adminSendChecklist:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.adminConfirmPayment = async (req, res) => {
  try {
    const { bookingId, userId, bookingNumber, amount, currency } = req.body;
    if (!bookingId || !userId)
      return res.status(400).json({ success: false, message: 'bookingId and userId required.' });

    await query(
      `UPDATE bookings SET payment_status='paid', confirmed_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [bookingId],
    );

    const io    = getIO(req);
    const notif = await exports.createNotificationInternal({
      userId, type: 'payment_confirmed', category: 'payment',
      title:   '💳 Payment Confirmed!',
      message: `Your payment${amount ? ` of ${currency || 'USD'} ${amount}` : ''} for booking ${bookingNumber || `#${bookingId}`} has been confirmed. Your trip is now fully booked!`,
      actionUrl: '/my-bookings', actionLabel: 'View Booking',
      priority: 'high', targetScope: 'individual',
      senderType: 'admin', senderId: req.user?.id,
      senderName: req.user?.full_name || 'Altuvera Team',
      metadata: { bookingId, bookingNumber, amount, currency }, io,
    });
    res.json({ success: true, message: 'Payment confirmed and user notified.', data: notif });
  } catch (err) {
    logger.error('[Notifications] adminConfirmPayment:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.adminRequestPayment = async (req, res) => {
  try {
    const { userId, bookingId, bookingNumber, amount, currency, dueDate } = req.body;
    if (!userId || !bookingId)
      return res.status(400).json({ success: false, message: 'userId and bookingId required.' });

    const io    = getIO(req);
    const notif = await exports.createNotificationInternal({
      userId, type: 'payment_request', category: 'payment',
      title:   '💰 Payment Required',
      message: `Please complete your payment${amount ? ` of ${currency || 'USD'} ${amount}` : ''} for booking ${bookingNumber || `#${bookingId}`}${dueDate ? ` by ${new Date(dueDate).toLocaleDateString()}` : ''}.`,
      actionUrl: '/payments', actionLabel: 'View Payment Details',
      priority: 'high', targetScope: 'individual',
      senderType: 'admin', senderId: req.user?.id,
      senderName: req.user?.full_name || 'Altuvera Team',
      metadata: { bookingId, bookingNumber, amount, currency, dueDate }, io,
    });
    res.json({ success: true, data: notif });
  } catch (err) {
    logger.error('[Notifications] adminRequestPayment:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};