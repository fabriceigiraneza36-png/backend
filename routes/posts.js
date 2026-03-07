const router = require("express").Router();
const posts = require("../controllers/postsController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", posts.getAll);
router.get("/:slug", posts.getBySlug);
router.post("/", protect, adminOnly, posts.create);
router.put("/:id", protect, adminOnly, posts.update);
router.delete("/:id", protect, adminOnly, posts.remove);

module.exports = router;

