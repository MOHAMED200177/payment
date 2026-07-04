'use strict';
/**
 * reportController.js
 * Routes every report request through reportService.js (multi-tenant version).
 * All functions extract req.companyId and pass it to the service layer.
 *
 * Previously this file was routing to analyticsController.js, leaving
 * reportService.js (1072 lines of excellent aggregation code) as dead code.
 */
const reportService = require('./reportService');
const AuditLog = require('../models/auditLog.model');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const mongoose = require('mongoose');

// ── Helper — extract date params from query or body ──────────
const extractDates = (req) => ({
  startDate: req.query.startDate || req.body?.startDate,
  endDate: req.query.endDate || req.body?.endDate,
});

// ─────────────────────────────────────────────────────────────
// A) Sales Reports
// ─────────────────────────────────────────────────────────────

exports.salesSummary = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = extractDates(req);
  const { period = 'monthly' } = req.query;
  const data = await reportService.getSalesSummary({ companyId: req.companyId, startDate, endDate, period });
  res.status(200).json({ status: 'success', data });
});

exports.revenueTrend = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = extractDates(req);
  const { granularity = 'monthly' } = req.query;
  const data = await reportService.getRevenueTrend({ companyId: req.companyId, startDate, endDate, granularity });
  res.status(200).json({ status: 'success', data });
});

exports.topProducts = catchAsync(async (req, res, next) => {
  const { startDate, endDate, page, limit } = req.query;
  const data = await reportService.getTopProducts({ companyId: req.companyId, startDate, endDate, page, limit });
  res.status(200).json({ status: 'success', data });
});

exports.salesByCustomer = catchAsync(async (req, res, next) => {
  const { startDate, endDate, page, limit } = req.query;
  const data = await reportService.getSalesByCustomer({ companyId: req.companyId, startDate, endDate, page, limit });
  res.status(200).json({ status: 'success', data });
});

exports.profitPerSale = catchAsync(async (req, res, next) => {
  const { startDate, endDate, page, limit } = req.query;
  const data = await reportService.getProfitPerSale({ companyId: req.companyId, startDate, endDate, page, limit });
  res.status(200).json({ status: 'success', data });
});

// ─────────────────────────────────────────────────────────────
// B) Inventory Reports
// ─────────────────────────────────────────────────────────────

exports.stockLevels = catchAsync(async (req, res, next) => {
  const { threshold } = req.query;
  const data = await reportService.getStockLevels({ companyId: req.companyId, threshold });
  res.status(200).json({ status: 'success', results: data.length, data });
});

exports.stockMovement = catchAsync(async (req, res, next) => {
  const { startDate, endDate, productId, page, limit } = req.query;
  const data = await reportService.getStockMovement({ companyId: req.companyId, startDate, endDate, productId, page, limit });
  res.status(200).json({ status: 'success', data });
});

exports.deadStock = catchAsync(async (req, res, next) => {
  const { daysSinceLastSale } = req.query;
  const data = await reportService.getDeadStock({ companyId: req.companyId, daysSinceLastSale });
  res.status(200).json({ status: 'success', results: data.length, data });
});

exports.mostUsedProducts = catchAsync(async (req, res, next) => {
  const { startDate, endDate, limit } = req.query;
  const data = await reportService.getMostUsedProducts({ companyId: req.companyId, startDate, endDate, limit });
  res.status(200).json({ status: 'success', data });
});

// Stock valuation report (new)
exports.stockValuation = catchAsync(async (req, res, next) => {
  const data = await reportService.getStockLevels({ companyId: req.companyId });
  const valuation = data.map((s) => ({
    productName: s.product?.name,
    productCode: s.product?.productCode,
    quantity: s.quantity,
    costPrice: s.product?.costPrice || 0,
    sellingPrice: s.product?.sellingPrice || 0,
    stockValueAtCost: +(s.quantity * (s.product?.costPrice || 0)).toFixed(2),
    stockValueAtSell: +(s.quantity * (s.product?.sellingPrice || 0)).toFixed(2),
  }));
  const totalCostValue = valuation.reduce((t, v) => t + v.stockValueAtCost, 0);
  const totalSellValue = valuation.reduce((t, v) => t + v.stockValueAtSell, 0);
  res.status(200).json({ status: 'success', data: { items: valuation, summary: { totalCostValue: +totalCostValue.toFixed(2), totalSellValue: +totalSellValue.toFixed(2), potentialProfit: +(totalSellValue - totalCostValue).toFixed(2) } } });
});

