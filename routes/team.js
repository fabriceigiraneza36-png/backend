const router = require("express").Router();
const team = require("../controllers/teamController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", team.getAll);
router.get("/:id", team.getOne);
router.post("/", protect, adminOnly, team.create);
router.put("/:id", protect, adminOnly, team.update);
router.delete("/:id", protect, adminOnly, team.remove);

module.exports = router;

