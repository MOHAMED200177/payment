'use strict';
const express = require('express');
const router  = express.Router();
const invoiceController = require('../controllers/invoiceController');

router.post('/create',    invoiceController.createInvoice);
router.post('/info',      invoiceController.oneInvoiceByNum);
router.route('/').get(invoiceController.allInvoices);
router.patch('/:id/status', invoiceController.updateInvoiceStatus);
router.route('/:id')
  .get(invoiceController.oneInvoice)
  .patch(invoiceController.updateInvoice)
  .delete(invoiceController.deleteInvoice);

module.exports = router;
