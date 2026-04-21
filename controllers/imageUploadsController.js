/**
 * Image Upload Controllers for Destinations, Gallery, and Countries
 * Handles uploading, storing URLs in database, and managing images
 */

const { query } = require("../config/database");
const { cloudinary, ensureCloudinaryConfigured } = require("../config/cloudinary");

// ==========================================
// DESTINATION IMAGE UPLOADS
// ==========================================

/**
 * Upload images for a destination
 * POST /api/destinations/:id/images
 */
exports.uploadDestinationImages = async (req, res, next) => {
  try {
    const { id: destinationId } = req.params;
    const files = Array.isArray(req.files) ? req.files : [];

    if (!destinationId || isNaN(destinationId)) {
      const err = new Error("Invalid destination ID");
      err.statusCode = 400;
      throw err;
    }

    if (files.length === 0) {
      const err = new Error("No images provided");
      err.statusCode = 400;
      throw err;
    }

    // Verify destination exists
    const dest = await query(
      "SELECT id FROM destinations WHERE id = $1",
      [destinationId]
    );

    if (!dest.rows.length) {
      const err = new Error("Destination not found");
      err.statusCode = 404;
      throw err;
    }

    // Upload images to Cloudinary and store URLs in database
    const imageUrls = [];
    const uploadedAssets = [];

    try {
      for (const file of files) {
        const resourceType = file.mimetype.startsWith("image/") ? "image" : "video";
        const publicId = `destinations/${destinationId}/${Date.now()}-${Math.random()
          .toString(36)
          .substr(2, 9)}`;

        const result = await cloudinary.uploader.upload_stream(
          {
            folder: "destinations",
            public_id: publicId,
            resource_type: resourceType,
            use_filename: false,
            unique_filename: true,
          },
          async (error, uploadResult) => {
            if (error) throw error;
            return uploadResult;
          }
        );

        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "destinations",
            public_id: publicId,
            resource_type: resourceType,
          },
          async (error, uploadResult) => {
            if (error) throw error;

            // Store in database
            await query(
              `INSERT INTO destination_images 
               (destination_id, image_url, thumbnail_url, caption, sort_order)
               VALUES ($1, $2, $3, $4, $5)`,
              [
                destinationId,
                uploadResult.secure_url,
                uploadResult.thumbnail_url || uploadResult.secure_url,
                req.body[`caption_${files.indexOf(file)}`] || "",
                imageUrls.length,
              ]
            );

            imageUrls.push(uploadResult.secure_url);
            uploadedAssets.push(uploadResult);
          }
        );

        stream.end(file.buffer);
      }

      // Update destination's image_urls array
      await query(
        `UPDATE destinations 
         SET image_urls = array_cat(image_urls, $1::text[]), updated_at = NOW()
         WHERE id = $2`,
        [imageUrls, destinationId]
      );

      res.status(201).json({
        success: true,
        message: `${imageUrls.length} image(s) uploaded successfully`,
        data: {
          count: imageUrls.length,
          imageUrls,
          assets: uploadedAssets.map((a) => ({
            url: a.secure_url,
            publicId: a.public_id,
            width: a.width,
            height: a.height,
          })),
        },
      });
    } catch (uploadError) {
      // Cleanup uploaded assets on error
      await Promise.allSettled(
        uploadedAssets.map((a) =>
          cloudinary.uploader.destroy(a.public_id, { resource_type: "image" })
        )
      );
      throw uploadError;
    }
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a destination image
 * DELETE /api/destinations/:id/images/:imageId
 */
