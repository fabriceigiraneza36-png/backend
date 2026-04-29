# 🏔️ Destinations API Documentation

> **Backend Base URL:** `http://localhost:3000`  
> **Routes Prefix:** `/api/destinations`  
> **Full Destinations Base URL:** `http://localhost:3000/api/destinations`

---

## 📋 Table of Contents

1. [Public Routes](#public-routes)  
2. [Admin Routes (Protected)](#admin-routes-protected)  
3. [Query Parameters & Filtering](#query-parameters--filtering)  
4. [Request Body Fields](#request-body-fields)  
5. [Response Format](#response-format)  
6. [Examples](#examples)  
7. [Error Handling](#error-handling)  
8. [Country Relationship](#country-relationship)  

---

## 🚪 Public Routes (No Authentication Required)

### `GET /api/destinations`

List all published destinations with powerful filtering, sorting, and pagination.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `12` | Items per page (max 100) |
| `sort` | string | `featured` | Sort order (see **Sorting Options** below) |
| `search` / `q` | string | — | Full-text search in name, description, country name |
| `country` | string | — | Filter by country slug or ID |
| `country_id` | integer | — | Filter by country ID (numeric) |
| `countrySlug` | string | — | Filter by country slug |
| `continent` | string | — | Filter by continent (via country) |
| `category` | string | — | Filter by category (e.g., `National Park`, `Mountain`, `Lake`, `Museum`) |
| `difficulty` | string | — | Filter by difficulty (`Easy`, `Moderate`, `Challenging`, `Expert`) |
| `minRating` | number | — | Minimum rating (1-5) |
| `minDuration` / `maxDuration` | integer | — | Filter by duration in days |
| `featured` / `popular` / `new` / `eco_friendly` / `family_friendly` | boolean | — | Filter by boolean flags |
| `tag` | string | — | Filter by tag slug |
| `bounds` | string | — | Map bounds as `swLat,swLng,neLat,neLng` (comma-separated) |
| `exclude` | string | — | Exclude destination IDs (comma-separated or JSON array) |
| `includeUnpublished` | boolean | `false` | Include `draft`/`archived` status (admin only) |

**Sort Options (`sort` param):**
| Value | Order By |
|-------|----------|
| `featured` | Featured flag ↓, popular ↓, rating ↓ |
| `popular` | Booking count ↓, view count ↓ |
| `newest` | Published date ↓, created ↓ |
| `oldest` | Created ↑ |
| `rating` | Rating ↓ (nulls last) |
| `name` | Name ASC |
| `-name` | Name DESC |
| `views` | View count ↓ |
| `duration` | Duration days ASC |
| `-duration` | Duration days DESC |
| `random` | Random order |

**Example:**  
`GET http://localhost:3000/api/destinations?page=1&limit=20&category=National%20Park&country=rwanda&sort=rating&minRating=4`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 5,
      "slug": "volcanoes-national-park",
      "name": "Volcanoes National Park",
      "tagline": "Home of the Mountain Gorillas",
      "shortDescription": "A UNESCO World Heritage site...",
      "description": "<p>Full HTML description...</p>",
      "overview": "Overview text...",
      "highlights": ["Gorilla trekking", "Golden monkey tracking", "Dian Fossey tomb"],
      "activities": ["Hiking", "Bird watching", "Photography"],
      "wildlife": ["Mountain Gorilla", "Golden Monkey", "Black-and-white Colobus"],
      "bestTimeToVisit": "June to September",
      "gettingThere": "2 hours drive from Kigali...",
      "whatToExpect": "Early morning starts...",
      "localTips": "Book permits 3 months in advance...",
      "safetyInfo": "Altitude sickness possible...",
      "category": "National Park",
      "difficulty": "Moderate",
      "destinationType": "Safari",
      "country": {
        "id": 1,
        "slug": "rwanda",
        "name": "Rwanda",
        "flag": "🇷🇼",
        "flagUrl": null,
        "continent": "Africa",
        "region": "East Africa"
      },
      "countryId": 1,
      "countrySlug": "rwanda",
      "countryName": "Rwanda",
      "region": "Northern Province",
      "nearestCity": "Musanze",
      "nearestAirport": "Kigali International Airport",
      "distanceFromAirportKm": 105.00,
      "address": "Kinigi, Musanze District",
      "mapPosition": { "lat": -1.4833, "lng": 29.5167 },
      "latitude": -1.4833,
      "longitude": 29.5167,
      "altitudeMeters": 2400,
      "images": ["https://...", "https://..."],
      "imageUrl": "https://...",
      "heroImage": "https://...",
      "thumbnailUrl": "https://...",
      "videoUrl": null,
      "virtualTourUrl": null,
      "duration": "3 Days / 2 Nights",
      "durationDays": 3,
      "durationNights": 2,
      "minGroupSize": 2,
      "maxGroupSize": 8,
      "minAge": 15,
      "fitnessLevel": "Moderate fitness required",
      "rating": 4.8,
      "reviewCount": 127,
      "viewCount": 15420,
      "bookingCount": 890,
      "wishlistCount": 2340,
      "entranceFee": "$75 per person",
      "operatingHours": "6:00 AM - 6:00 PM",
      "isSoldOut": false,
      "status": "published",
      "isActive": true,
      "isFeatured": true,
      "isPopular": true,
      "isNew": false,
      "isEcoFriendly": true,
      "isFamilyFriendly": false,
      "metaTitle": "Volcanoes National Park | Altuvera",
      "metaDescription": "Gorilla trekking in Rwanda...",
      "createdAt": "2025-01-15T10:30:00Z",
      "updatedAt": "2025-03-20T14:22:00Z",
      "publishedAt": "2025-01-20T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 342,
    "totalPages": 18
  },
  "meta": {
    "sort": "featured",
    "filters": { "country": "rwanda", "category": "National Park" }
  }
}
```

---

### `GET /api/destinations/featured`

Get featured destinations (ordered by `featured_at` then rating).

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | `8` | Max results |
| `country` | string | — | Filter by country slug/ID |
| `continent` | string | — | Filter by continent |

**Example:**  
`GET http://localhost:3000/api/destinations/featured?limit=8&continent=Africa`

**Response:**
```json
{
  "success": true,
  "data": [ /* array of destination objects */ ],
  "count": 8
}
```

---

### `GET /api/destinations/popular`

Get popular destinations (by booking count, then view count).

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | `8` | Max results |
| `country` | string | — | Filter by country |

**Example:**  
`GET http://localhost:3000/api/destinations/popular?country=kenya`

---

### `GET /api/destinations/new`

Get newest published destinations (by `published_at` descending).

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | `8` | Max results |

**Example:**  
`GET http://localhost:3000/api/destinations/new?limit=5`

---

### `GET /api/destinations/search`

Search destinations by name, description, or country name.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | **required** | Search term (min 2 chars recommended) |
| `limit` | integer | `20` | Max results |

**Example:**  
`GET http://localhost:3000/api/destinations/search?q=gorilla&limit=15`

**Response:**
```json
{
  "success": true,
  "data": [ /* matching destinations */ ]
}
```

---

### `GET /api/destinations/suggestions`

Get autocomplete suggestions for search input.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | **required** | Partial search term |
| `limit` | integer | `10` | Max suggestions |

**Example:**  
`GET http://localhost:3000/api/destinations/suggestions?query=mount&limit=10`

**Response:**
```json
{
  "success": true,
  "data": [
    { "id": 12, "slug": "mount-kilimanjaro", "name": "Mount Kilimanjaro", "country": "Tanzania", "category": "Mountain" },
    { "id": 45, "slug": "mount-kenya", "name": "Mount Kenya", "country": "Kenya", "category": "Mountain" }
  ]
}
```

---

### `GET /api/destinations/categories`

Get all unique destination categories with counts.

**Example:**  
`GET http://localhost:3000/api/destinations/categories`

**Response:**
```json
{
  "success": true,
  "data": [
    { "category": "National Park", "count": 124 },
    { "category": "Mountain", "count": 45 },
    { "category": "Lake", "count": 32 },
    { "category": "Beach", "count": 28 },
    { "category": "Museum", "count": 18 }
  ]
}
```

---

### `GET /api/destinations/difficulties`

Get all difficulty levels with counts.

**Example:**  
`GET http://localhost:3000/api/destinations/difficulties`

**Response:**
```json
{
  "success": true,
  "data": [
    { "difficulty": "Easy", "count": 89 },
    { "difficulty": "Moderate", "count": 156 },
    { "difficulty": "Challenging", "count": 67 },
    { "difficulty": "Expert", "count": 30 }
  ]
}
```

---

### `GET /api/destinations/tags`

Get all destination tags with counts.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `limit` | integer | Max tags to return |

**Example:**  
`GET http://localhost:3000/api/destinations/tags?limit=50`

**Response:**
```json
{
  "success": true,
  "data": [
    { "tag_name": "gorilla trekking", "tag_slug": "gorilla-trekking", "tag_category": "activity", "count": 42 },
    { "tag_name": "wildlife", "tag_slug": "wildlife", "tag_category": "nature", "count": 156 }
  ]
}
```

---

### `GET /api/destinations/stats`

Get dashboard statistics.

**Example:**  
`GET http://localhost:3000/api/destinations/stats`

**Response:**
```json
{
  "success": true,
  "data": {
    "total_destinations": 342,
    "published_destinations": 298,
    "featured_destinations": 56,
    "total_categories": 12,
    "avg_rating": 4.52,
    "most_booked_destination": "Volcanoes National Park",
    "total_reviews": 8547
  }
}
```

---

### `GET /api/destinations/map`

Get coordinates data for mapping applications.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `bounds` | string | Optional bounding box `swLat,swLng,neLat,neLng` |
| `country` | string | Optional country filter |
| `category` | string | Optional category filter |

**Example:**  
`GET http://localhost:3000/api/destinations/map?country=rwanda`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 5,
      "slug": "volcanoes-national-park",
      "name": "Volcanoes National Park",
      "mapPosition": { "lat": -1.4833, "lng": 29.5167 },
      "country": { "id": 1, "slug": "rwanda", "name": "Rwanda", "flag": "🇷🇼" },
      "category": "National Park",
      "isFeatured": true
    }
  ]
}
```

---

### `GET /api/destinations/country/:countrySlug`

Get all destinations in a specific country (alias for `/api/countries/:slug/destinations` with different ordering).

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `countrySlug` | string | Country slug (e.g., `rwanda`) |

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `20` | Items per page |
| `category` | string | — | Filter by category |
| `search` | string | — | Search in destination name/description |

**Example:**  
`GET http://localhost:3000/api/destinations/country/kenya?limit=15`

---

### `GET /api/destinations/:idOrSlug`

Get a single destination by ID or slug.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `idOrSlug` | string | Destination database ID or slug |

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `includeRelations` | boolean | `true` | Include gallery, itinerary, FAQs, reviews, tags, related |

**Examples:**  
`GET http://localhost:3000/api/destinations/5`  
`GET http://localhost:3000/api/destinations/volcanoes-national-park`  
`GET http://localhost:3000/api/destinations/volcanoes-national-park?includeRelations=false`

**Response (with relations):**
```json
{
  "success": true,
  "data": {
    "id": 5,
    "slug": "volcanoes-national-park",
    "name": "Volcanoes National Park",
    "tagline": "Home of the Mountain Gorillas",
    "shortDescription": "Short summary...",
    "description": "<p>Full description...</p>",
    "overview": "Detailed overview...",
    "highlights": ["Gorilla trekking", "Golden monkey tracking"],
    "activities": ["Hiking", "Bird watching", "Photography"],
    "wildlife": ["Mountain Gorilla", "Golden Monkey"],
    "bestTimeToVisit": "June to September",
    "gettingThere": "2 hours drive from Kigali...",
    "whatToExpect": "Early morning starts...",
    "localTips": "Book permits 3 months ahead...",
    "safetyInfo": "Altitude sickness possible...",
    "category": "National Park",
    "difficulty": "Moderate",
    "destinationType": "Safari",
    "region": "Northern Province",
    "nearestCity": "Musanze",
    "nearestAirport": "Kigali International Airport",
    "distanceFromAirportKm": 105.00,
    "address": "Kinigi, Musanze District",
    "mapPosition": { "lat": -1.4833, "lng": 29.5167 },
    "images": ["https://...", "https://..."],
    "imageUrl": "https://...",
    "coverImageUrl": "https://...",
    "heroImage": "https://...",
    "thumbnailUrl": "https://...",
    "videoUrl": null,
    "virtualTourUrl": null,
    "duration": "3 Days / 2 Nights",
    "durationDays": 3,
    "durationNights": 2,
    "minGroupSize": 2,
    "maxGroupSize": 8,
    "minAge": 15,
    "fitnessLevel": "Moderate fitness required",
    "entranceFee": "$75 per person",
    "operatingHours": "6:00 AM - 6:00 PM",
    "isSoldOut": false,
    "status": "published",
    "isActive": true,
    "isFeatured": true,
    "isPopular": true,
    "isNew": false,
    "isEcoFriendly": true,
    "isFamilyFriendly": false,
    "rating": 4.8,
    "reviewCount": 127,
    "viewCount": 15420,
    "bookingCount": 890,
    "wishlistCount": 2340,
    "metaTitle": "Volcanoes National Park | Altuvera",
    "metaDescription": "...",
    "createdAt": "2025-01-15T...",
    "updatedAt": "2025-03-20T...",
    "publishedAt": "2025-01-20T...",

    // Relations (if includeRelations=true)
    "gallery": [
      { "id": 1, "image_url": "https://...", "caption": "Gorilla family", "is_primary": false, "sort_order": 1 }
    ],
    "itinerary": [
      { "id": 1, "day_number": 1, "title": "Arrival in Kigali", "description": "...", "activities": ["Airport pickup", "City tour"], "meals": ["Lunch", "Dinner"], "accommodation": "Kigali Hotel" }
    ],
    "faqs": [
      { "id": 1, "question": "What is the gorilla permit cost?", "answer": "$1500 per person...", "category": "pricing", "sort_order": 1 }
    ],
    "reviews": [
      {
        "id": 1,
        "reviewerName": "John Doe",
        "reviewerCountry": "USA",
        "title": "Incredible experience!",
        "content": "Best trip ever...",
        "rating": 5,
        "tripDate": "2025-06-15",
        "tripType": "Safari",
        "images": ["https://..."],
        "isVerified": true,
        "isFeatured": true,
        "helpfulCount": 24,
        "createdAt": "2025-06-20T..."
      }
    ],
    "tags": [
      { "id": 1, "tag_name": "gorilla trekking", "tag_slug": "gorilla-trekking", "tag_category": "activity" }
    ],
    "related": [ /* array of related destination objects */ ],
    "nearby": [ /* array of nearby destinations */ ]
  }
}
```

---

### `GET /api/destinations/:idOrSlug/related`

Get related destinations (based on same country, category, or tags).

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `idOrSlug` | string | Destination ID or slug |

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | `6` | Number of related destinations |

**Example:**  
`GET http://localhost:3000/api/destinations/volcanoes-national-park/related?limit=6`

**Response:**
```json
{
  "success": true,
  "data": [ /* array of destination objects */ ]
}
```

---

### `GET /api/destinations/:id/reviews`

Get reviews for a destination.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `20` | Items per page |
| `verified` | boolean | — | Filter verified reviews only |

**Example:**  
`GET http://localhost:3000/api/destinations/5/reviews?page=1&limit=10`

---

### `POST /api/destinations/:id/reviews`

Submit a review for a destination (public, authenticated optional).

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |

**Request:**
- **Content-Type:** `multipart/form-data` (with images) OR `application/json`
- **Upload limit:** Max 5 images per review

**Body Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reviewer_name` | string | Yes | Reviewer name |
| `reviewer_country` | string | No | Reviewer nationality |
| `reviewer_avatar` | string | No | Avatar URL |
| `title` | string | No | Review title |
| `content` | string | **Yes** | Review text |
| `overall_rating` | integer | Yes | Rating 1-5 |
| `trip_date` | date | No | Date of trip (ISO: `2025-06-15`) |
| `trip_type` | string | No | e.g., `Safari`, `Honeymoon`, `Family` |
| `images` | files | No | Up to 5 image files |

**Example (JSON):**
```json
{
  "reviewer_name": "John Doe",
  "reviewer_country": "USA",
  "title": "Incredible gorilla experience",
  "content": "The trek was challenging but absolutely worth it...",
  "overall_rating": 5,
  "trip_date": "2025-06-15",
  "trip_type": "Safari"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "reviewerName": "John Doe",
    "rating": 5,
    "content": "...",
    "isVerified": false,
    "createdAt": "2025-06-20T..."
  }
}
```

---

### `POST /api/destinations/:id/reviews/:reviewId/helpful`

Mark a review as helpful (toggles).

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |
| `reviewId` | integer | Review ID |

**Example:**  
`POST http://localhost:3000/api/destinations/5/reviews/12/helpful`

**Response:**
```json
{
  "success": true,
  "data": { "helpfulCount": 25 }
}
```

---

### `GET /api/destinations/:id/images`

Get all images for a destination (with captions, ordering).

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |

**Example:**  
`GET http://localhost:3000/api/destinations/5/images`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "image_url": "https://...",
      "caption": "Gorilla family in the mist",
      "is_primary": true,
      "sort_order": 1,
      "created_at": "2025-01-15T..."
    }
  ]
}
```

---

### `POST /api/destinations/:id/view`

Increment view counter (public engagement).

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |

**Example:**  
`POST http://localhost:3000/api/destinations/5/view`

