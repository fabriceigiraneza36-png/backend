// routes/packages.js
const express  = require('express')
const router   = express.Router()
const { query: db } = require('../config/db')
const { authenticate, optionalAuth, requireAdmin } = require('../middleware/auth')
const logger   = require('../utils/logger')

// ── helpers ──────────────────────────────────────────────────────────────────

const slugify = (str) =>
  str.toLowerCase().trim()
     .replace(/[^\w\s-]/g, '')
     .replace(/\s+/g, '-')
     .replace(/-+/g, '-')

const genBookingRef = (id) =>
  `PKG-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(id).padStart(5,'0')}`

const parseJsonField = (val, fallback = []) => {
  if (!val) return fallback
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return fallback }
  }
  return val
}

// ── socket helper — emit to admin room ───────────────────────────────────────
const emitToAdmin = (req, event, data) => {
  try {
    const io = req.app.get('io')
    if (io) io.to('admin-room').emit(event, data)
  } catch (_) {}
}

const emitToUser = (req, userId, event, data) => {
  try {
    const io = req.app.get('io')
    if (io) io.to(`user-${userId}`).emit(event, data)
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/packages — list published packages
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      page = 1, limit = 12, category, featured,
      search, sortBy = 'sort_order', order = 'asc',
      minPrice, maxPrice, duration, country,
    } = req.query

    const offset  = (parseInt(page) - 1) * parseInt(limit)
    const params  = []
    const filters = [`p.is_published = true`, `p.is_active = true`]
    let   pi      = 1

    if (category) { filters.push(`p.category = $${pi++}`); params.push(category) }
    if (featured === 'true') { filters.push(`p.is_featured = true`) }
    if (country)  { filters.push(`p.country ILIKE $${pi++}`); params.push(`%${country}%`) }
    if (minPrice) { filters.push(`p.price >= $${pi++}`); params.push(parseFloat(minPrice)) }
    if (maxPrice) { filters.push(`p.price <= $${pi++}`); params.push(parseFloat(maxPrice)) }
    if (duration) { filters.push(`p.duration_days <= $${pi++}`); params.push(parseInt(duration)) }
    if (search) {
      filters.push(`(
        p.title ILIKE $${pi} OR
        p.short_description ILIKE $${pi} OR
        p.destination ILIKE $${pi} OR
        p.country ILIKE $${pi}
      )`)
      params.push(`%${search}%`); pi++
    }

    const safeSort  = ['sort_order','price','created_at','view_count','booking_count','title'].includes(sortBy)
      ? sortBy : 'sort_order'
    const safeOrder = order === 'desc' ? 'DESC' : 'ASC'
    const where     = filters.join(' AND ')

    const [rows, countRow] = await Promise.all([
      db(`
        SELECT
          p.id, p.title, p.slug, p.short_description, p.category,
          p.destination, p.country, p.price, p.price_label, p.currency,
          p.pricing_tiers, p.discount_percent, p.is_price_visible,
          p.duration_days, p.duration_nights, p.max_travelers, p.min_travelers,
          p.thumbnail_url, p.cover_image_url, p.images,
          p.features, p.highlights, p.tags,
          p.is_featured, p.is_sold_out, p.badge_label, p.badge_color,
          p.card_theme, p.accent_color, p.card_bg_image,
          p.view_count, p.booking_count, p.inquiry_count,
          p.available_months, p.availability_note,
          p.created_at, p.updated_at
        FROM packages p
        WHERE ${where}
        ORDER BY p.${safeSort} ${safeOrder}
        LIMIT $${pi++} OFFSET $${pi++}
      `, [...params, parseInt(limit), offset]),
      db(`SELECT COUNT(*) FROM packages p WHERE ${where}`, params),
    ])

    const total = parseInt(countRow.rows[0].count)

    res.json({
      success: true,
      data: rows.rows,
      pagination: {
        page: parseInt(page), limit: parseInt(limit),
        total, totalPages: Math.ceil(total / parseInt(limit)),
      },
    })
  } catch (err) {
    logger.error('[Packages] list error:', err.message)
    res.status(500).json({ error: 'Failed to fetch packages' })
  }
})

// GET /api/packages/categories
router.get('/categories', async (req, res) => {
  try {
    const { rows } = await db(`
      SELECT category, COUNT(*) as count
      FROM packages
      WHERE is_published = true AND is_active = true AND category IS NOT NULL
      GROUP BY category ORDER BY count DESC
    `)
    res.json({ success: true, data: rows })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories' })
  }
})

