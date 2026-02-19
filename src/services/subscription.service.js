// src/services/subscription.service.js
const { SubscriptionModel, PlanModel, PaymentModel, UserModel } = require('../models');
const { withTransaction } = require('../database/pool');
const EmailService = require('./email.service');
const AnalyticsService = require('./analytics.service');
const { SUBSCRIPTION_STATUS, PAYMENT_STATUS, EVENTS } = require('../config/constants');
const { calculateSubscriptionEndDate } = require('../utils/helpers');
const logger = require('../utils/logger');

class SubscriptionService {
  /**
   * Get user's active subscription with plan details
   */
  static async getUserSubscription(userId) {
    const subscription = await SubscriptionModel.findActiveByUserId(userId);
    
    if (!subscription) {
      // Check if user has free plan
      const freePlan = await PlanModel.getFreePlan();
      return {
        hasSubscription: false,
        plan: freePlan,
        isFreeTier: true,
      };
    }

    return {
      hasSubscription: true,
      subscription,
      plan: {
        id: subscription.plan_id,
        name: subscription.plan_name,
        slug: subscription.plan_slug,
        price: subscription.price,
        features: subscription.features,
        limits: subscription.limits,
      },
      isFreeTier: false,
    };
  }

  /**
   * Create a new subscription
   */
  static async createSubscription(userId, planId, paymentData = {}) {
    const plan = await PlanModel.findById(planId);
    if (!plan || !plan.is_active) {
      throw { status: 404, message: 'Plan not found or inactive' };
    }

    // Check for existing active subscription
    const existingSub = await SubscriptionModel.findActiveByUserId(userId);
    if (existingSub) {
      throw { status: 400, message: 'User already has an active subscription' };
    }

    const user = await UserModel.findById(userId);

    return withTransaction(async (client) => {
      // Create subscription
      const subscription = await SubscriptionModel.create({
        userId,
        planId,
        trialDays: plan.trial_days,
        stripeSubscriptionId: paymentData.stripeSubscriptionId,
        stripeCustomerId: paymentData.stripeCustomerId,
      });

      // Create initial payment record if not free
      if (plan.price > 0 && paymentData.paymentIntentId) {
        await PaymentModel.create({
          userId,
          subscriptionId: subscription.id,
          amount: plan.price,
          currency: plan.currency,
          status: PAYMENT_STATUS.COMPLETED,
          stripePaymentIntentId: paymentData.paymentIntentId,
        });
      }

      // Track event
      await AnalyticsService.track({
        userId,
        eventName: EVENTS.SUBSCRIPTION_CREATED,
        properties: {
          planId,
          planName: plan.name,
          price: plan.price,
          hasTrial: plan.trial_days > 0,
        },
      });

      // Send confirmation email
      await EmailService.sendSubscriptionConfirmation(user, subscription, plan);

      return { subscription, plan };
    });
  }

  /**
   * Change subscription plan
   */
  static async changePlan(userId, newPlanId) {
    const subscription = await SubscriptionModel.findActiveByUserId(userId);
    if (!subscription) {
      throw { status: 404, message: 'No active subscription found' };
    }

    const newPlan = await PlanModel.findById(newPlanId);
    if (!newPlan || !newPlan.is_active) {
      throw { status: 404, message: 'Plan not found or inactive' };
    }

    const currentPlan = await PlanModel.findById(subscription.plan_id);

    // Calculate prorated amount if upgrading
    const isUpgrade = newPlan.price > currentPlan.price;
    
    const updatedSubscription = await SubscriptionModel.update(subscription.id, {
      planId: newPlanId,
      metadata: {
        ...subscription.metadata,
        previousPlanId: subscription.plan_id,
        planChangedAt: new Date().toISOString(),
      },
    });

    return { subscription: updatedSubscription, plan: newPlan, isUpgrade };
  }

  /**
   * Cancel subscription
   */
  static async cancelSubscription(userId, immediately = false) {
    const subscription = await SubscriptionModel.findActiveByUserId(userId);
    if (!subscription) {
      throw { status: 404, message: 'No active subscription found' };
    }

    const canceledSubscription = await SubscriptionModel.cancel(subscription.id, immediately);

    // Track event
    await AnalyticsService.track({
      userId,
      eventName: EVENTS.SUBSCRIPTION_CANCELED,
      properties: {
        planId: subscription.plan_id,
        canceledImmediately: immediately,
      },
    });

    return canceledSubscription;
  }