**Response:**
```json
{
  "success": true,
  "data": { "viewCount": 15421 }
}
```

---

### `POST /api/destinations/:id/wishlist`

Increment wishlist counter.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |

**Example:**  
`POST http://localhost:3000/api/destinations/5/wishlist`

---

### `POST /api/destinations/:id/share`

Increment share counter.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |

**Example:**  
`POST http://localhost:3000/api/destinations/5/share`

---

## 🔐 Admin Routes (Require Authentication + Admin Role)

**Required Headers:**
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

`multipart/form-data` when uploading files.

---

### `POST /api/destinations`

Create a new destination.

**Request Body:** See **Destination Create/Update Fields** below.

**Multipart Example (with image):**
```bash
curl -X POST http://localhost:3000/api/destinations \
  -H "Authorization: Bearer <token>" \
  -F "image=@/path/to/main-image.jpg" \
  -F "country_id=1" \
  -F "name=Volcanoes National Park" \
  -F "category=National Park" \
  -F "difficulty=Moderate" \
  -F "description=..." \
  -F "highlights[]=Gorilla trekking" \
  -F "highlights[]=Golden monkeys" \
  -F "activities[]=Hiking" \
  -F "duration_days=3" \
  -F "duration_nights=2" \
  -F "min_group_size=2" \
  -F "max_group_size=8" \
  -F "min_age=15" \
  -F "entrance_fee=$75 per person"
```

