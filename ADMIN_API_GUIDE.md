# 📋 Altuvera Travel — Admin Panel API Guide

> **Version:** 6.1  
> **Purpose:** Complete reference for admin dashboard frontend developers  
> **Base URL:** `https://api.altuvera.com` (or `http://localhost:5000` in dev)  
> **Date:** 2026-04-24

---

## 🔐 Authentication

All admin endpoints require authentication via **Bearer Token** in the `Authorization` header.

### Login Flow

| Step | Method | Endpoint | Body |
|------|--------|----------|------|
| 1 | `POST` | `/api/admin/auth/login` | `{ "email": "admin@altuvera.com", "password": "..." }` |
| 2 | `POST` | `/api/admin/auth/refresh-token` | `{ "refreshToken": "..." }` |

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "...",
  "user": { "id": 1, "email": "...", "role": "admin" }
}
```

**Required Headers for All Admin Routes:**
```http
Authorization: Bearer <token>
Content-Type: application/json
```

### Auth Middleware
- `protect` — Validates JWT token, attaches `req.user`
- `adminOnly` — Requires `role === 'admin'` or `role === 'super_admin'`

---

## 📊 Standard Response Format

```json
// Success (GET)
{
  "success": true,
  "data": [ ... ],
  "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
}

// Success (POST/PUT/DELETE)
{
  "success": true,
  "message": "Created successfully",
  "data": { ... }
}

