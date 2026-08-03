/**
 * Countries Controller
 * Handles CRUD operations for countries
 */
'use strict'

const { query } = require('../config/db')
const logger = require('../utils/logger')

const LOG = '[Countries]'

/* ════════════════════════════════════════════════════════════════════════════════════
    HELPERS
═════════════════════════════════════════════════════════════════════════════════════ */

const toNum = (v, def = null) => {
  if (v === null || v === undefined || v === '') return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

const toBool = (v) => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim()
    return s === 'true' || s === '1' || s === 'yes'
  }
  return Boolean(v)
}

const toArr = (v) => {
  if (!v) return []
  if (Array.isArray(v)) return v.filter(Boolean)
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return []
    if (t.startsWith('[')) {
      try { return JSON.parse(t).filter(Boolean) } catch { return [] }
    }
    return t.split(',').map((x) => x.trim()).filter(Boolean)
  }
  return [v]
}

const truncate = (col, val) => {
  if (!val) return null
  const maxLengths = {
    name: 255,
    slug: 255,
    official_name: 255,
    capital: 255,
    demonym: 100,
    government_type: 100,
    head_of_state: 255,
    continent: 100,
    region: 100,
    sub_region: 100,
    currency: 100,
    currency_symbol: 10,
    calling_code: 10,
    internet_tld: 10,
    driving_side: 20,
    electrical_plug: 50,
    voltage: 20,
    water_safety: 50,
    climate: 2000,
    best_time_to_visit: 255,
    tagline: 2000,
    motto: 2000,
    description: 65535,
    full_description: 65535,
    additional_info: 65535,
    highlights: 1000,
    experiences: 1000,
    travel_tips: 1000,
    neighboring_countries: 1000,
    visa_info: 2000,
    health_info: 2000,
  }
  const max = maxLengths[col] || 255
  if (val.length <= max) return val
  return val.slice(0, max)
}

/* ═══════════════════════════════════════════════════════════════════════════════════
    COUNTRY CREATE — POST /api/countries
═══════════════════════════════════════════════════════════════════════════════════ */