// GET /api/packages/featured
router.get('/featured', async (req, res) => {
  try {
    const { limit = 6 } = req.query
    const { rows } = await db(`
      SELECT
        id, title, slug, short_description, category,
        destination, country, price, price_label, currency,
        discount_percent, is_price_visible,
        duration_days, thumbnail_url, cover_image_url,
        features, highlights, tags,
        is_sold_out, badge_label, badge_color,
        card_theme, accent_color, card_bg_image,
        view_count, booking_count
      FROM packages
      WHERE is_published = true AND is_active = true AND is_featured = true
      ORDER BY sort_order ASC, created_at DESC
      LIMIT $1
    `, [parseInt(limit)])
    res.json({ success: true, data: rows })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch featured packages' })
  }
})

// GET /api/packages/stats  (admin only — placed before :id to avoid conflict)
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [pkgStats, bookStats, msgStats] = await Promise.all([
      db(`
        SELECT
          COUNT(*)                                    AS total,
          COUNT(*) FILTER (WHERE is_published)        AS published,
          COUNT(*) FILTER (WHERE NOT is_published)    AS drafts,
          COUNT(*) FILTER (WHERE is_featured)         AS featured,
          COALESCE(SUM(view_count),0)                 AS total_views,
          COALESCE(SUM(booking_count),0)              AS total_bookings
        FROM packages WHERE is_active = true
      `),
      db(`
        SELECT
          COUNT(*)                                         AS total,
          COUNT(*) FILTER (WHERE status = 'pending')       AS pending,
          COUNT(*) FILTER (WHERE status = 'confirmed')     AS confirmed,
          COUNT(*) FILTER (WHERE status = 'cancelled')     AS cancelled,
          COUNT(*) FILTER (WHERE status = 'needs_info')    AS needs_info,
          COALESCE(SUM(total_price),0)                     AS total_revenue
        FROM package_bookings
      `),
      db(`
        SELECT
          COUNT(*)                              AS total,
          COUNT(*) FILTER (WHERE NOT is_read)   AS unread
        FROM package_messages WHERE sender_type != 'admin'
      `),
    ])

    res.json({
      success: true,
      packages:  pkgStats.rows[0],
      bookings:  bookStats.rows[0],
      messages:  msgStats.rows[0],
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// GET /api/packages/bookings/all  (admin)
router.get('/bookings/all', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const params = []; const filters = []; let pi = 1

    if (status) { filters.push(`pb.status = $${pi++}`); params.push(status) }
    if (search) {
      filters.push(`(pb.guest_name ILIKE $${pi} OR pb.guest_email ILIKE $${pi} OR pb.booking_ref ILIKE $${pi})`)
      params.push(`%${search}%`); pi++
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

    const [rows, cnt] = await Promise.all([
      db(`
        SELECT pb.*, p.title AS package_title, p.slug AS package_slug,
               p.thumbnail_url AS package_image
        FROM package_bookings pb
        LEFT JOIN packages p ON pb.package_id = p.id
        ${where}
        ORDER BY pb.created_at DESC
        LIMIT $${pi++} OFFSET $${pi++}
      `, [...params, parseInt(limit), offset]),
      db(`SELECT COUNT(*) FROM package_bookings pb ${where}`, params),
    ])

    res.json({
      success: true,
      data: rows.rows,
      pagination: {
        page: parseInt(page), limit: parseInt(limit),
        total: parseInt(cnt.rows[0].count),
        totalPages: Math.ceil(parseInt(cnt.rows[0].count) / parseInt(limit)),
      },
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bookings' })
  }
})

// GET /api/packages/my/messages  (logged-in user)
router.get('/my/messages', authenticate, async (req, res) => {
  try {
    const { rows } = await db(`
      SELECT pm.*, p.title AS package_title, p.slug AS package_slug
      FROM package_messages pm
      LEFT JOIN packages p ON pm.package_id = p.id
      WHERE pm.sender_id = $1 AND pm.sender_type = 'user'
      ORDER BY pm.created_at DESC
      LIMIT 50
    `, [req.user.id])
    res.json({ success: true, data: rows })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' })
  }
})

// GET /api/packages/my/bookings  (logged-in user)
router.get('/my/bookings', authenticate, async (req, res) => {
  try {
    const { rows } = await db(`
      SELECT pb.*, p.title AS package_title, p.slug AS package_slug,
             p.thumbnail_url AS package_image, p.duration_days
      FROM package_bookings pb
      LEFT JOIN packages p ON pb.package_id = p.id
      WHERE pb.user_id = $1
      ORDER BY pb.created_at DESC
    `, [req.user.id])
    res.json({ success: true, data: rows })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bookings' })
  }
})

// GET /api/packages/my/info-requests  (logged-in user)
router.get('/my/info-requests', authenticate, async (req, res) => {
  try {
    const { rows } = await db(`
      SELECT air.*, p.title AS package_title, p.slug AS package_slug
      FROM admin_info_requests air
      LEFT JOIN packages p ON air.package_id = p.id
      WHERE air.user_id = $1 AND air.status = 'pending'
      ORDER BY air.created_at DESC
    `, [req.user.id])
    res.json({ success: true, data: rows })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch info requests' })
  }
})

// GET /api/packages/slug/:slug
router.get('/slug/:slug', optionalAuth, async (req, res) => {
  try {
    const { rows } = await db(`
      SELECT * FROM packages
      WHERE slug = $1 AND is_published = true AND is_active = true
    `, [req.params.slug])

    if (!rows.length) return res.status(404).json({ error: 'Package not found' })

    // Increment view count (fire and forget)
    db(`UPDATE packages SET view_count = view_count + 1 WHERE id = $1`, [rows[0].id]).catch(() => {})

    res.json({ success: true, data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch package' })
  }
})

// POST /api/packages/:id/view
router.post('/:id/view', async (req, res) => {
  await db(`UPDATE packages SET view_count = view_count + 1 WHERE id = $1`, [req.params.id]).catch(() => {})
  res.json({ success: true })
})

// GET /api/packages/:id  — full detail (public)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { rows } = await db(
      `SELECT * FROM packages WHERE id = $1 AND is_published = true AND is_active = true`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Package not found' })
    res.json({ success: true, data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch package' })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — CRUD
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/packages  — admin: all packages (override with admin param)
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const {
      page = 1, limit = 20, search, sortBy = 'created_at',
      order = 'desc', category, published,
    } = req.query

    const offset  = (parseInt(page) - 1) * parseInt(limit)
    const params  = []; const filters = [`p.is_active = true`]; let pi = 1

    if (category)  { filters.push(`p.category = $${pi++}`); params.push(category) }
    if (published !== undefined && published !== '') {
      filters.push(`p.is_published = $${pi++}`)
      params.push(published === 'true')
    }
    if (search) {
      filters.push(`(p.title ILIKE $${pi} OR p.destination ILIKE $${pi})`)
      params.push(`%${search}%`); pi++
    }

    const safeSort  = ['created_at','price','title','sort_order','view_count','booking_count'].includes(sortBy) ? sortBy : 'created_at'
    const safeOrder = order === 'asc' ? 'ASC' : 'DESC'
    const where     = filters.join(' AND ')

    const [rows, cnt] = await Promise.all([
      db(`
        SELECT
          p.*,
          (SELECT COUNT(*) FROM package_bookings pb WHERE pb.package_id = p.id) AS actual_bookings,
          (SELECT COUNT(*) FROM package_messages pm WHERE pm.package_id = p.id AND pm.sender_type != 'admin') AS actual_messages
        FROM packages p
        WHERE ${where}
        ORDER BY p.${safeSort} ${safeOrder}
        LIMIT $${pi++} OFFSET $${pi++}
      `, [...params, parseInt(limit), offset]),
      db(`SELECT COUNT(*) FROM packages p WHERE ${where}`, params),
    ])

    res.json({
      success: true,
      data: rows.rows,
      pagination: {
        page: parseInt(page), limit: parseInt(limit),
        total: parseInt(cnt.rows[0].count),
        totalPages: Math.ceil(parseInt(cnt.rows[0].count) / parseInt(limit)),
      },
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch packages' })
  }
})

// POST /api/packages  (admin create)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const {
      title, slug, short_description, description, content, category,
      destination, country, price, price_label, currency, pricing_tiers,
      discount_percent, is_price_visible, duration_days, duration_nights,
      max_travelers, min_travelers, group_size_label, images, cover_image_url,
      thumbnail_url, video_url, gallery, features, inclusions, exclusions,
      highlights, itinerary, faqs, tags, available_months, departure_dates,
      availability_note, is_published, is_featured, is_sold_out,
      badge_label, badge_color, meta_title, meta_description,
      card_theme, accent_color, card_bg_image, sort_order,
    } = req.body

    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' })

    const finalSlug = slug?.trim() || slugify(title)

    const { rows } = await db(`
      INSERT INTO packages (
        title, slug, short_description, description, content, category,
        destination, country, price, price_label, currency, pricing_tiers,
        discount_percent, is_price_visible, duration_days, duration_nights,
        max_travelers, min_travelers, group_size_label, images, cover_image_url,
        thumbnail_url, video_url, gallery, features, inclusions, exclusions,
        highlights, itinerary, faqs, tags, available_months, departure_dates,
        availability_note, is_published, is_featured, is_sold_out,
        badge_label, badge_color, meta_title, meta_description,
        card_theme, accent_color, card_bg_image, sort_order,
        author_id, author_name,
        published_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::JSONB,$13,$14,$15,$16,
        $17,$18,$19,$20::JSONB,$21,$22,$23,$24::JSONB,$25::JSONB,$26::JSONB,
        $27::JSONB,$28::JSONB,$29::JSONB,$30::JSONB,$31,$32::JSONB,$33::JSONB,
        $34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,
        $46,$47,
        $48
      )
      RETURNING *
    `, [
      title.trim(), finalSlug, short_description, description, content, category,
      destination, country,
      parseFloat(price) || 0, price_label || 'per person', currency || 'USD',
      JSON.stringify(pricing_tiers || []),
      parseInt(discount_percent) || 0, is_price_visible !== false,
      parseInt(duration_days) || null, parseInt(duration_nights) || null,
      parseInt(max_travelers) || null, parseInt(min_travelers) || 1,
      group_size_label,
      JSON.stringify(images || []), cover_image_url, thumbnail_url, video_url,
      JSON.stringify(gallery || []),
      JSON.stringify(features || []), JSON.stringify(inclusions || []),
      JSON.stringify(exclusions || []), JSON.stringify(highlights || []),
      JSON.stringify(itinerary || []), JSON.stringify(faqs || []),
      tags || [], JSON.stringify(available_months || []),
      JSON.stringify(departure_dates || []), availability_note,
      Boolean(is_published), Boolean(is_featured), Boolean(is_sold_out),
      badge_label, badge_color || '#047857',
      meta_title, meta_description,
      card_theme || 'default', accent_color || '#047857', card_bg_image,
      parseInt(sort_order) || 0,
      req.user.id, req.user.full_name || req.user.name || 'Admin',
      is_published ? new Date() : null,
    ])

    emitToAdmin(req, 'pkg:new-package', rows[0])
    res.status(201).json({ success: true, data: rows[0] })
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Slug already exists' })
    logger.error('[Packages] create error:', err.message)
    res.status(500).json({ error: 'Failed to create package' })
  }
})

// PATCH /api/packages/:id  (admin update)
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const body = req.body
    const sets = []; const params = []; let pi = 1

    const fields = [
      'title','slug','short_description','description','content','category',
      'destination','country','price','price_label','currency','discount_percent',
      'is_price_visible','duration_days','duration_nights','max_travelers',
      'min_travelers','group_size_label','cover_image_url','thumbnail_url',
      'video_url','availability_note','is_published','is_featured',
      'is_sold_out','badge_label','badge_color','meta_title','meta_description',
      'card_theme','accent_color','card_bg_image','sort_order',
    ]
    const jsonFields = [
      'pricing_tiers','images','gallery','features','inclusions','exclusions',
      'highlights','itinerary','faqs','available_months','departure_dates',
    ]

    for (const f of fields) {
      if (body[f] !== undefined) {
        sets.push(`${f} = $${pi++}`)
        params.push(body[f])
      }
    }
    for (const f of jsonFields) {
      if (body[f] !== undefined) {
        sets.push(`${f} = $${pi++}::JSONB`)
        params.push(JSON.stringify(body[f]))
      }
    }
    if (body.tags !== undefined) {
      sets.push(`tags = $${pi++}`); params.push(body.tags || [])
    }
    if (body.is_published === true) {
      sets.push(`published_at = COALESCE(published_at, NOW())`)
    }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' })
    sets.push(`updated_at = NOW()`)

    params.push(id)
    const { rows } = await db(
      `UPDATE packages SET ${sets.join(', ')} WHERE id = $${pi} AND is_active = true RETURNING *`,
      params
    )
    if (!rows.length) return res.status(404).json({ error: 'Package not found' })

    emitToAdmin(req, 'pkg:updated', rows[0])
    res.json({ success: true, data: rows[0] })
  } catch (err) {
    logger.error('[Packages] update error:', err.message)
    res.status(500).json({ error: 'Failed to update package' })
  }
})

