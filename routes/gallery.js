const router = require("express").Router();
const gallery = require("../controllers/galleryController");
const { protect, adminOnly } = require("../middleware/auth");
const upload = require("../middleware/upload");

router.get("/categories", gallery.getCategories);
router.get("/", gallery.getAll);
router.post("/bulk", protect, adminOnly, upload.array("images", 50), gallery.bulkCreate);
router.get("/:id", gallery.getOne);
router.post("/", protect, adminOnly, upload.single("image"), gallery.create);
router.put("/:id", protect, adminOnly, upload.single("image"), gallery.update);
router.delete("/:id", protect, adminOnly, gallery.remove);

module.exports = router;

