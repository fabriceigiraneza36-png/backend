const { z } = require("zod");
require("dotenv").config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.string().transform(Number).default("3000"),

  // Database
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.string().transform(Number).default("5432"),
  DB_NAME: z.string().default("altuvera"),
  DB_USER: z.string().default("fabrice"),
  DB_PASSWORD: z.string().default("2004"),

  // Security
  JWT_SECRET: z.string().min(32, "JWT_SECRET should be at least 32 characters"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:3000"),

  // Email (Optional but recommended)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // Cloudinary (Optional)
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("❌ Invalid environment variables:", result.error.format());
  process.exit(1);
}

module.exports = result.data;
