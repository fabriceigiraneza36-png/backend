// src/routes/webhook.routes.js
const express = require('express');
const Stripe = require('stripe');
const env = require('../config/env');
const PaymentService = require('../services/payment.service');
const logger = require('../utils/logger');

const router = express.Router();
const stripe = new Stripe(env.stripe.secretKey);

/**
 * Stripe webhook handler
 * POST /api/v1/webhooks/stripe
 */
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        env.stripe.webhookSecret
      );
    } catch (err) {
      logger.error('Webhook signature verification failed:', err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      // Handle the event
      switch (event.type) {
        case 'checkout.session.completed':
          await PaymentService.handleCheckoutComplete(event.data.object);
          break;

        case 'customer.subscription.updated':
          await PaymentService.handleSubscriptionUpdated(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await PaymentService.handleSubscriptionUpdated(event.data.object);
          break;

        case 'invoice.payment_succeeded':
          await PaymentService.handlePaymentSucceeded(event.data.object);
          break;

        case 'invoice.payment_failed':
          await PaymentService.handlePaymentFailed(event.data.object);
          break;

        default:
          logger.info('Unhandled webhook event type:', event.type);
      }

      res.json({ received: true });
    } catch (error) {
      logger.error('Error processing webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

module.exports = router;