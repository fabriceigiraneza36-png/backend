# 🌍 Countries API Documentation

> **Backend Base URL:** `http://localhost:3000`  
> **Routes Prefix:** `/api/countries`  
> **Full Countries Base URL:** `http://localhost:3000/api/countries`

---

## 📋 Table of Contents

1. [Public Routes](#public-routes)  
2. [Admin Routes (Protected)](#admin-routes-protected)  
3. [Query Parameters](#query-parameters)  
4. [Request Body Fields](#request-body-fields)  
5. [Response Format](#response-format)  
6. [Examples](#examples)  
7. [Error Handling](#error-handling)  

---

## 🚪 Public Routes (No Authentication Required)

### `GET /api/countries`

List all countries with pagination and filtering.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `20` | Items per page (max 100) |
| `featured` | boolean | — | Filter by featured status (`true`/`false`) |
| `continent` | string | — | Filter by continent (e.g., `Africa`, `Asia`) |
| `region` | string | — | Filter by region (partial match, case-insensitive) |
| `search` | string | — | Search in name, description, capital, tagline |

**Example:**  
`GET http://localhost:3000/api/countries?page=1&limit=20&continent=Africa&featured=true`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "rwanda",
      "countryId": "rwanda",
      "dbId": 1,
      "slug": "rwanda",
      "name": "Rwanda",
      "officialName": "Republic of Rwanda",
      "capital": "Kigali",
      "flag": "🇷🇼",
      "flagUrl": null,
      "tagline": "Land of a Thousand Hills",
      "motto": "Unity, Work, Patriotism",
      "demonym": "Rwandan",
      "independence": "1962-07-01",
      "governmentType": "Presidential Republic",
      "headOfState": "Paul Kagame",
      "continent": "Africa",
      "region": "East Africa",
      "subRegion": "African Great Lakes",
      "description": "...",
      "fullDescription": "...",
      "additionalInfo": "...",
      "population": 13000000,
      "area": 26338.00,
      "populationDensity": 495.00,
      "urbanPopulation": 17.30,
      "lifeExpectancy": 69.0,
      "medianAge": 20.0,
      "literacyRate": 73.20,
      "languages": ["Kinyarwanda", "English", "French"],
      "officialLanguages": ["Kinyarwanda", "English", "French"],
      "nationalLanguages": ["Kinyarwanda"],
      "ethnicGroups": ["Hutu", "Tutsi", "Twa"],
      "religions": ["Christianity", "Islam"],
      "currency": "Rwandan Franc",
      "currencySymbol": "Fr",
      "timezone": "UTC+2 (CAT)",
      "callingCode": "+250",
      "internetTLD": ".rw",
      "drivingSide": "Right",
      "electricalPlug": "Type C, J",
      "voltage": "230V",
      "waterSafety": "Boil water advised",
      "climate": "Temperate tropical highland",
      "bestTime": "June to September",
      "seasons": { "dry": ["Jun","Jul","Aug","Sep"], "wet": ["Mar","Apr","May","Oct","Nov"], "best": "Jun-Sep" },
      "visaInfo": "Visa on arrival...",
      "healthInfo": "Yellow fever certificate...",
      "highlights": ["Mountain Gorillas", "Nyungwe Forest"],
      "experiences": ["Gorilla Trekking", "Canopy Walk"],
      "travelTips": ["Book permits early"],
      "neighboringCountries": ["Uganda", "Tanzania"],
      "wildlife": { "mammals": ["Mountain Gorilla"], "birds": [], "marine": [] },
      "cuisine": { "staples": ["Ugali"], "specialties": [], "beverages": [] },
      "economicInfo": {},
      "geography": {},
      "imageUrl": "https://...",
      "coverImageUrl": "https://...",
      "heroImage": "https://...",
      "images": [],
      "mapPosition": { "lat": -1.9403, "lng": 29.8739 },
      "destinationCount": 15,
      "viewCount": 1250,
      "isFeatured": true,
      "isActive": true,
      "createdAt": "2025-01-15T...",
      "updatedAt": "2025-01-20T..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 54,
    "totalPages": 3
  }
}
```

---

### `GET /api/countries/featured`

Get featured countries.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | `12` | Maximum number of countries to return |

**Example:**  
`GET http://localhost:3000/api/countries/featured?limit=12`

**Response:**
```json
{
  "success": true,
  "data": [ /* array of country objects */ ]
}
```

---

### `GET /api/countries/search`

Search countries by name, capital, continent, region, description, or tagline.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | **required** | Search term (min 2 characters) |
| `limit` | integer | `15` | Maximum results |

**Example:**  
`GET http://localhost:3000/api/countries/search?q=kenya&limit=15`

**Response:**
```json
{
  "success": true,
  "data": [ /* array of matching country objects */ ]
}
```

---

### `GET /api/countries/stats`

Get dashboard statistics for countries.

**Example:**  
`GET http://localhost:3000/api/countries/stats`

**Response:**
```json
{
  "success": true,
  "data": {
    "total_countries": 54,
    "featured_countries": 12,
    "total_continents": 5,
    "total_population": 1430000000,
    "total_destinations": 342,
    "total_airports": 156,
    "total_unesco_sites": 87
  }
}
```

---

### `GET /api/countries/continents`

Get list of continents with country counts and total populations.

**Example:**  
`GET http://localhost:3000/api/countries/continents`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "continent": "Africa",
      "country_count": 54,
      "total_population": 1430000000
    },
    {
      "continent": "Asia",
      "country_count": 48,
      "total_population": 4700000000
    }
  ]
}
```

---

### `GET /api/countries/continent/:continent`

Get all countries in a specific continent.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `continent` | string | Continent name (case-insensitive) |

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `20` | Items per page |

**Example:**  
`GET http://localhost:3000/api/countries/continent/Africa?page=1&limit=20`

**Response:**
```json
{
  "success": true,
  "data": [ /* array of country objects */ ],
  "pagination": { "page": 1, "limit": 20, "total": 54, "totalPages": 3 }
}
```

---

### `GET /api/countries/:idOrSlug`

Get a single country by ID or slug.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `idOrSlug` | string | Country ID (numeric) or slug (e.g., `rwanda`) |

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `includeRelated` | boolean | `true` | Include airports, festivals, UNESCO sites, historical events |

**Examples:**  
`GET http://localhost:3000/api/countries/1`  
`GET http://localhost:3000/api/countries/rwanda`  
`GET http://localhost:3000/api/countries/rwanda?includeRelated=false`

**Response (with `includeRelated=true`):**
```json
{
  "success": true,
  "data": {
    "id": "rwanda",
    "name": "Rwanda",
    "slug": "rwanda",
    // ... all other country fields from above
    "airports": [
      {
        "id": 1,
        "name": "Kigali International Airport",
        "code": "KGL",
        "location": "Kigali",
        "type": "International",
        "description": "Main international airport",
        "isMainInternational": true
      }
    ],
    "festivals": [
      {
        "id": 1,
        "name": "Kwita Izina",
        "period": "Annual",
        "month": "June",
        "description": "Gorilla naming ceremony",
        "isMajorEvent": true,
        "imageUrl": null
      }
    ],
    "unesco_sites": [
      {
        "id": 1,
        "name": "Memorial Sites of Rwanda",
        "year": 2023,
        "type": "Cultural",
        "description": "..."
      }
    ],
    "historical_events": [
      {
        "id": 1,
        "year": 1994,
        "event": "Genocide Memorial",
        "type": "Historical",
        "isMajor": true
      }
    ]
  }
}
```

---

### `GET /api/countries/:idOrSlug/destinations`

Get all destinations in a country.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `idOrSlug` | string | Country ID (numeric) or slug |

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `20` | Items per page |
| `search` | string | — | Search in destination name/description |
| `category` | string | — | Filter by category (e.g., `National Park`, `Mountain`, `Lake`) |

**Examples:**  
`GET http://localhost:3000/api/countries/rwanda/destinations`  
`GET http://localhost:3000/api/countries/1/destinations?page=1&limit=10&category=National%20Park`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "volcanoes-national-park",
      "destinationId": "volcanoes-national-park",
      "dbId": 5,
      "slug": "volcanoes-national-park",
      "name": "Volcanoes National Park",
      "tagline": "Home of the Mountain Gorillas",
      "shortDescription": "...",
      "description": "...",
      "overview": "...",
      "highlights": ["Gorilla trekking", "Golden monkeys"],
      "activities": ["Hiking", "Bird watching"],
      "wildlife": ["Mountain Gorilla", "Golden Monkey"],
      "bestTimeToVisit": "June to September",
      "category": "National Park",
      "difficulty": "Moderate",
      "destinationType": "Safari",
      "region": "Northern Province",
      "nearestCity": "Musanze",
      "nearestAirport": "Kigali International Airport",
      "distanceFromAirportKm": 105.00,
      "address": "Kinigi, Musanze",
      "latitude": -1.4833,
      "longitude": 29.5167,
      "altitudeMeters": 2400,
      "imageUrl": "https://...",
      "coverImageUrl": "https://...",
      "heroImage": "https://...",
      "thumbnailUrl": "https://...",
      "images": ["https://...", "https://..."],
      "durationDays": 3,
      "durationNights": 2,
      "durationDisplay": "3 Days / 2 Nights",
      "minGroupSize": 2,
      "maxGroupSize": 8,
      "minAge": 15,
      "fitnessLevel": "Moderate fitness required",
      "entranceFee": "$75 per person",
      "status": "published",
      "isFeatured": true,
      "isPopular": true,
      "countryId": "rwanda",
      "countryName": "Rwanda",
      "mapPosition": { "lat": -1.4833, "lng": 29.5167 },
      "highlights": [],
      "activities": [],
      "images": []
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 25, "totalPages": 2 },
  "country": { "id": 1, "slug": "rwanda", "name": "Rwanda" }
}
```

---

## 🔐 Admin Routes (Require Authentication + Admin Role)

**Required Headers:**
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

> **Auth Middleware:** `protect` + `adminOnly` — Must be logged in as admin or super_admin.

---

### `POST /api/countries`

Create a new country.

**Request:**
- **Content-Type:** `multipart/form-data` (if uploading image) OR `application/json`
- **Body:** See **Country Create/Update Fields** below

**Example (JSON):**
```bash
curl -X POST http://localhost:3000/api/countries \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Uganda",
    "official_name": "Republic of Uganda",
    "capital": "Kampala",
    "continent": "Africa",
    "region": "East Africa",
    "population": 45700000,
    "area": 241038.00,
    "languages": ["English", "Swahili"],
    "currency": "Ugandan Shilling",
    "currency_symbol": "UGX",
    "timezone": "UTC+3 (EAT)",
    "calling_code": "+256",
    "internet_tld": ".ug",
    "tagline": "The Pearl of Africa",
    "description": "Uganda is a landlocked country...",
    "highlights": ["Murchison Falls", "Bwindi Impenetrable Forest"],
    "is_featured": true
  }'
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": { /* full country object with generated ID and slug */ }
}
```

---

### `PUT /api/countries/:id`

Update a country (partial update allowed).

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country database ID |

**Request:** Same body fields as POST (all optional except `id` in URL)

**Example:**
```bash
curl -X PUT http://localhost:3000/api/countries/1 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "population": 14000000,
    "tagline": "Land of a Thousand Hills",
    "is_featured": true
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": { /* updated country object */ }
}
```

---

### `DELETE /api/countries/:id`

Delete a country. **Fails if destinations exist**.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country database ID |

**Example:**
```bash
curl -X DELETE http://localhost:3000/api/countries/1 \
  -H "Authorization: Bearer <token>"
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Deleted successfully.",
  "data": { "id": 1, "name": "Rwanda", "slug": "rwanda" }
}
```

**Error Response (409 Conflict):**
```json
{
  "success": false,
  "error": "Cannot delete: 25 destinations exist. Remove them first.",
  "dependentCount": 25
}
```

---

### `POST /api/countries/:id/airports`

Add an airport to a country.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country ID |

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **Yes** | Airport name |
| `code` | string | No | IATA code (e.g., `KGL`) |
| `location` | string | No | City/location |
| `airport_type` | string | No | Type — defaults to `"International"` |
| `description` | string | No | Description |
| `is_main_international` | boolean | No | Mark as primary international airport |

**Example:**
```bash
curl -X POST http://localhost:3000/api/countries/1/airports \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Kigali International Airport",
    "code": "KGL",
    "location": "Kigali",
    "airport_type": "International",
    "description": "Main international gateway",
    "is_main_international": true
  }'
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Kigali International Airport",
    "code": "KGL",
    "location": "Kigali",
    "type": "International",
    "description": "Main international gateway",
    "isMainInternational": true
  }
}
```

---

### `DELETE /api/countries/:id/airports/:airportId`

Remove an airport from a country.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country ID |
| `airportId` | integer | Airport ID |

**Example:**
```bash
curl -X DELETE http://localhost:3000/api/countries/1/airports/5 \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Airport removed.",
  "data": { "id": 5, "name": "Kigali International Airport" }
}
```

---

### `POST /api/countries/:id/festivals`

Add a festival to a country.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country ID |

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **Yes** | Festival name |
| `period` | string | No | Period (e.g., `"Annual"`) |
| `month` | string | No | Month (e.g., `"June"`) |
| `description` | string | No | Description |
| `is_major_event` | boolean | No | Mark as major event |
| `image_url` | string | No | Image URL |

**Example:**
```bash
curl -X POST http://localhost:3000/api/countries/1/festivals \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Kwita Izina",
    "period": "Annual",
    "month": "June",
    "description": "Traditional gorilla naming ceremony",
    "is_major_event": true
  }'