// ─────────────────────────────────────────────────────────────
// C) Customer Reports
// ─────────────────────────────────────────────────────────────

exports.topCustomers = catchAsync(async (req, res, next) => {
  const { startDate, endDate, limit } = req.query;
  const data = await reportService.getTopCustomers({ companyId: req.companyId, startDate, endDate, limit });
  res.status(200).json({ status: 'success', data });
});

exports.customerDebt = catchAsync(async (req, res, next) => {
  const data = await reportService.getCustomerDebt({ companyId: req.companyId });
  res.status(200).json({ status: 'success', data });
});

exports.customerStatement = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { startDate, endDate } = extractDates(req);

  if (!mongoose.Types.ObjectId.isValid(id)) return next(new AppError('Invalid customer ID', 400));

  const data = await reportService.getCustomerStatement({ companyId: req.companyId, customerId: id, startDate, endDate });
  if (!data) return next(new AppError('Customer not found', 404));

  res.status(200).json({ status: 'success', data });
});

// Overdue invoices aging report (new)
exports.overdueInvoices = catchAsync(async (req, res, next) => {
  const Invoice = require('../models/invoice');
  const today = new Date();

  const data = await Invoice.aggregate([
    {
      $match: {
        company: new mongoose.Types.ObjectId(req.companyId.toString()),
        isDeleted: { $ne: true },
        status: { $in: ['issued', 'partially_paid', 'overdue'] },
        balanceDue: { $gt: 0 },
        dueDate: { $lt: today },
      },
    },
    {
      $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: 'customerInfo' },
    },
    { $unwind: { path: '$customerInfo', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        daysOverdue: { $divide: [{ $subtract: [today, '$dueDate'] }, 1000 * 60 * 60 * 24] },
      },
    },
    {
      $project: {
        invoiceNumber: 1,
        issueDate: 1,
        dueDate: 1,
        totalAmount: 1,
        amountPaid: 1,
        balanceDue: 1,
        daysOverdue: { $round: ['$daysOverdue', 0] },
        customerName: '$customerInfo.name',
        customerPhone: '$customerInfo.phone',
        agingBucket: {
          $switch: {
            branches: [
              { case: { $lte: [{ $round: ['$daysOverdue', 0] }, 30] }, then: '1-30 days' },
              { case: { $lte: [{ $round: ['$daysOverdue', 0] }, 60] }, then: '31-60 days' },
              { case: { $lte: [{ $round: ['$daysOverdue', 0] }, 90] }, then: '61-90 days' },
            ],
            default: '90+ days',
          },
        },
      },
    },
    { $sort: { daysOverdue: -1 } },
  ]);

  const totalOverdue = data.reduce((s, i) => s + i.balanceDue, 0);
  res.status(200).json({
    status: 'success',
    results: data.length,
    data: {
      invoices: data,
      summary: {
        totalOverdueCount: data.length,
        totalOverdueAmount: +totalOverdue.toFixed(2),
      },
    },
  });
});

// ─────────────────────────────────────────────────────────────
// D) Supplier Reports
// ─────────────────────────────────────────────────────────────

exports.supplierOutstanding = catchAsync(async (req, res, next) => {
  const data = await reportService.getSupplierOutstandingBalances({ companyId: req.companyId });
  res.status(200).json({ status: 'success', data });
});

exports.supplierStatement = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { startDate, endDate } = extractDates(req);

  if (!mongoose.Types.ObjectId.isValid(id)) return next(new AppError('Invalid supplier ID', 400));

  const data = await reportService.getSupplierStatement({ companyId: req.companyId, supplierId: id, startDate, endDate });
  if (!data) return next(new AppError('Supplier not found', 404));

  res.status(200).json({ status: 'success', data });
});

