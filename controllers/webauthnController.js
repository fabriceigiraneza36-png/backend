/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WEBAUTHN AUTHENTICATION CONTROLLER
 * ═══════════════════════════════════════════════════════════════════════════════
 * Implements passwordless authentication using WebAuthn (FIDO2/Passkeys)
 * 
 * Flows:
 * 1. Registration: registerOptions → registerVerify
 * 2. Login: loginOptions → loginVerify
 * 3. Session management via JWT
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { query } = require('../config/db');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Altuvera';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'altuvera.com';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'https://altuvera.com';
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const CHALLENGE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert Buffer to Base64URL (for credential ID)
 */
const bufferToBase64URL = (buffer) => {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
};

/**
 * Convert Base64URL to Buffer
 */
const base64URLToBuffer = (base64URL) => {
  const base64 = base64URL.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (base64.length % 4)) % 4;
  return Buffer.from(base64.padEnd(base64.length + padding, '='), 'base64');
};

/**
 * Store challenge in database
 */
const storeChallenge = async (challenge, type, email, userId = null) => {
  const expiresAt = new Date(Date.now() + CHALLENGE_TIMEOUT_MS);

  try {
    await query(
      `INSERT INTO webauthn_challenges 
       (challenge, challenge_type, user_id, email, expires_at) 
       VALUES ($1, $2, $3, $4, $5)`,
      [challenge, type, userId, email, expiresAt]
    );
  } catch (error) {
    logger.error('Error storing challenge', { error });
    throw new AppError('Failed to store challenge', 500);
  }
};

/**
 * Retrieve and validate challenge
 */
const retrieveChallenge = async (challenge, type, identifier) => {
  try {
    const result = await query(
      `SELECT * FROM webauthn_challenges 
       WHERE challenge = $1 
       AND challenge_type = $2 
       AND (user_id::text = $3 OR email = $3)
       AND expires_at > NOW()
       ORDER BY created_at DESC 
       LIMIT 1`,
      [challenge, type, identifier]
    );

    if (result.rows.length === 0) {
      throw new AppError('Challenge not found or expired', 400);
    }

    return result.rows[0];
  } catch (error) {
    if (error.message === 'Challenge not found or expired') throw error;
    logger.error('Error retrieving challenge', { error });
    throw new AppError('Failed to retrieve challenge', 500);
  }
};

/**
 * Delete used challenge
 */
const deleteChallenge = async (challengeId) => {
  try {
    await query(
      'DELETE FROM webauthn_challenges WHERE id = $1',
      [challengeId]
    );
  } catch (error) {
    logger.error('Error deleting challenge', { error });
  }
};

/**
 * Generate JWT token
 */
