const router = require("express").Router();
const settings = require("../controllers/settingsController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", settings.getAll);
router.get("/:id", settings.getOne);
router.put("/:id", protect, adminOnly, settings.updateOne);

module.exports = router;

