const multer = require("multer");
const { cloudinary, ensureCloudinaryConfigured } = require("../config/cloudinary");

const BASE_FOLDER =
  process.env.CLOUDINARY_FOLDER || "ce0f3517ca896eac7772cadf4c67aa0d41";
const MAX_FILE_SIZE = Number.parseInt(process.env.MAX_FILE_SIZE, 10) || 20 * 1024 * 1024;
const MAX_FILES = Number.parseInt(process.env.MAX_FILES_PER_REQUEST, 10) || 20;
const MAX_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.UPLOAD_CONCURRENCY, 10) || 4
);

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "application/pdf",
]);

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
    return;
  }

  const error = new Error(`Unsupported file type: ${file.mimetype || "unknown"}`);
  error.statusCode = 400;
  error.code = "INVALID_FILE_TYPE";
  cb(error);
};

const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
  fileFilter,
});

const sanitizeBaseName = (value = "asset") =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "asset";

const getRouteFolder = (req) => {
  const path = `${req.baseUrl || ""}${req.path || ""}`.toLowerCase();

  if (path.includes("virtual-tours")) return "virtual-tours";
  if (path.includes("destinations")) return "destinations";
  if (path.includes("gallery")) return "gallery";
  if (path.includes("posts")) return "posts";
  if (path.includes("team")) return "team";
  if (path.includes("countries")) return "countries";

  return "misc";
};

const getResourceType = (mimetype = "") => {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/") || mimetype.startsWith("audio/")) return "video";
  return "raw";
};

const uploadBufferToCloudinary = (file, req) =>
  new Promise((resolve, reject) => {
    const resourceType = getResourceType(file.mimetype);
    const folder = `${BASE_FOLDER}/${getRouteFolder(req)}`;
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const publicId = `${sanitizeBaseName(file.originalname.split(".")[0])}-${uniqueSuffix}`;

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: resourceType,
        use_filename: false,
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      }
    );

    stream.end(file.buffer);
  });

const toFileList = (req) => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === "object") {
    return Object.values(req.files).flat();
  }
  return [];
};

const runWithConcurrency = async (items, worker, limit = MAX_CONCURRENCY) => {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const task = Promise.resolve().then(() => worker(item));
    results.push(task);
    executing.add(task);
    task.finally(() => executing.delete(task));

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
};

const destroyUploadedAssets = async (assets) => {
  await Promise.allSettled(
    assets.map((asset) =>
      cloudinary.uploader.destroy(asset.public_id, {
        resource_type: asset.resource_type || "image",
      })
    )
  );
};

const attachCloudinaryUploads = async (req) => {
  ensureCloudinaryConfigured();

  const files = toFileList(req);
  if (files.length === 0) return;

  const uploadedAssets = [];

  try {
    await runWithConcurrency(files, async (file) => {
      const result = await uploadBufferToCloudinary(file, req);
      uploadedAssets.push(result);

      file.filename = result.public_id;
      file.path = result.secure_url;
      file.url = result.url;
      file.secure_url = result.secure_url;
      file.resource_type = result.resource_type;
      file.cloudinary = {
        public_id: result.public_id,
        version: result.version,
        format: result.format,
        bytes: result.bytes,
        width: result.width,
        height: result.height,
        resource_type: result.resource_type,
      };
    });
  } catch (error) {
    await destroyUploadedAssets(uploadedAssets);
    throw error;
  }
};

const mapMulterError = (err) => {
  if (!(err instanceof multer.MulterError)) return err;

  const mapped = new Error(err.message);
  mapped.code = err.code;
  mapped.statusCode = 400;

  if (err.code === "LIMIT_FILE_SIZE") {
    mapped.code = "FILE_TOO_LARGE";
    mapped.message = `File too large. Max size is ${Math.round(
      MAX_FILE_SIZE / (1024 * 1024)
    )}MB.`;
  }

  if (err.code === "LIMIT_FILE_COUNT") {
    mapped.code = "TOO_MANY_FILES";
    mapped.message = `Too many files in one request. Max allowed is ${MAX_FILES}.`;
  }

  return mapped;
};

const withCloudinaryUpload = (multerMiddleware) => async (req, res, next) => {
  multerMiddleware(req, res, async (err) => {
    if (err) {
      next(mapMulterError(err));
      return;
    }

    try {
      await attachCloudinaryUploads(req);
      next();
    } catch (uploadError) {
      uploadError.statusCode = uploadError.statusCode || 502;
      uploadError.code = uploadError.code || "UPLOAD_FAILED";
      next(uploadError);
    }
  });
};

module.exports = {
  single: (fieldName) => withCloudinaryUpload(multerInstance.single(fieldName)),
  array: (fieldName, maxCount) => withCloudinaryUpload(multerInstance.array(fieldName, maxCount)),
  fields: (fieldsConfig) => withCloudinaryUpload(multerInstance.fields(fieldsConfig)),
  any: () => withCloudinaryUpload(multerInstance.any()),
  none: () => multerInstance.none(),
};
