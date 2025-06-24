const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Add a payment
router.post('/add', paymentController.addPayment);

router.get('/', paymentController.allPayment);

router
  .route('/:id')
  .get(paymentController.onePayment)
  .patch(paymentController.updatePayment)
  .delete(paymentController.deletePayment);

module.exports = router;
