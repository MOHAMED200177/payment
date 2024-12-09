const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');

// Create a new invoice
router.post('/create', invoiceController.createInvoice);
module.exports = router;
