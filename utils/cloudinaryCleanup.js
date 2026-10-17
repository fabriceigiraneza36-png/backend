'use strict'

const { cloudinary, ensureCloudinaryConfigured } = require('../config/cloudinary')
const { query } = require('../config/db')

const isCloudinaryUrl = (value) =>
  typeof value === 'string' && /res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/upload\//i.test(value)

const resourceTypeFromUrl = (value) => {
  if (!isCloudinaryUrl(value)) return null
  const match = String(value).match(/res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/upload\//i)
  return match?.[1]?.toLowerCase() || null
}

const publicIdFromUrl = (value) => {
  if (!isCloudinaryUrl(value)) return null
  try {
    const parsed = new URL(value)
    const marker = '/upload/'
    const idx = parsed.pathname.indexOf(marker)
    if (idx < 0) return null
    let path = parsed.pathname.slice(idx + marker.length)
    const segments = path.split('/').filter(Boolean)
    // Remove any transformations before the version/public ID.
    const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment))
    if (versionIndex >= 0) segments.splice(0, versionIndex + 1)
    else {
      // Transformation segments occur before the version. When no version is
      // present, strip only recognized transformation segments.
      while (segments.length && /^(?:a_[^,]+|b_[^,]+|c_[^,]+|dpr_[^,]+|e_[^,]+|f_[^,]+|fl_[^,]+|g_[^,]+|h_[^,]+|q_[^,]+|r_[^,]+|w_[^,]+|x_[^,]+|y_[^,]+|z_[^,]+|t_[^,]+)(?:,.*)?$/.test(segments[0])) {
        segments.shift()
      }
    }
    const last = segments.pop()
    if (!last) return null
    const ext = last.lastIndexOf('.')
    segments.push(ext > 0 ? last.slice(0, ext) : last)
    return segments.join('/')
  } catch {
    return null
  }
}

// Conservatively look for the Cloudinary public ID in all public-table
// text/JSON/array fields likely to contain media URLs. If any other record
// still refers to it, preserve the asset. If reference discovery fails, fail
// closed and do not delete anything from Cloudinary.
const hasDatabaseReference = async (publicId) => {
  const { rows: tableRows } = await query(`
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY')
      AND (
        c.column_name ~* '(image|media|thumbnail|avatar|cover|hero|logo|banner|poster|video|file|url|gallery|content|body|html|attraction|attachment|photo|icon|flag)'
      )
    ORDER BY c.table_name, c.ordinal_position
  `)
  const grouped = new Map()
  for (const row of tableRows) {
    if (!grouped.has(row.table_name)) grouped.set(row.table_name, [])
    grouped.get(row.table_name).push(row.column_name)
  }
  for (const [table, columns] of grouped) {
    const checks = columns.map((column) =>
      `position($1 in COALESCE(${quoteIdentifier(column)}::text, '')) > 0`
    ).join(' OR ')
    const sql = `SELECT EXISTS (SELECT 1 FROM ${quoteIdentifier(table)} WHERE ${checks}) AS present`
    const result = await query(sql, [publicId])
    if (result.rows[0]?.present) return true
  }
  return false
}

const quoteIdentifier = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`

const destroyCloudinaryUrls = async (urls = []) => {
  const unique = [...new Set((Array.isArray(urls) ? urls : [urls]).filter(Boolean))]
  if (!unique.length) return { attempted: 0, deleted: 0, preserved: 0, failed: 0 }
  ensureCloudinaryConfigured()
  let deleted = 0
  let preserved = 0
  let failed = 0
  for (const url of unique) {
    try {
      const publicId = publicIdFromUrl(url)
      const resourceType = resourceTypeFromUrl(url)
      if (!publicId || !resourceType) {
        preserved += 1
        continue
      }
      if (await hasDatabaseReference(publicId)) {
        preserved += 1
        continue
      }
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      })
      if (result?.result === 'ok' || result?.result === 'not found') deleted += 1
      else failed += 1
    } catch (err) {
      failed += 1
      console.error('[CloudinaryCleanup] Asset preserved/cleanup failed:', err.message)
    }
  }
  return { attempted: unique.length, deleted, preserved, failed }
}

module.exports = { isCloudinaryUrl, publicIdFromUrl, resourceTypeFromUrl, destroyCloudinaryUrls }
