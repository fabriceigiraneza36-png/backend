/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TEAM VALIDATOR MIDDLEWARE - Altuvera Travel
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { body, validationResult } = require("express-validator");
const AppError = require("../utils/AppError");

const validateTeamMember = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be between 2 and 100 characters"),

  body("role")
    .trim()
    .notEmpty()
    .withMessage("Role is required")
    .isLength({ max: 100 })
    .withMessage("Role must not exceed 100 characters"),

  body("department")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("Department must not exceed 50 characters"),

  body("email")
    .optional()
    .trim()
    .isEmail()
    .withMessage("Please provide a valid email address")
    .normalizeEmail(),

  body("phone")
    .optional()
    .trim()
    .isLength({ max: 30 })
    .withMessage("Phone must not exceed 30 characters"),

  body("bio")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Bio must not exceed 1000 characters"),

  body("linkedin_url")
    .optional()
    .trim()
    .isURL()
    .withMessage("Please provide a valid LinkedIn URL"),

  body("twitter_url")
    .optional()
    .trim()
    .isURL()
    .withMessage("Please provide a valid Twitter URL"),

  body("instagram_url")
    .optional()
    .trim()
    .isURL()
    .withMessage("Please provide a valid Instagram URL"),

  body("website_url")
    .optional()
    .trim()
    .isURL()
    .withMessage("Please provide a valid website URL"),

  body("years_experience")
    .optional()
    .isInt({ min: 0, max: 100 })
    .withMessage("Years of experience must be between 0 and 100"),

  body("location")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Location must not exceed 100 characters"),

  body("country")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("Country must not exceed 50 characters"),

  body("display_order")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Display order must be a positive integer"),

  body("is_featured")
    .optional()
    .isBoolean()
    .withMessage("is_featured must be a boolean"),

  body("is_active")
    .optional()
    .isBoolean()
    .withMessage("is_active must be a boolean"),

  body("show_on_homepage")
    .optional()
    .isBoolean()
    .withMessage("show_on_homepage must be a boolean"),

  // Validation result handler
  (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((err) => err.msg);
      return next(new AppError(errorMessages.join(", "), 400));
    }

    next();
  },
];

module.exports = { validateTeamMember };
