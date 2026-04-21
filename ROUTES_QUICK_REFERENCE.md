# 📡 Media Upload Routes - Quick Reference

## All Available Endpoints

### Base URL
```
http://localhost:5000/api/media
```

### Authentication Required
All endpoints require:
- `Authorization: Bearer {JWT_ADMIN_TOKEN}` header

---

## 🏙️ Destination Image Routes

### Upload Images
```
POST /destinations/:id/images
```
- **Auth:** Admin only
- **Rate Limit:** 10/min
- **Body:** multipart/form-data with `images` file array
- **Response:** Array of image URLs

**Example:**
```bash
curl -X POST http://localhost:5000/api/media/destinations/1/images \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "images=@photo1.jpg" \
  -F "images=@photo2.jpg"
```

**Response:**
```json
{
  "success": true,
  "message": "2 image(s) uploaded successfully",
  "data": {
    "count": 2,
    "imageUrls": [
      "https://res.cloudinary.com/.../destinations/1/photo1.jpg",
      "https://res.cloudinary.com/.../destinations/1/photo2.jpg"
    ]
  }
}
```

---

### Delete Destination Image
```
DELETE /destinations/:id/images/:imageId
```
- **Auth:** Admin only
- **Params:** 
  - `id` = destination ID
  - `imageId` = image record ID from database
- **Response:** Success message

**Example:**
```bash
curl -X DELETE http://localhost:5000/api/media/destinations/1/images/5 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Image deleted successfully"
}
```

---

### Reorder Destination Images
```
PUT /destinations/:id/images/reorder
```
- **Auth:** Admin only
- **Params:** `id` = destination ID
- **Body:** JSON with `order` array of image IDs
- **Response:** Success message

**Example:**
```bash
curl -X PUT http://localhost:5000/api/media/destinations/1/images/reorder \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"order": [5, 3, 1, 7]}'
```

**Response:**
```json
{
  "success": true,
  "message": "Images reordered successfully"
}
```

---

## 🖼️ Gallery Image Routes

### Upload to Gallery
```
POST /gallery/upload
```
- **Auth:** Admin only
- **Rate Limit:** 10/min
- **Body:** multipart/form-data with:
  - `images` = file array
  - `category` = optional (landscape, portrait, etc.)
  - `location` = optional (location name)
  - `country_id` = optional
  - `destination_id` = optional

**Example:**
```bash
curl -X POST http://localhost:5000/api/media/gallery/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "images=@photo1.jpg" \
  -F "images=@photo2.jpg" \
  -F "category=landscape" \
  -F "location=Mount Kilimanjaro"
```

**Response:**
```json
{
  "success": true,
  "message": "2 image(s) uploaded to gallery",
  "data": {
    "count": 2,
    "imageUrls": [
      "https://res.cloudinary.com/.../gallery/photo1.jpg",
      "https://res.cloudinary.com/.../gallery/photo2.jpg"
    ]
  }
}
```

---

### Delete Gallery Image
```
DELETE /gallery/:id
```
- **Auth:** Admin only
- **Params:** `id` = gallery image ID
- **Response:** Success message

**Example:**
```bash
curl -X DELETE http://localhost:5000/api/media/gallery/15 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Gallery image deleted successfully"
}
```

---

## 🌍 Country Image Routes

### Upload Country Flag
```
POST /countries/:id/flag
```
- **Auth:** Admin only
- **Rate Limit:** 10/min
- **Params:** `id` = country ID
- **Body:** multipart/form-data with `flag` file
- **Special:** Flag becomes FIRST image in images array

**Example:**
```bash
curl -X POST http://localhost:5000/api/media/countries/1/flag \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "flag=@flag.png"
```

**Response:**
```json
{
  "success": true,
  "message": "Country flag uploaded successfully",
  "data": {
    "flagUrl": "https://res.cloudinary.com/.../countries/flags/1-flag.png",
    "publicId": "countries/flags/1-flag"
  }
}
```

---

### Upload Country Images
```
POST /countries/:id/images
```
- **Auth:** Admin only
- **Rate Limit:** 10/min
- **Params:** `id` = country ID
- **Body:** multipart/form-data with `images` file array
- **Note:** These are added after flag (if flag exists)

**Example:**
```bash
curl -X POST http://localhost:5000/api/media/countries/1/images \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "images=@landscape1.jpg" \
  -F "images=@landscape2.jpg"
```

**Response:**
```json
{
  "success": true,
  "message": "3 image(s) uploaded to country",
  "data": {
    "count": 3,
    "imageUrls": [
      "https://res.cloudinary.com/.../countries/images/1/landscape1.jpg",
      "https://res.cloudinary.com/.../countries/images/1/landscape2.jpg",
      "https://res.cloudinary.com/.../countries/images/1/landscape3.jpg"
    ]
  }
}
```

