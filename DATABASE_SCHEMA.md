# Database Schema Documentation

This document provides a comprehensive overview of all database tables and their columns for the Altuvera Travel Admin Panel.

## Table of Contents

1. [Admin Users](#admin-users)
2. [Users](#users)
3. [Countries](#countries)
4. [Country Airports](#country-airports)
5. [Country Festivals](#country-festivals)
6. [Country UNESCO Sites](#country-unesco-sites)
7. [Country Historical Events](#country-historical-events)
8. [Destinations](#destinations)
9. [Destination Images](#destination-images)
10. [Destination Itineraries](#destination-itineraries)
11. [Destination FAQs](#destination-faqs)
12. [Destination Reviews](#destination-reviews)
13. [Destination Tags](#destination-tags)
14. [Posts](#posts)
15. [Tips](#tips)
16. [Services](#services)
17. [Team Members](#team-members)
18. [Gallery](#gallery)
19. [Bookings](#bookings)
20. [FAQs](#faqs)
21. [Contact Messages](#contact-messages)
22. [Contact Replies](#contact-replies)
23. [Pages](#pages)
24. [Virtual Tours](#virtual-tours)
25. [Subscribers](#subscribers)
26. [Site Settings](#site-settings)
27. [User Sessions](#user-sessions)
28. [Country Likes](#country-likes)
29. [Country Comments](#country-comments)
30. [Country Ratings](#country-ratings)
31. [Destination Likes](#destination-likes)
32. [Destination Comments](#destination-comments)
33. [Destination Ratings](#destination-ratings)

---

## Admin Users

**Table:** `admin_users`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `username` | VARCHAR(100) | UNIQUE NOT NULL | Admin username |
| `email` | VARCHAR(255) | UNIQUE NOT NULL | Admin email address |
| `password_hash` | VARCHAR(255) | NOT NULL | Hashed password |
| `full_name` | VARCHAR(255) |  | Admin's full name |
| `role` | VARCHAR(50) | DEFAULT 'admin' | Admin role (admin/super-admin) |
| `avatar_url` | VARCHAR(500) |  | Profile picture URL |
| `is_active` | BOOLEAN | DEFAULT true | Account active status |
| `last_login` | TIMESTAMP |  | Last login timestamp |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trg_admin_users_updated` (updates `updated_at`)

---

## Users

**Table:** `users`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `email` | VARCHAR(255) | UNIQUE NOT NULL | User email address |
| `password_hash` | VARCHAR(255) |  | Hashed password (nullable for OAuth) |
| `full_name` | VARCHAR(255) |  | User's full name |
| `avatar_url` | VARCHAR(500) |  | Profile picture URL |
| `phone` | VARCHAR(50) |  | Phone number |
| `nationality` | VARCHAR(100) |  | User's nationality |
| `google_id` | VARCHAR(255) | UNIQUE | Google OAuth ID |
| `github_id` | VARCHAR(255) | UNIQUE | GitHub OAuth ID |
| `auth_provider` | VARCHAR(50) | DEFAULT 'email' | Authentication provider |
| `is_verified` | BOOLEAN | DEFAULT false | Email verification status |
| `is_active` | BOOLEAN | DEFAULT true | Account active status |
| `verification_token` | VARCHAR(255) |  | Email verification token |
| `reset_token` | VARCHAR(255) |  | Password reset token |
| `reset_token_expires` | TIMESTAMP |  | Reset token expiration |
| `preferences` | JSONB | DEFAULT '{}' | User preferences (JSON) |
| `last_login` | TIMESTAMP |  | Last login timestamp |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trg_users_updated` (updates `updated_at`)
**Indexes:** `idx_users_email`, `idx_users_google`, `idx_users_github`

---

## Countries

**Table:** `countries`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `slug` | VARCHAR(255) | UNIQUE NOT NULL | URL-friendly identifier |
| `name` | VARCHAR(255) | NOT NULL | Country name |
| `official_name` | VARCHAR(255) |  | Official country name |
| `capital` | VARCHAR(255) |  | Capital city |
| `flag` | VARCHAR(10) |  | Flag emoji/unicode |
| `flag_url` | VARCHAR(500) |  | Flag image URL |
| `tagline` | TEXT |  | Country tagline |
| `motto` | TEXT |  | National motto |
| `demonym` | VARCHAR(100) |  | Name for citizens |
| `independence_date` | DATE |  | Independence date |
| `government_type` | VARCHAR(100) |  | Type of government |
| `head_of_state` | VARCHAR(255) |  | Current head of state |
| `continent` | VARCHAR(100) |  | Continent |
| `region` | VARCHAR(100) |  | Geographic region |
| `sub_region` | VARCHAR(100) |  | Sub-region |
| `description` | TEXT |  | Country description |
| `full_description` | TEXT |  | Detailed description |
| `additional_info` | TEXT |  | Additional information |
| `population` | BIGINT |  | Population count |
| `area` | DECIMAL(12, 2) |  | Area in square kilometers |
| `population_density` | DECIMAL(8, 2) |  | People per square kilometer |
| `urban_population` | DECIMAL(5, 2) |  | Urban population percentage |
| `life_expectancy` | DECIMAL(4, 1) |  | Life expectancy in years |
| `median_age` | DECIMAL(4, 1) |  | Median age |
| `literacy_rate` | DECIMAL(5, 2) |  | Literacy rate percentage |
| `languages` | TEXT[] |  | Array of languages |
| `official_languages` | TEXT[] |  | Array of official languages |
| `national_languages` | TEXT[] |  | Array of national languages |
| `ethnic_groups` | TEXT[] |  | Array of ethnic groups |
| `religions` | TEXT[] |  | Array of religions |
| `currency` | VARCHAR(100) |  | Currency name |
| `currency_symbol` | VARCHAR(10) |  | Currency symbol |
| `timezone` | VARCHAR(100) |  | Time zone |
| `calling_code` | VARCHAR(10) |  | International calling code |
| `internet_tld` | VARCHAR(10) |  | Internet top-level domain |
| `driving_side` | VARCHAR(20) |  | Driving side (left/right) |
| `electrical_plug` | VARCHAR(50) |  | Electrical plug types |
| `voltage` | VARCHAR(20) |  | Electrical voltage |
| `water_safety` | VARCHAR(50) |  | Water safety information |
| `climate` | TEXT |  | Climate description |
| `best_time_to_visit` | VARCHAR(255) |  | Best visiting seasons |
| `seasons` | JSONB | DEFAULT '{}' | Seasonal information (JSON) |
| `visa_info` | TEXT |  | Visa requirements |
| `health_info` | TEXT |  | Health information |
| `highlights` | TEXT[] |  | Array of highlights |
| `experiences` | TEXT[] |  | Array of experiences |
| `travel_tips` | TEXT[] |  | Array of travel tips |
| `neighboring_countries` | TEXT[] |  | Array of neighboring countries |
| `wildlife` | JSONB | DEFAULT '{}' | Wildlife information (JSON) |
| `cuisine` | JSONB | DEFAULT '{}' | Cuisine information (JSON) |
| `economic_info` | JSONB | DEFAULT '{}' | Economic information (JSON) |
| `geography` | JSONB | DEFAULT '{}' | Geographic information (JSON) |
| `image_url` | VARCHAR(500) |  | Main image URL |
| `cover_image_url` | VARCHAR(500) |  | Cover image URL |
| `hero_image` | VARCHAR(500) |  | Hero image URL |
| `images` | TEXT[] |  | Array of image URLs |
| `latitude` | DECIMAL(10, 8) |  | Geographic latitude |
| `longitude` | DECIMAL(11, 8) |  | Geographic longitude |
| `is_featured` | BOOLEAN | DEFAULT false | Featured status |
| `is_active` | BOOLEAN | DEFAULT true | Active status |
| `display_order` | INTEGER | DEFAULT 0 | Display order |
| `destination_count` | INTEGER | DEFAULT 0 | Number of destinations |
| `view_count` | INTEGER | DEFAULT 0 | View count |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trg_countries_updated` (updates `updated_at`)
**Indexes:** `idx_countries_slug`, `idx_countries_continent`, `idx_countries_featured`

---

## Country Airports

**Table:** `country_airports`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `country_id` | INTEGER | NOT NULL, REFERENCES countries(id) ON DELETE CASCADE | Foreign key to countries |
| `name` | VARCHAR(255) | NOT NULL | Airport name |
| `code` | VARCHAR(10) |  | Airport code (IATA) |
| `location` | VARCHAR(255) |  | Airport location/city |
| `airport_type` | VARCHAR(50) | DEFAULT 'international' | Airport type |
| `description` | TEXT |  | Airport description |
| `is_main_international` | BOOLEAN | DEFAULT false | Main international airport flag |
| `display_order` | INTEGER | DEFAULT 0 | Display order |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |

---

## Country Festivals

**Table:** `country_festivals`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `country_id` | INTEGER | NOT NULL, REFERENCES countries(id) ON DELETE CASCADE | Foreign key to countries |
| `name` | VARCHAR(255) | NOT NULL | Festival name |
| `period` | VARCHAR(100) |  | Festival period |
| `month` | VARCHAR(50) |  | Festival month |
| `description` | TEXT |  | Festival description |
| `is_major_event` | BOOLEAN | DEFAULT false | Major event flag |
| `image_url` | VARCHAR(500) |  | Festival image URL |
| `display_order` | INTEGER | DEFAULT 0 | Display order |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |

---

## Country UNESCO Sites

**Table:** `country_unesco_sites`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `country_id` | INTEGER | NOT NULL, REFERENCES countries(id) ON DELETE CASCADE | Foreign key to countries |
| `name` | VARCHAR(255) | NOT NULL | UNESCO site name |
| `year_inscribed` | INTEGER |  | Year inscribed to UNESCO |
| `site_type` | VARCHAR(100) |  | Type of UNESCO site |
| `description` | TEXT |  | Site description |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |

---

## Country Historical Events

**Table:** `country_historical_events`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `country_id` | INTEGER | NOT NULL, REFERENCES countries(id) ON DELETE CASCADE | Foreign key to countries |
| `year` | INTEGER | NOT NULL | Event year |
| `event` | TEXT | NOT NULL | Event description |
| `event_type` | VARCHAR(50) | DEFAULT 'historical' | Event type |
| `is_major` | BOOLEAN | DEFAULT false | Major event flag |
| `sort_year` | INTEGER | NOT NULL | Year for sorting |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |

---

## Destinations

**Table:** `destinations`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `country_id` | INTEGER | NOT NULL, REFERENCES countries(id) ON DELETE CASCADE | Foreign key to countries |
| `name` | VARCHAR(255) | NOT NULL | Destination name |
| `slug` | VARCHAR(255) | UNIQUE NOT NULL | URL-friendly identifier |
| `tagline` | TEXT |  | Destination tagline |
| `short_description` | TEXT |  | Short description |
| `description` | TEXT |  | Full description |
| `overview` | TEXT |  | Destination overview |
| `highlights` | TEXT[] |  | Array of highlights |
| `activities` | TEXT[] |  | Array of activities |
| `wildlife` | TEXT[] |  | Array of wildlife |
| `best_time_to_visit` | VARCHAR(255) |  | Best visiting time |
| `getting_there` | TEXT |  | Transportation information |
| `what_to_expect` | TEXT |  | What to expect description |
| `local_tips` | TEXT |  | Local tips |
| `safety_info` | TEXT |  | Safety information |
| `category` | VARCHAR(100) |  | Destination category |
| `difficulty` | VARCHAR(50) |  | Difficulty level |
| `destination_type` | VARCHAR(50) |  | Type of destination |
| `region` | VARCHAR(100) |  | Geographic region |
| `nearest_city` | VARCHAR(255) |  | Nearest city |
| `nearest_airport` | VARCHAR(255) |  | Nearest airport |
| `distance_from_airport_km` | DECIMAL(8, 2) |  | Distance from airport |
| `address` | TEXT |  | Physical address |
| `latitude` | DECIMAL(10, 8) |  | Geographic latitude |
| `longitude` | DECIMAL(11, 8) |  | Geographic longitude |
| `altitude_meters` | INTEGER |  | Altitude in meters |
| `image_url` | VARCHAR(500) |  | Main image URL |
| `image_urls` | TEXT[] | DEFAULT ARRAY[]::TEXT[] | Array of image URLs |
| `cover_image_url` | VARCHAR(500) |  | Cover image URL |
| `hero_image` | VARCHAR(500) |  | Hero image URL |
| `thumbnail_url` | VARCHAR(500) |  | Thumbnail image URL |
| `video_url` | VARCHAR(500) |  | Video URL |
| `virtual_tour_url` | VARCHAR(500) |  | Virtual tour URL |
| `duration_days` | INTEGER |  | Duration in days |
| `duration_nights` | INTEGER |  | Duration in nights |
| `duration_display` | VARCHAR(100) |  | Display duration |
| `min_group_size` | INTEGER | DEFAULT 1 | Minimum group size |
| `max_group_size` | INTEGER |  | Maximum group size |
| `min_age` | INTEGER |  | Minimum age |
| `fitness_level` | VARCHAR(50) |  | Required fitness level |
| `rating` | DECIMAL(3, 2) | DEFAULT 0 | Average rating |
| `review_count` | INTEGER | DEFAULT 0 | Number of reviews |
| `view_count` | INTEGER | DEFAULT 0 | View count |
| `booking_count` | INTEGER | DEFAULT 0 | Booking count |
| `wishlist_count` | INTEGER | DEFAULT 0 | Wishlist count |
| `entrance_fee` | VARCHAR(100) |  | Entrance fee information |
| `operating_hours` | TEXT |  | Operating hours |
| `is_sold_out` | BOOLEAN | DEFAULT false | Sold out status |
| `status` | VARCHAR(50) | DEFAULT 'draft' | Publication status |
| `is_featured` | BOOLEAN | DEFAULT false | Featured status |
| `is_popular` | BOOLEAN | DEFAULT false | Popular status |
| `is_new` | BOOLEAN | DEFAULT false | New status |
| `is_eco_friendly` | BOOLEAN | DEFAULT false | Eco-friendly status |
| `is_family_friendly` | BOOLEAN | DEFAULT false | Family-friendly status |
| `meta_title` | VARCHAR(255) |  | SEO meta title |
| `meta_description` | TEXT |  | SEO meta description |
| `published_at` | TIMESTAMP |  | Publication timestamp |
| `is_active` | BOOLEAN | DEFAULT true | Active status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trg_destinations_updated` (updates `updated_at`)
**Indexes:** `idx_destinations_slug`, `idx_destinations_country`, `idx_destinations_category`, `idx_destinations_featured`, `idx_destinations_coords`, `idx_destinations_highlights_gin`, `idx_destinations_image_urls_gin`

---

## Destination Images

**Table:** `destination_images`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `destination_id` | INTEGER | REFERENCES destinations(id) ON DELETE CASCADE | Foreign key to destinations |
| `image_url` | VARCHAR(500) | NOT NULL | Image URL |
| `thumbnail_url` | VARCHAR(500) |  | Thumbnail URL |
| `caption` | VARCHAR(255) |  | Image caption |
| `is_primary` | BOOLEAN | DEFAULT false | Primary image flag |
| `sort_order` | INTEGER | DEFAULT 0 | Display order |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |

---

## Destination Itineraries

**Table:** `destination_itineraries`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `destination_id` | INTEGER | NOT NULL, REFERENCES destinations(id) ON DELETE CASCADE | Foreign key to destinations |
| `day_number` | INTEGER | NOT NULL | Day number in itinerary |
| `title` | VARCHAR(255) | NOT NULL | Day title |
| `description` | TEXT |  | Day description |
| `activities` | TEXT[] |  | Array of activities |
| `meals` | TEXT[] |  | Array of meals |
| `accommodation` | VARCHAR(255) |  | Accommodation details |
| `image_url` | VARCHAR(500) |  | Day image URL |
| `is_active` | BOOLEAN | DEFAULT true | Active status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |

---

## Destination FAQs

**Table:** `destination_faqs`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `destination_id` | INTEGER | NOT NULL, REFERENCES destinations(id) ON DELETE CASCADE | Foreign key to destinations |
| `question` | TEXT | NOT NULL | FAQ question |
| `answer` | TEXT | NOT NULL | FAQ answer |
| `category` | VARCHAR(100) |  | FAQ category |
| `sort_order` | INTEGER | DEFAULT 0 | Display order |
| `is_active` | BOOLEAN | DEFAULT true | Active status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |

---

## Destination Reviews

**Table:** `destination_reviews`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `destination_id` | INTEGER | NOT NULL, REFERENCES destinations(id) ON DELETE CASCADE | Foreign key to destinations |
| `reviewer_name` | VARCHAR(255) | NOT NULL | Reviewer name |
| `reviewer_country` | VARCHAR(100) |  | Reviewer country |
| `reviewer_avatar` | VARCHAR(500) |  | Reviewer avatar URL |
| `title` | VARCHAR(255) |  | Review title |
| `content` | TEXT | NOT NULL | Review content |
| `overall_rating` | DECIMAL(3, 2) | NOT NULL | Overall rating (1-5) |
| `trip_date` | DATE |  | Trip date |
| `trip_type` | VARCHAR(50) |  | Type of trip |
| `images` | TEXT[] |  | Array of review images |
| `is_verified` | BOOLEAN | DEFAULT false | Verified review flag |
| `is_featured` | BOOLEAN | DEFAULT false | Featured review flag |
| `helpful_count` | INTEGER | DEFAULT 0 | Helpful vote count |
| `status` | VARCHAR(20) | DEFAULT 'pending' | Review status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |

---

## Destination Tags

**Table:** `destination_tags`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `destination_id` | INTEGER | NOT NULL, REFERENCES destinations(id) ON DELETE CASCADE | Foreign key to destinations |
| `tag_name` | VARCHAR(100) | NOT NULL | Tag name |
| `tag_slug` | VARCHAR(100) | NOT NULL | Tag slug |
| `tag_category` | VARCHAR(50) |  | Tag category |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |

---

## Posts

**Table:** `posts`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `title` | VARCHAR(255) | NOT NULL | Post title |
| `slug` | VARCHAR(255) | UNIQUE NOT NULL | URL-friendly identifier |
| `content` | TEXT |  | Post content |
| `excerpt` | TEXT |  | Post excerpt |
| `image_url` | VARCHAR(500) |  | Featured image URL |
| `cover_image_url` | VARCHAR(500) |  | Cover image URL |
| `author_name` | VARCHAR(255) |  | Author name |
| `author_avatar` | VARCHAR(500) |  | Author avatar URL |
| `category` | VARCHAR(100) |  | Post category |
| `tags` | TEXT[] |  | Array of tags |
| `is_published` | BOOLEAN | DEFAULT false | Publication status |
| `is_featured` | BOOLEAN | DEFAULT false | Featured status |
| `view_count` | INTEGER | DEFAULT 0 | View count |
| `read_time` | INTEGER | DEFAULT 0 | Estimated read time |
| `meta_title` | VARCHAR(255) |  | SEO meta title |
| `meta_description` | TEXT |  | SEO meta description |
| `published_at` | TIMESTAMP |  | Publication timestamp |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trg_posts_updated` (updates `updated_at`)
**Indexes:** `idx_posts_slug`, `idx_posts_published`, `idx_posts_category`

---

## Tips

**Table:** `tips`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `slug` | VARCHAR(255) | UNIQUE NOT NULL | URL-friendly identifier |
| `summary` | TEXT | NOT NULL | Tip summary |
| `body` | TEXT |  | Full tip content |
| `category` | VARCHAR(100) |  | Tip category |
| `trip_phase` | VARCHAR(80) |  | Trip phase (planning, during, after) |
| `audience` | VARCHAR(80) | DEFAULT 'all-travelers' | Target audience |
| `difficulty_level` | VARCHAR(40) | DEFAULT 'all-levels' | Difficulty level |
| `priority_level` | SMALLINT | DEFAULT 3, CHECK (1-5) | Priority level |
| `read_time_minutes` | SMALLINT | DEFAULT 3, CHECK (>0) | Read time in minutes |
| `checklist` | TEXT[] | DEFAULT ARRAY[]::TEXT[] | Checklist items |
| `tags` | TEXT[] | DEFAULT ARRAY[]::TEXT[] | Array of tags |
| `icon` | VARCHAR(100) |  | Icon identifier |
| `image_url` | VARCHAR(500) |  | Tip image URL |
| `source_url` | VARCHAR(500) |  | Source URL |
| `cta_text` | VARCHAR(255) |  | Call-to-action text |
| `cta_url` | VARCHAR(500) |  | Call-to-action URL |
| `sort_order` | INTEGER | DEFAULT 0 | Display order |
| `is_featured` | BOOLEAN | DEFAULT false | Featured status |
| `is_active` | BOOLEAN | DEFAULT true | Active status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trg_tips_updated` (updates `updated_at`)
**Indexes:** `idx_tips_slug`, `idx_tips_category`, `idx_tips_trip_phase`, `idx_tips_featured`

---

## Services

**Table:** `services`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `title` | VARCHAR(255) | NOT NULL | Service title |
| `slug` | VARCHAR(255) | UNIQUE NOT NULL | URL-friendly identifier |
| `description` | TEXT |  | Service description |
| `short_description` | TEXT |  | Short description |
| `icon` | VARCHAR(100) |  | Service icon |
| `image_url` | VARCHAR(500) |  | Service image URL |
| `features` | TEXT[] |  | Array of features |
| `is_featured` | BOOLEAN | DEFAULT false | Featured status |
| `sort_order` | INTEGER | DEFAULT 0 | Display order |
| `is_active` | BOOLEAN | DEFAULT true | Active status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trg_services_updated` (updates `updated_at`)

---

## Team Members

**Table:** `team_members`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `name` | VARCHAR(100) | NOT NULL | Team member name |
| `role` | VARCHAR(100) | NOT NULL | Job role/title |
| `department` | VARCHAR(50) |  | Department |
| `bio` | TEXT |  | Biography |
| `image_url` | TEXT |  | Profile image URL |
| `image_public_id` | VARCHAR(255) |  | Cloudinary public ID |
| `email` | VARCHAR(150) | UNIQUE | Email address |
| `phone` | VARCHAR(30) |  | Phone number |
| `linkedin_url` | VARCHAR(255) |  | LinkedIn profile URL |
| `twitter_url` | VARCHAR(255) |  | Twitter profile URL |
| `instagram_url` | VARCHAR(255) |  | Instagram profile URL |
| `website_url` | VARCHAR(255) |  | Personal website URL |
| `expertise` | TEXT[] |  | Array of expertise areas |
| `languages` | TEXT[] |  | Array of spoken languages |
| `certifications` | TEXT[] |  | Array of certifications |
| `years_experience` | INTEGER | DEFAULT 0 | Years of experience |
| `location` | VARCHAR(100) |  | Location |
| `country` | VARCHAR(50) |  | Country |
| `display_order` | INTEGER | DEFAULT 0 | Display order |
| `is_featured` | BOOLEAN | DEFAULT FALSE | Featured status |
| `is_active` | BOOLEAN | DEFAULT TRUE | Active status |
| `show_on_homepage` | BOOLEAN | DEFAULT FALSE | Homepage display flag |
| `slug` | VARCHAR(120) | UNIQUE | URL-friendly identifier |
| `meta_title` | VARCHAR(160) |  | SEO meta title |
| `meta_description` | VARCHAR(320) |  | SEO meta description |
| `joined_date` | DATE |  | Date joined company |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trigger_team_members_updated_at` (updates `updated_at`)
**Indexes:** `idx_team_members_department`, `idx_team_members_is_active`, `idx_team_members_is_featured`, `idx_team_members_display_order`, `idx_team_members_slug`

---

## Gallery

**Table:** `gallery`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `title` | VARCHAR(255) |  | Image title |
| `description` | TEXT |  | Image description |
| `image_url` | VARCHAR(500) | NOT NULL | Image URL |
| `thumbnail_url` | VARCHAR(500) |  | Thumbnail URL |
| `category` | VARCHAR(100) |  | Gallery category |
| `location` | VARCHAR(255) |  | Location where photo was taken |
| `country_id` | INTEGER | REFERENCES countries(id) ON DELETE SET NULL | Foreign key to countries |
| `destination_id` | INTEGER | REFERENCES destinations(id) ON DELETE SET NULL | Foreign key to destinations |
| `photographer` | VARCHAR(255) |  | Photographer name |
| `sort_order` | INTEGER | DEFAULT 0 | Display order |
| `is_featured` | BOOLEAN | DEFAULT false | Featured status |
| `is_active` | BOOLEAN | DEFAULT true | Active status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |

---

## Bookings

**Table:** `bookings`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `booking_number` | VARCHAR(50) | UNIQUE NOT NULL | Unique booking number |
| `destination_id` | INTEGER | REFERENCES destinations(id) ON DELETE SET NULL | Foreign key to destinations |
| `service_id` | INTEGER | REFERENCES services(id) ON DELETE SET NULL | Foreign key to services |
| `full_name` | VARCHAR(255) | NOT NULL | Customer full name |
| `email` | VARCHAR(255) | NOT NULL | Customer email |
| `phone` | VARCHAR(50) |  | Customer phone |
| `whatsapp` | VARCHAR(50) |  | WhatsApp number |
| `nationality` | VARCHAR(100) |  | Customer nationality |
| `travel_date` | DATE |  | Travel start date |
| `return_date` | DATE |  | Travel return date |
| `number_of_travelers` | INTEGER | DEFAULT 1 | Number of travelers |
| `accommodation_type` | VARCHAR(100) |  | Type of accommodation |
| `special_requests` | TEXT |  | Special requests |
| `status` | VARCHAR(50) | DEFAULT 'pending' | Booking status |
| `admin_notes` | TEXT |  | Admin internal notes |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trg_bookings_updated` (updates `updated_at`)
**Indexes:** `idx_bookings_number`, `idx_bookings_status`, `idx_bookings_email`

---

## FAQs

**Table:** `faqs`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `question` | TEXT | NOT NULL | FAQ question |
| `answer` | TEXT | NOT NULL | FAQ answer |
| `category` | VARCHAR(100) |  | FAQ category |
| `sort_order` | INTEGER | DEFAULT 0 | Display order |
| `is_active` | BOOLEAN | DEFAULT true | Active status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trg_faqs_updated` (updates `updated_at`)
**Indexes:** `idx_faqs_category`

---

## Contact Messages

**Table:** `contact_messages`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `full_name` | VARCHAR(255) | NOT NULL | Sender full name |
| `email` | VARCHAR(255) | NOT NULL | Sender email |
| `phone` | VARCHAR(50) |  | Sender phone |
| `whatsapp` | VARCHAR(50) |  | Sender WhatsApp |
| `subject` | VARCHAR(255) |  | Message subject |
| `message` | TEXT | NOT NULL | Message content |
| `trip_type` | VARCHAR(100) |  | Type of trip inquiry |
| `travel_date` | DATE |  | Desired travel date |
| `number_of_travelers` | INTEGER |  | Number of travelers |
| `source` | VARCHAR(100) | DEFAULT 'website' | Message source |
| `ip_address` | VARCHAR(50) |  | Sender IP address |
| `user_agent` | TEXT |  | Browser user agent |
| `referrer_url` | TEXT |  | Referrer URL |
| `status` | VARCHAR(20) | DEFAULT 'new' | Message status |
| `is_read` | BOOLEAN | DEFAULT false | Read status |
| `is_starred` | BOOLEAN | DEFAULT false | Starred status |
| `priority` | VARCHAR(20) | DEFAULT 'normal' | Message priority |
| `assigned_to` | INTEGER |  | Assigned admin ID |
| `assigned_at` | TIMESTAMP |  | Assignment timestamp |
| `responded_at` | TIMESTAMP |  | Response timestamp |
| `response_notes` | TEXT |  | Response notes |
| `tags` | TEXT[] | DEFAULT ARRAY[]::TEXT[] | Array of tags |
| `read_at` | TIMESTAMP |  | Read timestamp |
| `archived_at` | TIMESTAMP |  | Archive timestamp |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trg_contact_messages_updated` (updates `updated_at`)
**Indexes:** `idx_contact_read`

---

## Contact Replies

**Table:** `contact_replies`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `message_id` | INTEGER | NOT NULL, REFERENCES contact_messages(id) ON DELETE CASCADE | Foreign key to contact_messages |
| `subject` | VARCHAR(255) |  | Reply subject |
| `body` | TEXT | NOT NULL | Reply content |
| `sent_by` | INTEGER | REFERENCES admin_users(id) ON DELETE SET NULL | Foreign key to admin_users |
| `sent_by_name` | VARCHAR(255) |  | Sender name |
| `sent_by_email` | VARCHAR(255) |  | Sender email |
| `status` | VARCHAR(50) | DEFAULT 'sent' | Reply status |
| `sent_at` | TIMESTAMP | DEFAULT NOW() | Sent timestamp |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |

---

## Pages

**Table:** `pages`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `title` | VARCHAR(255) | NOT NULL | Page title |
| `slug` | VARCHAR(255) | UNIQUE NOT NULL | URL-friendly identifier |
| `content` | TEXT |  | Page content |
| `meta_title` | VARCHAR(255) |  | SEO meta title |
| `meta_description` | TEXT |  | SEO meta description |
| `is_published` | BOOLEAN | DEFAULT true | Publication status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trg_pages_updated` (updates `updated_at`)

---

## Virtual Tours

**Table:** `virtual_tours`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `title` | VARCHAR(255) | NOT NULL | Virtual tour title |
| `slug` | VARCHAR(255) | UNIQUE NOT NULL | URL-friendly identifier |
| `description` | TEXT |  | Tour description |
| `destination_id` | INTEGER | REFERENCES destinations(id) ON DELETE SET NULL | Foreign key to destinations |
| `video_url` | VARCHAR(500) |  | Video URL |
| `thumbnail_url` | VARCHAR(500) |  | Thumbnail URL |
| `panorama_url` | VARCHAR(500) |  | Panorama URL |
| `duration` | VARCHAR(50) |  | Tour duration |
| `view_count` | INTEGER | DEFAULT 0 | View count |
| `is_featured` | BOOLEAN | DEFAULT false | Featured status |
| `is_active` | BOOLEAN | DEFAULT true | Active status |
| `sort_order` | INTEGER | DEFAULT 0 | Display order |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Triggers:** `trg_virtual_tours_updated` (updates `updated_at`)
**Indexes:** `idx_virtual_tours_slug`

---

## Subscribers

**Table:** `subscribers`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `email` | VARCHAR(255) | UNIQUE NOT NULL | Subscriber email |
| `is_active` | BOOLEAN | DEFAULT true | Subscription active status |
| `subscribed_at` | TIMESTAMP | DEFAULT NOW() | Subscription timestamp |
| `unsubscribed_at` | TIMESTAMP |  | Unsubscription timestamp |

---

## Site Settings

**Table:** `site_settings`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `key` | VARCHAR(100) | UNIQUE NOT NULL | Setting key |
| `value` | TEXT |  | Setting value |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

---

## User Sessions

**Table:** `user_sessions`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `user_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | Foreign key to users |
| `token_hash` | VARCHAR(255) | NOT NULL | Session token hash |
| `device_info` | VARCHAR(500) |  | Device information |
| `ip_address` | VARCHAR(50) |  | IP address |
| `expires_at` | TIMESTAMP | NOT NULL | Session expiration |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |

**Indexes:** `idx_sessions_user`, `idx_sessions_token`

---

## Country Likes

**Table:** `country_likes`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `country_id` | INTEGER | NOT NULL, REFERENCES countries(id) ON DELETE CASCADE | Foreign key to countries |
| `user_id` | INTEGER | REFERENCES users(id) ON DELETE SET NULL | Foreign key to users |
| `session_id` | VARCHAR(255) |  | Session identifier |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Constraints:** `country_likes_unique_user`, `country_likes_unique_session`
**Indexes:** `idx_country_likes_country_id`, `idx_country_likes_user_id`

---

## Country Comments

**Table:** `country_comments`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `country_id` | INTEGER | NOT NULL, REFERENCES countries(id) ON DELETE CASCADE | Foreign key to countries |
| `user_id` | INTEGER | REFERENCES users(id) ON DELETE SET NULL | Foreign key to users |
| `author_name` | VARCHAR(255) |  | Author name |
| `author_email` | VARCHAR(255) |  | Author email |
| `content` | TEXT | NOT NULL | Comment content |
| `parent_id` | INTEGER | REFERENCES country_comments(id) ON DELETE CASCADE | Parent comment ID |
| `is_approved` | BOOLEAN | DEFAULT TRUE | Approval status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Indexes:** `idx_country_comments_country_id`, `idx_country_comments_user_id`, `idx_country_comments_parent_id`, `idx_country_comments_created_at`

---

## Country Ratings

**Table:** `country_ratings`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `country_id` | INTEGER | NOT NULL, REFERENCES countries(id) ON DELETE CASCADE | Foreign key to countries |
| `user_id` | INTEGER | REFERENCES users(id) ON DELETE SET NULL | Foreign key to users |
| `session_id` | VARCHAR(255) |  | Session identifier |
| `rating` | INTEGER | NOT NULL, CHECK (1-5) | Rating value |
| `review` | TEXT |  | Review text |
| `is_approved` | BOOLEAN | DEFAULT TRUE | Approval status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Constraints:** `country_ratings_unique_user`, `country_ratings_unique_session`
**Indexes:** `idx_country_ratings_country_id`, `idx_country_ratings_user_id`, `idx_country_ratings_rating`

---

## Destination Likes

**Table:** `destination_likes`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `destination_id` | INTEGER | NOT NULL, REFERENCES destinations(id) ON DELETE CASCADE | Foreign key to destinations |
| `user_id` | INTEGER | REFERENCES users(id) ON DELETE SET NULL | Foreign key to users |
| `session_id` | VARCHAR(255) |  | Session identifier |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Constraints:** `destination_likes_unique_user`, `destination_likes_unique_session`
**Indexes:** `idx_destination_likes_destination_id`, `idx_destination_likes_user_id`

---

## Destination Comments

**Table:** `destination_comments`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `destination_id` | INTEGER | NOT NULL, REFERENCES destinations(id) ON DELETE CASCADE | Foreign key to destinations |
| `user_id` | INTEGER | REFERENCES users(id) ON DELETE SET NULL | Foreign key to users |
| `author_name` | VARCHAR(255) |  | Author name |
| `author_email` | VARCHAR(255) |  | Author email |
| `content` | TEXT | NOT NULL | Comment content |
| `parent_id` | INTEGER | REFERENCES destination_comments(id) ON DELETE CASCADE | Parent comment ID |
| `is_approved` | BOOLEAN | DEFAULT TRUE | Approval status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Indexes:** `idx_destination_comments_destination_id`, `idx_destination_comments_user_id`, `idx_destination_comments_parent_id`, `idx_destination_comments_created_at`

---

## Destination Ratings

**Table:** `destination_ratings`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing primary key |
| `destination_id` | INTEGER | NOT NULL, REFERENCES destinations(id) ON DELETE CASCADE | Foreign key to destinations |
| `user_id` | INTEGER | REFERENCES users(id) ON DELETE SET NULL | Foreign key to users |
| `session_id` | VARCHAR(255) |  | Session identifier |
| `rating` | INTEGER | NOT NULL, CHECK (1-5) | Rating value |
| `review` | TEXT |  | Review text |
| `is_approved` | BOOLEAN | DEFAULT TRUE | Approval status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Record update timestamp |

**Constraints:** `destination_ratings_unique_user`, `destination_ratings_unique_session`
**Indexes:** `idx_destination_ratings_destination_id`, `idx_destination_ratings_user_id`, `idx_destination_ratings_rating`

---

## Database Views

### Contact Statistics View

**View:** `v_contact_stats`

Provides aggregated statistics for contact messages including counts by status, priority, and time periods.

---

## Notes for Admin Panel Development

1. **Primary Keys**: All tables use `SERIAL` primary keys (auto-incrementing integers)
2. **Timestamps**: Most tables have `created_at` and `updated_at` fields with automatic triggers
3. **Foreign Keys**: Proper referential integrity with CASCADE/SET NULL delete behaviors
4. **Indexes**: Strategic indexing for performance on commonly queried columns
5. **Arrays**: PostgreSQL array types used for tags, highlights, features, etc.
6. **JSON**: JSONB columns for flexible structured data storage
7. **Constraints**: Check constraints for data validation (ratings 1-5, etc.)
8. **Unique Constraints**: Prevent duplicate likes/ratings per user
9. **Soft Deletes**: Some tables support soft deletion (not implemented in all tables)

This schema supports a comprehensive travel booking and content management system with user engagement features, admin management, and extensive analytics capabilities.</content>
<parameter name="filePath">c:\Users\KONG\OneDrive\Desktop\backend\DATABASE_SCHEMA.md