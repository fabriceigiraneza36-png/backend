// controllers/contactController.js
const { query } = require("../config/db");
const { paginate } = require("../utils/helpers");
const { sendContactNotification, sendContactReply } = require("../utils/email");

// ============================================
// SERIALIZE FUNCTIONS
// ============================================

const serializeMessage = (row) => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  subject: row.subject,
  message: row.message,
  messagePreview: row.message_preview,
  
  // Trip details
  tripType: row.trip_type,
  travelDate: row.travel_date,
  numberOfTravelers: row.number_of_travelers,
  
  // Metadata
  source: row.source,
  ipAddress: row.ip_address,
  userAgent: row.user_agent,
  referrerUrl: row.referrer_url,
  
  // Status
  status: row.status,
  isRead: row.is_read,
  isStarred: row.is_starred,
  priority: row.priority,
  
  // Assignment
  assignedTo: row.assigned_to,
  assignedAt: row.assigned_at,
  respondedAt: row.responded_at,
  responseNotes: row.response_notes,
  
  // Tags
  tags: row.tags || [],
  
  // Timestamps
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  readAt: row.read_at,
  archivedAt: row.archived_at,
  
  // Computed
  replyCount: row.reply_count || 0,
});

// ============================================
// PUBLIC: CREATE MESSAGE
// ============================================

