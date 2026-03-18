/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TEAM MEMBER VALIDATOR - Altuvera Travel
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { body, validationResult } = require("express-validator");
const AppError = require("../utils/AppError");

const validateTeamMember = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 2, max: 150 })
    .withMessage("Name must be between 2 and 150 characters"),

  body("role")
    .trim()
    .notEmpty()
    .withMessage("Role is required")
    .isLength({ min: 2, max: 150 })
    .withMessage("Role must be between 2 and 150 characters"),

  body("department")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage("Department must be less than 100 characters"),

  body("bio")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Bio must be less than 2000 characters"),

  body("email")
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isEmail()
    .withMessage("Must be a valid email address")
    .normalizeEmail(),

  body("phone")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 30 })
    .withMessage("Phone must be less than 30 characters"),

  body("linkedin_url")
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isURL()
    .withMessage("LinkedIn URL must be a valid URL"),

  body("twitter_url")
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isURL()
    .withMessage("Twitter URL must be a valid URL"),

  body("instagram_url")
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isURL()
    .withMessage("Instagram URL must be a valid URL"),

  body("website_url")
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isURL()
    .withMessage("Website URL must be a valid URL"),

  body("years_experience")
    .optional({ nullable: true })
    .isInt({ min: 0, max: 100 })
    .withMessage("Years of experience must be between 0 and 100"),

  body("location")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage("Location must be less than 200 characters"),

  body("country")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage("Country must be less than 100 characters"),

  body("display_order")
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage("Display order must be a non-negative integer"),

  body("meta_title")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage("Meta title must be less than 200 characters"),

  body("meta_description")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage("Meta description must be less than 500 characters"),

  body("joined_date")
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage("Joined date must be a valid date (YYYY-MM-DD)"),

  // Handle validation errors
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const messages = errors.array().map((err) => err.msg);
      return next(new AppError(messages.join(". "), 400));
    }
    next();
  },
];

module.exports = { validateTeamMember };