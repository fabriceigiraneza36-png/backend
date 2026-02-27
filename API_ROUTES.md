# ALTUVERA Travel API - Frontend Routes Reference

This document provides a comprehensive reference for all accessible API routes for the frontend application.

## Base URL

```
http://localhost:5000/api
```

## Authentication

All routes require authentication unless marked as **Public**. Use the `Authorization` header with Bearer token:

```javascript
headers: {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
}
```

## Rate Limiting

- General API: 1000 requests per 15 minutes
- Authentication routes: Strict rate limiting (5 attempts per 15 minutes)
- Booking routes: 50 requests per 15 minutes

---

## 🌍 Countries

### Public Routes

#### GET /api/countries
Get all countries with caching (5 minutes)

**Query Parameters:**
- `page` (number, optional): Page number for pagination
- `limit` (number, optional): Items per page (default: 10)
- `search` (string, optional): Search by name or description
- `featured` (boolean, optional): Filter featured countries only

**Response:**
```json
{
  "success": true,
  "data": {
    "countries": [
      {
        "id": "kenya",
        "name": "Kenya",
        "description": "East African country known for its wildlife...",
        "image": "https://example.com/image.jpg",
        "featured": true,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 3,
      "totalItems": 25,
      "itemsPerPage": 10
    }
  }
}
```

#### GET /api/countries/featured
Get featured countries with caching (5 minutes)

**Response:**
```json
{
  "success": true,
  "data": {
    "countries": [...]
  }
}
```

#### GET /api/countries/:id
Get single country by ID with caching (5 minutes)

**Response:**
```json
{
  "success": true,
  "data": {
    "country": {
      "id": "kenya",
      "name": "Kenya",
      "description": "...",
      "image": "...",
      "featured": true,
      "destinations": [
        {
          "id": "maasai-mara",
          "name": "Maasai Mara",
          "type": "Wildlife Safari",
          "description": "...",
          "images": ["..."],
          "rating": 4.9
        }
      ]
    }
  }
}
```

#### GET /api/countries/:id/destinations
Get destinations by country with caching (5 minutes)

**Query Parameters:**
- `page`, `limit`, `search`, `type` (same as countries)

**Response:**
```json
{
  "success": true,
  "data": {
    "destinations": [...],
    "pagination": {...}
  }
}
```

### Admin Routes (Requires Admin Role)

#### POST /api/countries
Create new country

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: multipart/form-data`

**Body:**
- `name` (string, required)
- `description` (string, required)
- `image` (file, optional)
- `featured` (boolean, optional)

#### PUT /api/countries/:id
Update country

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: multipart/form-data`

**Body:**
- Same as POST (all fields optional)

#### DELETE /api/countries/:id
Delete country

**Headers:**
- `Authorization: Bearer ${token}`

---

## 🏞️ Destinations

### Public Routes

#### GET /api/destinations
Get all destinations with filters, search, and pagination

**Query Parameters:**
- `page` (number, optional): Page number
- `limit` (number, optional): Items per page (default: 10)
- `search` (string, optional): Search by name, description, or location
- `country` (string, optional): Filter by country ID
- `type` (string, optional): Filter by destination type
- `featured` (boolean, optional): Filter featured destinations
- `sort` (string, optional): Sort by 'name', 'rating', 'createdAt' (default: 'name')
- `order` (string, optional): 'asc' or 'desc' (default: 'asc')

**Response:**
```json
{
  "success": true,
  "data": {
    "destinations": [
      {
        "id": "maasai-mara",
        "name": "Maasai Mara National Reserve",
        "type": "Wildlife Safari",
        "description": "The world-famous Maasai Mara...",
        "fullDescription": "...",
        "highlights": ["Great Migration", "Big Five viewing"],
        "bestTime": "July to October",
        "duration": "3-5 days",
        "difficulty": "Easy",
        "price": "$$$",
        "rating": 4.9,
        "reviews": 2847,
        "images": ["https://example.com/image1.jpg"],
        "coordinates": { "lat": -1.4061, "lng": 35.0167 },
        "countryId": "kenya",
        "featured": true
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalItems": 45,
      "itemsPerPage": 10
    },
    "filters": {
      "countries": ["kenya", "tanzania", "uganda"],
      "types": ["Wildlife Safari", "Mountain Trekking", "Beach & Coast"]
    }
  }
}
```

