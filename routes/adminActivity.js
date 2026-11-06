'use strict'

const express = require('express')
const router = express.Router()
const { query } = require('../config/db')
const { adminOnly } = require('../middleware/auth')

const safeDate = (value) => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

router.get('/', adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const limit = Math.min(100, Math.max(10, Math.floor(Number(req.query.limit) || 30)))
    const offset = (page - 1) * limit
    const sort = String(req.query.sort || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
    const clauses = []
    const params = []

    const add = (clause, value) => {
      params.push(value)
      clauses.push(clause.replace('?', '$' + params.length))
    }

    const action = String(req.query.action || '').trim().slice(0, 50)
    const resource = String(req.query.resource || '').trim().slice(0, 80)
    const search = String(req.query.search || '').trim().slice(0, 120)
    const from = safeDate(req.query.from)
    const to = safeDate(req.query.to)

    if (action && action !== 'all') add('action = ?', action)
    if (resource && resource !== 'all') add('resource = ?', resource)
    if (from) add('created_at >= ?', from.toISOString())
    if (to) {
      const nextDay = new Date(to)
      nextDay.setDate(nextDay.getDate() + 1)
      add('created_at < ?', nextDay.toISOString())
    }
    if (search) {
      params.push('%' + search.replace(/[\\%_]/g, '\\$&') + '%')
      const slot = '$' + params.length
      clauses.push('(summary ILIKE ' + slot + ' OR actor_name ILIKE ' + slot + ' OR resource_name ILIKE ' + slot + ' OR endpoint ILIKE ' + slot + ')')
    }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
    const countResult = await query(
      'SELECT COUNT(*)::int AS total FROM admin_activity_logs ' + where,
      params,
    )
    const rowsResult = await query(
      `SELECT id, actor_id, actor_name, actor_email, actor_role, action, resource,
              resource_id, resource_name, summary, method, endpoint, status_code,
              metadata, created_at
         FROM admin_activity_logs
         ${where}
        ORDER BY created_at ${sort}, id ${sort}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    )
    const statsResult = await query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()))::int AS today,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_seven_days
      FROM admin_activity_logs
    `)

    const total = Number(countResult.rows[0]?.total || 0)
    return res.json({
      success: true,
      data: rowsResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: page * limit < total,
      },
      stats: statsResult.rows[0] || { total: 0, today: 0, last_seven_days: 0 },
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Unable to load the admin activity journal.',
    })
  }
})

module.exports = router
