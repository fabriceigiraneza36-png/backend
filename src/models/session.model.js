// src/models/session.model.js
const { query, queryOne, queryAll } = require('../database/pool');
const { hashToken } = require('../utils/crypto');

class SessionModel {
  static tableName = 'sessions';

  static async create({ userId, token, tokenType = 'access', ipAddress, userAgent, expiresAt }) {
    const tokenHash = hashToken(token);
    
    return queryOne(
      `INSERT INTO ${this.tableName} 
       (user_id, token_hash, token_type, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, tokenHash, tokenType, ipAddress, userAgent, expiresAt]
    );
  }

  static async findByToken(token) {
    const tokenHash = hashToken(token);
    return queryOne(
      `SELECT s.*, u.email, u.username, u.role
       FROM ${this.tableName} s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = $1 
       AND s.is_revoked = false 
       AND s.expires_at > CURRENT_TIMESTAMP`,
      [tokenHash]
    );
  }

  static async findByUserId(userId) {
    return queryAll(
      `SELECT * FROM ${this.tableName} 
       WHERE user_id = $1 
       AND is_revoked = false 
       AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC`,
      [userId]
    );
  }

  static async revokeByToken(token) {
    const tokenHash = hashToken(token);
    return queryOne(
      `UPDATE ${this.tableName} 
       SET is_revoked = true 
       WHERE token_hash = $1 
       RETURNING *`,
      [tokenHash]
    );
  }

  static async revokeAllForUser(userId) {
    return query(
      `UPDATE ${this.tableName} 
       SET is_revoked = true 
       WHERE user_id = $1`,
      [userId]
    );
  }

  static async revokeAllExceptCurrent(userId, currentToken) {
    const tokenHash = hashToken(currentToken);
    return query(
      `UPDATE ${this.tableName} 
       SET is_revoked = true 
       WHERE user_id = $1 AND token_hash != $2`,
      [userId, tokenHash]
    );
  }

  static async cleanExpired() {
    return query(
      `DELETE FROM ${this.tableName} 
       WHERE expires_at < CURRENT_TIMESTAMP OR is_revoked = true`
    );
  }
}

module.exports = SessionModel;