// Error
{
  "success": false,
  "message": "Error description"
}
```

---

## 🌍 Countries (`/api/countries`)

### Public (no auth)
| Method | Endpoint | Query Params | Description |
|--------|----------|--------------|-------------|
| `GET` | `/` | `?page=1&limit=20&featured=true&continent=Africa&search=Rwanda` | List all countries |
| `GET` | `/featured` | `?limit=12` | Featured countries |
| `GET` | `/search` | `?q=kenya&limit=15` | Search countries |
| `GET` | `/stats` | — | Dashboard stats |
| `GET` | `/continents` | — | List continents with counts |
| `GET` | `/continent/:continent` | `?page=1&limit=20` | Countries by continent |
| `GET` | `/:idOrSlug` | `?includeRelated=true` | Single country details |
| `GET` | `/:idOrSlug/destinations` | — | Destinations in country |

### Admin (requires `protect + adminOnly`)
| Method | Endpoint | Body Fields | Description |
|--------|----------|-------------|-------------|
| `POST` | `/` | See **Country Create Fields** below | Create country |
| `PUT` | `/:id` | Same as create (partial) | Update country |
| `DELETE` | `/:id` | — | Delete country (fails if destinations exist) |
| `POST` | `/:id/airports` | `name*, code, location, airport_type, description, is_main_international` | Add airport |
| `DELETE` | `/:id/airports/:airportId` | — | Remove airport |
| `POST` | `/:id/festivals` | `name*, period, month, description, is_major_event, image_url` | Add festival |
| `DELETE` | `/:id/festivals/:festivalId` | — | Remove festival |
| `POST` | `/:id/unesco-sites` | `name*, year_inscribed, site_type, description` | Add UNESCO site |
| `DELETE` | `/:id/unesco-sites/:siteId` | — | Remove UNESCO site |
| `POST` | `/:id/historical-events` | `year*, event*, event_type, is_major, sort_year` | Add historical event |
| `DELETE` | `/:id/historical-events/:eventId` | — | Remove historical event |

### Country Create/Update Body Fields

```json
{
  "name": "Rwanda",                    // REQUIRED, min 2 chars
  "official_name": "Republic of Rwanda",
  "capital": "Kigali",
  "flag": "🇷🇼",
  "flag_url": "https://...",
  "tagline": "Land of a Thousand Hills",
  "motto": "Unity, Work, Patriotism",
  "demonym": "Rwandan",
  "independence_date": "1962-07-01",
  "government_type": "Presidential Republic",
  "head_of_state": "Paul Kagame",
  "continent": "Africa",
  "region": "East Africa",
  "sub_region": "African Great Lakes",
  "description": "Short description...",
  "full_description": "Full HTML/Markdown...",
  "additional_info": "Extra info...",
  "population": 13000000,
  "area": 26338.00,
  "population_density": 495.00,
  "urban_population": 17.30,
  "life_expectancy": 69.0,
  "median_age": 20.0,
  "literacy_rate": 73.20,
  "languages": ["Kinyarwanda", "English", "French"],
  "official_languages": ["Kinyarwanda", "English", "French"],
  "national_languages": ["Kinyarwanda"],
  "ethnic_groups": ["Hutu", "Tutsi", "Twa"],
  "religions": ["Christianity", "Islam", "Traditional"],
  "currency": "Rwandan Franc",
  "currency_symbol": "Fr",
  "timezone": "UTC+2 (CAT)",
  "calling_code": "+250",
  "internet_tld": ".rw",
  "driving_side": "Right",
  "electrical_plug": "Type C, J",
  "voltage": "230V",
  "water_safety": "Boil water advised",
  "climate": "Temperate tropical highland",
  "best_time_to_visit": "June to September",
  "seasons": { "dry": ["Jun","Jul","Aug","Sep"], "wet": ["Mar","Apr","May","Oct","Nov"], "best": "Jun-Sep" },
  "visa_info": "Visa on arrival for most countries...",
  "health_info": "Yellow fever certificate required...",
  "highlights": ["Mountain Gorillas", "Nyungwe Forest", "Akagera National Park"],
  "experiences": ["Gorilla Trekking", "Canopy Walk"],
  "travel_tips": ["Book gorilla permits early", "Bring rain gear"],
  "neighboring_countries": ["Uganda", "Tanzania", "Burundi", "DRC"],
  "wildlife": { "mammals": ["Mountain Gorilla", "Golden Monkey"], "birds": ["Shoebill"], "marine": [] },
  "cuisine": { "staples": ["Ugali", "Beans"], "specialties": ["Brochettes"], "beverages": ["Ikivuguto"] },
  "economic_info": { "gdp": "...", "currency": "RWF" },
  "geography": { "terrain": "Hilly", "highest_point": "..." },
  "image_url": "https://...",
  "cover_image_url": "https://...",
  "hero_image": "https://...",
  "images": ["https://...", "https://..."],
  "latitude": -1.9403,
  "longitude": 29.8739,
  "is_featured": true,
  "is_active": true
}
```

**Note:** `image_url` can also be sent as `multipart/form-data` with a file field named `image`.

---

## 🏔️ Destinations (`/api/destinations`)

### Public (no auth)
| Method | Endpoint | Query Params | Description |
|--------|----------|--------------|-------------|
| `GET` | `/` | `?page=1&limit=20&category=safari&search=lake&country=rwanda` | List destinations |
| `GET` | `/featured` | — | Featured destinations |
| `GET` | `/popular` | — | Popular destinations |
| `GET` | `/new` | — | Newest destinations |
| `GET` | `/search` | `?q=gorilla&limit=20` | Search |
| `GET` | `/suggestions` | `?query=mountain` | Autocomplete |
| `GET` | `/categories` | — | All categories |
| `GET` | `/difficulties` | — | All difficulty levels |
| `GET` | `/tags` | — | All tags |
| `GET` | `/stats` | — | Dashboard stats |
| `GET` | `/map` | — | Map coordinates data |
| `GET` | `/country/:countrySlug` | — | Destinations by country |
| `GET` | `/:idOrSlug` | — | Single destination |
| `GET` | `/:idOrSlug/related` | — | Related destinations |

### Admin (requires `protect + adminOnly`)
| Method | Endpoint | Body / Notes | Description |
|--------|----------|--------------|-------------|
| `POST` | `/` | `multipart/form-data` with `image` file + JSON fields | Create destination |
| `PUT` | `/:id` | Same as create (partial) | Update destination |
| `DELETE` | `/:id` | — | Delete destination |
| `POST` | `/:id/restore` | — | Restore soft-deleted |
| `PATCH` | `/bulk` | `{ ids: [1,2,3], updates: {...} }` | Bulk update |
| `POST` | `/:id/images` | `multipart/form-data` with `images` (max 20) | Add images |
| `PUT` | `/:id/images/:imageId` | `{ caption, is_primary, sort_order }` | Update image |
| `DELETE` | `/:id/images/:imageId` | — | Remove image |
| `PUT` | `/:id/images/reorder` | `{ imageIds: [3,1,2] }` | Reorder images |
| `POST` | `/:id/itinerary` | `day_number*, title*, description, activities[], meals[], accommodation, image_url` | Add itinerary day |
| `PUT` | `/:id/itinerary/:dayId` | Same as add | Update itinerary day |
| `DELETE` | `/:id/itinerary/:dayId` | — | Remove itinerary day |
| `POST` | `/:id/faqs` | `question*, answer*, category` | Add FAQ |
| `PUT` | `/:id/faqs/:faqId` | Same as add | Update FAQ |
| `DELETE` | `/:id/faqs/:faqId` | — | Remove FAQ |
| `POST` | `/:id/tags` | `tag_name*, tag_slug*, tag_category` | Add tag |
| `DELETE` | `/:id/tags/:tagId` | — | Remove tag |

### Destination Create Body Fields

```json
{
  "country_id": 1,                    // REQUIRED - ID of existing country
  "name": "Volcanoes National Park",  // REQUIRED
  "slug": "volcanoes-national-park",  // Auto-generated if omitted
  "tagline": "Home of the Mountain Gorillas",
  "short_description": "...",
  "description": "Full description...",
  "overview": "Overview text...",
  "highlights": ["Gorilla trekking", "Golden monkeys"],
  "activities": ["Hiking", "Bird watching"],
  "wildlife": ["Mountain Gorilla", "Golden Monkey"],
  "best_time_to_visit": "June to September",
  "getting_there": "2 hours drive from Kigali...",
  "what_to_expect": "...",
  "local_tips": "...",
  "safety_info": "...",
  "category": "National Park",
  "difficulty": "Moderate",
  "destination_type": "Safari",
  "region": "Northern Province",
  "nearest_city": "Musanze",
  "nearest_airport": "Kigali International Airport",
  "distance_from_airport_km": 105.00,
  "address": "Kinigi, Musanze District",
  "latitude": -1.4833,
  "longitude": 29.5167,
  "altitude_meters": 2400,
  "image_url": "https://...",
  "image_urls": ["https://...", "https://..."],
  "cover_image_url": "https://...",
  "hero_image": "https://...",
  "thumbnail_url": "https://...",
  "video_url": "https://...",
  "virtual_tour_url": "https://...",
  "duration_days": 3,
  "duration_nights": 2,
  "duration_display": "3 Days / 2 Nights",
  "min_group_size": 2,
  "max_group_size": 8,
  "min_age": 15,
  "fitness_level": "Moderate fitness required",
  "entrance_fee": "$75 per person",
  "operating_hours": "6:00 AM - 6:00 PM",
  "status": "published",              // Options: draft, published, archived
  "is_featured": true,
  "is_popular": true,
  "is_new": false,
  "is_eco_friendly": true,
  "is_family_friendly": false,
  "meta_title": "Volcanoes National Park | Altuvera",
  "meta_description": "..."
}
```

---

## 📝 Posts / Blog (`/api/posts`)

### Public
| Method | Endpoint | Query Params | Description |
|--------|----------|--------------|-------------|
| `GET` | `/` | `?page=1&limit=12&category=travel&tag=africa&search=gorilla` | List published posts |
| `GET` | `/featured` | — | Featured posts |
| `GET` | `/categories` | — | All categories |
| `GET` | `/tags` | — | All tags |
| `GET` | `/stats` | — | Post stats |
| `GET` | `/:slug` | — | Single post by slug |
| `POST` | `/:slug/like` | — | Toggle like (public) |
| `POST` | `/:slug/comments` | `{ name, email, content }` | Add comment |
| `GET` | `/:slug/comments` | — | Get comments |

### Admin
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `GET` | `/admin/all` | `?page=1&limit=20&search=...` | All posts (including drafts) |
| `POST` | `/` | `multipart/form-data` with `image` + JSON | Create post |
| `PUT` | `/:id` | Same as create | Update post |
| `DELETE` | `/:id` | — | Delete post |
| `PATCH` | `/:id/toggle-publish` | — | Toggle publish status |
| `PATCH` | `/:id/toggle-featured` | — | Toggle featured status |
| `DELETE` | `/bulk-delete` | `{ ids: [1,2,3] }` | Bulk delete |

### Post Create/Update Body

```json
{
  "title": "Gorilla Trekking in Rwanda: A Complete Guide",  // REQUIRED
  "slug": "gorilla-trekking-rwanda-guide",                   // Auto-generated
  "content": "<p>Full HTML content...</p>",
  "excerpt": "Short summary...",
  "image_url": "https://...",
  "cover_image_url": "https://...",
  "author_name": "Jane Doe",
  "author_avatar": "https://...",
  "category": "Travel Guide",
  "tags": ["rwanda", "gorillas", "safari"],
  "is_published": true,
  "is_featured": true,
  "meta_title": "...",
  "meta_description": "..."
}
```

---

## 📅 Bookings (`/api/bookings`)

### Public
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `POST` | `/` | See **Booking Create** below | Create new booking (rate limited: 10/15min) |
| `GET` | `/track/:bookingNumber` | — | Track booking status |
| `GET` | `/most-booked` | — | Most popular destinations |
| `GET` | `/by-destination/:destinationId` | — | Bookings per destination |
| `GET` | `/by-country/:countryId` | — | Bookings per country |
| `GET` | `/countries-stats` | — | Country booking stats |
| `GET` | `/destinations-stats` | — | Destination booking stats |

### Authenticated User
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/my-bookings` | Current user's bookings |

