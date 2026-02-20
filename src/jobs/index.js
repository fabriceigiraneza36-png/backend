// src/jobs/index.js
const cron = require('node-cron');
const logger = require('../utils/logger');
const subscriptionJobs = require('./subscription.job');
const cleanupJobs = require('./cleanup.job');

class JobScheduler {
  static init() {
    // Run subscription checks every hour
    cron.schedule('0 * * * *', async () => {
      logger.info('Running subscription jobs...');
      try {
        await subscriptionJobs.checkExpiring();
        await subscriptionJobs.processExpired();
      } catch (error) {
        logger.error('Subscription jobs failed:', error);
      }
    });

    // Run cleanup every day at 2 AM
    cron.schedule('0 2 * * *', async () => {
      logger.info('Running cleanup jobs...');
      try {
        await cleanupJobs.cleanExpiredSessions();
        await cleanupJobs.cleanOldNotifications();
        await cleanupJobs.cleanOldAnalytics();
      } catch (error) {
        logger.error('Cleanup jobs failed:', error);
      }
    });

    // Flush analytics every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      try {
        const AnalyticsService = require('../services/analytics.service');
        await AnalyticsService.flush();
      } catch (error) {
        logger.error('Analytics flush failed:', error);
      }
    });

    logger.info('Job scheduler initialized');
  }
}

module.exports = JobScheduler;