const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Add a payment
router.post('/add', paymentController.addPayment);

module.exports = router;