// POST /api/packages/:id/publish
router.post('/:id/publish', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db(`
      UPDATE packages SET is_published = true, published_at = COALESCE(published_at, NOW()), updated_at = NOW()
      WHERE id = $1 AND is_active = true RETURNING id, title, is_published
    `, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Package not found' })
    res.json({ success: true, data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to publish' })
  }
})

// POST /api/packages/:id/unpublish
router.post('/:id/unpublish', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db(`
      UPDATE packages SET is_published = false, updated_at = NOW()
      WHERE id = $1 AND is_active = true RETURNING id, title, is_published
    `, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Package not found' })
    res.json({ success: true, data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to unpublish' })
  }
})

// DELETE /api/packages/:id  (soft delete)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await db(`UPDATE packages SET is_active = false, updated_at = NOW() WHERE id = $1`, [req.params.id])
    res.json({ success: true, message: 'Package deleted' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// PACKAGE MESSAGES
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/packages/:id/messages
router.get('/:id/messages', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const pkgId  = req.params.id

    let userFilter = ''
    const params = [pkgId]

    // Non-admin users only see their own messages + admin replies to them
    if (!req.user?.role || req.user.role !== 'admin') {
      if (req.user?.id) {
        userFilter = ` AND (pm.sender_id = $2 OR pm.sender_type = 'admin')`
        params.push(req.user.id)
      } else {
        return res.json({ success: true, data: [], pagination: { total: 0 } })
      }
    }

    const { rows } = await db(`
      SELECT pm.*,
             air.title   AS info_request_title,
             air.fields  AS info_request_fields,
             air.theme   AS info_request_theme,
             air.accent_color AS info_request_accent,
             air.status  AS info_request_status,
             air.response AS info_request_response
      FROM package_messages pm
      LEFT JOIN admin_info_requests air ON air.message_id = pm.id
      WHERE pm.package_id = $1 ${userFilter}
      ORDER BY pm.created_at ASC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `, params)

    res.json({ success: true, data: rows })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' })
  }
})

// POST /api/packages/:id/messages  (user sends message)
router.post('/:id/messages', optionalAuth, async (req, res) => {
  try {
    const pkgId = req.params.id
    const {
      body: msgBody, message_type = 'inquiry', subject,
      sender_name, sender_email, metadata = {},
    } = req.body

    if (!msgBody?.trim()) return res.status(400).json({ error: 'Message body required' })

    // Check package exists
    const pkg = await db(`SELECT id, title FROM packages WHERE id = $1 AND is_published = true`, [pkgId])
    if (!pkg.rows.length) return res.status(404).json({ error: 'Package not found' })

    const senderType  = req.user ? 'user' : 'guest'
    const senderId    = req.user?.id || null
    const senderN     = req.user?.full_name || req.user?.name || sender_name || 'Guest'
    const senderE     = req.user?.email || sender_email || null

    const { rows } = await db(`
      INSERT INTO package_messages (
        package_id, sender_type, sender_id, sender_name, sender_email,
        message_type, subject, body, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::JSONB)
      RETURNING *
    `, [pkgId, senderType, senderId, senderN, senderE, message_type, subject, msgBody.trim(), JSON.stringify(metadata)])

    // Update inquiry count
    await db(`UPDATE packages SET inquiry_count = inquiry_count + 1 WHERE id = $1`, [pkgId]).catch(() => {})

    // Notify admin via socket
    emitToAdmin(req, 'pkg:new-message', {
      message: rows[0],
      packageTitle: pkg.rows[0].title,
      packageId: pkgId,
    })

    res.status(201).json({ success: true, data: rows[0] })
  } catch (err) {
    logger.error('[Packages] send message error:', err.message)
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// POST /api/packages/:id/messages/admin-reply  (admin replies)
router.post('/:id/messages/admin-reply', requireAdmin, async (req, res) => {
  try {
    const pkgId = req.params.id
    const { body: msgBody, subject, parent_id, target_user_id, message_type = 'reply' } = req.body

    if (!msgBody?.trim()) return res.status(400).json({ error: 'Message body required' })

    const { rows } = await db(`
      INSERT INTO package_messages (
        package_id, sender_type, sender_id, sender_name, sender_email,
        message_type, subject, body, parent_id, is_read
      ) VALUES ($1,'admin',$2,$3,$4,$5,$6,$7,$8,true)
      RETURNING *
    `, [
      pkgId,
      req.user.id,
      req.user.full_name || req.user.name || 'Admin',
      req.user.email,
      message_type, subject, msgBody.trim(), parent_id || null,
    ])

    // Notify user via socket if we know their ID
    if (target_user_id) {
      emitToUser(req, target_user_id, 'pkg:admin-reply', {
        message: rows[0], packageId: pkgId,
      })
    }

    res.status(201).json({ success: true, data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to send reply' })
  }
})

// POST /api/packages/:id/messages/mark-read  (admin marks messages as read)
router.post('/:id/messages/mark-read', requireAdmin, async (req, res) => {
  try {
    await db(`
      UPDATE package_messages
      SET is_read = true, read_at = NOW()
      WHERE package_id = $1 AND sender_type != 'admin' AND is_read = false
    `, [req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark read' })
  }
})

// DELETE /api/packages/:id/messages/:msgId  (admin)
router.delete('/:id/messages/:msgId', requireAdmin, async (req, res) => {
  try {
    await db(`DELETE FROM package_messages WHERE id = $1 AND package_id = $2`, [req.params.msgId, req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete message' })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// PACKAGE BOOKINGS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/packages/:id/bookings  (admin)
router.get('/:id/bookings', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db(`
      SELECT pb.*, u.full_name AS user_full_name, u.avatar_url AS user_avatar
      FROM package_bookings pb
      LEFT JOIN users u ON pb.user_id = u.id
      WHERE pb.package_id = $1
      ORDER BY pb.created_at DESC
    `, [req.params.id])
    res.json({ success: true, data: rows })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bookings' })
  }
})

// POST /api/packages/:id/book  (user or guest books a package)
router.post('/:id/book', optionalAuth, async (req, res) => {
  try {
    const pkgId = req.params.id
    const {
      guest_name, guest_email, guest_phone,
      travelers_count = 1, adults = 1, children = 0,
      travel_date, end_date, special_requests, dietary_needs,
      pickup_location, total_price, deposit_paid,
    } = req.body

    const pkg = await db(`SELECT id, title, price, currency FROM packages WHERE id = $1 AND is_published = true`, [pkgId])
    if (!pkg.rows.length) return res.status(404).json({ error: 'Package not found' })
    const p = pkg.rows[0]

    const name  = req.user?.full_name || req.user?.name || guest_name
    const email = req.user?.email || guest_email
    const uid   = req.user?.id || null

    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
    if (!email?.trim()) return res.status(400).json({ error: 'Email is required' })

    const calcTotal = total_price || (p.price * parseInt(travelers_count || adults || 1))

    const { rows } = await db(`
      INSERT INTO package_bookings (
        package_id, package_title, package_price,
        user_id, guest_name, guest_email, guest_phone,
        travelers_count, adults, children,
        travel_date, end_date, special_requests, dietary_needs,
        pickup_location, total_price, currency, deposit_paid,
        source
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *
    `, [
      pkgId, p.title, p.price,
      uid, name.trim(), email.trim(), guest_phone,
      parseInt(travelers_count), parseInt(adults), parseInt(children),
      travel_date || null, end_date || null,
      special_requests, dietary_needs, pickup_location,
      calcTotal, p.currency, parseFloat(deposit_paid) || 0,
      'package_page',
    ])

    // Fix booking_ref (trigger may not fire on first insert without id)
    const bk = rows[0]
    if (!bk.booking_ref) {
      await db(`UPDATE package_bookings SET booking_ref = $1 WHERE id = $2`, [genBookingRef(bk.id), bk.id])
      bk.booking_ref = genBookingRef(bk.id)
    }

    await db(`UPDATE packages SET booking_count = booking_count + 1 WHERE id = $1`, [pkgId]).catch(() => {})

    emitToAdmin(req, 'pkg:new-booking', { booking: bk, packageId: pkgId })

    res.status(201).json({ success: true, data: bk })
  } catch (err) {
    logger.error('[Packages] booking error:', err.message)
    res.status(500).json({ error: 'Failed to create booking' })
  }
})

// PATCH /api/packages/:id/bookings/:bId  (admin update booking)
router.patch('/:id/bookings/:bId', requireAdmin, async (req, res) => {
  try {
    const { bId } = req.params
    const { status, admin_notes, priority, payment_status, total_price } = req.body
    const sets = [`updated_at = NOW()`]; const params = []; let pi = 1

    if (status)         { sets.push(`status = $${pi++}`);         params.push(status) }
    if (admin_notes !== undefined) { sets.push(`admin_notes = $${pi++}`); params.push(admin_notes) }
    if (priority)       { sets.push(`priority = $${pi++}`);       params.push(priority) }
    if (payment_status) { sets.push(`payment_status = $${pi++}`); params.push(payment_status) }
    if (total_price)    { sets.push(`total_price = $${pi++}`);    params.push(parseFloat(total_price)) }

    if (status === 'confirmed') sets.push(`confirmed_at = NOW()`)
    if (status === 'cancelled') sets.push(`cancelled_at = NOW()`)
    if (status === 'completed') sets.push(`completed_at = NOW()`)

    params.push(bId)
    const { rows } = await db(
      `UPDATE package_bookings SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
      params
    )
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' })

    if (rows[0].user_id) {
      emitToUser(req, rows[0].user_id, 'pkg:booking-updated', rows[0])
    }

    res.json({ success: true, data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update booking' })
  }
})

// POST /api/packages/:id/bookings/:bId/confirm  (admin confirm)
router.post('/:id/bookings/:bId/confirm', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db(`
      UPDATE package_bookings
      SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [req.params.bId])
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' })
    if (rows[0].user_id) emitToUser(req, rows[0].user_id, 'pkg:booking-confirmed', rows[0])
    res.json({ success: true, data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to confirm booking' })
  }
})

// POST /api/packages/:id/bookings/:bId/cancel  (admin cancel)
router.post('/:id/bookings/:bId/cancel', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body
    const { rows } = await db(`
      UPDATE package_bookings
      SET status = 'cancelled', cancelled_at = NOW(), admin_notes = $2, updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [req.params.bId, reason || null])
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' })
    if (rows[0].user_id) emitToUser(req, rows[0].user_id, 'pkg:booking-cancelled', rows[0])
    res.json({ success: true, data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel booking' })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN INFO REQUESTS  (dynamic forms admin sends to users)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/packages/:id/info-requests  (admin)
router.get('/:id/info-requests', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db(`
      SELECT air.*, u.full_name AS user_full_name, u.avatar_url AS user_avatar
      FROM admin_info_requests air
      LEFT JOIN users u ON air.user_id = u.id
      WHERE air.package_id = $1
      ORDER BY air.created_at DESC
    `, [req.params.id])
    res.json({ success: true, data: rows })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch info requests' })
  }
})

// POST /api/packages/:id/info-requests  (admin creates a form for a user)
router.post('/:id/info-requests', requireAdmin, async (req, res) => {
  try {
    const pkgId = req.params.id
    const {
      title, description, fields = [], theme = 'default',
      accent_color = '#047857', header_image, custom_css,
      user_id, target_email, target_name, booking_id,
      expires_hours = 72,
    } = req.body

    if (!title?.trim()) return res.status(400).json({ error: 'Title required' })
    if (!fields.length) return res.status(400).json({ error: 'At least one field required' })

    const expiresAt = new Date(Date.now() + parseInt(expires_hours) * 3600 * 1000)

    const { rows } = await db(`
      INSERT INTO admin_info_requests (
        package_id, booking_id, user_id, target_email, target_name,
        title, description, fields, theme, accent_color, header_image, custom_css,
        created_by, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::JSONB,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [
      pkgId, booking_id || null, user_id || null, target_email, target_name,
      title.trim(), description,
      JSON.stringify(fields), theme, accent_color, header_image, custom_css,
      req.user.id, expiresAt,
    ])

    // Send form as a system message in the package thread
    const msg = await db(`
      INSERT INTO package_messages (
        package_id, sender_type, sender_id, sender_name,
        message_type, subject, body, metadata
      ) VALUES ($1,'admin',$2,$3,'info_request',$4,$5,$6::JSONB)
      RETURNING *
    `, [
      pkgId, req.user.id,
      req.user.full_name || 'Admin',
      title.trim(),
      `Admin is requesting some information: ${title}`,
      JSON.stringify({ info_request_id: rows[0].id }),
    ])

    // Link message to info request
    await db(`UPDATE admin_info_requests SET message_id = $1 WHERE id = $2`, [msg.rows[0].id, rows[0].id]).catch(() => {})

    // Notify via socket
    if (user_id) {
      emitToUser(req, user_id, 'pkg:info-request', {
        infoRequest: rows[0], message: msg.rows[0], packageId: pkgId,
      })
    }

    res.status(201).json({ success: true, data: rows[0], message: msg.rows[0] })
  } catch (err) {
    logger.error('[Packages] info request error:', err.message)
    res.status(500).json({ error: 'Failed to create info request' })
  }
})

// PATCH /api/packages/:id/info-requests/:rId  (admin update form design)
router.patch('/:id/info-requests/:rId', requireAdmin, async (req, res) => {
  try {
    const { rId } = req.params
    const { title, description, fields, theme, accent_color, header_image, custom_css } = req.body
    const sets = [`updated_at = NOW()`]; const params = []; let pi = 1

    if (title)       { sets.push(`title = $${pi++}`);       params.push(title) }
    if (description) { sets.push(`description = $${pi++}`); params.push(description) }
    if (fields)      { sets.push(`fields = $${pi++}::JSONB`);params.push(JSON.stringify(fields)) }
    if (theme)       { sets.push(`theme = $${pi++}`);       params.push(theme) }
    if (accent_color){ sets.push(`accent_color = $${pi++}`);params.push(accent_color) }
    if (header_image){ sets.push(`header_image = $${pi++}`);params.push(header_image) }
    if (custom_css !== undefined){ sets.push(`custom_css = $${pi++}`);params.push(custom_css) }

    params.push(rId)
    const { rows } = await db(
      `UPDATE admin_info_requests SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
      params
    )
    res.json({ success: true, data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update info request' })
  }
})

// POST /api/packages/:id/info-requests/:rId/respond  (user submits form)
router.post('/:id/info-requests/:rId/respond', optionalAuth, async (req, res) => {
  try {
    const { rId, id: pkgId } = req.params
    const { response } = req.body

    if (!response || typeof response !== 'object') {
      return res.status(400).json({ error: 'Response data required' })
    }

    const req_ = await db(`SELECT * FROM admin_info_requests WHERE id = $1`, [rId])
    if (!req_.rows.length) return res.status(404).json({ error: 'Request not found' })
    const infoReq = req_.rows[0]

    if (infoReq.status !== 'pending') {
      return res.status(400).json({ error: 'This request has already been responded to' })
    }

    const { rows } = await db(`
      UPDATE admin_info_requests
      SET response = $1::JSONB, responded_at = NOW(), status = 'responded',
          responded_by = $2, updated_at = NOW()
      WHERE id = $3 RETURNING *
    `, [JSON.stringify(response), req.user?.id || null, rId])

    // Post a reply message in the package thread
    await db(`
      INSERT INTO package_messages (
        package_id, sender_type, sender_id, sender_name, sender_email,
        message_type, subject, body, metadata, parent_id
      ) VALUES ($1,$2,$3,$4,$5,'info_response',$6,$7,$8::JSONB,$9)
    `, [
      pkgId,
      req.user ? 'user' : 'guest',
      req.user?.id || null,
      req.user?.full_name || req.user?.name || infoReq.target_name || 'User',
      req.user?.email || infoReq.target_email,
      `Response: ${infoReq.title}`,
      'Information submitted successfully',
      JSON.stringify({ info_request_id: rId, response }),
      infoReq.message_id || null,
    ]).catch(() => {})

    emitToAdmin(req, 'pkg:info-responded', { infoRequest: rows[0], packageId: pkgId })

    res.json({ success: true, data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit response' })
  }
})

// DELETE /api/packages/:id/info-requests/:rId  (admin)
router.delete('/:id/info-requests/:rId', requireAdmin, async (req, res) => {
  try {
    await db(`DELETE FROM admin_info_requests WHERE id = $1 AND package_id = $2`, [req.params.rId, req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete info request' })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// CHAT PREFERENCES
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/packages/preferences/chat  (logged-in user)
router.get('/preferences/chat', authenticate, async (req, res) => {
  try {
    const { rows } = await db(
      `SELECT * FROM package_chat_preferences WHERE user_id = $1`,
      [req.user.id]
    )
    res.json({ success: true, data: rows[0] || null })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch preferences' })
  }
})

// PUT /api/packages/preferences/chat  (logged-in user — upsert)
router.put('/preferences/chat', authenticate, async (req, res) => {
  try {
    const { theme, accent_color, bg_image, bg_preset, font_size, bubble_style } = req.body

    const { rows } = await db(`
      INSERT INTO package_chat_preferences (user_id, theme, accent_color, bg_image, bg_preset, font_size, bubble_style)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (user_id) DO UPDATE SET
        theme        = EXCLUDED.theme,
        accent_color = EXCLUDED.accent_color,
        bg_image     = EXCLUDED.bg_image,
        bg_preset    = EXCLUDED.bg_preset,
        font_size    = EXCLUDED.font_size,
        bubble_style = EXCLUDED.bubble_style,
        updated_at   = NOW()
      RETURNING *
    `, [
      req.user.id,
      theme || 'light',
      accent_color || '#047857',
      bg_image || null,
      bg_preset || 'none',
      font_size || 'medium',
      bubble_style || 'rounded',
    ])

    res.json({ success: true, data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to save preferences' })
  }
})

module.exports = router