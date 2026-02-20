// src/controllers/analytics.controller.js
const AnalyticsService = require('../services/analytics.service');
const ApiResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

class AnalyticsController {
  /**
   * Track an event
   * POST /api/v1/analytics/track
   */
  static track = asyncHandler(async (req, res) => {
    const { eventName, eventCategory, properties = {} } = req.body;
    
    await AnalyticsService.track({
      userId: req.user?.id,
      eventName,
      eventCategory,
      properties,
      sessionId: req.headers['x-session-id'],
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      referrer: req.headers.referer,
      pageUrl: req.body.pageUrl,
    });
    
    return ApiResponse.success(res, null, 'Event tracked');
  });

  /**
   * Get dashboard stats
   * GET /api/v1/analytics/dashboard
   */
  static getDashboard = asyncHandler(async (req, res) => {
    const stats = await AnalyticsService.getDashboardStats();
    
    return ApiResponse.success(res, stats);
  });

  /**
   * Get top events
   * GET /api/v1/analytics/events/top
   */
  static getTopEvents = asyncHandler(async (req, res) => {
    const { limit = 10, period = '30 days' } = req.query;
    
    const events = await AnalyticsService.getTopEvents(parseInt(limit, 10), period);
    
    return ApiResponse.success(res, events);
  });

  /**
   * Get user activity
   * GET /api/v1/analytics/activity
   */
  static getUserActivity = asyncHandler(async (req, res) => {
    const { limit = 50 } = req.query;
    
    const activity = await AnalyticsService.getUserActivity(
      req.user.id,
      parseInt(limit, 10)
    );
    
    return ApiResponse.success(res, activity);
  });
}

module.exports = AnalyticsController;