```

---

### `DELETE /api/countries/:id/festivals/:festivalId`

Remove a festival.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country ID |
| `festivalId` | integer | Festival ID |

**Example:**
```bash
curl -X DELETE http://localhost:3000/api/countries/1/festivals/3 \
  -H "Authorization: Bearer <token>"
```

---

### `POST /api/countries/:id/unesco-sites`

Add a UNESCO World Heritage Site.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country ID |

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **Yes** | Site name |
| `year_inscribed` | integer | No | Year UNESCO inscribed the site |
| `site_type` | string | No | Type — defaults to `"Cultural"` |
| `description` | string | No | Description |

**Example:**
```bash
curl -X POST http://localhost:3000/api/countries/1/unesco-sites \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Memorial Sites of Rwanda",
    "year_inscribed": 2023,
    "site_type": "Cultural",
    "description": "Commemorating the genocide..."
  }'
```

---

### `DELETE /api/countries/:id/unesco-sites/:siteId`

Remove a UNESCO site.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country ID |
| `siteId` | integer | UNESCO site ID |

---

### `POST /api/countries/:id/historical-events`

Add a historical event.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country ID |

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `year` | integer | No | Year of event |
| `event` | string | **Yes** | Event description |
| `event_type` | string | No | Type — defaults to `"Political"` |
| `is_major` | boolean | No | Mark as major event |
| `sort_year` | integer | No | Sort order year |

**Example:**
```bash
curl -X POST http://localhost:3000/api/countries/1/historical-events \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "year": 1962,
    "event": "Independence from Belgium",
    "event_type": "Political",
    "is_major": true,
    "sort_year": 1962
  }'
