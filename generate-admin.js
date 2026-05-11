// generate-admin.js
// Run: node generate-admin.js
const bcrypt = require('bcryptjs');

const adminData = {
  email:    'altuverasafari@gmail.com',
  username: 'altuvera_admin',
  password: 'Admin@2024!',
  fullName: 'Altuvera Admin',
  role:     'superadmin',
};

const hash = bcrypt.hashSync(adminData.password, 12);

console.log('\n✅ Admin credentials generated!\n');
console.log('Email:    ', adminData.email);
console.log('Username: ', adminData.username);
console.log('Password: ', adminData.password);
console.log('Hash:     ', hash);

console.log('\n── Run this SQL in Neon console ──────────────────────────────────────\n');
console.log(`
INSERT INTO admin_users (
  email, username, password_hash, full_name, role, 
  is_active, token_version, created_at, updated_at
)
VALUES (
  '${adminData.email}',
  '${adminData.username}',
  '${hash}',
  '${adminData.fullName}',
  '${adminData.role}',
  true,
  0,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  full_name     = EXCLUDED.full_name,
  role          = EXCLUDED.role,
  is_active     = true,
  token_version = 0,
  updated_at    = NOW()
RETURNING id, email, username, role, is_active;
`);