**JSON Example:**
```bash
curl -X POST http://localhost:3000/api/destinations \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "country_id": 1,
    "name": "Volcanoes National Park",
    "category": "National Park",
    "difficulty": "Moderate",
    "destination_type": "Safari",
    "short_description": "Home of the endangered mountain gorilla...",
    "description": "Full HTML description...",
    "overview": "Overview text...",
    "highlights": ["Gorilla trekking", "Dian Fossey tomb", "Golden monkey tracking"],
    "activities": ["Hiking", "Bird watching", "Photography"],
    "wildlife": ["Mountain Gorilla", "Golden Monkey"],
    "best_time_to_visit": "June to September",
    "getting_there": "2 hours drive from Kigali...",
    "what_to_expect": "Early morning starts...",
    "local_tips": "Book permits in advance...",
    "safety_info": "Altitude sickness possible...",
    "region": "Northern Province",
    "nearest_city": "Musanze",
    "nearest_airport": "Kigali International Airport",
    "distance_from_airport_km": 105,
    "address": "Kinigi, Musanze District",
    "latitude": -1.4833,
    "longitude": 29.5167,
    "altitude_meters": 2400,
    "duration_days": 3,
    "duration_nights": 2,
    "min_group_size": 2,
    "max_group_size": 8,
    "min_age": 15,
    "fitness_level": "Moderate fitness required",
    "entrance_fee": "$75 per person",
    "operating_hours": "6:00 AM - 6:00 PM",
    "status": "published",
    "is_featured": true,
    "is_popular": false,
    "is_new": true,
    "is_eco_friendly": true,
    "is_family_friendly": false
  }'
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": { /* full destination object */ }
}
```

