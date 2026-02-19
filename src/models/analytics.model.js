// src/models/analytics.model.js
const { query, queryOne, queryAll } = require('../database/pool');

class AnalyticsModel {
  static tableName = 'analytics_events';

  static async track(data) {
    const {
      userId,
      eventName,
      eventCategory,
      properties = {},
      sessionId,
      ipAddress,
      userAgent,
      referrer,
      pageUrl,
    } = data;

    return queryOne(
      `INSERT INTO ${this.tableName}
       (user_id, event_name, event_category, properties, session_id,
        ip_address, user_agent, referrer, page_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId, eventName, eventCategory, JSON.stringify(properties),
        sessionId, ipAddress, userAgent, referrer, pageUrl
      ]
    );
  }

  static async trackBatch(events) {
    const values = events.map((e, i) => {
      const offset = i * 9;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`;
    }).join(', ');

    const params = events.flatMap(e => [
      e.userId, e.eventName, e.eventCategory, JSON.stringify(e.properties || {}),
      e.sessionId, e.ipAddress, e.userAgent, e.referrer, e.pageUrl
    ]);

    return query(
      `INSERT INTO ${this.tableName}
       (user_id, event_name, event_category, properties, session_id,
        ip_address, user_agent, referrer, page_url)
       VALUES ${values}`,
      params
    );
  }

  static async getEventCounts(startDate, endDate, eventName = null) {
    let whereClause = 'WHERE created_at BETWEEN $1 AND $2';
    const params = [startDate, endDate];

    if (eventName) {
      whereClause += ' AND event_name = $3';
      params.push(eventName);
    }

    return queryAll(`
      SELECT
        event_name,
        COUNT(*) as count,
        DATE_TRUNC('day', created_at) as date
      FROM ${this.tableName}
      ${whereClause}
      GROUP BY event_name, DATE_TRUNC('day', created_at)
      ORDER BY date DESC
    `, params);
  }

  static async getUniqueUsers(startDate, endDate) {
    return queryOne(`
      SELECT COUNT(DISTINCT user_id) as unique_users
      FROM ${this.tableName}
      WHERE created_at BETWEEN $1 AND $2
      AND user_id IS NOT NULL
    `, [startDate, endDate]);
  }

  static async getTopEvents(limit = 10, period = '30 days') {
    return queryAll(`
      SELECT event_name, COUNT(*) as count
      FROM ${this.tableName}
      WHERE created_at >= CURRENT_DATE - INTERVAL '${period}'
      GROUP BY event_name
      ORDER BY count DESC
      LIMIT $1
    `, [limit]);
  }

  static async getUserActivity(userId, limit = 50) {
    return queryAll(`
      SELECT * FROM ${this.tableName}
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [userId, limit]);
  }

  static async getDashboardStats() {
    return queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as events_today,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as events_7d,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as events_30d,
        COUNT(DISTINCT user_id) FILTER (WHERE created_at >= CURRENT_DATE) as unique_users_today,
        COUNT(DISTINCT session_id) FILTER (WHERE created_at >= CURRENT_DATE) as sessions_today
      FROM ${this.tableName}
    `);
  }
}

module.exports = AnalyticsModel;