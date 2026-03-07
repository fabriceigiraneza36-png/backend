const router = require("express").Router();
const tips = require("../controllers/tipsController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", tips.getAll);
router.get("/:id", tips.getOne);
router.post("/", protect, adminOnly, tips.create);
router.put("/:id", protect, adminOnly, tips.update);
router.delete("/:id", protect, adminOnly, tips.remove);

module.exports = router;