---

### `PUT /api/destinations/:id`

Update a destination (partial update). Slug cannot be changed.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination database ID |

**Example:**
```bash
curl -X PUT http://localhost:3000/api/destinations/5 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "tagline": "Experience the mountain gorillas",
    "is_featured": true,
    "entrance_fee": "$1500 per person"
  }'
```

---

### `DELETE /api/destinations/:id`

Soft delete a destination (`is_active = false`). Related data (images, itinerary, FAQs) remains.

**Example:**  
`DELETE http://localhost:3000/api/destinations/5`

**Response:**
```json
{
  "success": true,
  "message": "Destination deleted.",
  "data": { "id": 5, "name": "Volcanoes National Park", "is_active": false }
}
```

---

### `POST /api/destinations/:id/restore`

Restore a soft-deleted destination.

**Example:**  
`POST http://localhost:3000/api/destinations/5/restore`

---

### `PATCH /api/destinations/bulk`

Bulk update destinations (set same fields on multiple IDs).

**Body:**
```json
{
  "ids": [1, 2, 3, 4],
  "updates": {
    "is_featured": true,
    "status": "published"
  }
}
```

---

### `POST /api/destinations/:id/images`

Add multiple images to a destination (max 20).

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |

**Request:**
- **Content-Type:** `multipart/form-data`
- **Form field:** `images` (multiple files)