#### GET /api/destinations/featured
Get featured destinations with caching (5 minutes)

#### GET /api/destinations/categories
Get destination categories with caching (10 minutes)

**Response:**
```json
{
  "success": true,
  "data": {
    "categories": [
      { "value": "Wildlife Safari", "label": "Wildlife Safari" },
      { "value": "Mountain Trekking", "label": "Mountain Trekking" }
    ]
  }
}
```

#### GET /api/destinations/map
Get map data with caching (5 minutes)

**Response:**
```json
{
  "success": true,
  "data": {
    "destinations": [
      {
        "id": "maasai-mara",
        "name": "Maasai Mara",
        "coordinates": { "lat": -1.4061, "lng": 35.0167 },
        "countryId": "kenya",
        "type": "Wildlife Safari"
      }
    ]
  }
}
```

#### GET /api/destinations/:idOrSlug
Get single destination by ID or slug with caching (5 minutes)

**Response:**
```json
{
  "success": true,
  "data": {
    "destination": {
      "id": "maasai-mara",
      "name": "Maasai Mara National Reserve",
      "type": "Wildlife Safari",
      "description": "...",
      "fullDescription": "...",
      "highlights": ["..."],
      "bestTime": "...",
      "duration": "...",
      "difficulty": "...",
      "price": "...",
      "rating": 4.9,
      "reviews": 2847,
      "images": ["..."],
      "coordinates": { "lat": -1.4061, "lng": 35.0167 },
      "countryId": "kenya",
      "featured": true,
      "country": {
        "id": "kenya",
        "name": "Kenya",
        "image": "..."
      }
    }
  }
}
```

#### GET /api/destinations/:id/images
Get destination images

**Response:**
```json
{
  "success": true,
  "data": {
    "images": [
      {
        "id": "img_123",
        "url": "https://example.com/image.jpg",
        "alt": "Maasai Mara landscape",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### Admin Routes

#### POST /api/destinations
Create new destination

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: multipart/form-data`

**Body:**
- `name`, `type`, `description`, `fullDescription`, `highlights[]`, `bestTime`, `duration`, `difficulty`, `price`, `rating`, `countryId`, `featured` (boolean)
- `image` (file, optional)

#### PUT /api/destinations/:id
Update destination

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: multipart/form-data`

**Body:**
- Same as POST (all fields optional)

#### DELETE /api/destinations/:id
Delete destination

**Headers:**
- `Authorization: Bearer ${token}`

#### POST /api/destinations/:id/images
Add images to destination

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: multipart/form-data`

**Body:**
- `images` (array of files, max 10)

#### DELETE /api/destinations/images/:imageId
Remove image from destination

**Headers:**
- `Authorization: Bearer ${token}`

---

## 📝 Blog Posts

### Public Routes

#### GET /api/posts
Get all posts with filters, search, and pagination

**Query Parameters:**
- `page`, `limit`, `search`, `category`, `featured`, `sort`, `order` (same as destinations)

**Response:**
```json
{
  "success": true,
  "data": {
    "posts": [
      {
        "id": "post_123",
        "title": "Best Time to Visit East Africa",
        "slug": "best-time-to-visit-east-africa",
        "excerpt": "Discover the best seasons for your East African adventure...",
        "content": "...",
        "image": "https://example.com/post-image.jpg",
        "category": "Travel Tips",
        "author": "Altuvеrа Team",
        "publishedAt": "2024-01-01T00:00:00.000Z",
        "featured": true,
        "readTime": "5 min read",
        "tags": ["travel", "east africa", "seasons"]
      }
    ],
    "pagination": {...},
    "filters": {
      "categories": ["Travel Tips", "Destinations", "Culture"]
    }
  }
}
```

#### GET /api/posts/featured
Get featured posts with caching (5 minutes)

