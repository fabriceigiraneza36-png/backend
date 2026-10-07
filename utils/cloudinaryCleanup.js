'use strict'

const { cloudinary, ensureCloudinaryConfigured } = require('../config/cloudinary')

const isCloudinaryUrl = (value) =>
  typeof value === 'string' && /res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/upload\//i.test(value)

const publicIdFromUrl = (value) => {
  if (!isCloudinaryUrl(value)) return null
  try {
    const parsed = new URL(value)
    const marker = '/upload/'
    const idx = parsed.pathname.indexOf(marker)
    if (idx < 0) return null
    let path = parsed.pathname.slice(idx + marker.length).replace(/^v\d+\//, '')
    const segments = path.split('/').filter(Boolean)
    // Drop Cloudinary transformation segments before the version/public id.
    const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment))
    if (versionIndex >= 0) segments.splice(0, versionIndex + 1)
    const last = segments.pop()
    if (!last) return null
    const ext = last.lastIndexOf('.')
    segments.push(ext > 0 ? last.slice(0, ext) : last)
    return segments.join('/')
  } catch {
    return null
  }
}

const destroyCloudinaryUrls = async (urls = []) => {
  const unique = [...new Set((Array.isArray(urls) ? urls : [urls]).filter(Boolean))]
  if (!unique.length) return { attempted: 0, deleted: 0 }
  ensureCloudinaryConfigured()
  let deleted = 0
  const results = await Promise.allSettled(unique.map(async (url) => {
    const publicId = publicIdFromUrl(url)
    if (!publicId) return { skipped: true, url }
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true })
    if (result?.result === 'ok' || result?.result === 'not found') deleted += 1
    return result
  }))
  return {
    attempted: unique.length,
    deleted,
    failed: results.filter((r) => r.status === 'rejected').length,
  }
}

module.exports = { isCloudinaryUrl, publicIdFromUrl, destroyCloudinaryUrls }
