'use strict';
const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');

router
  .route('/')
  .get(supplierController.getAllSuppliers)
  .post(supplierController.createSupplier);

// FIX: Added missing supplier statement route
router.get('/:id/statement', supplierController.getSupplierStatement);

router
  .route('/:id')
  .get(supplierController.getSupplier)
  .patch(supplierController.updateSupplier)
  .delete(supplierController.deleteSupplier);

module.exports = router;
