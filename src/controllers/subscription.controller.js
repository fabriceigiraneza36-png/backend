// src/controllers/subscription.controller.js
const SubscriptionService = require('../services/subscription.service');
const PaymentService = require('../services/payment.service');
const { PlanModel, SubscriptionModel } = require('../models');
const ApiResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');

class SubscriptionController {
  /**
   * Get all available plans
   * GET /api/v1/subscriptions/plans
   */
  static getPlans = asyncHandler(async (req, res) => {
    const plans = await SubscriptionService.getPlans();
    
    return ApiResponse.success(res, plans);
  });

  /**
   * Get a specific plan
   * GET /api/v1/subscriptions/plans/:slug
   */
  static getPlan = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const plan = await PlanModel.findBySlug(slug);
    
    if (!plan) {
      return ApiResponse.notFound(res, 'Plan not found');
    }
    
    return ApiResponse.success(res, plan);
  });

  /**
   * Get current user subscription
   * GET /api/v1/subscriptions/current
   */
  static getCurrentSubscription = asyncHandler(async (req, res) => {
    const data = await SubscriptionService.getUserSubscription(req.user.id);
    
    return ApiResponse.success(res, data);
  });

  /**
   * Get subscription history
   * GET /api/v1/subscriptions/history
   */
  static getHistory = asyncHandler(async (req, res) => {
    const subscriptions = await SubscriptionModel.getAllByUserId(req.user.id);
    
    return ApiResponse.success(res, subscriptions);
  });

  /**
   * Create checkout session
   * POST /api/v1/subscriptions/checkout
   */
  static createCheckout = asyncHandler(async (req, res) => {
    const { planId } = req.validatedBody;
    
    const successUrl = `${env.frontendUrl}/subscription/success`;
    const cancelUrl = `${env.frontendUrl}/subscription/cancel`;
    
    const session = await PaymentService.createCheckoutSession(
      req.user.id,
      planId,
      successUrl,
      cancelUrl
    );
    
    return ApiResponse.success(res, {
      sessionId: session.id,
      url: session.url,
    });
  });

  /**
   * Change subscription plan
   * PATCH /api/v1/subscriptions/change-plan
   */
  static changePlan = asyncHandler(async (req, res) => {
    const { planId } = req.validatedBody;
    
    const result = await SubscriptionService.changePlan(req.user.id, planId);
    
    return ApiResponse.success(res, result, 'Plan changed successfully');
  });

  /**
   * Cancel subscription
   * POST /api/v1/subscriptions/cancel
   */
  static cancel = asyncHandler(async (req, res) => {
    const { immediately = false } = req.body;
    
    const subscription = await SubscriptionService.cancelSubscription(
      req.user.id,
      immediately
    );
    
    const message = immediately
      ? 'Subscription canceled immediately'
      : 'Subscription will be canceled at the end of the billing period';
    
    return ApiResponse.success(res, subscription, message);
  });

  /**
   * Reactivate subscription
   * POST /api/v1/subscriptions/reactivate
   */
  static reactivate = asyncHandler(async (req, res) => {
    const subscription = await SubscriptionService.reactivateSubscription(req.user.id);
    
    return ApiResponse.success(res, subscription, 'Subscription reactivated successfully');
  });

  /**
   * Check feature access
   * GET /api/v1/subscriptions/features/:feature
   */
  static checkFeature = asyncHandler(async (req, res) => {
    const { feature } = req.params;
    const hasAccess = await SubscriptionService.checkFeatureAccess(req.user.id, feature);
    
    return ApiResponse.success(res, { hasAccess, feature });
  });

  /**
   * Check usage limit
   * GET /api/v1/subscriptions/limits/:limitKey
   */
  static checkLimit = asyncHandler(async (req, res) => {
    const { limitKey } = req.params;
    const usage = await SubscriptionService.checkUsageLimit(req.user.id, limitKey);
    
    return ApiResponse.success(res, usage);
  });

  /**
   * Record usage
   * POST /api/v1/subscriptions/usage
   */
  static recordUsage = asyncHandler(async (req, res) => {
    const { feature, quantity = 1, metadata = {} } = req.body;
    
    const usage = await SubscriptionService.recordUsage(
      req.user.id,
      feature,
      quantity,
      metadata
    );
    
    return ApiResponse.success(res, usage);
  });
}

module.exports = SubscriptionController;