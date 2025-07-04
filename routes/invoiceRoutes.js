const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');

// Create a new invoice
router.post('/create', invoiceController.createInvoice);
router.post('/info', invoiceController.oneInvoiceByNum);

router.route('/').get(invoiceController.allInvoices);

router
  .route('/:id')
  .get(invoiceController.oneInvoice)
  .patch(invoiceController.updateInvoice)
  .delete(invoiceController.deleteInvoice);

module.exports = router;