### Admin
| Method | Endpoint | Body / Query | Description |
|--------|----------|--------------|-------------|
| `GET` | `/stats` | — | Dashboard booking stats |
| `GET` | `/upcoming` | — | Upcoming bookings |
| `GET` | `/recent` | — | Recent bookings |
| `GET` | `/export` | `?format=csv&status=confirmed` | Export bookings |
| `POST` | `/bulk-status` | `{ ids: [1,2], status: "confirmed" }` | Bulk status update |
| `GET` | `/` | `?page=1&limit=20&status=pending` | List all bookings |
| `GET` | `/:id` | — | Single booking details |
| `PUT` | `/:id` | Partial fields | Update booking |
| `DELETE` | `/:id` | — | Delete booking |
| `PATCH` | `/:id/status` | `{ status: "confirmed" }` | Update status |
| `POST` | `/:id/confirm` | — | Confirm booking |
| `POST` | `/:id/cancel` | `{ reason: "..." }` | Cancel booking |
| `POST` | `/:id/notes` | `{ notes: "..." }` | Add admin notes |

### Booking Create Body (Public)

```json
{
  "full_name": "John Doe",           // REQUIRED
  "email": "john@example.com",       // REQUIRED, valid email
  "phone": "+250788123456",
  "whatsapp": "+250788123456",
  "nationality": "American",
  "destination_id": 5,
  "service_id": null,
  "travel_date": "2026-06-15",
  "return_date": "2026-06-20",
  "number_of_travelers": 4,
  "number_of_adults": 2,
  "number_of_children": 2,
  "accommodation_type": "Luxury Lodge",
  "special_requests": "Honeymoon package, vegetarian meals",
  "booking_type": "destination"      // Options: destination, service, custom, package
}
```

