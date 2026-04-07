/**
 * reportService.js
 * ─────────────────────────────────────────────
 * Centralised aggregation / query logic for
 * every report the ERP exposes.
 *
 * Each function returns plain objects (no res/req)
 * so the controller layer can compose responses.
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

// ═══════════════════════════════════════════════════════════
//  A) SALES REPORTS
// ═══════════════════════════════════════════════════════════

/**
 * Sales summary — totals, averages, period breakdown
 */
exports.getSalesSummary = async ({ startDate, endDate, period = 'monthly' }) => {
  const dr = dateRange(startDate, endDate);
  const match = { isDeleted: { $ne: true } };
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
exports.getRevenueTrend = async ({ startDate, endDate, granularity = 'monthly' }) => {
  const dr = dateRange(startDate, endDate);
  const match = { isDeleted: { $ne: true } };
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
exports.getTopSellingProducts = async ({ startDate, endDate, limit = 10, sortBy = 'revenue' }) => {
  const dr = dateRange(startDate, endDate);
  const match = { isDeleted: { $ne: true } };
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
    { $sort: sortBy === 'quantity' ? { totalQuantity: -1 } : { totalRevenue: -1 } },
    { $limit: Math.min(Number(limit) || 10, 100) },
  ]);

  return data;
};

/**
 * Sales by customer
 */
exports.getSalesByCustomer = async ({ startDate, endDate, limit = 20 }) => {
  const dr = dateRange(startDate, endDate);
  const match = { isDeleted: { $ne: true } };
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
    { $limit: Math.min(Number(limit) || 20, 100) },
  ]);

  return data;
};

/**
 * Profit per sale — per-invoice profit calculation
 */
exports.getProfitPerSale = async ({ startDate, endDate, page, limit }) => {
  const dr = dateRange(startDate, endDate);
  const match = { isDeleted: { $ne: true } };
  if (dr) match.issueDate = dr;

  const pag = paginate(page, limit);

  const total = await Invoice.countDocuments(match);

  const data = await Invoice.aggregate([
    { $match: match },
    { $sort: { issueDate: -1 } },
    { $skip: pag.skip },
    { $limit: pag.limit },
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

  return { data, total, page: pag.page, limit: pag.limit };
};

// ═══════════════════════════════════════════════════════════
//  B) INVENTORY REPORTS
// ═══════════════════════════════════════════════════════════

/**
 * Current stock levels with product info
 */
exports.getCurrentStockLevels = async ({ page, limit, lowStockOnly = false }) => {
  const pag = paginate(page, limit);

  const pipeline = [
    {
      $lookup: {
        from: 'products',
        localField: 'product',
        foreignField: '_id',
        as: 'productInfo',
      },
    },
    { $unwind: '$productInfo' },
    {
      $lookup: {
        from: 'categories',
        localField: 'productInfo.category',
        foreignField: '_id',
        as: 'cat',
      },
    },
    {
      $project: {
        _id: 0,
        stockId: '$_id',
        productId: '$product',
        productName: '$productInfo.name',
        productCode: '$productInfo.productCode',
        category: { $ifNull: [{ $arrayElemAt: ['$cat.name', 0] }, 'Uncategorized'] },
        quantity: 1,
        reorderLevel: '$productInfo.reorderLevel',
        costPrice: '$productInfo.costPrice',
        sellingPrice: '$productInfo.sellingPrice',
        stockValue: { $round: [{ $multiply: ['$quantity', '$productInfo.costPrice'] }, 2] },
        isLowStock: { $lte: ['$quantity', '$productInfo.reorderLevel'] },
        expiryDate: 1,
        lastStockUpdate: 1,
      },
    },
  ];

  if (lowStockOnly) {
    pipeline.push({ $match: { isLowStock: true } });
  }

  // Count total
  const countPipeline = [...pipeline, { $count: 'total' }];
  const [countResult] = await Stock.aggregate(countPipeline);
  const total = countResult?.total || 0;

  // Summary stats
  const [summaryResult] = await Stock.aggregate([
    ...pipeline,
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        totalStockValue: { $sum: '$stockValue' },
        lowStockCount: { $sum: { $cond: ['$isLowStock', 1, 0] } },
        outOfStockCount: { $sum: { $cond: [{ $eq: ['$quantity', 0] }, 1, 0] } },
        avgQuantity: { $avg: '$quantity' },
      },
    },
  ]);

  pipeline.push({ $sort: { quantity: 1 } });
  pipeline.push({ $skip: pag.skip });
  pipeline.push({ $limit: pag.limit });

  const data = await Stock.aggregate(pipeline);

  return {
    data,
    summary: {
      totalProducts: summaryResult?.totalProducts || 0,
      totalStockValue: +(summaryResult?.totalStockValue || 0).toFixed(2),
      lowStockCount: summaryResult?.lowStockCount || 0,
      outOfStockCount: summaryResult?.outOfStockCount || 0,
      avgQuantity: +(summaryResult?.avgQuantity || 0).toFixed(0),
    },
    total,
    page: pag.page,
    limit: pag.limit,
  };
};

