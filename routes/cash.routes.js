'use strict';
const express = require('express');
const router = express.Router();
const cashController = require('../controllers/cashController');

router.get('/summary', cashController.getCashSummary);
router.get('/daily-settlement', cashController.getDailySettlement);

router
  .route('/')
  .get(cashController.getAllTransactions)
  .post(cashController.addTransaction);

router
  .route('/:id')
  .get(cashController.getOneTransaction);
// Note: updates and deletes are usually not allowed for direct cash transactions to maintain audit integrity.
// Any reversals should be handled by counter-transactions.

module.exports = router;
