/**
 * reportService.js
 * ─────────────────────────────────────────────
 * Centralised aggregation / query logic for
 * every report the ERP exposes.
 *
 * IMPORTANT: Every function REQUIRES a companyId parameter.
 * Without it the aggregate will span all tenants.
 * ─────────────────────────────────────────────
 */

const mongoose = require('mongoose');
const Invoice = require('../models/invoice');
const Payment = require('../models/payment');
const Customer = require('../models/customer');
const Supplier = require('../models/supplier');
const Product = require('../models/product');
const Stock = require('../models/stock');
const PurchaseOrder = require('../models/purchaseOrder.model');
const SupplierPayment = require('../models/supplierPayment.model');
const Expense = require('../models/expense.model');
const CashTransaction = require('../models/cashTransaction.model');
const Return = require('../models/return');
const SalesOrder = require('../models/sales');
const Transaction = require('../models/transactions');

// ─── helpers ──────────────────────────────────────────────
function dateRange(startDate, endDate) {
  const f = {};
  if (startDate) f.$gte = new Date(startDate);
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    f.$lte = end;
  }
  return Object.keys(f).length ? f : null;
}

function paginate(page = 1, limit = 50) {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(200, Math.max(1, Number(limit) || 50));
  return { skip: (p - 1) * l, limit: l, page: p };
}

/**
 * Convert a companyId string/ObjectId to a proper ObjectId for aggregations.
 * This prevents cross-tenant queries in $match stages.
 */
function toObjId(companyId) {
  if (!companyId) throw new Error('companyId is required for all report queries');
  return new mongoose.Types.ObjectId(companyId.toString());
}

// ═══════════════════════════════════════════════════════════
//  A) SALES REPORTS
// ═══════════════════════════════════════════════════════════

/**
 * Sales summary — totals, averages, period breakdown
 */
exports.getSalesSummary = async ({ companyId, startDate, endDate, period = 'monthly' }) => {
  const dr = dateRange(startDate, endDate);
  const match = { company: toObjId(companyId), isDeleted: { $ne: true } };
  if (dr) match.issueDate = dr;

  // Totals
  const [totals] = await Invoice.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$totalAmount' },
        totalSubtotal: { $sum: '$subtotal' },
        totalTax: { $sum: '$taxAmount' },
        totalDiscount: { $sum: '$discountAmount' },
        totalPaid: { $sum: '$amountPaid' },
        totalOutstanding: { $sum: '$balanceDue' },
        avgOrderValue: { $avg: '$totalAmount' },
      },
    },
  ]);

  // Cost of goods — need to join with products
  const costData = await Invoice.aggregate([
    { $match: match },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'prod',
      },
    },
    { $unwind: '$prod' },
    {
      $group: {
        _id: null,
        totalCost: {
          $sum: { $multiply: ['$items.quantity', '$prod.costPrice'] },
        },
        totalSellingValue: { $sum: '$items.lineTotal' },
      },
    },
  ]);

  const totalCost = costData[0]?.totalCost || 0;
  const totalRevenue = totals?.totalRevenue || 0;
  const grossProfit = totalRevenue - totalCost;

  // Status breakdown
  const statusBreakdown = await Invoice.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
    { $sort: { amount: -1 } },
  ]);

  // Period grouping
  const periodGroup = {
    daily: { year: { $year: '$issueDate' }, month: { $month: '$issueDate' }, day: { $dayOfMonth: '$issueDate' } },
    weekly: { year: { $isoWeekYear: '$issueDate' }, week: { $isoWeek: '$issueDate' } },
    monthly: { year: { $year: '$issueDate' }, month: { $month: '$issueDate' } },
    yearly: { year: { $year: '$issueDate' } },
  };

  const periodData = await Invoice.aggregate([
    { $match: match },
    {
      $group: {
        _id: periodGroup[period] || periodGroup.monthly,
        revenue: { $sum: '$totalAmount' },
        orders: { $sum: 1 },
        paid: { $sum: '$amountPaid' },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } },
  ]);

  return {
    summary: {
      totalOrders: totals?.totalOrders || 0,
      totalRevenue: +(totalRevenue).toFixed(2),
      totalSubtotal: +(totals?.totalSubtotal || 0).toFixed(2),
      totalTax: +(totals?.totalTax || 0).toFixed(2),
      totalDiscount: +(totals?.totalDiscount || 0).toFixed(2),
      totalPaid: +(totals?.totalPaid || 0).toFixed(2),
      totalOutstanding: +(totals?.totalOutstanding || 0).toFixed(2),
      avgOrderValue: +(totals?.avgOrderValue || 0).toFixed(2),
      totalCost: +totalCost.toFixed(2),
      grossProfit: +grossProfit.toFixed(2),
      profitMargin: totalRevenue > 0 ? +((grossProfit / totalRevenue) * 100).toFixed(2) : 0,
    },
    statusBreakdown,
    periodData,
  };
};

