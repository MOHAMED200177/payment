'use strict';
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { restrictTo } = require('../middlewares/auth');

// ─── Sales ────────────────────────────────────────────────
router.get('/sales',              reportController.salesSummary);
router.get('/sales/trend',        reportController.revenueTrend);
router.get('/sales/top-products', reportController.topProducts);
router.get('/sales/by-customer',  reportController.salesByCustomer);
router.get('/sales/profit',       reportController.profitPerSale);

// ─── Inventory ────────────────────────────────────────────
router.get('/inventory',                reportController.stockLevels);
router.get('/inventory/movement',       reportController.stockMovement);
router.get('/inventory/dead-stock',     reportController.deadStock);
router.get('/inventory/most-used',      reportController.mostUsedProducts);
router.get('/inventory/valuation',      reportController.stockValuation);

// ─── Customer Reports ─────────────────────────────────────
router.get('/customers/top',              reportController.topCustomers);
router.get('/customers/debt',             reportController.customerDebt);
router.get('/customers/overdue',          reportController.overdueInvoices);
router.get('/customers/:id/statement',    reportController.customerStatement);

// ─── Supplier Reports ─────────────────────────────────────
router.get('/suppliers/outstanding',      reportController.supplierOutstanding);
router.get('/suppliers/purchases',        reportController.purchasesReport);
router.get('/suppliers/:id/statement',    reportController.supplierStatement);

// ─── Financial ────────────────────────────────────────────
router.get('/financial/summary',          reportController.financialSummary);
router.get('/financial/pnl',              reportController.profitLossStatement);
router.get('/financial/expenses',         reportController.expenseReport);
router.get('/financial/cash-flow',        reportController.cashFlow);
router.get('/financial/returns',          reportController.returnsReport);

// ─── Admin / System ───────────────────────────────────────
router.get('/audit-logs', restrictTo('ADMIN'), reportController.auditLogs);

module.exports = router;