### Booking Status Values
- `pending` → `confirmed`, `cancelled`, `on-hold`
- `confirmed` → `completed`, `cancelled`, `on-hold`
- `on-hold` → `confirmed`, `cancelled`, `pending`
- `completed` → `refunded`
- `cancelled` → `pending` (reopen)

---

## 🛎️ Services (`/api/services`)

| Method | Endpoint | Auth | Body Fields |
|--------|----------|------|-------------|
| `GET` | `/` | Public | — |
| `GET` | `/:id` | Public | — |
| `POST` | `/` | Admin | `title*, description, short_description, icon, image_url, features[], is_featured, sort_order` |
| `PUT` | `/:id` | Admin | Same as create (partial) |
| `DELETE` | `/:id` | Admin | — |

---

## ❓ FAQs (`/api/faqs`)

| Method | Endpoint | Auth | Body Fields |
|--------|----------|------|-------------|
| `GET` | `/` | Public | — |
| `GET` | `/:id` | Public | — |
| `POST` | `/` | Admin | `question*, answer*, category, sort_order, is_active` |
| `PUT` | `/:id` | Admin | Same as create (partial) |
| `DELETE` | `/:id` | Admin | — |

---

## 💡 Tips (`/api/tips`)

| Method | Endpoint | Auth | Query / Body |
|--------|----------|------|--------------|
| `GET` | `/categories` | Public | — |
| `GET` | `/` | Public | `?category=packing&page=1` |
| `GET` | `/:id` | Public | — |
| `POST` | `/` | Admin | See **Tip Body** below |
| `PUT` | `/:id` | Admin | Same as create (partial) |
| `DELETE` | `/:id` | Admin | — |

