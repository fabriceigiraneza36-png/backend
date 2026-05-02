const router = require("express").Router();
const gallery = require("../controllers/galleryController");
const { protect, adminOnly } = require("../middleware/auth");
const upload = require("../middleware/upload");

// ── Public ──────────────────────────────────────────────────────────────────
router.get("/categories", gallery.getCategories);
router.get("/tags", gallery.getTags); // ✅ ADD THIS
router.get("/", gallery.getAll);
router.get("/:id", gallery.getOne);


router.get("/schema", async (req, res) => {
  const { query } = require("../config/db");
  const result = await query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'gallery' 
    ORDER BY ordinal_position
  `);
  res.json(result.rows);
});

// ── Admin ───────────────────────────────────────────────────────────────────
router.post(
  "/bulk",
  protect,
  adminOnly,
  upload.array("images", 50),
  gallery.bulkCreate,
);
router.post("/", protect, adminOnly, upload.single("image"), gallery.create);
router.put("/:id", protect, adminOnly, upload.single("image"), gallery.update);
router.patch("/reorder", protect, adminOnly, gallery.reorder); // ✅ ADD THIS
router.patch("/:id/restore", protect, adminOnly, gallery.restore); // ✅ ADD THIS
router.delete("/:id", protect, adminOnly, gallery.remove);

module.exports = router;
