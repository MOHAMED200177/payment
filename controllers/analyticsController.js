'use strict';
/**
 * analyticsController.js — Multi-tenant version.
 *
 * Every aggregation pipeline now includes { company: req.companyId } in the
 * $match stage. This ensures Company A never sees Company B's data even in
 * complex aggregation pipelines that span multiple collections via $lookup.
 *
 * The $lookup stages deliberately do NOT join across companies — each lookup
 * is implicitly scoped because the documents being joined (products, customers,
 * etc.) all carry the same companyId.
 */
const mongoose   = require('mongoose');
const Invoice     = require('../models/invoice');
const Return      = require('../models/return');
const Product     = require('../models/product');
const Customer    = require('../models/customer');
const Stock       = require('../models/stock');
const Supplier    = require('../models/supplier');
const PurchaseOrder = require('../models/purchaseOrder.model');
const SupplierPayment = require('../models/supplierPayment.model');
const AppError    = require('../utils/appError');
const catchAsync  = require('../utils/catchAsync');

// ── Helper ─────────────────────────────────────────────────
const buildDateFilter = (startDate, endDate) => {
  if (!startDate || !endDate) return {};
  const start = new Date(startDate);
  const end   = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new AppError('Invalid date format', 400);
  if (start > end) throw new AppError('startDate must be before endDate', 400);
  return { createdAt: { $gte: start, $lte: end } };
};

// ── Sales ─────────────────────────────────────────────────
exports.salesSummary = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.query;
  const companyId = req.companyId;

  let dateFilter = {};
  try { dateFilter = buildDateFilter(startDate, endDate); } catch (e) { return next(e); }

  const data = await Invoice.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(companyId), ...dateFilter } },
    { $group: { _id: null, totalInvoices: { $sum: 1 }, totalRevenue: { $sum: '$subtotal' }, totalPayments: { $sum: '$amountPaid' }, totalOutstanding: { $sum: '$balanceDue' }, totalDiscounts: { $sum: '$discountAmount' }, averageValue: { $avg: '$totalAmount' } } },
  ]);

  res.status(200).json({ success: true, data: data[0] || {} });
});

exports.revenueTrend = catchAsync(async (req, res) => {
  const { startDate, endDate, granularity = 'month' } = req.query;
  const companyId = req.companyId;
  let dateFilter = {};
  try { dateFilter = buildDateFilter(startDate, endDate); } catch (e) { return; }

  const groupId = granularity === 'day'
    ? { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } }
    : { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } };

  const data = await Invoice.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(companyId), ...dateFilter } },
    { $group: { _id: groupId, revenue: { $sum: '$subtotal' }, invoices: { $sum: 1 } } },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
  ]);
  res.status(200).json({ success: true, data });
});

exports.topProducts = catchAsync(async (req, res) => {
  const { startDate, endDate, limit = 10 } = req.query;
  const companyId = req.companyId;
  const limitNum = Math.min(Math.max(Number(limit) || 10, 1), 100);

  let dateFilter = {};
  try { dateFilter = buildDateFilter(startDate, endDate); } catch (e) { return; }

  const data = await Invoice.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(companyId), ...dateFilter } },
    { $unwind: '$items' },
    { $group: { _id: '$items.product', totalQuantitySold: { $sum: '$items.quantity' }, totalRevenue: { $sum: '$items.lineTotal' } } },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $project: { _id: 0, productName: '$product.name', productCode: '$product.productCode', totalQuantitySold: 1, totalRevenue: { $round: ['$totalRevenue', 2] } } },
    { $sort: { totalQuantitySold: -1 } },
    { $limit: limitNum },
  ]);
  res.status(200).json({ success: true, data });
});

exports.salesByCustomer = catchAsync(async (req, res) => {
  const { startDate, endDate, limit = 10 } = req.query;
  const companyId = req.companyId;
  let dateFilter = {};
  try { dateFilter = buildDateFilter(startDate, endDate); } catch (e) { return; }

  const data = await Invoice.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(companyId), ...dateFilter } },
    { $group: { _id: '$customer', totalAmount: { $sum: '$totalAmount' }, invoiceCount: { $sum: 1 } } },
    { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
    { $unwind: '$customer' },
    { $project: { _id: 0, customerName: '$customer.name', totalAmount: { $round: ['$totalAmount', 2] }, invoiceCount: 1 } },
    { $sort: { totalAmount: -1 } },
    { $limit: Number(limit) || 10 },
  ]);
  res.status(200).json({ success: true, data });
});