### Tip Body

```json
{
  "summary": "Pack light for gorilla trekking",   // REQUIRED
  "body": "Full detailed tip content...",
  "category": "Packing",
  "trip_phase": "pre-trip",
  "audience": "all-travelers",
  "difficulty_level": "all-levels",
  "priority_level": 3,
  "read_time_minutes": 5,
  "checklist": ["Hiking boots", "Rain jacket", "Camera"],
  "tags": ["packing", "trekking"],
  "icon": "backpack",
  "image_url": "https://...",
  "source_url": "https://...",
  "cta_text": "Book a Trek",
  "cta_url": "/destinations/volcanoes",
  "sort_order": 1,
  "is_featured": true,
  "is_active": true
}
```

---

## 👥 Team Members (`/api/team`)

### Public
| Method | Endpoint | Query Params | Description |
|--------|----------|--------------|-------------|
| `GET` | `/` | `?department=Guides&is_featured=true&search=jean` | List active members |
| `GET` | `/featured` | — | Featured members |
| `GET` | `/departments/list` | — | All departments |
| `GET` | `/stats` | — | Team stats |
| `GET` | `/department/:department` | — | Members by department |
| `GET` | `/:identifier` | — | Single member (id or slug) |

### Admin
| Method | Endpoint | Body / Notes | Description |
|--------|----------|--------------|-------------|
| `GET` | `/admin/all` | `?search=...&page=1` | All members (including inactive) |
| `POST` | `/` | `multipart/form-data` with `image` + JSON | Create member |
| `PUT` | `/:id` | Same as create | Update member |
| `DELETE` | `/:id` | — | Delete member |
| `DELETE` | `/bulk-delete` | `{ ids: [1,2,3] }` | Bulk delete |
| `PATCH` | `/reorder` | `{ orders: [{id:1, order:0}, {id:2, order:1}] }` | Reorder |
| `PATCH` | `/:id/toggle-status` | — | Toggle is_active |
| `POST` | `/:id/duplicate` | — | Duplicate member |

### Team Member Body

```json
{
  "name": "Jean Mutabazi",           // REQUIRED
  "slug": "jean-mutabazi",           // Auto-generated
  "role": "Lead Safari Guide",       // REQUIRED
  "department": "Guides",
  "bio": "Expert wildlife guide with 10+ years...",
  "image_url": "https://...",
  "email": "jean@altuvera.com",
  "phone": "+250788123456",
  "whatsapp": "+250788123456",
  "linkedin_url": "https://linkedin.com/in/...",
  "twitter_url": "https://twitter.com/...",
  "instagram_url": "https://instagram.com/...",
  "website_url": "https://...",
  "expertise": ["Wildlife Tracking", "Bird Identification"],
  "languages": ["English", "French", "Swahili"],
  "certifications": ["First Aid", "Wildlife Guide License"],
  "years_experience": 10,
  "location": "Serengeti",
  "country": "Tanzania",
  "display_order": 1,
  "is_featured": true,
  "show_on_homepage": true,
  "is_active": true,
  "meta_title": "Jean Mutabazi | Safari Guide",
  "meta_description": "...",
  "joined_date": "2018-03-15"
}
```

---

## 🖼️ Gallery (`/api/gallery`)

| Method | Endpoint | Auth | Body / Query |
|--------|----------|------|--------------|
| `GET` | `/categories` | Public | — |
| `GET` | `/` | Public | `?category=wildlife&page=1` |
| `GET` | `/:id` | Public | — |
| `POST` | `/bulk` | Admin | `multipart/form-data` with `images` (max 50) + `category, location` |
| `POST` | `/` | Admin | `multipart/form-data` with `image` + JSON fields |
| `PUT` | `/:id` | Admin | Same as create |
| `DELETE` | `/:id` | Admin | — |

### Gallery Item Body

