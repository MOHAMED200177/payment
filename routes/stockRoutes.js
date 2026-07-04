'use strict';
const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

router.get('/low-stock', stockController.getLowStock);
router.get('/expiring-soon', stockController.getExpiringSoon);
router.get('/expired', stockController.getExpiredStock);

router
  .route('/')
  .get(stockController.allStock)
  .post(stockController.createStock);

router
  .route('/:id')
  .get(stockController.oneStock)
  .delete(stockController.deleteStock);

// Stock adjustment — requires reason, creates transaction record
router.post('/:id/adjust', stockController.adjustStock);

module.exports = router;
