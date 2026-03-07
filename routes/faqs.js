const router = require("express").Router();
const faqs = require("../controllers/faqsController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", faqs.getAll);
router.get("/:id", faqs.getOne);
router.post("/", protect, adminOnly, faqs.create);
router.put("/:id", protect, adminOnly, faqs.update);
router.delete("/:id", protect, adminOnly, faqs.remove);

module.exports = router;