// Purchase orders report (new)
exports.purchasesReport = catchAsync(async (req, res, next) => {
  const PurchaseOrder = require('../models/purchaseOrder.model');
  const { startDate, endDate } = extractDates(req);
  const companyId = req.companyId;

  const match = { company: new mongoose.Types.ObjectId(companyId.toString()), isDeleted: { $ne: true } };
  if (startDate && endDate) match.orderDate = { $gte: new Date(startDate), $lte: new Date(endDate) };

  const [summary, byStatus, bySupplier, monthly] = await Promise.all([
    PurchaseOrder.aggregate([
      { $match: match },
      { $group: { _id: null, totalOrders: { $sum: 1 }, totalAmount: { $sum: '$totalAmount' }, totalPaid: { $sum: '$amountPaid' }, totalDue: { $sum: '$balanceDue' } } },
    ]),
    PurchaseOrder.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$totalAmount' } } },
    ]),
    PurchaseOrder.aggregate([
      { $match: match },
      { $group: { _id: '$supplier', total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
      { $lookup: { from: 'suppliers', localField: '_id', foreignField: '_id', as: 's' } },
      { $unwind: { path: '$s', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, supplierName: { $ifNull: ['$s.name', 'Unknown'] }, total: { $round: ['$total', 2] }, count: 1 } },
      { $sort: { total: -1 } },
    ]),
    PurchaseOrder.aggregate([
      { $match: match },
      { $group: { _id: { year: { $year: '$orderDate' }, month: { $month: '$orderDate' } }, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      summary: summary[0] || { totalOrders: 0, totalAmount: 0, totalPaid: 0, totalDue: 0 },
      byStatus,
      bySupplier,
      monthly,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// E) Financial Reports
// ─────────────────────────────────────────────────────────────

exports.financialSummary = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = extractDates(req);
  const data = await reportService.getFinancialSummary({ companyId: req.companyId, startDate, endDate });
  res.status(200).json({ status: 'success', data });
});

// Formal Profit & Loss Statement (new)
exports.profitLossStatement = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = extractDates(req);
  const data = await reportService.getFinancialSummary({ companyId: req.companyId, startDate, endDate });
  const Expense = require('../models/expense.model');
  const companyId = req.companyId;

  const expMatch = { company: new mongoose.Types.ObjectId(companyId.toString()), isDeleted: { $ne: true }, status: 'paid' };
  if (startDate && endDate) expMatch.date = { $gte: new Date(startDate), $lte: new Date(endDate) };

  const expByCategory = await Expense.aggregate([
    { $match: expMatch },
    { $group: { _id: '$category', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { amount: -1 } },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      period: { startDate: startDate || 'All time', endDate: endDate || 'Present' },
      revenue: {
        totalRevenue: data.summary.totalRevenue,
        totalReceived: data.summary.totalReceived,
        totalReceivable: data.summary.totalReceivable,
      },
      cogs: data.summary.cogs,
      grossProfit: data.summary.grossProfit,
      operatingExpenses: {
        total: data.summary.totalExpenses,
        byCategory: expByCategory,
      },
      netProfit: data.summary.netProfit,
      profitMargin: data.summary.profitMargin,
      monthlyPnL: data.monthlyPnL,
    },
  });
});

// Returns report (new)
exports.returnsReport = catchAsync(async (req, res, next) => {
  const Return = require('../models/return');
  const { startDate, endDate } = extractDates(req);
  const companyId = req.companyId;

  const match = { company: new mongoose.Types.ObjectId(companyId.toString()), isDeleted: { $ne: true } };
  if (startDate && endDate) match.date = { $gte: new Date(startDate), $lte: new Date(endDate) };

  const [returns, byProduct, byCustomer] = await Promise.all([
    Return.aggregate([
      { $match: match },
      { $group: { _id: null, totalReturns: { $sum: 1 }, totalRefundAmount: { $sum: '$refundAmount' }, totalQuantity: { $sum: '$quantity' } } },
    ]),
    Return.aggregate([
      { $match: { ...match, status: { $ne: 'cancelled' } } },
      { $group: { _id: '$product', totalQty: { $sum: '$quantity' }, totalRefund: { $sum: '$refundAmount' }, count: { $sum: 1 } } },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'p' } },
      { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, productName: { $ifNull: ['$p.name', 'Unknown'] }, totalQty: 1, totalRefund: { $round: ['$totalRefund', 2] }, count: 1 } },
      { $sort: { totalRefund: -1 } },
    ]),
    Return.aggregate([
      { $match: { ...match, status: { $ne: 'cancelled' } } },
      { $group: { _id: '$customer', totalRefund: { $sum: '$refundAmount' }, count: { $sum: 1 } } },
      { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'c' } },
      { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, customerName: { $ifNull: ['$c.name', 'Unknown'] }, totalRefund: { $round: ['$totalRefund', 2] }, count: 1 } },
      { $sort: { totalRefund: -1 } },
    ]),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      summary: returns[0] || { totalReturns: 0, totalRefundAmount: 0, totalQuantity: 0 },
      byProduct,
      byCustomer,
    },
  });
});

