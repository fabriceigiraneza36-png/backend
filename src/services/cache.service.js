// src/services/cache.service.js
/**
 * In-memory cache service (simple alternative to Redis)
 * For production with multiple instances, consider using Redis
 */

class CacheService {
  static cache = new Map();
  static timers = new Map();

  /**
   * Set a value with optional TTL
   */
  static set(key, value, ttlSeconds = null) {
    // Clear existing timer if any
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    this.cache.set(key, {
      value,
      createdAt: Date.now(),
    });

    if (ttlSeconds) {
      const timer = setTimeout(() => {
        this.delete(key);
      }, ttlSeconds * 1000);
      this.timers.set(key, timer);
    }

    return true;
  }

  /**
   * Get a value
   */
  static get(key) {
    const item = this.cache.get(key);
    return item ? item.value : null;
  }

  /**
   * Check if key exists
   */
  static has(key) {
    return this.cache.has(key);
  }

  /**
   * Delete a key
   */
  static delete(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    return this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  static clear() {
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    this.cache.clear();
  }

  /**
   * Get or set (cache-aside pattern)
   */
  static async getOrSet(key, fetchFunction, ttlSeconds = 300) {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetchFunction();
    this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Invalidate keys matching pattern
   */
  static invalidatePattern(pattern) {
    const regex = new RegExp(pattern.replace('*', '.*'));
    const keysToDelete = [];
    
    this.cache.forEach((_, key) => {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.delete(key));
    return keysToDelete.length;
  }

  /**
   * Get cache stats
   */
  static getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

module.exports = CacheService;