---

### Delete Country Image
```
DELETE /countries/:id/images/:imageUrl
```
- **Auth:** Admin only
- **Params:**
  - `id` = country ID
  - `imageUrl` = URL-encoded image URL
- **Note:** Detects if deleted image is the flag
- **Response:** Success and flag deletion status

**Example:**
```bash
# URL encode the full image URL
# https://res.cloudinary.com/.../image.jpg 
# becomes: https%3A%2F%2Fres.cloudinary.com%2F...%2Fimage.jpg

curl -X DELETE "http://localhost:5000/api/media/countries/1/images/https%3A%2F%2Fres.cloudinary.com%2F...%2Fimage.jpg" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Country image deleted successfully",
  "isFlagDeleted": false
}
```

---

## 📊 General Upload Routes

### Upload Single Image
```
POST /api/uploads/image
```
- **Auth:** Required
- **Body:** multipart/form-data with `image` file
- **Response:** Image URL and metadata

---

### Upload Multiple Images
```
POST /api/uploads/images
```
- **Auth:** Required
- **Body:** multipart/form-data with `images` file array
- **Response:** Array of image URLs

---

### Delete Asset
```
DELETE /api/uploads/asset/:publicId
```
- **Auth:** Required
- **Params:** `publicId` = Cloudinary public ID
- **Response:** Success message

---

### Get Upload Stats
```
GET /api/uploads/stats
```
- **Auth:** Required
- **Response:** Upload statistics

---

## 🔑 Authentication

All routes require a valid JWT token with admin role:

```bash
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### How to Get Admin Token

1. Login as admin user
2. Get JWT token from login response
3. Include in `Authorization` header for all requests

---

## 📊 Response Format

### Success Response
```json
{
  "success": true,
  "message": "Operation description",
  "data": {
    "imageUrls": ["https://..."],
    "assets": [
      {
        "url": "https://...",
        "publicId": "path/to/file",
        "width": 1920,
        "height": 1080
      }
    ]
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error description",
  "statusCode": 400,
  "code": "ERROR_CODE"
}
```

---

## ⚙️ Rate Limiting

- **Default:** 10 uploads per minute per admin
- **Rate Limit Header:** `X-RateLimit-Remaining`
- **Reset Time:** Resets every minute

---

## 📁 File Structure in Cloudinary

All uploads organized automatically:

```
ce0f3517ca896eac7772cadf4c67aa0d41/
├── destinations/
│   ├── 1/
│   │   ├── image1-uuid.jpg
│   │   └── image2-uuid.jpg
│   └── 2/
│       └── image1-uuid.jpg
├── gallery/
│   ├── photo1-uuid.jpg
│   └── photo2-uuid.jpg
└── countries/
    ├── flags/
    │   └── 1-flag.png
    └── images/
        ├── 1/
        │   ├── landscape1-uuid.jpg
        │   └── landscape2-uuid.jpg
        └── 10/
            └── landscape1-uuid.jpg
```

---

## 🧪 Testing with cURL

### Test 1: Upload Destination Image
```bash
curl -X POST http://localhost:5000/api/media/destinations/1/images \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -F "images=@test.jpg"
```

### Test 2: Upload Gallery Image
```bash
curl -X POST http://localhost:5000/api/media/gallery/upload \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -F "images=@test.jpg" \
  -F "category=landscape"
```

### Test 3: Upload Country Flag
```bash
curl -X POST http://localhost:5000/api/media/countries/1/flag \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -F "flag=@flag.png"
```

### Test 4: List Destination Images
```bash
curl -X GET http://localhost:5000/api/destinations/1 \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

## 💾 Database Tables

Images are stored in these tables:

- **Destinations:** `image_urls` (TEXT[] array)
- **Gallery:** `image_url` (VARCHAR(500))
- **Countries:** `images` (TEXT[] array) + `flag_url` (VARCHAR(500))

---

## 🎯 Key Points

1. **All routes require admin authentication**
2. **Files must be in FormData, not JSON**
3. **Use `images` as field name for multiple files**
4. **Use `flag` for country flag upload**
5. **URLs are stored in database after upload**
6. **Images auto-organized in Cloudinary**
7. **Cloudinary handles image optimization**
8. **Failed uploads auto-cleanup**
9. **Rate limiting prevents abuse**
10. **All URLs are HTTPS (secure)**

---

## 🚀 Ready to Upload?

1. Get admin JWT token
2. Choose endpoint based on resource type
3. Use curl or fetch() to upload
4. Get back URLs in response
5. URLs automatically stored in database

**Happy uploading!** 🎉
