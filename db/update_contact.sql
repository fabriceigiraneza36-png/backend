-- migration to update contact_messages table and add contact_replies
-- Run this if you have an existing database

-- Drop view first as it might depend on the table
DROP VIEW IF EXISTS v_contact_stats CASCADE;

-- Update contact_messages table
ALTER TABLE contact_messages 
ADD COLUMN IF NOT EXISTS trip_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS travel_date DATE,
ADD COLUMN IF NOT EXISTS number_of_travelers INTEGER,
ADD COLUMN IF NOT EXISTS source VARCHAR(100) DEFAULT 'website',
ADD COLUMN IF NOT EXISTS ip_address VARCHAR(50),
ADD COLUMN IF NOT EXISTS user_agent TEXT,
ADD COLUMN IF NOT EXISTS referrer_url TEXT,
ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal',
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'new',
ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS assigned_to INTEGER,
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS responded_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS response_notes TEXT,
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS read_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Create contact_replies table
CREATE TABLE IF NOT EXISTS contact_replies (
  id            SERIAL PRIMARY KEY,
  message_id    INTEGER NOT NULL REFERENCES contact_messages(id) ON DELETE CASCADE,
  subject       VARCHAR(255),
  body          TEXT NOT NULL,
  sent_by       INTEGER, -- admin_user id
  sent_by_name  VARCHAR(255),
  sent_by_email VARCHAR(255),
  status        VARCHAR(50) DEFAULT 'sent',
  sent_at       TIMESTAMP DEFAULT NOW(),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Recreate statistics view
CREATE OR REPLACE VIEW v_contact_stats AS
SELECT
  COUNT(*) AS total_messages,
  COUNT(*) FILTER (WHERE status = 'new') AS new_messages,
  COUNT(*) FILTER (WHERE is_read = false) AS unread_messages,
  COUNT(*) FILTER (WHERE status = 'replied') AS replied_messages,
  COUNT(*) FILTER (WHERE status = 'archived') AS archived_messages,
  COUNT(*) FILTER (WHERE status = 'spam') AS spam_messages,
  COUNT(*) FILTER (WHERE priority = 'urgent') AS urgent_messages,
  COUNT(*) FILTER (WHERE priority = 'high') AS high_priority_messages,
  COUNT(*) FILTER (WHERE is_starred = true) AS starred_messages,
  COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today_messages,
  COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') AS week_messages,
  COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') AS month_messages
FROM contact_messages;
