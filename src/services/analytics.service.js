// src/services/analytics.service.js
const { AnalyticsModel } = require('../models');
const logger = require('../utils/logger');

class AnalyticsService {
  static eventQueue = [];
  static flushInterval = null;
  static BATCH_SIZE = 50;
  static FLUSH_INTERVAL = 5000; // 5 seconds

  /**
   * Initialize analytics service with batch processing
   */
  static init() {
    if (this.flushInterval) return;
    
    this.flushInterval = setInterval(() => {
      this.flush().catch(err => logger.error('Analytics flush error:', err));
    }, this.FLUSH_INTERVAL);
  }

  /**
   * Track an event
   */
  static async track(data) {
    const event = {
      userId: data.userId || null,
      eventName: data.eventName,
      eventCategory: data.eventCategory || null,
      properties: data.properties || {},
      sessionId: data.sessionId || null,
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
      referrer: data.referrer || null,
      pageUrl: data.pageUrl || null,
    };

    this.eventQueue.push(event);

    // Immediate flush if batch size reached
    if (this.eventQueue.length >= this.BATCH_SIZE) {
      await this.flush();
    }

    return event;
  }

  /**
   * Flush event queue to database
   */
  static async flush() {
    if (this.eventQueue.length === 0) return;

    const eventsToProcess = this.eventQueue.splice(0, this.BATCH_SIZE);
    
    try {
      await AnalyticsModel.trackBatch(eventsToProcess);
      logger.debug(`Flushed ${eventsToProcess.length} analytics events`);
    } catch (error) {
      // Re-queue failed events
      this.eventQueue.unshift(...eventsToProcess);
      logger.error('Failed to flush analytics events:', error);
    }
  }

  /**
   * Get event counts
   */
  static async getEventCounts(startDate, endDate, eventName = null) {
    return AnalyticsModel.getEventCounts(startDate, endDate, eventName);
  }

  /**
   * Get dashboard statistics
   */
  static async getDashboardStats() {
    return AnalyticsModel.getDashboardStats();
  }

  /**
   * Get top events
   */
  static async getTopEvents(limit = 10, period = '30 days') {
    return AnalyticsModel.getTopEvents(limit, period);
  }

  /**
   * Get user activity
   */
  static async getUserActivity(userId, limit = 50) {
    return AnalyticsModel.getUserActivity(userId, limit);
  }

  /**
   * Track page view
   */
  static async trackPageView(data) {
    return this.track({
      ...data,
      eventName: 'page_view',
      eventCategory: 'engagement',
    });
  }

  /**
   * Cleanup - call when shutting down
   */
  static async shutdown() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
  }
}

// Initialize on module load
AnalyticsService.init();

module.exports = AnalyticsService;