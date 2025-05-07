const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');


router.
    route('/')
    .get(supplierController.getCategories)
    .post(supplierController.createSupplier);

router.
    route('/:id')
    .get(supplierController.getSupplier)
    .patch(supplierController.updateSupplier)
    .delete(supplierController.deleteSupplier);

module.exports = router;