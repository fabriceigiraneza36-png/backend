// src/models/plan.model.js
const { query, queryOne, queryAll } = require('../database/pool');

class PlanModel {
  static tableName = 'plans';

  static async findById(id) {
    return queryOne(
      `SELECT * FROM ${this.tableName} WHERE id = $1`,
      [id]
    );
  }

  static async findBySlug(slug) {
    return queryOne(
      `SELECT * FROM ${this.tableName} WHERE slug = $1 AND is_active = true`,
      [slug]
    );
  }

  static async findAll(includeInactive = false) {
    const whereClause = includeInactive ? '' : 'WHERE is_active = true';
    return queryAll(
      `SELECT * FROM ${this.tableName} ${whereClause} ORDER BY sort_order ASC`
    );
  }

  static async create(data) {
    const {
      name,
      slug,
      description,
      price,
      currency = 'USD',
      interval = 'monthly',
      intervalCount = 1,
      trialDays = 0,
      features = [],
      limits = {},
      stripePriceId,
      isActive = true,
      isPopular = false,
      sortOrder = 0,
    } = data;

    return queryOne(
      `INSERT INTO ${this.tableName} 
       (name, slug, description, price, currency, interval, interval_count, 
        trial_days, features, limits, stripe_price_id, is_active, is_popular, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        name, slug, description, price, currency, interval, intervalCount,
        trialDays, JSON.stringify(features), JSON.stringify(limits),
        stripePriceId, isActive, isPopular, sortOrder
      ]
    );
  }

  static async update(id, data) {
    const allowedFields = [
      'name', 'description', 'price', 'features', 'limits',
      'stripe_price_id', 'is_active', 'is_popular', 'sort_order', 'trial_days'
    ];
    
    const updates = [];
    const values = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      if (allowedFields.includes(snakeKey) && value !== undefined) {
        updates.push(`${snakeKey} = $${paramIndex}`);
        values.push(typeof value === 'object' ? JSON.stringify(value) : value);
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
      `UPDATE ${this.tableName} SET is_active = false WHERE id = $1 RETURNING *`,
      [id]
    );
  }

  static async getPopular() {
    return queryOne(
      `SELECT * FROM ${this.tableName} WHERE is_popular = true AND is_active = true`
    );
  }

  static async getFreePlan() {
    return queryOne(
      `SELECT * FROM ${this.tableName} WHERE price = 0 AND is_active = true LIMIT 1`
    );
  }
}

module.exports = PlanModel;