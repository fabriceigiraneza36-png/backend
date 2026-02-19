// src/middleware/validator.middleware.js
const { validate, schemas } = require('../utils/validators');
const ApiResponse = require('../utils/response');

/**
 * Validate request body against schema
 */
const validateBody = (schemaName) => {
  return (req, res, next) => {
    const schema = typeof schemaName === 'string' ? schemas[schemaName] : schemaName;
    
    if (!schema) {
      return next(new Error(`Schema '${schemaName}' not found`));
    }

    const { valid, errors, value } = validate(schema, req.body);

    if (!valid) {
      return ApiResponse.badRequest(res, 'Validation failed', errors);
    }

    req.validatedBody = value;
    next();
  };
};

/**
 * Validate request query against schema
 */
const validateQuery = (schemaName) => {
  return (req, res, next) => {
    const schema = typeof schemaName === 'string' ? schemas[schemaName] : schemaName;
    
    if (!schema) {
      return next(new Error(`Schema '${schemaName}' not found`));
    }

    const { valid, errors, value } = validate(schema, req.query);

    if (!valid) {
      return ApiResponse.badRequest(res, 'Invalid query parameters', errors);
    }

    req.validatedQuery = value;
    next();
  };
};

/**
 * Validate request params against schema
 */
const validateParams = (schemaName) => {
  return (req, res, next) => {
    const schema = typeof schemaName === 'string' ? schemas[schemaName] : schemaName;
    
    if (!schema) {
      return next(new Error(`Schema '${schemaName}' not found`));
    }

    const { valid, errors, value } = validate(schema, req.params);

    if (!valid) {
      return ApiResponse.badRequest(res, 'Invalid path parameters', errors);
    }

    req.validatedParams = value;
    next();
  };
};

/**
 * Validate UUID parameter
 */
const validateUUID = (paramName = 'id') => {
  return (req, res, next) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const value = req.params[paramName];

    if (!value || !uuidRegex.test(value)) {
      return ApiResponse.badRequest(res, `Invalid ${paramName} format`);
    }

    next();
  };
};

module.exports = {
  validateBody,
  validateQuery,
  validateParams,
  validateUUID,
};