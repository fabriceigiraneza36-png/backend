// validators/virtualTourValidator.js

const validateTourCreate = (body) => {
  const errors = [];

  if (!body.title || typeof body.title !== "string" || body.title.trim().length < 3) {
    errors.push("Title is required and must be at least 3 characters");
  }
  if (body.title && body.title.length > 255) {
    errors.push("Title must not exceed 255 characters");
  }
  if (body.video_url && !isValidUrl(body.video_url)) {
    errors.push("Invalid video URL format");
  }
  if (body.thumbnail_url && !isValidUrl(body.thumbnail_url)) {
    errors.push("Invalid thumbnail URL format");
  }
  if (body.panorama_url && !isValidUrl(body.panorama_url)) {
    errors.push("Invalid panorama URL format");
  }
  if (body.duration && !/^\d{1,3}:\d{2}$/.test(body.duration)) {
    errors.push("Duration must be in M:SS or MM:SS format");
  }
  if (body.destination_id !== null && body.destination_id !== undefined && body.destination_id !== "" && !isIntegerLike(body.destination_id)) {
    errors.push("destination_id must be a valid integer");
  }
  if (body.sort_order !== undefined && body.sort_order !== null && body.sort_order !== "" && !isIntegerLike(body.sort_order)) {
    errors.push("sort_order must be an integer");
  }
  if (body.media_type && !["video", "panorama", "mixed"].includes(body.media_type)) {
    errors.push("media_type must be one of: video, panorama, mixed");
  }
  if (body.is_featured !== undefined && !isBooleanLike(body.is_featured)) {
    errors.push("is_featured must be true or false");
  }
  if (body.tags !== undefined && body.tags !== null && body.tags !== "" && !isStringArrayLike(body.tags)) {
    errors.push("tags must be an array of strings");
  }
  if (body.meta !== undefined && body.meta !== null && body.meta !== "" && !isObjectLike(body.meta)) {
    errors.push("meta must be a valid JSON object");
  }

  return errors;
};

const validateTourUpdate = (body) => {
  const errors = [];

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length < 3) {
      errors.push("Title must be at least 3 characters");
    }
    if (body.title.length > 255) {
      errors.push("Title must not exceed 255 characters");
    }
  }
  if (body.video_url !== undefined && body.video_url && !isValidUrl(body.video_url)) {
    errors.push("Invalid video URL format");
  }
  if (body.thumbnail_url !== undefined && body.thumbnail_url && !isValidUrl(body.thumbnail_url)) {
    errors.push("Invalid thumbnail URL format");
  }
  if (body.panorama_url !== undefined && body.panorama_url && !isValidUrl(body.panorama_url)) {
    errors.push("Invalid panorama URL format");
  }
  if (body.duration && !/^\d{1,3}:\d{2}$/.test(body.duration)) {
    errors.push("Duration must be in M:SS or MM:SS format");
  }
  if (body.destination_id !== undefined && body.destination_id !== null && body.destination_id !== "" && !isIntegerLike(body.destination_id)) {
    errors.push("destination_id must be a valid integer");
  }
  if (body.sort_order !== undefined && body.sort_order !== null && body.sort_order !== "" && !isIntegerLike(body.sort_order)) {
    errors.push("sort_order must be an integer");
  }
  if (body.media_type && !["video", "panorama", "mixed"].includes(body.media_type)) {
    errors.push("media_type must be one of: video, panorama, mixed");
  }
  if (body.is_featured !== undefined && !isBooleanLike(body.is_featured)) {
    errors.push("is_featured must be true or false");
  }
  if (body.is_active !== undefined && !isBooleanLike(body.is_active)) {
    errors.push("is_active must be true or false");
  }
  if (body.tags !== undefined && body.tags !== null && body.tags !== "" && !isStringArrayLike(body.tags)) {
    errors.push("tags must be an array of strings");
  }
  if (body.meta !== undefined && body.meta !== null && body.meta !== "" && !isObjectLike(body.meta)) {
    errors.push("meta must be a valid JSON object");
  }

  return errors;
};

const isValidUrl = (string) => {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
};

const isIntegerLike = (value) => Number.isInteger(Number(value));

const isBooleanLike = (value) =>
  value === true || value === false || value === "true" || value === "false";

const isStringArrayLike = (value) => {
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === "string");
  }

  if (typeof value !== "string") return false;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string");
  } catch {
    return true;
  }
};

const isObjectLike = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return true;
  if (typeof value !== "string") return false;

  try {
    const parsed = JSON.parse(value);
    return Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
};

module.exports = { validateTourCreate, validateTourUpdate };