```

---

### `DELETE /api/countries/:id/historical-events/:eventId`

Remove a historical event.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country ID |
| `eventId` | integer | Event ID |

---

## 🔧 Sub-resources: Media Uploads

### `POST /api/media/countries/:id/flag`

Upload a country flag image.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country ID |

**Request:**
- **Content-Type:** `multipart/form-data`
- **Form field:** `flag` (file)

**Example (Node):**
```javascript
const form = new FormData();
form.append('flag', fs.createReadStream('path/to/flag.jpg'));

fetch('http://localhost:3000/api/media/countries/1/flag', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer <token>', ...form.getHeaders() },
  body: form
});
```

**Response:**
```json
{
  "success": true,
  "message": "Flag uploaded.",
  "data": { "flagUrl": "https://cdn.altuvera.com/countries/1/flag.jpg" }
}
```

---

### `POST /api/media/countries/:id/images`

Upload multiple country images (max 10).

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country ID |

**Request:**
- **Content-Type:** `multipart/form-data`
- **Form field:** `images` (multiple files)

---

### `DELETE /api/media/countries/:id/images/:imageUrl`

Remove a country image by URL.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | integer | Country ID |
| `imageUrl` | string | URL-encoded image URL to remove |

**Example:**
```bash
curl -X DELETE "http://localhost:3000/api/media/countries/1/images/https%3A%2F%2Fcdn.altuvera.com%2Fcountries%2F1%2Fimg1.jpg" \
  -H "Authorization: Bearer <token>"