```json
{
  "title": "Mountain Gorilla Portrait",
  "description": "A silverback in Volcanoes National Park",
  "category": "Wildlife",
  "location": "Volcanoes National Park, Rwanda",
  "country_id": 1,
  "destination_id": 5,
  "photographer": "Jane Doe",
  "sort_order": 1,
  "is_featured": true,
  "is_active": true
}
```

---

## 📨 Contact Messages (`/api/contact`)

### Public
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `POST` | `/` | See **Contact Body** | Submit message (rate limited: 5/15min) |

### Admin
| Method | Endpoint | Query / Body | Description |
|--------|----------|--------------|-------------|
| `GET` | `/` | `?page=1&limit=20&status=new&search=john` | List messages |
| `GET` | `/stats` | — | Message statistics |
| `GET` | `/export` | `?format=csv` | Export messages |
| `POST` | `/bulk` | `{ ids: [1,2], status: "read" }` | Bulk update |
| `GET` | `/:id` | — | Single message |
| `PUT` | `/:id` | `{ status, priority, assigned_to, tags, notes }` | Update message |
| `DELETE` | `/:id` | — | Delete message |
| `PATCH` | `/:id/read` | — | Mark as read |
| `PATCH` | `/:id/unread` | — | Mark as unread |
| `PATCH` | `/:id/star` | — | Toggle star |
| `PATCH` | `/:id/archive` | — | Archive message |
| `PATCH` | `/:id/spam` | — | Mark as spam |
| `POST` | `/:id/reply` | `{ subject, body }` | Reply to message |

### Contact Submit Body (Public)

```json
{
  "full_name": "John Doe",           // REQUIRED
  "email": "john@example.com",       // REQUIRED
  "phone": "+250788123456",
  "whatsapp": "+250788123456",
  "subject": "Booking Inquiry",
  "message": "I want to book a gorilla trekking trip...",  // REQUIRED
  "trip_type": "Gorilla Trekking",
  "travel_date": "2026-07-15",
  "number_of_travelers": 4,
  "source": "website"
}
```

### Message Status Values
`new`, `read`, `replied`, `archived`, `spam`

### Priority Values
`low`, `normal`, `high`, `urgent`

---

## 📧 Subscribers (`/api/subscribers`)

### Public
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `POST` | `/` | `{ email: "..." }` | Subscribe (rate limited) |
| `GET` | `/unsubscribe/:email` | — | Unsubscribe via email link |
| `DELETE` | `/unsubscribe/:email` | — | Unsubscribe via API |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | List all subscribers |
| `DELETE` | `/:id` | Delete subscriber |

---

## 📄 Pages (`/api/pages`)

| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| `GET` | `/` | Public | — |
| `GET` | `/:slug` | Public | — |
| `POST` | `/` | Admin | `title*, slug*, content, meta_title, meta_description, is_published` |
| `PUT` | `/:id` | Admin | Same as create (partial) |
| `DELETE` | `/:id` | Admin | — |

---

## 🎥 Virtual Tours (`/api/virtual-tours`)

| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| `GET` | `/` | Public | — |
| `GET` | `/:id` | Public | — |
| `POST` | `/` | Admin | `title*, slug*, description, destination_id, video_url, thumbnail_url, panorama_url, duration, is_featured, sort_order` |
| `PUT` | `/:id` | Admin | Same as create (partial) |
| `DELETE` | `/:id` | Admin | — |

---

## ⚙️ Settings (`/api/settings`)

| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| `GET` | `/` | Public | — |
| `GET` | `/:id` | Public | — |
| `PUT` | `/:id` | Admin | `{ value: "..." }` |

**Common Settings Keys:**
- `site_title`
- `site_description`
- `contact_email`
- `contact_phone`
- `whatsapp_number`
- `social_facebook`
- `social_instagram`
- `social_twitter`
- `social_linkedin`
- `google_analytics_id`
- `meta_default_title`
- `meta_default_description`

---

## 📤 Uploads (`/api/uploads`)

| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| `POST` | `/image` | Auth | `multipart/form-data` with `image` file |
| `POST` | `/images` | Auth | `multipart/form-data` with `images` files |
| `POST` | `/image/:folder` | Auth | `multipart/form-data` with `image` file → uploads to folder |
| `DELETE` | `/asset/:publicId` | Auth | — |
| `GET` | `/stats` | Auth | — |

---

## 🖼️ Media Uploads (`/api/media`)

