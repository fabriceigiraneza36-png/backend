/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DESTINATION COMMENTS CONTROLLER v2.0 — pg (no Sequelize)
 * ═══════════════════════════════════════════════════════════════════════════════
 * Fixes:
 *  • Removed all Sequelize model imports (they crashed on Render with
 *    ECONNREFUSED 127.0.0.1:5432)
 *  • Uses your existing `pg` query helper from config/db
 *  • Auto-creates the destination_comments table if missing
 *  • Nested replies via recursive query
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict'

const { query } = require('../config/db')
const logger    = require('../utils/logger')

/* ═══════════════════════════════════════════════════════════════════════════
   SCHEMA BOOTSTRAP
═══════════════════════════════════════════════════════════════════════════ */

let _schemaReady = false

const ensureCommentsSchema = async () => {
  if (_schemaReady) return
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS destination_comments (
        id             SERIAL PRIMARY KEY,
        destination_id INTEGER NOT NULL,
        user_id        INTEGER,
        parent_id      INTEGER REFERENCES destination_comments(id) ON DELETE CASCADE,
        content        TEXT NOT NULL,
        author_name    TEXT,
        author_email   TEXT,
        is_approved    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await query(`CREATE INDEX IF NOT EXISTS idx_dcomments_dest ON destination_comments(destination_id)`).catch(() => {})
    await query(`CREATE INDEX IF NOT EXISTS idx_dcomments_user ON destination_comments(user_id)`).catch(() => {})
    await query(`CREATE INDEX IF NOT EXISTS idx_dcomments_parent ON destination_comments(parent_id)`).catch(() => {})
    await query(`CREATE INDEX IF NOT EXISTS idx_dcomments_created ON destination_comments(created_at DESC)`).catch(() => {})

    _schemaReady = true
    logger.info('[DestinationComments] Schema ready ✅')
  } catch (err) {
    logger.error('[DestinationComments] Schema init failed:', err.message)
    _schemaReady = true // don't retry forever
  }
}

// Fire on module load
ensureCommentsSchema().catch(() => {})

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */

const safeInt = (v, def = 0, min = 0, max = 99_999) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def
}

const isAdminReq = (req) =>
  req.userType === 'admin' ||
  ['admin', 'superadmin', 'super_admin', 'moderator', 'editor'].includes(
    req.user?.role || ''
  )

/** Serialise a comment row (with joined user fields) */
const serializeComment = (row) => {
  if (!row) return null
  return {
    id:            row.id,
    destinationId: row.destination_id,
    content:       row.content,
    parentId:      row.parent_id,
    isApproved:    row.is_approved,
    authorName:    row.author_name,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
    user: row.user_id
      ? {
          id:     row.user_id,
          name:   row.u_full_name || row.author_name || 'Traveller',
          email:  row.u_email     || null,
          avatar: row.u_avatar_url || null,
        }
      : row.author_name
      ? { id: null, name: row.author_name, email: null, avatar: null }
      : null,
    replies: [], // filled in by nestReplies()
  }
}

/**
 * Build nested tree: attach replies to their parents.
 * Input: flat array of comments (top-level + replies)
 * Output: array of top-level comments each with `.replies`
 */
const nestReplies = (flatRows) => {
  const map = new Map()
  const roots = []

  // First pass — index everyone
  for (const row of flatRows) {
    map.set(row.id, serializeComment(row))
  }

  // Second pass — link replies to parents
  for (const row of flatRows) {
    const node = map.get(row.id)
    if (row.parent_id && map.has(row.parent_id)) {
      map.get(row.parent_id).replies.push(node)
    } else if (!row.parent_id) {
      roots.push(node)
    }
  }

  return roots
}

/* ─── Shared SELECT — comments joined with user info ─────────────────────── */
const COMMENT_SELECT = `
  SELECT
    c.id,
    c.destination_id,
    c.user_id,
    c.parent_id,
    c.content,
    c.author_name,
    c.is_approved,
    c.created_at,
    c.updated_at,
    u.full_name  AS u_full_name,
    u.email      AS u_email,
    u.avatar_url AS u_avatar_url
  FROM destination_comments c
  LEFT JOIN users u ON u.id = c.user_id
`

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC / USER ENDPOINTS
═══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /destinations/:destinationId/comments
 * Returns all comments (top-level + nested replies) for a destination.
 */
