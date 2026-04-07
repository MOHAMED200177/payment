/**
 * analyticsController.js
 * ─────────────────────────────────────────────
 * Express route handlers wrapping reportService.
 * Every handler validates query-params, calls the
 * service, and returns { success, data, meta }.
 * ─────────────────────────────────────────────
 */

const reportService = require('./reportService');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

// ─── Sales ────────────────────────────────────────────────

exports.salesSummary = catchAsync(async (req, res) => {
  const { startDate, endDate, period } = req.query;
  const data = await reportService.getSalesSummary({ startDate, endDate, period });
  res.status(200).json({ success: true, data });
});

exports.revenueTrend = catchAsync(async (req, res) => {
  const { startDate, endDate, granularity } = req.query;
  const data = await reportService.getRevenueTrend({ startDate, endDate, granularity });
  res.status(200).json({ success: true, data });
});

exports.topProducts = catchAsync(async (req, res) => {
  const { startDate, endDate, limit, sortBy } = req.query;
  const data = await reportService.getTopSellingProducts({ startDate, endDate, limit, sortBy });
  res.status(200).json({ success: true, data });
});

exports.salesByCustomer = catchAsync(async (req, res) => {
  const { startDate, endDate, limit } = req.query;
  const data = await reportService.getSalesByCustomer({ startDate, endDate, limit });
  res.status(200).json({ success: true, data });
});

exports.profitPerSale = catchAsync(async (req, res) => {
  const { startDate, endDate, page, limit } = req.query;
  const result = await reportService.getProfitPerSale({ startDate, endDate, page, limit });
  res.status(200).json({
    success: true,
    data: result.data,
    meta: { total: result.total, page: result.page, limit: result.limit },
  });
});

// ─── Inventory ────────────────────────────────────────────

exports.stockLevels = catchAsync(async (req, res) => {
  const { page, limit, lowStockOnly } = req.query;
  const result = await reportService.getCurrentStockLevels({
    page,
    limit,
    lowStockOnly: lowStockOnly === 'true',
  });
  res.status(200).json({
    success: true,
    data: result.data,
    summary: result.summary,
    meta: { total: result.total, page: result.page, limit: result.limit },
  });
});

exports.stockMovement = catchAsync(async (req, res) => {
  const { startDate, endDate, productId } = req.query;
  const data = await reportService.getStockMovementHistory({ startDate, endDate, productId });
  res.status(200).json({ success: true, data });
});

exports.deadStock = catchAsync(async (req, res) => {
  const { startDate, endDate, limit } = req.query;
  const data = await reportService.getDeadStock({ startDate, endDate, limit });
  res.status(200).json({ success: true, data });
});

exports.mostUsedProducts = catchAsync(async (req, res) => {
  const { startDate, endDate, limit } = req.query;
  const data = await reportService.getMostUsedProducts({ startDate, endDate, limit });
  res.status(200).json({ success: true, data });
});

// ─── Customer Reports ─────────────────────────────────────

exports.customerStatement = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;
  const data = await reportService.getCustomerStatement(id, { startDate, endDate });
  if (!data) return next(new AppError('Customer not found', 404));
  res.status(200).json({ success: true, data });
});

exports.topCustomers = catchAsync(async (req, res) => {
  const { startDate, endDate, limit } = req.query;
  const data = await reportService.getTopCustomers({ startDate, endDate, limit });
  res.status(200).json({ success: true, data });
});

exports.customerDebt = catchAsync(async (req, res) => {
  const result = await reportService.getCustomerDebtReport();
  res.status(200).json({ success: true, data: result.data, summary: result.summary });
});

// ─── Supplier Reports ─────────────────────────────────────

exports.supplierStatement = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;
  const data = await reportService.getSupplierStatement(id, { startDate, endDate });
  if (!data) return next(new AppError('Supplier not found', 404));
  res.status(200).json({ success: true, data });
});

exports.supplierOutstanding = catchAsync(async (req, res) => {
  const result = await reportService.getSupplierOutstandingBalances();
  res.status(200).json({ success: true, data: result.data, summary: result.summary });
});

// ─── Financial Summary ───────────────────────────────────

exports.financialSummary = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;
  const data = await reportService.getFinancialSummary({ startDate, endDate });
  res.status(200).json({ success: true, data });
});
