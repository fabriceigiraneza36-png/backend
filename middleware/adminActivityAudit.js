'use strict'

const jwt = require('jsonwebtoken')
const { query } = require('../config/db')
const { extractToken, isAdminDecoded } = require('./auth')

const ADMIN_ROLES = new Set(['admin', 'superadmin', 'super_admin', 'moderator', 'editor'])
const IGNORED_ACTIONS = new Set([
  'login', 'logout', 'refresh-token', 'verify-token', 'send-otp',
  'verify-otp', 'request-otp', 'passkey-options', 'passkey-verify',
])
const RESOURCE_LABELS = {
  countries: 'country',
  destinations: 'destination',
  packages: 'package',
  bookings: 'booking',
  package_bookings: 'package booking',
  itineraries: 'itinerary',
  users: 'user account',
  posts: 'blog post',
  testimonials: 'testimonial',
  reviews: 'review',
  comments: 'comment',
  messages: 'message',
  conversations: 'conversation',
  contact: 'contact message',
  contact_messages: 'contact message',
  subscribers: 'subscriber',
  team: 'team member',
  team_members: 'team member',
  gallery: 'gallery item',
  faqs: 'FAQ',
  tips: 'travel tip',
  services: 'service',
  pages: 'page',
  notifications: 'notification',
  settings: 'setting',
  'hero-slides': 'hero slide',
  uploads: 'media asset',
  media: 'media asset',
  'admin-info-requests': 'information request',
  'info-requests': 'information request',
  'account-recovery': 'account recovery item',
  maintenance: 'maintenance task',
}
const ACTION_WORDS = {
  approve: 'approved',
  approved: 'approved',
  reject: 'rejected',
  rejected: 'rejected',
  publish: 'published',
  published: 'published',
  archive: 'archived',
  archived: 'archived',
  restore: 'restored',
  restored: 'restored',
  assign: 'assigned',
  assigned: 'assigned',
  confirm: 'confirmed',
  confirmed: 'confirmed',
  cancel: 'cancelled',
  cancelled: 'cancelled',
  complete: 'completed',
  completed: 'completed',
  close: 'closed',
  closed: 'closed',
  reopen: 'reopened',
  reopened: 'reopened',
  feature: 'featured',
  featured: 'featured',
  pin: 'pinned',
  unpin: 'unpinned',
  read: 'marked as read',
  reply: 'replied to',
  react: 'reacted to',
}

const cleanText = (value, max = 180) => {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

const getSafeName = (...sources) => {
  const keys = [
    'name', 'title', 'destination_name', 'country_name', 'package_title',
    'package_name', 'booking_number', 'booking_ref', 'itinerary_name',
    'page_title', 'service_name', 'faq_title', 'request_title',
  ]
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue
    for (const key of keys) {
      const value = cleanText(source[key], 120)
      if (value) return value
    }
    for (const nested of [source.data, source.record, source.item, source.result]) {
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const found = getSafeName(nested)
        if (found) return found
      }
    }
  }
  return ''
}

const getBulkCount = (...sources) => {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const key of ['ids', 'record_ids', 'selected_ids', 'selectedIds', 'destination_ids', 'country_ids']) {
      if (Array.isArray(source[key]) && source[key].length) return source[key].length
    }
    const count = Number(source.deletedCount ?? source.deleted_count ?? source.affectedCount ?? source.affected_count ?? source.count)
    if (Number.isFinite(count) && count > 1) return Math.min(Math.floor(count), 1000000)
  }
  return 0
}

const getAction = (method, path) => {
  const lower = path.toLowerCase()
  const tokens = lower.split('/').filter(Boolean)
  const tail = tokens.slice(-3).reverse()
  if (/portrait|profile[-_]?picture/.test(lower) && /request|requested|portrait/.test(lower)) return 'requested'
  if (/\brequest\b|request-|request_|-request|_request|info-requests|portrait/.test(lower)) return 'requested'
  if (lower.includes('/purge') || lower.includes('/purge-')) return 'purged'
  for (const token of tail) if (ACTION_WORDS[token]) return ACTION_WORDS[token]
  if (lower.includes('/messages') || lower.includes('/message/')) return method === 'POST' ? 'sent' : method === 'DELETE' ? 'deleted' : 'updated'
  if (method === 'POST') return 'created'
  if (method === 'DELETE') return 'deleted'
  if (method === 'PUT' || method === 'PATCH') return 'updated'
  return 'changed'
}

const getResource = (path) => {
  const lower = path.toLowerCase()
  if (/portrait|profile[-_]?picture/.test(lower)) return 'traveller portrait'
  const segments = lower.split('/').filter(Boolean)
  if (segments.includes('conversations')) return 'conversation'
  if (segments.includes('messages')) return 'conversation message'
  const key = segments.find(segment => RESOURCE_LABELS[segment])
  if (key) return RESOURCE_LABELS[key]
  const fallback = segments.find(segment => segment !== 'api' && segment !== 'admin')
  return fallback ? fallback.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) : 'record'
}