exports.getComments = async (req, res, next) => {
  try {
    await ensureCommentsSchema()

    const destinationId = safeInt(req.params.destinationId, 0, 1)
    if (!destinationId) {
      return res.status(400).json({ status: 'error', message: 'Invalid destination ID' })
    }

    const page  = safeInt(req.query.page, 1, 1, 999)
    const limit = safeInt(req.query.limit, 50, 1, 200)
    const { approved } = req.query

    /* Verify destination exists */
    const destCheck = await query(
      'SELECT id FROM destinations WHERE id = $1 LIMIT 1',
      [destinationId],
    )
    if (!destCheck.rows[0]) {
      return res.status(404).json({ status: 'error', message: 'Destination not found' })
    }

    /* Approval filter */
    const conds  = ['c.destination_id = $1']
    const params = [destinationId]
    let pi = 2

    if (approved !== undefined) {
      conds.push(`c.is_approved = $${pi++}`)
      params.push(approved === 'true')
    } else if (!isAdminReq(req)) {
      conds.push(`c.is_approved = TRUE`)
    }

    const where = conds.join(' AND ')

    /* Count top-level comments for pagination */
    const countRes = await query(
      `SELECT COUNT(*)::INT AS cnt
         FROM destination_comments c
        WHERE ${where} AND c.parent_id IS NULL`,
      params,
    )
    const total = countRes.rows[0]?.cnt || 0

    /* Get top-level comment IDs for this page */
    const offset = (page - 1) * limit
    const topRes = await query(
      `SELECT c.id
         FROM destination_comments c
        WHERE ${where} AND c.parent_id IS NULL
        ORDER BY c.created_at DESC
        LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset],
    )
    const topIds = topRes.rows.map((r) => r.id)

    if (topIds.length === 0) {
      return res.json({
        status: 'success',
        data: {
          comments: [],
          pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        },
      })
    }

    /* Fetch top-level + all descendant replies in one query */
    const allRes = await query(
      `${COMMENT_SELECT}
        WHERE c.destination_id = $1
          AND (c.id = ANY($2::INT[]) OR c.parent_id = ANY($2::INT[]))
        ORDER BY c.created_at ASC`,
      [destinationId, topIds],
    )

    /* Approval filter on replies for non-admins */
    let flatRows = allRes.rows
    if (approved === undefined && !isAdminReq(req)) {
      flatRows = flatRows.filter((r) => r.is_approved)
    }

    const nested = nestReplies(flatRows)
    // Preserve top-level ordering (DESC by created_at)
    nested.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    res.json({
      status: 'success',
      data: {
        comments: nested,
        pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      },
    })
  } catch (err) {
    logger.error('[DestinationComments] getComments failed:', err)
    next(err)
  }
}

/**
 * GET /destinations/:destinationId/comments/:commentId
 */
exports.getComment = async (req, res, next) => {
  try {
    await ensureCommentsSchema()

    const destinationId = safeInt(req.params.destinationId, 0, 1)
    const commentId     = safeInt(req.params.commentId, 0, 1)

    if (!destinationId || !commentId) {
      return res.status(400).json({ status: 'error', message: 'Invalid IDs' })
    }

    const parentRes = await query(
      `${COMMENT_SELECT}
        WHERE c.id = $1 AND c.destination_id = $2
        LIMIT 1`,
      [commentId, destinationId],
    )

    if (!parentRes.rows[0]) {
      return res.status(404).json({ status: 'error', message: 'Comment not found' })
    }

    /* Fetch replies */
    const repliesRes = await query(
      `${COMMENT_SELECT}
        WHERE c.parent_id = $1
        ORDER BY c.created_at ASC`,
      [commentId],
    )

    const comment = serializeComment(parentRes.rows[0])
    comment.replies = repliesRes.rows.map(serializeComment)

    res.json({ status: 'success', data: comment })
  } catch (err) {
    logger.error('[DestinationComments] getComment failed:', err)
    next(err)
  }
}

/**
 * POST /destinations/:destinationId/comments
 */
exports.createComment = async (req, res, next) => {
  try {
    await ensureCommentsSchema()

    const destinationId = safeInt(req.params.destinationId, 0, 1)
    const userId        = req.user?.id || null
    const { content, parentId, authorName, authorEmail } = req.body

    if (!destinationId) {
      return res.status(400).json({ status: 'error', message: 'Invalid destination ID' })
    }

    if (!content || String(content).trim().length === 0) {
      return res.status(400).json({ status: 'error', message: 'Comment content is required' })
    }

    const cleanContent = String(content).trim()
    if (cleanContent.length > 2000) {
      return res.status(400).json({ status: 'error', message: 'Comment is too long (max 2000 characters)' })
    }

    /* Verify destination exists */
    const destCheck = await query(
      'SELECT id FROM destinations WHERE id = $1 LIMIT 1',
      [destinationId],
    )
    if (!destCheck.rows[0]) {
      return res.status(404).json({ status: 'error', message: 'Destination not found' })
    }

    /* Verify parent (if provided) */
    let parentIdInt = null
    if (parentId) {
      parentIdInt = safeInt(parentId, 0, 1)
      if (parentIdInt) {
        const parentCheck = await query(
          `SELECT id FROM destination_comments
            WHERE id = $1 AND destination_id = $2 LIMIT 1`,
          [parentIdInt, destinationId],
        )
        if (!parentCheck.rows[0]) {
          return res.status(404).json({ status: 'error', message: 'Parent comment not found' })
        }
      }
    }

    /* Insert */
    const insertRes = await query(
      `INSERT INTO destination_comments
         (destination_id, user_id, parent_id, content,
          author_name, author_email, is_approved, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
       RETURNING id`,
      [
        destinationId,
        userId || null,
        parentIdInt,
        cleanContent,
        userId ? null : (authorName || 'Anonymous'),
        userId ? null : (authorEmail || null),
      ],
    )

    const newId = insertRes.rows[0].id

    /* Fetch full comment with user info */
    const fullRes = await query(
      `${COMMENT_SELECT} WHERE c.id = $1 LIMIT 1`,
      [newId],
    )

    res.status(201).json({
      status:  'success',
      message: 'Comment created successfully',
      data:    serializeComment(fullRes.rows[0]),
    })
  } catch (err) {
    logger.error('[DestinationComments] createComment failed:', err)
    next(err)
  }
}

/**
 * PUT /destinations/:destinationId/comments/:commentId
 */
exports.updateComment = async (req, res, next) => {
  try {
    await ensureCommentsSchema()

    const destinationId = safeInt(req.params.destinationId, 0, 1)
    const commentId     = safeInt(req.params.commentId, 0, 1)
    const userId        = req.user?.id || null
    const { content }   = req.body

    if (!destinationId || !commentId) {
      return res.status(400).json({ status: 'error', message: 'Invalid IDs' })
    }

    if (!content || String(content).trim().length === 0) {
      return res.status(400).json({ status: 'error', message: 'Comment content is required' })
    }

    /* Fetch existing */
    const existRes = await query(
      `SELECT id, user_id FROM destination_comments
        WHERE id = $1 AND destination_id = $2 LIMIT 1`,
      [commentId, destinationId],
    )
    if (!existRes.rows[0]) {
      return res.status(404).json({ status: 'error', message: 'Comment not found' })
    }

    /* Authorization */
    const isOwner = userId && existRes.rows[0].user_id === userId
    if (!isOwner && !isAdminReq(req)) {
      return res.status(403).json({
        status:  'error',
        message: 'You are not authorized to update this comment',
      })
    }

    /* Update */
    await query(
      `UPDATE destination_comments
          SET content = $1, updated_at = NOW()
        WHERE id = $2`,
      [String(content).trim(), commentId],
    )

    /* Return fresh */
    const fullRes = await query(
      `${COMMENT_SELECT} WHERE c.id = $1 LIMIT 1`,
      [commentId],
    )

    res.json({
      status:  'success',
      message: 'Comment updated successfully',
      data:    serializeComment(fullRes.rows[0]),
    })
  } catch (err) {
    logger.error('[DestinationComments] updateComment failed:', err)
    next(err)
  }
}

/**
 * DELETE /destinations/:destinationId/comments/:commentId
 */
exports.deleteComment = async (req, res, next) => {
  try {
    await ensureCommentsSchema()

    const destinationId = safeInt(req.params.destinationId, 0, 1)
    const commentId     = safeInt(req.params.commentId, 0, 1)
    const userId        = req.user?.id || null

    if (!destinationId || !commentId) {
      return res.status(400).json({ status: 'error', message: 'Invalid IDs' })
    }

    const existRes = await query(
      `SELECT id, user_id FROM destination_comments
        WHERE id = $1 AND destination_id = $2 LIMIT 1`,
      [commentId, destinationId],
    )
    if (!existRes.rows[0]) {
      return res.status(404).json({ status: 'error', message: 'Comment not found' })
    }

    const isOwner = userId && existRes.rows[0].user_id === userId
    if (!isOwner && !isAdminReq(req)) {
      return res.status(403).json({
        status:  'error',
        message: 'You are not authorized to delete this comment',
      })
    }

    /* ON DELETE CASCADE will remove replies */
    await query('DELETE FROM destination_comments WHERE id = $1', [commentId])

    res.json({ status: 'success', message: 'Comment deleted successfully' })
  } catch (err) {
    logger.error('[DestinationComments] deleteComment failed:', err)
    next(err)
  }
}

/**
 * PATCH /destinations/:destinationId/comments/:commentId/approve
 * (admin only)
 */
exports.approveComment = async (req, res, next) => {
  try {
    await ensureCommentsSchema()

    const destinationId = safeInt(req.params.destinationId, 0, 1)
    const commentId     = safeInt(req.params.commentId, 0, 1)
    const { isApproved } = req.body

    if (!destinationId || !commentId) {
      return res.status(400).json({ status: 'error', message: 'Invalid IDs' })
    }

    const approveFlag = isApproved !== false

    const updRes = await query(
      `UPDATE destination_comments
          SET is_approved = $1, updated_at = NOW()
        WHERE id = $2 AND destination_id = $3
        RETURNING id`,
      [approveFlag, commentId, destinationId],
    )

    if (!updRes.rows[0]) {
      return res.status(404).json({ status: 'error', message: 'Comment not found' })
    }

    const fullRes = await query(
      `${COMMENT_SELECT} WHERE c.id = $1 LIMIT 1`,
      [commentId],
    )

    res.json({
      status:  'success',
      message: `Comment ${approveFlag ? 'approved' : 'unapproved'} successfully`,
      data:    serializeComment(fullRes.rows[0]),
    })
  } catch (err) {
    logger.error('[DestinationComments] approveComment failed:', err)
    next(err)
  }
}

/**
 * GET /destinations/:destinationId/comments/count
 */
exports.getCommentCount = async (req, res, next) => {
  try {
    await ensureCommentsSchema()

    const destinationId = safeInt(req.params.destinationId, 0, 1)
    if (!destinationId) {
      return res.status(400).json({ status: 'error', message: 'Invalid destination ID' })
    }

    const [totalRes, topRes] = await Promise.all([
      query(
        `SELECT COUNT(*)::INT AS cnt
           FROM destination_comments
          WHERE destination_id = $1 AND is_approved = TRUE`,
        [destinationId],
      ),
      query(
        `SELECT COUNT(*)::INT AS cnt
           FROM destination_comments
          WHERE destination_id = $1 AND parent_id IS NULL AND is_approved = TRUE`,
        [destinationId],
      ),
    ])

    res.json({
      status: 'success',
      data: {
        totalComments:    totalRes.rows[0]?.cnt || 0,
        topLevelComments: topRes.rows[0]?.cnt || 0,
      },
    })
  } catch (err) {
    logger.error('[DestinationComments] getCommentCount failed:', err)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN ENDPOINTS
═══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /destination-comments/admin/all
 */
exports.adminGetAllComments = async (req, res, next) => {
  try {
    await ensureCommentsSchema()

    const page  = safeInt(req.query.page, 1, 1, 999)
    const limit = safeInt(req.query.limit, 50, 1, 200)
    const { approved, destinationId, search } = req.query

    const conds  = ['1=1']
    const params = []
    let pi = 1

    if (approved !== undefined) {
      conds.push(`c.is_approved = $${pi++}`)
      params.push(approved === 'true')
    }

    if (destinationId) {
      const destInt = safeInt(destinationId, 0, 1)
      if (destInt) {
        conds.push(`c.destination_id = $${pi++}`)
        params.push(destInt)
      }
    }

    if (search && String(search).trim()) {
      conds.push(`c.content ILIKE $${pi++}`)
      params.push(`%${String(search).trim()}%`)
    }

    const where  = conds.join(' AND ')
    const offset = (page - 1) * limit

    const [countRes, dataRes] = await Promise.all([
      query(
        `SELECT COUNT(*)::INT AS cnt
           FROM destination_comments c
          WHERE ${where}`,
        params,
      ),
      query(
        `SELECT
           c.id,
           c.destination_id,
           c.user_id,
           c.parent_id,
           c.content,
           c.author_name,
           c.is_approved,
           c.created_at,
           c.updated_at,
           u.full_name  AS u_full_name,
           u.email      AS u_email,
           u.avatar_url AS u_avatar_url,
           d.id         AS d_id,
           d.name       AS d_name,
           d.slug       AS d_slug
         FROM destination_comments c
         LEFT JOIN users u        ON u.id = c.user_id
         LEFT JOIN destinations d ON d.id = c.destination_id
         WHERE ${where}
         ORDER BY c.created_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limit, offset],
      ),
    ])

    const total = countRes.rows[0]?.cnt || 0

    const comments = dataRes.rows.map((row) => {
      const base = serializeComment(row)
      base.destination = row.d_id
        ? { id: row.d_id, name: row.d_name, slug: row.d_slug }
        : null
      return base
    })

    res.json({
      status: 'success',
      data: {
        comments,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      },
    })
  } catch (err) {
    logger.error('[DestinationComments] adminGetAllComments failed:', err)
    next(err)
  }
}

