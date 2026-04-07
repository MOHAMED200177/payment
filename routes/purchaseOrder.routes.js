const express = require('express');
const router = express.Router();
const purchaseOrderController = require('../controllers/purchaseOrderController');

// ============================================================
// Purchase Orders
// ============================================================
router
  .route('/')
  .get(purchaseOrderController.getAllPurchaseOrders)
  .post(purchaseOrderController.createPurchaseOrder);

router.route('/stats').get(purchaseOrderController.getPurchaseStats);

router
  .route('/:id')
  .get(purchaseOrderController.getOnePurchaseOrder)
  .delete(purchaseOrderController.deletePurchaseOrder);

// ✅ Receive Items
router.route('/:id/receive').patch(purchaseOrderController.receiveItems);

// ✅ Supplier Payment
router.route('/:id/payment').post(purchaseOrderController.addSupplierPayment);

// ✅ Cancel Order
router.route('/:id/cancel').patch(purchaseOrderController.cancelPurchaseOrder);

module.exports = router;
