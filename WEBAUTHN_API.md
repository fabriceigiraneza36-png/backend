# ALTUVERA WEBAUTHN AUTHENTICATION API DOCUMENTATION

## Overview

Altuvera uses **passwordless authentication with WebAuthn (FIDO2/Passkeys)** for secure, user-friendly access. No passwords are stored or transmitted.

## Architecture

### Database Schema

#### `webauthn_users`
- `id` (UUID, PK) - User identifier
- `email` (VARCHAR, unique, optional) - User email
- `full_name` (VARCHAR) - User's full name
- `avatar_url` (VARCHAR) - Profile picture URL
- `phone` (VARCHAR) - Contact number
- `nationality` (VARCHAR) - User's nationality
- `webauthn_user_id` (BYTEA, unique) - WebAuthn user ID
- `is_verified` (BOOLEAN) - Email verification status
- `is_active` (BOOLEAN) - Account active status
- `preferences` (JSONB) - User preferences and settings
- `last_login` (TIMESTAMP) - Last login timestamp
- `created_at` (TIMESTAMP) - Account creation date
- `updated_at` (TIMESTAMP) - Last update date

#### `webauthn_credentials`
- `id` (UUID, PK) - Credential identifier
- `user_id` (UUID, FK) - Reference to user
- `credential_id` (BYTEA, unique) - WebAuthn credential ID
- `public_key` (BYTEA) - Credential public key
- `counter` (BIGINT) - Credential counter (for cloning detection)
- `transports` (TEXT[]) - Supported transports (usb, nfc, ble, internal)
- `created_at` (TIMESTAMP) - When credential was registered
- `updated_at` (TIMESTAMP) - Last update date

#### `webauthn_challenges`
- `id` (UUID, PK) - Challenge identifier
- `challenge` (BYTEA) - Random challenge value
- `challenge_type` (VARCHAR) - 'registration' or 'authentication'
- `user_id` (UUID, FK) - Reference to user (null for registration)
- `email` (VARCHAR) - Email being registered
- `created_at` (TIMESTAMP) - Challenge creation time
- `expires_at` (TIMESTAMP) - Challenge expiration time (10 minutes)

#### `webauthn_sessions`
- `id` (UUID, PK) - Session identifier
- `user_id` (UUID, FK) - Reference to user
- `token_jti` (VARCHAR) - JWT ID claim (unique token identifier)
- `ip_address` (VARCHAR) - Client IP address
- `user_agent` (TEXT) - Client user agent
- `revoked` (BOOLEAN) - Session revocation status
- `created_at` (TIMESTAMP) - Session creation time
- `expires_at` (TIMESTAMP) - Session expiration time

---

## API Endpoints

### PUBLIC ENDPOINTS (No Authentication Required)

#### 1. Registration - Step 1: Get Registration Options

```http
POST /auth/webauthn/register-options
Content-Type: application/json

{
  "email": "user@example.com",
  "name": "John Doe"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "options": {
      "challenge": "base64-encoded-challenge",
      "rp": {
        "name": "Altuvera",
        "id": "altuvera.com"
      },
      "user": {
        "id": "base64-encoded-user-id",
        "name": "user@example.com",
        "displayName": "John Doe"
      },
      "pubKeyCredParams": [
        { "type": "public-key", "alg": -7 },
        { "type": "public-key", "alg": -257 }
      ],
      "timeout": 60000,
      "attestation": "none"
    },
    "sessionData": {
      "email": "user@example.com",
      "name": "John Doe",
      "webauthnUserIdB64": "base64-encoded-user-id"
    }
  }
}
```

**Store `sessionData` on client for next step.**

---

#### 2. Registration - Step 2: Verify Registration

