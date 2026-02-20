// src/jobs/cleanup.job.js
const { SessionModel, NotificationModel } = require('../models');
const { query } = require('../database/pool');
const logger = require('../utils/logger');

class CleanupJobs {
  static async cleanExpiredSessions() {
    try {
      await SessionModel.cleanExpired();
      logger.info('Cleaned expired sessions');
    } catch (error) {
      logger.error('Failed to clean expired sessions:', error);
      throw error;
    }
  }

  static async cleanOldNotifications() {
    try {
      const result = await NotificationModel.deleteOld(90);
      logger.info('Cleaned old notifications');
    } catch (error) {
      logger.error('Failed to clean old notifications:', error);
      throw error;
    }
  }

  static async cleanOldAnalytics() {
    try {
      await query(
        `DELETE FROM analytics_events 
         WHERE created_at < CURRENT_DATE - INTERVAL '365 days'`
      );
      logger.info('Cleaned old analytics events');
    } catch (error) {
      logger.error('Failed to clean old analytics:', error);
      throw error;
    }
  }

  static async cleanOldMagicLinks() {
    try {
      await query(
        `DELETE FROM magic_links 
         WHERE created_at < CURRENT_DATE - INTERVAL '7 days'`
      );
      logger.info('Cleaned old magic links');
    } catch (error) {
      logger.error('Failed to clean old magic links:', error);
      throw error;
    }
  }
}

module.exports = CleanupJobs;