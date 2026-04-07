const express = require('express');
const router = express.Router();
const analytics = require('../controllers/analyticsController');

// ─── Sales ────────────────────────────────────────────────
router.get('/sales', analytics.salesSummary);
router.get('/sales/trend', analytics.revenueTrend);
router.get('/sales/top-products', analytics.topProducts);
router.get('/sales/by-customer', analytics.salesByCustomer);
router.get('/sales/profit', analytics.profitPerSale);

// ─── Inventory ────────────────────────────────────────────
router.get('/inventory', analytics.stockLevels);
router.get('/inventory/movement', analytics.stockMovement);
router.get('/inventory/dead-stock', analytics.deadStock);
router.get('/inventory/most-used', analytics.mostUsedProducts);

// ─── Customer Reports ─────────────────────────────────────
router.get('/customers/top', analytics.topCustomers);
router.get('/customers/debt', analytics.customerDebt);
router.get('/customers/:id/statement', analytics.customerStatement);

// ─── Supplier Reports ─────────────────────────────────────
router.get('/suppliers/outstanding', analytics.supplierOutstanding);
router.get('/suppliers/:id/statement', analytics.supplierStatement);

// ─── Financial ────────────────────────────────────────────
router.get('/financial-summary', analytics.financialSummary);

module.exports = router;
