// config/meilisearch.js
// Meilisearch client configuration with graceful fallback

let meilisearch = null;
let toursIndex = null;
let isAvailable = false;

const MEILI_HOST = process.env.MEILI_HOST;
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY;

const initMeilisearch = async () => {
  // Skip if no host configured or using localhost in production
  if (!MEILI_HOST) {
    console.warn('⚠️  Meilisearch: MEILI_HOST not set - search disabled');
    return;
  }

  if (
    process.env.NODE_ENV === 'production' &&
    MEILI_HOST.includes('localhost')
  ) {
    console.warn(
      '⚠️  Meilisearch: localhost host detected in production - search disabled'
    );
    return;
  }

  try {
    const { MeiliSearch } = require('meilisearch');

    meilisearch = new MeiliSearch({
      host: MEILI_HOST,
      apiKey: MEILI_MASTER_KEY,
    });

    // Test connection with a short timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    await meilisearch.health();
    clearTimeout(timeout);

    toursIndex = meilisearch.index('tours');
    isAvailable = true;

    console.log(`✅ Meilisearch connected: ${MEILI_HOST}`);
  } catch (err) {
    meilisearch = null;
    toursIndex = null;
    isAvailable = false;

    if (err.code === 'MODULE_NOT_FOUND') {
      console.warn(
        '⚠️  Meilisearch: package not installed - run: npm install meilisearch'
      );
    } else if (err.name === 'AbortError') {
      console.warn('⚠️  Meilisearch: connection timed out - search disabled');
    } else {
      console.warn(`⚠️  Meilisearch: connection failed - ${err.message}`);
    }
  }
};

// Initialize on startup (non-blocking)
initMeilisearch();

module.exports = {
  getMeilisearch: () => meilisearch,
  getToursIndex: () => toursIndex,
  isAvailable: () => isAvailable,
};