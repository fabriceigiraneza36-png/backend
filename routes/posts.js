const router = require("express").Router();
const posts = require("../controllers/postsController");
const { protect, adminOnly } = require("../middleware/auth");
const upload = require("../middleware/upload");

// ═══════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════════

router.get("/", posts.getAll);
router.get("/featured", posts.getFeatured);
router.get("/categories", posts.getCategories);
router.get("/tags", posts.getTags);
router.get("/stats", posts.getStats);
router.get("/search", posts.search);
router.get("/:slug", posts.getBySlug);
router.post("/:slug/like", posts.toggleLike);
router.post("/:slug/comments", posts.addComment);
router.get("/:slug/comments", posts.getComments);

// ═══════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════

router.get("/admin/all", protect, adminOnly, posts.getAllAdmin);
router.post("/", protect, adminOnly, upload.single("image"), posts.create);
router.put("/:id", protect, adminOnly, upload.single("image"), posts.update);
router.delete("/:id", protect, adminOnly, posts.remove);
router.patch("/:id/toggle-publish", protect, adminOnly, posts.togglePublish);
router.patch("/:id/toggle-featured", protect, adminOnly, posts.toggleFeatured);
router.delete("/bulk-delete", protect, adminOnly, posts.bulkDelete);

module.exports = router;