// src/models/subscription.model.js
const { query, queryOne, queryAll, withTransaction } = require('../database/pool');
const { calculateSubscriptionEndDate } = require('../utils/helpers');
const { SUBSCRIPTION_STATUS } = require('../config/constants');

class SubscriptionModel {
  static tableName = 'subscriptions';

  static async findById(id) {
    return queryOne(
      `SELECT s.*, p.name as plan_name, p.slug as plan_slug, p.price, p.features, p.limits
       FROM ${this.tableName} s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.id = $1`,
      [id]
    );
  }

  static async findByUserId(userId) {
    return queryOne(
      `SELECT s.*, p.name as plan_name, p.slug as plan_slug, p.price, p.features, p.limits
       FROM ${this.tableName} s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.user_id = $1 AND s.status IN ('active', 'trial')
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [userId]
    );
  }

  static async findActiveByUserId(userId) {
    return queryOne(
      `SELECT s.*, p.name as plan_name, p.slug as plan_slug, p.price, p.features, p.limits
       FROM ${this.tableName} s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.user_id = $1 
       AND s.status IN ('active', 'trial')
       AND s.current_period_end > CURRENT_TIMESTAMP`,
      [userId]
    );
  }

  static async getAllByUserId(userId) {
    return queryAll(
      `SELECT s.*, p.name as plan_name, p.slug as plan_slug, p.price
       FROM ${this.tableName} s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC`,
      [userId]
    );
  }

  static async create({ userId, planId, trialDays = 0, stripeSubscriptionId, stripeCustomerId }) {
    const now = new Date();
    let status = SUBSCRIPTION_STATUS.ACTIVE;
    let trialStart = null;
    let trialEnd = null;
    let periodEnd;

    // Handle trial
    if (trialDays > 0) {
      status = SUBSCRIPTION_STATUS.TRIAL;
      trialStart = now;
      trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
      periodEnd = trialEnd;
    } else {
      // Get plan to determine interval
      const plan = await queryOne('SELECT * FROM plans WHERE id = $1', [planId]);
      periodEnd = calculateSubscriptionEndDate(now, plan.interval, plan.interval_count);
    }

    return queryOne(
      `INSERT INTO ${this.tableName}
       (user_id, plan_id, status, current_period_start, current_period_end,
        trial_start, trial_end, stripe_subscription_id, stripe_customer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId, planId, status, now, periodEnd,
        trialStart, trialEnd, stripeSubscriptionId, stripeCustomerId
      ]
    );
  }

  static async update(id, data) {
    const allowedFields = [
      'plan_id', 'status', 'current_period_start', 'current_period_end',
      'canceled_at', 'cancel_at_period_end', 'stripe_subscription_id', 'metadata'
    ];
    
    const updates = [];
    const values = [];
    let paramIndex = 1;

    const fieldMapping = {
      planId: 'plan_id',
      currentPeriodStart: 'current_period_start',
      currentPeriodEnd: 'current_period_end',
      canceledAt: 'canceled_at',
      cancelAtPeriodEnd: 'cancel_at_period_end',
      stripeSubscriptionId: 'stripe_subscription_id',
    };

    Object.entries(data).forEach(([key, value]) => {
      const dbField = fieldMapping[key] || key;
      if (allowedFields.includes(dbField) && value !== undefined) {
        updates.push(`${dbField} = $${paramIndex}`);
        values.push(typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value);
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

  static async cancel(id, immediately = false) {
    if (immediately) {
      return queryOne(
        `UPDATE ${this.tableName}
         SET status = $1, canceled_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [SUBSCRIPTION_STATUS.CANCELED, id]
      );
    }

    return queryOne(
      `UPDATE ${this.tableName}
       SET cancel_at_period_end = true, canceled_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );
  }

  static async reactivate(id) {
    return queryOne(
      `UPDATE ${this.tableName}
       SET cancel_at_period_end = false, canceled_at = NULL, status = $1
       WHERE id = $2
       RETURNING *`,
      [SUBSCRIPTION_STATUS.ACTIVE, id]
    );
  }

  static async renewSubscription(id) {
    const subscription = await this.findById(id);
    if (!subscription) return null;

    const plan = await queryOne('SELECT * FROM plans WHERE id = $1', [subscription.plan_id]);
    const newPeriodStart = subscription.current_period_end;
    const newPeriodEnd = calculateSubscriptionEndDate(
      newPeriodStart,
      plan.interval,
      plan.interval_count
    );

    return queryOne(
      `UPDATE ${this.tableName}
       SET status = $1,
           current_period_start = $2,
           current_period_end = $3,
           cancel_at_period_end = false
       WHERE id = $4
       RETURNING *`,
      [SUBSCRIPTION_STATUS.ACTIVE, newPeriodStart, newPeriodEnd, id]
    );
  }

  static async getExpiring(days = 7) {
    return queryAll(
      `SELECT s.*, u.email, u.username, p.name as plan_name
       FROM ${this.tableName} s
       JOIN users u ON s.user_id = u.id
       JOIN plans p ON s.plan_id = p.id
       WHERE s.status IN ('active', 'trial')
       AND s.current_period_end BETWEEN CURRENT_TIMESTAMP 
       AND CURRENT_TIMESTAMP + INTERVAL '${days} days'
       AND s.cancel_at_period_end = false`
    );
  }

  static async getExpired() {
    return queryAll(
      `SELECT s.*, u.email
       FROM ${this.tableName} s
       JOIN users u ON s.user_id = u.id
       WHERE s.status IN ('active', 'trial')
       AND s.current_period_end < CURRENT_TIMESTAMP`
    );
  }

  static async markAsExpired(ids) {
    return query(
      `UPDATE ${this.tableName}
       SET status = $1
       WHERE id = ANY($2)`,
      [SUBSCRIPTION_STATUS.EXPIRED, ids]
    );
  }

  static async getStats() {
    return queryOne(`
      SELECT
        COUNT(*) as total_subscriptions,
        COUNT(*) FILTER (WHERE status = 'active') as active_subscriptions,
        COUNT(*) FILTER (WHERE status = 'trial') as trial_subscriptions,
        COUNT(*) FILTER (WHERE status = 'canceled') as canceled_subscriptions,
        COUNT(*) FILTER (WHERE status = 'expired') as expired_subscriptions,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as new_subscriptions_30d
      FROM ${this.tableName}
    `);
  }

  static async getMRR() {
    const result = await queryOne(`
      SELECT COALESCE(SUM(p.price), 0) as mrr
      FROM ${this.tableName} s
      JOIN plans p ON s.plan_id = p.id
      WHERE s.status = 'active'
      AND p.interval = 'monthly'
    `);
    return parseFloat(result.mrr);
  }
}

module.exports = SubscriptionModel;