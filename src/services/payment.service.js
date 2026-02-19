// src/services/payment.service.js
const Stripe = require('stripe');
const env = require('../config/env');
const { PaymentModel, SubscriptionModel, UserModel, PlanModel } = require('../models');
const { withTransaction } = require('../database/pool');
const { PAYMENT_STATUS } = require('../config/constants');
const logger = require('../utils/logger');

const stripe = new Stripe(env.stripe.secretKey);

class PaymentService {
  /**
   * Create or get Stripe customer
   */
  static async getOrCreateCustomer(userId) {
    const user = await UserModel.findById(userId);
    const subscription = await SubscriptionModel.findByUserId(userId);

    if (subscription?.stripe_customer_id) {
      return subscription.stripe_customer_id;
    }

    const customer = await stripe.customers.create({
      email: user.email,
      name: user.full_name,
      metadata: { userId: user.id },
    });

    return customer.id;
  }

  /**
   * Create checkout session
   */
  static async createCheckoutSession(userId, planId, successUrl, cancelUrl) {
    const plan = await PlanModel.findById(planId);
    if (!plan || !plan.stripe_price_id) {
      throw { status: 400, message: 'Plan not configured for payments' };
    }

    const customerId = await this.getOrCreateCustomer(userId);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: plan.interval === 'lifetime' ? 'payment' : 'subscription',
      line_items: [
        {
          price: plan.stripe_price_id,
          quantity: 1,
        },
      ],
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        planId,
      },
      subscription_data: plan.trial_days > 0 ? {
        trial_period_days: plan.trial_days,
      } : undefined,
    });

    return session;
  }

  /**
   * Create payment intent for one-time payment
   */
  static async createPaymentIntent(userId, amount, currency = 'usd', metadata = {}) {
    const customerId = await this.getOrCreateCustomer(userId);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency,
      customer: customerId,
      metadata: {
        userId,
        ...metadata,
      },
    });

    return paymentIntent;
  }

  /**
   * Handle successful checkout
   */
  static async handleCheckoutComplete(session) {
    const { userId, planId } = session.metadata;

    const SubscriptionService = require('./subscription.service');

    await SubscriptionService.createSubscription(userId, planId, {
      stripeSubscriptionId: session.subscription,
      stripeCustomerId: session.customer,
      paymentIntentId: session.payment_intent,
    });

    logger.info('Checkout completed:', { userId, planId });
  }

  /**
   * Handle subscription updated
   */
  static async handleSubscriptionUpdated(stripeSubscription) {
    const subscription = await require('../database/pool').queryOne(
      'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1',
      [stripeSubscription.id]
    );

    if (!subscription) {
      logger.warn('Subscription not found for Stripe update:', stripeSubscription.id);
      return;
    }

    const statusMap = {
      active: 'active',
      past_due: 'past_due',
      canceled: 'canceled',
      unpaid: 'past_due',
      trialing: 'trial',
    };

    await SubscriptionModel.update(subscription.id, {
      status: statusMap[stripeSubscription.status] || subscription.status,
      currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
    });
  }

  /**
   * Handle payment succeeded
   */
  static async handlePaymentSucceeded(invoice) {
    const subscription = await require('../database/pool').queryOne(
      'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1',
      [invoice.subscription]
    );

    if (!subscription) return;

    await PaymentModel.create({
      userId: subscription.user_id,
      subscriptionId: subscription.id,
      amount: invoice.amount_paid / 100,
      currency: invoice.currency.toUpperCase(),
      status: PAYMENT_STATUS.COMPLETED,
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId: invoice.payment_intent,
      paidAt: new Date(),
    });
  }

  /**
   * Handle payment failed
   */
  static async handlePaymentFailed(invoice) {
    const subscription = await require('../database/pool').queryOne(
      'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1',
      [invoice.subscription]
    );

    if (!subscription) return;

    await PaymentModel.create({
      userId: subscription.user_id,
      subscriptionId: subscription.id,
      amount: invoice.amount_due / 100,
      currency: invoice.currency.toUpperCase(),
      status: PAYMENT_STATUS.FAILED,
      stripeInvoiceId: invoice.id,
      metadata: { failureMessage: invoice.last_payment_error?.message },
    });
  }

  /**
   * Get payment history
   */
  static async getPaymentHistory(userId, options = {}) {
    return PaymentModel.findByUserId(userId, options);
  }

  /**
   * Cancel subscription in Stripe
   */
  static async cancelStripeSubscription(stripeSubscriptionId, immediately = false) {
    if (immediately) {
      return stripe.subscriptions.cancel(stripeSubscriptionId);
    }

    return stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  /**
   * Get revenue statistics
   */
  static async getRevenueStats() {
    const [revenue30d, revenueByMonth, mrr] = await Promise.all([
      PaymentModel.getRevenue('30 days'),
      PaymentModel.getRevenueByMonth(12),
      SubscriptionModel.getMRR(),
    ]);

    return {
      revenue30d,
      revenueByMonth,
      mrr,
    };
  }
}

module.exports = PaymentService;