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
-- 2. Countries
DROP TABLE IF EXISTS countries CASCADE;
CREATE TABLE countries (
  id                 SERIAL PRIMARY KEY,
  slug               VARCHAR(255) UNIQUE NOT NULL,
  name               VARCHAR(255) NOT NULL,
  official_name      VARCHAR(255),
  capital            VARCHAR(255),
  flag               VARCHAR(10),
  flag_url           VARCHAR(500),
  tagline            TEXT,
  motto              TEXT,
  demonym            VARCHAR(100),
  independence_date  DATE,
  government_type    VARCHAR(100),
  head_of_state      VARCHAR(255),
  continent          VARCHAR(100),
  region             VARCHAR(100),
  sub_region         VARCHAR(100),
  description        TEXT,
  full_description   TEXT,
  additional_info    TEXT,
  population         BIGINT,
  area               DECIMAL(12, 2),
  population_density DECIMAL(8, 2),
  urban_population   DECIMAL(5, 2),
  life_expectancy    DECIMAL(4, 1),
  median_age         DECIMAL(4, 1),
  literacy_rate      DECIMAL(5, 2),
  languages          TEXT[],
  official_languages TEXT[],
  national_languages TEXT[],
  ethnic_groups      TEXT[],
  religions          TEXT[],
  currency           VARCHAR(100),
  currency_symbol    VARCHAR(10),
  timezone           VARCHAR(100),
  calling_code       VARCHAR(10),
  internet_tld       VARCHAR(10),
  driving_side       VARCHAR(20),
  electrical_plug    VARCHAR(50),
  voltage            VARCHAR(20),
  water_safety       VARCHAR(50),
  climate            TEXT,
  best_time_to_visit VARCHAR(255),
  seasons            JSONB DEFAULT '{}'::jsonb,
  visa_info          TEXT,
  health_info        TEXT,
  highlights         TEXT[],
  experiences        TEXT[],
  travel_tips        TEXT[],
  neighboring_countries TEXT[],
  wildlife           JSONB DEFAULT '{}'::jsonb,
  cuisine            JSONB DEFAULT '{}'::jsonb,
  economic_info      JSONB DEFAULT '{}'::jsonb,
  geography          JSONB DEFAULT '{}'::jsonb,
  image_url          VARCHAR(500),
  cover_image_url    VARCHAR(500),
  hero_image         VARCHAR(500),
  images             TEXT[],
  latitude           DECIMAL(10, 8),
  longitude          DECIMAL(11, 8),
  is_featured        BOOLEAN DEFAULT false,
  is_active          BOOLEAN DEFAULT true,
  display_order      INTEGER DEFAULT 0,
  destination_count  INTEGER DEFAULT 0,
  view_count         INTEGER DEFAULT 0,
  created_at         TIMESTAMP DEFAULT NOW(),
  updated_at         TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_countries_updated
  BEFORE UPDATE ON countries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Country Airports
DROP TABLE IF EXISTS country_airports CASCADE;
CREATE TABLE country_airports (
  id              SERIAL PRIMARY KEY,
  country_id      INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  code            VARCHAR(10),
  location        VARCHAR(255),
  airport_type    VARCHAR(50) DEFAULT 'international',
  description     TEXT,
  is_main_international BOOLEAN DEFAULT false,
  display_order   INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Country Festivals
DROP TABLE IF EXISTS country_festivals CASCADE;
CREATE TABLE country_festivals (
  id              SERIAL PRIMARY KEY,
  country_id      INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  period          VARCHAR(100),
  month           VARCHAR(50),
  description     TEXT,
  is_major_event  BOOLEAN DEFAULT false,
  image_url       VARCHAR(500),
  display_order   INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Country UNESCO Sites
DROP TABLE IF EXISTS country_unesco_sites CASCADE;
CREATE TABLE country_unesco_sites (
  id              SERIAL PRIMARY KEY,
  country_id      INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  year_inscribed  INTEGER,
  site_type       VARCHAR(100),
  description     TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Country Historical Events
DROP TABLE IF EXISTS country_historical_events CASCADE;
CREATE TABLE country_historical_events (
  id              SERIAL PRIMARY KEY,
  country_id      INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  year            INTEGER NOT NULL,
  event           TEXT NOT NULL,
  event_type      VARCHAR(50) DEFAULT 'historical',
  is_major        BOOLEAN DEFAULT false,
  sort_year       INTEGER NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- 3. Destinations (NO PRICES)
DROP TABLE IF EXISTS destinations CASCADE;
-- 3. Destinations (NO PRICES)
DROP TABLE IF EXISTS destinations CASCADE;
CREATE TABLE destinations (
  id                      SERIAL PRIMARY KEY,
  country_id              INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name                    VARCHAR(255) NOT NULL,
  slug                    VARCHAR(255) UNIQUE NOT NULL,
  tagline                 TEXT,
  short_description       TEXT,
  description             TEXT,
  overview                TEXT,
  highlights              TEXT[],
  activities              TEXT[],
  wildlife                TEXT[],
  best_time_to_visit      VARCHAR(255),
  getting_there           TEXT,
  what_to_expect          TEXT,
  local_tips              TEXT,
  safety_info             TEXT,
  category                VARCHAR(100),
  difficulty              VARCHAR(50),
  destination_type        VARCHAR(50),
  region                  VARCHAR(100),
  nearest_city            VARCHAR(255),
  nearest_airport         VARCHAR(255),
  distance_from_airport_km DECIMAL(8, 2),
  address                 TEXT,
  latitude                DECIMAL(10, 8),
  longitude               DECIMAL(11, 8),
  altitude_meters         INTEGER,
  image_url               VARCHAR(500),
  image_urls              TEXT[] DEFAULT ARRAY[]::TEXT[],
  cover_image_url         VARCHAR(500),
  hero_image              VARCHAR(500),
  thumbnail_url           VARCHAR(500),
  video_url               VARCHAR(500),
  virtual_tour_url        VARCHAR(500),
  duration_days           INTEGER,
  duration_nights         INTEGER,
  duration_display        VARCHAR(100),
  min_group_size          INTEGER DEFAULT 1,
  max_group_size          INTEGER,
  min_age                 INTEGER,
  fitness_level           VARCHAR(50),
  rating                  DECIMAL(3, 2) DEFAULT 0,
  review_count            INTEGER DEFAULT 0,
  view_count              INTEGER DEFAULT 0,
  booking_count           INTEGER DEFAULT 0,
  wishlist_count          INTEGER DEFAULT 0,
  entrance_fee            VARCHAR(100),
  operating_hours         TEXT,
  is_sold_out             BOOLEAN DEFAULT false,
  status                  VARCHAR(50) DEFAULT 'draft',
  is_featured             BOOLEAN DEFAULT false,
  is_popular              BOOLEAN DEFAULT false,
  is_new                  BOOLEAN DEFAULT false,
  is_eco_friendly         BOOLEAN DEFAULT false,
  is_family_friendly      BOOLEAN DEFAULT false,
  meta_title              VARCHAR(255),
  meta_description        TEXT,
  published_at            TIMESTAMP,
  is_active               BOOLEAN DEFAULT true,
  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW()
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

-- Destination Itineraries
DROP TABLE IF EXISTS destination_itineraries CASCADE;
CREATE TABLE destination_itineraries (
  id              SERIAL PRIMARY KEY,
  destination_id  INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  day_number      INTEGER NOT NULL,
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  activities      TEXT[],
  meals           TEXT[],
  accommodation   VARCHAR(255),
  image_url       VARCHAR(500),
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Destination FAQs
DROP TABLE IF EXISTS destination_faqs CASCADE;
CREATE TABLE destination_faqs (
  id              SERIAL PRIMARY KEY,
  destination_id  INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  category        VARCHAR(100),
  sort_order      INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Destination Reviews
DROP TABLE IF EXISTS destination_reviews CASCADE;
CREATE TABLE destination_reviews (
  id              SERIAL PRIMARY KEY,
  destination_id  INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  reviewer_name   VARCHAR(255) NOT NULL,
  reviewer_country VARCHAR(100),
  reviewer_avatar VARCHAR(500),
  title           VARCHAR(255),
  content         TEXT NOT NULL,
  overall_rating  DECIMAL(3, 2) NOT NULL,
  trip_date       DATE,
  trip_type       VARCHAR(50),
  images          TEXT[],
  is_verified     BOOLEAN DEFAULT false,
  is_featured     BOOLEAN DEFAULT false,
  helpful_count   INTEGER DEFAULT 0,
  status          VARCHAR(20) DEFAULT 'pending',
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Destination Tags
DROP TABLE IF EXISTS destination_tags CASCADE;
CREATE TABLE destination_tags (
  id              SERIAL PRIMARY KEY,
  destination_id  INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  tag_name        VARCHAR(100) NOT NULL,
  tag_slug        VARCHAR(100) NOT NULL,
  tag_category    VARCHAR(50),
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
  id                SERIAL PRIMARY KEY,
  slug              VARCHAR(255) UNIQUE NOT NULL,
  summary           TEXT NOT NULL,
  body              TEXT,
  category          VARCHAR(100),
  trip_phase        VARCHAR(80),
  audience          VARCHAR(80) DEFAULT 'all-travelers',
  difficulty_level  VARCHAR(40) DEFAULT 'all-levels',
  priority_level    SMALLINT DEFAULT 3 CHECK (priority_level BETWEEN 1 AND 5),
  read_time_minutes SMALLINT DEFAULT 3 CHECK (read_time_minutes > 0),
  checklist         TEXT[] DEFAULT ARRAY[]::TEXT[],
  tags              TEXT[] DEFAULT ARRAY[]::TEXT[],
  icon              VARCHAR(100),
  image_url         VARCHAR(500),
  source_url        VARCHAR(500),
  cta_text          VARCHAR(255),
  cta_url           VARCHAR(500),
  sort_order        INTEGER DEFAULT 0,
  is_featured       BOOLEAN DEFAULT false,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_tips_updated
  BEFORE UPDATE ON tips
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_tips_slug ON tips(slug);
CREATE INDEX idx_tips_category ON tips(category);
CREATE INDEX idx_tips_trip_phase ON tips(trip_phase);
CREATE INDEX idx_tips_featured ON tips(is_featured) WHERE is_featured = true;

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
  id               SERIAL PRIMARY KEY,
  name             VARCHAR(255) NOT NULL,
  slug             VARCHAR(255) UNIQUE,
  role             VARCHAR(255),
  department       VARCHAR(100),
  bio              TEXT,
  image_url        VARCHAR(500),
  image_public_id  VARCHAR(255),
  email            VARCHAR(255) UNIQUE,
  phone            VARCHAR(50),
  whatsapp         VARCHAR(50),
  linkedin_url     VARCHAR(255),
  twitter_url      VARCHAR(255),
  instagram_url    VARCHAR(255),
  website_url      VARCHAR(255),
  expertise        JSONB DEFAULT '[]'::JSONB,
  languages        JSONB DEFAULT '[]'::JSONB,
  certifications   JSONB DEFAULT '[]'::JSONB,
  years_experience INTEGER DEFAULT 0,
  location         VARCHAR(200),
  country          VARCHAR(100),
  display_order    INTEGER DEFAULT 0,
  is_featured      BOOLEAN DEFAULT false,
  show_on_homepage BOOLEAN DEFAULT false,
  is_active        BOOLEAN DEFAULT true,
  meta_title       VARCHAR(255),
  meta_description VARCHAR(500),
  joined_date      DATE,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
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
  id                  SERIAL PRIMARY KEY,
  full_name           VARCHAR(255) NOT NULL,
  email               VARCHAR(255) NOT NULL,
  phone               VARCHAR(50),
  whatsapp            VARCHAR(50),
  subject             VARCHAR(255),
  message             TEXT NOT NULL,
  
  -- Trip details
  trip_type           VARCHAR(100),
  travel_date         DATE,
  number_of_travelers INTEGER,
  
  -- Metadata
  source              VARCHAR(100) DEFAULT 'website',
  ip_address          VARCHAR(50),
  user_agent          TEXT,
  referrer_url        TEXT,
  
  -- Status & Categorization
  status              VARCHAR(20)  DEFAULT 'new', -- new, read, replied, archived, spam
  is_read             BOOLEAN      DEFAULT false,
  is_starred          BOOLEAN      DEFAULT false,
  priority            VARCHAR(20)  DEFAULT 'normal', -- low, normal, high, urgent
  
  -- Assignment & Response
  assigned_to         INTEGER, -- References admin_users(id)
  assigned_at         TIMESTAMP,
  responded_at        TIMESTAMP,
  response_notes      TEXT,
  
  -- Tags (PostgreSQL array type)
  tags                TEXT[]       DEFAULT ARRAY[]::TEXT[],
  
  -- Timestamps
  read_at             TIMESTAMP,
  archived_at         TIMESTAMP,
  created_at          TIMESTAMP    DEFAULT NOW(),
  updated_at          TIMESTAMP    DEFAULT NOW()
);

CREATE TRIGGER trg_contact_messages_updated
  BEFORE UPDATE ON contact_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 12b. Contact Message Replies
DROP TABLE IF EXISTS contact_replies CASCADE;
CREATE TABLE contact_replies (
  id            SERIAL PRIMARY KEY,
  message_id    INTEGER NOT NULL REFERENCES contact_messages(id) ON DELETE CASCADE,
  subject       VARCHAR(255),
  body          TEXT NOT NULL,
  sent_by       INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  sent_by_name  VARCHAR(255),
  sent_by_email VARCHAR(255),
  status        VARCHAR(50) DEFAULT 'sent',
  sent_at       TIMESTAMP DEFAULT NOW(),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- 12c. Contact Statistics View
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
CREATE INDEX idx_destinations_highlights_gin ON destinations USING GIN (highlights);
CREATE INDEX idx_destinations_image_urls_gin ON destinations USING GIN (image_urls);

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

-- User sessions for tracking
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


-- ═══════════════════════════════════════════════════════════════════════════════
-- TEAM MEMBERS TABLE
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(100) NOT NULL,
    role VARCHAR(100) NOT NULL,
    department VARCHAR(50),
    bio TEXT,
    
    -- Contact Information
    email VARCHAR(150) UNIQUE,
    phone VARCHAR(30),
    
    -- Media
    image_url TEXT,
    image_public_id VARCHAR(255),
    
    -- Social Links
    linkedin_url VARCHAR(255),
    twitter_url VARCHAR(255),
    instagram_url VARCHAR(255),
    website_url VARCHAR(255),
    
    -- Professional Details
    expertise TEXT[], -- Array of skills/expertise
    languages TEXT[], -- Array of languages spoken
    certifications TEXT[], -- Array of certifications
    years_experience INTEGER DEFAULT 0,
    
    -- Location
    location VARCHAR(100),
    country VARCHAR(50),
    
    -- Display Settings
    display_order INTEGER DEFAULT 0,
    is_featured BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    show_on_homepage BOOLEAN DEFAULT FALSE,
    
    -- SEO & Meta
    slug VARCHAR(120) UNIQUE,
    meta_title VARCHAR(160),
    meta_description VARCHAR(320),
    
    -- Timestamps
    joined_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT chk_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_team_members_department ON team_members(department);
CREATE INDEX IF NOT EXISTS idx_team_members_is_active ON team_members(is_active);
CREATE INDEX IF NOT EXISTS idx_team_members_is_featured ON team_members(is_featured);
CREATE INDEX IF NOT EXISTS idx_team_members_display_order ON team_members(display_order);
CREATE INDEX IF NOT EXISTS idx_team_members_slug ON team_members(slug);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_team_members_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_team_members_updated_at ON team_members;
CREATE TRIGGER trigger_team_members_updated_at
    BEFORE UPDATE ON team_members
    FOR EACH ROW
    EXECUTE FUNCTION update_team_members_updated_at();

-- Insert default team members
INSERT INTO team_members (name, role, department, bio, email, image_url, expertise, location, country, is_featured, is_active, display_order, slug)
VALUES 
(
    'IGIRANEZA Fabrice',
    'Founder & CEO',
    'Leadership',
    'Visionary entrepreneur leading Altuvera''s mission to deliver transformative travel experiences across East Africa through the "True Adventures In High Places & Deep Culture" philosophy.',
    'fabrice@altuvera.com',
    'https://randomuser.me/api/portraits/men/32.jpg',
    to_jsonb(ARRAY['Strategic Planning', 'Tourism Innovation', 'Partnership Development', 'Business Leadership']),
    'Kigali',
    'Rwanda',
    TRUE,
    TRUE,
    1,
    'igiraneza-fabrice'
),
(
    'UWIMANA Grace',
    'Head of Operations',
    'Operations',
    'Ensures seamless coordination of every itinerary with precision, local expertise, and meticulous attention to detail across all operational touchpoints.',
    'grace@altuvera.com',
    'https://randomuser.me/api/portraits/women/44.jpg',
    to_jsonb(ARRAY['Logistics Management', 'Quality Assurance', 'Team Coordination', 'Process Optimization']),
    'Nairobi',
    'Kenya',
    FALSE,
    TRUE,
    2,
    'uwimana-grace'
),
(
    'MUTABAZI Jean',
    'Lead Safari Guide',
    'Guides',
    'Expert wildlife guide combining extensive field knowledge with exceptional safety standards for unforgettable safari expeditions.',
    'jean@altuvera.com',
    'https://randomuser.me/api/portraits/men/67.jpg',
    to_jsonb(ARRAY['Wildlife Tracking', 'Bird Identification', 'Conservation Education', 'First Aid']),
    'Serengeti',
    'Tanzania',
    TRUE,
    TRUE,
    3,
    'mutabazi-jean'
),
(
    'INGABIRE Diane',
    'Customer Experience Manager',
    'Customer Service',
    'Designs guest-first service experiences from initial inquiry through post-trip follow-up and comprehensive feedback collection.',
    'diane@altuvera.com',
    'https://randomuser.me/api/portraits/women/28.jpg',
    to_jsonb(ARRAY['Client Relations', 'Service Design', 'Feedback Analysis', 'Communication']),
    'Kampala',
    'Uganda',
    FALSE,
    TRUE,
    4,
    'ingabire-diane'
),
(
    'HABIMANA Patrick',
    'Conservation Liaison',
    'Conservation',
    'Manages partnerships with wildlife conservancies and oversees community development initiatives across the East African region.',
    'patrick@altuvera.com',
    'https://randomuser.me/api/portraits/men/52.jpg',
    to_jsonb(ARRAY['Conservation Strategy', 'Community Engagement', 'Sustainability', 'Partnership Management']),
    'Bwindi',
    'Uganda',
    FALSE,
    TRUE,
    5,
    'habimana-patrick'
),
(
    'MUKAMANA Claudine',
    'Marketing Director',
    'Marketing',
    'Leads brand strategy and digital marketing initiatives to connect global travelers with authentic African experiences.',
    'claudine@altuvera.com',
    'https://randomuser.me/api/portraits/women/65.jpg',
    to_jsonb(ARRAY['Digital Marketing', 'Brand Strategy', 'Content Creation', 'Social Media']),
    'Kigali',
    'Rwanda',
    FALSE,
    TRUE,
    6,
    'mukamana-claudine'
)
ON CONFLICT (email) DO NOTHING;