#### GET /api/posts/categories
Get post categories with caching (10 minutes)

#### GET /api/posts/:slug
Get single post by slug with caching (5 minutes)

**Response:**
```json
{
  "success": true,
  "data": {
    "post": {
      "id": "post_123",
      "title": "...",
      "slug": "...",
      "excerpt": "...",
      "content": "...",
      "image": "...",
      "category": "...",
      "author": "...",
      "publishedAt": "...",
      "featured": true,
      "readTime": "5 min read",
      "tags": ["..."],
      "relatedPosts": [...]
    }
  }
}
```

### Admin Routes

#### POST /api/posts
Create new post

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: multipart/form-data`

**Body:**
- `title`, `excerpt`, `content`, `category`, `author`, `publishedAt`, `featured`, `readTime`, `tags[]`
- `image` (file, optional)

#### PUT /api/posts/:id
Update post

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: multipart/form-data`

#### DELETE /api/posts/:id
Delete post

**Headers:**
- `Authorization: Bearer ${token}`

---

## 💡 Travel Tips

### Public Routes

#### GET /api/tips
Get all travel tips with filters, search, and pagination

**Query Parameters:**
- `page`, `limit`, `search`, `category`, `featured`, `sort`, `order` (same as destinations)

**Response:**
```json
{
  "success": true,
  "data": {
    "tips": [
      {
        "id": "tip_123",
        "title": "Packing Essentials for Safari",
        "category": "Packing",
        "content": "Here's what you need to pack for your safari adventure...",
        "image": "https://example.com/tip-image.jpg",
        "featured": true,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {...},
    "filters": {
      "categories": ["Packing", "Health", "Culture", "Budget"]
    }
  }
}
```

#### GET /api/tips/featured
Get featured tips with caching (5 minutes)

#### GET /api/tips/categories
Get tip categories with caching (10 minutes)

#### GET /api/tips/:id
Get single tip by ID with caching (5 minutes)

### Admin Routes

