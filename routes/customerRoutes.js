const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');

// Get customer statement
router.get('/statement', customerController.getCustomerStatement);

module.exports = router;
