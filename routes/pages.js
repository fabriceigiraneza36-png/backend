const router = require("express").Router();
const pages = require("../controllers/pagesController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", pages.getAll);
router.get("/:slug", pages.getBySlug);
router.post("/", protect, adminOnly, pages.create);
router.put("/:id", protect, adminOnly, pages.update);
router.delete("/:id", protect, adminOnly, pages.remove);

module.exports = router;

