/**
 * backend/utils/helpers.js v2.0
 * Added: sanitizeInput, generateConfirmationCode
 * Preserved: slugify, generateBookingNumber, calculateReadTime, paginate, buildWhereClause
 */

"use strict";

const { v4: uuidv4 } = require("uuid");

/* ── slugify ──────────────────────────────────────────────────────────────── */
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

/* ── generateBookingNumber ────────────────────────────────────────────────── */
const generateBookingNumber = () => {
  const date    = new Date();
  const prefix  = "BK";
  const dateStr =
    date.getFullYear().toString().slice(-2) +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0");
  const random = uuidv4().split("-")[0].toUpperCase();
  return `${prefix}-${dateStr}-${random}`;
};

/* ── generateConfirmationCode ─────────────────────────────────────────────── */
/**
 * Generate a short alphanumeric confirmation code.
 * Format: ALT-XXXXXXXX  (8 hex chars, uppercase)
 */
const generateConfirmationCode = () => {
  const hex = uuidv4().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `ALT-${hex}`;
};

/* ── sanitizeInput ────────────────────────────────────────────────────────── */
/**
 * Strip HTML tags and trim whitespace from user-supplied strings.
 * Used before inserting into the database.
 *
 * @param {string} input
 * @returns {string}
 */
const sanitizeInput = (input) => {
  if (typeof input !== "string") return String(input ?? "");
  return input
    .replace(/<[^>]*>/g, "")   // strip HTML tags
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .trim();
};

/* ── calculateReadTime ────────────────────────────────────────────────────── */
const calculateReadTime = (content) => {
  if (!content) return 0;
  const words = content.split(/\s+/).length;
  return Math.ceil(words / 200);
};

/* ── paginate ─────────────────────────────────────────────────────────────── */
const paginate = (totalItems, page = 1, limit = 10) => {
  const totalPages  = Math.ceil(totalItems / limit);
  const currentPage = Math.min(Math.max(1, parseInt(page)), totalPages || 1);
  const offset      = (currentPage - 1) * limit;
  return {
    currentPage,
    totalPages,
    totalItems,
    limit:       parseInt(limit),
    offset,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1,
  };
};

/* ── buildWhereClause ─────────────────────────────────────────────────────── */
const buildWhereClause = (filters, startIndex = 1) => {
  const conditions = [];
  const params     = [];
  let   idx        = startIndex;

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      conditions.push(`${key} = $${idx}`);
      params.push(value);
      idx++;
    }
  }

  return {
    clause:    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    nextIndex: idx,
  };
};

/* ── sanitizeInput ────────────────────────────────────────────────────────── */

module.exports = {
  slugify,
  generateBookingNumber,
  generateConfirmationCode,
  sanitizeInput,
  calculateReadTime,
  paginate,
  buildWhereClause,
};