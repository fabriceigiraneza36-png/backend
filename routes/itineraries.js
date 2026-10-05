const express = require("express");
const router = express.Router();
const controller = require("../controllers/itineraryController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/:id", protect, controller.get);
router.post("/:id/draft", adminOnly, controller.saveDraft);
router.post("/:id/publish", adminOnly, controller.publish);
router.post("/:id/approve", protect, controller.approve);
router.post("/:id/change-request", protect, controller.requestChange);

module.exports = router;
