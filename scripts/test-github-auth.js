#!/usr/bin/env node
// scripts/test-github-auth.js
// Simulate GitHub OAuth flow using nock and call the backend endpoint

const nock = require('nock');
const path = require('path');
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3000';

// Stub the DB module in require.cache to avoid real DB connections
const dbPath = path.resolve(__dirname, '..', 'config', 'db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (text, params) => {
      const sql = (text || '').toString();
      // SELECT existing user
      if (sql.includes('SELECT * FROM users WHERE github_id')) {
        return { rows: [] };
      }
      // INSERT ... RETURNING -> simulate created user
      if (sql.trim().toUpperCase().startsWith('INSERT INTO USERS')) {
        const email = params[0] || 'testuser@example.com';
        const name = params[1] || 'Test User';
        const avatar = params[2] || null;
        const providerId = params[3] || '123456';
        return {
          rows: [{
            id: 999,
            email,
            full_name: name,
            avatar_url: avatar,
            github_id: providerId,
            is_new_row: true,
            login_counter: 0,
            is_active: true,
            is_verified: true,
          }],
        };
      }
      // incrementLoginCounter
      if (sql.includes('UPDATE users') && sql.includes('login_counter')) {
        return { rows: [{ id: 999, email: 'testuser@example.com', login_counter: 1, full_name: 'Test User', avatar_url: null }] };
      }
      return { rows: [] };
    },
  },
};

const fetch = global.fetch || require('node-fetch');

async function run() {
  // Ensure GitHub env vars are present for the controller checks
  process.env.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'fake-client-id';
  process.env.GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || 'fake-client-secret';
  // JWT secrets for token generation
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-jwt-refresh';
    // Stub global.fetch for GitHub endpoints (avoid external HTTP calls)
    global.fetch = async (url, options = {}) => {
      const u = String(url || '');
      if (u.includes('github.com/login/oauth/access_token')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ access_token: 'fake-access-token', token_type: 'bearer' }),
        };
      }
      if (u.includes('api.github.com/user') && !u.includes('/emails')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 123456, login: 'testuser', name: 'Test User', email: null, avatar_url: 'https://example.com/avatar.png', bio: 'Test bio' }),
        };
      }
      if (u.includes('api.github.com/user/emails')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ email: 'testuser@example.com', primary: true, verified: true }]),
        };
      }
      throw new Error('Unexpected fetch: ' + u);
    };

  try {
    // Require the controller after stubbing DB
    const auth = require(path.resolve(__dirname, '..', 'controllers', 'authController.js'));

    // Mock req/res
    const req = { body: { code: 'fake-code' } };
    const result = {};
    const res = {
      status(code) { result.status = code; return this; },
      json(payload) { result.json = payload; return this; },
      redirect(u) { result.redirect = u; return this; },
    };

    await auth.githubAuth(req, res);

    console.log('Result status:', result.status);
    console.log('Result body:', JSON.stringify(result.json || result, null, 2));

    if (result.json && result.json.success) {
      console.log('\n✅ GitHub auth test succeeded — controller returned success');
      process.exit(0);
    }

    console.error('\n❌ GitHub auth test did not return success');
    process.exit(2);
  } catch (err) {
    console.error('Error during test:', err && err.stack ? err.stack : err.message || err);
    process.exit(1);
  }
}

run();