  /**
   * Reactivate canceled subscription
   */
  static async reactivateSubscription(userId) {
    const subscription = await SubscriptionModel.findByUserId(userId);
    if (!subscription) {
      throw { status: 404, message: 'No subscription found' };
    }

    if (subscription.status === SUBSCRIPTION_STATUS.ACTIVE) {
      throw { status: 400, message: 'Subscription is already active' };
    }

    if (new Date(subscription.current_period_end) < new Date()) {
      throw { status: 400, message: 'Subscription period has ended. Please create a new subscription.' };
    }

    return SubscriptionModel.reactivate(subscription.id);
  }

  /**
   * Check feature access
   */
  static async checkFeatureAccess(userId, feature) {
    const { subscription, plan, isFreeTier } = await this.getUserSubscription(userId);

    if (isFreeTier) {
      const freePlan = await PlanModel.getFreePlan();
      return freePlan?.features?.includes(feature) || false;
    }

    return plan.features?.includes(feature) || false;
  }

  /**
   * Check usage limits
   */
  static async checkUsageLimit(userId, limitKey) {
    const { subscription, plan, isFreeTier } = await this.getUserSubscription(userId);
    
    const limits = plan?.limits || {};
    const limit = limits[limitKey];

    if (limit === undefined) {
      return { allowed: true, limit: null };
    }

    if (limit === -1) {
      return { allowed: true, limit: 'unlimited' };
    }

    // Get current usage
    const usage = await this.getCurrentUsage(userId, limitKey);

    return {
      allowed: usage < limit,
      limit,
      current: usage,
      remaining: Math.max(0, limit - usage),
    };
  }

  /**
   * Get current usage for a specific feature
   */
  static async getCurrentUsage(userId, feature) {
    const result = await require('../database/pool').queryOne(`
      SELECT COALESCE(SUM(quantity), 0) as total
      FROM usage_records
      WHERE user_id = $1 AND feature = $2
      AND recorded_at >= DATE_TRUNC('month', CURRENT_DATE)
    `, [userId, feature]);

    return parseInt(result.total, 10);
  }

  /**
   * Record usage
   */
  static async recordUsage(userId, feature, quantity = 1, metadata = {}) {
    const subscription = await SubscriptionModel.findActiveByUserId(userId);

    await require('../database/pool').query(`
      INSERT INTO usage_records (user_id, subscription_id, feature, quantity, metadata)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, subscription?.id, feature, quantity, JSON.stringify(metadata)]);

    return this.checkUsageLimit(userId, feature);
  }

  /**
   * Get all available plans
   */
  static async getPlans() {
    return PlanModel.findAll();
  }

  /**
   * Process expiring subscriptions
   */
  static async processExpiringSubscriptions() {
    const expiringIn7Days = await SubscriptionModel.getExpiring(7);
    const expiringIn3Days = await SubscriptionModel.getExpiring(3);
    const expiringIn1Day = await SubscriptionModel.getExpiring(1);

    const notifications = [];

    for (const sub of expiringIn7Days) {
      if (!expiringIn3Days.find(s => s.id === sub.id)) {
        notifications.push({
          subscription: sub,
          daysLeft: 7,
        });
      }
    }

    for (const sub of expiringIn3Days) {
      if (!expiringIn1Day.find(s => s.id === sub.id)) {
        notifications.push({
          subscription: sub,
          daysLeft: 3,
        });
      }
    }

    for (const sub of expiringIn1Day) {
      notifications.push({
        subscription: sub,
        daysLeft: 1,
      });
    }

    // Send emails
    for (const { subscription, daysLeft } of notifications) {
      try {
        await EmailService.sendSubscriptionExpiring(
          { email: subscription.email, full_name: subscription.username },
          subscription,
          daysLeft
        );
      } catch (error) {
        logger.error('Failed to send expiring notification:', error);
      }
    }

    return notifications.length;
  }

  /**
   * Process expired subscriptions
   */
  static async processExpiredSubscriptions() {
    const expired = await SubscriptionModel.getExpired();
    
    if (expired.length === 0) return 0;

    const ids = expired.map(s => s.id);
    await SubscriptionModel.markAsExpired(ids);

    logger.info(`Marked ${ids.length} subscriptions as expired`);
    return ids.length;
  }
}

module.exports = SubscriptionService;