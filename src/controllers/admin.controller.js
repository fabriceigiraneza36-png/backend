// src/controllers/admin.controller.js
const { UserModel, SubscriptionModel, PlanModel } = require('../models');
const PaymentService = require('../services/payment.service');
const ApiResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const Pagination = require('../utils/pagination');

class AdminController {
  /**
   * Get all users
   * GET /api/v1/admin/users
   */
  static getUsers = asyncHandler(async (req, res) => {
    const pagination = new Pagination(req.query);
    
    const result = await UserModel.findAll({
      limit: pagination.limit,
      offset: pagination.offset,
      sortBy: pagination.sortBy,
      sortOrder: pagination.sortOrder,
      search: pagination.search,
    });
    
    return ApiResponse.paginated(res, result.data, pagination.getMeta(result.total));
  });

  /**
   * Get user by ID
   * GET /api/v1/admin/users/:id
   */
  static getUser = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const user = await UserModel.findById(id);
    
    if (!user) {
      return ApiResponse.notFound(res, 'User not found');
    }
    
    const subscription = await SubscriptionModel.findByUserId(id);
    
    return ApiResponse.success(res, { user, subscription });
  });

  /**
   * Update user
   * PATCH /api/v1/admin/users/:id
   */
  static updateUser = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    
    const user = await UserModel.update(id, updates);
    
    if (!user) {
      return ApiResponse.notFound(res, 'User not found');
    }
    
    return ApiResponse.success(res, user, 'User updated successfully');
  });

  /**
   * Delete user
   * DELETE /api/v1/admin/users/:id
   */
  static deleteUser = asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    await UserModel.delete(id);
    
    return ApiResponse.success(res, null, 'User deleted successfully');
  });

  /**
   * Get all subscriptions
   * GET /api/v1/admin/subscriptions
   */
  static getSubscriptions = asyncHandler(async (req, res) => {
    const pagination = new Pagination(req.query);
    const { status } = req.query;
    
    let query = `
      SELECT s.*, u.email, u.username, p.name as plan_name
      FROM subscriptions s
      JOIN users u ON s.user_id = u.id
      JOIN plans p ON s.plan_id = p.id
    `;
    
    const params = [];
    if (status) {
      query += ` WHERE s.status = $1`;
      params.push(status);
    }
    
    query += ` ORDER BY s.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(pagination.limit, pagination.offset);
    
    const data = await require('../database/pool').queryAll(query, params);
    
    const countQuery = status 
      ? 'SELECT COUNT(*) FROM subscriptions WHERE status = $1'
      : 'SELECT COUNT(*) FROM subscriptions';
    const countParams = status ? [status] : [];
    const count = await require('../database/pool').queryOne(countQuery, countParams);
    
    return ApiResponse.paginated(
      res,
      data,
      pagination.getMeta(parseInt(count.count, 10))
    );
  });

  /**
   * Get statistics
   * GET /api/v1/admin/stats
   */
  static getStats = asyncHandler(async (req, res) => {
    const [userStats, subStats, revenue] = await Promise.all([
      UserModel.getStats(),
      SubscriptionModel.getStats(),
      PaymentService.getRevenueStats(),
    ]);
    
    return ApiResponse.success(res, {
      users: userStats,
      subscriptions: subStats,
      revenue,
    });
  });

  /**
   * Create plan
   * POST /api/v1/admin/plans
   */
  static createPlan = asyncHandler(async (req, res) => {
    const plan = await PlanModel.create(req.body);
    
    return ApiResponse.created(res, plan, 'Plan created successfully');
  });

  /**
   * Update plan
   * PATCH /api/v1/admin/plans/:id
   */
  static updatePlan = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const plan = await PlanModel.update(id, req.body);
    
    if (!plan) {
      return ApiResponse.notFound(res, 'Plan not found');
    }
    
    return ApiResponse.success(res, plan, 'Plan updated successfully');
  });

  /**
   * Delete plan
   * DELETE /api/v1/admin/plans/:id
   */
  static deletePlan = asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    await PlanModel.delete(id);
    
    return ApiResponse.success(res, null, 'Plan deleted successfully');
  });
}

module.exports = AdminController;