# ALTUVERA WEBAUTHN - QUICK REFERENCE GUIDE

## 🚀 30-Second Setup

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example.webauthn .env

# 3. Database
node scripts/setup-webauthn-db.js

# 4. Start
npm start
```

Visit: http://localhost:5000/health

---

## 📌 Essential Environment Variables

```env
WEBAUTHN_RP_ID=localhost              # Dev: localhost, Prod: your-domain.com
WEBAUTHN_ORIGIN=http://localhost:3000 # Dev: http://localhost:3000, Prod: https://your-domain.com
JWT_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"()
DATABASE_URL=postgresql://user:pass@localhost/altuvera
```

---

## 🔌 API Quick Start

### 1. Register
```bash
# Get options
curl -X POST http://localhost:5000/auth/webauthn/register-options \
  -H "Content-Type: application/json" \
  -d '{"email":"test@altuvera.com","name":"Test"}'

# Verify (after browser creates credential)
curl -X POST http://localhost:5000/auth/webauthn/register-verify \
  -H "Content-Type: application/json" \
  -d '{
    "email":"test@altuvera.com",
    "name":"Test",
    "webauthnUserIdB64":"...",
    "response":{...}
  }'
```

### 2. Login
```bash
# Get options
curl -X POST http://localhost:5000/auth/webauthn/login-options \
  -H "Content-Type: application/json" \
  -d '{"email":"test@altuvera.com"}'

# Verify (after browser authenticates)
curl -X POST http://localhost:5000/auth/webauthn/login-verify \
  -H "Content-Type: application/json" \
  -d '{"email":"test@altuvera.com","response":{...}}'
```

### 3. Protected Routes
```bash
# Get profile
curl http://localhost:5000/auth/webauthn/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Update profile
curl -X PATCH http://localhost:5000/auth/webauthn/profile \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+254712345678"}'

# Logout
curl -X POST http://localhost:5000/auth/webauthn/logout \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 💻 Client Implementation

### Vanilla JavaScript
```javascript
import { WebAuthnClient } from './client/webauthn-client.js';

const client = new WebAuthnClient('https://api.altuvera.com');

// Register
const reg = await client.register('user@example.com', 'John Doe');
console.log('User:', reg.user);
console.log('Token:', reg.token);

// Login
const login = await client.login('user@example.com');
localStorage.setItem('token', login.token);

// Get Profile
const profile = await client.getProfile();

// Logout
await client.logout();
```

### React
```javascript
import { useWebAuthn } from './client/webauthn-client.js';

export function AuthForm() {
  const { register, login, logout, user, loading, error } = useWebAuthn();
  const [email, setEmail] = useState('');

  return (
    <div>
      <input 
        type="email" 
        value={email} 
        onChange={(e) => setEmail(e.target.value)} 
      />
      <button onClick={() => register(email, email)}>Register</button>
      <button onClick={() => login(email)}>Login</button>
      <button onClick={() => logout()}>Logout</button>
      {user && <p>Logged in as: {user.full_name}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

---

## 📁 File Structure

```
controllers/webauthnController.js     ← Core logic
routes/webauthn.js                    ← API endpoints
middleware/auth.js                    ← JWT verification
db/migrations/webauthn-schema.sql     ← Database tables
client/webauthn-client.js             ← Browser library
scripts/setup-webauthn-db.js          ← Database setup
```

---

## 🗄️ Database Tables

```sql
webauthn_users        -- User accounts (no passwords!)
webauthn_credentials  -- Registered passkeys
webauthn_challenges   -- Registration/login challenges
webauthn_sessions     -- JWT session tracking
```

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Specific test
npm test -- webauthn.test.js

# Health check
curl http://localhost:5000/health
```

---

## 🌍 Deployment Commands

### Heroku
```bash
heroku create altuvera-backend
heroku addons:create heroku-postgresql:standard-0
heroku config:set JWT_SECRET=...
heroku config:set WEBAUTHN_RP_ID=your-domain.com
git push heroku main
heroku run node scripts/setup-webauthn-db.js
heroku logs --tail
```

### Render
```bash
# 1. Connect GitHub
# 2. Environment: Node.js
# 3. Build: npm install && node scripts/setup-webauthn-db.js
# 4. Start: npm start
```

### Docker
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV NODE_ENV=production
EXPOSE 5000
CMD ["npm", "start"]
```

---

## 🔐 Security Essentials

- ✅ Use HTTPS in production
- ✅ Generate strong JWT_SECRET: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- ✅ Match WEBAUTHN_RP_ID to your domain
- ✅ Enable rate limiting
- ✅ Setup database backups
- ✅ Monitor failed auth attempts

---

## 🐛 Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| "RP_ID doesn't match" | Set WEBAUTHN_RP_ID to your domain (no http/https) |
| Token fails to verify | Check JWT_SECRET is consistent |
| Database connection fails | Verify DATABASE_URL |
| Challenge expired | Flow takes >10 min - try again |
| Browser shows unsupported | Need Chrome 67+, Firefox 60+, Safari 13+ |

---

## 📊 API Endpoints Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| /register-options | POST | ❌ | Get registration challenge |
| /register-verify | POST | ❌ | Verify registration & create user |
| /login-options | POST | ❌ | Get authentication challenge |
| /login-verify | POST | ❌ | Verify authentication & issue token |
| /me | GET | ✅ | Get current user profile |
| /profile | PATCH | ✅ | Update profile |
| /logout | POST | ✅ | Revoke session |
| /credential/:id | DELETE | ✅ | Delete passkey |

---

## 🎓 Key Concepts

**WebAuthn** = Passwordless authentication using:
- Biometrics (fingerprint, face)
- Security keys (YubiKey, etc.)
- Device unlock (Windows Hello, Touch ID)

**RP (Relying Party)** = Your website/app
- RP ID = your domain
- RP Name = display name to user

**Credential Counter** = Clone detection
- Increments on each authentication
- If doesn't increase = credential cloned

**JWT Token** = Session identifier
- Contains user ID & email
- Verified via JWT_SECRET
- Revocable via sessions table

---

## 📚 Full Documentation

- **API Docs**: [WEBAUTHN_API.md](./WEBAUTHN_API.md)
- **Setup Guide**: [WEBAUTHN_SETUP.md](./WEBAUTHN_SETUP.md)
- **Main README**: [WEBAUTHN_README.md](./WEBAUTHN_README.md)
- **Implementation**: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)

---

## 💡 Pro Tips

1. **Save session data**: Store JWT token in localStorage for authenticated requests
2. **Handle errors**: Users may not have registered credentials yet
3. **Multi-factor**: Combine with email verification for extra security
4. **Backup codes**: Generate one-time backup codes for account recovery
5. **Analytics**: Track which authenticators users prefer
6. **Support**: Have support staff help recover access if needed

---

## 🎯 Production Checklist

- [ ] HTTPS enabled with valid certificate
- [ ] WEBAUTHN_RP_ID matches your domain
- [ ] WEBAUTHN_ORIGIN matches frontend URL
- [ ] JWT_SECRET is strong (32+ random characters)
- [ ] Database backups configured
- [ ] Rate limiting enabled
- [ ] CORS origins whitelisted
- [ ] Error tracking setup (Sentry)
- [ ] Logging configured
- [ ] Monitoring alerts setup
- [ ] Load testing completed
- [ ] Security audit performed

---

**Quick Links**
- GitHub: https://github.com/altuvera/backend
- Docs: https://altuvera.com/docs
- Support: support@altuvera.com

---

**Version**: 1.0.0  
**Last Updated**: April 23, 2024
