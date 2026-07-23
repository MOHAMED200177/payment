'use strict';
const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const exportController   = require('../controllers/exportController');

// Statement & export — POST because they accept date filter in body
router.post('/statement',           customerController.getCustomerStatement);
router.post('/statement/file',      exportController.fileCustomerStatement);
router.post('/statement/pdf',       exportController.pdfCustomerStatement);

// Invoice exports — POST (body carries { startDate, endDate })
router.post('/export/pdf',      exportController.exportInvoicesToPDF);
router.post('/export/excel',    exportController.exportInvoicesToExcel);

router.route('/')
  .get(customerController.allCustomer)
  .post(customerController.createCustomer);

// Lookup customer by name (sent in body)
router.post('/profile', customerController.oneCustomer);

router.route('/:id')
  .get(customerController.oneCustomerId)
  .patch(customerController.updateCustomer)
  .delete(customerController.deleteCustomer);

module.exports = router;
