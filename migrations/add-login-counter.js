-- =============================================
-- Third Login Verification — Add login_counter
-- =============================================
-- This migration adds server-side login counter tracking
-- to support the "re-verify on 3rd login" feature.
-- =============================================

-- 1. Add login_counter column to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_counter INTEGER DEFAULT 0;

-- 2. Add index for potential queries (optional, small table)
CREATE INDEX IF NOT EXISTS idx_users_login_counter
  ON users(login_counter);

-- 3. Ensure the column is included in the user schema check (db.js)
-- ( Handled by ensureUserSchema — but we add it here for clarity )

COMMENT ON COLUMN users.login_counter IS
  'Cumulative successful login count since last re-verification. Resets to 0 after 3rd-login verification.';