**Example (Node):**
```javascript
const FormData = require('form-data');
const form = new FormData();
form.append('images', fs.createReadStream('img1.jpg'));
form.append('images', fs.createReadStream('img2.jpg'));
form.append('images', fs.createReadStream('img3.jpg'));

fetch('http://localhost:3000/api/destinations/5/images', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, ...form.getHeaders() },
  body: form
});
```

**Response (201):**
```json
{
  "success": true,
  "message": "3 images added.",
  "data": [
    { "id": 1, "image_url": "...", "caption": null, "is_primary": false, "sort_order": 1 },
    { "id": 2, "image_url": "...", "caption": null, "is_primary": false, "sort_order": 2 },
    { "id": 3, "image_url": "...", "caption": null, "is_primary": false, "sort_order": 3 }
  ]
}
```

---

### `PUT /api/destinations/:id/images/:imageId`

Update an image's metadata.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |
| `imageId` | integer | Image record ID |

**Body:**
```json
{
  "caption": "Gorilla family in the mist",
  "is_primary": true,
  "sort_order": 1
}
```

**Example:**
```bash
curl -X PUT http://localhost:3000/api/destinations/5/images/1 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"caption":"Main gorilla photo","is_primary":true}'
```

---

### `DELETE /api/destinations/:id/images/:imageId`

Remove a single image.

**Example:**  
`DELETE http://localhost:3000/api/destinations/5/images/1`

**Response:**
```json
{
  "success": true,
  "message": "Image removed."
}
```

---

### `PUT /api/destinations/:id/images/reorder`

Reorder destination images (bulk update sort order).

**Body:**
```json
{
  "imageIds": [3, 1, 2, 4, 5]
}
```

**Example:**
```bash
curl -X PUT http://localhost:3000/api/destinations/5/images/reorder \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"imageIds":[2,1,3]}'
```

---

### `POST /api/destinations/:id/itinerary`

Add a day to the itinerary.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `day_number` | integer | **Yes** | Day sequence (1, 2, 3...) |
| `title` | string | **Yes** | Day title |
| `description` | string | No | Full description |
| `activities` | string[] | No | Array of activities |
| `meals` | string[] | No | Included meals |
| `accommodation` | string | No | Lodging/hotel name |
| `image_url` | string | No | Optional day image |

**Example:**
```bash
curl -X POST http://localhost:3000/api/destinations/5/itinerary \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "day_number": 1,
    "title": "Arrival in Kigali",
    "description": "You'll be picked up from the airport...",
    "activities": ["Airport pickup", "Hotel check-in", "City orientation"],
    "meals": ["Lunch", "Dinner"],
    "accommodation": "Kigali Serena Hotel"
  }'
```

---

### `PUT /api/destinations/:id/itinerary/:dayId`

