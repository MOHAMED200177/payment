const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

router.post('/', stockController.creatStock);
router.get('/', stockController.allStock);

module.exports = router;