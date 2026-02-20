// src/routes/admin.routes.js
const express = require('express');
const AdminController = require('../controllers/admin.controller');
const { authenticate, requireAdmin } = require('../middleware/auth.middleware');
const { validateUUID } = require('../middleware/validator.middleware');

const router = express.Router();

// All routes require admin authentication
router.use(authenticate, requireAdmin);

// Users
router.get('/users', AdminController.getUsers);
router.get('/users/:id', validateUUID('id'), AdminController.getUser);
router.patch('/users/:id', validateUUID('id'), AdminController.updateUser);
router.delete('/users/:id', validateUUID('id'), AdminController.deleteUser);

// Subscriptions
router.get('/subscriptions', AdminController.getSubscriptions);

// Plans
router.post('/plans', AdminController.createPlan);
router.patch('/plans/:id', validateUUID('id'), AdminController.updatePlan);
router.delete('/plans/:id', validateUUID('id'), AdminController.deletePlan);

// Stats
router.get('/stats', AdminController.getStats);

module.exports = router;