Update an itinerary day.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |
| `dayId` | integer | Itinerary day ID |

**Body:** Same as add (all fields optional).

---

### `DELETE /api/destinations/:id/itinerary/:dayId`

Remove an itinerary day.

**Example:**  
`DELETE http://localhost:3000/api/destinations/5/itinerary/1`

---

### `POST /api/destinations/:id/faqs`

Add a frequently asked question.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | string | **Yes** | FAQ question |
| `answer` | string | **Yes** | FAQ answer |
| `category` | string | No | Grouping (e.g., `pricing`, `logistics`) |
| `sort_order` | integer | No | Display order |

**Example:**
```bash
curl -X POST http://localhost:3000/api/destinations/5/faqs \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is included in the price?",
    "answer": "Accommodation, meals, guide, permits, and transport.",
    "category": "pricing",
    "sort_order": 1
  }'
```

---

### `PUT /api/destinations/:id/faqs/:faqId`

Update an FAQ.

---

### `DELETE /api/destinations/:id/faqs/:faqId`

Remove an FAQ.

**Example:**  
`DELETE http://localhost:3000/api/destinations/5/faqs/3`

---

### `POST /api/destinations/:id/tags`

Add a tag to a destination.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Destination ID |

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tag_name` | string | **Yes** | Display name |
| `tag_slug` | string | **Yes** | URL-safe slug |
| `tag_category` | string | No | Category (e.g., `activity`, `feature`) |

**Example:**
```bash
curl -X POST http://localhost:3000/api/destinations/5/tags \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "tag_name": "gorilla trekking",
    "tag_slug": "gorilla-trekking",
    "tag_category": "activity"
  }'
```

---

### `DELETE /api/destinations/:id/tags/:tagId`

Remove a tag from a destination.

**Example:**  
`DELETE http://localhost:3000/api/destinations/5/tags/3`

---

## 📦 Destination Create/Update Body Fields Reference

### Required Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `country_id` | integer | **Yes (create)** | Must reference existing country |
| `name` | string | **Yes** | Min 2 chars; slug auto-generated |

---

### Core Information

| Field | Type | Description |
|-------|------|-------------|
| `slug` | string | Auto-generated from name if not provided |
| `tagline` | string | Short tagline (e.g., "Home of the Mountain Gorillas") |
| `short_description` | string | Brief summary (~150 chars) |
| `description` | string | Full description (HTML supported) |
| `overview` | string | Overview section (alternative to description) |

---

### Content Blocks

| Field | Type | Description |
|-------|------|-------------|
| `highlights` | string[] | Top attractions/experiences |
| `activities` | string[] | Available activities |
| `wildlife` | string[] | Notable wildlife species |
| `best_time_to_visit` | string | Recommended months |
| `getting_there` | string | Directions/transport info |
| `what_to_expect` | string | Visitor expectations |
| `local_tips` | string | Insider tips |
| `safety_info` | string | Safety guidelines |

---

### Classification

| Field | Type | Options | Description |
|-------|------|---------|-------------|
| `category` | string | Custom (e.g., `National Park`, `Mountain`, `Lake`, `Museum`, `Beach`, `City`, `Monument`) |
| `difficulty` | string | `Easy`, `Moderate`, `Challenging`, `Expert` |
| `destination_type` | string | e.g., `Safari`, `Adventure`, `Cultural`, `Beach`, `Mountain` |

---

### Location

| Field | Type | Description |
|-------|------|-------------|
| `region` | string | Internal region (e.g., `Northern Province`) |
| `nearest_city` | string | Nearest major city |
| `nearest_airport` | string | Nearest airport name |
| `distance_from_airport_km` | number | Distance in kilometers |
| `address` | string | Physical address |
| `latitude` | number | Decimal degrees (-90 to 90) |
| `longitude` | number | Decimal degrees (-180 to 180) |
| `altitude_meters` | number | Elevation above sea level |

---

### Media URLs

| Field | Type | Description |
|-------|------|-------------|
| `image_url` | string | Primary/featured image |
| `image_urls` | string[] | Additional gallery images |
| `cover_image_url` | string | Cover/banner image |
| `hero_image` | string | Full-width hero image |
| `thumbnail_url` | string | Thumbnail for listings |
| `video_url` | string | YouTube/Vimeo embed URL |
| `virtual_tour_url` | string | 360° virtual tour URL |

> **Note:** `image_url` can be uploaded via `multipart/form-data` with `image` field.

---

### Duration & Groups

| Field | Type | Description |
|-------|------|-------------|
| `duration_days` | integer | Number of days |
| `duration_nights` | integer | Number of nights |
| `duration_display` | string | Override display text |
| `min_group_size` | integer | Minimum travelers |
| `max_group_size` | integer | Maximum travelers |
| `min_age` | integer | Minimum age requirement |

---

### Operations

| Field | Type | Description |
|-------|------|-------------|
| `entrance_fee` | string | Entry fee (can include text like "$75 per person") |
| `operating_hours` | string | Opening/closing times |
| `is_sold_out` | boolean | Temporary sold-out flag |

