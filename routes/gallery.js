const router = require("express").Router();
const gallery = require("../controllers/galleryController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", gallery.getAll);
router.get("/:id", gallery.getOne);
router.post("/", protect, adminOnly, gallery.create);
router.put("/:id", protect, adminOnly, gallery.update);
router.delete("/:id", protect, adminOnly, gallery.remove);

module.exports = router;

