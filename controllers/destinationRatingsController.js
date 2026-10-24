'use strict'

const { query } = require('../config/db')

let schemaPromise = null

const ensureRatingSchema = async () => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query('CREATE TABLE IF NOT EXISTS destination_ratings (id BIGSERIAL PRIMARY KEY, destination_id BIGINT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, session_id VARCHAR(255), rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5), review TEXT, is_approved BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT destination_ratings_unique_user UNIQUE (destination_id, user_id), CONSTRAINT destination_ratings_unique_session UNIQUE (destination_id, session_id))')
      await query('CREATE INDEX IF NOT EXISTS idx_destination_ratings_destination_id ON destination_ratings(destination_id)')
      await query('CREATE INDEX IF NOT EXISTS idx_destination_ratings_user_id ON destination_ratings(user_id)')
    })().catch((error) => {
      schemaPromise = null
      throw error
    })
  }
  return schemaPromise
}

const parseId = (value) => {
  const raw = String(value ?? '').trim()
  if (!/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

const currentUserId = (req) => parseId(req.user?.id ?? req.user?.userId ?? req.user?.user_id)

const getDestination = async (id) => {
  const result = await query('SELECT id, name, slug FROM destinations WHERE id = $1 LIMIT 1', [id])
  return result.rows[0] || null
}

const getStatsForDestination = async (destinationId) => {
  await ensureRatingSchema()
  const aggregate = await query(
    'SELECT COUNT(*)::INTEGER AS total_ratings, COALESCE(ROUND(AVG(rating)::numeric, 2), 0)::FLOAT AS average_rating FROM destination_ratings WHERE destination_id = $1 AND is_approved = TRUE',
    [destinationId],
  )
  const distribution = await query(
    'SELECT rating, COUNT(*)::INTEGER AS count FROM destination_ratings WHERE destination_id = $1 AND is_approved = TRUE GROUP BY rating',
    [destinationId],
  )
  const summary = aggregate.rows[0] || { total_ratings: 0, average_rating: 0 }
  const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
  for (const row of distribution.rows) ratingDistribution[Number(row.rating)] = Number(row.count) || 0
  return {
    totalRatings: Number(summary.total_ratings) || 0,
    averageRating: Number(Number(summary.average_rating || 0).toFixed(2)),
    ratingDistribution,
  }
}

const syncDestinationSummary = async (destinationId) => {
  const stats = await getStatsForDestination(destinationId)
  // Persist the current average/count on the destination row as well as keeping
  // individual votes in destination_ratings. The aggregate remains derived
  // from approved user votes, so removals/moderation never leave stale totals.
  await query(
    'UPDATE destinations SET rating = $2, review_count = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [destinationId, stats.totalRatings ? stats.averageRating : 0, stats.totalRatings],
  )
  return stats
}

const userDetails = "CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id', u.id, 'name', COALESCE(to_jsonb(u)->>'full_name', to_jsonb(u)->>'name', 'Traveller'), 'email', to_jsonb(u)->>'email', 'avatar', COALESCE(to_jsonb(u)->>'avatar_url', to_jsonb(u)->>'avatar')) END AS user"

exports.ensureRatingSchema = ensureRatingSchema
exports.getStatsForDestination = getStatsForDestination

exports.getRatings = async (req, res, next) => {
  try {
    await ensureRatingSchema()
    const destinationId = parseId(req.params.destinationId)
    if (!destinationId) return res.status(400).json({ success: false, status: 'error', message: 'Invalid destination ID' })
    if (!(await getDestination(destinationId))) return res.status(404).json({ success: false, status: 'error', message: 'Destination not found' })

    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20))
    const approved = req.query.approved === 'false' ? false : true
    const offset = (page - 1) * limit
    const countResult = await query('SELECT COUNT(*)::INTEGER AS total FROM destination_ratings WHERE destination_id = $1 AND is_approved = $2', [destinationId, approved])
    const result = await query(
      'SELECT r.id, r.destination_id AS "destinationId", r.user_id AS "userId", r.rating, r.review, r.is_approved AS "isApproved", r.created_at AS "createdAt", r.updated_at AS "updatedAt", ' + userDetails + ' FROM destination_ratings r LEFT JOIN users u ON u.id = r.user_id WHERE r.destination_id = $1 AND r.is_approved = $2 ORDER BY r.created_at DESC LIMIT $3 OFFSET $4',
      [destinationId, approved, limit, offset],
    )
    const total = Number(countResult.rows[0]?.total) || 0
    return res.json({ success: true, status: 'success', data: { ratings: result.rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) } } })
  } catch (error) {
    return next(error)
  }
}