---

### Flags & Status

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `status` | string | `draft`, `published`, `archived` | Publication status |
| `is_active` | boolean | `true`, `false` | Soft-delete flag |
| `is_featured` | boolean | `true`, `false` | Show in featured sections |
| `is_popular` | boolean | `true`, `false` | Mark as popular |
| `is_new` | boolean | `true`, `false` | Highlight as new |
| `is_eco_friendly` | boolean | `true`, `false` | Eco-certified |
| `is_family_friendly` | boolean | `true`, `false` | Suitable for families |

---

### SEO & Metadata

| Field | Type | Description |
|-------|------|-------------|
| `meta_title` | string | SEO page title |
| `meta_description` | string | SEO meta description |

---

## 🔗 Query Parameters Deep Dive

### Filtering Combinations

```
# By country (slug or ID)
/api/destinations?country=kenya
/api/destinations?country_id=3
/api/destinations?countrySlug=kenya

# By continent (via country)
/api/destinations?continent=Africa

# By category
/api/destinations?category=National%20Park

# By difficulty
/api/destinations?difficulty=Moderate

# By rating
/api/destinations?minRating=4.0

# By duration
/api/destinations?minDuration=3&maxDuration=7

# By boolean flags
/api/destinations?featured=true&eco_friendly=true

# Combined filters
/api/destinations?country=rwanda&category=National%20Park&featured=true&minRating=4
```

### Map Bounds Filtering

```
/api/destinations?bounds=-1.5,29.0,-0.5,30.5
```

Bounds format: `southWestLat,southWestLng,northEastLat,northEastLng`

---

## 📤 Engagement Endpoints (Public)

These endpoints increment counters (view, wishlist, share, wishlist). No authentication required.

- `POST /api/destinations/:id/view` — View count +1
- `POST /api/destinations/:id/wishlist` — Wishlist count +1
- `POST /api/destinations/:id/share` — Share count +1

All return updated count in response.

---

## 📤 Reviews Public Flow

1. `GET /api/destinations/:id/reviews` — List reviews
2. `POST /api/destinations/:id/reviews` — Submit review (optional auth)
3. `POST /api/destinations/:id/reviews/:reviewId/helpful` — Mark helpful

Reviews support up to 5 image uploads via `multipart/form-data`.

---

## 📤 Images Admin Flow

1. `GET /api/destinations/:id/images` — List existing images
2. `POST /api/destinations/:id/images` — Upload new images (max 20)
3. `PUT /api/destinations/:id/images/:imageId` — Update caption/order/primary
4. `DELETE /api/destinations/:id/images/:imageId` — Remove image
5. `PUT /api/destinations/:id/images/reorder` — Reorder via array of IDs

Images stored with fields: `id`, `destination_id`, `image_url`, `caption`, `is_primary`, `sort_order`.

---

## 🗂️ Itinerary Admin Flow

1. `GET /api/destinations/:id/itinerary` — Get all days
2. `POST /api/destinations/:id/itinerary` — Add day
3. `PUT /api/destinations/:id/itinerary/:dayId` — Update day
4. `DELETE /api/destinations/:id/itinerary/:dayId` — Remove day

Days ordered by `day_number` ASC. Duplicate day numbers allowed (but not recommended).

---

## ❓ FAQs Admin Flow

1. `GET /api/destinations/:id/faqs` — List FAQs
2. `POST /api/destinations/:id/faqs` — Add FAQ
3. `PUT /api/destinations/:id/faqs/:faqId` — Update FAQ
4. `DELETE /api/destinations/:id/faqs/:faqId` — Remove FAQ

Ordered by `sort_order`. Category optional for grouping.

---

## 🏷️ Tags Admin Flow

1. `GET /api/destinations/:id/tags` — List tags
2. `POST /api/destinations/:id/tags` — Add tag
3. `DELETE /api/destinations/:id/tags/:tagId` — Remove tag

Tags are localized — can add multiple tags with same `tag_name` under different `tag_category`.

---

## ✅ Standard Response Format

**Success:**
```json
{
  "success": true,
  "data": { ... }  // or [...]
}
```

With pagination:
```json
{
  "success": true,
  "data": [...],
  "pagination": { "page": 1, "limit": 20, "total": 342, "totalPages": 18 },
  "meta": { "sort": "featured", "filters": { ... } }
}
```

---

## ❌ Error Handling

| Status | Condition | Example |
|--------|-----------|---------|
| `400` | country_id missing or invalid | `{"error":"Country ID is required"}` |
| `400` | Invalid coordinates | `{"error":"Invalid latitude/longitude"}` |
| `401` | No auth token on admin route | |
| `403` | User is not admin | |
| `404` | Destination not found | `{"error":"Destination not found"}` |
| `409` | Slug conflict (on create) | `{"error":"Destination already exists"}` |
| `500` | Server error | |

---

## 🗄️ Database Structure