```http
POST /auth/webauthn/register-verify
Content-Type: application/json

{
  "email": "user@example.com",
  "name": "John Doe",
  "webauthnUserIdB64": "base64-user-id-from-step-1",
  "response": {
    "id": "base64-credential-id",
    "rawId": "base64-credential-id",
    "response": {
      "clientDataJSON": "base64-client-data",
      "attestationObject": "base64-attestation"
    },
    "type": "public-key"
  }
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid-user-id",
      "email": "user@example.com",
      "full_name": "John Doe"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Save the JWT token - use it for authenticated requests.**

---

#### 3. Login - Step 1: Get Login Options

```http
POST /auth/webauthn/login-options
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "options": {
      "challenge": "base64-encoded-challenge",
      "timeout": 60000,
      "rpId": "altuvera.com",
      "allowCredentials": [
        {
          "id": "base64-credential-id",
          "type": "public-key",
          "transports": ["usb", "ble", "internal"]
        }
      ],
      "userVerification": "preferred"
    }
  }
}
```

---

#### 4. Login - Step 2: Verify Authentication

```http
POST /auth/webauthn/login-verify
Content-Type: application/json

{
  "email": "user@example.com",
  "response": {
    "id": "base64-credential-id",
    "rawId": "base64-credential-id",
    "response": {
      "clientDataJSON": "base64-client-data",
      "authenticatorData": "base64-authenticator-data",
      "signature": "base64-signature",
      "userHandle": "base64-user-handle"
    },
    "type": "public-key"
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid-user-id",
      "email": "user@example.com",
      "full_name": "John Doe",
      "phone": "+1234567890",
      "nationality": "USA",
      "is_verified": true,
      "is_active": true,
      "preferences": {},
      "last_login": "2024-04-23T10:30:00Z",
      "created_at": "2024-01-15T08:00:00Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### PROTECTED ENDPOINTS (Authentication Required)

All protected endpoints require the JWT token in the Authorization header:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

#### 5. Get Current User Profile

```http
GET /auth/webauthn/me
Authorization: Bearer <JWT_TOKEN>
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid-user-id",
      "email": "user@example.com",
      "full_name": "John Doe",
      "phone": "+1234567890",
      "nationality": "USA",
      "avatar_url": null,
      "is_verified": true,
      "is_active": true,
      "preferences": {
        "language": "en",
        "notifications": true
      },
      "last_login": "2024-04-23T10:30:00Z",
      "created_at": "2024-01-15T08:00:00Z"
    },
    "credentials": [
      {
        "id": "cred-uuid-1",
        "credential_id": "base64-credential-id",
        "transports": ["usb", "ble", "internal"],
        "created_at": "2024-01-15T08:00:00Z"
      }
    ]
  }
}
```

---

#### 6. Update User Profile

```http
PATCH /auth/webauthn/profile
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "full_name": "Jane Doe",
  "phone": "+9876543210",
  "nationality": "Kenya",
  "preferences": {
    "language": "en",
    "notifications": true,
    "newsletter": false
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid-user-id",
      "email": "user@example.com",
      "full_name": "Jane Doe",
      "phone": "+9876543210",
      "nationality": "Kenya",
      "preferences": {
        "language": "en",
        "notifications": true,
        "newsletter": false
      },
      "updated_at": "2024-04-23T11:00:00Z"
    }
  }
}
```

---

#### 7. Logout (Revoke Session)

```http
POST /auth/webauthn/logout
Authorization: Bearer <JWT_TOKEN>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

#### 8. Delete Credential (Remove a Passkey)

```http
DELETE /auth/webauthn/credential/{credentialId}
Authorization: Bearer <JWT_TOKEN>
```

**Parameters:**
- `credentialId` (path): UUID of the credential to delete

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Credential deleted successfully"
}
```

**Note:** Users cannot delete their last credential.

---

## Error Responses

### Common Error Codes

#### 400 Bad Request
```json
{
  "success": false,
  "message": "Invalid request payload"
}
```

#### 401 Unauthorized
```json
{
  "success": false,
  "message": "Authentication required" or "Invalid token"
}
```

#### 404 Not Found
```json
{
  "success": false,
  "message": "User not found" or "Resource not found"
}
```

#### 409 Conflict
```json
{
  "success": false,
  "message": "Email already registered"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Internal server error"
}
```

---

## Client Implementation Example

### JavaScript/TypeScript Client

```typescript
import * as WebAuthnLib from '@simplewebauthn/browser';

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

async function registerUser(email: string, name: string) {
  try {
    // Step 1: Get registration options
    const optionsRes = await fetch('/auth/webauthn/register-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name })
    });
    
    const { data } = await optionsRes.json();
    const { options, sessionData } = data;

    // Step 2: Create credential with user interaction
    const attResp = await WebAuthnLib.startRegistration(options);

    // Step 3: Verify registration with server
    const verifyRes = await fetch('/auth/webauthn/register-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        name,
        webauthnUserIdB64: sessionData.webauthnUserIdB64,
        response: attResp
      })
    });

    const { data: { token, user } } = await verifyRes.json();

    // Store token
    localStorage.setItem('token', token);
    
    return { token, user };
  } catch (error) {
    console.error('Registration failed:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════════════════════

async function loginUser(email: string) {
  try {
    // Step 1: Get login options
    const optionsRes = await fetch('/auth/webauthn/login-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const { data } = await optionsRes.json();
    const { options } = data;

    // Step 2: Authenticate with user interaction
    const asseRes = await WebAuthnLib.startAuthentication(options);

    // Step 3: Verify authentication with server
    const verifyRes = await fetch('/auth/webauthn/login-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        response: asseRes
      })
    });

    const { data: { token, user } } = await verifyRes.json();

    // Store token
    localStorage.setItem('token', token);
    
    return { token, user };
  } catch (error) {
    console.error('Login failed:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHENTICATED REQUESTS
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchAuthenticatedAPI(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  
  return fetch(endpoint, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
}

// Get profile
async function getProfile() {
  const res = await fetchAuthenticatedAPI('/auth/webauthn/me');
  return res.json();
}

// Update profile
async function updateProfile(updates: object) {
  const res = await fetchAuthenticatedAPI('/auth/webauthn/profile', {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
  return res.json();
}

// Logout
async function logout() {
  await fetchAuthenticatedAPI('/auth/webauthn/logout', {
    method: 'POST'
  });
  localStorage.removeItem('token');
}
```

---

## Security Considerations

### Counter Verification
- Each credential maintains a counter to detect cloned authenticators
- If counter doesn't increase, authentication is rejected
- Prevents man-in-the-middle attacks

### Challenge Timeouts
- Challenges expire after 10 minutes
- Each challenge can only be used once
- Prevents replay attacks

### Session Management
- JWT tokens contain a unique `jti` (JWT ID)
- Sessions can be revoked server-side
- Sessions tracked by IP address and user agent
- Automatic cleanup of expired sessions

### Best Practices for Deployment

1. **Use HTTPS only** - WebAuthn requires secure context
2. **Set correct RP_ID** - Must match your domain exactly
3. **Rotate JWT_SECRET** - Use strong, randomly generated secrets
4. **Database backups** - Regularly backup credential data
5. **Monitor failed attempts** - Log suspicious authentication activity
6. **Rate limiting** - Implement rate limits on auth endpoints
7. **CORS configuration** - Only allow trusted origins

---

## Deployment Checklist

- [ ] Database schema migrated on PostgreSQL
- [ ] Environment variables configured (especially `JWT_SECRET`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`)
- [ ] HTTPS enabled in production
- [ ] CORS origins configured
- [ ] Email service configured (for future notifications)
- [ ] Rate limiting enabled
- [ ] Logging configured
- [ ] Database backups scheduled
- [ ] Monitoring and alerts set up

---

## Support

For issues or questions:
- Email: support@altuvera.com
- Documentation: https://altuvera.com/docs
