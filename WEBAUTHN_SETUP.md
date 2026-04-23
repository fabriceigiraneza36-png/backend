# ALTUVERA WEBAUTHN AUTHENTICATION - SETUP & DEPLOYMENT GUIDE

## Table of Contents

1. [Quick Start](#quick-start)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Database Setup](#database-setup)
5. [Testing](#testing)
6. [Deployment](#deployment)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

### 5-Minute Setup (Development)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example.webauthn .env
# Edit .env with your settings

# 3. Setup database
node scripts/setup-webauthn-db.js

# 4. Start server
npm start
```

---

## Installation

### Prerequisites

- **Node.js** >= 18.0
- **PostgreSQL** >= 12
- **npm** or **yarn**

### Install Dependencies

```bash
npm install
```

New packages added:
- `@simplewebauthn/server@^10.1.0` - WebAuthn server operations

### Environment Variables

Copy and customize the example configuration:

```bash
cp .env.example.webauthn .env
```

Edit `.env` with your values:

```env
# Critical for WebAuthn to work
WEBAUTHN_RP_ID=your-domain.com
WEBAUTHN_ORIGIN=https://your-domain.com
JWT_SECRET=generate-a-random-32-char-string
DATABASE_URL=postgresql://user:password@host:5432/altuvera
```

**Generating a secure JWT_SECRET:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Configuration

### Essential Environment Variables

```env
# ═══════════════════════════════════════════════════════════════════════════════
# WEBAUTHN (REQUIRED)
# ═══════════════════════════════════════════════════════════════════════════════

# Your domain (no http/https)
WEBAUTHN_RP_ID=altuvera.com

# Full URL with protocol
WEBAUTHN_ORIGIN=https://altuvera.com

# RP Name shown to users during authentication
WEBAUTHN_RP_NAME=Altuvera

# ═══════════════════════════════════════════════════════════════════════════════
# JWT (REQUIRED)
# ═══════════════════════════════════════════════════════════════════════════════

# Secret key for signing tokens (generate with crypto.randomBytes)
JWT_SECRET=your-64-character-random-string-here

# Token expiration
JWT_EXPIRES_IN=7d

# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE (REQUIRED)
# ═══════════════════════════════════════════════════════════════════════════════

# Full PostgreSQL connection URL
DATABASE_URL=postgresql://user:password@neon.tech:5432/altuvera?sslmode=require

# OR individual components
DB_HOST=localhost
DB_PORT=5432
DB_NAME=altuvera
DB_USER=postgres
DB_PASSWORD=yourpassword

# ═══════════════════════════════════════════════════════════════════════════════
# SERVER
# ═══════════════════════════════════════════════════════════════════════════════

PORT=5000
NODE_ENV=production
```

### Development vs. Production

#### Development (localhost)

```env
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:3000
NODE_ENV=development
```

#### Production

```env
WEBAUTHN_RP_ID=altuvera.com
WEBAUTHN_ORIGIN=https://altuvera.com
NODE_ENV=production
HTTPS_ENABLED=true
```

**Important:** WebAuthn requires either:
- HTTPS in production
- `localhost` for development

---

## Database Setup

### Method 1: Automatic Setup (Recommended)

```bash
node scripts/setup-webauthn-db.js
```

This will:
1. Create all WebAuthn tables
2. Set up triggers for `updated_at`
3. Create indexes for performance
4. Create cleanup functions

### Method 2: Manual Setup

If the script fails, execute the schema manually:

```bash
# Using psql
psql -d altuvera -U postgres -f db/migrations/webauthn-schema.sql

# Or using a PostgreSQL client, copy the contents of:
# db/migrations/webauthn-schema.sql
```

### Verify Setup

```bash
# Check tables exist
psql -d altuvera -c "\dt webauthn*"

# Expected output:
# webauthn_users
# webauthn_credentials
# webauthn_challenges
# webauthn_sessions
```

### Database Schema Overview

```sql
-- Users table (no passwords)
webauthn_users {
  id: UUID
  email: VARCHAR(255) UNIQUE
  full_name: VARCHAR(255)
  webauthn_user_id: BYTEA UNIQUE
  is_verified: BOOLEAN
  is_active: BOOLEAN
  preferences: JSONB
  last_login: TIMESTAMP
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}

-- User credentials/passkeys
webauthn_credentials {
  id: UUID
  user_id: UUID (FK → webauthn_users)
  credential_id: BYTEA UNIQUE
  public_key: BYTEA
  counter: BIGINT (for cloning detection)
  transports: TEXT[]
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}

-- Registration/Login challenges (temporary)
webauthn_challenges {
  id: UUID
  challenge: BYTEA
  challenge_type: VARCHAR ('registration' | 'authentication')
  user_id: UUID (FK → webauthn_users)
  email: VARCHAR(255)
  created_at: TIMESTAMP
  expires_at: TIMESTAMP (auto-cleanup after 10 min)
}

-- Session tracking
webauthn_sessions {
  id: UUID
  user_id: UUID (FK → webauthn_users)
  token_jti: VARCHAR (JWT ID)
  ip_address: VARCHAR(45)
  user_agent: TEXT
  revoked: BOOLEAN
  created_at: TIMESTAMP
  expires_at: TIMESTAMP
}
```

---

## Testing

### 1. Health Check

```bash
curl http://localhost:5000/health
```

Expected response:

```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2024-04-23T10:30:00Z",
  "environment": "development"
}
```

### 2. Test Registration Endpoint

```bash
curl -X POST http://localhost:5000/auth/webauthn/register-options \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "name": "Test User"
  }'
```

### 3. Test Login Endpoint

```bash
curl -X POST http://localhost:5000/auth/webauthn/login-options \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com"
  }'
