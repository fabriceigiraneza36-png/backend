# Altuvera Backend — Authentication & Authorization API Guide

> **Version:** 1.0  
> **Purpose:** Complete frontend integration guide for all auth systems  
> **Systems Covered:** OTP (Passwordless), OAuth (Google/GitHub), Admin (Password), WebAuthn (Passkeys)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Middleware & Authorization](#2-middleware--authorization)
3. [User Authentication (OTP / Passwordless)](#3-user-authentication-otp--passwordless)
4. [Social Authentication (OAuth)](#4-social-authentication-oauth)
5. [Admin Authentication](#5-admin-authentication)
6. [WebAuthn / Passkeys](#6-webauthn--passkeys)
7. [Token Management](#7-token-management)
8. [Rate Limiting](#8-rate-limiting)
9. [Error Codes](#9-error-codes)
10. [Frontend Integration Examples](#10-frontend-integration-examples)
11. [Integration Checklist](#11-integration-checklist)

---

## 1. Architecture Overview

The Altuvera backend supports **four authentication systems**:

| System | Method | Users Table | Best For |
|--------|--------|-------------|----------|
| **OTP (Passwordless)** | Email → 6-digit code | `users` | Standard travelers |
| **Google OAuth** | Google ID Token | `users` | Quick social login |
| **GitHub OAuth** | GitHub OAuth code | `users` | Developer users |
| **Admin Auth** | Email + Password (bcrypt) | `admin_users` | Dashboard admins |
| **WebAuthn / Passkeys** | FIDO2 biometric/key | `webauthn_users` | Passwordless modern auth |

### Key Files

| File | Purpose |
|------|---------|
| `routes/users.js` | User OTP & OAuth routes |
| `routes/adminAuth.js` | Admin password routes |
| `routes/webauthn.js` | WebAuthn/Passkey routes |
| `controllers/authController.js` | OTP, OAuth, Admin logic |
| `controllers/webauthnController.js` | WebAuthn logic |
| `middleware/auth.js` | Main `protect` + `adminOnly` middleware |
| `middleware/userAuth.js` | User-only JWT middleware |
| `middleware/webauthnAuth.js` | WebAuthn session middleware |
| `middleware/rateLimiter.js` | Auth rate limiters |

---

## 2. Middleware & Authorization

### JWT Token Format
All protected endpoints expect:
```
Authorization: Bearer <token>
```

### Middleware Functions

| Middleware | File | Purpose |
|------------|------|---------|
| `protect` | `middleware/auth.js` | Validates JWT, attaches `req.user` and `req.userType` |
| `adminOnly` | `middleware/auth.js` | Ensures `userType === "admin"` or `role === "admin"` |
| `optionalAuth` | `middleware/auth.js` | Attaches user if token valid, never rejects |
| `authenticateUser` | `middleware/userAuth.js` | Same as `protect` but **rejects admin tokens** |
| `optionalUserAuth` | `middleware/userAuth.js` | Optional auth for user tokens only |
| `authMiddleware` | `middleware/auth.js` | WebAuthn-specific JWT with session revocation check |

### User Response Shape (`sanitizeUser`)
```json
{
  "id": 1,
  "email": "user@example.com",
  "username": "user@example.com",
  "fullName": "John Doe",
  "full_name": "John Doe",
  "name": "John Doe",
  "avatar": "https://...",
  "avatarUrl": "https://...",
  "avatar_url": "https://...",
  "phone": "+250...",
  "bio": "Traveler",
  "role": "user",
  "authProvider": "email",
  "auth_provider": "email",
  "isVerified": true,
  "is_verified": true,
  "emailVerified": true,
  "isActive": true,
  "preferences": {},
  "lastLogin": "2026-04-23T...",
  "createdAt": "2026-04-23T...",
  "updatedAt": "2026-04-23T..."
}
```

---

## 3. User Authentication (OTP / Passwordless)

**Base Route:** `/api/auth` (mounted via `routes/users.js`)

### A. Registration Flow

| Step | Method | Endpoint | Body | Response |
|------|--------|----------|------|----------|
| 1 | `POST` | `/api/auth/register` | `{ email, fullName, phone?, bio?, avatar? }` | `{ success, message, data: { email, requiresVerification } }` |
| 2 | `POST` | `/api/auth/verify-code` | `{ email, code }` | `{ success, message, data: { token, refreshToken, user, isNewUser } }` |

**Registration Details:**
- If email already exists and is verified → `409 Account exists. Please sign in.`
- If email exists but NOT verified → resends new OTP
- OTP is 6 digits, expires in **10 minutes**
- Max **5 attempts** before OTP is invalidated
- 60-second cooldown between resends

#### Request — Register
```json
POST /api/auth/register
{
  "email": "john@example.com",
  "fullName": "John Doe",
  "phone": "+250781234567",
  "avatar": "https://example.com/avatar.jpg"
}
```

#### Request — Verify Code
```json
POST /api/auth/verify-code
{
  "email": "john@example.com",
  "code": "123456"
}
```

#### Response — Verify Code (Success)
```json
{
  "success": true,
  "message": "Account verified!",
  "data": {
    "token": "eyJhbG...",
    "refreshToken": "eyJhbG...",
    "user": { /* sanitizeUser shape */ },
    "isNewUser": true
  }
}
```

---

### B. Login Flow

| Step | Method | Endpoint | Body | Response |
|------|--------|----------|------|----------|
| 1 | `POST` | `/api/auth/login` | `{ email, fullName? }` | `{ success, message, data: { email, isNewUser } }` |
| 2 | `POST` | `/api/auth/verify-code` | `{ email, code }` | `{ success, message, data: { token, refreshToken, user } }` |

**Login Details:**
- Auto-creates account if email doesn't exist (`isNewUser: true`)
- Sends OTP via email
- Same cooldown and attempt limits as registration

---

### C. Resend Code

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/api/auth/resend-code` | `{ email }` | `{ success, message }` |

---

### D. Check Email (Pre-flight)

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/api/auth/check-email` | `{ email }` | `{ success, data: { exists, isVerified, provider } }` |

**Use case:** Check if email exists before showing login vs register UI.

---

### E. Protected User Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/auth/me` | `protect` | Get current user profile |
| `PUT` | `/api/auth/profile` | `protect` | Update profile (`full_name`, `avatar_url`, `phone`, `bio`, `preferences`) |
| `POST` | `/api/auth/logout` | `protect` | Invalidate all sessions (token_version bump) |
| `DELETE` | `/api/auth/me` | `protect` | Delete account permanently |

#### Update Profile
```json
PUT /api/auth/profile
Authorization: Bearer <token>
{
  "full_name": "John Updated",
  "avatar_url": "https://new-avatar.com/pic.jpg",
  "phone": "+250781111111",
  "bio": "Adventure seeker",
  "preferences": { "newsletter": true }
}
```

---

## 4. Social Authentication (OAuth)

### A. Google Sign-In

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/api/auth/google` | `{ credential, phone?, bio?, avatar? }` | `{ success, data: { token, refreshToken, user, isNewUser } }` |

**Flow:**
1. Frontend gets Google ID token from Google Sign-In button
2. Send `credential` (ID token) to backend
3. Backend verifies token with Google, creates/updates user
4. Returns JWT token + user data

```json
POST /api/auth/google
{
  "credential": "eyJhbGciOiJSUzI1NiIs...",
  "phone": "+250...",
  "avatar": "https://custom-avatar.com/..."
}
```

**Note:** If you provide `avatar`, it overrides Google's picture. If not, backend uses `payload.picture` from Google.

---

### B. GitHub Sign-In

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/api/auth/github` | `{ code, phone?, bio? }` | `{ success, data: { token, refreshToken, user, isNewUser } }` |

**Flow:**
1. Frontend redirects user to GitHub OAuth
2. GitHub redirects back with `?code=...`
3. Send `code` to backend
4. Backend exchanges code for access token, fetches user profile
5. Returns JWT token + user data

```json
POST /api/auth/github
{
  "code": "abc123def456...",
  "phone": "+250..."
}
```

**Note:** Avatar is auto-fetched from GitHub (`gh.avatar_url`). Bio uses GitHub bio if not provided.

---

## 5. Admin Authentication

**Base Route:** `/api/admin/auth` (mounted via `routes/adminAuth.js`)

Admins use **email + password** (bcrypt hashed). NOT OTP.

### A. Admin Login

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/api/admin/auth/login` | `{ email, password }` | `{ success, data: { token, refreshToken, user } }` |

```json
POST /api/admin/auth/login
{
  "email": "admin@altuvera.com",
  "password": "SecurePassword123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbG...",
    "refreshToken": "eyJhbG...",
    "user": {
      "id": 1,
      "email": "admin@altuvera.com",
      "username": "admin",
      "role": "admin",
      "fullName": "Admin User"
    }
  }
}
```

---

### B. Admin Registration

| Method | Endpoint | Auth | Body | Response |
|--------|----------|------|------|----------|
| `POST` | `/api/admin/auth/register` | `protect` + `adminOnly` | `{ email, username, password, full_name?, role? }` | `{ success, data: { user } }` |

**Only existing admins can register new admins.**

```json
POST /api/admin/auth/register
Authorization: Bearer <admin-token>
{
  "email": "newadmin@altuvera.com",
  "username": "newadmin",
  "password": "SecurePass123",
  "full_name": "New Admin",
  "role": "admin"
}
```

---

### C. Admin Protected Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/admin/auth/me` | `protect` + `adminOnly` | Get admin profile |
| `PUT` | `/api/admin/auth/me` | `protect` + `adminOnly` | Update admin profile |
| `PUT` | `/api/admin/auth/profile` | `protect` + `adminOnly` | Update admin profile (alias) |
| `PUT` | `/api/admin/auth/change-password` | `protect` + `adminOnly` | Change password (`oldPassword`, `newPassword`) |
| `POST` | `/api/admin/auth/logout` | `protect` + `adminOnly` | Logout |
| `DELETE` | `/api/admin/auth/me` | `protect` + `adminOnly` | Delete admin account |

#### Change Password
```json
PUT /api/admin/auth/change-password
Authorization: Bearer <admin-token>
{
  "oldPassword": "CurrentPass123",
  "newPassword": "NewSecurePass456"
}
```

---

## 6. WebAuthn / Passkeys

**Base Route:** `/auth/webauthn` (mounted via `routes/webauthn.js`)

Modern passwordless authentication using FIDO2 / biometric / hardware keys.

### A. Registration Flow

| Step | Method | Endpoint | Body | Response |
|------|--------|----------|------|----------|
| 1 | `POST` | `/auth/webauthn/register-options` | `{ email, name }` | `{ success, data: { options, sessionData } }` |
| 2 | `POST` | `/auth/webauthn/register-verify` | `{ email, name, webauthnUserIdB64, response }` | `{ success, data: { user, token } }` |

**Frontend Flow:**
1. Call `register-options` → get WebAuthn options
2. Pass options to `navigator.credentials.create()` (browser API)
3. Send browser response to `register-verify`
4. Receive JWT token

---

### B. Login Flow

| Step | Method | Endpoint | Body | Response |
|------|--------|----------|------|----------|
| 1 | `POST` | `/auth/webauthn/login-options` | `{ email }` | `{ success, data: { options } }` |
| 2 | `POST` | `/auth/webauthn/login-verify` | `{ email, response }` | `{ success, data: { user, token } }` |

**Frontend Flow:**
1. Call `login-options` → get WebAuthn auth options
2. Pass options to `navigator.credentials.get()` (browser API)
3. Send browser response to `login-verify`
4. Receive JWT token

---

### C. Protected WebAuthn Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/auth/webauthn/me` | `authMiddleware` | Get profile + credentials list |
| `PATCH` | `/auth/webauthn/profile` | `authMiddleware` | Update profile (`full_name`, `phone`, `nationality`, `preferences`) |
| `POST` | `/auth/webauthn/logout` | `authMiddleware` | Revoke session |
| `DELETE` | `/auth/webauthn/credential/:credentialId` | `authMiddleware` | Delete a credential (cannot delete last one) |

---

## 7. Token Management

### A. Refresh Token

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/api/auth/refresh-token` | `{ refreshToken }` | `{ success, data: { token, refreshToken } }` |
| `POST` | `/api/admin/auth/refresh-token` | `{ refreshToken }` | `{ success, data: { token, refreshToken } }` |

**Use when access token expires.** Refresh tokens expire in **30 days** by default.

```json
POST /api/auth/refresh-token
{
  "refreshToken": "eyJhbG..."
}
```

---

### B. Token Expiration

| Token Type | Default Expiry | Env Variable |
|------------|----------------|--------------|
| Access Token | 7 days | `JWT_EXPIRES_IN` |
| Refresh Token | 30 days | `JWT_REFRESH_EXPIRES_IN` |

---

### C. Session Invalidation (Logout)

**User/Admin logout** bumps `token_version` in the database. All existing tokens become invalid immediately.

**WebAuthn logout** revokes the specific session in `webauthn_sessions` table.

---

## 8. Rate Limiting

Configured in `middleware/rateLimiter.js` and `middleware/security.js`:

| Limiter | Window | Max Requests | Applies To |
|---------|--------|--------------|------------|
| `authLimiter` | 60 min | 20 | `/register`, `/login`, `/google`, `/github` |
| `verifyLimiter` | 15 min | 10 | `/verify-code`, `/resend-code` |
| `contactLimiter` | 60 min | 5 | Contact form |
| `uploadLimiter` | 60 min | 20 | File uploads |
| `apiLimiter` | 15 min | 100 | General API |

**Response on limit exceeded:**
```json
{
  "error": "Too many login attempts, please try again in an hour."
}
```

---

## 9. Error Codes

### Common Auth Errors

| HTTP | Code / Message | Meaning |
|------|----------------|---------|
| `400` | `Email is required` | Missing email field |
| `400` | `Invalid email address` | Email format invalid |
| `400` | `Name must be 2–50 characters` | Name too short/long |
| `400` | `Email and code required` | Missing fields in verify |
| `401` | `Authentication required.` | No Bearer token |
| `401` | `Session expired.` | Token expired |
| `401` | `Invalid token.` | Token signature invalid |
| `401` | `Account not found.` | User deleted after token issued |
| `401` | `Account deactivated.` | User is_active = false |
| `401` | `Session invalidated.` | Token version mismatch (logged out elsewhere) |
| `403` | `Admin privileges required.` | User tried admin-only endpoint |
| `409` | `Account exists. Please sign in.` | Email already verified |
| `429` | `Wait 45 seconds.` | OTP cooldown active |
| `429` | `Too many attempts. Request a new code.` | Exceeded 5 OTP attempts |

### OAuth Errors

| HTTP | Message | Meaning |
|------|---------|---------|
| `400` | `Google credential required` | Missing credential field |
| `401` | `Google account missing verified email.` | Google token invalid |
| `400` | `GitHub code required` | Missing code field |
| `401` | `GitHub did not return an access token.` | GitHub auth failed |
| `504` | `GitHub request timed out` | GitHub API slow |

---

## 10. Frontend Integration Examples

### Complete OTP Registration Flow

```js
// Step 1: Register / Request OTP
const registerRes = await fetch("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "john@example.com",
    fullName: "John Doe",
  }),
});
const registerData = await registerRes.json();
// → { success: true, message: "Account created! Code sent.", data: { email } }

// Step 2: User enters OTP from email
const verifyRes = await fetch("/api/auth/verify-code", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "john@example.com",
    code: "123456",
  }),
});
const verifyData = await verifyRes.json();
// → { success: true, data: { token, refreshToken, user, isNewUser } }

// Store tokens
localStorage.setItem("token", verifyData.data.token);
localStorage.setItem("refreshToken", verifyData.data.refreshToken);
```

---

### OTP Login Flow

```js
// Step 1: Login request
const loginRes = await fetch("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "john@example.com" }),
});

// Step 2: Verify code (same as registration)
const verifyRes = await fetch("/api/auth/verify-code", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "john@example.com", code: "123456" }),
});
```

---

### Google Sign-In

```js
// After Google Sign-In button returns credentialResponse
const res = await fetch("/api/auth/google", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    credential: credentialResponse.credential,
    phone: "+250...",      // optional
    avatar: "https://...",  // optional (overrides Google)
  }),
});
const data = await res.json();
// → { success: true, data: { token, refreshToken, user, isNewUser } }
```

---

### Admin Login

```js
const res = await fetch("/api/admin/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "admin@altuvera.com",
    password: "SecurePassword123",
  }),
});
const data = await res.json();
// → { success: true, data: { token, refreshToken, user } }
```

---

### Making Authenticated Requests

```js
const token = localStorage.getItem("token");

