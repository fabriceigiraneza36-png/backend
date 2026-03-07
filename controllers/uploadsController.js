const toAsset = (file) => {
  const cloud = file?.cloudinary || {};
  return {
    field: file?.fieldname || null,
    originalName: file?.originalname || null,
    mimeType: file?.mimetype || null,
    size: file?.size || cloud.bytes || null,
    url: file?.secure_url || file?.url || file?.path || null,
    secureUrl: file?.secure_url || file?.path || null,
    publicId: cloud.public_id || file?.filename || null,
    resourceType: cloud.resource_type || file?.resource_type || null,
    width: cloud.width || null,
    height: cloud.height || null,
    format: cloud.format || null,
  };
};

const badRequest = (message, code, details = undefined) => {
  const err = new Error(message);
  err.statusCode = 400;
  err.code = code;
  if (details) err.details = details;
  return err;
};

exports.uploadSingleImage = async (req, res, next) => {
  try {
    if (!req.file) {
      throw badRequest("No image file uploaded.", "UPLOAD_REQUIRED", {
        expectedField: "image",
      });
    }

    const asset = toAsset(req.file);
    res.status(201).json({
      success: true,
      message: "Image uploaded successfully.",
      data: asset,
    });
  } catch (err) {
    next(err);
  }
};

exports.uploadMultipleImages = async (req, res, next) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      throw badRequest("No image files uploaded.", "UPLOAD_REQUIRED", {
        expectedField: "images",
      });
    }

    const assets = files.map(toAsset);
    res.status(201).json({
      success: true,
      message: `${assets.length} image(s) uploaded successfully.`,
      data: {
        count: assets.length,
        assets,
      },
    });
  } catch (err) {
    next(err);
  }
};
