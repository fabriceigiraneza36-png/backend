// src/utils/validators.js
const Joi = require('joi');

// Common validation schemas
const schemas = {
  // User schemas
  email: Joi.string().email().lowercase().trim().max(255),
  username: Joi.string().alphanum().min(3).max(30).lowercase().trim(),
  fullName: Joi.string().min(2).max(100).trim(),
  
  // UUID validation
  uuid: Joi.string().uuid({ version: 'uuidv4' }),
  
  // Pagination
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().max(50),
    sortOrder: Joi.string().valid('ASC', 'DESC', 'asc', 'desc'),
    search: Joi.string().max(100).allow(''),
  }),
  
  // Auth schemas
  register: Joi.object({
    email: Joi.string().email().required().lowercase().trim(),
    username: Joi.string().alphanum().min(3).max(30).required().lowercase(),
    fullName: Joi.string().min(2).max(100).trim(),
  }),
  
  login: Joi.object({
    email: Joi.string().email().required().lowercase().trim(),
  }),
  
  // Subscription schemas
  createSubscription: Joi.object({
    planId: Joi.string().uuid().required(),
    paymentMethodId: Joi.string(),
  }),
  
  // Update user
  updateUser: Joi.object({
    fullName: Joi.string().min(2).max(100).trim(),
    username: Joi.string().alphanum().min(3).max(30).lowercase(),
    avatarUrl: Joi.string().uri().allow(null, ''),
    metadata: Joi.object(),
  }),
  
  // User preferences
  updatePreferences: Joi.object({
    emailNotifications: Joi.boolean(),
    pushNotifications: Joi.boolean(),
    marketingEmails: Joi.boolean(),
    theme: Joi.string().valid('light', 'dark', 'system'),
    language: Joi.string().length(2),
    timezone: Joi.string().max(50),
  }),
};

// Validation helper
const validate = (schema, data) => {
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });
  
  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
    }));
    return { valid: false, errors };
  }
  
  return { valid: true, value };
};

module.exports = { schemas, validate };