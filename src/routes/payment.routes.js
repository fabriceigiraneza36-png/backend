// src/routes/payment.routes.js
const express = require('express');
const PaymentController = require('../controllers/payment.controller');
const { authenticate, requireAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/history', PaymentController.getHistory);
router.post('/intent', PaymentController.createIntent);
router.get('/stats', requireAdmin, PaymentController.getStats);

module.exports = router;