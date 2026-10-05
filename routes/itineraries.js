const express = require("express");
const router = express.Router();
const controller = require("../controllers/itineraryController");
const { optionalAuth } = require("../middleware/auth");

router.get("/:id", optionalAuth, controller.get);
router.post("/:id/draft", optionalAuth, controller.saveDraft);
router.post("/:id/publish", optionalAuth, controller.publish);
router.post("/:id/approve", optionalAuth, controller.approve);
router.post("/:id/change-request", optionalAuth, controller.requestChange);

module.exports = router;
