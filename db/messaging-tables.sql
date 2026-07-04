-- ═══════════════════════════════════════════════════════════════════════════════
-- MESSAGING TABLES - User to Admin Communication System
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. CONVERSATIONS TABLE
DROP TABLE IF EXISTS conversations CASCADE;
CREATE TABLE conversations (
  id                SERIAL PRIMARY KEY,
  session_id        VARCHAR(255) UNIQUE NOT NULL,      -- Browser session identifier
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- Logged-in user
  guest_name        VARCHAR(255),                       -- Guest name if not logged in
  guest_email       VARCHAR(255),                       -- Guest email
  
  -- Conversation metadata
  channel           VARCHAR(50)  DEFAULT 'live_chat',   -- live_chat, contact_form, etc.
  subject           VARCHAR(255),                       -- Conversation subject
  status            VARCHAR(20)  DEFAULT 'open',        -- open, closed, archived
  priority          VARCHAR(20)  DEFAULT 'normal',      -- low, normal, high, urgent
  
  -- Assignment
  assigned_admin    INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  
  -- Message tracking
  first_message     TEXT,
  last_message      TEXT,
  last_message_at   TIMESTAMP,
  unread_user       INTEGER DEFAULT 0,
  unread_admin      INTEGER DEFAULT 0,
  
  -- Metadata
  tags              TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata          JSONB DEFAULT '{}',
  source            VARCHAR(100),                       -- website, api, frontend-auth, frontend-guest
  ip_address        VARCHAR(50),
  
  -- Timestamps
  closed_at         TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_conversations_updated
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_conversations_session_id    ON conversations(session_id);
CREATE INDEX idx_conversations_user_id       ON conversations(user_id);
CREATE INDEX idx_conversations_status        ON conversations(status);
CREATE INDEX idx_conversations_unread_admin  ON conversations(unread_admin) WHERE unread_admin > 0;
CREATE INDEX idx_conversations_last_message_at ON conversations(last_message_at DESC NULLS LAST);

-- 2. MESSAGES TABLE
DROP TABLE IF EXISTS messages CASCADE;
CREATE TABLE messages (
  id                SERIAL PRIMARY KEY,
  conversation_id   INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  
  -- Sender information
  sender_type       VARCHAR(20) NOT NULL,               -- 'user' or 'admin'
  sender_id         INTEGER,                            -- References users.id or admin_users.id
  sender_name       VARCHAR(255),
  sender_email      VARCHAR(255),
  sender_avatar     VARCHAR(500),
  
  -- Message content
  body              TEXT NOT NULL,
  msg_type          VARCHAR(50) DEFAULT 'text',         -- text, image, file, system
  attachment_url    VARCHAR(500),
  
  -- Message status
  is_read           BOOLEAN DEFAULT false,
  read_at           TIMESTAMP,
  
  -- Message operations
  edited            BOOLEAN DEFAULT false,
  deleted           BOOLEAN DEFAULT false,
  reply_to_id       INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  
  -- Metadata
  metadata          JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_messages_updated
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_messages_conversation_id    ON messages(conversation_id);
CREATE INDEX idx_messages_sender_type        ON messages(sender_type);
CREATE INDEX idx_messages_is_read            ON messages(is_read) WHERE is_read = false;
CREATE INDEX idx_messages_created_at         ON messages(created_at DESC);
CREATE INDEX idx_messages_deleted            ON messages(deleted) WHERE deleted = false;

-- 3. TYPING INDICATORS TABLE
DROP TABLE IF EXISTS typing_indicators CASCADE;
CREATE TABLE typing_indicators (
  id                SERIAL PRIMARY KEY,
  conversation_id   INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  
  sender_type       VARCHAR(20),                        -- 'user' or 'admin'
  sender_id         INTEGER,
  sender_name       VARCHAR(255),
  socket_id         VARCHAR(255),
  
  expires_at        TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_typing_indicators_conversation_id ON typing_indicators(conversation_id);
CREATE INDEX idx_typing_indicators_expires_at ON typing_indicators(expires_at);

-- 4. CHAT SESSIONS TABLE (for chat widget compatibility)
DROP TABLE IF EXISTS chat_sessions CASCADE;
CREATE TABLE chat_sessions (
  id                SERIAL PRIMARY KEY,
  session_id        VARCHAR(255) UNIQUE NOT NULL,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email             VARCHAR(255),
  full_name         VARCHAR(255),
  source            VARCHAR(100) DEFAULT 'frontend',
  status            VARCHAR(20) DEFAULT 'open',
  
  last_active       TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_chat_sessions_updated
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_chat_sessions_session_id ON chat_sessions(session_id);
CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_last_active ON chat_sessions(last_active DESC NULLS LAST);

-- 5. CHAT MESSAGES TABLE (for chat widget compatibility)
DROP TABLE IF EXISTS chat_messages CASCADE;
CREATE TABLE chat_messages (
  id                SERIAL PRIMARY KEY,
  session_id        VARCHAR(255) NOT NULL,
  
  sender_type       VARCHAR(20) NOT NULL,               -- 'user' or 'admin'
  sender_id         INTEGER,
  sender_name       VARCHAR(255),
  sender_email      VARCHAR(255),
  
  body              TEXT NOT NULL,
  is_read           BOOLEAN DEFAULT false,
  
  metadata          JSONB DEFAULT '{}',
  
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_sender_type ON chat_messages(sender_type);
CREATE INDEX idx_chat_messages_is_read ON chat_messages(is_read) WHERE is_read = false;
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at DESC);
