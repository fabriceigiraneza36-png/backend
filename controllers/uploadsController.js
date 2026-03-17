const realTimeTracker = require("../utils/realTimeTracker");

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

    // Track upload
    const uploadId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    realTimeTracker.trackUploadStart(uploadId, {
      filename: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });

    const asset = toAsset(req.file);

    // Track successful upload
    realTimeTracker.trackUploadComplete(uploadId, {
      url: asset.secureUrl,
      publicId: asset.publicId,
    });

    // Track event
    realTimeTracker.trackEvent("upload:image", {
      filename: asset.originalName,
      size: asset.size,
      type: asset.mimeType,
    });

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

    // Track batch upload
    const uploadIds = files.map((file) => {
      const uploadId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      realTimeTracker.trackUploadStart(uploadId, {
        filename: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
      });
      return uploadId;
    });

    const assets = files.map(toAsset);

    // Track all successful uploads
    uploadIds.forEach((id, idx) => {
      realTimeTracker.trackUploadComplete(id, {
        url: assets[idx].secureUrl,
        publicId: assets[idx].publicId,
      });
    });

    // Track batch event
    realTimeTracker.trackEvent("upload:batch", {
      count: assets.length,
      totalSize: assets.reduce((sum, a) => sum + (a.size || 0), 0),
      types: [...new Set(assets.map((a) => a.mimeType))],
    });

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