```

### 4. Full Integration Test

Use the included client library or Postman collection:

```bash
# Install client library
npm install @simplewebauthn/browser

# See WEBAUTHN_API.md for complete examples
```

### Unit Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Specific test file
npm test -- auth.test.js
```

---

## Deployment

### Prerequisites for Production

- ✅ HTTPS enabled
- ✅ Valid SSL certificate
- ✅ PostgreSQL database (Neon recommended)
- ✅ Environment variables configured
- ✅ JWT_SECRET set to random 32+ character value
- ✅ WEBAUTHN_RP_ID matches your domain
- ✅ CORS origins configured

### Deployment Checklist

```
Database
- [ ] PostgreSQL database created
- [ ] WebAuthn schema migrated (setup-webauthn-db.js)
- [ ] Database backups configured
- [ ] Connection pooling configured

Environment
- [ ] .env file configured (never commit this!)
- [ ] JWT_SECRET is strong (32+ chars)
- [ ] WEBAUTHN_RP_ID matches your domain
- [ ] WEBAUTHN_ORIGIN is HTTPS
- [ ] NODE_ENV=production

Security
- [ ] HTTPS enabled with valid certificate
- [ ] CORS origins whitelisted
- [ ] Rate limiting enabled
- [ ] Security headers configured (Helmet)
- [ ] Helmet.js CSP configured

Monitoring
- [ ] Application logging configured
- [ ] Error tracking setup (Sentry/etc)
- [ ] Database monitoring enabled
- [ ] Uptime monitoring configured
- [ ] Alert system configured

Performance
- [ ] Database indexes verified
- [ ] Connection pooling optimized
- [ ] Compression enabled
- [ ] Caching strategy implemented
- [ ] Load testing completed
```

### Deploy to Heroku

```bash
# 1. Login to Heroku
heroku login

# 2. Create app
heroku create altuvera-backend

# 3. Add PostgreSQL addon
heroku addons:create heroku-postgresql:standard-0 -a altuvera-backend

# 4. Set environment variables
heroku config:set JWT_SECRET=your-secret-key -a altuvera-backend
heroku config:set WEBAUTHN_RP_ID=your-domain.com -a altuvera-backend
heroku config:set WEBAUTHN_ORIGIN=https://your-domain.com -a altuvera-backend

# 5. Push code
git push heroku main

# 6. Run migrations
heroku run node scripts/setup-webauthn-db.js -a altuvera-backend

# 7. View logs
heroku logs --tail -a altuvera-backend
```

### Deploy to Render

```bash
# 1. Connect your GitHub repo to Render
# 2. Create new Web Service
# 3. Set Environment Variables:
#    - DATABASE_URL: provided by Render
#    - JWT_SECRET: your secret
#    - WEBAUTHN_RP_ID: your domain
#    - WEBAUTHN_ORIGIN: your frontend URL

# 4. Add Build Command:
#    npm install && node scripts/setup-webauthn-db.js

# 5. Add Start Command:
#    npm start
```

### Deploy to AWS (EC2 + RDS)

