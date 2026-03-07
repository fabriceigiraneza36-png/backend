const router = require("express").Router();
const bookings = require("../controllers/bookingsController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", protect, adminOnly, bookings.getAll);
router.get("/:id", protect, adminOnly, bookings.getOne);
router.post("/", bookings.create);
router.put("/:id", protect, adminOnly, bookings.update);
router.delete("/:id", protect, adminOnly, bookings.remove);

module.exports = router;

