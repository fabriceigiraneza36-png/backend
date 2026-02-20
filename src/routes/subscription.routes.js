// src/routes/subscription.routes.js
const express = require('express');
const SubscriptionController = require('../controllers/subscription.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validateBody } = require('../middleware/validator.middleware');
const { schemas } = require('../utils/validators');

const router = express.Router();

// Public routes
router.get('/plans', SubscriptionController.getPlans);
router.get('/plans/:slug', SubscriptionController.getPlan);

// Protected routes
router.use(authenticate);

router.get('/current', SubscriptionController.getCurrentSubscription);
router.get('/history', SubscriptionController.getHistory);
router.post('/checkout', validateBody('createSubscription'), SubscriptionController.createCheckout);
router.patch('/change-plan', validateBody('createSubscription'), SubscriptionController.changePlan);
router.post('/cancel', SubscriptionController.cancel);
router.post('/reactivate', SubscriptionController.reactivate);
router.get('/features/:feature', SubscriptionController.checkFeature);
router.get('/limits/:limitKey', SubscriptionController.checkLimit);
router.post('/usage', SubscriptionController.recordUsage);

module.exports = router;