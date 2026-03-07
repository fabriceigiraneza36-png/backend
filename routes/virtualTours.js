const router = require("express").Router();
const virtualTours = require("../controllers/virtualToursController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", virtualTours.getAll);
router.get("/:id", virtualTours.getOne);
router.post("/", protect, adminOnly, virtualTours.create);
router.put("/:id", protect, adminOnly, virtualTours.update);
router.delete("/:id", protect, adminOnly, virtualTours.remove);

module.exports = router;