exports.create = async (req, res, next) => {
  try {
    const {
      full_name,
      name, // Alternative field name from frontend
      email,
      phone,
      subject,
      message,
      tripType,
      trip_type,
      travelDate,
      travel_date,
      travelers,
      number_of_travelers,
      source = 'website',
    } = req.body;

    // Normalize field names (frontend uses camelCase)
    const finalName = full_name || name;
    const finalTripType = trip_type || tripType;
    const finalTravelDate = travel_date || travelDate;
    const finalTravelers = number_of_travelers || travelers;

    // Validation
    if (!finalName || !finalName.trim()) {
      return res.status(400).json({ error: "Full name is required" });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: "Email address is required" });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address" });
    }

    // Message length validation
    if (message.length < 20) {
      return res.status(400).json({ error: "Message must be at least 20 characters" });
    }

    // Get client info
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.get('User-Agent') || null;
    const referrerUrl = req.get('Referer') || null;

    // Auto-detect priority based on content
    let priority = 'normal';
    const lowerMessage = message.toLowerCase();
    const lowerSubject = (subject || '').toLowerCase();
    
    if (
      lowerMessage.includes('urgent') || 
      lowerMessage.includes('asap') || 
      lowerMessage.includes('emergency') ||
      lowerSubject.includes('urgent')
    ) {
      priority = 'urgent';
    } else if (
      lowerMessage.includes('honeymoon') || 
      lowerMessage.includes('anniversary') ||
      lowerMessage.includes('special occasion')
    ) {
      priority = 'high';
    }

    // Parse travel date
    let parsedTravelDate = null;
    if (finalTravelDate) {
      const dateObj = new Date(finalTravelDate);
      if (!isNaN(dateObj.getTime())) {
        parsedTravelDate = dateObj.toISOString().split('T')[0];
      }
    }

    const result = await query(
      `INSERT INTO contact_messages (
        full_name, email, phone, subject, message,
        trip_type, travel_date, number_of_travelers,
        source, ip_address, user_agent, referrer_url, priority
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        finalName.trim(),
        email.trim().toLowerCase(),
        phone?.trim() || null,
        subject?.trim() || null,
        message.trim(),
        finalTripType || null,
        parsedTravelDate,
        finalTravelers || null,
        source,
        ipAddress,
        userAgent,
        referrerUrl,
        priority,
      ]
    );

    const newMessage = result.rows[0];

    // Send notification to admin (non-blocking)
    sendContactNotification(newMessage).catch((err) => {
      console.error('Failed to send contact notification:', err.message);
    });

    // Return success response
    res.status(201).json({
      success: true,
      message: "Thank you for your message! Our team will respond within 24 hours.",
      data: {
        id: newMessage.id,
        createdAt: newMessage.created_at,
      },
    });
  } catch (err) {
    console.error('Contact form error:', err);
    next(err);
  }
};

// ============================================
// ADMIN: GET ALL MESSAGES
// ============================================

exports.getAll = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      is_read,
      isRead,
      priority,
      is_starred,
      isStarred,
      search,
      sort = 'newest',
      from_date,
      to_date,
      assigned_to,
    } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;

    // Status filter
    if (status && status !== 'all') {
      where += ` AND status = $${idx++}`;
      params.push(status);
    }

    // Read status filter
    const readFilter = is_read ?? isRead;
    if (readFilter !== undefined) {
      where += ` AND is_read = $${idx++}`;
      params.push(readFilter === 'true' || readFilter === true);
    }

    // Starred filter
    const starredFilter = is_starred ?? isStarred;
    if (starredFilter !== undefined) {
      where += ` AND is_starred = $${idx++}`;
      params.push(starredFilter === 'true' || starredFilter === true);
    }

    // Priority filter
    if (priority && priority !== 'all') {
      where += ` AND priority = $${idx++}`;
      params.push(priority);
    }

    // Assigned to filter
    if (assigned_to) {
      where += ` AND assigned_to = $${idx++}`;
      params.push(parseInt(assigned_to, 10));
    }

    // Date range filter
    if (from_date) {
      where += ` AND created_at >= $${idx++}`;
      params.push(from_date);
    }
    if (to_date) {
      where += ` AND created_at <= $${idx++}`;
      params.push(to_date + ' 23:59:59');
    }

    // Search filter
    if (search && search.trim()) {
      where += ` AND (
        full_name ILIKE $${idx} OR 
        email ILIKE $${idx} OR 
        subject ILIKE $${idx} OR 
        message ILIKE $${idx} OR
        phone ILIKE $${idx}
      )`;
      params.push(`%${search.trim()}%`);
      idx++;
    }

    // Sorting
    let orderBy;
    switch (sort) {
      case 'oldest':
        orderBy = 'created_at ASC';
        break;
      case 'priority':
        orderBy = `
          CASE priority 
            WHEN 'urgent' THEN 0 
            WHEN 'high' THEN 1 
            WHEN 'normal' THEN 2 
            WHEN 'low' THEN 3 
          END ASC, created_at DESC
        `;
        break;
      case 'unread':
        orderBy = 'is_read ASC, created_at DESC';
        break;
      case 'newest':
      default:
        orderBy = 'created_at DESC';
    }

    // Count total
    const countRes = await query(
      `SELECT COUNT(*) FROM contact_messages ${where}`,
      params
    );
    const pagination = paginate(parseInt(countRes.rows[0].count, 10), page, limit);

    // Get messages
    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT 
        cm.*,
        LEFT(cm.message, 150) || CASE WHEN LENGTH(cm.message) > 150 THEN '...' ELSE '' END AS message_preview,
        (SELECT COUNT(*) FROM contact_replies cr WHERE cr.message_id = cm.id) AS reply_count
       FROM contact_messages cm
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({
      data: result.rows.map(serializeMessage),
      pagination,
    });
  } catch (err) {
    next(err);
  }
};

// ============================================
// ADMIN: GET SINGLE MESSAGE
// ============================================

exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT 
        cm.*,
        (SELECT COUNT(*) FROM contact_replies cr WHERE cr.message_id = cm.id) AS reply_count
       FROM contact_messages cm
       WHERE cm.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Get replies
    const repliesResult = await query(
      `SELECT * FROM contact_replies WHERE message_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    // Mark as read if not already
    if (!result.rows[0].is_read) {
      await query(
        `UPDATE contact_messages SET is_read = true, read_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id]
      );
      result.rows[0].is_read = true;
      result.rows[0].read_at = new Date();
    }

    res.json({
      data: {
        ...serializeMessage(result.rows[0]),
        replies: repliesResult.rows.map((r) => ({
          id: r.id,
          subject: r.subject,
          body: r.body,
          sentBy: r.sent_by,
          sentByName: r.sent_by_name,
          sentByEmail: r.sent_by_email,
          status: r.status,
          sentAt: r.sent_at,
          createdAt: r.created_at,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ============================================
// ADMIN: UPDATE MESSAGE
// ============================================

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      status,
      is_read,
      isRead,
      is_starred,
      isStarred,
      priority,
      assigned_to,
      response_notes,
      tags,
    } = req.body;

    // Build dynamic update
    const updates = [];
    const values = [];
    let idx = 1;

    if (status !== undefined) {
      updates.push(`status = $${idx++}`);
      values.push(status);
      
      // Auto-update archived_at
      if (status === 'archived') {
        updates.push(`archived_at = CURRENT_TIMESTAMP`);
      }
    }

    const readValue = is_read ?? isRead;
    if (readValue !== undefined) {
      updates.push(`is_read = $${idx++}`);
      values.push(readValue);
      if (readValue && !updates.includes('read_at')) {
        updates.push(`read_at = CURRENT_TIMESTAMP`);
      }
    }

    const starredValue = is_starred ?? isStarred;
    if (starredValue !== undefined) {
      updates.push(`is_starred = $${idx++}`);
      values.push(starredValue);
    }

    if (priority !== undefined) {
      updates.push(`priority = $${idx++}`);
      values.push(priority);
    }

    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${idx++}`);
      values.push(assigned_to);
      updates.push(`assigned_at = CURRENT_TIMESTAMP`);
    }

    if (response_notes !== undefined) {
      updates.push(`response_notes = $${idx++}`);
      values.push(response_notes);
    }

    if (tags !== undefined) {
      updates.push(`tags = $${idx++}`);
      values.push(tags);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(id);
    const result = await query(
      `UPDATE contact_messages 
       SET ${updates.join(', ')}
       WHERE id = $${idx}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json({ data: serializeMessage(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

// ============================================
// ADMIN: MARK AS READ
// ============================================

exports.markRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE contact_messages 
       SET is_read = true, read_at = CURRENT_TIMESTAMP, status = CASE WHEN status = 'new' THEN 'read' ELSE status END
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json({ data: serializeMessage(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

// ============================================
// ADMIN: MARK AS UNREAD
// ============================================

exports.markUnread = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE contact_messages 
       SET is_read = false, read_at = NULL
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json({ data: serializeMessage(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

// ============================================
// ADMIN: TOGGLE STAR
// ============================================

exports.toggleStar = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE contact_messages 
       SET is_starred = NOT is_starred
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json({ data: serializeMessage(result.rows[0]) });
  } catch (err) {
    next(err);
  }
};

// ============================================
// ADMIN: ARCHIVE MESSAGE
// ============================================

exports.archive = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE contact_messages 
       SET status = 'archived', archived_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json({ 
      message: "Message archived successfully",
      data: serializeMessage(result.rows[0]) 
    });
  } catch (err) {
    next(err);
  }
};

// ============================================
// ADMIN: MARK AS SPAM
// ============================================

exports.markSpam = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE contact_messages 
       SET status = 'spam'
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json({ 
      message: "Message marked as spam",
      data: serializeMessage(result.rows[0]) 
    });
  } catch (err) {
    next(err);
  }
};

// ============================================
// ADMIN: BULK UPDATE
// ============================================

exports.bulkUpdate = async (req, res, next) => {
  try {
    const { ids, action, value } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Message IDs are required" });
    }

    if (!action) {
      return res.status(400).json({ error: "Action is required" });
    }

    let updateQuery;
    const params = [ids];

    switch (action) {
      case 'markRead':
        updateQuery = `UPDATE contact_messages SET is_read = true, read_at = CURRENT_TIMESTAMP WHERE id = ANY($1)`;
        break;
      case 'markUnread':
        updateQuery = `UPDATE contact_messages SET is_read = false, read_at = NULL WHERE id = ANY($1)`;
        break;
      case 'archive':
        updateQuery = `UPDATE contact_messages SET status = 'archived', archived_at = CURRENT_TIMESTAMP WHERE id = ANY($1)`;
        break;
      case 'spam':
        updateQuery = `UPDATE contact_messages SET status = 'spam' WHERE id = ANY($1)`;
        break;
      case 'delete':
        updateQuery = `DELETE FROM contact_messages WHERE id = ANY($1)`;
        break;
      case 'setPriority':
        if (!value) {
          return res.status(400).json({ error: "Priority value is required" });
        }
        updateQuery = `UPDATE contact_messages SET priority = $2 WHERE id = ANY($1)`;
        params.push(value);
        break;
      case 'assignTo':
        updateQuery = `UPDATE contact_messages SET assigned_to = $2, assigned_at = CURRENT_TIMESTAMP WHERE id = ANY($1)`;
        params.push(value || null);
        break;
      default:
        return res.status(400).json({ error: "Invalid action" });
    }

    const result = await query(updateQuery + ' RETURNING id', params);

    res.json({
      message: `Successfully updated ${result.rowCount} message(s)`,
      updatedIds: result.rows.map((r) => r.id),
      count: result.rowCount,
    });
  } catch (err) {
    next(err);
  }
};

// ============================================
// ADMIN: REPLY TO MESSAGE
// ============================================

exports.reply = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { subject, body } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({ error: "Reply body is required" });
    }

    // Get original message
    const messageResult = await query(
      `SELECT * FROM contact_messages WHERE id = $1`,
      [id]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    const originalMessage = messageResult.rows[0];

    // Get admin info from authenticated user
    const adminId = req.user?.id || null;
    const adminName = req.user?.name || req.user?.full_name || 'Safari Team';
    const adminEmail = req.user?.email || process.env.EMAIL_FROM;

    // Insert reply record
    const replyResult = await query(
      `INSERT INTO contact_replies (message_id, subject, body, sent_by, sent_by_name, sent_by_email, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'sent', CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, subject || `Re: ${originalMessage.subject || 'Your inquiry'}`, body.trim(), adminId, adminName, adminEmail]
    );

    // Update original message status
    await query(
      `UPDATE contact_messages 
       SET status = 'replied', responded_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    // Send email reply (non-blocking)
    sendContactReply({
      to: originalMessage.email,
      toName: originalMessage.full_name,
      subject: subject || `Re: ${originalMessage.subject || 'Your inquiry'}`,
      body: body.trim(),
      originalMessage: originalMessage.message,
      fromName: adminName,
      fromEmail: adminEmail,
    }).catch((err) => {
      console.error('Failed to send reply email:', err.message);
    });

    res.status(201).json({
      message: "Reply sent successfully",
      data: {
        id: replyResult.rows[0].id,
        sentAt: replyResult.rows[0].sent_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ============================================
// ADMIN: GET STATISTICS
// ============================================

exports.getStats = async (req, res, next) => {
  try {
    const result = await query(`SELECT * FROM v_contact_stats`);

    const stats = result.rows[0] || {};

    // Get messages by day for the last 30 days
    const dailyResult = await query(`
      SELECT 
        DATE(created_at) AS date,
        COUNT(*) AS count
      FROM contact_messages
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    // Get messages by source
    const sourceResult = await query(`
      SELECT 
        source,
        COUNT(*) AS count
      FROM contact_messages
      GROUP BY source
      ORDER BY count DESC
    `);

    // Get messages by trip type
    const tripTypeResult = await query(`
      SELECT 
        trip_type,
        COUNT(*) AS count
      FROM contact_messages
      WHERE trip_type IS NOT NULL
      GROUP BY trip_type
      ORDER BY count DESC
      LIMIT 10
    `);

    res.json({
      data: {
        overview: {
          total: parseInt(stats.total_messages || 0, 10),
          new: parseInt(stats.new_messages || 0, 10),
          unread: parseInt(stats.unread_messages || 0, 10),
          replied: parseInt(stats.replied_messages || 0, 10),
          archived: parseInt(stats.archived_messages || 0, 10),
          spam: parseInt(stats.spam_messages || 0, 10),
          urgent: parseInt(stats.urgent_messages || 0, 10),
          highPriority: parseInt(stats.high_priority_messages || 0, 10),
          starred: parseInt(stats.starred_messages || 0, 10),
        },
        timeframe: {
          today: parseInt(stats.today_messages || 0, 10),
          thisWeek: parseInt(stats.week_messages || 0, 10),
          thisMonth: parseInt(stats.month_messages || 0, 10),
        },
        performance: {
          avgResponseHours: stats.avg_response_hours ? parseFloat(stats.avg_response_hours).toFixed(1) : null,
        },
        dailyTrend: dailyResult.rows.map((r) => ({
          date: r.date,
          count: parseInt(r.count, 10),
        })),
        bySource: sourceResult.rows.map((r) => ({
          source: r.source,
          count: parseInt(r.count, 10),
        })),
        byTripType: tripTypeResult.rows.map((r) => ({
          tripType: r.trip_type,
          count: parseInt(r.count, 10),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ============================================
// ADMIN: DELETE MESSAGE
// ============================================

exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Delete replies first (handled by CASCADE, but explicit is clearer)
    await query(`DELETE FROM contact_replies WHERE message_id = $1`, [id]);

    const result = await query(
      `DELETE FROM contact_messages WHERE id = $1 RETURNING id, full_name, email`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json({
      message: "Message deleted successfully",
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

// ============================================
// ADMIN: EXPORT MESSAGES
// ============================================

exports.export = async (req, res, next) => {
  try {
    const { format = 'json', from_date, to_date, status } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;

    if (from_date) {
      where += ` AND created_at >= $${idx++}`;
      params.push(from_date);
    }
    if (to_date) {
      where += ` AND created_at <= $${idx++}`;
      params.push(to_date + ' 23:59:59');
    }
    if (status && status !== 'all') {
      where += ` AND status = $${idx++}`;
      params.push(status);
    }

    const result = await query(
      `SELECT * FROM contact_messages ${where} ORDER BY created_at DESC`,
      params
    );

    if (format === 'csv') {
      // Generate CSV
      const headers = [
        'ID', 'Full Name', 'Email', 'Phone', 'Subject', 'Message',
        'Trip Type', 'Travel Date', 'Travelers', 'Status', 'Priority',
        'Created At', 'Read At', 'Responded At'
      ];
      
      const csvRows = [headers.join(',')];
      
      result.rows.forEach((row) => {
        csvRows.push([
          row.id,
          `"${(row.full_name || '').replace(/"/g, '""')}"`,
          row.email,
          row.phone || '',
          `"${(row.subject || '').replace(/"/g, '""')}"`,
          `"${(row.message || '').replace(/"/g, '""').substring(0, 500)}"`,
          row.trip_type || '',
          row.travel_date || '',
          row.number_of_travelers || '',
          row.status,
          row.priority,
          row.created_at,
          row.read_at || '',
          row.responded_at || '',
        ].join(','));
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="contact-messages-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send(csvRows.join('\n'));
    }

    // Default: JSON
    res.json({
      data: result.rows.map(serializeMessage),
      count: result.rows.length,
      exportedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};