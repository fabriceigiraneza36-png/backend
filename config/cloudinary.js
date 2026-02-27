const { v2: cloudinary } = require("cloudinary");

const parseCloudinaryUrl = (value) => {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    return {
      cloud_name: parsed.hostname || "",
      api_key: decodeURIComponent(parsed.username || ""),
      api_secret: decodeURIComponent(parsed.password || ""),
    };
  } catch {
    return null;
  }
};

const fromUrl = parseCloudinaryUrl(process.env.CLOUDINARY_URL);

const cloudName = process.env.CLOUDINARY_CLOUD_NAME || fromUrl?.cloud_name;
const apiKey = process.env.CLOUDINARY_API_KEY || fromUrl?.api_key;
const apiSecret = process.env.CLOUDINARY_API_SECRET || fromUrl?.api_secret;

const isCloudinaryConfigured = Boolean(cloudName && apiKey && apiSecret);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

const ensureCloudinaryConfigured = () => {
  if (isCloudinaryConfigured) return;

  const error = new Error(
    "Cloudinary is not configured. Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET."
  );
  error.statusCode = 503;
  error.code = "CLOUDINARY_NOT_CONFIGURED";
  throw error;
};

module.exports = {
  cloudinary,
  isCloudinaryConfigured,
  ensureCloudinaryConfigured,
};
