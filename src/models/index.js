// src/models/index.js
const UserModel = require('./user.model');
const SessionModel = require('./session.model');
const PlanModel = require('./plan.model');
const SubscriptionModel = require('./subscription.model');
const PaymentModel = require('./payment.model');
const AnalyticsModel = require('./analytics.model');
const NotificationModel = require('./notification.model');

module.exports = {
  UserModel,
  SessionModel,
  PlanModel,
  SubscriptionModel,
  PaymentModel,
  AnalyticsModel,
  NotificationModel,
};