**Destination Images:**
| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| `POST` | `/destinations/:id/images` | Admin | `multipart/form-data` with `images` (max 10) |
| `DELETE` | `/destinations/:id/images/:imageId` | Admin | — |
| `PUT` | `/destinations/:id/images/reorder` | Admin | `{ imageIds: [3,1,2] }` |

**Gallery Uploads:**
| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| `POST` | `/gallery/upload` | Admin | `multipart/form-data` with `images` (max 20) |
| `DELETE` | `/gallery/:id` | Admin | — |

**Country Images:**
| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| `POST` | `/countries/:id/flag` | Admin | `multipart/form-data` with `flag` file |
| `POST` | `/countries/:id/images` | Admin | `multipart/form-data` with `images` (max 10) |
| `DELETE` | `/countries/:id/images/:imageUrl` | Admin | — |

---

## 👤 Admin Auth (`/api/admin/auth`)

| Method | Endpoint | Auth | Body | Description |
|--------|----------|------|------|-------------|
| `POST` | `/login` | — | `{ email, password }` | Admin login |
| `POST` | `/refresh-token` | — | `{ refreshToken }` | Refresh JWT |
| `POST` | `/register` | Admin | `{ username, email, password, full_name, role }` | Create admin |
| `GET` | `/me` | Admin | — | Get current admin |
| `PUT` | `/me` | Admin | `{ full_name, avatar_url }` | Update profile |
| `PUT` | `/profile` | Admin | Same as `/me` | Alias |
| `PUT` | `/change-password` | Admin | `{ currentPassword, newPassword }` | Change password |
| `POST` | `/logout` | Admin | — | Logout |
| `DELETE` | `/me` | Admin | — | Delete own account |

---

## 👥 Public Users (`/api/users`)

| Method | Endpoint | Auth | Body | Description |
|--------|----------|------|------|-------------|
| `POST` | `/register` | — | `{ email*, full_name* }` | Request OTP |
| `POST` | `/login` | — | `{ email* }` | Request login OTP |
| `POST` | `/verify-code` | — | `{ email*, code* }` | Verify OTP |
| `POST` | `/resend-code` | — | `{ email* }` | Resend OTP |
| `POST` | `/check-email` | — | `{ email* }` | Check if email exists |
| `POST` | `/google` | — | `{ token }` | Google OAuth login |
| `POST` | `/github` | — | `{ code }` | GitHub OAuth login |
| `POST` | `/refresh-token` | — | `{ refreshToken }` | Refresh JWT |
| `GET` | `/me` | User | — | Get current user |
| `PUT` | `/profile` | User | `{ full_name, phone, nationality, avatar_url, preferences }` | Update profile |
| `POST` | `/logout` | User | — | Logout |
| `DELETE` | `/me` | User | — | Delete account |

---

## 🔗 Engagement Endpoints

### Country Likes (`/api/country-likes`)
| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| `GET` | `/:countryId` | — | — |
| `POST` | `/:countryId` | Auth | — |
| `DELETE` | `/:countryId` | Auth | — |

### Country Comments (`/api/country-comments`)
| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| `GET` | `/:countryId` | — | — |
| `POST` | `/:countryId` | Auth | `{ content }` |
| `DELETE` | `/:commentId` | Admin | — |

### Country Ratings (`/api/country-ratings`)
| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| `GET` | `/:countryId` | — | — |
| `POST` | `/:countryId` | Auth | `{ rating: 1-5, review }` |

### Destination Likes (`/api/destination-likes`)
Same pattern as country-likes.

### Destination Comments (`/api/destination-comments`)
Same pattern as country-comments.

### Destination Ratings (`/api/destination-ratings`)
Same pattern as country-ratings.

---

## 📐 Common Query Parameters

### Pagination
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | 1 | Page number |
| `limit` | integer | 20 | Items per page (max 100) |

### Sorting
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `sort` | string | varies | Field to sort by |
| `order` | string | `ASC` | `ASC` or `DESC` |

### Filtering
| Param | Type | Example | Description |
|-------|------|---------|-------------|
| `search` | string | `gorilla` | Full-text search |
| `status` | string | `published` | Filter by status |
| `category` | string | `safari` | Filter by category |
| `is_featured` | boolean | `true` | Featured only |
| `is_active` | boolean | `true` | Active only |

