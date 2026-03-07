const express = require('express');
const router = express.Router();
const controller = require('../controllers/whatsappController');

// Health check
router.get('/health', controller.healthCheck);

// User registration
router.post('/register-user', controller.registerUser);

// Get messages for a user
router.get('/messages', controller.getMessages);

// Mark messages as read
router.post('/mark-read', controller.markAsRead);

// Meta webhook verification (GET)
router.get('/webhook', controller.verifyWebhook);

// Meta webhook messages (POST)
router.post('/webhook', controller.handleWebhook);

// Admin: Get all users
router.get('/users', controller.getUsers);

// Testing: Simulate admin message
router.post('/simulate-message', controller.simulateMessage);

module.exports = router;