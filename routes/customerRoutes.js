const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const exportController = require('../controllers/exportController');

// Get customer statement
router.post('/statement', customerController.getCustomerStatement);
router.post('/statement/file', exportController.fileCustomerStatement);
router.get('/export/pdf', exportController.exportInvoicesToPDF);
router.get('/export/excel', exportController.exportInvoicesToExcel);


router.
    route('/')
    .get(customerController.allCustomer)
    .post(customerController.createCustomer);
router.
    route('/profile')
    .post(customerController.oneCustomer)

router.
    route('/:id')
    .patch(customerController.updateCustomer)
    .delete(customerController.deleteCustomer);




module.exports = router;
