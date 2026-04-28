// routes/search.routes.js
// Search API routes with graceful fallback

const express = require('express');
const router = express.Router();
const { getToursIndex, isAvailable } = require('../config/meilisearch');

// ─────────────────────────────────────────────
// Middleware: Check if search service is up
// ─────────────────────────────────────────────
const requireSearch = (req, res, next) => {
  if (!isAvailable()) {
    return res.status(503).json({
      success: false,
      error: 'Search service unavailable',
      message:
        'The search service is currently offline. Please try again later or browse tours directly.',
      fallback: true,
    });
  }
  next();
};

// ─────────────────────────────────────────────
// GET /api/search
// Search tours in Meilisearch
// Query params:
//   q       - search query string
//   limit   - number of results (default: 20, max: 100)
//   offset  - pagination offset (default: 0)
// ─────────────────────────────────────────────
router.get('/', requireSearch, async (req, res) => {
  try {
    const { q, limit = 20, offset = 0 } = req.query;

    // Handle empty query
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return res.json({
        success: true,
        data: [],
        query: '',
        total: 0,
        message: 'Please provide a search query.',
      });
    }

    const query = q.trim();
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    const toursIndex = getToursIndex();

    if (!toursIndex) {
      return res.status(503).json({
        success: false,
        error: 'Search index unavailable',
        message: 'Search index is not ready. Please try again later.',
      });
    }

    // Search in Meilisearch
    const searchResults = await toursIndex.search(query, {
      limit: limitNum,
      offset: offsetNum,
      attributesToRetrieve: [
        'id',
        'title',
        'country',
        'price',
        'duration',
        'category',
        'description',
        'image',
      ],
      attributesToHighlight: ['title', 'description'],
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
    });

    return res.json({
      success: true,
      data: searchResults.hits,
      query,
      limit: limitNum,
      offset: offsetNum,
      total: searchResults.estimatedTotalHits ?? searchResults.hits.length,
      processingTimeMs: searchResults.processingTimeMs,
    });
  } catch (error) {
    console.error('❌ Search error:', error.message);

    // Handle specific Meilisearch errors
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        error: 'Search service unreachable',
        message: 'Could not connect to the search service.',
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Search failed',
      message:
        process.env.NODE_ENV === 'production'
          ? 'An error occurred while searching. Please try again.'
          : error.message,
    });
  }
});

// ─────────────────────────────────────────────
// GET /api/search/health
// Check search service health
// ─────────────────────────────────────────────
router.get('/health', (req, res) => {
  const available = isAvailable();

  return res.status(available ? 200 : 503).json({
    success: available,
    service: 'meilisearch',
    status: available ? 'online' : 'offline',
    host: process.env.MEILI_HOST || 'not configured',
  });
});

module.exports = router;