# ALTUVERA TRAVEL - ADMIN PANEL IMPLEMENTATION GUIDE

**Practical guide for building the admin panel with complete database schemas and API endpoints.**

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture & Stack](#architecture--stack)
3. [Authentication & Authorization](#authentication--authorization)
4. [Database Schema - Complete Reference](#database-schema---complete-reference)
5. [API Routes - Complete Reference](#api-routes---complete-reference)
6. [Admin Modules](#admin-modules)
7. [Integration Guidelines](#integration-guidelines)
8. [Security Checklist](#security-checklist)
9. [Development & Deployment](#development--deployment)
10. [Troubleshooting](#troubleshooting)

---

## 🚀 Quick Start

```bash
# 1. Setup backend
npm install
cp .env.example .env

# 2. Configure environment
NODE_ENV=development
DATABASE_URL=postgresql://user:pass@localhost:5432/altuvera
JWT_SECRET=<32+ char random string>

# 3. Initialize database
npm run db:reset
npm run seed

# 4. Start server
npm run dev  # http://localhost:3000
```

---

## 🏗️ Architecture & Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Runtime** | Node.js | JavaScript server runtime |
| **Framework** | Express.js 4.22+ | HTTP server & routing |
| **Database** | PostgreSQL 12+ | Data persistence |
| **Authentication** | JWT + bcryptjs | Admin login & token management |
| **File Storage** | Cloudinary 2.9+ | Image hosting & optimization |
| **Full-Text Search** | Disabled | Not required |
| **Email** | Nodemailer 8.0+ | Email notifications |
| **Real-time** | Socket.io 4.6+ | Live updates |
| **Validation** | Zod 3.24+ | Input validation |
| **Rate Limiting** | express-rate-limit 7.4+ | API protection |
| **Security** | Helmet 7.2+ | HTTP headers |
| **Logging** | Winston 3.14+ | Structured logging |

---

## 🔐 Authentication & Authorization

### Admin Login

**Endpoint**: `POST /api/adminAuth/login`

```json
// Request
{
  "email": "admin@altuvera.com",
  "password": "securePassword123"
}

// Response
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "7d",
  "admin": {
    "id": 1,
    "username": "admin",
    "email": "admin@altuvera.com",
    "fullName": "Admin User",
    "role": "admin",
    "isActive": true
  }
}
```

### Token Management

- **Access Token**: 7 days validity
- **Refresh Token**: 30 days validity
- **Storage**: httpOnly cookies or secure sessionStorage
- **Headers**: `Authorization: Bearer <token>`

### Admin Routes

```javascript
POST   /api/adminAuth/login              // Login
POST   /api/adminAuth/refresh-token      // Refresh token
GET    /api/adminAuth/me                 // Current admin
PUT    /api/adminAuth/me                 // Update profile
PUT    /api/adminAuth/change-password    // Change password
POST   /api/adminAuth/logout             // Logout
DELETE /api/adminAuth/me                 // Delete account
```

### Authorization

```javascript
// Middleware protection
router.post("/endpoint", protect, adminOnly, controller.action);

// Roles
- admin        → Full access
- moderator    → Content moderation
- editor       → Content creation
- viewer       → Read-only

// Admin table
admin_users (id, email, username, password_hash, role, is_active, last_login)
```

### Security Rules

✅ **Enforced**:
- Passwords hashed with bcryptjs (10 rounds)
- JWT signed with JWT_SECRET (32+ chars required)
- Rate limiting (5 login attempts/min, 100 requests/15min global)
- CORS restricted to allowed origins
- Helmet security headers enabled
- SQL injection prevention (parameterized queries)
- Input validation on all admin endpoints

---

---

## � Database Schema - Complete Reference

All tables, columns, types, and constraints needed for admin panel implementation.

### Core Tables

#### 1. **admin_users**
```sql
id              SERIAL PRIMARY KEY
username        VARCHAR(100) UNIQUE NOT NULL
email           VARCHAR(255) UNIQUE NOT NULL
password_hash   VARCHAR(255) NOT NULL
full_name       VARCHAR(255)
role            VARCHAR(50) DEFAULT 'admin'
avatar_url      VARCHAR(500)
is_active       BOOLEAN DEFAULT true
last_login      TIMESTAMP
created_at      TIMESTAMP DEFAULT NOW()
updated_at      TIMESTAMP DEFAULT NOW()
```

#### 2. **countries**
```sql
id                 SERIAL PRIMARY KEY
slug               VARCHAR(255) UNIQUE NOT NULL
name               VARCHAR(255) NOT NULL
official_name      VARCHAR(255)
capital            VARCHAR(255)
flag               VARCHAR(10)
flag_url           VARCHAR(500)
continent          VARCHAR(100)
region             VARCHAR(100)
sub_region         VARCHAR(100)
population         BIGINT
area               DECIMAL(12, 2)
timezone           VARCHAR(100)
calling_code       VARCHAR(10)
currency           VARCHAR(100)
currency_symbol    VARCHAR(10)
climate            TEXT
best_time_to_visit VARCHAR(255)
visa_info          TEXT
health_info        TEXT
languages          TEXT[] 
official_languages TEXT[]
highlights         TEXT[]
experiences        TEXT[]
travel_tips        TEXT[]
wildlife           JSONB DEFAULT '{}'
cuisine            JSONB DEFAULT '{}'
image_url          VARCHAR(500)
cover_image_url    VARCHAR(500)
latitude           DECIMAL(10, 8)
longitude          DECIMAL(11, 8)
is_featured        BOOLEAN DEFAULT false
is_active          BOOLEAN DEFAULT true
view_count         INTEGER DEFAULT 0
created_at         TIMESTAMP DEFAULT NOW()
updated_at         TIMESTAMP DEFAULT NOW()

INDEXES:
- idx_countries_slug
- idx_countries_featured
- idx_countries_continent
```

#### 3. **destinations**
```sql
id                      SERIAL PRIMARY KEY
country_id              INTEGER NOT NULL REFERENCES countries(id)
name                    VARCHAR(255) NOT NULL
slug                    VARCHAR(255) UNIQUE NOT NULL
tagline                 TEXT
description             TEXT
highlights              TEXT[]
activities              TEXT[]
wildlife                TEXT[]
best_time_to_visit      VARCHAR(255)
category                VARCHAR(100)
difficulty              VARCHAR(50)
destination_type        VARCHAR(50)
region                  VARCHAR(100)
nearest_city            VARCHAR(255)
nearest_airport         VARCHAR(255)
accommodation_types     TEXT[]
restaurants_types       TEXT[]
address                 TEXT
latitude                DECIMAL(10, 8)
longitude               DECIMAL(11, 8)
altitude_meters         INTEGER
image_url               VARCHAR(500)
cover_image_url         VARCHAR(500)
hero_image              VARCHAR(500)
image_urls              TEXT[]
video_url               VARCHAR(500)
virtual_tour_url        VARCHAR(500)
duration_days           INTEGER
min_group_size          INTEGER DEFAULT 1
max_group_size          INTEGER
min_age                 INTEGER
fitness_level           VARCHAR(50)
rating                  DECIMAL(3, 2) DEFAULT 0
review_count            INTEGER DEFAULT 0
view_count              INTEGER DEFAULT 0
booking_count           INTEGER DEFAULT 0
status                  VARCHAR(50) DEFAULT 'draft'
is_featured             BOOLEAN DEFAULT false
is_popular              BOOLEAN DEFAULT false
is_eco_friendly         BOOLEAN DEFAULT false
is_family_friendly      BOOLEAN DEFAULT false
is_active               BOOLEAN DEFAULT true
meta_title              VARCHAR(255)
meta_description        TEXT
published_at            TIMESTAMP
created_at              TIMESTAMP DEFAULT NOW()
updated_at              TIMESTAMP DEFAULT NOW()

INDEXES:
- idx_destinations_slug
- idx_destinations_country_id
- idx_destinations_status
- idx_destinations_featured
- idx_destinations_coords
```

#### 4. **users**
```sql
id                  SERIAL PRIMARY KEY
email               VARCHAR(255) UNIQUE NOT NULL
password_hash       VARCHAR(255)
full_name           VARCHAR(255)
avatar_url          VARCHAR(500)
phone               VARCHAR(50)
nationality         VARCHAR(100)
google_id           VARCHAR(255) UNIQUE
github_id           VARCHAR(255) UNIQUE
auth_provider       VARCHAR(50) DEFAULT 'email'
is_verified         BOOLEAN DEFAULT false
is_active           BOOLEAN DEFAULT true
verification_token  VARCHAR(255)
reset_token         VARCHAR(255)
reset_token_expires TIMESTAMP
preferences         JSONB DEFAULT '{}'
last_login          TIMESTAMP
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

INDEXES:
- idx_users_email
- idx_users_google
- idx_users_github
```

#### 5. **bookings**
```sql
id                  SERIAL PRIMARY KEY
booking_number      VARCHAR(50) UNIQUE NOT NULL
destination_id      INTEGER REFERENCES destinations(id)
service_id          INTEGER REFERENCES services(id)
full_name           VARCHAR(255) NOT NULL
email               VARCHAR(255) NOT NULL
phone               VARCHAR(50)
whatsapp            VARCHAR(50)
nationality         VARCHAR(100)
travel_date         DATE
return_date         DATE
number_of_travelers INTEGER DEFAULT 1
accommodation_type  VARCHAR(100)
special_requests    TEXT
status              VARCHAR(50) DEFAULT 'pending'
admin_notes         TEXT
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

STATUS: pending, confirmed, completed, cancelled

INDEXES:
- idx_bookings_number
- idx_bookings_status
- idx_bookings_email
```

#### 6. **posts** (Blog)
```sql
id                  SERIAL PRIMARY KEY
title               VARCHAR(255) NOT NULL
slug                VARCHAR(255) UNIQUE NOT NULL
content             TEXT
excerpt             TEXT
image_url           VARCHAR(500)
cover_image_url     VARCHAR(500)
author_name         VARCHAR(255)
author_avatar       VARCHAR(500)
category            VARCHAR(100)
tags                TEXT[]
is_published        BOOLEAN DEFAULT false
is_featured         BOOLEAN DEFAULT false
view_count          INTEGER DEFAULT 0
read_time           INTEGER DEFAULT 0
meta_title          VARCHAR(255)
meta_description    TEXT
published_at        TIMESTAMP
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

INDEXES:
- idx_posts_slug
- idx_posts_published
- idx_posts_category
```

#### 7. **faqs**
```sql
id          SERIAL PRIMARY KEY
question    TEXT NOT NULL
answer      TEXT NOT NULL
category    VARCHAR(100)
sort_order  INTEGER DEFAULT 0
is_active   BOOLEAN DEFAULT true
created_at  TIMESTAMP DEFAULT NOW()
updated_at  TIMESTAMP DEFAULT NOW()

INDEXES:
- idx_faqs_category
```

#### 8. **tips**
```sql
id                  SERIAL PRIMARY KEY
slug                VARCHAR(255) UNIQUE NOT NULL
summary             TEXT NOT NULL
body                TEXT
category            VARCHAR(100)
trip_phase          VARCHAR(80)
audience            VARCHAR(80) DEFAULT 'all-travelers'
difficulty_level    VARCHAR(40) DEFAULT 'all-levels'
priority_level      SMALLINT DEFAULT 3
read_time_minutes   SMALLINT DEFAULT 3
checklist           TEXT[]
tags                TEXT[]
icon                VARCHAR(100)
image_url           VARCHAR(500)
sort_order          INTEGER DEFAULT 0
is_featured         BOOLEAN DEFAULT false
is_active           BOOLEAN DEFAULT true
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

INDEXES:
- idx_tips_slug
- idx_tips_category
- idx_tips_featured
```

#### 9. **services**
```sql
id                  SERIAL PRIMARY KEY
title               VARCHAR(255) NOT NULL
slug                VARCHAR(255) UNIQUE NOT NULL
description         TEXT
short_description   TEXT
icon                VARCHAR(100)
image_url           VARCHAR(500)
features            TEXT[]
is_featured         BOOLEAN DEFAULT false
sort_order          INTEGER DEFAULT 0
is_active           BOOLEAN DEFAULT true
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

#### 10. **team_members**
```sql
id                  SERIAL PRIMARY KEY
name                VARCHAR(255) NOT NULL
slug                VARCHAR(255) UNIQUE
role                VARCHAR(255)
department          VARCHAR(100)
bio                 TEXT
image_url           VARCHAR(500)
image_public_id     VARCHAR(255)
email               VARCHAR(255) UNIQUE
phone               VARCHAR(50)
whatsapp            VARCHAR(50)
linkedin_url        VARCHAR(255)
twitter_url         VARCHAR(255)
instagram_url       VARCHAR(255)
website_url         VARCHAR(255)
expertise           JSONB DEFAULT '[]'
languages           JSONB DEFAULT '[]'
certifications      JSONB DEFAULT '[]'
years_experience    INTEGER DEFAULT 0
location            VARCHAR(200)
country             VARCHAR(100)
display_order       INTEGER DEFAULT 0
is_featured         BOOLEAN DEFAULT false
is_active           BOOLEAN DEFAULT true
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

#### 11. **testimonials**
```sql
id              SERIAL PRIMARY KEY
user_id         INTEGER REFERENCES users(id)
content         TEXT NOT NULL
author_name     VARCHAR(255)
author_location VARCHAR(255)
author_avatar   VARCHAR(500)
rating          DECIMAL(3, 2)
is_featured     BOOLEAN DEFAULT false
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMP DEFAULT NOW()
updated_at      TIMESTAMP DEFAULT NOW()
```

#### 12. **gallery**
```sql
id              SERIAL PRIMARY KEY
title           VARCHAR(255)
description     TEXT
image_url       VARCHAR(500) NOT NULL
thumbnail_url   VARCHAR(500)
category        VARCHAR(100)
location        VARCHAR(255)
country_id      INTEGER REFERENCES countries(id)
destination_id  INTEGER REFERENCES destinations(id)
photographer    VARCHAR(255)
sort_order      INTEGER DEFAULT 0
is_featured     BOOLEAN DEFAULT false
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMP DEFAULT NOW()

INDEXES:
- idx_gallery_category
```

#### 13. **contact_messages**
```sql
id                  SERIAL PRIMARY KEY
full_name           VARCHAR(255) NOT NULL
email               VARCHAR(255) NOT NULL
phone               VARCHAR(50)
whatsapp            VARCHAR(50)
subject             VARCHAR(255)
message             TEXT NOT NULL
trip_type           VARCHAR(100)
travel_date         DATE
number_of_travelers INTEGER
status              VARCHAR(20) DEFAULT 'new'
priority            VARCHAR(20) DEFAULT 'normal'
assigned_to         INTEGER REFERENCES admin_users(id)
assigned_at         TIMESTAMP
responded_at        TIMESTAMP
response_notes      TEXT
tags                TEXT[]
is_read             BOOLEAN DEFAULT false
is_starred          BOOLEAN DEFAULT false
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

STATUS: new, read, replied, archived, spam
PRIORITY: low, normal, high, urgent

INDEXES:
- idx_contact_read
- idx_contact_priority
```

#### 14. **subscribers**
```sql
id              SERIAL PRIMARY KEY
email           VARCHAR(255) UNIQUE NOT NULL
is_active       BOOLEAN DEFAULT true
subscribed_at   TIMESTAMP DEFAULT NOW()
unsubscribed_at TIMESTAMP
```

#### 15. **pages**
```sql
id               SERIAL PRIMARY KEY
title            VARCHAR(255) NOT NULL
slug             VARCHAR(255) UNIQUE NOT NULL
content          TEXT
meta_title       VARCHAR(255)
meta_description TEXT
is_published     BOOLEAN DEFAULT true
created_at       TIMESTAMP DEFAULT NOW()
updated_at       TIMESTAMP DEFAULT NOW()
```

#### 16. **destination_images**
```sql
id              SERIAL PRIMARY KEY
destination_id  INTEGER REFERENCES destinations(id) ON DELETE CASCADE
image_url       VARCHAR(500) NOT NULL
thumbnail_url   VARCHAR(500)
caption         VARCHAR(255)
is_primary      BOOLEAN DEFAULT false
sort_order      INTEGER DEFAULT 0
created_at      TIMESTAMP DEFAULT NOW()
```

#### 17. **destination_itineraries**
```sql
id              SERIAL PRIMARY KEY
destination_id  INTEGER REFERENCES destinations(id) ON DELETE CASCADE
day_number      INTEGER NOT NULL
title           VARCHAR(255) NOT NULL
description     TEXT
activities      TEXT[]
meals           TEXT[]
accommodation   VARCHAR(255)
image_url       VARCHAR(500)
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMP DEFAULT NOW()
```

#### 18. **destination_faqs**
```sql
id              SERIAL PRIMARY KEY
destination_id  INTEGER REFERENCES destinations(id) ON DELETE CASCADE
question        TEXT NOT NULL
answer          TEXT NOT NULL
category        VARCHAR(100)
sort_order      INTEGER DEFAULT 0
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMP DEFAULT NOW()
```

#### 19. **destination_reviews**
```sql
id              SERIAL PRIMARY KEY
destination_id  INTEGER REFERENCES destinations(id) ON DELETE CASCADE
reviewer_name   VARCHAR(255) NOT NULL
reviewer_country VARCHAR(100)
reviewer_avatar VARCHAR(500)
title           VARCHAR(255)
content         TEXT NOT NULL
overall_rating  DECIMAL(3, 2) NOT NULL
trip_date       DATE
trip_type       VARCHAR(50)
images          TEXT[]
is_verified     BOOLEAN DEFAULT false
is_featured     BOOLEAN DEFAULT false
helpful_count   INTEGER DEFAULT 0
status          VARCHAR(20) DEFAULT 'pending'
created_at      TIMESTAMP DEFAULT NOW()

STATUS: pending, approved, rejected
```

#### 20. **country_airports**
```sql
id              SERIAL PRIMARY KEY
country_id      INTEGER REFERENCES countries(id) ON DELETE CASCADE
name            VARCHAR(255) NOT NULL
code            VARCHAR(10)
location        VARCHAR(255)
airport_type    VARCHAR(50) DEFAULT 'international'
description     TEXT
is_main_international BOOLEAN DEFAULT false
display_order   INTEGER DEFAULT 0
created_at      TIMESTAMP DEFAULT NOW()
```

#### 21. **country_festivals**
```sql
id              SERIAL PRIMARY KEY
country_id      INTEGER REFERENCES countries(id) ON DELETE CASCADE
name            VARCHAR(255) NOT NULL
period          VARCHAR(100)
month           VARCHAR(50)
description     TEXT
is_major_event  BOOLEAN DEFAULT false
image_url       VARCHAR(500)
display_order   INTEGER DEFAULT 0
created_at      TIMESTAMP DEFAULT NOW()
```

#### 22. **site_settings**
```sql
id         SERIAL PRIMARY KEY
key        VARCHAR(100) UNIQUE NOT NULL
value      TEXT
updated_at TIMESTAMP DEFAULT NOW()
```

---

---

## 🔌 API Routes - Complete Reference

### Admin Auth Routes

```javascript
POST   /api/adminAuth/login              // Login with email & password
POST   /api/adminAuth/refresh-token      // Get new access token
GET    /api/adminAuth/me                 // Get current admin profile
PUT    /api/adminAuth/me                 // Update profile
PUT    /api/adminAuth/change-password    // Change password
POST   /api/adminAuth/logout             // Logout
DELETE /api/adminAuth/me                 // Delete account
POST   /api/adminAuth/register           // Register new admin (protected)
```

### Countries Routes (Admin)

```javascript
// PUBLIC
GET    /api/countries                    // List all countries (paginated)
GET    /api/countries/featured           // Get featured countries
GET    /api/countries/search             // Search countries
GET    /api/countries/continents         // Get continents list
GET    /api/countries/continent/:continent // Get by continent
GET    /api/countries/stats              // Get statistics
GET    /api/countries/:idOrSlug          // Get single country
GET    /api/countries/:idOrSlug/destinations // Get country's destinations

// ADMIN
POST   /api/countries                    // Create country
PUT    /api/countries/:id                // Update country
DELETE /api/countries/:id                // Delete country

// Airports
POST   /api/countries/:id/airports       // Add airport
DELETE /api/countries/:id/airports/:airportId // Remove airport

// Festivals
POST   /api/countries/:id/festivals      // Add festival
DELETE /api/countries/:id/festivals/:festivalId // Remove festival

// UNESCO Sites
POST   /api/countries/:id/unesco-sites   // Add UNESCO site
DELETE /api/countries/:id/unesco-sites/:siteId // Remove UNESCO site

// Historical Events
POST   /api/countries/:id/historical-events // Add historical event
DELETE /api/countries/:id/historical-events/:eventId // Remove event
```

**Query Parameters**:
```javascript
// List all
?page=1&limit=20&sortBy=name&order=asc&search=query

// Filters
?continent=Africa&region=East Africa&featured=true&active=true
```

### Destinations Routes (Admin)

```javascript
// PUBLIC
GET    /api/destinations                 // List all (paginated)
GET    /api/destinations/featured        // Get featured
GET    /api/destinations/popular         // Get popular
GET    /api/destinations/new             // Get new
GET    /api/destinations/search          // Search destinations
GET    /api/destinations/categories      // Get categories
GET    /api/destinations/difficulties    // Get difficulty levels
GET    /api/destinations/stats           // Get stats
GET    /api/destinations/map             // Get map data
GET    /api/destinations/country/:countrySlug // By country
GET    /api/destinations/:idOrSlug       // Get single
GET    /api/destinations/:idOrSlug/related // Related destinations
GET    /api/destinations/:id/reviews     // Get reviews
GET    /api/destinations/:id/images      // Get images
GET    /api/destinations/:id/itinerary   // Get itinerary
GET    /api/destinations/:id/faqs        // Get FAQs
GET    /api/destinations/:id/tags        // Get tags
POST   /api/destinations/:id/view        // Increment view count
POST   /api/destinations/:id/wishlist    // Add to wishlist
POST   /api/destinations/:id/share       // Share

// ADMIN - CRUD
POST   /api/destinations                 // Create destination
PUT    /api/destinations/:id             // Update destination
DELETE /api/destinations/:id             // Delete destination
POST   /api/destinations/:id/restore     // Restore deleted
PATCH  /api/destinations/bulk            // Bulk update

// Images
POST   /api/destinations/:id/images      // Add images
PUT    /api/destinations/:id/images/:imageId // Update image
DELETE /api/destinations/:id/images/:imageId // Remove image
PUT    /api/destinations/:id/images/reorder  // Reorder images

// Itinerary
POST   /api/destinations/:id/itinerary   // Add itinerary day
PUT    /api/destinations/:id/itinerary/:dayId // Update day
DELETE /api/destinations/:id/itinerary/:dayId // Remove day

// FAQs
POST   /api/destinations/:id/faqs        // Add FAQ
PUT    /api/destinations/:id/faqs/:faqId // Update FAQ
DELETE /api/destinations/:id/faqs/:faqId // Remove FAQ

// Tags
POST   /api/destinations/:id/tags        // Add tag
DELETE /api/destinations/:id/tags/:tagId // Remove tag
```

**Query Parameters**:
```javascript
?page=1&limit=20&category=wildlife&difficulty=moderate&country=rwanda
?featured=true&status=published&sortBy=viewCount&order=desc
```

### Bookings Routes (Admin)

```javascript
// PUBLIC
POST   /api/bookings                     // Create booking
GET    /api/bookings/track/:bookingNumber // Track booking
GET    /api/bookings/most-booked         // Most booked destinations
GET    /api/bookings/by-destination/:destinationId // Stats by destination
GET    /api/bookings/by-country/:countryId // Stats by country

// AUTHENTICATED
GET    /api/bookings/my-bookings         // User's bookings

// ADMIN
GET    /api/bookings                     // List all bookings
GET    /api/bookings/:id                 // Get booking details
PUT    /api/bookings/:id                 // Update booking
DELETE /api/bookings/:id                 // Delete booking
PATCH  /api/bookings/:id/status          // Update status
POST   /api/bookings/:id/confirm         // Confirm booking
POST   /api/bookings/:id/cancel          // Cancel booking
POST   /api/bookings/:id/notes           // Add notes
GET    /api/bookings/stats               // Get statistics
GET    /api/bookings/upcoming            // Get upcoming bookings
GET    /api/bookings/recent              // Get recent bookings
GET    /api/bookings/export              // Export bookings
POST   /api/bookings/bulk-status         // Bulk update status
```

**Query Parameters**:
```javascript
?page=1&limit=20&status=pending&sortBy=createdAt
?startDate=2024-01-01&endDate=2024-12-31&destination=42
?email=user@example.com
```

### Users Routes (Admin)

```javascript
// ADMIN
GET    /api/users                        // List all users
GET    /api/users/:id                    // Get user details
PUT    /api/users/:id                    // Update user
POST   /api/users/:id/deactivate         // Deactivate user
POST   /api/users/:id/activate           // Activate user
GET    /api/users/:id/bookings           // Get user's bookings
GET    /api/users/:id/reviews            // Get user's reviews
DELETE /api/users/:id                    // Delete user
GET    /api/users/export                 // Export users
```

**Query Parameters**:
```javascript
?page=1&limit=20&status=active&verified=true
?sortBy=createdAt&order=desc&search=email
```

### Posts (Blog) Routes (Admin)

```javascript
// PUBLIC
GET    /api/posts                        // List published posts
GET    /api/posts/:id                    // Get post
GET    /api/posts/:slug                  // Get by slug

// ADMIN
POST   /api/posts                        // Create post
PUT    /api/posts/:id                    // Update post
DELETE /api/posts/:id                    // Delete post
POST   /api/posts/:id/publish            // Publish post
POST   /api/posts/:id/unpublish          // Unpublish post
```

**Query Parameters**:
```javascript
?page=1&limit=20&published=true&category=travel&sortBy=publishedAt
```

### FAQs Routes (Admin)

```javascript
// PUBLIC
GET    /api/faqs                         // List active FAQs
GET    /api/faqs/:id                     // Get FAQ

// ADMIN
POST   /api/faqs                         // Create FAQ
PUT    /api/faqs/:id                     // Update FAQ
DELETE /api/faqs/:id                     // Delete FAQ
POST   /api/faqs/:id/toggle              // Toggle visibility
```

**Query Parameters**:
```javascript
?page=1&limit=50&category=general&active=true&sortBy=sortOrder
```

### Tips Routes (Admin)

```javascript
// PUBLIC
GET    /api/tips                         // List tips
GET    /api/tips/:id                     // Get tip
GET    /api/tips/:slug                   // Get by slug

// ADMIN
POST   /api/tips                         // Create tip
PUT    /api/tips/:id                     // Update tip
DELETE /api/tips/:id                     // Delete tip
```

**Query Parameters**:
```javascript
?page=1&limit=20&category=packing&tripPhase=before&featured=true
```

### Services Routes (Admin)

```javascript
// PUBLIC
GET    /api/services                     // List services
GET    /api/services/:id                 // Get service

// ADMIN
POST   /api/services                     // Create service
PUT    /api/services/:id                 // Update service
DELETE /api/services/:id                 // Delete service
```

### Team Routes (Admin)

```javascript
// PUBLIC
GET    /api/team                         // List team members
GET    /api/team/:id                     // Get member
GET    /api/team/:slug                   // Get by slug

// ADMIN
POST   /api/team                         // Add team member
PUT    /api/team/:id                     // Update member
DELETE /api/team/:id                     // Remove member
```

### Testimonials Routes (Admin)

```javascript
// PUBLIC
GET    /api/testimonials                 // List testimonials
GET    /api/testimonials/:id             // Get testimonial

// ADMIN
POST   /api/testimonials                 // Create testimonial
PUT    /api/testimonials/:id             // Update testimonial
DELETE /api/testimonials/:id             // Delete testimonial
POST   /api/testimonials/:id/feature     // Feature testimonial
```

### Gallery Routes (Admin)

```javascript
// PUBLIC
GET    /api/gallery                      // List gallery items
GET    /api/gallery/:id                  // Get item

// ADMIN
POST   /api/gallery                      // Add to gallery
PUT    /api/gallery/:id                  // Update gallery item
DELETE /api/gallery/:id                  // Delete item
```

**Query Parameters**:
```javascript
?page=1&limit=20&category=destinations&country=2&featured=true
```

### Contact/Messages Routes (Admin)

```javascript
// PUBLIC
POST   /api/contact                      // Submit contact form

// ADMIN
GET    /api/contact                      // List submissions
GET    /api/contact/:id                  // View submission
DELETE /api/contact/:id                  // Archive submission
PUT    /api/contact/:id                  // Update status
```

**Query Parameters**:
```javascript
?page=1&status=new&priority=high&assigned=true&sortBy=createdAt
```

### Subscribers Routes (Admin)

```javascript
// PUBLIC
POST   /api/subscribers                  // Subscribe to newsletter

// ADMIN
GET    /api/subscribers                  // List subscribers
DELETE /api/subscribers/:id              // Unsubscribe
POST   /api/subscribers/email            // Send newsletter
```

### Pages Routes (Admin)

```javascript
// PUBLIC
GET    /api/pages/:slug                  // Get page

// ADMIN
GET    /api/pages                        // List pages
POST   /api/pages                        // Create page
PUT    /api/pages/:id                    // Update page
DELETE /api/pages/:id                    // Delete page
```

### Settings Routes (Admin)

```javascript
// ADMIN
GET    /api/settings                     // Get all settings
PUT    /api/settings                     // Update settings
POST   /api/settings/email-test          // Test email
```

### Response Format (All Routes)

```json
// Success (200)
{
  "success": true,
  "data": { /* response data */ },
  "message": "Operation successful",
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5,
    "hasMore": true
  }
}

// Error (4xx, 5xx)
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "statusCode": 400
}
```

### Rate Limits

```
Global API:         100 requests / 15 minutes
Login:              5 attempts / 1 minute
Bookings:          10 requests / 15 minutes
Search:            20 requests / 1 minute
File uploads:      10 uploads / 1 hour
Admin routes:      30 requests / 1 minute
```

---

---

## 📊 Admin Modules

**11 Core Modules to Build:**

1. **Dashboard** - Key metrics, recent activity
2. **Countries** - Create, edit, manage countries with airports, festivals, UNESCO sites
3. **Destinations** - Full CRUD, images, itineraries, FAQs, reviews, tags
4. **Users** - User management, activate/deactivate, view history
5. **Bookings** - View, filter, update status, export, confirm/cancel
6. **Blog Posts** - Create, edit, publish/unpublish, categorize
7. **FAQs** - Create, organize by category, reorder
8. **Tips** - Create, categorize by trip phase and audience
9. **Team & Testimonials** - Manage team members and customer testimonials
10. **Gallery** - Upload, organize, and manage images
11. **Contact & Settings** - View messages, manage subscribers, configure site settings

---

## 🔗 Integration Guidelines

### React Frontend Example

```javascript
// 1. API Client Setup
import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000/api',
  timeout: 10000,
});

// Auto-add token to all requests
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('adminToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 (token expired)
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const { data } = await axios.post(
            `${apiClient.defaults.baseURL}/adminAuth/refresh-token`,
            { refreshToken }
          );
          localStorage.setItem('adminToken', data.token);
          return apiClient(error.config);
        } catch {
          localStorage.removeItem('adminToken');
          window.location.href = '/admin/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

```javascript
// 2. Login Hook
import { useState } from 'react';
import apiClient from '../utils/apiClient';

export function useLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const login = async (email, password) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await apiClient.post('/adminAuth/login', {
        email,
        password,
      });
      localStorage.setItem('adminToken', data.token);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('admin', JSON.stringify(data.admin));
      return data;
    } catch (err) {
      const msg = err.response?.data?.error || 'Login failed';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  };

  return { login, loading, error };
}
```

```javascript
// 3. Countries CRUD Hook
import { useState, useEffect } from 'react';
import apiClient from '../utils/apiClient';

export function useCountries() {
  const [countries, setCountries] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchAll = async (page = 1) => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/countries', {
        params: { page, limit: 20 },
      });
      setCountries(data.data);
    } finally {
      setLoading(false);
    }
  };

  const create = async (countryData) => {
    const { data } = await apiClient.post('/countries', countryData);
    setCountries([data.data, ...countries]);
    return data.data;
  };

  const update = async (id, countryData) => {
    const { data } = await apiClient.put(`/countries/${id}`, countryData);
    setCountries(countries.map(c => c.id === id ? data.data : c));
    return data.data;
  };

  const remove = async (id) => {
    await apiClient.delete(`/countries/${id}`);
    setCountries(countries.filter(c => c.id !== id));
  };

  useEffect(() => {
    fetchAll();
  }, []);

  return { countries, loading, fetchAll, create, update, remove };
}
```

### Environment Variables

```bash
# .env
REACT_APP_API_URL=http://localhost:3000/api
REACT_APP_CLOUDINARY_NAME=your_cloud_name
```

---

## 🛡️ Security Checklist

**Before going to production:**

- [ ] JWT_SECRET is 32+ characters (production value)
- [ ] JWT_REFRESH_SECRET is 32+ characters (production value)
- [ ] HTTPS enforced on all admin routes
- [ ] CORS_ORIGINS updated with production domain
- [ ] Rate limiting enabled and configured
- [ ] Helmet security headers enabled
- [ ] All admin endpoints require `protect` and `adminOnly` middleware
- [ ] Passwords hashed with bcryptjs (10+ rounds)
- [ ] Parameterized queries for all database operations
- [ ] Input validation on all admin endpoints
- [ ] Audit logging enabled for admin actions
- [ ] File uploads have size limit (50MB) and type restrictions
- [ ] Refresh token rotation implemented
- [ ] Sessions have expiration time
- [ ] Database backups scheduled
- [ ] Error logging configured (Winston)

**Implementation**:
```javascript
// Always protect admin routes
router.post('/create', 
  protect,           // Verify JWT token
  adminOnly,         // Verify admin role
  asyncHandler(ctrl.create)  // Handle errors
);
```

---

## 💻 Development & Deployment

### Local Development

```bash
# Install & setup
npm install
cp .env.example .env

# Edit .env with dev values
NODE_ENV=development
DATABASE_URL=postgresql://user:pass@localhost:5432/altuvera_dev
JWT_SECRET=dev-secret-key-min-32-characters-long

# Initialize
npm run db:reset
npm run seed

# Start
npm run dev

# Frontend (separate terminal)
cd ../frontend
npm install
npm run dev
```

### Database Management

```bash
npm run migrate          # Run migrations
npm run rollback         # Undo last migration
npm run seed             # Seed sample data
npm run db:reset         # Reset everything
npm run db:grant         # Grant privileges
```

### Production Deployment

```bash
# Environment
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@prod-host:5432/altuvera_prod
JWT_SECRET=prod-secret-32-chars-min

# Start with PM2
pm2 start server.js --name "altuvera-backend"
pm2 save
pm2 startup

# Or Docker
docker build -t altuvera-backend .
docker run -d -p 3000:3000 --env-file .env altuvera-backend

# Or systemd
sudo systemctl start altuvera-backend
sudo systemctl enable altuvera-backend
```

### Useful Commands

```bash
npm run dev              # Dev server
npm run start:prod       # Production server
npm test                 # Run tests
npm run test:watch      # Watch tests
npm run lint            # Lint code
```

---

## 🐛 Troubleshooting

### Token Errors

**Problem**: "Invalid token" or "Token expired"

**Solutions**:
1. Verify JWT_SECRET matches on login and protected routes
2. Check token expiry settings (7d access, 30d refresh)
3. Ensure refresh token is being used
4. Clear localStorage and login again

### CORS Errors

**Problem**: "CORS policy blocked"

**Solutions**:
1. Add frontend URL to ALLOWED_ORIGINS
2. Verify credentials flag in CORS config
3. Check Authorization header is allowed
4. Restart backend

### Database Connection

**Problem**: "Cannot connect to database"

**Solutions**:
1. Verify PostgreSQL is running: `sudo systemctl status postgresql`
2. Check DATABASE_URL format
3. Verify credentials: `psql -U user -h host -d dbname`
4. Check port 5432 is open

### Image Upload Issues

**Problem**: "Upload failed" or "File too large"

**Solutions**:
1. Check file size (max 50MB)
2. Verify Cloudinary credentials in .env
3. Check file format (JPG, PNG, GIF, WebP only)
4. Test Cloudinary connection

### Email Not Sending

**Problem**: "Email failed to send"

**Solutions**:
1. Verify SMTP credentials
2. For Gmail: use App Password, not account password
3. Check SUPPORT_EMAIL is set
4. Test with `npm run test:email`

---

## 📝 Summary

**What to Build:**

✅ 11 Admin Modules with complete CRUD operations  
✅ 50+ API Endpoints with all parameters documented  
✅ Complete database schema with all tables and columns  
✅ JWT authentication with token refresh  
✅ Role-based access control  
✅ Rate limiting and security headers  
✅ Audit logging for all admin actions  
✅ Image upload with Cloudinary  
✅ Email notifications with Nodemailer  

**Use this guide as your blueprint for implementation.**

---

**Status**: Production Ready ✅  
**Last Updated**: May 11, 2026  
**Backend Version**: 6.2