/**
 * Revenue trend — time-series
 */
exports.getRevenueTrend = async ({ companyId, startDate, endDate, granularity = 'monthly' }) => {
  const dr = dateRange(startDate, endDate);
  const match = { company: toObjId(companyId), isDeleted: { $ne: true } };
  if (dr) match.issueDate = dr;

  const groupId = {
    daily: { year: { $year: '$issueDate' }, month: { $month: '$issueDate' }, day: { $dayOfMonth: '$issueDate' } },
    weekly: { year: { $isoWeekYear: '$issueDate' }, week: { $isoWeek: '$issueDate' } },
    monthly: { year: { $year: '$issueDate' }, month: { $month: '$issueDate' } },
  };

  const data = await Invoice.aggregate([
    { $match: match },
    {
      $group: {
        _id: groupId[granularity] || groupId.monthly,
        revenue: { $sum: '$totalAmount' },
        orders: { $sum: 1 },
        paid: { $sum: '$amountPaid' },
        outstanding: { $sum: '$balanceDue' },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } },
  ]);

  return data;
};

/**
 * Top selling products
 */
exports.getTopProducts = async ({ companyId, startDate, endDate, page, limit }) => {
  const { skip, limit: lim, page: p } = paginate(page, limit);
  const dr = dateRange(startDate, endDate);
  const match = { company: toObjId(companyId), isDeleted: { $ne: true } };
  if (dr) match.issueDate = dr;

  const data = await Invoice.aggregate([
    { $match: match },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        totalQuantity: { $sum: '$items.quantity' },
        totalRevenue: { $sum: '$items.lineTotal' },
        avgPrice: { $avg: '$items.unitPrice' },
        orderCount: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: '$product' },
    {
      $lookup: {
        from: 'categories',
        localField: 'product.category',
        foreignField: '_id',
        as: 'cat',
      },
    },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        name: '$product.name',
        productCode: '$product.productCode',
        category: { $ifNull: [{ $arrayElemAt: ['$cat.name', 0] }, 'Uncategorized'] },
        costPrice: '$product.costPrice',
        sellingPrice: '$product.sellingPrice',
        totalQuantity: 1,
        totalRevenue: { $round: ['$totalRevenue', 2] },
        avgPrice: { $round: ['$avgPrice', 2] },
        orderCount: 1,
        profit: {
          $round: [
            { $subtract: ['$totalRevenue', { $multiply: ['$totalQuantity', '$product.costPrice'] }] },
            2,
          ],
        },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $skip: skip },
    { $limit: lim },
  ]);

  return { data, page: p, limit: lim };
};

/**
 * Sales by customer
 */
