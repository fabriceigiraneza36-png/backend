const router = require("express").Router();
const contact = require("../controllers/contactController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", protect, adminOnly, contact.getAll);
router.get("/:id", protect, adminOnly, contact.getOne);
router.post("/", contact.create);
router.delete("/:id", protect, adminOnly, contact.remove);

module.exports = router;

