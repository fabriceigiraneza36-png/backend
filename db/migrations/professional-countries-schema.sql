-- ============================================================
-- PROFESSIONAL COUNTRY SCHEMA FOR TOURISM PLATFORM
-- Migration: Upgrade countries table to production-ready schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- DROP EXISTING TABLES (if migrating from old schema)
-- ============================================================
DROP TABLE IF EXISTS country_highlights CASCADE;
DROP TABLE IF EXISTS country_faqs CASCADE;
DROP TABLE IF EXISTS country_images CASCADE;
DROP TABLE IF EXISTS countries CASCADE;

-- ============================================================
-- UPDATED TIMESTAMP TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABLE 1: COUNTRIES (Main table)
-- ============================================================
CREATE TABLE countries (
  -- Core identifiers
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL, -- e.g., "kenya", "tanzania"
  
  -- Basic information
  name TEXT NOT NULL,
  region TEXT, -- e.g., "East Africa", "Southeast Asia"
  tagline TEXT, -- Short catchy phrase
  excerpt TEXT, -- Brief description for cards/previews
  
  -- Media (primary images stored directly for quick access)
  hero_image TEXT, -- Main hero image CDN URL
  cover_image TEXT, -- Alternative/higher-res cover
  
  -- Structured data for UI components
  meta JSONB DEFAULT '{}'::jsonb, -- Quick stats: population, area, capital, currency, language
  quick_kpis JSONB DEFAULT '{}'::jsonb, -- Key performance indicators: tourist_count, avg_stay, peak_season
  
  -- Content & SEO
  seo JSONB DEFAULT '{}'::jsonb, -- { title, description, keywords, ogImage, canonical }
  page JSONB DEFAULT '{}'::jsonb, -- CMS blocks for page layout
  
  -- Travel essentials
  essentials JSONB DEFAULT '{}'::jsonb, -- { visa, health, safety, best_time, getting_around }
  
  -- i18n Support (JSONB for flexible translations)
  translations JSONB DEFAULT '{}'::jsonb, -- { "fr": { name: "Kenya", tagline: "..." }, "es": {...} }
  
  -- Legacy fields (for backward compatibility with existing data)
  description TEXT,
  short_description TEXT,
  image_url VARCHAR(500),
  flag_url VARCHAR(500),
  continent VARCHAR(100),
  capital VARCHAR(255),
  currency VARCHAR(100),
  language VARCHAR(255),
  timezone VARCHAR(100),
  best_time_to_visit VARCHAR(255),
  visa_info TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  
  -- Status & metadata
  is_active BOOLEAN DEFAULT true,
  is_featured BOOLEAN DEFAULT false,
  featured_until TIMESTAMPTZ,
  popularity_score DECIMAL DEFAULT 0,
  destination_count INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger for updated_at
CREATE TRIGGER update_countries_updated_at
  BEFORE UPDATE ON countries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- TABLE 2: COUNTRY_IMAGES (Normalized media)
-- ============================================================
CREATE TABLE country_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  country_id UUID REFERENCES countries(id) ON DELETE CASCADE,
  
  -- Image classification
  role TEXT NOT NULL, -- 'hero', 'gallery', 'cover', 'thumbnail', 'signature', 'banner'
  variant TEXT, -- 'desktop', 'mobile', 'tablet' (for responsive images)
  
  -- Image data
  url TEXT NOT NULL,
  alt TEXT,
  caption TEXT,
  credit TEXT,
  
  -- Technical metadata
  width INT,
  height INT,
  size_bytes BIGINT,
  format TEXT, -- 'jpg', 'png', 'webp'
  focal_point JSONB DEFAULT '{"x":0.5,"y":0.5}'::jsonb, -- for cropping focus
  
  -- Organization
  sort_order INT DEFAULT 0,
  tags TEXT[], -- Array of tags for filtering
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional flexible metadata
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 3: COUNTRY_FAQs (Structured FAQs per country)
-- ============================================================
CREATE TABLE country_faqs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  country_id UUID REFERENCES countries(id) ON DELETE CASCADE,
  
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT, -- 'visa', 'health', 'transport', 'general'
  
  sort_order INT DEFAULT 0,
  is_published BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger for updated_at
CREATE TRIGGER update_country_faqs_updated_at
  BEFORE UPDATE ON country_faqs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- TABLE 4: COUNTRY_HIGHLIGHTS (Key attractions/experiences)
-- ============================================================
CREATE TABLE country_highlights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  country_id UUID REFERENCES countries(id) ON DELETE CASCADE,
  
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT, -- Icon name or URL
  image_url TEXT,
  
  category TEXT, -- 'wildlife', 'culture', 'adventure', 'beach'
  sort_order INT DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================

-- Basic indexes
CREATE INDEX idx_countries_slug ON countries(slug);
CREATE INDEX idx_countries_region ON countries(region);
CREATE INDEX idx_countries_is_featured ON countries(is_featured) WHERE is_featured = true;
CREATE INDEX idx_countries_popularity ON countries(popularity_score DESC);
CREATE INDEX idx_countries_continent ON countries(continent);

-- GIN indexes for JSONB querying
CREATE INDEX idx_countries_meta ON countries USING GIN (meta);
CREATE INDEX idx_countries_seo ON countries USING GIN (seo);
CREATE INDEX idx_countries_essentials ON countries USING GIN (essentials);
CREATE INDEX idx_countries_page ON countries USING GIN (page);
CREATE INDEX idx_countries_translations ON countries USING GIN (translations);
CREATE INDEX idx_countries_quick_kpis ON countries USING GIN (quick_kpis);

-- Full-text search index
CREATE INDEX idx_countries_search ON countries USING GIN (
  to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(tagline, '') || ' ' || COALESCE(excerpt, ''))
);