exports.getSalesByCustomer = async ({ companyId, startDate, endDate, page, limit }) => {
  const { skip, limit: lim, page: p } = paginate(page, limit);
  const dr = dateRange(startDate, endDate);
  const match = { company: toObjId(companyId), isDeleted: { $ne: true } };
  if (dr) match.issueDate = dr;

  const data = await Invoice.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$customer',
        totalPurchases: { $sum: '$totalAmount' },
        invoiceCount: { $sum: 1 },
        totalPaid: { $sum: '$amountPaid' },
        totalDue: { $sum: '$balanceDue' },
        avgOrderValue: { $avg: '$totalAmount' },
        lastPurchase: { $max: '$issueDate' },
      },
    },
    {
      $lookup: {
        from: 'customers',
        localField: '_id',
        foreignField: '_id',
        as: 'customer',
      },
    },
    { $unwind: '$customer' },
    {
      $project: {
        _id: 0,
        customerId: '$_id',
        name: '$customer.name',
        email: '$customer.email',
        phone: '$customer.phone',
        totalPurchases: { $round: ['$totalPurchases', 2] },
        invoiceCount: 1,
        totalPaid: { $round: ['$totalPaid', 2] },
        totalDue: { $round: ['$totalDue', 2] },
        avgOrderValue: { $round: ['$avgOrderValue', 2] },
        lastPurchase: 1,
      },
    },
    { $sort: { totalPurchases: -1 } },
    { $skip: skip },
    { $limit: lim },
  ]);

  return { data, page: p, limit: lim };
};

exports.getTopCustomers = async (params) => {
  return exports.getSalesByCustomer(params);
};

/**
 * Profit per sale — per-invoice profit calculation
 */
exports.getProfitPerSale = async ({ companyId, startDate, endDate, page, limit }) => {
  const { skip, limit: lim, page: p } = paginate(page, limit);
  const dr = dateRange(startDate, endDate);
  const match = { company: toObjId(companyId), isDeleted: { $ne: true } };
  if (dr) match.issueDate = dr;

  const total = await Invoice.countDocuments(match);

  const data = await Invoice.aggregate([
    { $match: match },
    { $sort: { issueDate: -1 } },
    { $skip: skip },
    { $limit: lim },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'prod',
      },
    },
    { $unwind: '$prod' },
    {
      $group: {
        _id: '$_id',
        invoiceNumber: { $first: '$invoiceNumber' },
        issueDate: { $first: '$issueDate' },
        totalAmount: { $first: '$totalAmount' },
        status: { $first: '$status' },
        totalCost: { $sum: { $multiply: ['$items.quantity', '$prod.costPrice'] } },
        totalSelling: { $sum: '$items.lineTotal' },
      },
    },
    {
      $project: {
        _id: 0,
        invoiceId: '$_id',
        invoiceNumber: 1,
        issueDate: 1,
        revenue: { $round: ['$totalAmount', 2] },
        cost: { $round: ['$totalCost', 2] },
        profit: { $round: [{ $subtract: ['$totalAmount', '$totalCost'] }, 2] },
        margin: {
          $round: [
            {
              $cond: [
                { $eq: ['$totalAmount', 0] },
                0,
                { $multiply: [{ $divide: [{ $subtract: ['$totalAmount', '$totalCost'] }, '$totalAmount'] }, 100] },
              ],
            },
            2,
          ],
        },
        status: 1,
      },
    },
    { $sort: { issueDate: -1 } },
  ]);

  return { data, total, page: p, limit: lim };
};

// ═══════════════════════════════════════════════════════════
//  B) INVENTORY REPORTS
// ═══════════════════════════════════════════════════════════

/**
 * Current stock levels with product info
 */
exports.getStockLevels = async ({ companyId, threshold }) => {
  const thr = threshold !== undefined ? Number(threshold) : null;
  const baseMatch = { company: toObjId(companyId) };
  if (thr !== null) baseMatch.quantity = { $lte: thr };

  return Stock.find(baseMatch)
    .populate('product', 'name productCode costPrice sellingPrice reorderLevel')
    .lean();
};

/**
 * Stock movement history — IN (purchase received) / OUT (invoices sold)
 */
