/**
 * ═══════════════════════════════════════════════════════════════════
 * POSTS CONTROLLER - Altuvera Travel
 * ═══════════════════════════════════════════════════════════════════
 */

const { query } = require("../config/db");
const { slugify, paginate, calculateReadTime } = require("../utils/helpers");
const { getUploadedFileUrl } = require("../utils/uploadHelpers");
const { cloudinary } = require("../config/cloudinary");

// ─── Helper: Delete Cloudinary image silently ──────────────────────
const deleteCloudinaryImage = async (url) => {
  if (!url || !url.includes("cloudinary")) return;
  try {
    const parts = url.split("/");
    const filename = parts[parts.length - 1];
    const publicId = filename.split(".")[0];
    const folder = parts[parts.length - 2];
    await cloudinary.uploader.destroy(`${folder}/${publicId}`);
  } catch (err) {
    console.error("[Cloudinary] Failed to delete:", err.message);
  }
};

// ─── Helper: Ensure unique slug ────────────────────────────────────
const ensureUniqueSlug = async (baseSlug, excludeId = null) => {
  let slug = baseSlug;
  let counter = 1;
  while (true) {
    const existing = excludeId
      ? await query("SELECT id FROM posts WHERE slug = $1 AND id != $2", [slug, excludeId])
      : await query("SELECT id FROM posts WHERE slug = $1", [slug]);
    if (existing.rows.length === 0) break;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  return slug;
};

// ─── Helper: Parse tags input ──────────────────────────────────────
const parseTags = (tags) => {
  if (!tags) return null;
  if (Array.isArray(tags)) return tags.map((t) => t.trim()).filter(Boolean);
  if (typeof tags === "string") {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }
  return null;
};

// ═══════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

/**
 * @desc    Get all published posts (with filtering, pagination, sorting)
 * @route   GET /api/posts
 */
exports.getAll = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 12,
      category,
      tag,
      search,
      sort = "created",
      author,
    } = req.query;

    let where = "WHERE is_published = true";
    const params = [];
    let idx = 1;

    if (category) {
      where += ` AND category = $${idx++}`;
      params.push(category);
    }
    if (tag) {
      where += ` AND $${idx++} = ANY(tags)`;
      params.push(tag);
    }
    if (author) {
      where += ` AND author_name ILIKE $${idx++}`;
      params.push(`%${author}%`);
    }
    if (search) {
      where += ` AND (title ILIKE $${idx} OR excerpt ILIKE $${idx} OR content ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    // Count
    const countRes = await query(
      `SELECT COUNT(*) FROM posts ${where}`,
      params
    );
    const totalCount = parseInt(countRes.rows[0].count);
    const pagination = paginate(totalCount, page, limit);

    // Sort
    const sortMap = {
      created: "published_at DESC NULLS LAST",
      views: "view_count DESC",
      title: "title ASC",
      likes: "like_count DESC",
      oldest: "published_at ASC NULLS LAST",
    };
    const orderBy = sortMap[sort] || sortMap.created;

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT id, title, slug, excerpt, image_url, author_name, author_avatar,
              category, tags, view_count, like_count, read_time, 
              published_at, created_at, is_featured,
              meta_title, meta_description
       FROM posts ${where}
       ORDER BY ${orderBy}
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({
      status: "success",
      results: result.rows.length,
      totalCount,
      data: result.rows,
      pagination,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get all posts including unpublished (Admin)
 * @route   GET /api/posts/admin/all
 */
exports.getAllAdmin = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      search,
      sort = "created",
      is_published,
      is_featured,
    } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;

    if (is_published !== undefined) {
      where += ` AND is_published = $${idx++}`;
      params.push(is_published === "true");
    }
    if (is_featured !== undefined) {
      where += ` AND is_featured = $${idx++}`;
      params.push(is_featured === "true");
    }
    if (category) {
      where += ` AND category = $${idx++}`;
      params.push(category);
    }
    if (search) {
      where += ` AND (title ILIKE $${idx} OR content ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countRes = await query(`SELECT COUNT(*) FROM posts ${where}`, params);
    const totalCount = parseInt(countRes.rows[0].count);
    const pagination = paginate(totalCount, page, limit);

    const sortMap = {
      created: "created_at DESC",
      published: "published_at DESC NULLS LAST",
      views: "view_count DESC",
      title: "title ASC",
    };
    const orderBy = sortMap[sort] || sortMap.created;

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT * FROM posts ${where} ORDER BY ${orderBy} LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({
      status: "success",
      results: result.rows.length,
      totalCount,
      data: result.rows,
      pagination,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get featured posts
 * @route   GET /api/posts/featured
 */
exports.getFeatured = async (req, res, next) => {
  try {
    const limit = Math.min(10, parseInt(req.query.limit) || 5);
    const result = await query(
      `SELECT id, title, slug, excerpt, image_url, author_name, author_avatar,
              category, tags, view_count, like_count, read_time, published_at
       FROM posts 
       WHERE is_featured = true AND is_published = true
       ORDER BY published_at DESC 
       LIMIT $1`,
      [limit]
    );
    res.json({ status: "success", results: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get all categories with counts
 * @route   GET /api/posts/categories
 */
exports.getCategories = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT category, COUNT(*) AS count 
       FROM posts
       WHERE is_published = true AND category IS NOT NULL
       GROUP BY category 
       ORDER BY count DESC`
    );
    res.json({ status: "success", data: result.rows });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get all unique tags with counts
 * @route   GET /api/posts/tags
 */
exports.getTags = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT tag, COUNT(*) AS count 
       FROM posts, UNNEST(tags) AS tag
       WHERE is_published = true
       GROUP BY tag 
       ORDER BY count DESC`
    );
    res.json({ status: "success", data: result.rows });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get blog stats
 * @route   GET /api/posts/stats
 */
exports.getStats = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT 
        COUNT(*) FILTER (WHERE is_published = true) AS total_published,
        COUNT(*) FILTER (WHERE is_published = false) AS total_drafts,
        COUNT(*) FILTER (WHERE is_featured = true AND is_published = true) AS total_featured,
        COALESCE(SUM(view_count) FILTER (WHERE is_published = true), 0) AS total_views,
        COALESCE(SUM(like_count) FILTER (WHERE is_published = true), 0) AS total_likes,
        COUNT(DISTINCT category) FILTER (WHERE is_published = true) AS total_categories
       FROM posts`
    );
    res.json({ status: "success", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Full-text search posts
 * @route   GET /api/posts/search
 */
exports.search = async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ status: "success", data: [] });
    }

    const result = await query(
      `SELECT id, title, slug, excerpt, image_url, category, published_at, read_time,
              ts_rank(
                to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(excerpt,'') || ' ' || COALESCE(content,'')),
                plainto_tsquery('english', $1)
              ) AS relevance
       FROM posts
       WHERE is_published = true
         AND to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(excerpt,'') || ' ' || COALESCE(content,''))
             @@ plainto_tsquery('english', $1)
       ORDER BY relevance DESC
       LIMIT $2`,
      [q.trim(), Math.min(20, parseInt(limit))]
    );

    res.json({ status: "success", results: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get single post by slug (with view count increment + related posts)
 * @route   GET /api/posts/:slug
 */
exports.getBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const result = await query(
      "SELECT * FROM posts WHERE slug = $1 AND is_published = true",
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Post not found" });
    }

    const post = result.rows[0];

    // Increment view count
    await query(
      "UPDATE posts SET view_count = view_count + 1 WHERE id = $1",
      [post.id]
    );
    post.view_count += 1;

    // Related posts (same category, excluding current)
    const related = await query(
      `SELECT id, title, slug, excerpt, image_url, author_name, author_avatar,
              category, tags, read_time, published_at, view_count, like_count
       FROM posts 
       WHERE category = $1 AND id != $2 AND is_published = true
       ORDER BY published_at DESC 
       LIMIT 3`,
      [post.category, post.id]
    );

    // Previous and next posts
    const prevPost = await query(
      `SELECT id, title, slug, image_url, category 
       FROM posts 
       WHERE is_published = true AND published_at < $1
       ORDER BY published_at DESC 
       LIMIT 1`,
      [post.published_at || post.created_at]
    );

    const nextPost = await query(
      `SELECT id, title, slug, image_url, category 
       FROM posts 
       WHERE is_published = true AND published_at > $1
       ORDER BY published_at ASC 
       LIMIT 1`,
      [post.published_at || post.created_at]
    );

    // Comments count
    const commentsCount = await query(
      "SELECT COUNT(*) FROM post_comments WHERE post_id = $1 AND is_approved = true",
      [post.id]
    ).catch(() => ({ rows: [{ count: 0 }] }));

    res.json({
      status: "success",
      data: {
        ...post,
        related_posts: related.rows,
        prev_post: prevPost.rows[0] || null,
        next_post: nextPost.rows[0] || null,
        comments_count: parseInt(commentsCount.rows[0].count) || 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Toggle like on a post
 * @route   POST /api/posts/:slug/like
 */
exports.toggleLike = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { action = "like" } = req.body; // "like" or "unlike"

    const post = await query("SELECT id, like_count FROM posts WHERE slug = $1", [slug]);
    if (post.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Post not found" });
    }

    const newCount =
      action === "unlike"
        ? Math.max(0, post.rows[0].like_count - 1)
        : post.rows[0].like_count + 1;

    await query("UPDATE posts SET like_count = $1 WHERE id = $2", [
      newCount,
      post.rows[0].id,
    ]);

    res.json({
      status: "success",
      data: { like_count: newCount, liked: action === "like" },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get comments for a post
 * @route   GET /api/posts/:slug/comments
 */
exports.getComments = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const post = await query("SELECT id FROM posts WHERE slug = $1", [slug]);
    if (post.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Post not found" });
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const countRes = await query(
      "SELECT COUNT(*) FROM post_comments WHERE post_id = $1 AND is_approved = true",
      [post.rows[0].id]
    );

    const comments = await query(
      `SELECT id, author_name, author_avatar, content, like_count, 
              created_at, parent_id
       FROM post_comments 
       WHERE post_id = $1 AND is_approved = true
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [post.rows[0].id, parseInt(limit), offset]
    );

    res.json({
      status: "success",
      totalCount: parseInt(countRes.rows[0].count),
      data: comments.rows,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Add a comment to a post
 * @route   POST /api/posts/:slug/comments
 */
exports.addComment = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { author_name, author_avatar, content, parent_id } = req.body;

    if (!author_name || !content || !content.trim()) {
      return res.status(400).json({ status: "error", message: "Name and content are required" });
    }

    const post = await query("SELECT id FROM posts WHERE slug = $1", [slug]);
    if (post.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Post not found" });
    }

    const result = await query(
      `INSERT INTO post_comments (post_id, author_name, author_avatar, content, parent_id, is_approved)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [
        post.rows[0].id,
        author_name.trim(),
        author_avatar || null,
        content.trim(),
        parent_id || null,
      ]
    );

    res.status(201).json({ status: "success", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Create new post
 * @route   POST /api/posts
 */
exports.create = async (req, res, next) => {
  try {
    const {
      title,
      content,
      excerpt,
      author_name,
      author_avatar,
      category,
      tags,
      is_published,
      is_featured,
      meta_title,
      meta_description,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ status: "error", message: "Title is required" });
    }
    if (!content || !content.trim()) {
      return res.status(400).json({ status: "error", message: "Content is required" });
    }

    const baseSlug = slugify(title);
    const slug = await ensureUniqueSlug(baseSlug);
    const image_url = req.file ? getUploadedFileUrl(req.file) : req.body.image_url || null;
    const read_time = calculateReadTime(content);
    const shouldPublish = is_published === true || is_published === "true";
    const published_at = shouldPublish ? new Date() : null;

    const result = await query(
      `INSERT INTO posts
       (title, slug, content, excerpt, image_url, author_name, author_avatar,
        category, tags, is_published, is_featured, read_time, published_at,
        meta_title, meta_description, like_count, view_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, 0, 0)
       RETURNING *`,
      [
        title.trim(),
        slug,
        content.trim(),
        excerpt ? excerpt.trim() : content.trim().substring(0, 200) + "...",
        image_url,
        author_name || "Altuvera Team",
        author_avatar || null,
        category || null,
        parseTags(tags),
        shouldPublish,
        is_featured === true || is_featured === "true",
        read_time,
        published_at,
        meta_title || title.trim(),
        meta_description || (excerpt ? excerpt.trim().substring(0, 160) : null),
      ]
    );

    res.status(201).json({ status: "success", data: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ status: "error", message: "Post with this title already exists" });
    }
    next(err);
  }
};

/**
 * @desc    Update post
 * @route   PUT /api/posts/:id
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check existence
    const existing = await query("SELECT * FROM posts WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Post not found" });
    }

    const fields = { ...req.body };

    // Slug
    if (fields.title) {
      const baseSlug = slugify(fields.title);
      fields.slug = await ensureUniqueSlug(baseSlug, parseInt(id));
    }

    // Read time
    if (fields.content) {
      fields.read_time = calculateReadTime(fields.content);
    }

    // Image
    if (req.file) {
      await deleteCloudinaryImage(existing.rows[0].image_url);
      fields.image_url = getUploadedFileUrl(req.file);
    }

    // Tags
    if (fields.tags !== undefined) {
      fields.tags = parseTags(fields.tags);
    }

    // Publishing logic
    if (
      (fields.is_published === true || fields.is_published === "true") &&
      !existing.rows[0].published_at
    ) {
      fields.published_at = new Date();
    }

    // Boolean conversions
    if (fields.is_published !== undefined) {
      fields.is_published = fields.is_published === true || fields.is_published === "true";
    }
    if (fields.is_featured !== undefined) {
      fields.is_featured = fields.is_featured === true || fields.is_featured === "true";
    }

    // Remove non-column fields
    delete fields.image;

    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return res.status(400).json({ status: "error", message: "No fields to update" });
    }

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), id];

    const result = await query(
      `UPDATE posts SET ${sets}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );

    res.json({ status: "success", data: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ status: "error", message: "Post with this title already exists" });
    }
    next(err);
  }
};

/**
 * @desc    Delete post
 * @route   DELETE /api/posts/:id
 */
exports.remove = async (req, res, next) => {
  try {
    const existing = await query("SELECT image_url, title FROM posts WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Post not found" });
    }

    await deleteCloudinaryImage(existing.rows[0].image_url);

    // Delete comments first
    await query("DELETE FROM post_comments WHERE post_id = $1", [req.params.id]).catch(() => {});

    await query("DELETE FROM posts WHERE id = $1", [req.params.id]);

    res.json({
      status: "success",
      message: `Post "${existing.rows[0].title}" deleted successfully`,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Toggle publish status
 * @route   PATCH /api/posts/:id/toggle-publish
 */
exports.togglePublish = async (req, res, next) => {
  try {
    const existing = await query("SELECT id, is_published, published_at FROM posts WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Post not found" });
    }

    const newPublished = !existing.rows[0].is_published;
    const publishedAt = newPublished && !existing.rows[0].published_at ? new Date() : existing.rows[0].published_at;

    const result = await query(
      "UPDATE posts SET is_published = $1, published_at = $2, updated_at = NOW() WHERE id = $3 RETURNING *",
      [newPublished, publishedAt, req.params.id]
    );

    res.json({ status: "success", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Toggle featured status
 * @route   PATCH /api/posts/:id/toggle-featured
 */
exports.toggleFeatured = async (req, res, next) => {
  try {
    const existing = await query("SELECT id, is_featured FROM posts WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Post not found" });
    }

    const result = await query(
      "UPDATE posts SET is_featured = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [!existing.rows[0].is_featured, req.params.id]
    );

    res.json({ status: "success", data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Bulk delete posts
 * @route   DELETE /api/posts/bulk-delete
 */
exports.bulkDelete = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ status: "error", message: "Provide an array of IDs" });
    }

    // Get images for cleanup
    const posts = await query(
      `SELECT image_url FROM posts WHERE id = ANY($1)`,
      [ids]
    );

    for (const post of posts.rows) {
      await deleteCloudinaryImage(post.image_url);
    }

    // Delete comments
    await query("DELETE FROM post_comments WHERE post_id = ANY($1)", [ids]).catch(() => {});

    const result = await query("DELETE FROM posts WHERE id = ANY($1)", [ids]);

    res.json({
      status: "success",
      message: `${result.rowCount} post(s) deleted`,
    });
  } catch (err) {
    next(err);
  }
};