#### POST /api/tips
Create new tip

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: multipart/form-data`

**Body:**
- `title`, `category`, `content`, `featured`
- `image` (file, optional)

#### PUT /api/tips/:id
Update tip

#### DELETE /api/tips/:id
Delete tip

---

## ✈️ Services

### Public Routes

#### GET /api/services
Get all services with caching (5 minutes)

**Response:**
```json
{
  "success": true,
  "data": {
    "services": [
      {
        "id": "service_123",
        "name": "Custom Safari Packages",
        "description": "Tailored safari experiences for every traveler...",
        "icon": "safari",
        "featured": true,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

#### GET /api/services/featured
Get featured services with caching (5 minutes)

#### GET /api/services/:id
Get single service by ID with caching (5 minutes)

### Admin Routes

#### POST /api/services
Create new service

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: multipart/form-data`

**Body:**
- `name`, `description`, `icon`, `featured`
- `image` (file, optional)

#### PUT /api/services/:id
Update service

#### DELETE /api/services/:id
Delete service

---

## 👥 Team

### Public Routes

#### GET /api/team
Get all team members with caching (5 minutes)

**Response:**
```json
{
  "success": true,
  "data": {
    "team": [
      {
        "id": "member_123",
        "name": "John Doe",
        "position": "Lead Safari Guide",
        "bio": "Experienced guide with 15 years of safari expertise...",
        "image": "https://example.com/team-member.jpg",
        "featured": true,
        "social": {
          "instagram": "@johndoe",
          "linkedin": "john-doe"
        }
      }
    ]
  }
}
```

#### GET /api/team/featured
Get featured team members with caching (5 minutes)

#### GET /api/team/:id
Get single team member by ID with caching (5 minutes)

### Admin Routes

#### POST /api/team
Create new team member

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: multipart/form-data`

**Body:**
- `name`, `position`, `bio`, `featured`
- `image` (file, optional)
- `social` (object, optional)

#### PUT /api/team/:id
Update team member

#### DELETE /api/team/:id
Delete team member

---

## 📸 Gallery

### Public Routes

#### GET /api/gallery
Get all gallery items with filters, search, and pagination

**Query Parameters:**
- `page`, `limit`, `search`, `category`, `featured`, `sort`, `order` (same as destinations)

**Response:**
```json
{
  "success": true,
  "data": {
    "gallery": [
      {
        "id": "gallery_123",
        "title": "Sunset over Maasai Mara",
        "description": "Breathtaking sunset during the Great Migration...",
        "image": "https://example.com/gallery-image.jpg",
        "category": "Wildlife",
        "featured": true,
        "location": "Maasai Mara, Kenya",
        "photographer": "Jane Smith",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {...},
    "filters": {
      "categories": ["Wildlife", "Landscape", "Culture", "Adventure"]
    }
  }
}
```

#### GET /api/gallery/featured
Get featured gallery items with caching (5 minutes)

#### GET /api/gallery/categories
Get gallery categories with caching (10 minutes)

#### GET /api/gallery/:id
Get single gallery item by ID with caching (5 minutes)

### Admin Routes

#### POST /api/gallery
Create new gallery item

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: multipart/form-data`

**Body:**
- `title`, `description`, `category`, `location`, `photographer`, `featured`
- `image` (file, required)

#### PUT /api/gallery/:id
Update gallery item

#### DELETE /api/gallery/:id
Delete gallery item

---

## 📚 Bookings

### Public Routes

#### POST /api/bookings
Create new booking

**Headers:**
- `Content-Type: application/json`

**Body:**
```json
{
  "destinationId": "maasai-mara",
  "fullName": "John Doe",
  "email": "john@example.com",
  "phone": "+254712345678",
  "travelDate": "2024-12-15",
  "returnDate": "2024-12-25",
  "adults": 2,
  "children": 1,
  "budget": 5000,
  "interests": ["wildlife", "photography"],
  "specialRequests": "Vegetarian meals preferred",
  "termsAccepted": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Booking created successfully!",
  "data": {
    "booking": {
      "id": "booking_123",
      "bookingNumber": "ALT-20241201-001",
      "status": "pending",
      "destinationId": "maasai-mara",
      "fullName": "John Doe",
      "email": "john@example.com",
      "phone": "+254712345678",
      "travelDate": "2024-12-15",
      "returnDate": "2024-12-25",
      "adults": 2,
      "children": 1,
      "budget": 5000,
      "interests": ["wildlife", "photography"],
      "specialRequests": "Vegetarian meals preferred",
      "termsAccepted": true,
      "createdAt": "2024-12-01T10:00:00.000Z"
    }
  }
}
```

#### GET /api/bookings/track/:bookingNumber
Track booking by booking number

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "id": "booking_123",
      "bookingNumber": "ALT-20241201-001",
      "status": "confirmed",
      "destination": {
        "id": "maasai-mara",
        "name": "Maasai Mara National Reserve",
        "country": "Kenya"
      },
      "fullName": "John Doe",
      "email": "john@example.com",
      "travelDate": "2024-12-15",
      "returnDate": "2024-12-25",
      "adults": 2,
      "children": 1,
      "budget": 5000,
      "createdAt": "2024-12-01T10:00:00.000Z",
      "updatedAt": "2024-12-02T15:30:00.000Z"
    }
  }
}
```

### Admin Routes

#### GET /api/bookings
Get all bookings (admin only)

**Query Parameters:**
- `page`, `limit`, `search`, `status`, `dateFrom`, `dateTo`, `sort`, `order`

**Response:**
```json
{
  "success": true,
  "data": {
    "bookings": [
      {
        "id": "booking_123",
        "bookingNumber": "ALT-20241201-001",
        "status": "confirmed",
        "destinationId": "maasai-mara",
        "fullName": "John Doe",
        "email": "john@example.com",
        "phone": "+254712345678",
        "travelDate": "2024-12-15",
        "returnDate": "2024-12-25",
        "adults": 2,
        "children": 1,
        "budget": 5000,
        "createdAt": "2024-12-01T10:00:00.000Z",
        "updatedAt": "2024-12-02T15:30:00.000Z"
      }
    ],
    "pagination": {...},
    "filters": {
      "statuses": ["pending", "confirmed", "cancelled", "completed"]
    }
  }
}
```

#### GET /api/bookings/stats
Get booking statistics (admin only)

**Response:**
```json
{
  "success": true,
  "data": {
    "stats": {
      "total": 150,
      "pending": 25,
      "confirmed": 110,
      "cancelled": 10,
      "completed": 5,
      "revenue": 75000,
      "averageBookingValue": 500
    }
  }
}
```

#### GET /api/bookings/:id
Get single booking by ID (admin only)

#### PUT /api/bookings/:id
Update booking status (admin only)

**Body:**
```json
{
  "status": "confirmed",
  "notes": "Payment received"
}
```

#### DELETE /api/bookings/:id
Delete booking (admin only)

---

## ❓ FAQs

### Public Routes

#### GET /api/faqs
Get all FAQs with caching (5 minutes)

**Response:**
```json
{
  "success": true,
  "data": {
    "faqs": [
      {
        "id": "faq_123",
        "question": "What is the best time to visit East Africa?",
        "answer": "The best time to visit East Africa depends on your interests...",
        "category": "General",
        "featured": true
      }
    ]
  }
}
```

#### GET /api/faqs/:id
Get single FAQ by ID with caching (5 minutes)

### Admin Routes

#### POST /api/faqs
Create new FAQ

**Headers:**
- `Authorization: Bearer ${token}`

**Body:**
```json
{
  "question": "What is the best time to visit East Africa?",
  "answer": "The best time to visit East Africa depends on your interests...",
  "category": "General",
  "featured": true
}
```

#### PUT /api/faqs/:id
Update FAQ

#### DELETE /api/faqs/:id
Delete FAQ

---

## 📞 Contact

### Public Routes

#### POST /api/contact
Send contact message

**Headers:**
- `Content-Type: application/json`

**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "subject": "Safari Inquiry",
  "message": "I'm interested in booking a safari for December...",
  "phone": "+254712345678"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Thank you for your message! We'll get back to you soon."
}
```

### Admin Routes

#### GET /api/contact
Get all contact messages (admin only)

**Query Parameters:**
- `page`, `limit`, `search`, `status`, `sort`, `order`

#### GET /api/contact/:id
Get single contact message (admin only)

#### PUT /api/contact/:id
Update contact message status (admin only)

**Body:**
```json
{
  "status": "read",
  "response": "Thank you for your inquiry. We'll contact you shortly."
}
```

#### DELETE /api/contact/:id
Delete contact message (admin only)

---

## 📄 Pages

### Public Routes

#### GET /api/pages
Get all pages with caching (5 minutes)

**Response:**
```json
{
  "success": true,
  "data": {
    "pages": [
      {
        "id": "page_123",
        "title": "About Us",
        "slug": "about",
        "content": "Learn about our mission and team...",
        "featured": true,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

#### GET /api/pages/:slug
Get page by slug with caching (5 minutes)

### Admin Routes

#### POST /api/pages
Create new page

**Headers:**
- `Authorization: Bearer ${token}`

**Body:**
```json
{
  "title": "About Us",
  "slug": "about",
  "content": "Learn about our mission and team...",
  "featured": true
}
```

#### PUT /api/pages/:id
Update page

#### DELETE /api/pages/:id
Delete page

---

## 🎥 Virtual Tours

### Public Routes

#### GET /api/virtual-tours
Get all virtual tours with caching (5 minutes)

**Query Parameters:**
- `page`, `limit`, `search`, `featured`, `sort`, `order`

**Response:**
```json
{
  "success": true,
  "data": {
    "virtualTours": [
      {
        "id": "tour_123",
        "title": "Maasai Mara Virtual Safari",
        "description": "Experience the Maasai Mara from your screen...",
        "video": "https://example.com/video.mp4",
        "thumbnail": "https://example.com/thumbnail.jpg",
        "panorama": "https://example.com/panorama.jpg",
        "duration": "15:30",
        "featured": true,
        "status": "active",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {...}
  }
}
```

#### GET /api/virtual-tours/featured
Get featured virtual tours with caching (5 minutes)

#### GET /api/virtual-tours/stats
Get virtual tour statistics (admin only)

#### GET /api/virtual-tours/:idOrSlug
Get single virtual tour by ID or slug with caching (2 minutes)

### Admin Routes

#### POST /api/virtual-tours
Create new virtual tour

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: multipart/form-data`

**Body:**
- `title`, `description`, `duration`, `featured`, `status`
- `video` (file, optional)
- `thumbnail` (file, optional)
- `panorama` (file, optional)

#### PUT /api/virtual-tours/:id
Update virtual tour

#### PATCH /api/virtual-tours/:id/toggle
Toggle virtual tour status (admin only)

#### DELETE /api/virtual-tours/:id
Delete virtual tour (admin only)

#### PUT /api/virtual-tours/reorder
Reorder virtual tours (admin only)

**Body:**
```json
{
  "order": ["tour_1", "tour_2", "tour_3"]
}
```

---

## 📧 Newsletter

### Public Routes

#### POST /api/subscribers
Subscribe to newsletter

**Headers:**
- `Content-Type: application/json`

**Body:**
```json
{
  "email": "john@example.com",
  "fullName": "John Doe",
  "interests": ["destinations", "promotions"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Thank you for subscribing to our newsletter!"
}
```

### Admin Routes

#### GET /api/subscribers
Get all subscribers (admin only)

**Query Parameters:**
- `page`, `limit`, `search`, `sort`, `order`

#### DELETE /api/subscribers/:id
Delete subscriber (admin only)

---

## ⚙️ Settings

### Admin Routes Only

#### GET /api/settings
Get all settings

**Response:**
```json
{
  "success": true,
  "data": {
    "settings": {
      "siteName": "Altuvеrа Travel",
      "siteDescription": "East African travel experiences",
      "contactEmail": "info@altuvera.com",
      "contactPhone": "+254 700 000 000",
      "address": "Nairobi, Kenya",
      "socialLinks": {
        "facebook": "https://facebook.com/altuvera",
        "instagram": "https://instagram.com/altuvera",
        "twitter": "https://twitter.com/altuvera"
      },
      "businessHours": "Mon-Fri: 9AM-5PM",
      "currency": "USD",
      "currencySymbol": "$",
      "timezone": "Africa/Nairobi",
      "analyticsCode": "GA-123456789",
      "metaTags": {
        "keywords": "safari, east africa, travel",
        "description": "Best East African travel experiences"
      }
    }
  }
}
```

#### PUT /api/settings
Update settings

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: application/json`

**Body:**
```json
{
  "siteName": "Altuvеrа Travel",
  "contactEmail": "info@altuvera.com",
  "socialLinks": {
    "facebook": "https://facebook.com/altuvera"
  }
}
```

---

## 🔐 Authentication

### Public Routes

#### POST /api/auth/register
Register new account

**Headers:**
- `Content-Type: application/json`

**Body:**
```json
{
  "email": "john@example.com",
  "fullName": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Account created! Verification code sent to your email.",
  "data": {
    "email": "john@example.com",
    "fullName": "John Doe",
    "requiresVerification": true
  }
}
```

#### POST /api/auth/login
Login and get verification code

**Headers:**
- `Content-Type: application/json`

**Body:**
```json
{
  "email": "john@example.com",
  "fullName": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Verification code sent to your email.",
  "data": {
    "email": "john@example.com",
    "requiresVerification": true
  }
}
```

#### POST /api/auth/verify-code
Verify OTP code and get JWT

**Headers:**
- `Content-Type: application/json`

**Body:**
```json
{
  "email": "john@example.com",
  "code": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully verified!",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user_123",
      "email": "john@example.com",
      "fullName": "John Doe",
      "avatar": null,
      "role": "user",
      "isVerified": true
    }
  }
}
```

#### POST /api/auth/resend-code
Resend verification code

#### POST /api/auth/check-email
Check if email exists

#### POST /api/auth/google
Google OAuth authentication

**Body:**
```json
{
  "credential": "google-oauth-credential-token"
}
```

#### POST /api/auth/github
GitHub OAuth authentication

**Body:**
```json
{
  "code": "github-auth-code"
}
```

#### POST /api/auth/forgot-password
Request password reset

**Body:**
```json
{
  "email": "john@example.com"
}
```

#### POST /api/auth/reset-password
Reset password with token

**Body:**
```json
{
  "token": "reset-token",
  "password": "newpassword123"
}
```

### Protected Routes (Requires JWT)

#### GET /api/auth/me
Get current user profile

**Headers:**
- `Authorization: Bearer ${token}`

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_123",
      "email": "john@example.com",
      "fullName": "John Doe",
      "avatar": null,
      "phone": null,
      "bio": null,
      "role": "user",
      "isVerified": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

#### PUT /api/auth/profile
Update user profile

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: application/json`

**Body:**
```json
{
  "fullName": "John Smith",
  "phone": "+254712345678",
  "bio": "Travel enthusiast"
}
```

#### PUT /api/auth/change-password
Change password

**Headers:**
- `Authorization: Bearer ${token}`
- `Content-Type: application/json`

**Body:**
```json
{
  "currentPassword": "oldpassword123",
  "newPassword": "newpassword123"
}
```

#### POST /api/auth/logout
Logout user

**Headers:**
- `Authorization: Bearer ${token}`

#### DELETE /api/auth/me
Delete account

**Headers:**
- `Authorization: Bearer ${token}`

---

## 🏥 System Endpoints

### Health & Monitoring

#### GET /api/health
Comprehensive health check

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "4.0.0",
  "environment": "production",
  "server": {
    "status": "healthy",
    "uptime": 3600,
    "uptimeFormatted": "1h 0m 0s",
    "issues": [],
    "metrics": {
      "requests": { "total": 1000, "success": 950, "failed": 50, "active": 5 },
      "responseTime": { "avg": 150, "min": 50, "max": 500, "p95": 250, "p99": 400 },
      "memory": { "heapUsed": "150 MB", "heapTotal": "256 MB", "rss": "300 MB", "usagePercent": "58.6%" },
      "errorCount": 15,
      "errorRate": "5.00%"
    }
  },
  "database": {
    "status": "healthy",
    "connected": true,
    "latency": "15ms"
  }
}
```

#### GET /api/health/live
Liveness probe

#### GET /api/health/ready
Readiness probe

#### GET /api/system/metrics
Real-time system metrics

#### GET /api/system/report
Detailed system report

#### GET /api/system/info
Server information

#### GET /api/system/routes
Route status and statistics

#### GET /api/monitor/ping
Ping/Pong endpoint

#### GET /api/docs
API documentation and endpoint overview

---

## 📋 Error Handling

### Standard Error Response

```json
{
  "success": false,
  "error": "Error Type",
  "message": "Error description",
  "requestId": "req_123",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Common Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error
- `503` - Service Unavailable

---

## 🚀 Usage Examples

### Fetching Destinations
```javascript
// Get all destinations with filters
const response = await fetch('/api/destinations?page=1&limit=10&country=kenya&type=Wildlife%20Safari');
const data = await response.json();

// Search destinations
const searchResponse = await fetch('/api/destinations?search=Maasai%20Mara');
```

### Creating a Booking
```javascript
const bookingData = {
  destinationId: 'maasai-mara',
  fullName: 'John Doe',
  email: 'john@example.com',
  travelDate: '2024-12-15',
  adults: 2,
  budget: 5000
};

const response = await fetch('/api/bookings', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(bookingData)
});
```

### Authentication Flow
```javascript
// 1. Register
await fetch('/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com', fullName: 'User Name' })
});

// 2. Verify OTP
await fetch('/api/auth/verify-code', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com', code: '123456' })
});
```

---

## 📝 Notes

- All dates are in ISO 8601 format
- File uploads use multipart/form-data
- Pagination uses standard page/limit parameters
- Search is case-insensitive
- Caching times are specified per endpoint
- Admin routes require JWT with admin role
- Rate limits are enforced per IP address
- All responses include requestId for debugging

For more information, visit `/api/docs` endpoint.