const getResourceId = (path) => {
  const segments = path.split('/').filter(Boolean)
  const ignored = new Set([
    ...Object.keys(RESOURCE_LABELS), 'admin', 'api', 'request', 'requests',
    'portrait', 'images', 'image', 'status', 'publish', 'archive', 'restore',
    'approve', 'reject', 'read', 'reply', 'react', 'bulk', 'purge', 'clear-all',
  ])
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index].toLowerCase()
    if (RESOURCE_LABELS[segment] || segment === 'conversations' || segment === 'messages') {
      const next = segments[index + 1]
      if (next && !ignored.has(next.toLowerCase()) && /^[a-z0-9_-]{2,}$/i.test(next)) return next.slice(0, 160)
    }
  }
  return ''
}

const isAdminPanelOrigin = (origin) => {
  if (!origin) return false
  try {
    const host = new URL(origin).hostname.toLowerCase()
    return host === 'altuverapanel.vercel.app'
      || host === 'admin.altuverasafaris.com'
      || host === 'admin.altuvera.com'
      || /^altuverapanel-[a-z0-9-]+\.vercel\.app$/.test(host)
      || host === 'localhost'
      || host === '127.0.0.1'
  } catch {
    return false
  }
}

const adminActivityAudit = (req, res, next) => {
  const method = String(req.method || 'GET').toUpperCase()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next()

  const originalPath = String(req.originalUrl || req.url || '').split('?')[0]
  const path = originalPath.replace(/^\/+/, '').replace(/^api\//i, '').replace(/\/+$/, '')
  if (!path || path.startsWith('admin/activity') || path.startsWith('admin/auth')) return next()
  if (req.body?.__skip_admin_activity_log === true) return next()
  if (!isAdminPanelOrigin(req.headers.origin)) return next()

  const lastSegment = path.split('/').filter(Boolean).slice(-1)[0]?.toLowerCase() || ''
  if (IGNORED_ACTIONS.has(lastSegment)) return next()

  let decoded = null
  try {
    const token = extractToken(req)
    if (token && process.env.JWT_SECRET) decoded = jwt.verify(token, process.env.JWT_SECRET)
  } catch { /* invalid tokens are never audited */ }
  if (!decoded) return next()

  let responseBody = null
  const originalJson = res.json
  res.json = function captureAdminActivityResponse(body) {
    responseBody = body
    return originalJson.call(this, body)
  }

  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return
    const actor = req.user || req.admin || req.adminUser || {}
    const role = cleanText(actor.role || decoded.role || (decoded.type === 'admin' ? 'admin' : ''), 80)
    const actorIsAdmin = req.userType === 'admin' || actor.isAdmin === true
      || ADMIN_ROLES.has(role.toLowerCase()) || isAdminDecoded(decoded)
    if (!actorIsAdmin) return

    const resource = getResource(path)
    const action = getAction(method, path)
    const name = getSafeName(req.body, responseBody)
    const resourceId = getResourceId(path)
    const count = getBulkCount(req.body, responseBody?.data, responseBody)
    const bulk = count > 1
    const isPortrait = resource === 'traveller portrait'
    const objectLabel = isPortrait ? 'traveller portrait' : resource
    const subject = name ? ' “' + name + '”' : resourceId ? ' #' + resourceId : ''
    let summary
    if (isPortrait && action === 'requested') {
      summary = 'Requested a traveller portrait' + (resourceId ? ' for booking #' + resourceId : '')
    } else if (action === 'purged') {
      summary = 'Purged ' + resource + ' records'
    } else if (bulk && action === 'deleted') {
      summary = 'Deleted ' + count.toLocaleString('en-US') + ' ' + resource + (count === 1 ? '' : ' records')
    } else if (action === 'sent' && resource === 'conversation message') {
      summary = 'Sent a message in conversation' + subject
    } else {
      const verb = action === 'created' ? 'Created'
        : action === 'updated' ? 'Updated'
        : action === 'deleted' ? 'Deleted'
        : action === 'requested' ? 'Requested'
        : action.charAt(0).toUpperCase() + action.slice(1)
      summary = verb + ' ' + objectLabel + subject
    }

    const actorId = cleanText(actor.id ?? decoded.id ?? decoded.sub ?? '', 120)
    const actorName = cleanText(
      actor.full_name || actor.fullName || actor.name || actor.username
      || decoded.full_name || decoded.fullName || decoded.name || decoded.username || 'Administrator',
      255,
    )
    const actorEmail = cleanText(actor.email || decoded.email || '', 255)
    const endpoint = '/' + path.slice(0, 500)

    void query(
      `INSERT INTO admin_activity_logs
        (actor_id, actor_name, actor_email, actor_role, action, resource, resource_id,
         resource_name, summary, method, endpoint, status_code, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        actorId || null, actorName, actorEmail || null, role || 'admin',
        action, resource, resourceId || null, name || null, summary,
        method, endpoint, res.statusCode,
        JSON.stringify({
          source: 'admin_panel',
          bulk,
          count: count || 1,
          action_path: endpoint,
        }),
      ],
    ).catch(() => { /* journal writes must never interrupt an admin action */ })
  })

  next()
}

module.exports = adminActivityAudit
