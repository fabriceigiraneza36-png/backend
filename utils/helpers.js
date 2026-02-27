const { v4: uuidv4 } = require("uuid");

/**
 * Generate a URL-friendly slug from a string
 */
const slugify = (text) =>
  text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

/**
 * Generate a unique booking number
 */
const generateBookingNumber = () => {
  const date = new Date();
  const prefix = "BK";
  const dateStr =
    date.getFullYear().toString().slice(-2) +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0");
  const random = uuidv4().split("-")[0].toUpperCase();
  return `${prefix}-${dateStr}-${random}`;
};

/**
 * Estimate reading time for a text block (minutes)
 */
const calculateReadTime = (content) => {
  if (!content) return 0;
  const words = content.split(/\s+/).length;
  return Math.ceil(words / 200);
};

/**
 * Build paginated response
 */
const paginate = (totalItems, page = 1, limit = 10) => {
  const totalPages = Math.ceil(totalItems / limit);
  const currentPage = Math.min(Math.max(1, parseInt(page)), totalPages || 1);
  const offset = (currentPage - 1) * limit;

  return {
    currentPage,
    totalPages,
    totalItems,
    limit: parseInt(limit),
    offset,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1,
  };
};

/**
 * Build a WHERE clause and params array from an object of filters
 */
const buildWhereClause = (filters, startIndex = 1) => {
  const conditions = [];
  const params = [];
  let idx = startIndex;

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      conditions.push(`${key} = $${idx}`);
      params.push(value);
      idx++;
    }
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    nextIndex: idx,
  };
};

module.exports = {
  slugify,
  generateBookingNumber,
  calculateReadTime,
  paginate,
  buildWhereClause,
};