// src/controllers/payment.controller.js
const PaymentService = require('../services/payment.service');
const ApiResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const Pagination = require('../utils/pagination');

class PaymentController {
  /**
   * Get payment history
   * GET /api/v1/payments/history
   */
  static getHistory = asyncHandler(async (req, res) => {
    const pagination = new Pagination(req.query);
    
    const result = await PaymentService.getPaymentHistory(req.user.id, {
      limit: pagination.limit,
      offset: pagination.offset,
    });
    
    return ApiResponse.paginated(
      res,
      result.data,
      pagination.getMeta(result.total)
    );
  });

  /**
   * Create payment intent
   * POST /api/v1/payments/intent
   */
  static createIntent = asyncHandler(async (req, res) => {
    const { amount, currency = 'usd', metadata = {} } = req.body;
    
    const paymentIntent = await PaymentService.createPaymentIntent(
      req.user.id,
      amount,
      currency,
      metadata
    );
    
    return ApiResponse.success(res, {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  });

  /**
   * Get payment statistics (admin only)
   * GET /api/v1/payments/stats
   */
  static getStats = asyncHandler(async (req, res) => {
    const stats = await PaymentService.getRevenueStats();
    
    return ApiResponse.success(res, stats);
  });
}

module.exports = PaymentController;