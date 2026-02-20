// src/jobs/subscription.job.js
const SubscriptionService = require('../services/subscription.service');
const logger = require('../utils/logger');

class SubscriptionJobs {
  static async checkExpiring() {
    try {
      const count = await SubscriptionService.processExpiringSubscriptions();
      logger.info(`Sent ${count} expiring subscription notifications`);
      return count;
    } catch (error) {
      logger.error('Failed to check expiring subscriptions:', error);
      throw error;
    }
  }

  static async processExpired() {
    try {
      const count = await SubscriptionService.processExpiredSubscriptions();
      logger.info(`Processed ${count} expired subscriptions`);
      return count;
    } catch (error) {
      logger.error('Failed to process expired subscriptions:', error);
      throw error;
    }
  }
}

module.exports = SubscriptionJobs;