exports.profitPerSale = catchAsync(async (req, res) => {
  const { startDate, endDate, page = 1, limit = 20 } = req.query;
  const companyId = req.companyId;
  const skip = (Number(page) - 1) * Number(limit);

  let dateFilter = {};
  try { dateFilter = buildDateFilter(startDate, endDate); } catch (e) { return; }

  const data = await Invoice.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(companyId), ...dateFilter } },
    { $unwind: '$items' },
    { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $project: { revenue: '$items.lineTotal', cost: { $multiply: ['$product.costPrice', '$items.quantity'] }, profit: { $subtract: ['$items.lineTotal', { $multiply: ['$product.costPrice', '$items.quantity'] }] }, productName: '$product.name' } },
    { $skip: skip }, { $limit: Number(limit) },
  ]);
  res.status(200).json({ success: true, data: { data, page: Number(page), limit: Number(limit), total: data.length } });
});

// ── Inventory ────────────────────────────────────────────────
exports.stockLevels = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, lowStockOnly } = req.query;
  const companyId = req.companyId;
  const skip = (Number(page) - 1) * Number(limit);

  const match = { company: new mongoose.Types.ObjectId(companyId) };

  const stocks = await Stock.find(match).populate('product', 'name productCode reorderLevel sellingPrice').skip(skip).limit(Number(limit));
  const filtered = lowStockOnly === 'true' ? stocks.filter((s) => s.product && s.quantity <= (s.product.reorderLevel || 10)) : stocks;
  const total = await Stock.countDocuments(match);

  res.status(200).json({ success: true, data: { data: filtered }, meta: { total, page: Number(page), limit: Number(limit) } });
});

exports.stockMovement = catchAsync(async (req, res) => {
  const { startDate, endDate, productId } = req.query;
  const companyId = req.companyId;
  let dateFilter = {};
  try { dateFilter = buildDateFilter(startDate, endDate); } catch (e) { return; }

  const match = { company: new mongoose.Types.ObjectId(companyId), ...dateFilter };
  if (productId) match['items.product'] = new mongoose.Types.ObjectId(productId);

  const data = await require('../models/transactions').find(match).populate('items.product', 'name productCode').sort('-date').limit(100).lean();
  res.status(200).json({ success: true, data });
});

exports.deadStock = catchAsync(async (req, res) => {
  const { startDate, endDate, limit = 20 } = req.query;
  const companyId = req.companyId;
  let dateFilter = {};
  try { dateFilter = buildDateFilter(startDate, endDate); } catch (e) { return; }

  const sold = await Invoice.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(companyId), ...dateFilter } },
    { $unwind: '$items' },
    { $group: { _id: '$items.product' } },
  ]);
  const soldIds = sold.map((s) => s._id);

  const dead = await Stock.find({ company: companyId, product: { $nin: soldIds }, quantity: { $gt: 0 } })
    .populate('product', 'name productCode').limit(Number(limit));
  res.status(200).json({ success: true, data: dead });
});

exports.mostUsedProducts = catchAsync(async (req, res) => {
  const { startDate, endDate, limit = 10 } = req.query;
  const companyId = req.companyId;
  let dateFilter = {};
  try { dateFilter = buildDateFilter(startDate, endDate); } catch (e) { return; }

  const data = await Invoice.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(companyId), ...dateFilter } },
    { $unwind: '$items' },
    { $group: { _id: '$items.product', totalUsed: { $sum: '$items.quantity' } } },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $project: { _id: 0, productName: '$product.name', productCode: '$product.productCode', totalUsed: 1 } },
    { $sort: { totalUsed: -1 } }, { $limit: Number(limit) },
  ]);
  res.status(200).json({ success: true, data });
});

// ── Customers ─────────────────────────────────────────────────
exports.topCustomers = catchAsync(async (req, res) => {
  const { startDate, endDate, limit = 10 } = req.query;
  const companyId = req.companyId;
  let dateFilter = {};
  try { dateFilter = buildDateFilter(startDate, endDate); } catch (e) { return; }

  const data = await Invoice.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(companyId), ...dateFilter } },
    { $group: { _id: '$customer', totalAmount: { $sum: '$totalAmount' }, invoiceCount: { $sum: 1 } } },
    { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
    { $unwind: '$customer' },
    { $project: { _id: 0, customerName: '$customer.name', totalAmount: { $round: ['$totalAmount', 2] }, invoiceCount: 1 } },
    { $sort: { totalAmount: -1 } }, { $limit: Number(limit) },
  ]);
  res.status(200).json({ success: true, data });
});

exports.customerDebt = catchAsync(async (req, res) => {
  const companyId = req.companyId;
  const data = await Customer.find({ company: companyId, outstandingBalance: { $gt: 0 } }).select('name phone outstandingBalance').sort('-outstandingBalance').lean();
  const summary = { totalCustomers: data.length, totalDebt: data.reduce((s, c) => s + c.outstandingBalance, 0).toFixed(2) };
  res.status(200).json({ success: true, data: { data, summary } });
});