### destinations table
```
id (PK, serial)
country_id (FK → countries.id) ON DELETE CASCADE
slug (unique)
name, tagline, short_description
description, overview (text)
highlights (text[]), activities (text[]), wildlife (text[])
category, difficulty, destination_type
region, nearest_city, nearest_airport, distance_from_airport_km
address, latitude, longitude, altitude_meters
image_url, image_urls (text[]), cover_image_url, hero_image, thumbnail_url
video_url, virtual_tour_url
duration_days, duration_nights, duration_display
min_group_size, max_group_size, min_age, fitness_level
entrance_fee, operating_hours
rating (decimal), review_count, view_count, booking_count, wishlist_count
is_sold_out (boolean)
status: draft|published|archived
is_active (boolean, soft delete)
is_featured, is_popular, is_new, is_eco_friendly, is_family_friendly
meta_title, meta_description
created_at, updated_at, published_at
```

### Related tables
```
destination_images
  id, destination_id, image_url, caption, is_primary, sort_order

destination_itineraries
  id, destination_id, day_number, title, description
  activities (text[]), meals (text[]), accommodation, image_url

destination_faqs
  id, destination_id, question, answer, category, sort_order

destination_tags
  id, destination_id, tag_name, tag_slug, tag_category

destination_reviews
  id, destination_id, reviewer_name, reviewer_country, reviewer_avatar
  title, content, overall_rating, trip_date, trip_type, images
  is_verified, is_featured, helpful_count, created_at
```

---

## 📊 Important Notes

1. **Country Relationship** — Strong foreign key. `country_id` required; country must exist. Deletes cascade from country → destinations.
2. **Slug Generation** — Auto-generated from `name` if omitted. Slug cannot be changed after creation.
3. **Soft Delete** — `is_active = false` hides destination. Relations (images, itinerary, FAQs, reviews, tags) remain in DB.
4. **Status Management** — `status` controls visibility: `published` (live), `draft` (admin-only), `archived` (hidden).
5. **Images** — Multiple image fields; `image_url` is primary/featured, `image_urls` is gallery array, `cover_image_url`/`hero_image`/`thumbnail_url` for specific placements.
6. **Duration Display** — `duration_display` overrides auto-generated `"X Days / Y Nights"`.
7. **Coordinates** — `latitude`/`longitude` used for map display. `mapPosition` object in response.
8. **Engagement Counters** — View, wishlist, share counters increment via dedicated endpoints.
9. **Search** — Full-text across name, description, short_description, and related country name. Indexed via PostgreSQL `GIN` (if configured).
10. **Reviews** — Images uploadable via `multipart/form-data` (max 5). `is_verified` set by admin.
11. **Bulk Update** — `/bulk` endpoint updates same fields across multiple IDs (partial update).
12. **Restore** — Soft-deleted destinations can be restored; counters preserved.
13. **Pagination** — Default limit 12, max 100. Response includes `pagination` object.
14. **Cache** — List endpoints may be cached (configured server-side).
15. **Rate Limiting** — Public review creation may be rate-limited; engagement endpoints likely throttled.

---

## 🧪 Quick Test Examples

```bash
# 1. List all published destinations (Rwanda, 1st page, 20 items)
curl "http://localhost:3000/api/destinations?country=rwanda&page=1&limit=20"

# 2. Get featured destinations in Africa
curl "http://localhost:3000/api/destinations/featured?continent=Africa&limit=8"

# 3. Search for gorilla-related destinations
curl "http://localhost:3000/api/destinations/search?q=gorilla&limit=15"

# 4. Get single destination with all relations
curl "http://localhost:3000/api/destinations/volcanoes-national-park?includeRelations=true"

# 5. Get destinations for map (bounding box)
curl "http://localhost:3000/api/destinations/map?country=kenya"

# 6. Admin: Create destination
curl -X POST http://localhost:3000/api/destinations \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"country_id":1,"name":"New Destination","category":"Safari","difficulty":"Easy"}'

# 7. Admin: Upload images (multipart)
curl -X POST http://localhost:3000/api/destinations/5/images \
  -H "Authorization: Bearer <admin_token>" \
  -F "images=@/path/img1.jpg" \
  -F "images=@/path/img2.jpg"

# 8. Admin: Add itinerary day
curl -X POST http://localhost:3000/api/destinations/5/itinerary \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"day_number":1,"title":"Day 1","description":"Arrival","activities":["Airport pickup"],"meals":["Lunch"],"accommodation":"Hotel"}'

# 9. Admin: Add FAQ
curl -X POST http://localhost:3000/api/destinations/5/faqs \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"question":"Permit cost?","answer":"$1500","category":"pricing"}'

# 10. Public: Submit review
curl -X POST http://localhost:3000/api/destinations/5/reviews \
  -H "Content-Type: application/json" \
  -d '{"reviewer_name":"Jane","content":"Amazing!","overall_rating":5,"trip_date":"2025-06-15"}'
```

---

## 🔄 Route Equivalents

- `/api/destinations/country/:countrySlug` ≡ `/api/countries/:slug/destinations` (different sort order)

---

*End of Destinations API Documentation — Altuvera Travel v6.1*
