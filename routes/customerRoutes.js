const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');

// Get customer statement
router.post('/statement', customerController.getCustomerStatement);


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