const res = await fetch("/api/auth/me", {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

---

### Token Refresh

```js
const refreshToken = localStorage.getItem("refreshToken");

const res = await fetch("/api/auth/refresh-token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ refreshToken }),
});
const data = await res.json();

if (data.success) {
  localStorage.setItem("token", data.data.token);
  localStorage.setItem("refreshToken", data.data.refreshToken);
}
```

---

### Logout

```js
const token = localStorage.getItem("token");

await fetch("/api/auth/logout", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});

localStorage.removeItem("token");
localStorage.removeItem("refreshToken");
```

---

## 11. Integration Checklist

### OTP Auth
- [ ] Implement email input → `/register` or `/login`
- [ ] Show OTP input screen after API returns success
- [ ] Call `/verify-code` with email + 6-digit code
- [ ] Store `token` and `refreshToken` in secure storage
- [ ] Handle `429` cooldown errors (show countdown timer)
- [ ] Handle `401` expired/invalid code (show attempts remaining)
- [ ] Implement `/resend-code` with cooldown UI
- [ ] Use `/check-email` to toggle Login vs Register UI

### OAuth
- [ ] Add Google Sign-In button, send `credential` to `/api/auth/google`
- [ ] Add GitHub OAuth redirect, send `code` to `/api/auth/github`
- [ ] Handle both the same response shape as OTP

### Admin
- [ ] Separate login form with email + password → `/api/admin/auth/login`
- [ ] Store admin token separately from user token
- [ ] Use admin token for all dashboard API calls
- [ ] Implement change-password UI calling `/api/admin/auth/change-password`

### WebAuthn (Passkeys)
- [ ] Use `@simplewebauthn/browser` for frontend
- [ ] Call `register-options` → `navigator.credentials.create()` → `register-verify`
- [ ] Call `login-options` → `navigator.credentials.get()` → `login-verify`
- [ ] Store token same as OTP flow

### General
- [ ] Always include `Authorization: Bearer <token>` for protected routes
- [ ] Implement token refresh when 401 "Session expired" is returned
- [ ] Clear tokens and redirect to login on logout or account deletion
- [ ] Handle `403` by redirecting non-admins away from admin pages

---

*Document generated for Altuvera Travel backend.*