```

---

## 📦 Country Create/Update Body Fields Reference

All fields are **optional** unless marked **REQUIRED**.

### Core Fields

| Field | Type | Required | Example | Notes |
|-------|------|----------|---------|-------|
| `name` | string | **Yes** | `"Rwanda"` | Min 2 chars; slug auto-generated |
| `official_name` | string | No | `"Republic of Rwanda"` | |
| `capital` | string | No | `"Kigali"` | |
| `flag` | string | No | `"🇷🇼"` | Emoji flag |
| `flag_url` | string | No | `"https://..."` | URL to flag image |
| `tagline` | string | No | `"Land of a Thousand Hills"` | |
| `motto` | string | No | `"Unity, Work, Patriotism"` | |
| `demonym` | string | No | `"Rwandan"` | Resident name |
| `independence_date` | date | No | `"1962-07-01"` | ISO format |
| `government_type` | string | No | `"Presidential Republic"` | |
| `head_of_state` | string | No | `"Paul Kagame"` | |

### Location & Geography

| Field | Type | Description |
|-------|------|-------------|
| `continent` | string | `Africa`, `Asia`, `Europe`, etc. |
| `region` | string | e.g., `East Africa`, `West Africa` |
| `sub_region` | string | e.g., `African Great Lakes` |
| `latitude` | number | Decimal degrees (e.g., `-1.9403`) |
| `longitude` | number | Decimal degrees (e.g., `29.8739`) |

### Demographics

| Field | Type | Description |
|-------|------|-------------|
| `population` | integer | Total population |
| `area` | number | Area in km² |
| `population_density` | number | People per km² |
| `urban_population` | number | Percentage urban |
| `life_expectancy` | number | Average years |
| `median_age` | number | Median age in years |
| `literacy_rate` | number | Percentage (e.g., `73.20`) |

### Culture & Society

| Field | Type | Description |
|-------|------|-------------|
| `languages` | string[] | Array of spoken languages |
| `official_languages` | string[] | Official languages |
| `national_languages` | string[] | National languages |
| `ethnic_groups` | string[] | Major ethnic groups |
| `religions` | string[] | Major religions |

### Infrastructure

| Field | Type | Description |
|-------|------|-------------|
| `currency` | string | Currency name |
| `currency_symbol` | string | Currency symbol |
| `timezone` | string | e.g., `"UTC+2 (CAT)"` |
| `calling_code` | string | Phone country code |
| `internet_tld` | string | Top-level domain (`.rw`) |
| `driving_side` | string | `"Right"` or `"Left"` |
| `electrical_plug` | string | Plug type description |
| `voltage` | string | e.g., `"230V"` |
| `water_safety` | string | Water safety advisory |

### Travel Information

| Field | Type | Description |
|-------|------|-------------|
| `climate` | string | Climate description |
| `best_time_to_visit` | string | Recommended travel months |
| `seasons` | object | `{ "dry": [...], "wet": [...], "best": "Jun-Sep" }` |
| `visa_info` | string | Visa requirements text |
| `health_info` | string | Health/vaccination info |
| `highlights` | string[] | Top attractions/experiences |
| `experiences` | string[] | Iconic experiences |
| `travel_tips` | string[] | Tips for travelers |
| `neighboring_countries` | string[] | Bordering countries |

### Advanced Data

| Field | Type | Description |
|-------|------|-------------|
| `wildlife` | object | `{ "mammals": [...], "birds": [...], "marine": [...] }` |
| `cuisine` | object | `{ "staples": [...], "specialties": [...], "beverages": [...] }` |
| `economic_info` | object | Any JSON economic data |
| `geography` | object | Any JSON geography data |

### Media & SEO

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Short description |
| `full_description` | string | Long detailed description |
| `additional_info` | string | Extra information |
| `image_url` | string | Primary image URL |
| `cover_image_url` | string | Cover/banner image |
| `hero_image` | string | Hero/header image |
| `images` | string[] | Gallery image URLs |
| `video_url` | string | Optional video |
| `is_featured` | boolean | Show in featured lists |
| `is_active` | boolean | Soft-delete flag |

---

## 🔍 Query Parameters Deep Dive

### Pagination

All list endpoints support:
- `?page=1` — Page number (starts at 1)
- `?limit=20` — Items per page (max: 100)
- Response includes `pagination` object with total pages

### Filtering Examples

```
GET /api/countries?continent=Africa
GET /api/countries?region=East%20Africa
GET /api/countries?featured=true
GET /api/countries?search=safari&limit=10
```

Combined:
```
GET /api/countries?continent=Africa&featured=true&page=1&limit=20
```

---

## 📤 File Upload Notes

- Use `multipart/form-data` for image uploads
- For creating/updating with image: send file in `image` field
- Max file size enforced at server (typically 5-10MB)
- Supported formats: JPG, PNG, WebP, AVIF

---

## ✅ Standard Success Response Format

All responses follow this structure:

```json
{
  "success": true,
  "data": { ... }  // Single object or array
}
```

With pagination:
```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 154,
    "totalPages": 8
  }
}
```

---

## ❌ Error Response Format

```json
{
  "success": false,
  "message": "Human-readable error description",
  "error": "Technical error code (optional)",
  "details": { ... }  // Validation errors (optional)
}
```

---

## 🚨 Error Status Codes

| Status | When | Example |
|--------|------|---------|
| `400` | Validation failed | Missing required field (`name`) |
| `401` | Not authenticated | Missing/invalid token on admin route |
| `403` | Not authorized | User is not admin |
| `404` | Not found | Country ID doesn't exist |
| `409` | Conflict | Duplicate country name/slug |
| `429` | Too many requests | Rate limit exceeded |
| `500` | Server error | Database failure |

---

## 📝 Full Request Examples

### 1. Get all featured African countries
```bash
curl "http://localhost:3000/api/countries?continent=Africa&featured=true&limit=12"
```

### 2. Search for a country
```bash
curl "http://localhost:3000/api/countries/search?q=kenya&limit=10"
```

### 3. Get single country with related data
```bash
curl "http://localhost:3000/api/countries/rwanda?includeRelated=true"
```

### 4. Get destinations in Rwanda
```bash
curl "http://localhost:3000/api/countries/rwanda/destinations?page=1&limit=20"
```

### 5. Create a country (admin)
```bash
curl -X POST http://localhost:3000/api/countries \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Burundi","capital":"Gitega","continent":"Africa"}'
```

### 6. Update country population (admin)
```bash
curl -X PUT http://localhost:3000/api/countries/3 \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"population": 12500000}'
```

### 7. Add airport (admin)
```bash
curl -X POST http://localhost:3000/api/countries/3/airports \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Bujumbura International Airport","code":"BJM","is_main_international":true}'
```

### 8. Upload country flag image (admin)
```bash
curl -X POST http://localhost:3000/api/media/countries/3/flag \
  -H "Authorization: Bearer <admin_token>" \
  -F "flag=@/path/to/burundi-flag.jpg"
