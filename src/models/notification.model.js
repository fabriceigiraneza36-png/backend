// src/models/notification.model.js
const { query, queryOne, queryAll } = require('../database/pool');

class NotificationModel {
  static tableName = 'notifications';

  static async findById(id) {
    return queryOne(`SELECT * FROM ${this.tableName} WHERE id = $1`, [id]);
  }

  static async findByUserId(userId, { limit = 20, offset = 0, unreadOnly = false } = {}) {
    const whereClause = unreadOnly
      ? 'WHERE user_id = $1 AND is_read = false'
      : 'WHERE user_id = $1';

    const data = await queryAll(`
      SELECT * FROM ${this.tableName}
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    const count = await queryOne(`
      SELECT COUNT(*) FROM ${this.tableName} ${whereClause}
    `, [userId]);

    const unreadCount = await queryOne(`
      SELECT COUNT(*) FROM ${this.tableName}
      WHERE user_id = $1 AND is_read = false
    `, [userId]);

    return {
      data,
      total: parseInt(count.count, 10),
      unreadCount: parseInt(unreadCount.count, 10),
    };
  }

  static async create({ userId, type, title, message, data = {} }) {
    return queryOne(`
      INSERT INTO ${this.tableName} (user_id, type, title, message, data)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [userId, type, title, message, JSON.stringify(data)]);
  }

  static async createBulk(notifications) {
    const values = notifications.map((n, i) => {
      const offset = i * 5;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
    }).join(', ');

    const params = notifications.flatMap(n => [
      n.userId, n.type, n.title, n.message, JSON.stringify(n.data || {})
    ]);

    return query(`
      INSERT INTO ${this.tableName} (user_id, type, title, message, data)
      VALUES ${values}
    `, params);
  }

  static async markAsRead(id, userId) {
    return queryOne(`
      UPDATE ${this.tableName}
      SET is_read = true, read_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId]);
  }

  static async markAllAsRead(userId) {
    return query(`
      UPDATE ${this.tableName}
      SET is_read = true, read_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND is_read = false
    `, [userId]);
  }

  static async delete(id, userId) {
    return queryOne(`
      DELETE FROM ${this.tableName}
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId]);
  }

  static async deleteOld(days = 90) {
    return query(`
      DELETE FROM ${this.tableName}
      WHERE created_at < CURRENT_DATE - INTERVAL '${days} days'
    `);
  }
}

module.exports = NotificationModel;