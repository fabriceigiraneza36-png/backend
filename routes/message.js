const router = require('express').Router();
const contact = require('../controllers/contactController');

// Provide same endpoints as /api/contact but under /api/message for frontend compatibility
router.post('/', contact.create);

module.exports = router;