exports.getRatingStats = async (req, res, next) => {
  try {
    await ensureRatingSchema()
    const destinationId = parseId(req.params.destinationId)
    if (!destinationId) return res.status(400).json({ success: false, status: 'error', message: 'Invalid destination ID' })
    if (!(await getDestination(destinationId))) return res.status(404).json({ success: false, status: 'error', message: 'Destination not found' })
    const stats = await getStatsForDestination(destinationId)
    return res.json({ success: true, status: 'success', data: stats })
  } catch (error) {
    return next(error)
  }
}

exports.getRating = async (req, res, next) => {
  try {
    await ensureRatingSchema()
    const destinationId = parseId(req.params.destinationId)
    const ratingId = parseId(req.params.ratingId)
    if (!destinationId || !ratingId) return res.status(400).json({ success: false, status: 'error', message: 'Invalid rating ID' })
    const result = await query(
      'SELECT r.id, r.destination_id AS "destinationId", r.user_id AS "userId", r.rating, r.review, r.is_approved AS "isApproved", r.created_at AS "createdAt", r.updated_at AS "updatedAt", ' + userDetails + ' FROM destination_ratings r LEFT JOIN users u ON u.id = r.user_id WHERE r.destination_id = $1 AND r.id = $2 LIMIT 1',
      [destinationId, ratingId],
    )
    if (!result.rows.length) return res.status(404).json({ success: false, status: 'error', message: 'Rating not found' })
    return res.json({ success: true, status: 'success', data: result.rows[0] })
  } catch (error) {
    return next(error)
  }
}

exports.createOrUpdateRating = async (req, res, next) => {
  try {
    await ensureRatingSchema()
    const destinationId = parseId(req.params.destinationId)
    const userId = currentUserId(req)
    const rating = Number(req.body?.rating)
    const review = typeof req.body?.review === 'string' ? req.body.review.trim().slice(0, 4000) : null

    if (!destinationId) return res.status(400).json({ success: false, status: 'error', message: 'Invalid destination ID' })
    if (!userId) return res.status(401).json({ success: false, status: 'error', message: 'Sign in to rate a destination' })
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ success: false, status: 'error', message: 'Rating must be a whole number from 1 to 5' })
    if (!(await getDestination(destinationId))) return res.status(404).json({ success: false, status: 'error', message: 'Destination not found' })

    const existing = await query('SELECT id, rating, review, created_at FROM destination_ratings WHERE destination_id = $1 AND user_id = $2 LIMIT 1', [destinationId, userId])
    if (existing.rows.length) {
      const priorRating = existing.rows[0]
      return res.status(409).json({
        success: false,
        status: 'error',
        code: 'DESTINATION_ALREADY_RATED',
        message: 'You have already rated this destination. Each account can rate a destination only once.',
        data: { rating: { id: priorRating.id, rating: priorRating.rating, review: priorRating.review, createdAt: priorRating.created_at } },
      })
    }

    let inserted
    try {
      inserted = await query(
        'INSERT INTO destination_ratings (destination_id, user_id, session_id, rating, review, is_approved, created_at, updated_at) VALUES ($1, $2, NULL, $3, $4, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id, destination_id AS "destinationId", user_id AS "userId", rating, review, is_approved AS "isApproved", created_at AS "createdAt", updated_at AS "updatedAt"',
        [destinationId, userId, rating, review],
      )
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, status: 'error', code: 'DESTINATION_ALREADY_RATED', message: 'You have already rated this destination. Each account can rate a destination only once.' })
      }
      throw error
    }

    const stats = await syncDestinationSummary(destinationId)
    const responseRating = inserted.rows[0]
    return res.status(201).json({ success: true, status: 'success', message: 'Thank you for rating this destination', data: { rating: responseRating, stats } })
  } catch (error) {
    return next(error)
  }
}

exports.getUserRating = async (req, res, next) => {
  try {
    await ensureRatingSchema()
    const destinationId = parseId(req.params.destinationId)
    const userId = currentUserId(req)
    if (!destinationId) return res.status(400).json({ success: false, status: 'error', message: 'Invalid destination ID' })
    if (!userId) return res.json({ success: true, status: 'success', data: { rating: null } })
    const result = await query(
      'SELECT id, destination_id AS "destinationId", user_id AS "userId", rating, review, is_approved AS "isApproved", created_at AS "createdAt" FROM destination_ratings WHERE destination_id = $1 AND user_id = $2 LIMIT 1',
      [destinationId, userId],
    )
    return res.json({ success: true, status: 'success', data: { rating: result.rows[0] || null } })
  } catch (error) {
    return next(error)
  }
}

