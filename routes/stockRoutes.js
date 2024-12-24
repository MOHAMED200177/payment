const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');


router.
    route('/')
    .get(stockController.allStock)
    .post(stockController.creatStock);

router.
    route('/:id')
    .get(stockController.oneStock)
    .patch(stockController.updateStock)
    .delete(stockController.deleteStock);

module.exports = router;