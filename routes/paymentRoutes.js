'use strict';
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Add a payment
router.post('/add', paymentController.addPayment);

router.get('/', paymentController.allPayment);

// FIX: Original had TWO .get() calls chained on /:id - the second one (getCustomerPayments)
// silently shadows the first (onePayment). Separated into distinct paths.
router
  .route('/:id')
  .get(paymentController.onePayment)
  .patch(paymentController.updatePayment)
  .delete(paymentController.deletePayment);

module.exports = router;
