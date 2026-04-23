-- ═══════════════════════════════════════════════════════════════════════════════
-- WEBAUTHN AUTHENTICATION SCHEMA FOR ALTUVERA
-- ═══════════════════════════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════════════════════
-- USERS TABLE - WebAuthn-based users (no passwords)
-- ═══════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS webauthn_credentials CASCADE;
DROP TABLE IF EXISTS webauthn_users CASCADE;

CREATE TABLE webauthn_users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 VARCHAR(255) UNIQUE,
  full_name             VARCHAR(255) NOT NULL,
  avatar_url            VARCHAR(500),
  phone                 VARCHAR(20),
  nationality           VARCHAR(100),
  webauthn_user_id      BYTEA UNIQUE NOT NULL,
  is_verified           BOOLEAN DEFAULT false,
  is_active             BOOLEAN DEFAULT true,
  preferences           JSONB DEFAULT '{}',
  last_login            TIMESTAMP,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW(),
  
  -- Indexes for performance
  CONSTRAINT email_not_empty CHECK (email IS NULL OR email != ''),
  CONSTRAINT phone_not_empty CHECK (phone IS NULL OR phone != '')
);

CREATE INDEX idx_webauthn_users_email ON webauthn_users(email);
CREATE INDEX idx_webauthn_users_webauthn_user_id ON webauthn_users(webauthn_user_id);
CREATE INDEX idx_webauthn_users_created_at ON webauthn_users(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CREDENTIALS TABLE - WebAuthn credentials/passkeys
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE webauthn_credentials (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES webauthn_users(id) ON DELETE CASCADE,
  credential_id         BYTEA UNIQUE NOT NULL,
  public_key            BYTEA NOT NULL,
  counter               BIGINT NOT NULL DEFAULT 0,
  transports            TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT valid_counter CHECK (counter >= 0)
);

CREATE INDEX idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);
CREATE INDEX idx_webauthn_credentials_credential_id ON webauthn_credentials(credential_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CHALLENGES TABLE - Temporary storage for registration/authentication challenges
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE webauthn_challenges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge             BYTEA NOT NULL,
  challenge_type        VARCHAR(20) NOT NULL, -- 'registration' or 'authentication'
  user_id               UUID REFERENCES webauthn_users(id) ON DELETE CASCADE,
  email                 VARCHAR(255), -- For registration flow
  created_at            TIMESTAMP DEFAULT NOW(),
  expires_at            TIMESTAMP NOT NULL,
  
  CONSTRAINT valid_challenge_type CHECK (challenge_type IN ('registration', 'authentication'))
);

CREATE INDEX idx_webauthn_challenges_expires_at ON webauthn_challenges(expires_at);
CREATE INDEX idx_webauthn_challenges_user_id ON webauthn_challenges(user_id);
CREATE INDEX idx_webauthn_challenges_email ON webauthn_challenges(email);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SESSIONS TABLE - JWT token sessions
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE webauthn_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES webauthn_users(id) ON DELETE CASCADE,
  token_jti             VARCHAR(500) UNIQUE NOT NULL, -- JWT ID (jti claim)
  ip_address            VARCHAR(45),
  user_agent            TEXT,
  revoked               BOOLEAN DEFAULT false,
  created_at            TIMESTAMP DEFAULT NOW(),
  expires_at            TIMESTAMP NOT NULL
);

CREATE INDEX idx_webauthn_sessions_user_id ON webauthn_sessions(user_id);
CREATE INDEX idx_webauthn_sessions_token_jti ON webauthn_sessions(token_jti);
CREATE INDEX idx_webauthn_sessions_expires_at ON webauthn_sessions(expires_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TRIGGERS FOR AUTO-UPDATED TIMESTAMPS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_webauthn_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_webauthn_users_updated
  BEFORE UPDATE ON webauthn_users
  FOR EACH ROW EXECUTE FUNCTION update_webauthn_users_updated_at();

CREATE OR REPLACE FUNCTION update_webauthn_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_webauthn_credentials_updated
  BEFORE UPDATE ON webauthn_credentials
  FOR EACH ROW EXECUTE FUNCTION update_webauthn_credentials_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- CLEANUP: Automatically delete expired challenges (run via cron job)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cleanup_expired_challenges()
RETURNS void AS $$
BEGIN
  DELETE FROM webauthn_challenges WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
