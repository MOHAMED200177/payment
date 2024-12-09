const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

router.post('/stock', stockController.creatStock);

module.exports = router;