---

## 📦 HTTP Status Codes

| Code | Meaning | When Used |
|------|---------|-----------|
| `200` | OK | Successful GET, PUT, PATCH |
| `201` | Created | Successful POST |
| `204` | No Content | Successful DELETE (sometimes) |
| `400` | Bad Request | Validation errors, missing required fields |
| `401` | Unauthorized | Missing/invalid/expired token |
| `403` | Forbidden | Valid token but insufficient privileges |
| `404` | Not Found | Resource doesn't exist |
| `409` | Conflict | Duplicate data (e.g., slug already exists) |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Server Error | Unexpected server error |

---

## 🗄️ Database Table Reference

| Entity | Table | Key Fields |
|--------|-------|------------|
| Admin Users | `admin_users` | `id, username, email, role, is_active` |
| Countries | `countries` | `id, slug, name, continent, is_featured, is_active` |
| Country Airports | `country_airports` | `id, country_id, name, code` |
| Country Festivals | `country_festivals` | `id, country_id, name, month` |
| Country UNESCO | `country_unesco_sites` | `id, country_id, name, year_inscribed` |
| Country History | `country_historical_events` | `id, country_id, year, event` |
| Destinations | `destinations` | `id, country_id, slug, name, status, is_featured` |
| Destination Images | `destination_images` | `id, destination_id, image_url, is_primary` |
| Destination Itinerary | `destination_itineraries` | `id, destination_id, day_number, title` |
| Destination FAQs | `destination_faqs` | `id, destination_id, question, answer` |
| Destination Reviews | `destination_reviews` | `id, destination_id, overall_rating, status` |
| Destination Tags | `destination_tags` | `id, destination_id, tag_name, tag_slug` |
| Posts | `posts` | `id, slug, title, is_published, is_featured` |
| Services | `services` | `id, slug, title, is_featured, sort_order` |
| FAQs | `faqs` | `id, question, category, is_active` |
| Tips | `tips` | `id, slug, summary, category, is_featured` |
| Team Members | `team_members` | `id, slug, name, role, department, is_active` |
| Gallery | `gallery` | `id, image_url, category, is_featured` |
| Bookings | `bookings` | `id, booking_number, status, email` |
| Contact | `contact_messages` | `id, status, priority, is_read, is_starred` |
| Pages | `pages` | `id, slug, title, is_published` |
| Virtual Tours | `virtual_tours` | `id, slug, title, destination_id` |
| Subscribers | `subscribers` | `id, email, is_active` |
| Settings | `site_settings` | `id, key, value` |
| Users | `users` | `id, email, full_name, auth_provider, is_verified` |

---

## 🧪 Quick Test Examples

```bash
# Admin Login
curl -X POST https://api.altuvera.com/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@altuvera.com","password":"yourpassword"}'

# Create Country
curl -X POST https://api.altuvera.com/api/countries \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Uganda","capital":"Kampala","continent":"Africa"}'

# List Bookings (Admin)
curl "https://api.altuvera.com/api/bookings?page=1&limit=20&status=pending" \
  -H "Authorization: Bearer <token>"

# Update Booking Status
curl -X PATCH https://api.altuvera.com/api/bookings/123/status \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status":"confirmed"}'

# Upload Image
curl -X POST https://api.altuvera.com/api/uploads/image \
  -H "Authorization: Bearer <token>" \
  -F "image=@/path/to/photo.jpg"
```

---

## 📝 Notes for Frontend Developers

1. **Always include `Authorization: Bearer <token>`** on admin routes.
2. **Handle 401/403 gracefully** — redirect to login when token expires.
3. **Use `multipart/form-data`** when uploading files (images).
4. **Check `pagination` object** in list responses for infinite scroll or page controls.
5. **Slug fields are auto-generated** from `name`/`title` if not provided.
6. **Array fields** can be sent as JSON arrays or comma-separated strings.
7. **JSONB fields** (`seasons`, `wildlife`, `cuisine`, etc.) must be valid JSON objects.
8. **Rate limits apply** to public endpoints like contact form and bookings.
9. **CORS is configured** for `https://altuvera.com` and `localhost` in dev.
10. **Cache headers** are set automatically — no special handling needed.

---

*Generated: 2026-04-24 | Altuvera Travel API v6.1*
