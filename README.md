# Altuvera Travel - Backend (Node.js + PostgreSQL)

A production-ready Express backend with advanced security, monitoring, and resiliency features.

---

## ✅ Quick Start (Development)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create environment variables:
   ```bash
   cp .env.example .env
   # then edit .env and provide real values
   ```

3. Start in development mode:
   ```bash
   npm run dev
   ```

4. Run tests:
   ```bash
   npm test
   ```

---

## ✅ Production

Ensure your environment provides a database (PostgreSQL) and sets these required variables:

- `NODE_ENV=production`
- `PORT` (e.g., `3000`)
- `DATABASE_URL` or `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `JWT_SECRET` (at least 32 characters)
- `JWT_REFRESH_SECRET` (at least 32 characters)

Then start the server:

```bash
npm run start
```

> Tip: For zero-downtime deployments, run with a process manager (PM2, Docker, systemd, etc.) and take advantage of the built-in graceful shutdown behavior.

---

## ✅ Health & Monitoring Endpoints

- `/api/health` — returns overall service health (DB status, route count, memory usage)
- `/api/stats` — detailed runtime stats (protected in production via `x-admin-key` header)

---

## ✅ Helpful Scripts

- `npm run test` — runs Jest integration tests
- `npm run dev` — start in development with `nodemon`
- `npm run db:init` — initialize database (calls `config/db` initializer)
- `npm run db:reset` — reset database (based on config scripts)

---

## 🔒 Production Improvements Included

- Robust env validation (via `config/env.js` + `zod`)
- Graceful shutdown handling with database cleanup
- SQL connection pooling with automatic retries
- Security middleware (CORS, helmet, rate limiting, sanitization)
- Built-in monitoring + logging

---

## 📦 Notes

If you plan to run this in Docker or in CI, make sure the database is reachable from the container and you expose the correct port.
