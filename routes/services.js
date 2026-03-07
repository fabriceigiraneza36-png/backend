const router = require("express").Router();
const services = require("../controllers/servicesController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", services.getAll);
router.get("/:id", services.getOne);
router.post("/", protect, adminOnly, services.create);
router.put("/:id", protect, adminOnly, services.update);
router.delete("/:id", protect, adminOnly, services.remove);

module.exports = router;