// Expense report (new)
exports.expenseReport = catchAsync(async (req, res, next) => {
  const Expense = require('../models/expense.model');
  const { startDate, endDate } = extractDates(req);
  const companyId = req.companyId;

  const match = { company: new mongoose.Types.ObjectId(companyId.toString()), isDeleted: { $ne: true }, status: 'paid' };
  if (startDate && endDate) match.date = { $gte: new Date(startDate), $lte: new Date(endDate) };

  const [byCategory, byMethod, monthly, expenses] = await Promise.all([
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 }, avgAmount: { $avg: '$amount' } } },
      { $sort: { total: -1 } },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$paymentMethod', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    Expense.find(match).sort('-date').limit(50).lean(),
  ]);

  const totalExpenses = byCategory.reduce((s, c) => s + c.total, 0);
  res.status(200).json({
    status: 'success',
    data: {
      summary: { totalExpenses: +totalExpenses.toFixed(2), categories: byCategory.length },
      byCategory: byCategory.map((c) => ({ ...c, percentage: totalExpenses > 0 ? ((c.total / totalExpenses) * 100).toFixed(1) + '%' : '0%' })),
      byMethod,
      monthly,
      recentExpenses: expenses,
    },
  });
});

// Cash flow statement (new)
exports.cashFlow = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = extractDates(req);
  const companyId = req.companyId;

  const CashTransaction = require('../models/cashTransaction.model');
  const match = { company: new mongoose.Types.ObjectId(companyId.toString()) };
  if (startDate && endDate) match.date = { $gte: new Date(startDate), $lte: new Date(endDate) };

  const [cashData, monthly] = await Promise.all([
    CashTransaction.aggregate([
      { $match: match },
      { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    CashTransaction.aggregate([
      { $match: match },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' }, type: '$type' }, total: { $sum: '$amount' } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
  ]);

  const income = cashData.find((c) => c._id === 'income')?.total || 0;
  const expense = cashData.find((c) => c._id === 'expense')?.total || 0;
  res.status(200).json({ status: 'success', data: { summary: { totalIncome: +income.toFixed(2), totalExpense: +expense.toFixed(2), netCashFlow: +(income - expense).toFixed(2) }, monthly } });
});

// ─────────────────────────────────────────────────────────────
// F) Audit Log Viewer (ADMIN only)
// ─────────────────────────────────────────────────────────────

exports.auditLogs = catchAsync(async (req, res, next) => {
  const { module, action, page = 1, limit = 50, startDate, endDate } = req.query;
  const companyId = req.companyId;

  const match = { company: new mongoose.Types.ObjectId(companyId.toString()) };
  if (module) match.module = module.toUpperCase();
  if (action) match.action = action.toUpperCase();
  if (startDate && endDate) match.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };

  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));
  const skip = (p - 1) * l;

  const [total, logs] = await Promise.all([
    AuditLog.countDocuments(match),
    AuditLog.find(match).sort('-createdAt').skip(skip).limit(l).lean(),
  ]);

  res.status(200).json({
    status: 'success',
    total,
    page: p,
    pages: Math.ceil(total / l),
    data: logs,
  });
});
