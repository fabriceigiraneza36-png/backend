-- =============================================
--  TRAVEL APP – FULL DATABASE SCHEMA (NO PRICES)
-- =============================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── Updated-at trigger function ─────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═════════════════════════════════════════════
--  TABLES
-- ═════════════════════════════════════════════

-- 1. Admin Users
DROP TABLE IF EXISTS admin_users CASCADE;
CREATE TABLE admin_users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255),
  role          VARCHAR(50)  DEFAULT 'admin',
  avatar_url    VARCHAR(500),
  is_active     BOOLEAN      DEFAULT true,
  last_login    TIMESTAMP,
  created_at    TIMESTAMP    DEFAULT NOW(),
  updated_at    TIMESTAMP    DEFAULT NOW()
);

CREATE TRIGGER trg_admin_users_updated
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Countries
DROP TABLE IF EXISTS countries CASCADE;
CREATE TABLE countries (
  id                 SERIAL PRIMARY KEY,
  name               VARCHAR(255) NOT NULL,
  slug               VARCHAR(255) UNIQUE NOT NULL,
  description        TEXT,
  short_description  TEXT,
  image_url          VARCHAR(500),
  cover_image_url    VARCHAR(500),
  flag_url           VARCHAR(500),
  continent          VARCHAR(100),
  capital            VARCHAR(255),
  currency           VARCHAR(100),
  language           VARCHAR(255),
  timezone           VARCHAR(100),
  best_time_to_visit VARCHAR(255),
  visa_info          TEXT,
  latitude           DECIMAL(10, 8),
  longitude          DECIMAL(11, 8),
  is_featured        BOOLEAN DEFAULT false,
  is_active          BOOLEAN DEFAULT true,
  destination_count  INTEGER DEFAULT 0,
  created_at         TIMESTAMP DEFAULT NOW(),
  updated_at         TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_countries_updated
  BEFORE UPDATE ON countries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. Destinations (NO PRICES)
DROP TABLE IF EXISTS destinations CASCADE;
CREATE TABLE destinations (
  id                SERIAL PRIMARY KEY,
  country_id        INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  slug              VARCHAR(255) UNIQUE NOT NULL,
  description       TEXT,
  short_description TEXT,
  image_url         VARCHAR(500),
  cover_image_url   VARCHAR(500),
  latitude          DECIMAL(10, 8),
  longitude         DECIMAL(11, 8),
  category          VARCHAR(100),
  rating            DECIMAL(3, 2) DEFAULT 0,
  review_count      INTEGER       DEFAULT 0,
  duration          VARCHAR(100),
  difficulty        VARCHAR(50),
  highlights        TEXT[],
  included          TEXT[],
  not_included      TEXT[],
  best_season       VARCHAR(255),
  is_featured       BOOLEAN DEFAULT false,
  is_active         BOOLEAN DEFAULT true,
  view_count        INTEGER DEFAULT 0,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_destinations_updated
  BEFORE UPDATE ON destinations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4. Destination Images
DROP TABLE IF EXISTS destination_images CASCADE;
CREATE TABLE destination_images (
  id              SERIAL PRIMARY KEY,
  destination_id  INTEGER REFERENCES destinations(id) ON DELETE CASCADE,
  image_url       VARCHAR(500) NOT NULL,
  thumbnail_url   VARCHAR(500),
  caption         VARCHAR(255),
  is_primary      BOOLEAN DEFAULT false,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- 5. Posts (Blog)
DROP TABLE IF EXISTS posts CASCADE;
CREATE TABLE posts (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  slug            VARCHAR(255) UNIQUE NOT NULL,
  content         TEXT,
  excerpt         TEXT,
  image_url       VARCHAR(500),
  cover_image_url VARCHAR(500),
  author_name     VARCHAR(255),
  author_avatar   VARCHAR(500),
  category        VARCHAR(100),
  tags            TEXT[],
  is_published    BOOLEAN   DEFAULT false,
  is_featured     BOOLEAN   DEFAULT false,
  view_count      INTEGER   DEFAULT 0,
  read_time       INTEGER   DEFAULT 0,
  meta_title      VARCHAR(255),
  meta_description TEXT,
  published_at    TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_posts_updated
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 6. Tips
DROP TABLE IF EXISTS tips CASCADE;
CREATE TABLE tips (
  id         SERIAL PRIMARY KEY,
  title      VARCHAR(255) NOT NULL,
  content    TEXT,
  category   VARCHAR(100),
  icon       VARCHAR(100),
  image_url  VARCHAR(500),
  sort_order INTEGER DEFAULT 0,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_tips_updated
  BEFORE UPDATE ON tips
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 7. Services (NO PRICES)
DROP TABLE IF EXISTS services CASCADE;
CREATE TABLE services (
  id                SERIAL PRIMARY KEY,
  title             VARCHAR(255) NOT NULL,
  slug              VARCHAR(255) UNIQUE NOT NULL,
  description       TEXT,
  short_description TEXT,
  icon              VARCHAR(100),
  image_url         VARCHAR(500),
  features          TEXT[],
  is_featured       BOOLEAN DEFAULT false,
  sort_order        INTEGER DEFAULT 0,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_services_updated
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 8. Team Members
DROP TABLE IF EXISTS team_members CASCADE;
CREATE TABLE team_members (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  role         VARCHAR(255),
  bio          TEXT,
  image_url    VARCHAR(500),
  email        VARCHAR(255),
  phone        VARCHAR(50),
  whatsapp     VARCHAR(50),
  social_links JSONB DEFAULT '{}',
  sort_order   INTEGER DEFAULT 0,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_team_members_updated
  BEFORE UPDATE ON team_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 9. Gallery
DROP TABLE IF EXISTS gallery CASCADE;
CREATE TABLE gallery (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(255),
  description     TEXT,
  image_url       VARCHAR(500) NOT NULL,
  thumbnail_url   VARCHAR(500),
  category        VARCHAR(100),
  location        VARCHAR(255),
  country_id      INTEGER REFERENCES countries(id) ON DELETE SET NULL,
  destination_id  INTEGER REFERENCES destinations(id) ON DELETE SET NULL,
  photographer    VARCHAR(255),
  sort_order      INTEGER DEFAULT 0,
  is_featured     BOOLEAN DEFAULT false,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- 10. Bookings (NO PRICES - WhatsApp negotiation)
DROP TABLE IF EXISTS bookings CASCADE;
CREATE TABLE bookings (
  id                   SERIAL PRIMARY KEY,
  booking_number       VARCHAR(50) UNIQUE NOT NULL,
  destination_id       INTEGER REFERENCES destinations(id) ON DELETE SET NULL,
  service_id           INTEGER REFERENCES services(id) ON DELETE SET NULL,
  full_name            VARCHAR(255) NOT NULL,
  email                VARCHAR(255) NOT NULL,
  phone                VARCHAR(50),
  whatsapp             VARCHAR(50),
  nationality          VARCHAR(100),
  travel_date          DATE,
  return_date          DATE,
  number_of_travelers  INTEGER DEFAULT 1,
  accommodation_type   VARCHAR(100),
  special_requests     TEXT,
  status               VARCHAR(50) DEFAULT 'pending',
  admin_notes          TEXT,
  created_at           TIMESTAMP DEFAULT NOW(),
  updated_at           TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_bookings_updated
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 11. FAQs
DROP TABLE IF EXISTS faqs CASCADE;
CREATE TABLE faqs (
  id         SERIAL PRIMARY KEY,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  category   VARCHAR(100),
  sort_order INTEGER DEFAULT 0,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_faqs_updated
  BEFORE UPDATE ON faqs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 12. Contact Messages
DROP TABLE IF EXISTS contact_messages CASCADE;
CREATE TABLE contact_messages (
  id         SERIAL PRIMARY KEY,
  full_name  VARCHAR(255) NOT NULL,
  email      VARCHAR(255) NOT NULL,
  phone      VARCHAR(50),
  whatsapp   VARCHAR(50),
  subject    VARCHAR(255),
  message    TEXT NOT NULL,
  is_read    BOOLEAN   DEFAULT false,
  replied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 13. Pages
DROP TABLE IF EXISTS pages CASCADE;
CREATE TABLE pages (
  id               SERIAL PRIMARY KEY,
  title            VARCHAR(255) NOT NULL,
  slug             VARCHAR(255) UNIQUE NOT NULL,
  content          TEXT,
  meta_title       VARCHAR(255),
  meta_description TEXT,
  is_published     BOOLEAN   DEFAULT true,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_pages_updated
  BEFORE UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 14. Virtual Tours
DROP TABLE IF EXISTS virtual_tours CASCADE;
CREATE TABLE virtual_tours (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  slug            VARCHAR(255) UNIQUE NOT NULL,
  description     TEXT,
  destination_id  INTEGER REFERENCES destinations(id) ON DELETE SET NULL,
  video_url       VARCHAR(500),
  thumbnail_url   VARCHAR(500),
  panorama_url    VARCHAR(500),
  duration        VARCHAR(50),
  view_count      INTEGER DEFAULT 0,
  is_featured     BOOLEAN DEFAULT false,
  is_active       BOOLEAN DEFAULT true,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_virtual_tours_updated
  BEFORE UPDATE ON virtual_tours
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 15. Subscribers
DROP TABLE IF EXISTS subscribers CASCADE;
CREATE TABLE subscribers (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) UNIQUE NOT NULL,
  is_active       BOOLEAN   DEFAULT true,
  subscribed_at   TIMESTAMP DEFAULT NOW(),
  unsubscribed_at TIMESTAMP
);

-- 16. Site Settings (for WhatsApp number, etc.)
DROP TABLE IF EXISTS site_settings CASCADE;
CREATE TABLE site_settings (
  id         SERIAL PRIMARY KEY,
  key        VARCHAR(100) UNIQUE NOT NULL,
  value      TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═════════════════════════════════════════════
--  INDEXES
-- ═════════════════════════════════════════════

CREATE INDEX idx_countries_slug        ON countries(slug);
CREATE INDEX idx_countries_continent   ON countries(continent);
CREATE INDEX idx_countries_featured    ON countries(is_featured) WHERE is_featured = true;

CREATE INDEX idx_destinations_slug     ON destinations(slug);
CREATE INDEX idx_destinations_country  ON destinations(country_id);
CREATE INDEX idx_destinations_category ON destinations(category);
CREATE INDEX idx_destinations_featured ON destinations(is_featured) WHERE is_featured = true;
CREATE INDEX idx_destinations_coords   ON destinations(latitude, longitude);

CREATE INDEX idx_posts_slug            ON posts(slug);
CREATE INDEX idx_posts_published       ON posts(is_published, published_at DESC);
CREATE INDEX idx_posts_category        ON posts(category);

CREATE INDEX idx_bookings_number       ON bookings(booking_number);
CREATE INDEX idx_bookings_status       ON bookings(status);
CREATE INDEX idx_bookings_email        ON bookings(email);

CREATE INDEX idx_gallery_category      ON gallery(category);
CREATE INDEX idx_faqs_category         ON faqs(category);
CREATE INDEX idx_contact_read          ON contact_messages(is_read);
CREATE INDEX idx_virtual_tours_slug    ON virtual_tours(slug);


-- ═══════════════════════════════════════════════════════════════════════════════
-- USERS TABLE (Public users, separate from admin_users)
-- ═══════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS users CASCADE;
CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255),
  full_name       VARCHAR(255),
  avatar_url      VARCHAR(500),
  phone           VARCHAR(50),
  nationality     VARCHAR(100),
  
  -- OAuth providers
  google_id       VARCHAR(255) UNIQUE,
  github_id       VARCHAR(255) UNIQUE,
  auth_provider   VARCHAR(50) DEFAULT 'email',
  
  -- Account status
  is_verified     BOOLEAN DEFAULT false,
  is_active       BOOLEAN DEFAULT true,
  verification_token VARCHAR(255),
  reset_token     VARCHAR(255),
  reset_token_expires TIMESTAMP,
  
  -- Preferences
  preferences     JSONB DEFAULT '{}',
  
  -- Timestamps
  last_login      TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_google ON users(google_id) WHERE google_id IS NOT NULL;
CREATE INDEX idx_users_github ON users(github_id) WHERE github_id IS NOT NULL;

-- User sessions f


or tracking
DROP TABLE IF EXISTS user_sessions CASCADE;
CREATE TABLE user_sessions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token_hash    VARCHAR(255) NOT NULL,
  device_info   VARCHAR(500),
  ip_address    VARCHAR(50),
  expires_at    TIMESTAMP NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(token_hash);



-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(50) NOT NULL,
    avatar VARCHAR(255) DEFAULT '',
    phone VARCHAR(20) DEFAULT '',
    bio TEXT DEFAULT '',
    role VARCHAR(10) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    is_verified BOOLEAN DEFAULT FALSE,
    verification_code VARCHAR(6),
    code_expiry TIMESTAMP,
    code_attempts INTEGER DEFAULT 0,
    last_code_sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for users table
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