```

---

## 🗄️ Database Table Relationships

```
countries (master)
├── country_airports (1:N)
├── country_festivals (1:N)
├── country_unesco_sites (1:N)
├── country_historical_events (1:N)
└── destinations (1:N)
```

Deleting a country **requires** all dependent destinations to be deleted first.

---

## 📊 Important Notes

1. **Slug Generation** — Automatically generated from `name` using `slugify` (lowercase, hyphens, no special chars). Cannot be overridden.
2. **Soft Delete** — `is_active = false` hides country from public API. Hard delete removes all related data.
3. **View Counter** — `getOne` automatically increments `view_count`.
4. **Arrays** — Languages, highlights, etc. accept arrays or comma-separated strings.
5. **JSONB Fields** — `seasons`, `wildlife`, `cuisine`, `economic_info`, `geography` must be valid JSON objects (sent as JSON, stored as JSONB).
6. **Coordinates** — `latitude`/`longitude` stored as decimals. `mapPosition` in response includes `{ lat, lng }`.
7. **Image Uploads** — Use `/api/media/*` endpoints for multi-file uploads; they handle storage and URL return.
8. **Rate Limiting** — Public endpoints may be rate-limited (e.g., search). No limits on admin routes (with valid token).
9. **CORS** — Configured for frontend origin(s) in production.
10. **Cache** — List endpoints auto-cached (typically 5-15 min).

---

*End of Countries API Documentation — Altuvera Travel v6.1*
