# Admin Panel Backend API Documentation

This comprehensive document describes the complete admin backend API surface for the Altuvera Travel admin panel. It covers admin authentication, comprehensive CRUD operations for all resources, advanced statistics and analytics endpoints, and detailed payload specifications.

> **Important Notes:**
> - All admin routes require authenticated admin session with `Authorization: Bearer <token>` header
> - Most routes use standard JSON request bodies
> - File uploads use `multipart/form-data` with appropriate field names
> - Admin routes are protected by `protect` and `adminOnly` middleware
> - All responses follow the format: `{ success: boolean, data: {...}, message?: string }`

---

## Table of Contents

1. [Authentication](#authentication)
2. [Dashboard & Analytics](#dashboard--analytics)
3. [Bookings Management](#bookings-management)
4. [Contact/Message Management](#contactmessage-management)
5. [Countries Management](#countries-management)
6. [Destinations Management](#destinations-management)
7. [Posts Management](#posts-management)
8. [Pages Management](#pages-management)
9. [Services Management](#services-management)
10. [FAQs Management](#faqs-management)
11. [Gallery Management](#gallery-management)
12. [Team Management](#team-management)
13. [Subscribers Management](#subscribers-management)
14. [Virtual Tours Management](#virtual-tours-management)
15. [Tips Management](#tips-management)
16. [Uploads Management](#uploads-management)
17. [Settings Management](#settings-management)
18. [Content Moderation](#content-moderation)
19. [User Management](#user-management)

---

## Authentication

**Base path:** `/api/admin/auth`

### Endpoints

#### `POST /api/admin/auth/login`
- **Description:** Authenticate admin user and receive JWT tokens
- **Body:** `{ email: string, password: string }`
- **Response:** `{ success: boolean, data: { token: string, refreshToken: string, user: object } }`
- **Notes:** No auth header required

#### `POST /api/admin/auth/refresh-token`
- **Description:** Refresh expired access token
- **Body:** `{ refreshToken: string }`
- **Response:** `{ success: boolean, data: { token: string, refreshToken: string } }`

#### `POST /api/admin/auth/register`
- **Description:** Create new admin account
- **Auth:** Admin required
- **Body:** `{ email: string, username: string, password: string, full_name: string, role: string }`
- **Response:** `{ success: boolean, data: admin_object }`

#### `GET /api/admin/auth/me`
- **Description:** Get current admin profile
- **Auth:** Admin required
- **Response:** Current admin user object

#### `PUT /api/admin/auth/me` | `PUT /api/admin/auth/profile`
- **Description:** Update current admin profile
- **Auth:** Admin required
- **Body:** `{ full_name?: string, avatar_url?: string, phone?: string, bio?: string, preferences?: object }`
- **Response:** Updated admin object

#### `PUT /api/admin/auth/change-password`
- **Description:** Change admin password
- **Auth:** Admin required
- **Body:** `{ currentPassword: string, newPassword: string }`
- **Response:** `{ success: boolean, message: string }`

#### `POST /api/admin/auth/logout`
- **Description:** Logout current admin session
- **Auth:** Admin required
- **Response:** `{ success: boolean, message: string }`

#### `DELETE /api/admin/auth/me`
- **Description:** Delete current admin account
- **Auth:** Admin required
- **Response:** `{ success: boolean, message: string }`

---

## Dashboard & Analytics

**Base path:** `/api/admin/dashboard` (Note: Some stats are distributed across resource endpoints)

### Dashboard Overview Stats

#### `GET /api/admin/dashboard/overview`
- **Description:** Complete dashboard statistics overview
- **Auth:** Admin required
- **Query params:** `{ period?: '7days' | '30days' | '90days' | '12months' }`
- **Response:** Comprehensive dashboard data including:
  ```json
  {
    "bookings": {
      "total": 1250,
      "confirmed": 980,
      "pending": 150,
      "cancelled": 120,
      "revenue": 450000,
      "avg_booking_value": 360,
      "conversion_rate": 78.4
    },
    "destinations": {
      "total": 85,
      "published": 72,
      "featured": 15,
      "popular": 28
    },
    "countries": {
      "total": 45,
      "featured": 12,
      "with_destinations": 38
    },
    "users": {
      "total": 3200,
      "active_last_30d": 1850,
      "new_last_30d": 245
    },
    "content": {
      "posts": 156,
      "pages": 23,
      "gallery_images": 450,
      "virtual_tours": 12
    },
    "engagement": {
      "total_views": 125000,
      "total_reviews": 890,
      "avg_rating": 4.6
    }
  }
  ```

### Advanced Analytics Endpoints

#### `GET /api/admin/analytics/revenue`
- **Description:** Revenue analytics and trends
- **Auth:** Admin required
- **Query params:** `{ period: string, group_by: 'day' | 'week' | 'month' }`
- **Response:** Revenue data with trends, projections, and breakdowns

#### `GET /api/admin/analytics/geographic`
- **Description:** Geographic distribution of bookings and users
- **Auth:** Admin required
- **Query params:** `{ type: 'bookings' | 'users' | 'revenue' }`
- **Response:** Country/continent-based analytics

#### `GET /api/admin/analytics/user-engagement`
- **Description:** User engagement metrics
- **Auth:** Admin required
- **Query params:** `{ period: string }`
- **Response:** User activity, session data, conversion funnels

#### `GET /api/admin/analytics/content-performance`
- **Description:** Content performance analytics
- **Auth:** Admin required
- **Query params:** `{ content_type: 'destinations' | 'posts' | 'countries' }`
- **Response:** Views, engagement, conversion rates by content

#### `GET /api/admin/analytics/booking-trends`
- **Description:** Advanced booking trend analysis
- **Auth:** Admin required
- **Query params:** `{ period: string, metric: 'volume' | 'revenue' | 'conversion' }`
- **Response:** Trend data with seasonality analysis

#### `GET /api/admin/analytics/most-booked-destinations`
- **Description:** Top performing destinations by bookings
- **Auth:** Admin required
- **Query params:** `{ limit: number, period: string }`
- **Response:**
  ```json
  {
    "data": [
      {
        "destination_id": 1,
        "name": "Safari Adventure",
        "country": "Kenya",
        "booking_count": 145,
        "revenue": 58000,
        "avg_rating": 4.8,
        "trend": "+12%"
      }
    ]
  }
  ```

#### `GET /api/admin/analytics/popular-routes`
- **Description:** Most popular travel routes and combinations
- **Auth:** Admin required
- **Query params:** `{ limit: number }`
- **Response:** Route popularity data

#### `GET /api/admin/analytics/seasonal-trends`
- **Description:** Seasonal booking patterns and trends
- **Auth:** Admin required
- **Query params:** `{ year: number }`
- **Response:** Monthly/seasonal booking data

#### `GET /api/admin/analytics/customer-insights`
- **Description:** Customer behavior and demographic insights
- **Auth:** Admin required
- **Query params:** `{ segment: 'nationality' | 'age' | 'booking_frequency' }`
- **Response:** Customer segmentation data

#### `GET /api/admin/analytics/competitor-analysis`
- **Description:** Market position and competitor analysis
- **Auth:** Admin required
- **Response:** Comparative market data

---

## Bookings Management

**Base path:** `/api/bookings`

### Core CRUD Operations

#### `GET /api/bookings`
- **Description:** List all bookings with advanced filtering
- **Auth:** Admin required
- **Query params:**
  - Pagination: `page`, `limit`
  - Filters: `status`, `payment_status`, `booking_type`, `destination_id`, `service_id`
  - Search: `search` (searches name, email, booking number, phone)
  - Date filters: `date_from`, `date_to`, `travel_date_from`, `travel_date_to`
  - Sorting: `sort_by`, `sort_order`
- **Response:** Paginated booking list with related data

#### `GET /api/bookings/:id`
- **Description:** Get detailed booking information
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete booking object with relations

#### `PUT /api/bookings/:id`
- **Description:** Update booking details
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** Any updatable booking fields including status, notes, pricing
- **Response:** Updated booking object

#### `DELETE /api/bookings/:id`
- **Description:** Delete booking
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

### Booking Status Management

#### `PATCH /api/bookings/:id/status`
- **Description:** Update booking status
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ status: 'pending' | 'confirmed' | 'on-hold' | 'completed' | 'cancelled' | 'refunded' }`
- **Response:** Updated booking

#### `POST /api/bookings/:id/confirm`
- **Description:** Confirm booking
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Confirmation result

#### `POST /api/bookings/:id/cancel`
- **Description:** Cancel booking
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ reason?: string, refund_amount?: number }`
- **Response:** Cancellation result

### Bulk Operations

#### `POST /api/bookings/bulk-status`
- **Description:** Update status for multiple bookings
- **Auth:** Admin required
- **Body:** `{ bookingIds: number[], status: string, notes?: string }`
- **Response:** Bulk operation result

#### `DELETE /api/bookings/bulk-delete`
- **Description:** Delete multiple bookings
- **Auth:** Admin required
- **Body:** `{ ids: number[] }`
- **Response:** Bulk deletion result

### Notes & Communication

#### `POST /api/bookings/:id/notes`
- **Description:** Add admin notes to booking
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ admin_notes?: string, internal_notes?: string }`
- **Response:** Updated booking with notes

#### `GET /api/bookings/:id/notes`
- **Description:** Get booking notes history
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Notes history

### Analytics & Reporting

#### `GET /api/bookings/stats`
- **Description:** Comprehensive booking statistics
- **Auth:** Admin required
- **Query params:** `{ period?: '12months' | '6months' | '3months' }`
- **Response:**
  ```json
  {
    "overview": {
      "total_bookings": 1250,
      "confirmed": 980,
      "pending": 150,
      "completed": 890,
      "cancelled": 120,
      "revenue": 450000,
      "avg_booking_value": 360
    },
    "monthly_trends": [...],
    "top_destinations": [...],
    "by_source": [...],
    "by_nationality": [...],
    "lead_time": {...},
    "upcoming": {...},
    "conversion_rate": 78.4
  }
  ```

#### `GET /api/bookings/upcoming`
- **Description:** Upcoming bookings for dashboard
- **Auth:** Admin required
- **Query params:** `{ limit?: number, days_ahead?: number }`
- **Response:** List of upcoming bookings

#### `GET /api/bookings/recent`
- **Description:** Recent booking activity
- **Auth:** Admin required
- **Query params:** `{ limit?: number }`
- **Response:** Recent bookings list

#### `GET /api/bookings/export`
- **Description:** Export bookings data
- **Auth:** Admin required
- **Query params:** Filters (status, date range, etc.)
- **Response:** CSV/Excel file download

### Public Analytics (No Auth Required)

#### `GET /api/bookings/most-booked`
- **Description:** Public endpoint for most booked destinations
- **Query params:** `{ limit?: number }`
- **Response:** Popular destinations list

#### `GET /api/bookings/countries-stats`
- **Description:** Countries with booking statistics
- **Response:** Countries ordered by booking volume

#### `GET /api/bookings/destinations-stats`
- **Description:** Destinations with booking statistics
- **Response:** Destinations ordered by booking volume

---

## Contact/Message Management

**Base path:** `/api/contact` or `/api/message`

### CRUD Operations

#### `GET /api/contact` | `GET /api/message`
- **Description:** List all contact messages
- **Auth:** Admin required
- **Query params:**
  - Pagination: `page`, `limit`
  - Filters: `status`, `folder`, `spam`, `starred`, `priority`
  - Search: `search`
- **Response:** Paginated messages list

#### `GET /api/contact/:id` | `GET /api/message/:id`
- **Description:** Get single message details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete message object

#### `PUT /api/contact/:id` | `PUT /api/message/:id`
- **Description:** Update message
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ subject?, body?, status?, priority?, folder? }`
- **Response:** Updated message

#### `DELETE /api/contact/:id` | `DELETE /api/message/:id`
- **Description:** Delete message
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

### Message Management

#### `PATCH /api/message/:id/read`
- **Description:** Mark message as read
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Updated message

#### `PATCH /api/message/:id/unread`
- **Description:** Mark message as unread
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Updated message

#### `PATCH /api/message/:id/star`
- **Description:** Toggle star status
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Updated message

#### `PATCH /api/message/:id/archive`
- **Description:** Archive message
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Updated message

#### `PATCH /api/message/:id/spam`
- **Description:** Mark as spam
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Updated message

#### `POST /api/message/:id/reply`
- **Description:** Send reply to message
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ subject: string, body: string }`
- **Response:** Reply confirmation

### Bulk Operations

#### `POST /api/message/bulk`
- **Description:** Bulk operations on messages
- **Auth:** Admin required
- **Body:** `{ ids: number[], action: 'delete' | 'archive' | 'spam' | 'markRead' | 'markUnread' }`
- **Response:** Bulk operation result

### Analytics

#### `GET /api/message/stats` | `GET /api/contact/stats`
- **Description:** Contact message analytics
- **Auth:** Admin required
- **Response:**
  ```json
  {
    "total": 1250,
    "unread": 45,
    "this_week": 23,
    "avg_response_time": "4.2 hours",
    "by_status": {...},
    "by_priority": {...},
    "conversion_rate": 12.5
  }
  ```

#### `GET /api/message/export` | `GET /api/contact/export`
- **Description:** Export messages data
- **Auth:** Admin required
- **Query params:** Filters
- **Response:** CSV/Excel file

---

## Countries Management

**Base path:** `/api/countries`

### CRUD Operations

#### `GET /api/countries`
- **Description:** List all countries
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `search`, `continent`, `is_featured`, `is_active`
- **Response:** Paginated countries list

#### `POST /api/countries`
- **Description:** Create new country
- **Auth:** Admin required
- **Body:** `{ name, slug, continent, summary, details, meta, is_featured, is_active }`
- **Upload:** `multipart/form-data` with `flag` and `images`
- **Response:** Created country object

#### `GET /api/countries/:id`
- **Description:** Get country details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete country object

#### `PUT /api/countries/:id`
- **Description:** Update country
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** Updatable country fields
- **Upload:** Optional images
- **Response:** Updated country

#### `DELETE /api/countries/:id`
- **Description:** Delete country
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

### Country Features Management

#### `POST /api/countries/:id/airports`
- **Description:** Add airport to country
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ name: string, code: string, city: string }`
- **Response:** Updated country

#### `DELETE /api/countries/:id/airports/:airportId`
- **Description:** Remove airport from country
- **Auth:** Admin required
- **Path params:** `id`, `airportId`
- **Response:** Success confirmation

#### `POST /api/countries/:id/festivals`
- **Description:** Add festival to country
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ name: string, date: string, description: string }`
- **Response:** Updated country

#### `DELETE /api/countries/:id/festivals/:festivalId`
- **Description:** Remove festival from country
- **Auth:** Admin required
- **Path params:** `id`, `festivalId`
- **Response:** Success confirmation

#### `POST /api/countries/:id/unesco-sites`
- **Description:** Add UNESCO site to country
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ name: string, description: string, location: string }`
- **Response:** Updated country

#### `DELETE /api/countries/:id/unesco-sites/:siteId`
- **Description:** Remove UNESCO site from country
- **Auth:** Admin required
- **Path params:** `id`, `siteId`
- **Response:** Success confirmation

#### `POST /api/countries/:id/historical-events`
- **Description:** Add historical event to country
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ title: string, year: number, summary: string }`
- **Response:** Updated country

#### `DELETE /api/countries/:id/historical-events/:eventId`
- **Description:** Remove historical event from country
- **Auth:** Admin required
- **Path params:** `id`, `eventId`
- **Response:** Success confirmation

### Analytics

#### `GET /api/countries/stats`
- **Description:** Country statistics overview
- **Auth:** Admin required
- **Response:**
  ```json
  {
    "total_countries": 45,
    "featured_countries": 12,
    "total_continents": 6,
    "total_population": 2500000000,
    "total_destinations": 85,
    "total_airports": 1250,
    "total_unesco_sites": 89
  }
  ```

#### `GET /api/countries/continents`
- **Description:** Countries grouped by continents
- **Auth:** Admin required
- **Response:** Continent-based country statistics

---

## Destinations Management

**Base path:** `/api/destinations`

### CRUD Operations

#### `GET /api/destinations`
- **Description:** List all destinations
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `search`, `status`, `country_id`, `category`, `is_featured`, `is_popular`
- **Response:** Paginated destinations list

#### `POST /api/destinations`
- **Description:** Create new destination
- **Auth:** Admin required
- **Body:** `{ title, slug, description, country_id, category, price, duration, status, is_featured, is_popular }`
- **Upload:** `multipart/form-data` with `image`
- **Response:** Created destination

#### `GET /api/destinations/:id`
- **Description:** Get destination details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete destination object

#### `PUT /api/destinations/:id`
- **Description:** Update destination
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** Updatable destination fields
- **Upload:** Optional image
- **Response:** Updated destination

#### `DELETE /api/destinations/:id`
- **Description:** Delete destination
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

#### `POST /api/destinations/:id/restore`
- **Description:** Restore soft-deleted destination
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Restored destination

### Content Management

#### `POST /api/destinations/:id/images`
- **Description:** Add images to destination
- **Auth:** Admin required
- **Path params:** `id`
- **Upload:** `multipart/form-data` with `images` array
- **Response:** Updated destination

#### `PUT /api/destinations/:id/images/:imageId`
- **Description:** Update image metadata
- **Auth:** Admin required
- **Path params:** `id`, `imageId`
- **Body:** `{ caption?: string, order?: number }`
- **Response:** Updated image

#### `DELETE /api/destinations/:id/images/:imageId`
- **Description:** Delete destination image
- **Auth:** Admin required
- **Path params:** `id`, `imageId`
- **Response:** Success confirmation

#### `PUT /api/destinations/:id/images/reorder`
- **Description:** Reorder destination images
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ order: [imageId, ...] }`
- **Response:** Updated order

### Itinerary Management

#### `POST /api/destinations/:id/itinerary`
- **Description:** Add itinerary day
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ title: string, day: number, description: string }`
- **Response:** Updated destination

#### `PUT /api/destinations/:id/itinerary/:dayId`
- **Description:** Update itinerary day
- **Auth:** Admin required
- **Path params:** `id`, `dayId`
- **Body:** Updated itinerary fields
- **Response:** Updated itinerary

#### `DELETE /api/destinations/:id/itinerary/:dayId`
- **Description:** Remove itinerary day
- **Auth:** Admin required
- **Path params:** `id`, `dayId`
- **Response:** Success confirmation

### FAQs Management

#### `POST /api/destinations/:id/faqs`
- **Description:** Add destination FAQ
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ question: string, answer: string }`
- **Response:** Updated destination

#### `PUT /api/destinations/:id/faqs/:faqId`
- **Description:** Update destination FAQ
- **Auth:** Admin required
- **Path params:** `id`, `faqId`
- **Body:** `{ question: string, answer: string }`
- **Response:** Updated FAQ

#### `DELETE /api/destinations/:id/faqs/:faqId`
- **Description:** Remove destination FAQ
- **Auth:** Admin required
- **Path params:** `id`, `faqId`
- **Response:** Success confirmation

### Tags Management

#### `POST /api/destinations/:id/tags`
- **Description:** Add destination tag
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ tag: string }` or `{ name: string }`
- **Response:** Updated destination

#### `DELETE /api/destinations/:id/tags/:tagId`
- **Description:** Remove destination tag
- **Auth:** Admin required
- **Path params:** `id`, `tagId`
- **Response:** Success confirmation

### Bulk Operations

#### `PATCH /api/destinations/bulk`
- **Description:** Bulk update destinations
- **Auth:** Admin required
- **Body:** `{ ids: number[], updates: object }`
- **Response:** Bulk operation result

### Analytics

#### `GET /api/destinations/stats`
- **Description:** Destination statistics overview
- **Auth:** Admin required
- **Response:**
  ```json
  {
    "overview": {
      "total": 85,
      "published": 72,
      "featured": 15,
      "popular": 28,
      "countries": 12,
      "avgRating": 4.6,
      "totalViews": 125000,
      "totalReviews": 890
    },
    "byCategory": [...],
    "byCountry": [...]
  }
  ```

---

## Posts Management

**Base path:** `/api/posts`

### CRUD Operations

#### `GET /api/posts/admin/all`
- **Description:** Admin list of all posts including drafts
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `search`, `status`, `category`, `author`
- **Response:** Paginated posts list

#### `POST /api/posts`
- **Description:** Create new post
- **Auth:** Admin required
- **Body:** `{ title, slug, content, excerpt, category, tags, is_featured, is_published, meta }`
- **Upload:** `multipart/form-data` with `image`
- **Response:** Created post

#### `GET /api/posts/:id`
- **Description:** Get post details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete post object

#### `PUT /api/posts/:id`
- **Description:** Update post
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** Updatable post fields
- **Upload:** Optional image
- **Response:** Updated post

#### `DELETE /api/posts/:id`
- **Description:** Delete post
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

### Post Management

#### `PATCH /api/posts/:id/toggle-publish`
- **Description:** Toggle publish status
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Updated post

#### `PATCH /api/posts/:id/toggle-featured`
- **Description:** Toggle featured status
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Updated post

### Bulk Operations

#### `DELETE /api/posts/bulk-delete`
- **Description:** Bulk delete posts
- **Auth:** Admin required
- **Body:** `{ ids: number[] }`
- **Response:** Bulk deletion result

### Analytics

#### `GET /api/posts/stats`
- **Description:** Posts statistics overview
- **Auth:** Admin required
- **Response:**
  ```json
  {
    "total": 156,
    "published": 142,
    "drafts": 14,
    "featured": 23,
    "total_views": 45000,
    "avg_views_per_post": 288,
    "by_category": [...],
    "by_month": [...]
  }
  ```

---

## Pages Management

**Base path:** `/api/pages`

### CRUD Operations

#### `GET /api/pages`
- **Description:** List all pages
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `search`, `status`
- **Response:** Paginated pages list

#### `POST /api/pages`
- **Description:** Create new page
- **Auth:** Admin required
- **Body:** `{ title, slug, content, status, meta }`
- **Response:** Created page

#### `GET /api/pages/:id`
- **Description:** Get page details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete page object

#### `PUT /api/pages/:id`
- **Description:** Update page
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** Updatable page fields
- **Response:** Updated page

#### `DELETE /api/pages/:id`
- **Description:** Delete page
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

---

## Services Management

**Base path:** `/api/services`

### CRUD Operations

#### `GET /api/services`
- **Description:** List all services
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `search`, `category`, `is_active`
- **Response:** Paginated services list

#### `POST /api/services`
- **Description:** Create new service
- **Auth:** Admin required
- **Body:** `{ name, description, price, category, status, features }`
- **Response:** Created service

#### `GET /api/services/:id`
- **Description:** Get service details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete service object

#### `PUT /api/services/:id`
- **Description:** Update service
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** Updatable service fields
- **Response:** Updated service

#### `DELETE /api/services/:id`
- **Description:** Delete service
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

---

## FAQs Management

**Base path:** `/api/faqs`

### CRUD Operations

#### `GET /api/faqs`
- **Description:** List all FAQs
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `search`, `category`, `is_active`
- **Response:** Paginated FAQs list

#### `POST /api/faqs`
- **Description:** Create new FAQ
- **Auth:** Admin required
- **Body:** `{ question, answer, category, order, is_active }`
- **Response:** Created FAQ

#### `GET /api/faqs/:id`
- **Description:** Get FAQ details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete FAQ object

#### `PUT /api/faqs/:id`
- **Description:** Update FAQ
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** Updatable FAQ fields
- **Response:** Updated FAQ

#### `DELETE /api/faqs/:id`
- **Description:** Delete FAQ
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

---

## Gallery Management

**Base path:** `/api/gallery`

### CRUD Operations

#### `GET /api/gallery`
- **Description:** List all gallery images
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `search`, `category`
- **Response:** Paginated gallery list

#### `POST /api/gallery`
- **Description:** Upload single gallery image
- **Auth:** Admin required
- **Upload:** `multipart/form-data` with `image`
- **Body:** `{ title?, caption?, category?, tags? }`
- **Response:** Created gallery item

#### `POST /api/gallery/bulk`
- **Description:** Upload multiple gallery images
- **Auth:** Admin required
- **Upload:** `multipart/form-data` with `images` array
- **Body:** `{ category?, tags? }`
- **Response:** Created gallery items

#### `GET /api/gallery/:id`
- **Description:** Get gallery item details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete gallery object

#### `PUT /api/gallery/:id`
- **Description:** Update gallery item
- **Auth:** Admin required
- **Path params:** `id`
- **Upload:** Optional `image`
- **Body:** Updatable gallery fields
- **Response:** Updated gallery item

#### `DELETE /api/gallery/:id`
- **Description:** Delete gallery item
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

---

## Team Management

**Base path:** `/api/team`

### CRUD Operations

#### `GET /api/team/admin/all`
- **Description:** Admin list of all team members including inactive
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `search`, `department`, `is_active`
- **Response:** Paginated team list

#### `POST /api/team`
- **Description:** Create new team member
- **Auth:** Admin required
- **Body:** `{ name, title, department, bio, sort_order, is_featured, is_active }`
- **Upload:** `multipart/form-data` with `image`
- **Response:** Created team member

#### `GET /api/team/:id`
- **Description:** Get team member details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete team member object

#### `PUT /api/team/:id`
- **Description:** Update team member
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** Updatable team fields
- **Upload:** Optional image
- **Response:** Updated team member

#### `DELETE /api/team/:id`
- **Description:** Delete team member
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

### Team Management

#### `PATCH /api/team/reorder`
- **Description:** Reorder team members
- **Auth:** Admin required
- **Body:** `{ order: [id, ...] }`
- **Response:** Updated order

#### `PATCH /api/team/:id/toggle-status`
- **Description:** Toggle active status
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Updated team member

#### `POST /api/team/:id/duplicate`
- **Description:** Duplicate team member record
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Duplicated team member

### Bulk Operations

#### `DELETE /api/team/bulk-delete`
- **Description:** Bulk delete team members
- **Auth:** Admin required
- **Body:** `{ ids: number[] }`
- **Response:** Bulk deletion result

### Analytics

#### `GET /api/team/stats`
- **Description:** Team statistics overview
- **Auth:** Admin required
- **Response:**
  ```json
  {
    "total_members": 12,
    "active_members": 10,
    "departments": 4,
    "featured_members": 6,
    "by_department": [...]
  }
  ```

---

## Subscribers Management

**Base path:** `/api/subscribers`

### CRUD Operations

#### `GET /api/subscribers`
- **Description:** List all newsletter subscribers
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `search`, `is_active`
- **Response:** Paginated subscribers list

#### `GET /api/subscribers/:id`
- **Description:** Get subscriber details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete subscriber object

#### `DELETE /api/subscribers/:id`
- **Description:** Delete subscriber
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

### Subscriber Management

#### `POST /api/subscribers/:id/toggle-status`
- **Description:** Toggle subscriber active status
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Updated subscriber

### Bulk Operations

#### `DELETE /api/subscribers/bulk-delete`
- **Description:** Bulk delete subscribers
- **Auth:** Admin required
- **Body:** `{ ids: number[] }`
- **Response:** Bulk deletion result

### Analytics

#### `GET /api/subscribers/stats`
- **Description:** Subscriber statistics
- **Auth:** Admin required
- **Response:**
  ```json
  {
    "total": 3200,
    "active": 3100,
    "new_this_month": 245,
    "unsubscribed": 100,
    "growth_rate": 8.3
  }
  ```

#### `GET /api/subscribers/export`
- **Description:** Export subscribers data
- **Auth:** Admin required
- **Query params:** Filters
- **Response:** CSV file download

---

## Virtual Tours Management

**Base path:** `/api/virtual-tours`

### CRUD Operations

#### `GET /api/virtual-tours`
- **Description:** List all virtual tours
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `search`, `status`
- **Response:** Paginated virtual tours list

#### `POST /api/virtual-tours`
- **Description:** Create new virtual tour
- **Auth:** Admin required
- **Body:** `{ title, description, media_url, status, destination_id }`
- **Response:** Created virtual tour

#### `GET /api/virtual-tours/:id`
- **Description:** Get virtual tour details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete virtual tour object

#### `PUT /api/virtual-tours/:id`
- **Description:** Update virtual tour
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** Updatable virtual tour fields
- **Response:** Updated virtual tour

#### `DELETE /api/virtual-tours/:id`
- **Description:** Delete virtual tour
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

### Analytics

#### `GET /api/virtual-tours/stats`
- **Description:** Virtual tours statistics
- **Auth:** Admin required
- **Response:**
  ```json
  {
    "total": 12,
    "active": 10,
    "total_views": 15000,
    "avg_views_per_tour": 1250,
    "by_destination": [...]
  }
  ```

---

## Tips Management

**Base path:** `/api/tips`

### CRUD Operations

#### `GET /api/tips`
- **Description:** List all travel tips
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `search`, `category`, `is_active`
- **Response:** Paginated tips list

#### `POST /api/tips`
- **Description:** Create new travel tip
- **Auth:** Admin required
- **Body:** `{ title, content, category, tags, is_active }`
- **Response:** Created tip

#### `GET /api/tips/:id`
- **Description:** Get tip details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete tip object

#### `PUT /api/tips/:id`
- **Description:** Update tip
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** Updatable tip fields
- **Response:** Updated tip

#### `DELETE /api/tips/:id`
- **Description:** Delete tip
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

### Category Management

#### `GET /api/tips/categories`
- **Description:** Get all tip categories
- **Auth:** Admin required
- **Response:** Categories list with counts

---

## Uploads Management

**Base path:** `/api/uploads`

### File Upload Operations

#### `POST /api/uploads/image`
- **Description:** Upload single image
- **Auth:** Admin required
- **Upload:** `multipart/form-data` with `image`
- **Query params:** `folder?` (destination, gallery, team, etc.)
- **Response:** `{ url, filename, size, type }`

#### `POST /api/uploads/images`
- **Description:** Upload multiple images
- **Auth:** Admin required
- **Upload:** `multipart/form-data` with `images` array
- **Query params:** `folder?`
- **Response:** Array of uploaded image objects

### Upload Management

#### `GET /api/uploads`
- **Description:** List uploaded files
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `folder`, `type`
- **Response:** Paginated uploads list

#### `DELETE /api/uploads/:filename`
- **Description:** Delete uploaded file
- **Auth:** Admin required
- **Path params:** `filename`
- **Response:** Success confirmation

---

## Settings Management

**Base path:** `/api/settings`

### CRUD Operations

#### `GET /api/settings`
- **Description:** List all settings
- **Auth:** Admin required
- **Query params:** `group?`
- **Response:** Settings grouped by category

#### `PUT /api/settings/:id`
- **Description:** Update setting
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** `{ value: any }`
- **Response:** Updated setting

#### `POST /api/settings/bulk`
- **Description:** Bulk update settings
- **Auth:** Admin required
- **Body:** `{ settings: [{ id, value }, ...] }`
- **Response:** Bulk update result

### Settings Groups

- **General:** Site title, description, contact info
- **Booking:** Default settings, pricing, policies
- **Email:** SMTP settings, templates
- **Social:** Social media links, API keys
- **SEO:** Meta tags, sitemap settings
- **Analytics:** Tracking codes, reporting

---

## Content Moderation

### Comments Management

#### Country Comments

**Base path:** `/api/country-comments`

- `GET /api/country-comments/:countryId/comments`
  - **Description:** Get comments for country
  - **Auth:** Admin required
  - **Path params:** `countryId`
  - **Query params:** `page`, `limit`, `status`

- `PATCH /api/country-comments/:countryId/comments/:commentId/approve`
  - **Description:** Approve/unapprove country comment
  - **Auth:** Admin required
  - **Path params:** `countryId`, `commentId`
  - **Body:** `{ approved: boolean }`

- `DELETE /api/country-comments/:countryId/comments/:commentId`
  - **Description:** Delete country comment
  - **Auth:** Admin required
  - **Path params:** `countryId`, `commentId`

#### Destination Comments

**Base path:** `/api/destination-comments`

- `GET /api/destination-comments/:destinationId/comments`
  - **Description:** Get comments for destination
  - **Auth:** Admin required
  - **Path params:** `destinationId`
  - **Query params:** `page`, `limit`, `status`

- `PATCH /api/destination-comments/:destinationId/comments/:commentId/approve`
  - **Description:** Approve/unapprove destination comment
  - **Auth:** Admin required
  - **Path params:** `destinationId`, `commentId`
  - **Body:** `{ approved: boolean }`

- `DELETE /api/destination-comments/:destinationId/comments/:commentId`
  - **Description:** Delete destination comment
  - **Auth:** Admin required
  - **Path params:** `destinationId`, `commentId`

### Ratings Management

#### Country Ratings

**Base path:** `/api/country-ratings`

- `GET /api/country-ratings/:countryId/ratings`
  - **Description:** Get ratings for country
  - **Auth:** Admin required
  - **Path params:** `countryId`
  - **Query params:** `page`, `limit`, `status`

- `PATCH /api/country-ratings/:countryId/ratings/:ratingId/approve`
  - **Description:** Approve/unapprove country rating
  - **Auth:** Admin required
  - **Path params:** `countryId`, `ratingId`
  - **Body:** `{ approved: boolean }`

#### Destination Ratings

**Base path:** `/api/destination-ratings`

- `GET /api/destination-ratings/:destinationId/ratings`
  - **Description:** Get ratings for destination
  - **Auth:** Admin required
  - **Path params:** `destinationId`
  - **Query params:** `page`, `limit`, `status`

- `PATCH /api/destination-ratings/:destinationId/ratings/:ratingId/approve`
  - **Description:** Approve/unapprove destination rating
  - **Auth:** Admin required
  - **Path params:** `destinationId`, `ratingId`
  - **Body:** `{ approved: boolean }`

### Likes Management

#### Country Likes

**Base path:** `/api/country-likes`

- `GET /api/country-likes/:countryId/stats`
  - **Description:** Get like statistics for country
  - **Auth:** Admin required
  - **Path params:** `countryId`

#### Destination Likes

**Base path:** `/api/destination-likes`

- `GET /api/destination-likes/:destinationId/stats`
  - **Description:** Get like statistics for destination
  - **Auth:** Admin required
  - **Path params:** `destinationId`

---

## User Management

**Base path:** `/api/admin/users`

### User Analytics & Management

#### `GET /api/admin/users/stats`
- **Description:** User statistics overview
- **Auth:** Admin required
- **Response:**
  ```json
  {
    "total_users": 3200,
    "active_users": 1850,
    "new_users_this_month": 245,
    "verified_users": 2100,
    "by_auth_provider": {...},
    "by_nationality": {...},
    "registration_trends": [...]
  }
  ```

#### `GET /api/admin/users`
- **Description:** List all users
- **Auth:** Admin required
- **Query params:** `page`, `limit`, `search`, `is_active`, `is_verified`, `auth_provider`
- **Response:** Paginated users list

#### `GET /api/admin/users/:id`
- **Description:** Get user details
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Complete user object

#### `PUT /api/admin/users/:id`
- **Description:** Update user
- **Auth:** Admin required
- **Path params:** `id`
- **Body:** Updatable user fields
- **Response:** Updated user

#### `DELETE /api/admin/users/:id`
- **Description:** Delete user
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Success confirmation

#### `PATCH /api/admin/users/:id/toggle-status`
- **Description:** Toggle user active status
- **Auth:** Admin required
- **Path params:** `id`
- **Response:** Updated user

### User Activity

#### `GET /api/admin/users/:id/activity`
- **Description:** Get user activity history
- **Auth:** Admin required
- **Path params:** `id`
- **Query params:** `page`, `limit`
- **Response:** User activity log

#### `GET /api/admin/users/:id/bookings`
- **Description:** Get user's bookings
- **Auth:** Admin required
- **Path params:** `id`
- **Query params:** `page`, `limit`
- **Response:** User's bookings list

---

## Advanced Analytics Endpoints

### Revenue Analytics

#### `GET /api/admin/analytics/revenue/breakdown`
- **Description:** Detailed revenue breakdown
- **Auth:** Admin required
- **Query params:** `{ period: string, group_by: 'destination' | 'country' | 'month' }`
- **Response:** Revenue data by various dimensions

#### `GET /api/admin/analytics/revenue/projections`
- **Description:** Revenue projections and forecasting
- **Auth:** Admin required
- **Query params:** `{ months_ahead: number }`
- **Response:** Projected revenue data

### Geographic Analytics

#### `GET /api/admin/analytics/geographic/heatmap`
- **Description:** Geographic booking heatmap data
- **Auth:** Admin required
- **Query params:** `{ type: 'bookings' | 'users' | 'revenue' }`
- **Response:** Geographic data for mapping

#### `GET /api/admin/analytics/geographic/trends`
- **Description:** Geographic trend analysis
- **Auth:** Admin required
- **Query params:** `{ region: string, period: string }`
- **Response:** Regional trend data

### User Behavior Analytics

#### `GET /api/admin/analytics/user/journey`
- **Description:** User journey and conversion funnel analysis
- **Auth:** Admin required
- **Query params:** `{ segment?: string }`
- **Response:** User journey data

#### `GET /api/admin/analytics/user/retention`
- **Description:** User retention and churn analysis
- **Auth:** Admin required
- **Query params:** `{ period: string }`
- **Response:** Retention metrics

### Content Performance Analytics

#### `GET /api/admin/analytics/content/engagement`
- **Description:** Content engagement metrics
- **Auth:** Admin required
- **Query params:** `{ content_type: string, period: string }`
- **Response:** Engagement data by content type

#### `GET /api/admin/analytics/content/conversion`
- **Description:** Content conversion tracking
- **Auth:** Admin required
- **Query params:** `{ content_id?: number }`
- **Response:** Conversion rates by content

### Operational Analytics

#### `GET /api/admin/analytics/operations/efficiency`
- **Description:** Operational efficiency metrics
- **Auth:** Admin required
- **Query params:** `{ metric: 'response_time' | 'conversion' | 'satisfaction' }`
- **Response:** Operational metrics

#### `GET /api/admin/analytics/operations/quality`
- **Description:** Service quality metrics
- **Auth:** Admin required
- **Response:** Quality assurance data

---

## Error Handling & Response Formats

### Standard Response Format

All API responses follow this structure:

```json
{
  "success": boolean,
  "data": any,
  "message": string,
  "pagination": {
    "page": number,
    "limit": number,
    "total": number,
    "pages": number
  },
  "errors": [
    {
      "field": string,
      "message": string
    }
  ]
}
```

### Error Codes

- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate data)
- `422` - Unprocessable Entity
- `429` - Too Many Requests
- `500` - Internal Server Error

### Authentication Errors

```json
{
  "success": false,
  "message": "Authentication required",
  "error": "UNAUTHORIZED"
}
```

### Validation Errors

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Email is required"
    }
  ]
}
```

---

## Rate Limiting

- **Authentication routes:** 5 requests per 15 minutes per IP
- **General admin routes:** 100 requests per minute per admin user
- **File upload routes:** 10 uploads per minute per admin user
- **Bulk operations:** 5 bulk operations per minute per admin user

---

## File Upload Specifications

### Supported Formats

- **Images:** JPG, PNG, WebP, GIF (max 5MB each)
- **Documents:** PDF (max 10MB)
- **Videos:** MP4 (max 50MB)

### Upload Fields

- `image` - Single image file
- `images` - Multiple image files (array)
- `document` - Single document file
- `video` - Single video file

### Image Optimization

- Automatic resizing for web optimization
- Format conversion to WebP when beneficial
- Metadata stripping for security
- CDN delivery with caching

---

## Data Export Formats

### Supported Formats

- **CSV** - Comma-separated values for spreadsheet import
- **Excel** - Native Excel format with formatting
- **JSON** - Structured data for API integration
- **PDF** - Formatted reports for printing

### Export Options

- **Filters:** Apply current list filters to export
- **Fields:** Select specific fields to include
- **Date ranges:** Export data within specific periods
- **Compression:** ZIP compression for large exports

---

## Webhook & Integration Endpoints

### Booking Webhooks

#### `POST /api/webhooks/booking/created`
- **Description:** Triggered when new booking is created
- **Auth:** System internal
- **Body:** Complete booking data

#### `POST /api/webhooks/booking/status-changed`
- **Description:** Triggered when booking status changes
- **Auth:** System internal
- **Body:** Booking data with old/new status

### Content Webhooks

#### `POST /api/webhooks/content/published`
- **Description:** Triggered when content is published
- **Auth:** System internal
- **Body:** Content data

---

## API Versioning

- **Current Version:** v1
- **Version Header:** `Accept: application/vnd.altuvera.v1+json`
- **Deprecation Policy:** 6 months notice for breaking changes
- **Backward Compatibility:** Maintained for 12 months

---

## Security Features

### Data Protection

- **Encryption:** All sensitive data encrypted at rest
- **Token Security:** JWT tokens with expiration and refresh mechanism
- **Rate Limiting:** DDoS protection and abuse prevention
- **Input Validation:** Comprehensive validation on all inputs
- **SQL Injection Protection:** Parameterized queries throughout

### Audit Logging

- **Admin Actions:** All admin actions logged with timestamps
- **Data Changes:** Create, update, delete operations tracked
- **Authentication:** Login/logout events recorded
- **File Operations:** Upload/delete operations logged

### Access Control

- **Role-Based Access:** Admin and super-admin roles
- **Resource Permissions:** Granular permissions per resource
- **IP Whitelisting:** Optional IP restrictions for admin access
- **Session Management:** Secure session handling with timeouts

---

This documentation provides comprehensive coverage of all admin API endpoints, including advanced analytics, bulk operations, content moderation, and administrative functions. All endpoints require proper authentication and follow consistent response patterns.
  - Description: Update booking fields.
  - Path params: `id`.
  - Body: booking fields such as `status`, `customer_notes`, `internal_notes`, `admin_notes`, `price`, etc.

- `DELETE /api/bookings/:id`
  - Description: Delete a booking.
  - Path params: `id`.

- `PATCH /api/bookings/:id/status`
  - Description: Update booking status.
  - Path params: `id`.
  - Body: likely `{ status }`.

- `POST /api/bookings/:id/confirm`
  - Description: Confirm a booking.
  - Path params: `id`.
  - Body: optional action metadata.

- `POST /api/bookings/:id/cancel`
  - Description: Cancel a booking.
  - Path params: `id`.
  - Body: optional reason or notes.

- `POST /api/bookings/:id/notes`
  - Description: Add admin/internal notes to a booking.
  - Path params: `id`.
  - Body: `{ admin_notes, internal_notes }`.

---

## Contact / Messages

Base: `/api/message` and `/api/contact` are both mounted in the backend.

- `GET /api/message` or `/api/contact`
  - Description: List all contact messages.
  - Query params: `page`, `limit`, `search`, `status`, `folder`, `spam`, `starred`.

- `GET /api/message/stats`
  - Description: Retrieve contact message analytics.

- `GET /api/message/export`
  - Description: Export contact messages.
  - Query params: optional filters.

- `POST /api/message/bulk`
  - Description: Apply bulk actions to messages.
  - Body: `{ ids: [...], action: "delete" | "archive" | "spam" | "markRead" | "markUnread" }`.

- `GET /api/message/:id`
  - Description: Get a single message.
  - Path params: `id`.

- `PUT /api/message/:id`
  - Description: Update a message record.
  - Path params: `id`.
  - Body: editable message fields, such as `subject`, `body`, `status`.

- `DELETE /api/message/:id`
  - Description: Delete a message.
  - Path params: `id`.

- `PATCH /api/message/:id/read`
  - Description: Mark a message as read.
  - Path params: `id`.

- `PATCH /api/message/:id/unread`
  - Description: Mark a message as unread.
  - Path params: `id`.

- `PATCH /api/message/:id/star`
  - Description: Toggle star status.
  - Path params: `id`.

- `PATCH /api/message/:id/archive`
  - Description: Archive a message.
  - Path params: `id`.

- `PATCH /api/message/:id/spam`
  - Description: Mark a message as spam.
  - Path params: `id`.

- `POST /api/message/:id/reply`
  - Description: Send a reply from admin.
  - Path params: `id`.
  - Body: `{ subject, body }`.

---

## Countries

Base: `/api/countries`

- `POST /api/countries`
  - Description: Create a country.
  - Body: country fields such as `name`, `slug`, `continent`, `summary`, `details`, `meta`, `is_active`.

- `PUT /api/countries/:id`
  - Description: Update a country.
  - Path params: `id`.
  - Body: country fields to update.

- `DELETE /api/countries/:id`
  - Description: Delete a country.
  - Path params: `id`.

- `POST /api/countries/:id/airports`
  - Description: Add airport metadata.
  - Path params: `id`.
  - Body: airport fields such as `name`, `code`, `city`.

- `DELETE /api/countries/:id/airports/:airportId`
  - Description: Remove airport.
  - Path params: `id`, `airportId`.

- `POST /api/countries/:id/festivals`
  - Description: Add a festival entry.
  - Path params: `id`.
  - Body: festival fields such as `name`, `date`, `description`.

- `DELETE /api/countries/:id/festivals/:festivalId`
  - Description: Remove a festival.
  - Path params: `id`, `festivalId`.

- `POST /api/countries/:id/unesco-sites`
  - Description: Add a UNESCO site.
  - Path params: `id`.
  - Body: site fields such as `name`, `description`, `location`.

- `DELETE /api/countries/:id/unesco-sites/:siteId`
  - Description: Remove a UNESCO site.
  - Path params: `id`, `siteId`.

- `POST /api/countries/:id/historical-events`
  - Description: Add a historical event.
  - Path params: `id`.
  - Body: event fields such as `title`, `year`, `summary`.

- `DELETE /api/countries/:id/historical-events/:eventId`
  - Description: Remove a historical event.
  - Path params: `id`, `eventId`.

---

## Destinations

Base: `/api/destinations`

- `POST /api/destinations`
  - Description: Create a destination.
  - Body: destination fields such as `title`, `slug`, `description`, `country_id`, `price`, `status`.
  - Upload: `multipart/form-data` with `image`.

- `PUT /api/destinations/:id`
  - Description: Update a destination.
  - Path params: `id`.
  - Body: destination fields to update.
  - Upload: optional `image`.

- `DELETE /api/destinations/:id`
  - Description: Delete a destination.
  - Path params: `id`.

- `POST /api/destinations/:id/restore`
  - Description: Restore a soft-deleted destination.
  - Path params: `id`.

- `PATCH /api/destinations/bulk`
  - Description: Bulk update destinations.
  - Body: likely includes `{ ids: [...], updates: {...} }`.

### Destination media and structure management

- `POST /api/destinations/:id/images`
  - Description: Add images to a destination.
  - Path params: `id`.
  - Upload: `multipart/form-data` with `images` array.

- `PUT /api/destinations/:id/images/:imageId`
  - Description: Update image metadata.
  - Path params: `id`, `imageId`.
  - Body: metadata fields such as `caption`, `order`.

- `DELETE /api/destinations/:id/images/:imageId`
  - Description: Delete a destination image.
  - Path params: `id`, `imageId`.

- `PUT /api/destinations/:id/images/reorder`
  - Description: Reorder destination images.
  - Path params: `id`.
  - Body: likely `{ order: [imageId, ...] }`.

- `POST /api/destinations/:id/itinerary`
  - Description: Add an itinerary day.
  - Path params: `id`.
  - Body: itinerary fields such as `title`, `day`, `description`.

- `PUT /api/destinations/:id/itinerary/:dayId`
  - Description: Update an itinerary day.
  - Path params: `id`, `dayId`.
  - Body: updated itinerary fields.

- `DELETE /api/destinations/:id/itinerary/:dayId`
  - Description: Remove an itinerary day.
  - Path params: `id`, `dayId`.

- `POST /api/destinations/:id/faqs`
  - Description: Add a destination FAQ.
  - Path params: `id`.
  - Body: `{ question, answer }`.

- `PUT /api/destinations/:id/faqs/:faqId`
  - Description: Update a destination FAQ.
  - Path params: `id`, `faqId`.
  - Body: `{ question, answer }`.

- `DELETE /api/destinations/:id/faqs/:faqId`
  - Description: Remove a destination FAQ.
  - Path params: `id`, `faqId`.

- `POST /api/destinations/:id/tags`
  - Description: Add a destination tag.
  - Path params: `id`.
  - Body: `{ tag }` or `{ name }`.

- `DELETE /api/destinations/:id/tags/:tagId`
  - Description: Remove a destination tag.
  - Path params: `id`, `tagId`.

---

## Posts

Base: `/api/posts`

- `GET /api/posts/admin/all`
  - Description: Admin-only list of all posts, including unpublished and drafts.
  - Query params: `page`, `limit`, `search`, `status`, `category`.

- `POST /api/posts`
  - Description: Create a post.
  - Body: post fields such as `title`, `slug`, `content`, `excerpt`, `category`, `tags`, `is_featured`, `is_published`.
  - Upload: `multipart/form-data` with field `image`.

- `PUT /api/posts/:id`
  - Description: Update a post.
  - Path params: `id`.
  - Body: any editable post field.
  - Upload: optional `image`.

- `DELETE /api/posts/:id`
  - Description: Delete a post.
  - Path params: `id`.

- `PATCH /api/posts/:id/toggle-publish`
  - Description: Toggle a post between published and unpublished.
  - Path params: `id`.

- `PATCH /api/posts/:id/toggle-featured`
  - Description: Toggle featured status.
  - Path params: `id`.

- `DELETE /api/posts/bulk-delete`
  - Description: Bulk delete posts.
  - Body: `{ ids: [...] }`.

---

## Pages

Base: `/api/pages`

- `POST /api/pages`
  - Description: Create a page.
  - Body: page fields such as `title`, `slug`, `content`, `status`, `meta`.

- `PUT /api/pages/:id`
  - Description: Update a page.
  - Path params: `id`.
  - Body: editable page fields.

- `DELETE /api/pages/:id`
  - Description: Delete a page.
  - Path params: `id`.

---

## Services

Base: `/api/services`

- `POST /api/services`
  - Description: Create a service.
  - Body: service fields such as `name`, `description`, `price`, `category`, `status`.

- `PUT /api/services/:id`
  - Description: Update a service.
  - Path params: `id`.
  - Body: editable service fields.

- `DELETE /api/services/:id`
  - Description: Delete a service.
  - Path params: `id`.

---

## FAQs

Base: `/api/faqs`

- `POST /api/faqs`
  - Description: Create a FAQ entry.
  - Body: `{ question, answer, category, order, is_active }`.

- `PUT /api/faqs/:id`
  - Description: Update a FAQ.
  - Path params: `id`.
  - Body: FAQ fields to update.

- `DELETE /api/faqs/:id`
  - Description: Delete a FAQ.
  - Path params: `id`.

---

## Gallery

Base: `/api/gallery`

- `POST /api/gallery/bulk`
  - Description: Upload multiple gallery images.
  - Upload: `multipart/form-data` with field `images`.

- `POST /api/gallery`
  - Description: Upload a single gallery image.
  - Upload: `multipart/form-data` with field `image`.

- `PUT /api/gallery/:id`
  - Description: Update a gallery item.
  - Path params: `id`.
  - Upload: `multipart/form-data` with field `image`.

- `DELETE /api/gallery/:id`
  - Description: Delete a gallery item.
  - Path params: `id`.

---

## Team

Base: `/api/team`

- `GET /api/team/admin/all`
  - Description: Admin list of all team members, including inactive.
  - Query params: optional `page`, `limit`, `search`, `department`.

- `POST /api/team`
  - Description: Create a team member.
  - Body: team member fields such as `name`, `title`, `department`, `bio`, `sort_order`, `is_featured`, `is_active`.
  - Upload: `multipart/form-data` with field `image`.

- `PUT /api/team/:id`
  - Description: Update a team member.
  - Path params: `id`.
  - Body: editable team member fields.
  - Upload: optional `image`.

- `DELETE /api/team/bulk-delete`
  - Description: Bulk delete team members.
  - Body: `{ ids: [...] }`.

- `DELETE /api/team/:id`
  - Description: Delete a single team member.
  - Path params: `id`.

- `PATCH /api/team/reorder`
  - Description: Reorder team members.
  - Body: `{ order: [id, ...] }`.

- `PATCH /api/team/:id/toggle-status`
  - Description: Toggle visible / active status.
  - Path params: `id`.
  - Body: optional status field.

- `POST /api/team/:id/duplicate`
  - Description: Duplicate a team member record.
  - Path params: `id`.

---

## Subscribers

Base: `/api/subscribers`

- `GET /api/subscribers`
  - Description: List all newsletter subscribers.
  - Query params: `page`, `limit`, `search`.

- `DELETE /api/subscribers/:id`
  - Description: Delete a subscriber.
  - Path params: `id`.

---

## Settings

Base: `/api/settings`

- `PUT /api/settings/:id`
  - Description: Update a settings record.
  - Path params: `id`.
  - Body: settings field updates such as `key`, `value`, `group`.

---

## Virtual Tours

Base: `/api/virtual-tours`

- `POST /api/virtual-tours`
  - Description: Create a virtual tour.
  - Body: virtual tour fields such as `title`, `description`, `media_url`, `status`.

- `PUT /api/virtual-tours/:id`
  - Description: Update a virtual tour.
  - Path params: `id`.
  - Body: editable virtual tour fields.

- `DELETE /api/virtual-tours/:id`
  - Description: Delete a virtual tour.
  - Path params: `id`.

---

## Moderation: Comments and Ratings

### Country comments and ratings

- `PATCH /api/country-comments/:countryId/comments/:commentId/approve`
  - Description: Approve or unapprove a country comment.
  - Path params: `countryId`, `commentId`.
  - Body: optional approval toggle or status field.

- `PATCH /api/country-ratings/:countryId/ratings/:ratingId/approve`
  - Description: Approve or unapprove a country rating.
  - Path params: `countryId`, `ratingId`.
  - Body: optional approval toggle.

### Destination comments and ratings

- `PATCH /api/destination-comments/:destinationId/comments/:commentId/approve`
  - Description: Approve or unapprove a destination comment.
  - Path params: `destinationId`, `commentId`.
  - Body: optional approval toggle or status field.

- `PATCH /api/destination-ratings/:destinationId/ratings/:ratingId/approve`
  - Description: Approve or unapprove a destination rating.
  - Path params: `destinationId`, `ratingId`.
  - Body: optional approval toggle.

---

## Frontend requirements and notes

- All admin requests must include `Authorization: Bearer <token>` unless the route is login or refresh-token.
- Use the refresh endpoint when the token expires.
- File uploads use `multipart/form-data`.
- Admin routes are enforced by `protect` and `adminOnly` middleware. If authentication fails, the API returns `401`. If authorization fails, the API returns `403`.
- The admin panel should only call these routes for management tasks; public frontend routes are not part of this admin contract.

## Suggested frontend workflow

1. `POST /api/admin/auth/login` to sign in and receive `token` + `refreshToken`.
2. Store access token in memory or secure storage for requests.
3. Attach `Authorization: Bearer <token>` to all admin requests.
4. If API returns a token expiration error, call `POST /api/admin/auth/refresh-token`.
5. Use admin routes to manage bookings, messages, content, and moderation.

---

## Important admin-only patterns

- `POST`, `PUT`, `PATCH`, and `DELETE` routes across the admin resources are restricted.
- Image and file upload routes use fields named `image` or `images` depending on endpoint.
- Some resources support bulk operations such as `/api/bookings/bulk-status`, `/api/posts/bulk-delete`, `/api/team/bulk-delete`, and `/api/gallery/bulk`.

## Excluded from this document

- Public API routes for non-admin usage are intentionally omitted.
- User-facing frontend endpoints such as booking creation, comments, likes, and public listings are not documented here.