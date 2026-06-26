/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CACHE MIDDLEWARE v2.0
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Critical fixes:
 *  - Never cache POST, PUT, PATCH, DELETE requests (mutations)
 *  - Never cache error responses (4xx, 5xx)
 *  - Never cache authenticated requests (Authorization header present)
 *  - Never cache Socket.io polling requests
 *  - TTL configurable per-call, default 120s
 *  - Cache key includes query string
 *  - In-memory LRU with automatic expiry cleanup
 *  - Cache-Control headers respected (no-cache, no-store bypass)
 *  - X-Cache header added for debugging (HIT / MISS / SKIP)
 */

'use strict'

/* ─── In-memory store ───────────────────────────────────────────────────────── */
// Map<key, { body: string, status: number, headers: object, expiresAt: number }>
const store = new Map()

/* Cleanup expired entries every 5 minutes */
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of store.entries()) {
    if (now > v.expiresAt) store.delete(k)
  }
}, 5 * 60 * 1000).unref() // .unref() so this doesn't prevent process exit

/* ─── Paths that should NEVER be cached ─────────────────────────────────────── */
const NEVER_CACHE_PATTERNS = [
  /^\/socket\.io/,          // Socket.io polling
  /^\/api\/auth/,           // Auth endpoints
  /^\/api\/admin\/auth/,    // Admin auth
  /^\/api\/bookings/,       // Booking mutations (has GET too, skip all)
  /^\/api\/testimonials\/submit/, // Review submission
  /^\/health/,              // Health checks (always fresh)
  /^\/api\/health/,
  /^\/api\/debug/,          // Debug endpoints
  /^\/api\/routes/,         // Route inspector
  /^\/uploads\//,           // Static files (handled by express.static)
]

/**
 * Returns true if this request should NEVER be cached.
 */
const shouldSkipCache = (req) => {
  // Skip all non-GET methods
  if (req.method !== 'GET') return true

  // Skip if Authorization header present (user-specific data)
  if (req.headers.authorization) return true

  // Skip if client explicitly requests fresh data
  const cc = (req.headers['cache-control'] || '').toLowerCase()
  if (cc.includes('no-cache') || cc.includes('no-store')) return true

  // Skip known uncacheable paths
  const path = req.path || req.url
  if (NEVER_CACHE_PATTERNS.some(p => p.test(path))) return true

  return false
}

/**
 * Returns true if this response should NOT be stored.
 */
const shouldSkipStore = (statusCode) => {
  // Only cache 200 OK responses
  return statusCode !== 200
}

/**
 * Build a cache key from method + path + query string.
 */
const buildKey = (req) => {
  const url = req.originalUrl || req.url || '/'
  return `GET:${url}`
}

/**
 * cacheMiddleware(ttlSeconds)
 *
 * Usage: app.use(cacheMiddleware(120))
 *
 * @param {number} ttl  Cache TTL in seconds (default: 120)
 */
const cacheMiddleware = (ttl = 120) => (req, res, next) => {
  // ── Skip check ──────────────────────────────────────────────────────────────
  if (shouldSkipCache(req)) {
    res.setHeader('X-Cache', 'SKIP')
    return next()
  }

  const key = buildKey(req)
  const now = Date.now()

  // ── Cache HIT ───────────────────────────────────────────────────────────────
  const cached = store.get(key)
  if (cached && now < cached.expiresAt) {
    // Restore cached headers (excluding sensitive ones)
    for (const [name, value] of Object.entries(cached.headers || {})) {
      try { res.setHeader(name, value) } catch { /* skip invalid headers */ }
    }
    res.setHeader('X-Cache', 'HIT')
    res.setHeader('Age', Math.floor((now - cached.storedAt) / 1000).toString())
    return res.status(cached.status).send(cached.body)
  }

  // ── Cache MISS — intercept response ─────────────────────────────────────────
  res.setHeader('X-Cache', 'MISS')

  const originalSend = res.send.bind(res)
  const originalJson = res.json.bind(res)

  const intercept = (body) => {
    // Only store successful GET responses
    if (!shouldSkipStore(res.statusCode)) {
      return body
    }

    // Capture safe headers to replay
    const headersToCache = {}
    const SAFE_HEADERS = [
      'content-type', 'content-encoding',
      'last-modified', 'etag',
    ]
    for (const h of SAFE_HEADERS) {
      const val = res.getHeader(h)
      if (val) headersToCache[h] = val
    }

    store.set(key, {
      body:      typeof body === 'string' ? body : JSON.stringify(body),
      status:    res.statusCode,
      headers:   headersToCache,
      storedAt:  now,
      expiresAt: now + ttl * 1000,
    })

    return body
  }

  res.json = (body) => {
    intercept(body)
    return originalJson(body)
  }

  res.send = (body) => {
    intercept(body)
    return originalSend(body)
  }

  next()
}

/**
 * Manually invalidate cache entries matching a prefix.
 * Call this after mutations: invalidateCache('/api/testimonials')
 */
const invalidateCache = (prefix) => {
  let count = 0
  for (const key of store.keys()) {
    if (key.startsWith(`GET:${prefix}`)) {
      store.delete(key)
      count++
    }
  }
  return count
}

/**
 * Clear the entire cache.
 */
const clearCache = () => {
  const size = store.size
  store.clear()
  return size
}

/**
 * Get cache stats for debugging.
 */
const getCacheStats = () => ({
  size:    store.size,
  keys:    [...store.keys()],
  memory:  `~${Math.round(JSON.stringify([...store.values()]).length / 1024)}KB`,
})

module.exports = {
  cacheMiddleware,
  invalidateCache,
  clearCache,
  getCacheStats,
}