/**
 * Stock movement history — IN (purchase received) / OUT (invoices sold)
 */
exports.getStockMovementHistory = async ({ startDate, endDate, productId }) => {
  const dr = dateRange(startDate, endDate);

  // OUT movements — from invoices
  const invoiceMatch = { isDeleted: { $ne: true } };
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
  const poMatch = { isDeleted: { $ne: true }, status: { $in: ['received', 'partially_received'] } };
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
exports.getDeadStock = async ({ startDate, endDate, limit = 50 }) => {
  const dr = dateRange(startDate, endDate);
  const match = { isDeleted: { $ne: true } };
  if (dr) match.issueDate = dr;

  // Get all product IDs that HAVE sales
  const soldProducts = await Invoice.aggregate([
    { $match: match },
    { $unwind: '$items' },
    { $group: { _id: '$items.product' } },
  ]);
  const soldIds = soldProducts.map((p) => p._id);

  // Get stock items whose product NOT in sold list
  const deadStock = await Stock.find({ product: { $nin: soldIds }, quantity: { $gt: 0 } })
    .populate('product', 'name productCode costPrice sellingPrice category')
    .limit(Number(limit) || 50)
    .lean();

  return deadStock.map((s) => ({
    productId: s.product?._id,
    productName: s.product?.name || 'Unknown',
    productCode: s.product?.productCode || 'N/A',
    quantity: s.quantity,
    stockValue: +((s.quantity * (s.product?.costPrice || 0)).toFixed(2)),
    lastStockUpdate: s.lastStockUpdate,
  }));
};

/**
 * Most used / sold products
 */
exports.getMostUsedProducts = async ({ startDate, endDate, limit = 10 }) => {
  // Re-use top selling
  return exports.getTopSellingProducts({ startDate, endDate, limit, sortBy: 'quantity' });
};

// ═══════════════════════════════════════════════════════════
//  C) CUSTOMER REPORTS
// ═══════════════════════════════════════════════════════════

/**
 * Customer account statement — bank-statement style
 */
exports.getCustomerStatement = async (customerId, { startDate, endDate }) => {
  const customer = await Customer.findById(customerId).lean();
  if (!customer) return null;

  const dr = dateRange(startDate, endDate);

  // Get invoices
  const invoiceMatch = { customer: new mongoose.Types.ObjectId(customerId), isDeleted: { $ne: true } };
  if (dr) invoiceMatch.issueDate = dr;

  const invoices = await Invoice.find(invoiceMatch)
    .select('invoiceNumber issueDate totalAmount status')
    .sort('issueDate')
    .lean();

  // Get payments
  const paymentMatch = { customer: new mongoose.Types.ObjectId(customerId) };
  if (dr) paymentMatch.date = dr;

  const payments = await Payment.find(paymentMatch)
    .select('amount method date status invoice')
    .sort('date')
    .lean();

  // Get returns
  const returnMatch = {
    customer: new mongoose.Types.ObjectId(customerId),
    isDeleted: false,
    status: { $ne: 'cancelled' },
  };
  if (dr) returnMatch.date = dr;

  const returns = await Return.find(returnMatch)
    .select('refundAmount date invoice quantity')
    .sort('date')
    .lean();

  // Build statement entries
  const entries = [];

  invoices.forEach((inv) => {
    entries.push({
      date: inv.issueDate,
      type: 'invoice',
      reference: `INV-${String(inv.invoiceNumber).padStart(6, '0')}`,
      referenceId: inv._id,
      description: `Invoice ${inv.invoiceNumber}`,
      debit: inv.totalAmount,
      credit: 0,
      status: inv.status,
    });
  });

  payments.forEach((pay) => {
    if (pay.status !== 'Failed') {
      entries.push({
        date: pay.date,
        type: 'payment',
        reference: pay.invoice ? `PAY-${String(pay._id).slice(-6)}` : `PAY-${String(pay._id).slice(-6)}`,
        referenceId: pay._id,
        description: `Payment via ${pay.method || 'Cash'}`,
        debit: 0,
        credit: pay.amount,
        status: pay.status,
      });
    }
  });

  returns.forEach((ret) => {
    entries.push({
      date: ret.date,
      type: 'return',
      reference: `RET-${String(ret._id).slice(-6)}`,
      referenceId: ret._id,
      description: `Return/Refund`,
      debit: 0,
      credit: ret.refundAmount,
      status: 'processed',
    });
  });

  // Sort chronologically
  entries.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Calculate running balance
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
    customer: {
      id: customer._id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address || null,
    },
    summary: {
      totalDebit: +totalDebit.toFixed(2),
      totalCredit: +totalCredit.toFixed(2),
      balance: +(totalDebit - totalCredit).toFixed(2),
      totalInvoices: invoices.length,
      totalPayments: payments.length,
      totalReturns: returns.length,
    },
    entries,
  };
};

