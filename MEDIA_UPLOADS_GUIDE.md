# Media Upload Routes Documentation

Complete guide to uploading and managing media files (images) for destinations, gallery, and countries using Cloudinary.

---

## Table of Contents

1. [Cloudinary Configuration](#cloudinary-configuration)
2. [Destination Image Uploads](#destination-image-uploads)
3. [Gallery Image Uploads](#gallery-image-uploads)
4. [Country Image Uploads](#country-image-uploads)
5. [File Storage Structure](#file-storage-structure)
6. [Frontend Integration Examples](#frontend-integration-examples)
7. [Database Schema Updates](#database-schema-updates)

---

## Cloudinary Configuration

### Environment Variables

Your Cloudinary credentials are already configured in `.env`:

```bash
CLOUDINARY_CLOUD_NAME=doijjawna
CLOUDINARY_API_KEY=733763234215354
CLOUDINARY_API_SECRET=O5zljZxEvc35glPsM7N8wotHeXI
CLOUDINARY_URL=cloudinary://733763234215354:O5zljZxEvc35glPsM7N8wotHeXI@doijjawna
CLOUDINARY_FOLDER=ce0f3517ca896eac7772cadf4c67aa0d41
```

### Verify Configuration

```bash
node test-cloudinary.js
```

---

## Destination Image Uploads

### Upload Images for a Destination

**Endpoint:** `POST /api/media/destinations/:id/images`

**Authentication:** Required (Admin only)

**Parameters:**
- `id` (path param) - Destination ID

**Request:**
```bash
curl -X POST http://localhost:5000/api/media/destinations/1/images \
  -H "Authorization: Bearer {token}" \
  -F "images=@photo1.jpg" \
  -F "images=@photo2.jpg" \
  -F "images=@photo3.jpg"
```

**Frontend (JavaScript):**
```javascript
const uploadDestinationImages = async (destinationId, imageFiles, token) => {
  const formData = new FormData();
  
  imageFiles.forEach(file => {
    formData.append('images', file);
  });

  const response = await fetch(`/api/media/destinations/${destinationId}/images`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  return response.json();
};
```

**Response:**
```json
{
  "success": true,
  "message": "3 image(s) uploaded successfully",
  "data": {
    "count": 3,
    "imageUrls": [
      "https://res.cloudinary.com/.../destinations/.../image1.jpg",
      "https://res.cloudinary.com/.../destinations/.../image2.jpg",
      "https://res.cloudinary.com/.../destinations/.../image3.jpg"
    ],
    "assets": [
      {
        "url": "https://res.cloudinary.com/.../image1.jpg",
        "publicId": "destinations/1/...",
        "width": 1920,
        "height": 1080
      }
    ]
  }
}
```

### Delete Destination Image

**Endpoint:** `DELETE /api/media/destinations/:id/images/:imageId`

**Authentication:** Required (Admin only)

**Parameters:**
- `id` (path param) - Destination ID
- `imageId` (path param) - Image ID in database

**Request:**
```bash
curl -X DELETE http://localhost:5000/api/media/destinations/1/images/5 \
  -H "Authorization: Bearer {token}"
```

**Response:**
```json
{
  "success": true,
  "message": "Image deleted successfully"
}
```

### Reorder Destination Images

**Endpoint:** `PUT /api/media/destinations/:id/images/reorder`

**Authentication:** Required (Admin only)

**Request Body:**
```json
{
  "order": [5, 3, 7, 1]
}
```

**Request:**
```bash
curl -X PUT http://localhost:5000/api/media/destinations/1/images/reorder \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"order": [5, 3, 7, 1]}'
```

**Response:**
```json
{
  "success": true,
  "message": "Images reordered successfully"
}
```

---

## Gallery Image Uploads

### Upload Images to Gallery

**Endpoint:** `POST /api/media/gallery/upload`

**Authentication:** Required (Admin only)

**Request Body Fields:**
- `images` (file array) - Image files
- `category` (optional) - Gallery category
- `location` (optional) - Where photo was taken
- `country_id` (optional) - Associated country ID
- `destination_id` (optional) - Associated destination ID

**Request:**
```bash
curl -X POST http://localhost:5000/api/media/gallery/upload \
  -H "Authorization: Bearer {token}" \
  -F "images=@photo1.jpg" \
  -F "images=@photo2.jpg" \
  -F "category=landscape" \
  -F "location=Mount Kilimanjaro" \
  -F "country_id=10"
```

**Frontend (JavaScript):**
```javascript
const uploadGalleryImages = async (imageFiles, category, location, token) => {
  const formData = new FormData();
  
  imageFiles.forEach(file => {
    formData.append('images', file);
  });
  
  formData.append('category', category || 'uncategorized');
  formData.append('location', location || '');

  const response = await fetch('/api/media/gallery/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  return response.json();
};
```

**Response:**
```json
{
  "success": true,
  "message": "2 image(s) uploaded to gallery",
  "data": {
    "count": 2,
    "imageUrls": [
      "https://res.cloudinary.com/.../gallery/.../photo1.jpg",
      "https://res.cloudinary.com/.../gallery/.../photo2.jpg"
    ],
    "assets": [
      {
        "url": "https://res.cloudinary.com/.../photo1.jpg",
        "publicId": "gallery/...",
        "width": 1920,
        "height": 1080
      }
    ]
  }
}
```

### Delete Gallery Image

**Endpoint:** `DELETE /api/media/gallery/:id`

**Authentication:** Required (Admin only)

**Parameters:**
- `id` (path param) - Gallery image ID

**Request:**
```bash
curl -X DELETE http://localhost:5000/api/media/gallery/15 \
  -H "Authorization: Bearer {token}"
```

**Response:**
```json
{
  "success": true,
  "message": "Gallery image deleted successfully"
}
```

---

## Country Image Uploads

### Upload Country Flag (First Image)

**Endpoint:** `POST /api/media/countries/:id/flag`

**Authentication:** Required (Admin only)

**Parameters:**
- `id` (path param) - Country ID

**Request:**
```bash
curl -X POST http://localhost:5000/api/media/countries/10/flag \
  -H "Authorization: Bearer {token}" \
  -F "flag=@flag.png"
```

**Frontend (JavaScript):**
```javascript
const uploadCountryFlag = async (countryId, flagFile, token) => {
  const formData = new FormData();
  formData.append('flag', flagFile);

  const response = await fetch(`/api/media/countries/${countryId}/flag`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  return response.json();
};
```

**Response:**
```json
{
  "success": true,
  "message": "Country flag uploaded successfully",
  "data": {
    "flagUrl": "https://res.cloudinary.com/.../countries/flags/flag.png",
    "publicId": "countries/flags/10-flag",
    "width": 1200,
    "height": 800
  }
}
```

**Important:**
- The flag becomes the FIRST image in the country's `images` array
- If a flag already exists, it will be replaced
- The `flag_url` field is updated separately for easy access

### Upload Additional Country Images

**Endpoint:** `POST /api/media/countries/:id/images`

**Authentication:** Required (Admin only)

**Parameters:**
- `id` (path param) - Country ID

**Request:**
```bash
curl -X POST http://localhost:5000/api/media/countries/10/images \
  -H "Authorization: Bearer {token}" \
  -F "images=@landscape1.jpg" \
  -F "images=@landscape2.jpg" \
  -F "images=@landscape3.jpg"
```

**Response:**
```json
{
  "success": true,
  "message": "3 image(s) uploaded to country",
  "data": {
    "count": 3,
    "imageUrls": [
      "https://res.cloudinary.com/.../countries/images/landscape1.jpg",
      "https://res.cloudinary.com/.../countries/images/landscape2.jpg",
      "https://res.cloudinary.com/.../countries/images/landscape3.jpg"
    ],
    "assets": [
      {
        "url": "https://res.cloudinary.com/.../landscape1.jpg",
        "publicId": "countries/images/10/...",
        "width": 1920,
        "height": 1080
      }
    ]
  }
}
```

### Delete Country Image

**Endpoint:** `DELETE /api/media/countries/:id/images/:imageUrl`

**Authentication:** Required (Admin only)

**Parameters:**
- `id` (path param) - Country ID
- `imageUrl` (path param) - URL-encoded image URL

**Request:**
```bash
curl -X DELETE http://localhost:5000/api/media/countries/10/images/https%3A%2F%2Fres.cloudinary.com%2F...%2Fimage.jpg \
  -H "Authorization: Bearer {token}"
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

## File Storage Structure

### Cloudinary Folder Organization

All files are automatically organized in Cloudinary under your base folder:

```
ce0f3517ca896eac7772cadf4c67aa0d41/
├── destinations/
│   ├── 1/
│   │   ├── image1-xyz123.jpg
│   │   ├── image2-abc456.jpg
│   │   └── image3-def789.jpg
│   └── 2/
│       └── image1-ghi012.jpg
├── gallery/
│   ├── photo1-jkl345.jpg
│   ├── photo2-mno678.jpg
│   └── photo3-pqr901.jpg
└── countries/
    ├── flags/
    │   ├── 1-flag.png
    │   ├── 2-flag.png
    │   └── 10-flag.png
    └── images/
        ├── 1/
        │   ├── landscape1-stu234.jpg
        │   └── landscape2-vwx567.jpg
        └── 10/
            ├── landscape1-yza890.jpg
            └── landscape2-bcd123.jpg
```

---

## Frontend Integration Examples

### React Component Example

```javascript
import React, { useState } from 'react';

export const DestinationImageUpload = ({ destinationId, token }) => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files));
  };

  const handleUpload = async () => {
    try {
      setLoading(true);
      setError(null);

      const formData = new FormData();
      files.forEach(file => {
        formData.append('images', file);
      });

      const response = await fetch(
        `/api/media/destinations/${destinationId}/images`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Upload failed');
      }

      console.log('Upload successful:', result.data);
      setFiles([]);
      // Trigger refresh of images
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h3>Upload Destination Images</h3>
      <input 
        type="file" 
        multiple 
        accept="image/*"
        onChange={handleFileChange}
        disabled={loading}
      />
      <button 
        onClick={handleUpload} 
        disabled={loading || files.length === 0}
      >
        {loading ? 'Uploading...' : 'Upload Images'}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {files.length > 0 && <p>{files.length} file(s) selected</p>}
    </div>
  );
};
```

### Vue Component Example

```vue
<template>
  <div class="upload-container">
    <h3>Upload Gallery Images</h3>
    <input 
      type="file" 
      @change="onFileChange" 
      multiple 
      accept="image/*"
      :disabled="loading"
    />
    
    <div v-if="files.length > 0" class="file-list">
      <p>{{ files.length }} file(s) selected</p>
    </div>

    <button 
      @click="uploadGalleryImages" 
      :disabled="loading || files.length === 0"
      class="upload-btn"
    >
      {{ loading ? 'Uploading...' : 'Upload to Gallery' }}
    </button>

    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script>
export default {
  props: {
    token: String,
    category: String
  },
  data() {
    return {
      files: [],
      loading: false,
      error: null
    };
  },
  methods: {
    onFileChange(e) {
      this.files = Array.from(e.target.files);
    },
    async uploadGalleryImages() {
      try {
        this.loading = true;
        this.error = null;

        const formData = new FormData();
        this.files.forEach(file => {
          formData.append('images', file);
        });
        
        if (this.category) {
          formData.append('category', this.category);
        }

        const response = await fetch('/api/media/gallery/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`
          },
          body: formData
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message || 'Upload failed');
        }

        this.$emit('upload-success', result.data);
        this.files = [];
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>
```

---

## Database Schema Updates

### Destinations Table Changes

The `destinations` table now stores multiple image URLs:

```sql
-- Existing column for primary image (kept for backward compatibility)
image_url VARCHAR(500)

-- New column for array of all image URLs
image_urls TEXT[] DEFAULT ARRAY[]::TEXT[]
```

### Destination Images Table

Stores detailed information about each destination image:

```sql
CREATE TABLE destination_images (
  id SERIAL PRIMARY KEY,
  destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  image_url VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500),
  caption VARCHAR(255),
  is_primary BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Gallery Table Changes

The `gallery` table now stores full Cloudinary URLs:

```sql
CREATE TABLE gallery (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255),
  description TEXT,
  image_url VARCHAR(500) NOT NULL,  -- Full Cloudinary URL
  thumbnail_url VARCHAR(500),
  category VARCHAR(100),
  location VARCHAR(255),
  country_id INTEGER REFERENCES countries(id) ON DELETE SET NULL,
  destination_id INTEGER REFERENCES destinations(id) ON DELETE SET NULL,
  photographer VARCHAR(255),
  sort_order INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Countries Table Changes

The `countries` table now stores flag and multiple images:

```sql
-- Existing column for flag (kept for backward compatibility)
flag VARCHAR(10)
flag_url VARCHAR(500)  -- Full Cloudinary URL for flag

-- New column for array of all image URLs (flag is always first)
images TEXT[] DEFAULT ARRAY[]::TEXT[]
```

---

## Error Handling

### Common Errors

```json
{
  "error": "No images provided",
  "statusCode": 400,
  "code": "UPLOAD_REQUIRED"
}

{
  "error": "Destination not found",
  "statusCode": 404,
  "code": "NOT_FOUND"
}

{
  "error": "File too large. Max size is 5MB.",
  "statusCode": 400,
  "code": "FILE_TOO_LARGE"
}

{
  "error": "Unsupported file type",
  "statusCode": 400,
  "code": "INVALID_FILE_TYPE"
}
```

---

## Best Practices

1. **Always use HTTPS URLs** from Cloudinary responses
2. **Store URLs in database** for easy retrieval
3. **Handle errors gracefully** in frontend
4. **Validate file types** before uploading
5. **Show upload progress** to users
6. **Optimize images** for web (Cloudinary does this automatically)
7. **Cache responses** when possible
8. **Keep track of public_ids** for deletion
9. **Use pagination** when displaying many images
10. **Test upload limits** before production

---

## Testing

```bash
# Test Cloudinary configuration
node test-cloudinary.js

# Start the server
npm start

# The API will be available at
http://localhost:5000

# Test upload endpoint
POST /api/media/destinations/1/images
```

---

This setup provides a complete solution for managing images across your entire travel app with Cloudinary as the CDN and storage provider.
