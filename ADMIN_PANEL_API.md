# Admin Panel Backend API

This document describes the admin-related backend API surface for the React admin panel. It covers admin authentication, admin-only resource routes, route paths, required auth, and payload guidance for the frontend.

> All admin routes require an authenticated admin session. Most routes use standard JSON request bodies. Upload endpoints require `multipart/form-data`.

## Authentication

### Base path
- `/api/admin/auth`

### Endpoints

- `POST /api/admin/auth/login`
  - Description: Authenticate an admin user and receive a JWT + refresh token.
  - Body: `{ email, password }`
  - Response: `{ success, data: { token, refreshToken, user } }`
  - Notes: no auth header required.

- `POST /api/admin/auth/refresh-token`
  - Description: Refresh an admin JWT when the access token expires.
  - Body: `{ refreshToken }`
  - Response: `{ success, data: { token, refreshToken } }`
  - Notes: no auth header required.

- `POST /api/admin/auth/register`
  - Description: Create a new admin account.
  - Auth: `Authorization: Bearer <admin token>` required.
  - Body: typically `{ email, username, password, full_name, role }`
  - Notes: only an existing admin can create additional admin users.

- `GET /api/admin/auth/me`
  - Description: Get the current admin profile.
  - Auth: admin.
  - Response: current admin fields.

- `PUT /api/admin/auth/me` and `PUT /api/admin/auth/profile`
  - Description: Update current admin profile.
  - Auth: admin.
  - Body: typically includes `full_name`, `avatar_url`, `phone`, `bio`, `preferences`.
  - Notes: one or more fields may be updated in a single request.

- `PUT /api/admin/auth/change-password`
  - Description: Change the current admin password.
  - Auth: admin.
  - Body: likely includes `currentPassword` and `newPassword`.

- `POST /api/admin/auth/logout`
  - Description: Log out the current admin session.
  - Auth: admin.

- `DELETE /api/admin/auth/me`
  - Description: Delete the current admin account.
  - Auth: admin.

### Admin auth requirements

- Header: `Authorization: Bearer <token>`
- The backend verifies token type and admin role using `protect` and `adminOnly` middleware.
- `adminOnly` also accepts users with role `admin` or `super_admin`.

## Admin resources

The following sections describe the admin-only endpoints for resources used by the admin panel.

---

## Bookings

Base: `/api/bookings`

- `GET /api/bookings/stats`
  - Description: Admin booking statistics for dashboard cards.
  - Query params: none required.

- `GET /api/bookings/upcoming`
  - Description: Upcoming bookings feed.
  - Query params: optional `limit`, `dateFrom`, `dateTo`.

- `GET /api/bookings/recent`
  - Description: Recent booking activity.
  - Query params: optional `limit`.

- `GET /api/bookings/export`
  - Description: Export booking data as a report.
  - Query params: optional filters such as `status`, `dateFrom`, `dateTo`.

- `POST /api/bookings/bulk-status`
  - Description: Update status for multiple bookings.
  - Body: likely includes `{ bookingIds: [...], status: "confirmed" | "cancelled" | ... }`.

- `GET /api/bookings`
  - Description: Admin list of all bookings.
  - Query params: `page`, `limit`, `search`, `status`, `dateFrom`, `dateTo`, `sort`.

- `GET /api/bookings/:id`
  - Description: Get a single booking detail.
  - Path params: `id`.

- `PUT /api/bookings/:id`
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