exports.getStockMovementHistory = async ({ companyId, startDate, endDate, productId }) => {
  const dr = dateRange(startDate, endDate);
  const compObjId = toObjId(companyId);

  // OUT movements — from invoices
  const invoiceMatch = { company: compObjId, isDeleted: { $ne: true } };
  if (dr) invoiceMatch.issueDate = dr;

  const outMovements = await Invoice.aggregate([
    { $match: invoiceMatch },
    { $unwind: '$items' },
    ...(productId
      ? [{ $match: { 'items.product': new mongoose.Types.ObjectId(productId) } }]
      : []),
    {
      $group: {
        _id: {
          year: { $year: '$issueDate' },
          month: { $month: '$issueDate' },
        },
        totalOut: { $sum: '$items.quantity' },
        outValue: { $sum: '$items.lineTotal' },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  // IN movements — from purchase orders that have been received
  const poMatch = { company: compObjId, isDeleted: { $ne: true }, status: { $in: ['received', 'partially_received'] } };
  if (dr) poMatch.orderDate = dr;

  const inMovements = await PurchaseOrder.aggregate([
    { $match: poMatch },
    { $unwind: '$items' },
    ...(productId
      ? [{ $match: { 'items.product': new mongoose.Types.ObjectId(productId) } }]
      : []),
    {
      $group: {
        _id: {
          year: { $year: '$orderDate' },
          month: { $month: '$orderDate' },
        },
        totalIn: { $sum: '$items.receivedQuantity' },
        inValue: { $sum: '$items.lineTotal' },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  // Merge into timeline
  const timeMap = new Map();

  inMovements.forEach((m) => {
    const key = `${m._id.year}-${String(m._id.month).padStart(2, '0')}`;
    const existing = timeMap.get(key) || { period: key, in: 0, out: 0, inValue: 0, outValue: 0 };
    existing.in += m.totalIn;
    existing.inValue += m.inValue;
    timeMap.set(key, existing);
  });

  outMovements.forEach((m) => {
    const key = `${m._id.year}-${String(m._id.month).padStart(2, '0')}`;
    const existing = timeMap.get(key) || { period: key, in: 0, out: 0, inValue: 0, outValue: 0 };
    existing.out += m.totalOut;
    existing.outValue += m.outValue;
    timeMap.set(key, existing);
  });

  const timeline = Array.from(timeMap.values()).sort((a, b) => a.period.localeCompare(b.period));

  return timeline;
};

/**
 * Dead stock — products with zero sales in period
 */
exports.getDeadStock = async ({ companyId, daysSinceLastSale = 90 }) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysSinceLastSale);
  const compObjId = toObjId(companyId);

  const activelySold = await Transaction.distinct('items.product', {
    company: compObjId,
    type: 'invoice',
    date: { $gte: cutoff },
  });

  return Stock.find({
    company: compObjId,
    quantity: { $gt: 0 },
    product: { $nin: activelySold },
  })
    .populate('product', 'name productCode sellingPrice costPrice')
    .lean();
};

/**
 * Most used / sold products
 */
exports.getMostUsedProducts = async ({ companyId, startDate, endDate, limit = 10 }) => {
  return exports.getTopProducts({ companyId, startDate, endDate, page: 1, limit });
};

// ═══════════════════════════════════════════════════════════
//  C) CUSTOMER REPORTS
// ═══════════════════════════════════════════════════════════

/**
 * Customer account statement — accounting-accurate ledger
 */
exports.getCustomerStatement = async ({ companyId, customerId, startDate, endDate }) => {
  const compObjId = toObjId(companyId);
  const customer = await Customer.findOne({ _id: customerId, company: compObjId, isDeleted: { $ne: true } }).lean();
  if (!customer) return null;

  const dr = dateRange(startDate, endDate);

  // Get invoices with full item details
  const invoiceMatch = { customer: new mongoose.Types.ObjectId(customerId), company: compObjId, isDeleted: { $ne: true } };
  if (dr) invoiceMatch.issueDate = dr;
  const invoices = await Invoice.find(invoiceMatch)
    .populate({ path: 'items.product', select: 'name productCode unit' })
    .select('invoiceNumber issueDate dueDate totalAmount subtotal discountAmount taxAmount amountPaid balanceDue status items notes')
    .sort('issueDate')
    .lean();

  // Get payments linked to invoices
  const paymentMatch = { customer: new mongoose.Types.ObjectId(customerId), company: compObjId };
  if (dr) paymentMatch.date = dr;
  const payments = await Payment.find(paymentMatch)
    .populate({ path: 'invoice', select: 'invoiceNumber' })
    .select('amount method date status invoice notes')
    .sort('date')
    .lean();

  // Get returns with product and invoice details
  const returnMatch = {
    customer: new mongoose.Types.ObjectId(customerId),
    company: compObjId,
    isDeleted: { $ne: true },
    status: { $ne: 'cancelled' },
  };
  if (dr) returnMatch.date = dr;
  const returns = await Return.find(returnMatch)
    .populate({ path: 'product', select: 'name productCode unit' })
    .populate({ path: 'invoice', select: 'invoiceNumber' })
    .select('refundAmount date invoice product quantity reason status')
    .sort('date')
    .lean();

  // Calculate opening balance (transactions before startDate if filter applied)
  let openingBalance = 0;
  if (dr && dr.$gte) {
    const beforeStart = { customer: new mongoose.Types.ObjectId(customerId), company: compObjId };
    const [priorInvoices, priorPayments, priorReturns] = await Promise.all([
      Invoice.find({ ...beforeStart, issueDate: { $lt: dr.$gte }, isDeleted: { $ne: true } }).select('totalAmount').lean(),
      Payment.find({ ...beforeStart, date: { $lt: dr.$gte }, status: { $ne: 'Failed' } }).select('amount').lean(),
      Return.find({ ...beforeStart, date: { $lt: dr.$gte }, isDeleted: { $ne: true }, status: { $ne: 'cancelled' } }).select('refundAmount').lean(),
    ]);
    const priorDebit = priorInvoices.reduce((s, i) => s + i.totalAmount, 0);
    const priorCredit = priorPayments.reduce((s, p) => s + p.amount, 0) + priorReturns.reduce((s, r) => s + r.refundAmount, 0);
    openingBalance = +(priorDebit - priorCredit).toFixed(2);
  }

  // Build accounting ledger entries
  const entries = [];

  invoices.forEach((inv) => {
    const invRef = `INV-${String(inv.invoiceNumber).padStart(6, '0')}`;
    entries.push({
      date: inv.issueDate,
      type: 'Sales Invoice',
      typeKey: 'invoice',
      reference: invRef,
      referenceId: inv._id,
      description: `Sales Invoice ${invRef}${inv.notes ? ` — ${inv.notes}` : ''}`,
      invoiceNumber: invRef,
      paymentRef: null,
      // Invoice = DEBIT (customer owes)
      debit: inv.totalAmount,
      credit: 0,
      status: inv.status,
      subtotal: inv.subtotal,
      discountAmount: inv.discountAmount || 0,
      taxAmount: inv.taxAmount || 0,
      items: (inv.items || []).map((item) => ({
        productName: item.product?.name || 'Unknown',
        productCode: item.product?.productCode || '',
        unit: item.product?.unit || '',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        taxRate: item.taxRate || 0,
      })),
    });
  });

  payments.forEach((pay) => {
    if (pay.status === 'Failed') return;
    const payRef = `PAY-${String(pay._id).slice(-8).toUpperCase()}`;
    const invRef = pay.invoice ? `INV-${String(pay.invoice.invoiceNumber).padStart(6, '0')}` : null;
    entries.push({
      date: pay.date,
      type: 'Payment Received',
      typeKey: 'payment',
      reference: payRef,
      referenceId: pay._id,
      description: `Payment received via ${pay.method || 'Cash'}${invRef ? ` for ${invRef}` : ''}${pay.notes ? ` — ${pay.notes}` : ''}`,
      invoiceNumber: invRef,
      paymentRef: payRef,
      method: pay.method || 'Cash',
      // Payment = CREDIT (customer pays debt)
      debit: 0,
      credit: pay.amount,
      status: pay.status,
      items: [],
    });
  });

  returns.forEach((ret) => {
    const retRef = `RET-${String(ret._id).slice(-8).toUpperCase()}`;
    const invRef = ret.invoice ? `INV-${String(ret.invoice.invoiceNumber).padStart(6, '0')}` : null;
    const productName = ret.product?.name || 'Unknown';
    entries.push({
      date: ret.date,
      type: 'Sales Return',
      typeKey: 'return',
      reference: retRef,
      referenceId: ret._id,
      description: `Sales return — ${productName} (Qty: ${ret.quantity})${invRef ? ` from ${invRef}` : ''}${ret.reason ? ` — Reason: ${ret.reason}` : ''}`,
      invoiceNumber: invRef,
      paymentRef: null,
      // Return = CREDIT (reduces customer's debt)
      debit: 0,
      credit: ret.refundAmount,
      status: ret.status,
      items: [{
        productName,
        productCode: ret.product?.productCode || '',
        unit: ret.product?.unit || '',
        quantity: ret.quantity,
        unitPrice: ret.quantity > 0 ? +(ret.refundAmount / ret.quantity).toFixed(2) : 0,
        lineTotal: ret.refundAmount,
        taxRate: 0,
      }],
    });
  });

  // Sort chronologically; within same timestamp, invoices before payments before returns
  const typeOrder = { invoice: 1, payment: 2, return: 3 };
  entries.sort((a, b) => {
    const dateDiff = new Date(a.date) - new Date(b.date);
    if (dateDiff !== 0) return dateDiff;
    return (typeOrder[a.typeKey] || 9) - (typeOrder[b.typeKey] || 9);
  });

  // Compute running balance starting from opening balance
  let runningBalance = openingBalance;
  entries.forEach((entry) => {
    runningBalance += entry.debit - entry.credit;
    entry.balance = +runningBalance.toFixed(2);
    entry.debit = +entry.debit.toFixed(2);
    entry.credit = +entry.credit.toFixed(2);
  });

  const totalDebit = +entries.reduce((s, e) => s + e.debit, 0).toFixed(2);
  const totalCredit = +entries.reduce((s, e) => s + e.credit, 0).toFixed(2);
  const closingBalance = +(openingBalance + totalDebit - totalCredit).toFixed(2);

  return {
    customer: {
      id: customer._id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address || null,
    },
    period: {
      startDate: dr?.$gte || null,
      endDate: dr?.$lte || null,
      generatedAt: new Date(),
    },
    summary: {
      openingBalance: +openingBalance.toFixed(2),
      totalDebit,
      totalCredit,
      closingBalance,
      outstandingBalance: +(customer.outstandingBalance || 0).toFixed(2),
      totalInvoices: invoices.length,
      totalPayments: payments.filter(p => p.status !== 'Failed').length,
      totalReturns: returns.length,
    },
    entries,
  };
};

/**
 * Customer debt report — all customers with outstanding balances
 */
exports.getCustomerDebt = async ({ companyId }) => {
  const data = await Customer.find({ company: toObjId(companyId), isDeleted: { $ne: true }, outstandingBalance: { $gt: 0 } })
    .select('name phone email outstandingBalance')
    .sort('-outstandingBalance')
    .lean();

  const totalDebt = data.reduce((s, c) => s + c.outstandingBalance, 0);

  return {
    data,
    summary: {
      totalCustomersWithDebt: data.length,
      totalDebt: +totalDebt.toFixed(2),
    },
  };
};

// ═══════════════════════════════════════════════════════════
//  D) SUPPLIER REPORTS
// ═══════════════════════════════════════════════════════════

/**
 * Supplier account statement
 */
exports.getSupplierStatement = async ({ companyId, supplierId, startDate, endDate }) => {
  const compObjId = toObjId(companyId);
  const supplier = await Supplier.findOne({ _id: supplierId, company: compObjId, isDeleted: { $ne: true } }).lean();
  if (!supplier) return null;

  const dr = dateRange(startDate, endDate);

  // POs for this supplier
  const poMatch = {
    supplier: new mongoose.Types.ObjectId(supplierId),
    isDeleted: { $ne: true },
  };
  if (dr) poMatch.orderDate = dr;

  const purchaseOrders = await PurchaseOrder.find(poMatch)
    .select('orderNumber orderDate totalAmount status paymentStatus')
    .sort('orderDate')
    .lean();

  // Payments to supplier
  const payMatch = { supplier: new mongoose.Types.ObjectId(supplierId) };
  if (dr) payMatch.date = dr;

  const supplierPayments = await SupplierPayment.find(payMatch)
    .select('amount method date status purchaseOrder notes')
    .sort('date')
    .lean();

  // Build statement entries
  const entries = [];

  purchaseOrders.forEach((po) => {
    entries.push({
      date: po.orderDate,
      type: 'purchase_order',
      reference: `PO-${String(po.orderNumber).padStart(6, '0')}`,
      referenceId: po._id,
      description: `Purchase Order ${po.orderNumber}`,
      debit: po.totalAmount,
      credit: 0,
      status: po.status,
    });
  });

  supplierPayments.forEach((pay) => {
    if (pay.status !== 'Failed') {
      entries.push({
        date: pay.date,
        type: 'payment',
        reference: `SPAY-${String(pay._id).slice(-6)}`,
        referenceId: pay._id,
        description: `Payment via ${pay.method || 'Cash'}`,
        debit: 0,
        credit: pay.amount,
        status: pay.status,
      });
    }
  });

  // Sort chronologically
  entries.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Running balance
  let runningBalance = 0;
  entries.forEach((entry) => {
    runningBalance += entry.debit - entry.credit;
    entry.balance = +runningBalance.toFixed(2);
    entry.debit = +entry.debit.toFixed(2);
    entry.credit = +entry.credit.toFixed(2);
  });

  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);

  return {
    supplier: {
      id: supplier._id,
      name: supplier.name,
      email: supplier.email,
      phone: supplier.phone,
      contactPerson: supplier.contactPerson,
    },
    summary: {
      totalDebit: +totalDebit.toFixed(2),
      totalCredit: +totalCredit.toFixed(2),
      balance: +(totalDebit - totalCredit).toFixed(2),
      totalPOs: purchaseOrders.length,
      totalPayments: supplierPayments.length,
    },
    entries,
  };
};

/**
 * Supplier outstanding balances
 */
exports.getSupplierOutstandingBalances = async ({ companyId }) => {
  const data = await PurchaseOrder.aggregate([
    { $match: { company: toObjId(companyId), isDeleted: { $ne: true }, balanceDue: { $gt: 0 } } },
    {
      $group: {
        _id: '$supplier',
        totalOrdered: { $sum: '$totalAmount' },
        totalPaid: { $sum: '$amountPaid' },
        totalDue: { $sum: '$balanceDue' },
        poCount: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'suppliers',
        localField: '_id',
        foreignField: '_id',
        as: 'supplier',
      },
    },
    { $unwind: '$supplier' },
    {
      $project: {
        _id: 0,
        supplierId: '$_id',
        name: '$supplier.name',
        phone: '$supplier.phone',
        totalOrdered: { $round: ['$totalOrdered', 2] },
        totalPaid: { $round: ['$totalPaid', 2] },
        totalDue: { $round: ['$totalDue', 2] },
        poCount: 1,
      },
    },
    { $sort: { totalDue: -1 } },
  ]);

  const totalOwed = data.reduce((s, d) => s + d.totalDue, 0);

  return {
    data,
    summary: {
      totalSuppliersWithBalance: data.length,
      totalOwed: +totalOwed.toFixed(2),
    },
  };
};

// ═══════════════════════════════════════════════════════════
//  E) FINANCIAL SUMMARY
// ═══════════════════════════════════════════════════════════

exports.getFinancialSummary = async ({ companyId, startDate, endDate }) => {
  const compObjId = toObjId(companyId);
  const dr = dateRange(startDate, endDate);

  // Revenue from invoices
  const invoiceMatch = { company: compObjId, isDeleted: { $ne: true } };
  if (dr) invoiceMatch.issueDate = dr;

  const [revData] = await Invoice.aggregate([
    { $match: invoiceMatch },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$totalAmount' },
        totalReceived: { $sum: '$amountPaid' },
        totalReceivable: { $sum: '$balanceDue' },
        invoiceCount: { $sum: 1 },
      },
    },
  ]);

  // Expenses
  const expenseMatch = { company: compObjId, isDeleted: { $ne: true }, status: 'paid' };
  if (dr) expenseMatch.date = dr;

  const [expData] = await Expense.aggregate([
    { $match: expenseMatch },
    {
      $group: {
        _id: null,
        totalExpenses: { $sum: '$amount' },
        expenseCount: { $sum: 1 },
      },
    },
  ]);

  // Cost of goods sold
  const costData = await Invoice.aggregate([
    { $match: invoiceMatch },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'prod',
      },
    },
    { $unwind: '$prod' },
    {
      $group: {
        _id: null,
        cogs: { $sum: { $multiply: ['$items.quantity', '$prod.costPrice'] } },
      },
    },
  ]);

  // Purchases total
  const poMatch = { company: compObjId, isDeleted: { $ne: true } };
  if (dr) poMatch.orderDate = dr;

  const [purchaseData] = await PurchaseOrder.aggregate([
    { $match: poMatch },
    {
      $group: {
        _id: null,
        totalPurchases: { $sum: '$totalAmount' },
        totalPurchasePaid: { $sum: '$amountPaid' },
        totalPurchaseDue: { $sum: '$balanceDue' },
      },
    },
  ]);

  // Expense by category
  const expenseByCategory = await Expense.aggregate([
    { $match: expenseMatch },
    {
      $group: {
        _id: '$category',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ]);

  // Monthly PnL
  const monthlyRevenue = await Invoice.aggregate([
    { $match: invoiceMatch },
    {
      $group: {
        _id: { year: { $year: '$issueDate' }, month: { $month: '$issueDate' } },
        revenue: { $sum: '$totalAmount' },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  const monthlyExpenses = await Expense.aggregate([
    { $match: expenseMatch },
    {
      $group: {
        _id: { year: { $year: '$date' }, month: { $month: '$date' } },
        expenses: { $sum: '$amount' },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  // Merge monthly data
  const monthMap = new Map();
  monthlyRevenue.forEach((m) => {
    const key = `${m._id.year}-${String(m._id.month).padStart(2, '0')}`;
    monthMap.set(key, { period: key, revenue: +m.revenue.toFixed(2), expenses: 0 });
  });
  monthlyExpenses.forEach((m) => {
    const key = `${m._id.year}-${String(m._id.month).padStart(2, '0')}`;
    const existing = monthMap.get(key) || { period: key, revenue: 0, expenses: 0 };
    existing.expenses = +m.expenses.toFixed(2);
    monthMap.set(key, existing);
  });

  const monthlyPnL = Array.from(monthMap.values())
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((m) => ({ ...m, profit: +(m.revenue - m.expenses).toFixed(2) }));

  const totalRevenue = revData?.totalRevenue || 0;
  const totalExpenses = (expData?.totalExpenses || 0);
  const cogs = costData[0]?.cogs || 0;
  const grossProfit = totalRevenue - cogs;
  const netProfit = totalRevenue - totalExpenses - cogs;

  return {
    summary: {
      totalRevenue: +totalRevenue.toFixed(2),
      totalReceived: +(revData?.totalReceived || 0).toFixed(2),
      totalReceivable: +(revData?.totalReceivable || 0).toFixed(2),
      totalExpenses: +totalExpenses.toFixed(2),
      cogs: +cogs.toFixed(2),
      grossProfit: +grossProfit.toFixed(2),
      netProfit: +netProfit.toFixed(2),
      profitMargin: totalRevenue > 0 ? +((netProfit / totalRevenue) * 100).toFixed(2) : 0,
      totalPurchases: +(purchaseData?.totalPurchases || 0).toFixed(2),
      totalPurchasePaid: +(purchaseData?.totalPurchasePaid || 0).toFixed(2),
      totalPurchaseDue: +(purchaseData?.totalPurchaseDue || 0).toFixed(2),
      invoiceCount: revData?.invoiceCount || 0,
      expenseCount: expData?.expenseCount || 0,
    },
    expenseByCategory,
    monthlyPnL,
  };
};
