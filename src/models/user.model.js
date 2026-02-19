// src/models/user.model.js
const { query, queryOne, queryAll, withTransaction } = require('../database/pool');
const { cleanObject } = require('../utils/helpers');

class UserModel {
  static tableName = 'users';

  static async findById(id) {
    return queryOne(
      `SELECT * FROM ${this.tableName} WHERE id = $1 AND is_active = true`,
      [id]
    );
  }

  static async findByEmail(email) {
    return queryOne(
      `SELECT * FROM ${this.tableName} WHERE email = $1`,
      [email.toLowerCase()]
    );
  }

  static async findByUsername(username) {
    return queryOne(
      `SELECT * FROM ${this.tableName} WHERE username = $1`,
      [username.toLowerCase()]
    );
  }

  static async findByEmailOrUsername(identifier) {
    return queryOne(
      `SELECT * FROM ${this.tableName} 
       WHERE (email = $1 OR username = $1) AND is_active = true`,
      [identifier.toLowerCase()]
    );
  }

  static async create(data) {
    const { email, username, fullName, role = 'user', metadata = {} } = data;
    
    return queryOne(
      `INSERT INTO ${this.tableName} 
       (email, username, full_name, role, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [email.toLowerCase(), username.toLowerCase(), fullName, role, metadata]
    );
  }

  static async update(id, data) {
    const allowedFields = ['full_name', 'username', 'avatar_url', 'is_verified', 'metadata', 'last_login_at'];
    const updates = [];
    const values = [];
    let paramIndex = 1;

    // Map camelCase to snake_case
    const fieldMapping = {
      fullName: 'full_name',
      avatarUrl: 'avatar_url',
      isVerified: 'is_verified',
      lastLoginAt: 'last_login_at',
    };

    Object.entries(data).forEach(([key, value]) => {
      const dbField = fieldMapping[key] || key;
      if (allowedFields.includes(dbField) && value !== undefined) {
        updates.push(`${dbField} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (updates.length === 0) return this.findById(id);

    values.push(id);
    return queryOne(
      `UPDATE ${this.tableName} 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
  }

  static async delete(id) {
    return queryOne(
      `UPDATE ${this.tableName} 
       SET is_active = false 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );
  }

  static async hardDelete(id) {
    return queryOne(
      `DELETE FROM ${this.tableName} WHERE id = $1 RETURNING *`,
      [id]
    );
  }

  static async findAll({ limit = 20, offset = 0, sortBy = 'created_at', sortOrder = 'DESC', search = '' }) {
    let whereClause = 'WHERE is_active = true';
    const values = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (email ILIKE $${paramIndex} OR username ILIKE $${paramIndex} OR full_name ILIKE $${paramIndex})`;
      values.push(`%${search}%`);
      paramIndex++;
    }

    values.push(limit, offset);

    const dataQuery = `
      SELECT id, email, username, full_name, avatar_url, role, is_verified, created_at
      FROM ${this.tableName}
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countQuery = `SELECT COUNT(*) FROM ${this.tableName} ${whereClause}`;

    const [data, count] = await Promise.all([
      queryAll(dataQuery, values),
      queryOne(countQuery, search ? [`%${search}%`] : []),
    ]);

    return {
      data,
      total: parseInt(count.count, 10),
    };
  }

  static async updateLastLogin(id) {
    return queryOne(
      `UPDATE ${this.tableName} 
       SET last_login_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );
  }

  static async verify(id) {
    return queryOne(
      `UPDATE ${this.tableName} 
       SET is_verified = true 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );
  }

  static async countByRole(role) {
    const result = await queryOne(
      `SELECT COUNT(*) FROM ${this.tableName} WHERE role = $1 AND is_active = true`,
      [role]
    );
    return parseInt(result.count, 10);
  }

  static async getStats() {
    return queryOne(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE is_active = true) as active_users,
        COUNT(*) FILTER (WHERE is_verified = true) as verified_users,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as new_users_30d,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as new_users_7d,
        COUNT(*) FILTER (WHERE last_login_at >= CURRENT_DATE - INTERVAL '7 days') as active_last_7d
      FROM ${this.tableName}
    `);
  }
}

module.exports = UserModel;