/**
 * Top customers by purchases
 */
exports.getTopCustomers = async ({ startDate, endDate, limit = 10 }) => {
  return exports.getSalesByCustomer({ startDate, endDate, limit });
};

/**
 * Customer debt report — all customers with outstanding balances
 */
exports.getCustomerDebtReport = async () => {
  const data = await Customer.aggregate([
    {
      $lookup: {
        from: 'invoices',
        localField: '_id',
        foreignField: 'customer',
        as: 'invoices',
      },
    },
    { $unwind: { path: '$invoices', preserveNullAndEmptyArrays: true } },
    { $match: { 'invoices.isDeleted': { $ne: true } } },
    {
      $group: {
        _id: '$_id',
        name: { $first: '$name' },
        email: { $first: '$email' },
        phone: { $first: '$phone' },
        totalPurchases: { $sum: '$invoices.totalAmount' },
        totalPaid: { $sum: '$invoices.amountPaid' },
        totalDue: { $sum: '$invoices.balanceDue' },
        invoiceCount: { $sum: 1 },
        overdueCount: {
          $sum: {
            $cond: [{ $eq: ['$invoices.status', 'overdue'] }, 1, 0],
          },
        },
      },
    },
    { $match: { totalDue: { $gt: 0 } } },
    {
      $project: {
        _id: 0,
        customerId: '$_id',
        name: 1,
        email: 1,
        phone: 1,
        totalPurchases: { $round: ['$totalPurchases', 2] },
        totalPaid: { $round: ['$totalPaid', 2] },
        totalDue: { $round: ['$totalDue', 2] },
        invoiceCount: 1,
        overdueCount: 1,
      },
    },
    { $sort: { totalDue: -1 } },
  ]);

  const totalDebt = data.reduce((s, c) => s + c.totalDue, 0);

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
exports.getSupplierStatement = async (supplierId, { startDate, endDate }) => {
  const supplier = await Supplier.findById(supplierId).lean();
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
exports.getSupplierOutstandingBalances = async () => {
  const data = await PurchaseOrder.aggregate([
    { $match: { isDeleted: { $ne: true }, balanceDue: { $gt: 0 } } },
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

exports.getFinancialSummary = async ({ startDate, endDate }) => {
  const dr = dateRange(startDate, endDate);

  // Revenue from invoices
  const invoiceMatch = { isDeleted: { $ne: true } };
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
  const expenseMatch = { isDeleted: false, status: 'paid' };
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
  const poMatch = { isDeleted: { $ne: true } };
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
