'use strict';
const express = require('express');
const returnController = require('../controllers/returnController');
const router = express.Router();

// FIX: The addReturn route was commented out, leaving no way to create returns via API.
// This is a critical missing route - sales returns are a core ERP function.
router.post('/add', returnController.addReturn);

router.route('/').get(returnController.allReturn);

// Additional return query routes
router.get('/customer/:customerId', returnController.getReturnsByCustomer);
router.get('/date-range', returnController.getReturnsByDateRange);

router
  .route('/:id')
  .get(returnController.oneReturn)
  .patch(returnController.updateReturn)
  .delete(returnController.deleteReturn);

module.exports = router;