const generateJWT = (userId, email) => {
  const payload = {
    sub: userId,
    email,
    iat: Math.floor(Date.now() / 1000),
    jti: uuidv4(),
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  return token;
};

/**
 * Get user by email or ID
 */
const getUserById = async (userId) => {
  try {
    const result = await query(
      `SELECT id, email, full_name, avatar_url, phone, nationality, 
              is_verified, is_active, preferences, last_login, created_at 
       FROM webauthn_users 
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Error retrieving user', { error });
    throw new AppError('Failed to retrieve user', 500);
  }
};

/**
 * Get user by email
 */
const getUserByEmail = async (email) => {
  try {
    const result = await query(
      `SELECT id, email, full_name, avatar_url, phone, nationality, 
              webauthn_user_id, is_verified, is_active, preferences, 
              last_login, created_at 
       FROM webauthn_users 
       WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error retrieving user by email', { error });
    throw new AppError('Failed to retrieve user', 500);
  }
};

/**
 * Get user credentials
 */
const getUserCredentials = async (userId) => {
  try {
    const result = await query(
      `SELECT id, credential_id, public_key, counter, transports, created_at 
       FROM webauthn_credentials 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows;
  } catch (error) {
    logger.error('Error retrieving user credentials', { error });
    throw new AppError('Failed to retrieve credentials', 500);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION CONTROLLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /auth/webauthn/register-options
 * Generate registration options for new user
 */
exports.registerOptions = async (req, res, next) => {
  try {
    const { email, name } = req.body;

    // Validation
    if (!email || !name) {
      throw new AppError('Email and name are required', 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError('Invalid email format', 400);
    }

    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      throw new AppError('Email already registered', 409);
    }

    // Generate a unique user ID (different from the actual database UUID)
    const webauthnUserId = crypto.randomBytes(32);

    // Generate registration options
    const options = generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: webauthnUserId,
      userName: email,
      userDisplayName: name,
      attestationType: 'none', // 'none', 'direct', 'indirect', 'enterprise'
      supportedAlgos: [-7, -257], // ES256, RS256
    });

    // Store challenge
    await storeChallenge(
      Buffer.from(options.challenge, 'base64'),
      'registration',
      email
    );

    logger.info('Registration options generated', { email });

    res.status(200).json({
      success: true,
      data: {
        options,
        sessionData: {
          email,
          name,
          webauthnUserIdB64: bufferToBase64URL(webauthnUserId),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /auth/webauthn/register-verify
 * Verify registration response and create user
 */
exports.registerVerify = async (req, res, next) => {
  try {
    const { email, name, webauthnUserIdB64, response: clientResponse } = req.body;

    // Validation
    if (!email || !name || !webauthnUserIdB64 || !clientResponse) {
      throw new AppError('Missing required fields', 400);
    }

    // Retrieve and validate challenge
    const storedChallenge = await retrieveChallenge(
      Buffer.from(clientResponse.clientDataJSON, 'base64')
        .toString('utf-8')
        .match(/"challenge":"([^"]+)"/)?.[1],
      'registration',
      email
    );

    if (!storedChallenge) {
      throw new AppError('Invalid or expired challenge', 400);
    }

    // Verify registration response
    let verification;
    try {
      verification = verifyRegistrationResponse({
        response: clientResponse,
        expectedChallenge: storedChallenge.challenge.toString('base64'),
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
      });
    } catch (error) {
      logger.error('Registration verification failed', { error, email });
      throw new AppError('Registration verification failed', 400);
    }

    if (!verification.verified) {
      throw new AppError('Registration could not be verified', 400);
    }

    const { registrationInfo } = verification;
    const webauthnUserId = base64URLToBuffer(webauthnUserIdB64);

    // Start transaction
    const client = await query.connect?.() || { query: query };

    try {
      // Create user
      const userResult = await client.query(
        `INSERT INTO webauthn_users 
         (email, full_name, webauthn_user_id, is_verified, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, NOW(), NOW()) 
         RETURNING id, email, full_name`,
        [email, name, webauthnUserId, true]
      );

      const userId = userResult.rows[0].id;

      // Store credential
      await client.query(
        `INSERT INTO webauthn_credentials 
         (user_id, credential_id, public_key, counter, transports) 
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userId,
          registrationInfo.credentialID,
          registrationInfo.credentialPublicKey,
          registrationInfo.counter,
          registrationInfo.transports || [],
        ]
      );

      // Delete used challenge
      await deleteChallenge(storedChallenge.id);

      // Generate JWT
      const token = generateJWT(userId, email);

      logger.info('User registered successfully', { email, userId });

      res.status(201).json({
        success: true,
        data: {
          user: userResult.rows[0],
          token,
        },
      });
    } catch (error) {
      logger.error('Error creating user during registration', { error });
      throw new AppError('Failed to create user account', 500);
    }
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHENTICATION CONTROLLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /auth/webauthn/login-options
 * Generate authentication options for existing user
 */
exports.loginOptions = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    // Get user
    const user = await getUserByEmail(email);
    if (!user || !user.is_active) {
      throw new AppError('User not found or account is inactive', 404);
    }

    // Get user credentials
    const credentials = await getUserCredentials(user.id);
    if (credentials.length === 0) {
      throw new AppError('No credentials found for user', 404);
    }

    // Generate authentication options
    const options = generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: credentials.map((cred) => ({
        id: cred.credential_id,
        type: 'public-key',
        transports: cred.transports || [],
      })),
    });

    // Store challenge
    await storeChallenge(
      Buffer.from(options.challenge, 'base64'),
      'authentication',
      email,
      user.id
    );

    logger.info('Login options generated', { email });

    res.status(200).json({
      success: true,
      data: {
        options,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /auth/webauthn/login-verify
 * Verify authentication response and issue JWT
 */
exports.loginVerify = async (req, res, next) => {
  try {
    const { email, response: clientResponse } = req.body;

    if (!email || !clientResponse) {
      throw new AppError('Missing required fields', 400);
    }

    // Get user
    const user = await getUserByEmail(email);
    if (!user || !user.is_active) {
      throw new AppError('User not found or account is inactive', 404);
    }

    // Retrieve challenge
    const storedChallenge = await retrieveChallenge(
      Buffer.from(clientResponse.clientDataJSON, 'base64')
        .toString('utf-8')
        .match(/"challenge":"([^"]+)"/)?.[1],
      'authentication',
      user.id
    );

    if (!storedChallenge) {
      throw new AppError('Invalid or expired challenge', 400);
    }

    // Get user credentials
    const credentials = await getUserCredentials(user.id);

    // Find the credential that was used
    const credentialUsed = credentials.find(
      (cred) => Buffer.from(cred.credential_id).toString('base64') === clientResponse.id
    );

    if (!credentialUsed) {
      throw new AppError('Credential not found for user', 404);
    }

    // Verify authentication response
    let verification;
    try {
      verification = verifyAuthenticationResponse({
        response: clientResponse,
        expectedChallenge: storedChallenge.challenge.toString('base64'),
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: credentialUsed.credential_id,
          publicKey: credentialUsed.public_key,
          counter: credentialUsed.counter,
          transports: credentialUsed.transports || [],
        },
      });
    } catch (error) {
      logger.error('Authentication verification failed', { error, email });
      throw new AppError('Authentication verification failed', 400);
    }

    if (!verification.verified) {
      throw new AppError('Authentication could not be verified', 400);
    }

    const { authenticationInfo } = verification;

    // Check counter for cloned credential detection
    if (authenticationInfo.newCounter <= credentialUsed.counter) {
      logger.warn('Potential cloned credential detected', { email, userId: user.id });
      throw new AppError('Invalid credential state (possible clone)', 400);
    }

    // Update credential counter
    await query(
      `UPDATE webauthn_credentials 
       SET counter = $1, updated_at = NOW() 
       WHERE id = $2`,
      [authenticationInfo.newCounter, credentialUsed.id]
    );

    // Update last login
    await query(
      `UPDATE webauthn_users 
       SET last_login = NOW() 
       WHERE id = $1`,
      [user.id]
    );

    // Generate JWT
    const token = generateJWT(user.id, user.email);

    // Store session
    const decoded = jwt.verify(token, JWT_SECRET);
    const expiresAt = new Date(decoded.exp * 1000);

    await query(
      `INSERT INTO webauthn_sessions 
       (user_id, token_jti, ip_address, user_agent, expires_at) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        user.id,
        decoded.jti,
        req.ip,
        req.get('user-agent'),
        expiresAt,
      ]
    );

    logger.info('User logged in successfully', { email, userId: user.id });

    // Return user data and token
    const userData = await getUserById(user.id);

    res.status(200).json({
      success: true,
      data: {
        user: userData,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// USER PROFILE CONTROLLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /auth/webauthn/me
 * Get current user profile (requires authentication)
 */
exports.getProfile = async (req, res, next) => {
  try {
    const user = await getUserById(req.user.id);

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Get credentials list (without sensitive data)
    const credentials = await query(
      `SELECT id, credential_id, transports, created_at 
       FROM webauthn_credentials 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.status(200).json({
      success: true,
      data: {
        user,
        credentials: credentials.rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /auth/webauthn/profile
 * Update user profile
 */
exports.updateProfile = async (req, res, next) => {
  try {
    const { full_name, phone, nationality, preferences } = req.body;
    const userId = req.user.id;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (full_name !== undefined) {
      updates.push(`full_name = $${paramCount++}`);
      values.push(full_name);
    }

    if (phone !== undefined) {
      updates.push(`phone = $${paramCount++}`);
      values.push(phone);
    }

    if (nationality !== undefined) {
      updates.push(`nationality = $${paramCount++}`);
      values.push(nationality);
    }

    if (preferences !== undefined) {
      updates.push(`preferences = $${paramCount++}`);
      values.push(JSON.stringify(preferences));
    }

    if (updates.length === 0) {
      throw new AppError('No fields to update', 400);
    }

    values.push(userId);
    updates.push(`updated_at = NOW()`);

    const result = await query(
      `UPDATE webauthn_users 
       SET ${updates.join(', ')} 
       WHERE id = $${paramCount} 
       RETURNING id, email, full_name, phone, nationality, preferences, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    logger.info('User profile updated', { userId });

    res.status(200).json({
      success: true,
      data: {
        user: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /auth/webauthn/logout
 * Logout user (revoke session)
 */
exports.logout = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const jti = req.user.jti;

    // Revoke session
    await query(
      `UPDATE webauthn_sessions 
       SET revoked = true 
       WHERE user_id = $1 AND token_jti = $2`,
      [userId, jti]
    );

    logger.info('User logged out', { userId });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /auth/webauthn/credential/:credentialId
 * Delete a specific credential
 */
exports.deleteCredential = async (req, res, next) => {
  try {
    const { credentialId } = req.params;
    const userId = req.user.id;

    // Check user has this credential
    const credential = await query(
      `SELECT id FROM webauthn_credentials 
       WHERE id = $1 AND user_id = $2`,
      [credentialId, userId]
    );

    if (credential.rows.length === 0) {
      throw new AppError('Credential not found', 404);
    }

    // Check if this is the last credential
    const credentialCount = await query(
      `SELECT COUNT(*) as count FROM webauthn_credentials WHERE user_id = $1`,
      [userId]
    );

    if (parseInt(credentialCount.rows[0].count) <= 1) {
      throw new AppError('Cannot delete the last credential', 400);
    }

    // Delete credential
    await query(
      `DELETE FROM webauthn_credentials WHERE id = $1`,
      [credentialId]
    );

    logger.info('Credential deleted', { userId, credentialId });

    res.status(200).json({
      success: true,
      message: 'Credential deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