exports.customerStatement = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const companyId = req.companyId;
  const { startDate, endDate } = req.query;

  const customer = await Customer.findOne({ _id: id, company: companyId });
  if (!customer) return next(new AppError('Customer not found', 404));

  let dateFilter = {};
  try { dateFilter = buildDateFilter(startDate, endDate); } catch (e) { return next(e); }

  const Transaction = require('../models/transactions');
  const txns = await Transaction.find({ company: companyId, referenceId: { $in: (customer.invoice || []) }, ...dateFilter })
    .populate('items.product', 'name productCode').sort('date').lean();

  res.status(200).json({ success: true, data: { customer: { name: customer.name, email: customer.email, phone: customer.phone, outstandingBalance: customer.outstandingBalance }, transactions: txns } });
});

// ── Suppliers ────────────────────────────────────────────────
exports.supplierOutstanding = catchAsync(async (req, res) => {
  const companyId = req.companyId;
  const data = await PurchaseOrder.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(companyId), isDeleted: false, balanceDue: { $gt: 0 } } },
    { $group: { _id: '$supplier', totalDue: { $sum: '$balanceDue' }, orderCount: { $sum: 1 } } },
    { $lookup: { from: 'suppliers', localField: '_id', foreignField: '_id', as: 'supplier' } },
    { $unwind: '$supplier' },
    { $project: { _id: 0, supplierName: '$supplier.name', totalDue: { $round: ['$totalDue', 2] }, orderCount: 1 } },
    { $sort: { totalDue: -1 } },
  ]);
  const summary = { totalDue: data.reduce((s, d) => s + d.totalDue, 0).toFixed(2), suppliersCount: data.length };
  res.status(200).json({ success: true, data: { data, summary } });
});

exports.supplierStatement = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const companyId = req.companyId;
  const { startDate, endDate } = req.query;

  const supplier = await Supplier.findOne({ _id: id, company: companyId });
  if (!supplier) return next(new AppError('Supplier not found', 404));

  let dateFilter = {};
  try { dateFilter = buildDateFilter(startDate, endDate); } catch (e) { return next(e); }

  const [orders, payments] = await Promise.all([
    PurchaseOrder.find({ supplier: id, company: companyId, isDeleted: false, ...dateFilter }).populate('items.product', 'name productCode').sort('-createdAt').lean(),
    SupplierPayment.find({ supplier: id, company: companyId, ...dateFilter }).sort('-createdAt').lean(),
  ]);

  const totalPurchases     = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);
  const totalPaid          = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const outstandingBalance = orders.reduce((s, o) => s + (o.balanceDue || 0), 0);

  res.status(200).json({ success: true, data: { supplier: { name: supplier.name, email: supplier.email, phone: supplier.phone }, totals: { totalPurchases: totalPurchases.toFixed(2), totalPaid: totalPaid.toFixed(2), outstandingBalance: outstandingBalance.toFixed(2) }, orders, payments } });
});

// ── Financial Summary ────────────────────────────────────────
exports.financialSummary = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.query;
  const companyId = req.companyId;
  let dateFilter = {};
  try { dateFilter = buildDateFilter(startDate, endDate); } catch (e) { return next(e); }

  const cid = new mongoose.Types.ObjectId(companyId);

  const [salesStats, returnStats, purchaseStats] = await Promise.all([
    Invoice.aggregate([{ $match: { company: cid, ...dateFilter } }, { $group: { _id: null, revenue: { $sum: '$subtotal' }, collected: { $sum: '$amountPaid' }, outstanding: { $sum: '$balanceDue' } } }]),
    Return.aggregate([{ $match: { company: cid, isDeleted: false, ...dateFilter } }, { $group: { _id: null, totalRefunds: { $sum: '$refundAmount' } } }]),
    PurchaseOrder.aggregate([{ $match: { company: cid, isDeleted: false, ...dateFilter } }, { $group: { _id: null, totalPurchases: { $sum: '$totalAmount' }, totalPaid: { $sum: '$amountPaid' }, totalDue: { $sum: '$balanceDue' } } }]),
  ]);

  const revenue = salesStats[0]?.revenue || 0;
  const refunds = returnStats[0]?.totalRefunds || 0;
  const purchases = purchaseStats[0]?.totalPurchases || 0;
  const netRevenue = revenue - refunds;
  const grossProfit = netRevenue - purchases;

  res.status(200).json({ success: true, data: { revenue: revenue.toFixed(2), refunds: refunds.toFixed(2), netRevenue: netRevenue.toFixed(2), purchases: purchases.toFixed(2), grossProfit: grossProfit.toFixed(2), collected: (salesStats[0]?.collected || 0).toFixed(2), outstanding: (salesStats[0]?.outstanding || 0).toFixed(2) } });
});
