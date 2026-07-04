'use strict';
const express = require('express');
const router  = express.Router();
const purchaseOrderController = require('../controllers/purchaseOrderController');
const purchaseReturnController = require('../controllers/purchaseReturnController');

router.post('/return', purchaseReturnController.processPurchaseReturn);

router.route('/')
  .get(purchaseOrderController.getAllPurchaseOrders)
  .post(purchaseOrderController.createPurchaseOrder);

router.get('/stats', purchaseOrderController.getPurchaseStats);

router.route('/:id')
  .get(purchaseOrderController.getOnePurchaseOrder)
  .delete(purchaseOrderController.deletePurchaseOrder);

router.patch('/:id/receive',  purchaseOrderController.receiveItems);
router.post('/:id/payment',   purchaseOrderController.addSupplierPayment);
router.patch('/:id/cancel',   purchaseOrderController.cancelPurchaseOrder);

module.exports = router;