```bash
# 1. Launch EC2 instance (Node.js 18+)
# 2. Create RDS PostgreSQL instance
# 3. Clone repository
git clone <your-repo> altuvera-backend

# 4. Install dependencies
cd altuvera-backend
npm install

# 5. Configure environment
echo "DATABASE_URL=postgresql://..." > .env
echo "JWT_SECRET=..." >> .env
# Add other variables

# 6. Setup database
node scripts/setup-webauthn-db.js

# 7. Start with PM2
npm install -g pm2
pm2 start server.js --name "altuvera-backend"
pm2 save
pm2 startup

# 8. Setup Nginx reverse proxy
sudo apt install nginx
# Configure nginx.conf to proxy to :5000
```

---

## Troubleshooting

### Common Issues

#### 1. WebAuthn Registration Fails: "Challenge not found"

**Cause:** Challenge expired or not stored correctly

**Solution:**
```bash
# Check database connection
node -e "require('./config/db').query('SELECT NOW()').then(r => console.log(r.rows))"

# Verify webauthn_challenges table exists
psql -d altuvera -c "SELECT * FROM webauthn_challenges LIMIT 1;"

# Check challenge timeout value (should be 10 minutes)
# In webauthnController.js: const CHALLENGE_TIMEOUT_MS = 10 * 60 * 1000
```

#### 2. JWT Token Verification Fails

**Cause:** JWT_SECRET mismatch or malformed token

**Solution:**
```bash
# Verify JWT_SECRET is consistent
echo $JWT_SECRET

# Check token format
node -e "
const jwt = require('jsonwebtoken');
const token = 'your-token-here';
try {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  console.log('✅ Token valid:', decoded);
} catch (e) {
  console.log('❌ Token invalid:', e.message);
}
"
```

#### 3. CORS Errors

**Cause:** Frontend origin not whitelisted

**Solution:**
```env
# In .env, add your frontend URL
CORS_ORIGINS=https://your-frontend.com,https://www.your-frontend.com,http://localhost:3000
```

#### 4. Database Connection Fails

**Cause:** Invalid connection string or database not running

**Solution:**
```bash
# Test connection
psql -c "SELECT NOW()"

# Or using DATABASE_URL
DATABASE_URL=postgresql://... npm test

# Check .env file
cat .env | grep DATABASE
```

#### 5. "RP_ID doesn't match" Error

**Cause:** WEBAUTHN_RP_ID doesn't match your domain

**Solution:**
```bash
# For localhost development
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:3000

# For production
WEBAUTHN_RP_ID=altuvera.com (no http/https)
WEBAUTHN_ORIGIN=https://altuvera.com
```

#### 6. Missing Credential in Authentication

**Cause:** User doesn't have registered credentials

**Solution:**
```bash
# Check credentials in database
psql -d altuvera -c "SELECT * FROM webauthn_credentials WHERE user_id = 'user-id';"

# If empty, user needs to re-register
```

### Debug Mode

Enable detailed logging:

```bash
DEBUG=* npm start
```

### Performance Issues

```bash
# Check database performance
psql -d altuvera -c "\d+ webauthn_users"

# View query plans
EXPLAIN ANALYZE SELECT * FROM webauthn_users WHERE email = 'test@example.com';

# Monitor connections
psql -c "SELECT * FROM pg_stat_activity;"
```

### Security Issues

```bash
# Audit active sessions
psql -d altuvera -c "SELECT * FROM webauthn_sessions WHERE revoked = false;"

# Check for suspicious activity
psql -d altuvera -c "SELECT user_id, COUNT(*) as attempts FROM webauthn_challenges WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY user_id;"
```

---

## Support & Resources

### Documentation
- API Documentation: [WEBAUTHN_API.md](./WEBAUTHN_API.md)
- SimpleWebAuthn Docs: https://simplewebauthn.dev
- WebAuthn Spec: https://www.w3.org/TR/webauthn-2/

### Community
- GitHub Issues: https://github.com/altuvera/backend/issues
- Email: support@altuvera.com

### Additional Setup Scripts

```bash
# View database schema
node -e "require('./config/db').query('SELECT * FROM information_schema.tables WHERE table_name LIKE \\'webauthn%\\'').then(r => console.log(r.rows))"

# Test email configuration
node scripts/test-email.js

# Generate sample data
node scripts/seed-webauthn.js

# Cleanup expired challenges
node scripts/cleanup-challenges.js
```

---

**Last Updated:** April 23, 2024
**Version:** 1.0.0
