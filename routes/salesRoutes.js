const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');


router.post('/year', salesController.financialReport);
router.post('/top', salesController.getTopProducts);

module.exports = router;
