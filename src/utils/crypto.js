// src/utils/crypto.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const env = require('../config/env');

/**
 * Generate a random token
 */
const generateToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Generate a short unique ID
 */
const generateId = (length = 12) => {
  return nanoid(length);
};

/**
 * Hash a token for storage
 */
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Hash a password
 */
const hashPassword = async (password, rounds = 12) => {
  return bcrypt.hash(password, rounds);
};

/**
 * Compare password with hash
 */
const comparePassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

/**
 * Generate JWT access token
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn,
    issuer: 'altuvera',
  });
};

/**
 * Generate JWT refresh token
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn,
    issuer: 'altuvera',
  });
};

/**
 * Verify JWT token
 */
const verifyToken = (token, secret = env.jwt.secret) => {
  return jwt.verify(token, secret);
};

/**
 * Decode JWT without verification
 */
const decodeToken = (token) => {
  return jwt.decode(token);
};

/**
 * Generate magic link token
 */
const generateMagicLinkToken = () => {
  return `ml_${nanoid(32)}`;
};

/**
 * Generate API key
 */
const generateApiKey = () => {
  const prefix = 'ak_';
  const key = crypto.randomBytes(24).toString('base64url');
  return prefix + key;
};

module.exports = {
  generateToken,
  generateId,
  hashToken,
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  decodeToken,
  generateMagicLinkToken,
  generateApiKey,
};