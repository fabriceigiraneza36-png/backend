// src/routes/index.js
const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const subscriptionRoutes = require('./subscription.routes');
const paymentRoutes = require('./payment.routes');
const adminRoutes = require('./admin.routes');
const webhookRoutes = require('./webhook.routes');
const { healthCheck } = require('../database/pool');
const ApiResponse = require('../utils/response');

const router = express.Router();
const routeMounts = [
  { base: '/auth', label: 'auth', router: authRoutes },
  { base: '/users', label: 'users', router: userRoutes },
  { base: '/subscriptions', label: 'subscriptions', router: subscriptionRoutes },
  { base: '/payments', label: 'payments', router: paymentRoutes },
  { base: '/admin', label: 'admin', router: adminRoutes },
  { base: '/webhooks', label: 'webhooks', router: webhookRoutes },
];

// Health check
router.get('/health', async (req, res) => {
  const dbHealthy = await healthCheck();
  
  const health = {
    status: dbHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbHealthy ? 'connected' : 'disconnected',
  };
  
  return res.status(dbHealthy ? 200 : 503).json(health);
});

// API routes
for (const routeMount of routeMounts) {
  router.use(routeMount.base, routeMount.router);
}

module.exports = router;
module.exports.routeMounts = routeMounts;