/**
 * DELETE /destination-comments/admin/:commentId
 */
exports.adminDeleteComment = async (req, res, next) => {
  try {
    await ensureCommentsSchema()

    const commentId = safeInt(req.params.commentId, 0, 1)
    if (!commentId) {
      return res.status(400).json({ status: 'error', message: 'Invalid comment ID' })
    }

    const delRes = await query(
      'DELETE FROM destination_comments WHERE id = $1 RETURNING id',
      [commentId],
    )

    if (!delRes.rows[0]) {
      return res.status(404).json({ status: 'error', message: 'Comment not found' })
    }

    res.json({ status: 'success', message: 'Comment deleted successfully' })
  } catch (err) {
    logger.error('[DestinationComments] adminDeleteComment failed:', err)
    next(err)
  }
}

/**
 * PATCH /destination-comments/admin/:commentId/approve
 */
exports.adminApproveComment = async (req, res, next) => {
  try {
    await ensureCommentsSchema()

    const commentId = safeInt(req.params.commentId, 0, 1)
    const { isApproved } = req.body

    if (!commentId) {
      return res.status(400).json({ status: 'error', message: 'Invalid comment ID' })
    }

    const approveFlag = isApproved !== false

    const updRes = await query(
      `UPDATE destination_comments
          SET is_approved = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id`,
      [approveFlag, commentId],
    )

    if (!updRes.rows[0]) {
      return res.status(404).json({ status: 'error', message: 'Comment not found' })
    }

    const fullRes = await query(
      `${COMMENT_SELECT} WHERE c.id = $1 LIMIT 1`,
      [commentId],
    )

    res.json({
      status:  'success',
      message: `Comment ${approveFlag ? 'approved' : 'unapproved'} successfully`,
      data:    serializeComment(fullRes.rows[0]),
    })
  } catch (err) {
    logger.error('[DestinationComments] adminApproveComment failed:', err)
    next(err)
  }
}

module.exports = exports