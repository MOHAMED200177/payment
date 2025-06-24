const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

router.post('/financial', reportController.comprehensiveFinancialReport);
router.post('/top-products', reportController.getTopProducts);
router.post('/customer-analysis', reportController.customerAnalysis);
router.post('/sales-by-category', reportController.salesByCategory);

module.exports = router;
