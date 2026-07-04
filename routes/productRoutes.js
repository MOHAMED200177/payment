'use strict';
const express = require('express');
const router  = express.Router();
const productController = require('../controllers/productController');

router.route('/')
  .get(productController.getAllProducts)
  .post(productController.createProduct);

router.post('/search', productController.getProductByName);

router.route('/:id')
  .get(productController.getProduct)
  .patch(productController.updateProduct)
  .delete(productController.deleteProduct);

module.exports = router;