-- Indexes for images
CREATE INDEX idx_country_images_country_id ON country_images(country_id);
CREATE INDEX idx_country_images_country_role ON country_images(country_id, role);
CREATE INDEX idx_country_images_tags ON country_images USING GIN (tags);

-- Indexes for FAQs
CREATE INDEX idx_country_faqs_country_id ON country_faqs(country_id);
CREATE INDEX idx_country_faqs_category ON country_faqs(category);

-- Indexes for highlights
CREATE INDEX idx_country_highlights_country_id ON country_highlights(country_id);
CREATE INDEX idx_country_highlights_category ON country_highlights(category);

-- ============================================================
-- SEED DATA: Sample Countries for Tourism Platform
-- ============================================================

INSERT INTO countries (name, slug, region, tagline, excerpt, hero_image, cover_image, continent, meta, quick_kpis, is_featured, popularity_score) VALUES
(
  'Kenya',
  'kenya',
  'East Africa',
  'The Cradle of Humanity',
  'Experience the ultimate safari adventure in Kenya, home to the famous Maasai Mara and the Great Migration.',
  'https://images.unsplash.com/photo-1516426122078-c23e76319801?w=1920',
  'https://images.unsplash.com/photo-1547471080-7cc2caa01a7e?w=1920',
  'Africa',
  '{"population": "54 million", "capital": "Nairobi", "currency": "Kenyan Shilling (KES)", "language": "Swahili, English", "area": "580,367 km²", "timezone": "UTC+3"}',
  '{"tourist_count": 2000000, "avg_stay_days": 8, "peak_season": "June-October", "top_activity": "Safari", "avg_rating": 4.8}',
  true,
  95
),
(
  'Tanzania',
  'tanzania',
  'East Africa',
  'Where Nature Meets Adventure',
  'Discover the wonders of Tanzania, from Mount Kilimanjaro to the endless plains of the Serengeti.',
  'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?w=1920',
  'https://images.unsplash.com/photo-1527482797697-8795b05a13fe?w=1920',
  'Africa',
  '{"population": "63 million", "capital": "Dodoma", "currency": "Tanzanian Shilling (TZS)", "language": "Swahili, English", "area": "947,303 km²", "timezone": "UTC+3"}',
  '{"tourist_count": 1500000, "avg_stay_days": 10, "peak_season": "June-October", "top_activity": "Safari", "avg_rating": 4.9}',
  true,
  92
),
(
  'Uganda',
  'uganda',
  'East Africa',
  'The Pearl of Africa',
  'Trek with mountain gorillas in Uganda''s lush forests and experience authentic African hospitality.',
  'https://images.unsplash.com/photo-1562619427-3c445456d9b8?w=1920',
  'https://images.unsplash.com/photo-1589394815804-964ed0be2eb5?w=1920',
  'Africa',
  '{"population": "47 million", "capital": "Kampala", "currency": "Ugandan Shilling (UGX)", "language": "English, Swahili", "area": "241,550 km²", "timezone": "UTC+3"}',
  '{"tourist_count": 800000, "avg_stay_days": 6, "peak_season": "June-August", "top_activity": "Gorilla Trekking", "avg_rating": 4.7}',
  true,
  85
),
(
  'Rwanda',
  'rwanda',
  'East Africa',
  'Land of a Thousand Hills',
  'Explore Rwanda''s stunning landscapes, vibrant culture, and get close to endangered mountain gorillas.',
  'https://images.unsplash.com/photo-1585135497273-1a86b09fe70e?w=1920',
  'https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?w=1920',
  'Africa',
  '{"population": "13 million", "capital": "Kigali", "currency": "Rwandan Franc (RWF)", "language": "Kinyarwanda, English, French", "area": "26,338 km²", "timezone": "UTC+2"}',
  '{"tourist_count": 500000, "avg_stay_days": 5, "peak_season": "June-September", "top_activity": "Gorilla Trekking", "avg_rating": 4.9}',
  true,
  88
)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
SELECT 'Countries table created' AS status, COUNT(*) AS count FROM countries;
SELECT 'Country images table created' AS status, COUNT(*) AS count FROM country_images;
SELECT 'Country FAQs table created' AS status, COUNT(*) AS count FROM country_faqs;
SELECT 'Country highlights table created' AS status, COUNT(*) AS count FROM country_highlights;

-- List all created tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
ORDER BY table_name;