exports.deleteDestinationImage = async (req, res, next) => {
  try {
    const { id: destinationId, imageId } = req.params;

    if (!imageId || isNaN(imageId)) {
      const err = new Error("Invalid image ID");
      err.statusCode = 400;
      throw err;
    }

    // Get image details
    const imageResult = await query(
      `SELECT image_url, thumbnail_url FROM destination_images 
       WHERE id = $1 AND destination_id = $2`,
      [imageId, destinationId]
    );

    if (!imageResult.rows.length) {
      const err = new Error("Image not found");
      err.statusCode = 404;
      throw err;
    }

    const image = imageResult.rows[0];

    // Delete from Cloudinary
    const publicId = image.image_url.split("/").pop().split(".")[0];
    await cloudinary.uploader.destroy(publicId);

    // Delete from database
    await query("DELETE FROM destination_images WHERE id = $1", [imageId]);

    // Update destination's image_urls array
    await query(
      `UPDATE destinations 
       SET image_urls = array_remove(image_urls, $1), updated_at = NOW()
       WHERE id = $2`,
      [image.image_url, destinationId]
    );

    res.json({
      success: true,
      message: "Image deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Reorder destination images
 * PUT /api/destinations/:id/images/reorder
 */
exports.reorderDestinationImages = async (req, res, next) => {
  try {
    const { id: destinationId } = req.params;
    const { order } = req.body;

    if (!Array.isArray(order) || order.length === 0) {
      const err = new Error("Invalid order array");
      err.statusCode = 400;
      throw err;
    }

    // Update sort order for each image
    for (let i = 0; i < order.length; i++) {
      await query(
        `UPDATE destination_images 
         SET sort_order = $1, updated_at = NOW()
         WHERE id = $2 AND destination_id = $3`,
        [i, order[i], destinationId]
      );
    }

    res.json({
      success: true,
      message: "Images reordered successfully",
    });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// GALLERY IMAGE UPLOADS
// ==========================================

/**
 * Upload images to gallery
 * POST /api/gallery/upload
 */
exports.uploadGalleryImages = async (req, res, next) => {
  try {
    ensureCloudinaryConfigured();
    const files = Array.isArray(req.files) ? req.files : [];
    const { category, location, country_id, destination_id } = req.body;

    if (files.length === 0) {
      const err = new Error("No images provided");
      err.statusCode = 400;
      throw err;
    }

    const imageUrls = [];
    const uploadedAssets = [];

    try {
      for (const file of files) {
        const publicId = `gallery/${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "gallery",
              public_id: publicId,
              resource_type: "image",
            },
            (error, uploadResult) => {
              if (error) reject(error);
              else resolve(uploadResult);
            }
          );
          stream.end(file.buffer);
        });

        // Store in database
        await query(
          `INSERT INTO gallery 
           (title, image_url, thumbnail_url, category, location, country_id, destination_id, sort_order, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
          [
            file.originalname.split(".")[0],
            result.secure_url,
            result.thumbnail_url || result.secure_url,
            category || "uncategorized",
            location || "",
            country_id || null,
            destination_id || null,
            imageUrls.length,
          ]
        );

        imageUrls.push(result.secure_url);
        uploadedAssets.push(result);
      }

      res.status(201).json({
        success: true,
        message: `${imageUrls.length} image(s) uploaded to gallery`,
        data: {
          count: imageUrls.length,
          imageUrls,
          assets: uploadedAssets.map((a) => ({
            url: a.secure_url,
            publicId: a.public_id,
            width: a.width,
            height: a.height,
          })),
        },
      });
    } catch (uploadError) {
      // Cleanup uploaded assets on error
      await Promise.allSettled(
        uploadedAssets.map((a) =>
          cloudinary.uploader.destroy(a.public_id, { resource_type: "image" })
        )
      );
      throw uploadError;
    }
  } catch (err) {
    next(err);
  }
};

/**
 * Delete gallery image
 * DELETE /api/gallery/:id
 */
exports.deleteGalleryImage = async (req, res, next) => {
  try {
    const { id } = req.params;

    const imageResult = await query(
      "SELECT image_url FROM gallery WHERE id = $1",
      [id]
    );

    if (!imageResult.rows.length) {
      const err = new Error("Gallery image not found");
      err.statusCode = 404;
      throw err;
    }

    const image = imageResult.rows[0];

    // Delete from Cloudinary
    const publicId = image.image_url.split("/").pop().split(".")[0];
    await cloudinary.uploader.destroy(publicId);

    // Delete from database
    await query("DELETE FROM gallery WHERE id = $1", [id]);

    res.json({
      success: true,
      message: "Gallery image deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// COUNTRY IMAGE UPLOADS (Including Flag)
// ==========================================

/**
 * Upload flag for a country
 * POST /api/countries/:id/flag
 * Note: Flag must be uploaded as the first image
 */
exports.uploadCountryFlag = async (req, res, next) => {
  try {
    ensureCloudinaryConfigured();
    const { id: countryId } = req.params;

    if (!req.file) {
      const err = new Error("No flag image provided");
      err.statusCode = 400;
      throw err;
    }

    if (!countryId || isNaN(countryId)) {
      const err = new Error("Invalid country ID");
      err.statusCode = 400;
      throw err;
    }

    // Verify country exists
    const country = await query("SELECT id FROM countries WHERE id = $1", [
      countryId,
    ]);

    if (!country.rows.length) {
      const err = new Error("Country not found");
      err.statusCode = 404;
      throw err;
    }

    const publicId = `countries/flags/${countryId}-flag`;

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "countries/flags",
          public_id: publicId,
          resource_type: "image",
          overwrite: true,
        },
        (error, uploadResult) => {
          if (error) reject(error);
          else resolve(uploadResult);
        }
      );
      stream.end(req.file.buffer);
    });

    // Update country flag URL and prepend to images array
    await query(
      `UPDATE countries 
       SET flag_url = $1, 
           images = array_prepend($1, array_remove(images, $1)),
           updated_at = NOW()
       WHERE id = $2`,
      [result.secure_url, countryId]
    );

    res.status(201).json({
      success: true,
      message: "Country flag uploaded successfully",
      data: {
        flagUrl: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Upload additional images for a country
 * POST /api/countries/:id/images
 */
exports.uploadCountryImages = async (req, res, next) => {
  try {
    ensureCloudinaryConfigured();
    const { id: countryId } = req.params;
    const files = Array.isArray(req.files) ? req.files : [];

    if (!countryId || isNaN(countryId)) {
      const err = new Error("Invalid country ID");
      err.statusCode = 400;
      throw err;
    }

    if (files.length === 0) {
      const err = new Error("No images provided");
      err.statusCode = 400;
      throw err;
    }

    // Verify country exists
    const country = await query(
      "SELECT id, images FROM countries WHERE id = $1",
      [countryId]
    );

    if (!country.rows.length) {
      const err = new Error("Country not found");
      err.statusCode = 404;
      throw err;
    }

    const imageUrls = [];
    const uploadedAssets = [];

    try {
      for (const file of files) {
        const publicId = `countries/images/${countryId}/${Date.now()}-${Math.random()
          .toString(36)
          .substr(2, 9)}`;

        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "countries/images",
              public_id: publicId,
              resource_type: "image",
            },
            (error, uploadResult) => {
              if (error) reject(error);
              else resolve(uploadResult);
            }
          );
          stream.end(file.buffer);
        });

        imageUrls.push(result.secure_url);
        uploadedAssets.push(result);
      }

      // Append images to country's images array (flag is always first if it exists)
      await query(
        `UPDATE countries 
         SET images = array_cat(images, $1::text[]), updated_at = NOW()
         WHERE id = $2`,
        [imageUrls, countryId]
      );

      res.status(201).json({
        success: true,
        message: `${imageUrls.length} image(s) uploaded to country`,
        data: {
          count: imageUrls.length,
          imageUrls,
          assets: uploadedAssets.map((a) => ({
            url: a.secure_url,
            publicId: a.public_id,
            width: a.width,
            height: a.height,
          })),
        },
      });
    } catch (uploadError) {
      // Cleanup uploaded assets on error
      await Promise.allSettled(
        uploadedAssets.map((a) =>
          cloudinary.uploader.destroy(a.public_id, { resource_type: "image" })
        )
      );
      throw uploadError;
    }
  } catch (err) {
    next(err);
  }
};

/**
 * Delete country image
 * DELETE /api/countries/:id/images/:imageUrl
 */
exports.deleteCountryImage = async (req, res, next) => {
  try {
    const { id: countryId, imageUrl } = req.params;
    const decodedImageUrl = decodeURIComponent(imageUrl);

    // Get country
    const country = await query(
      "SELECT id, images, flag_url FROM countries WHERE id = $1",
      [countryId]
    );

    if (!country.rows.length) {
      const err = new Error("Country not found");
      err.statusCode = 404;
      throw err;
    }

    const countryData = country.rows[0];

    // Check if this is the flag image
    const isFlagImage = countryData.flag_url === decodedImageUrl;

    // Delete from Cloudinary
    const publicId = decodedImageUrl.split("/").pop().split(".")[0];
    await cloudinary.uploader.destroy(publicId);

    // Delete from database
    if (isFlagImage) {
      await query(
        `UPDATE countries 
         SET flag_url = NULL, 
             images = array_remove(images, $1),
             updated_at = NOW()
         WHERE id = $2`,
        [decodedImageUrl, countryId]
      );
    } else {
      await query(
        `UPDATE countries 
         SET images = array_remove(images, $1),
             updated_at = NOW()
         WHERE id = $2`,
        [decodedImageUrl, countryId]
      );
    }

    res.json({
      success: true,
      message: "Country image deleted successfully",
      isFlagDeleted: isFlagImage,
    });
  } catch (err) {
    next(err);
  }
};
