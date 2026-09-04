'use strict'

const isSafeImageUrl = (value) => {
  if (typeof value !== 'string') return false
  const url = value.trim()
  if (!url || url.length > 2048) return false
  if (url.startsWith('/')) return url.startsWith('/uploads/') || url.startsWith('/media/')
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    return true
  } catch {
    return false
  }
}

const imageUrlFrom = (value) => {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  return String(value.url || value.image_url || value.imageUrl || value.src || '').trim()
}

const normalizeImages = (value) => {
  let values = value
  if (typeof values === 'string') {
    try { values = JSON.parse(values) } catch { values = values.split(',') }
  }
  if (!Array.isArray(values)) values = values ? [values] : []
  return values.map((entry, index) => {
    const url = imageUrlFrom(entry)
    if (!isSafeImageUrl(url)) return null
    const item = typeof entry === 'object' && entry ? entry : {}
    return {
      url,
      caption: typeof item.caption === 'string' ? item.caption.trim().slice(0, 300) : '',
      alt: typeof item.alt === 'string' ? item.alt.trim().slice(0, 200) : '',
      sort_order: Number.isInteger(item.sort_order) ? item.sort_order : index,
      is_primary: item.is_primary === true || item.isPrimary === true,
    }
  }).filter(Boolean).filter((item, index, all) => all.findIndex(other => other.url === item.url) === index)
    .map((item, index, all) => ({ ...item, sort_order: index, is_primary: item.is_primary || (index === 0 && !all.some(other => other.is_primary)) }))
}

const urlsOnly = (value) => normalizeImages(value).map(image => image.url)

module.exports = { isSafeImageUrl, normalizeImages, urlsOnly }
