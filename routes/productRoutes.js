const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');


router.
    route('/')
    .get(productController.getAllProducts)
    .post(productController.createProduct);

// router.
//     route('/:id')
//     .get(productController.oneStock)
//     .patch(productController.updateStock)
//     .delete(productController.deleteStock);

module.exports = router;