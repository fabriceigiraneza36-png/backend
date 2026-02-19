// src/models/payment.model.js
const { query, queryOne, queryAll } = require('../database/pool');
const { PAYMENT_STATUS } = require('../config/constants');

class PaymentModel {
  static tableName = 'payments';

  static async findById(id) {
    return queryOne(
      `SELECT p.*, u.email, u.username
       FROM ${this.tableName} p
       JOIN users u ON p.user_id = u.id
       WHERE p.id = $1`,
      [id]
    );
  }

  static async findByUserId(userId, { limit = 20, offset = 0 } = {}) {
    const data = await queryAll(
      `SELECT * FROM ${this.tableName}
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const count = await queryOne(
      `SELECT COUNT(*) FROM ${this.tableName} WHERE user_id = $1`,
      [userId]
    );

    return { data, total: parseInt(count.count, 10) };
  }

  static async create(data) {
    const {
      userId,
      subscriptionId,
      amount,
      currency = 'USD',
      status = PAYMENT_STATUS.PENDING,
      paymentMethod,
      stripePaymentIntentId,
      stripeInvoiceId,
      description,
      metadata = {},
    } = data;

    return queryOne(
      `INSERT INTO ${this.tableName}
       (user_id, subscription_id, amount, currency, status, payment_method,
        stripe_payment_intent_id, stripe_invoice_id, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        userId, subscriptionId, amount, currency, status, paymentMethod,
        stripePaymentIntentId, stripeInvoiceId, description, JSON.stringify(metadata)
      ]
    );
  }

  static async updateStatus(id, status, paidAt = null) {
    return queryOne(
      `UPDATE ${this.tableName}
       SET status = $1, paid_at = $2
       WHERE id = $3
       RETURNING *`,
      [status, paidAt, id]
    );
  }

  static async findByStripePaymentIntent(stripePaymentIntentId) {
    return queryOne(
      `SELECT * FROM ${this.tableName} WHERE stripe_payment_intent_id = $1`,
      [stripePaymentIntentId]
    );
  }

  static async getRevenue(period = '30 days') {
    return queryOne(`
      SELECT
        COALESCE(SUM(amount), 0) as total_revenue,
        COUNT(*) as total_payments
      FROM ${this.tableName}
      WHERE status = 'completed'
      AND paid_at >= CURRENT_DATE - INTERVAL '${period}'
    `);
  }

  static async getRevenueByMonth(months = 12) {
    return queryAll(`
      SELECT
        DATE_TRUNC('month', paid_at) as month,
        SUM(amount) as revenue,
        COUNT(*) as payments
      FROM ${this.tableName}
      WHERE status = 'completed'
      AND paid_at >= CURRENT_DATE - INTERVAL '${months} months'
      GROUP BY DATE_TRUNC('month', paid_at)
      ORDER BY month DESC
    `);
  }
}

module.exports = PaymentModel;