exports.deleteRating = async (req, res, next) => {
  try {
    await ensureRatingSchema()
    const destinationId = parseId(req.params.destinationId)
    const ratingId = parseId(req.params.ratingId)
    const userId = currentUserId(req)
    const role = String(req.user?.role || req.userType || '').toLowerCase()
    const isAdmin = role === 'admin' || role === 'super_admin' || req.user?.isAdmin === true
    if (!destinationId || !ratingId) return res.status(400).json({ success: false, status: 'error', message: 'Invalid rating ID' })
    if (!isAdmin) return res.status(403).json({ success: false, status: 'error', message: 'Ratings are one-time submissions. Contact an administrator if moderation is required.' })
    const deleted = await query('DELETE FROM destination_ratings WHERE id = $1 AND destination_id = $2 RETURNING id', [ratingId, destinationId])
    if (!deleted.rows.length) return res.status(404).json({ success: false, status: 'error', message: 'Rating not found' })
    const stats = await syncDestinationSummary(destinationId)
    return res.json({ success: true, status: 'success', message: 'Rating deleted', data: { stats } })
  } catch (error) {
    return next(error)
  }
}

exports.approveRating = async (req, res, next) => {
  try {
    await ensureRatingSchema()
    const destinationId = parseId(req.params.destinationId)
    const ratingId = parseId(req.params.ratingId)
    const isApproved = req.body?.isApproved ?? req.body?.is_approved
    if (!destinationId || !ratingId) return res.status(400).json({ success: false, status: 'error', message: 'Invalid rating ID' })
    if (typeof isApproved !== 'boolean') return res.status(400).json({ success: false, status: 'error', message: 'isApproved must be true or false' })
    const updated = await query(
      'UPDATE destination_ratings SET is_approved = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND destination_id = $2 RETURNING id, destination_id AS "destinationId", user_id AS "userId", rating, review, is_approved AS "isApproved", created_at AS "createdAt", updated_at AS "updatedAt"',
      [ratingId, destinationId, isApproved],
    )
    if (!updated.rows.length) return res.status(404).json({ success: false, status: 'error', message: 'Rating not found' })
    const stats = await syncDestinationSummary(destinationId)
    return res.json({ success: true, status: 'success', message: isApproved ? 'Rating approved' : 'Rating hidden', data: { rating: updated.rows[0], stats } })
  } catch (error) {
    return next(error)
  }
}

exports.getAllRatingsAdmin = async (req, res, next) => {
  try {
    await ensureRatingSchema()
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25))
    const offset = (page - 1) * limit
    const status = String(req.query.status || 'all').toLowerCase()
    const conditions = []
    const params = []
    if (status === 'approved') { params.push(true); conditions.push('r.is_approved = $' + params.length) }
    if (status === 'hidden' || status === 'pending') { params.push(false); conditions.push('r.is_approved = $' + params.length) }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    const countResult = await query('SELECT COUNT(*)::INTEGER AS total FROM destination_ratings r ' + where, params)
    params.push(limit)
    const limitParam = params.length
    params.push(offset)
    const offsetParam = params.length
    const result = await query(
      'SELECT r.id, r.destination_id AS "destinationId", r.user_id AS "userId", r.rating, r.review, r.is_approved AS "isApproved", r.created_at AS "createdAt", r.updated_at AS "updatedAt", d.name AS "destinationName", d.slug AS "destinationSlug", ' + userDetails + ' FROM destination_ratings r LEFT JOIN destinations d ON d.id = r.destination_id LEFT JOIN users u ON u.id = r.user_id ' + where + ' ORDER BY r.created_at DESC LIMIT $' + limitParam + ' OFFSET $' + offsetParam,
      params,
    )
    const total = Number(countResult.rows[0]?.total) || 0
    const summary = await query('SELECT COUNT(*)::INTEGER AS total, COALESCE(ROUND(AVG(rating)::numeric, 2), 0)::FLOAT AS average, COUNT(*) FILTER (WHERE is_approved = TRUE)::INTEGER AS approved FROM destination_ratings')
    return res.json({ success: true, status: 'success', data: { ratings: result.rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) }, summary: summary.rows[0] || { total: 0, average: 0, approved: 0 } } })
  } catch (error) {
    return next(error)
  }
}