exports.create = async (req, res, next) => {
  try {
    const data = req.body || {}

    // Validation
    if (!data.name?.trim()) {
      return res.status(400).json({ success: false, error: 'name is required' })
    }
    if (!data.slug?.trim()) {
      // generate slug from name if not provided
      data.slug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    }

    // Latitude/Longitude validation
    const latitude = toNum(data.latitude)
    const longitude = toNum(data.longitude)
    if (latitude === null || latitude < -90 || latitude > 90) {
      return res.status(400).json({ success: false, error: 'latitude must be between -90 and 90' })
    }
    if (longitude === null || longitude < -180 || longitude > 180) {
      return res.status(400).json({ success: false, error: 'longitude must be between -180 and 180' })
    }

    // Optional numeric fields with validation
    const population = toNum(data.population)
    if (population !== null && (population < 0 || !Number.isInteger(population))) {
      return res.status(400).json({ success: false, error: 'population must be a non-negative integer' })
    }
    const area = toNum(data.area)
    if (area !== null && area < 0) {
      return res.status(400).json({ success: false, error: 'area must be non-negative' })
    }
    const populationDensity = toNum(data.population_density)
    if (populationDensity !== null && populationDensity < 0) {
      return res.status(400).json({ success: false, error: 'population_density must be non-negative' })
    }
    const urbanPopulation = toNum(data.urban_population)
    if (urbanPopulation !== null && urbanPopulation < 0) {
      return res.status(400).json({ success: false, error: 'urban_population must be non-negative' })
    }
    const lifeExpectancy = toNum(data.life_expectancy)
    if (lifeExpectancy !== null && (lifeExpectancy < 0 || lifeExpectancy > 150)) {
      return res.status(400).json({ success: false, error: 'life_expectancy must be between 0 and 150' })
    }
    const medianAge = toNum(data.median_age)
    if (medianAge !== null && (medianAge < 0 || medianAge > 150)) {
      return res.status(400).json({ success: false, error: 'median_age must be between 0 and 150' })
    }
    const literacyRate = toNum(data.literacy_rate)
    if (literacyRate !== null && (literacyRate < 0 || literacyRate > 100)) {
      return res.status(400).json({ success: false, error: 'literacy_rate must be between 0 and 100' })
    }

    // Build insert
    const fields = []
    const values = []
    const addField = (f, val) => {
      if (val !== undefined && val !== null) {
        fields.push(f)
        values.push(val)
      }
    }

    addField('name', truncate('name', data.name.trim()))
    addField('slug', truncate('slug', data.slug.trim()))
    addField('official_name', truncate('official_name', data.official_name))
    addField('capital', truncate('capital', data.capital))
    addField('flag', truncate('flag', data.flag))
    addField('flag_url', truncate('flag_url', data.flag_url))
    addField('tagline', truncate('tagline', data.tagline))
    addField('motto', truncate('motto', data.motto))
    addField('demonym', truncate('demonym', data.demonym))
    addField('independence_date', data.independence_date ? new Date(data.independence_date).toISOString().split('T')[0] : null)
    addField('government_type', truncate('government_type', data.government_type))
    addField('head_of_state', truncate('head_of_state', data.head_of_state))
    addField('continent', truncate('continent', data.continent))
    addField('region', truncate('region', data.region))
    addField('sub_region', truncate('sub_region', data.sub_region))
    addField('description', truncate('description', data.description))
    addField('full_description', truncate('full_description', data.full_description))
    addField('additional_info', truncate('additional_info', data.additional_info))
    addField('population', population)
    addField('area', area)
    addField('population_density', populationDensity)
    addField('urban_population', urbanPopulation)
    addField('life_expectancy', lifeExpectancy)
    addField('median_age', medianAge)
    addField('literacy_rate', literacyRate)
    addField('languages', JSON.stringify(toArr(data.languages)))
    addField('official_languages', JSON.stringify(toArr(data.official_languages)))
    addField('national_languages', JSON.stringify(toArr(data.national_languages)))
    addField('ethnic_groups', JSON.stringify(toArr(data.ethnic_groups)))
    addField('religions', JSON.stringify(toArr(data.religions)))
    addField('currency', truncate('currency', data.currency))
    addField('currency_symbol', truncate('currency_symbol', data.currency_symbol))
    addField('timezone', truncate('timezone', data.timezone))
    addField('calling_code', truncate('calling_code', data.calling_code))
    addField('internet_tld', truncate('internet_tld', data.internet_tld))
    addField('driving_side', truncate('driving_side', data.driving_side))
    addField('electrical_plug', truncate('electrical_plug', data.electrical_plug))
    addField('voltage', truncate('voltage', data.voltage))
    addField('water_safety', truncate('water_safety', data.water_safety))
    addField('climate', truncate('climate', data.climate))
    addField('best_time_to_visit', truncate('best_time_to_visit', data.best_time_to_visit))
    addField('seasons', JSON.stringify(toArr(data.seasons)))
    addField('visa_info', truncate('visa_info', data.visa_info))
    addField('health_info', truncate('health_info', data.health_info))
    addField('highlights', JSON.stringify(toArr(data.highlights)))
    addField('experiences', JSON.stringify(toArr(data.experiences)))
    addField('travel_tips', JSON.stringify(toArr(data.travel_tips)))
    addField('neighboring_countries', JSON.stringify(toArr(data.neighboring_countries)))
    addField('wildlife', JSON.stringify(data.wildlife ?? {}))
    addField('cuisine', JSON.stringify(data.cuisine ?? {}))
    addField('economic_info', JSON.stringify(data.economic_info ?? {}))
    addField('geography', JSON.stringify(data.geography ?? {}))
    addField('image_url', truncate('image_url', data.image_url))
    addField('cover_image_url', truncate('cover_image_url', data.cover_image_url))
    addField('hero_image', truncate('hero_image', data.hero_image))
    addField('images', JSON.stringify(toArr(data.images)))
    addField('latitude', latitude)
    addField('longitude', longitude)
    addField('is_featured', toBool(data.is_featured))
    addField('is_active', toBool(data.is_active))
    addField('display_order', toNum(data.display_order, 0))
    addField('destination_count', toNum(data.destination_count, 0))
    addField('view_count', toNum(data.view_count, 0))
    addField('created_at', new Date().toISOString().replace('T', ' ').substring(0, 19))
    addField('updated_at', new Date().toISOString().replace('T', ' ').substring(0, 19))

    const fieldList = fields.join(', ')
    const placeholderList = fields.map((_, i) => `$${i + 1}`).join(', ')

    const { rows } = await query(
      `INSERT INTO countries (${fieldList}) VALUES (${placeholderList}) RETURNING *`,
      values
    )

    const country = rows[0]

    logger.info(`${LOG} Created country: ${country.name} (slug: ${country.slug})`)

    return res.status(201).json({
      success: true,
      message: 'Country created',
      data: country,
    })
  } catch (err) {
    logger.error(`${LOG} create failed:`, err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════
    COUNTRY GET ALL — GET /api/countries
════════════════════════════════════════════════════════════════════════════════════ */

exports.getAll = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = 'name',
      order = 'asc',
      continent,
      region,
      is_featured,
      is_active,
      search,
    } = req.query

    const where = []
    const values = []
    let valueIndex = 1

    const addWhere = (condition, val) => {
      if (condition) {
        where.push(condition)
        values.push(val)
        valueIndex++
      }
    }

    if (continent) {
      addWhere('continent = $' + valueIndex, continent)
    }
    if (region) {
      addWhere('region = $' + valueIndex, region)
    }
    if (is_featured !== undefined) {
      addWhere('is_active = $' + valueIndex, toBool(is_featured))
    }
    if (is_active !== undefined) {
      addWhere('is_active = $' + valueIndex, toBool(is_active))
    }
    if (search) {
      const term = `%${search}%`
      where.push(`(name ILIKE $${valueIndex} OR slug ILIKE $${valueIndex + 1} OR official_name ILIKE $${valueIndex + 2})`)
      values.push(term, term, term)
      valueIndex += 3
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const orderBy = `ORDER BY ${sortBy} ${order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`
    const limitVal = parseInt(limit, 10) || 20
    const offset = (parseInt(page, 10) - 1) * limitVal

    const { rows: totalRows } = await query(`SELECT COUNT(*) FROM countries ${whereClause}`, values)
    const total = parseInt(totalRows[0].count, 10)

    const { rows } = await query(
      `SELECT * FROM countries ${whereClause} ${orderBy} LIMIT $${valueIndex++} OFFSET $${valueIndex++}`,
      [...values, limitVal, offset]
    )

    return res.json({
      success: true,
      data: rows,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: limitVal,
        total_pages: Math.ceil(total / limitVal),
        has_next: page < Math.ceil(total / limitVal),
        has_prev: page > 1,
      },
    })
  } catch (err) {
    logger.error(`${LOG} getAll failed:`, err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════
    COUNTRY GET ONE — GET /api/countries/:slug
════════════════════════════════════════════════════════════════════════════════════ */

exports.getOne = async (req, res, next) => {
  try {
    const { slug } = req.params
    if (!slug) {
      return res.status(400).json({ success: false, error: 'slug is required' })
    }

    const { rows } = await query(
      'SELECT * FROM countries WHERE slug = $1',
      [slug]
    )

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    return res.json({
      success: true,
      data: rows[0],
    })
  } catch (err) {
    logger.error(`${LOG} getOne failed:`, err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════
    COUNTRY UPDATE — PUT /api/countries/:slug
═══════════════════════════════════════════════════════════════════════════════════ */

exports.update = async (req, res, next) => {
  try {
    const { slug } = req.params
    if (!slug) {
      return res.status(400).json({ success: false, error: 'slug is required' })
    }

    const data = req.body || {}

    // Fetch existing
    const { rows: existingRows } = await query(
      'SELECT * FROM countries WHERE slug = $1',
      [slug]
    )
    if (!existingRows.length) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }
    const existing = existingRows[0]

    // Build update set
    const setClauses = []
    const values = []
    let valueIndex = 1

    const addIfPresent = (field, transform = (v) => v) => {
      if (data[field] !== undefined && data[field] !== null) {
        const val = transform(data[field])
        setClauses.push(`${field} = $${valueIndex++}`)
        values.push(val)
      }
    }

    // String fields
    addIfPresent('name', (v) => truncate('name', String(v).trim()))
    addIfPresent('slug', (v) => {
      const slugVal = String(v).trim()
      return truncate('slug', slugVal)
    })
    addIfPresent('official_name', (v) => truncate('official_name', String(v)))
    addIfPresent('capital', (v) => truncate('capital', String(v)))
    addIfPresent('flag', (v) => truncate('flag', String(v)))
    addIfPresent('flag_url', (v) => truncate('flag_url', String(v)))
    addIfPresent('tagline', (v) => truncate('tagline', String(v)))
    addIfPresent('motto', (v) => truncate('motto', String(v)))
    addIfPresent('demonym', (v) => truncate('demonym', String(v)))
    addIfPresent('independence_date', (v) => {
      if (v === null || v === '') return null
      return new Date(v).toISOString().split('T')[0]
    })
    addIfPresent('government_type', (v) => truncate('government_type', String(v)))
    addIfPresent('head_of_state', (v) => truncate('head_of_state', String(v)))
    addIfPresent('continent', (v) => truncate('continent', String(v)))
    addIfPresent('region', (v) => truncate('region', String(v)))
    addIfPresent('sub_region', (v) => truncate('sub_region', String(v)))
    addIfPresent('description', (v) => truncate('description', String(v)))
    addIfPresent('full_description', (v) => truncate('full_description', String(v)))
    addIfPresent('additional_info', (v) => trimate('additional_info', String(v)))
    // Numeric
    addIfPresent('population', (v) => {
      const n = toNum(v)
      if (n === null) return null
      if (n < 0 || !Number.isInteger(n)) throw new Error('population must be non-negative integer')
      return n
    })
    addIfPresent('area', (v) => {
      const n = toNum(v)
      if (n === null) return null
      if (n < 0) throw new Error('area must be non-negative')
      return n
    })
    addIfPresent('population_density', (v) => {
      const n = toNum(v)
      if (n === null) return null
      if (n < 0) throw new Error('population_density must be non-negative')
      return n
    })
    addIfPresent('urban_population', (v) => {
      const n = toNum(v)
      if (n === null) return null
      if (n < 0) throw new Error('urban_population must be non-negative')
      return n
    })
    addIfPresent('life_expectancy', (v) => {
      const n = toNum(v)
      if (n === null) return null
      if (n < 0 || n > 150) throw new Error('life_expectancy must be between 0 and 150')
      return n
    })
    addIfPresent('median_age', (v) => {
      const n = toNum(v)
      if (n === null) return null
      if (n < 0 || n > 150) throw new Error('median_age must be between 0 and 150')
      return n
    })
    addIfPresent('literacy_rate', (v) => {
      const n = toNum(v)
      if (n === null) return null
      if (n < 0 || n > 100) throw new Error('literacy_rate must be between 0 and 100')
      return n
    })
    // Arrays / JSON
    addIfPresent('languages', (v) => JSON.stringify(toArr(v)))
    addIfPresent('official_languages', (v) => JSON.stringify(toArr(v)))
    addIfPresent('national_languages', (v) => JSON.stringify(toArr(v)))
    addIfPresent('ethnic_groups', (v) => JSON.stringify(toArr(v)))
    addIfPresent('religions', (v) => JSON.stringify(toArr(v)))
    addIfPresent('currency', (v) => truncate('currency', String(v)))
    addIfPresent('currency_symbol', (v) => truncate('currency_symbol', String(v)))
    addIfPresent('timezone', (v) => truncate('timezone', String(v)))
    addIfPresent('calling_code', (v) => truncate('calling_code', String(v)))
    addIfPresent('internet_tld', (v) => truncate('internet_tld', String(v)))
    addIfPresent('driving_side', (v) => trimate('driving_side', String(v)))
    addIfPresent('electrical_plug', (v) => trimate('electrical_plug', String(v)))
    addIfPresent('voltage', (v) => trimate('voltage', String(v)))
    addIfPresent('water_safety', (v) => trimate('water_safety', String(v)))
    addIfPresent('climate', (v) => trimate('climate', String(v)))
    addIfPresent('best_time_to_visit', (v) => trimate('best_time_to_visit', String(v)))
    addIfPresent('seasons', (v) => JSON.stringify(toArr(v)))
    addIfPresent('visa_info', (v) => truncate('visa_info', String(v)))
    addIfPresent('health_info', (v) => truncate('health_info', String(v)))
    addIfPresent('highlights', (v) => JSON.stringify(toArr(v)))
    addIfPresent('experiences', (v) => JSON.stringify(toArr(v)))
    addIfPresent('travel_tips', (v) => JSON.stringify(toArr(v)))
    addIfPresent('neighboring_countries', (v) => JSON.stringify(toArr(v)))
    addIfPresent('wildlife', (v) => JSON.stringify(v ?? {}))
    addIfPresent('cuisine', (v) => JSON.stringify(v ?? {}))
    addIfPresent('economic_info', (v) => JSON.stringify(v ?? {}))
    addIfPresent('geography', (v) => JSON.stringify(v ?? {}))
    addIfPresent('image_url', (v) => truncate('image_url', String(v)))
    addIfPresent('cover_image_url', (v) => truncate('cover_image_url', String(v)))
    addIfPresent('hero_image', (v) => truncate('hero_image', String(v)))
    addIfPresent('images', (v) => JSON.stringify(toArr(v)))
    addIfPresent('latitude', (v) => {
      const n = toNum(v)
      if (n === null) return null
      if (n < -90 || n > 90) throw new Error('latitude must be between -90 and 90')
      return n
    })
    addIfPresent('longitude', (v) => {
      const n = toNum(v)
      if (n === null) return null
      if (n < -180 || n > 180) throw new Error('longitude must be between -180 and 180')
      return n
    })
    // Always update timestamp
    setClauses.push(`updated_at = $${valueIndex++}`)
    values.push(new Date().toISOString().replace('T', ' ').substring(0, 19))

    if (setClauses.length === 0) {
      // No fields to update
      return res.json({
        success: true,
        data: existing,
        message: 'No changes',
      })
    }

    const sql = `UPDATE countries SET ${setClauses.join(', ')} WHERE slug = $${valueIndex++}`
    values.push(slug)

    const { rows } = await query(sql, values)

    logger.info(`${LOG} Updated country: ${slug}`)

    return res.json({
      success: true,
      data: rows[0],
      message: 'Country updated',
    })
  } catch (err) {
    logger.error(`${LOG} update failed:`, err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════
    COUNTRY DELETE — DELETE /api/countries/:slug
═══════════════════════════════════════════════════════════════════════════════════ */

exports.remove = async (req, res, next) => {
  try {
    const { slug } = req.params
    if (!slug) {
      return res.status(400).json({ success: false, error: 'slug is required' })
    }

    const { rows } = await query(
      'DELETE FROM countries WHERE slug = $1 RETURNING *',
      [slug]
    )

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }

    logger.info(`${LOG} Deleted country: ${slug}`)

    return res.json({
      success: true,
      data: rows[0],
      message: 'Country deleted',
    })
  } catch (err) {
    logger.error(`${LOG} remove failed:`, err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════
    BULK DELETE — DELETE /api/countries (body: { ids: [slug1, slug2, ...] })
══════════════════════════════════════════════════════════════════════════════════ */

exports.bulkDelete = async (req, res, next) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, error: 'ids array is required' })
    }

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
    const { rows } = await query(
      `DELETE FROM countries WHERE slug IN (${placeholders}) RETURNING *`,
      ids
    )

    logger.info(`${LOG} Bulk deleted ${rows.length} countries`)

    return res.json({
      success: true,
      data: rows.map((r) => r.slug),
      count: rows.length,
      message: `${rows.length} countries deleted`,
    })
  } catch (err) {
    logger.error(`${LOG} bulkDelete failed:`, err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════
    TOGGLE ACTIVE — PATCH /api/countries/:id/toggle-active
══════════════════════════════════════════════════════════════════════════════════ */

exports.toggleActive = async (req, res, next) => {
  try {
    const { id } = req.params
    // Assuming id is slug for simplicity; could also be numeric id
    const { rows } = await query(
      'UPDATE countries SET is_active = NOT is_active, updated_at = NOW() WHERE slug = $1 RETURNING *',
      [id]
    )
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }
    return res.json({
      success: true,
      data: rows[0],
      message: `Country ${rows[0].is_active ? 'activated' : 'deactivated'}`,
    })
  } catch (err) {
    logger.error(`${LOG} toggleActive failed:`, err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════
    TOGGLE FEATURED — PATCH /api/countries/:id/toggle-featured
═══════════════════════════════════════════════════════════════════════════════════ */

exports.toggleFeatured = async (req, res, next) => {
  try {
    const { id } = req.params
    const { rows } = await query(
      'UPDATE countries SET is_featured = NOT is_featured, updated_at = NOW() WHERE slug = $1 RETURNING *',
      [id]
    )
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Country not found' })
    }
    return res.json({
      success: true,
      data: rows[0],
      message: `Country ${rows[0].is_featured ? 'featured' : 'unfeatured'}`,
    })
  } catch (err) {
    logger.error(`${LOG} toggleFeatured failed:`, err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════
    STATS — GET /api/countries/stats
════════════════════════════════════════════════════════════════════════════════════ */

exports.getStats = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) AS total_count,
        COUNT(*) FILTER (WHERE is_active) AS active_count,
        COUNT(*) FILTER (WHERE is_featured) AS featured_count,
        COUNT(*) FILTER (WHERE continent IS NOT NULL) AS continents_with_data,
        COUNT(DISTINCT continent) AS continent_count
      FROM countries
    `)

    return res.json({
      success: true,
      data: rows[0],
    })
  } catch (err) {
    logger.error(`${LOG} getStats failed:`, err.message)
    next(err)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════
    BY CONTINENT — GET /api/countries/continent/:continent
══════════════════════════════════════════════════════════════════════════════════ */

exports.getByContinent = async (req, res, next) => {
  try {
    const { continent } = req.params
    if (!continent) {
      return res.status(400).json({ success: false, error: 'continent is required' })
    }

    const { rows } = await query(
      'SELECT * FROM countries WHERE continent = $1 ORDER BY name',
      [continent]
    )

    return res.json({
      success: true,
      data: rows,
      continent,
      count: rows.length,
    })
  } catch (err) {
    logger.error(`${LOG} getByContinent failed:`, err.message)
    next(err)
  }
}