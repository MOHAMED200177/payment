const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');

// Get customer statement
router.post('/statement', customerController.getCustomerStatement);

module.exports = router;
