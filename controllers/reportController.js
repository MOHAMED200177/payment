const mongoose = require('mongoose');
const Invoice = require('../models/invoice');
const Return = require('../models/return');
const Product = require('../models/product');
const Customer = require('../models/customer');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

// ============================================================
// Helper - Build Date Filter
// ============================================================
const buildDateFilter = (startDate, endDate, year, month) => {
  // ✅ لو فيه startDate و endDate
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError('Invalid date format', 400);
    }

    if (start > end) {
      throw new AppError('startDate must be before endDate', 400);
    }

    return {
      createdAt: { $gte: start, $lte: end },
    };
  }

  // ✅ لو فيه year و month
  if (year && month) {
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59);
    return {
      createdAt: { $gte: startOfMonth, $lte: endOfMonth },
    };
  }

  // ✅ لو فيه year بس
  if (year) {
    return {
      createdAt: {
        $gte: new Date(`${year}-01-01`),
        $lte: new Date(`${year}-12-31T23:59:59`),
      },
    };
  }

  // ✅ لو مفيش filters - رجع empty object
  return {};
};

// ============================================================
// Comprehensive Financial Report
// ============================================================
exports.comprehensiveFinancialReport = catchAsync(async (req, res, next) => {
  const { year, month, startDate, endDate } = req.body;

  // ✅ Build date filter مرة واحدة
  let dateFilter;
  try {
    dateFilter = buildDateFilter(startDate, endDate, year, month);
  } catch (error) {
    return next(error);
  }

  // ─────────────────────────────────────
  // Sales Statistics
  // ─────────────────────────────────────
  const salesStats = await Invoice.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: null,
        totalInvoices: { $sum: 1 },
        totalRevenue: { $sum: '$subtotal' },
        totalWithTax: { $sum: '$totalAmount' },
        totalPayments: { $sum: '$amountPaid' },
        totalOutstanding: { $sum: '$balanceDue' },
        totalDiscounts: { $sum: '$discountAmount' },
        totalTax: { $sum: '$taxAmount' },
        averageInvoiceValue: { $avg: '$totalAmount' },
      },
    },
  ]);

  // ─────────────────────────────────────
  // Return Statistics
  // ✅ بنستخدم createdAt مش date
  // ✅ ونبني الـ match صح
  // ─────────────────────────────────────
  const returnMatchFilter = dateFilter.createdAt
    ? { createdAt: dateFilter.createdAt, isDeleted: false }
    : { isDeleted: false };

  const returnStats = await Return.aggregate([
    { $match: returnMatchFilter },
    {
      $group: {
        _id: null,
        totalReturns: { $sum: 1 },
        totalRefundAmount: { $sum: '$refundAmount' },
        totalReturnedItems: { $sum: '$quantity' },
      },
    },
  ]);

  // ─────────────────────────────────────
  // Net Sales
  // ─────────────────────────────────────
  const totalRevenue = salesStats[0]?.totalRevenue || 0;
  const totalRefunds = returnStats[0]?.totalRefundAmount || 0;
  const netSales = totalRevenue - totalRefunds;

  // ─────────────────────────────────────
  // Monthly Breakdown
  // ─────────────────────────────────────
  const monthlyBreakdown = await Invoice.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
        },
        revenue: { $sum: '$subtotal' },
        invoiceCount: { $sum: 1 },
        discounts: { $sum: '$discountAmount' },
        tax: { $sum: '$taxAmount' },
        payments: { $sum: '$amountPaid' },
        outstanding: { $sum: '$balanceDue' },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  // ─────────────────────────────────────
  // Monthly Returns
  // ✅ بنستخدم createdAt
  // ─────────────────────────────────────
  const monthlyReturns = await Return.aggregate([
    { $match: returnMatchFilter },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
        },
        refunds: { $sum: '$refundAmount' },
        returnCount: { $sum: 1 },
        returnedItems: { $sum: '$quantity' },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  // ─────────────────────────────────────
  // Profit Margin
  // ✅ مع حماية من division by zero
  // ─────────────────────────────────────
  const profitMargin =
    totalRevenue > 0
      ? ((netSales / totalRevenue) * 100).toFixed(2) + '%'
      : '0%';

  res.status(200).json({
    status: 'success',
    data: {
      summary: {
        totalInvoices: salesStats[0]?.totalInvoices || 0,
        totalRevenue: totalRevenue.toFixed(2),
        totalWithTax: (salesStats[0]?.totalWithTax || 0).toFixed(2),
        totalPayments: (salesStats[0]?.totalPayments || 0).toFixed(2),
        totalOutstanding: (salesStats[0]?.totalOutstanding || 0).toFixed(2),
        totalDiscounts: (salesStats[0]?.totalDiscounts || 0).toFixed(2),
        totalTax: (salesStats[0]?.totalTax || 0).toFixed(2),
        averageInvoiceValue: (salesStats[0]?.averageInvoiceValue || 0).toFixed(
          2
        ),
        totalReturns: returnStats[0]?.totalReturns || 0,
        totalRefundAmount: totalRefunds.toFixed(2),
        totalReturnedItems: returnStats[0]?.totalReturnedItems || 0,
        netSales: netSales.toFixed(2),
        profitMargin,
      },
      monthlyBreakdown,
      monthlyReturns,
    },
  });
});

// ============================================================
// Top Products Report
// ============================================================
exports.getTopProducts = catchAsync(async (req, res, next) => {
  const { startDate, endDate, limit = 10, sortBy = 'quantity' } = req.body;

  // ✅ Validate dates
  if (!startDate || !endDate) {
    return next(new AppError('startDate and endDate are required', 400));
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return next(new AppError('Invalid date format', 400));
  }

  if (start > end) {
    return next(new AppError('startDate must be before endDate', 400));
  }

  const dateFilter = {
    issueDate: { $gte: start, $lte: end },
  };

  // ✅ Validate limit
  const limitNum = Math.min(Math.max(Number(limit) || 10, 1), 100);

  const topProducts = await Invoice.aggregate([
    { $match: dateFilter },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        totalQuantitySold: { $sum: '$items.quantity' },
        totalRevenue: { $sum: '$items.lineTotal' },
        averagePrice: { $avg: '$items.unitPrice' },
        orderCount: { $sum: 1 },
      },
    },
    // ✅ Lookup Product
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'productInfo',
      },
    },
    { $unwind: '$productInfo' },
    // ✅ Lookup Category
    {
      $lookup: {
        from: 'categories',
        localField: 'productInfo.category',
        foreignField: '_id',
        as: 'categoryInfo',
      },
    },
    // ✅ Lookup Returns - بـ ObjectId مش String
    {
      $lookup: {
        from: 'returns',
        let: { productId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$product', '$$productId'] }, // ✅ ObjectId
              createdAt: { $gte: start, $lte: end }, // ✅ createdAt
              isDeleted: false,
              status: { $ne: 'cancelled' },
            },
          },
          {
            $group: {
              _id: null,
              totalReturns: { $sum: '$quantity' },
              refundAmount: { $sum: '$refundAmount' },
            },
          },
        ],
        as: 'returnInfo',
      },
    },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        productName: '$productInfo.name',
        productCode: '$productInfo.productCode',
        // ✅ Category Name مش ObjectId
        category: {
          $ifNull: [
            { $arrayElemAt: ['$categoryInfo.name', 0] },
            'Uncategorized',
          ],
        },
        totalQuantitySold: 1,
        totalRevenue: { $round: ['$totalRevenue', 2] },
        averagePrice: { $round: ['$averagePrice', 2] },
        orderCount: 1,
        returnedQuantity: {
          $ifNull: [{ $arrayElemAt: ['$returnInfo.totalReturns', 0] }, 0],
        },
        refundAmount: {
          $round: [
            { $ifNull: [{ $arrayElemAt: ['$returnInfo.refundAmount', 0] }, 0] },
            2,
          ],
        },
        netQuantitySold: {
          $subtract: [
            '$totalQuantitySold',
            { $ifNull: [{ $arrayElemAt: ['$returnInfo.totalReturns', 0] }, 0] },
          ],
        },
        netRevenue: {
          $round: [
            {
              $subtract: [
                '$totalRevenue',
                {
                  $ifNull: [
                    { $arrayElemAt: ['$returnInfo.refundAmount', 0] },
                    0,
                  ],
                },
              ],
            },
            2,
          ],
        },
        returnRate: {
          $round: [
            {
              $multiply: [
                {
                  $cond: [
                    { $eq: ['$totalQuantitySold', 0] },
                    0,
                    {
                      $divide: [
                        {
                          $ifNull: [
                            { $arrayElemAt: ['$returnInfo.totalReturns', 0] },
                            0,
                          ],
                        },
                        '$totalQuantitySold',
                      ],
                    },
                  ],
                },
                100,
              ],
            },
            2,
          ],
        },
      },
    },
    {
      $sort:
        sortBy === 'revenue' ? { netRevenue: -1 } : { netQuantitySold: -1 },
    },
    { $limit: limitNum },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      products: topProducts,
      summary: {
        totalProducts: topProducts.length,
        totalRevenue: topProducts
          .reduce((sum, p) => sum + p.netRevenue, 0)
          .toFixed(2),
        totalQuantity: topProducts.reduce(
          (sum, p) => sum + p.netQuantitySold,
          0
        ),
      },
    },
  });
});

// ============================================================
// Customer Analysis
// ============================================================
exports.customerAnalysis = catchAsync(async (req, res, next) => {
  const { startDate, endDate, limit = 10 } = req.body;

  // ✅ Validate dates
  if (!startDate || !endDate) {
    return next(new AppError('startDate and endDate are required', 400));
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return next(new AppError('Invalid date format', 400));
  }

  if (start > end) {
    return next(new AppError('startDate must be before endDate', 400));
  }

  // ✅ Validate limit
  const limitNum = Math.min(Math.max(Number(limit) || 10, 1), 100);

  const dateFilter = {
    createdAt: { $gte: start, $lte: end },
  };

  const customerStats = await Invoice.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: '$customer',
        totalPurchases: { $sum: '$totalAmount' },
        invoiceCount: { $sum: 1 },
        totalPaid: { $sum: '$amountPaid' },
        totalDue: { $sum: '$balanceDue' },
        averageOrderValue: { $avg: '$totalAmount' },
        lastPurchaseDate: { $max: '$createdAt' },
      },
    },
    // ✅ Lookup Customer
    {
      $lookup: {
        from: 'customers',
        localField: '_id',
        foreignField: '_id',
        as: 'customerInfo',
      },
    },
    { $unwind: '$customerInfo' },
    // ✅ Lookup Returns - بـ createdAt مش date
    {
      $lookup: {
        from: 'returns',
        let: { customerId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$customer', '$$customerId'] },
              createdAt: { $gte: start, $lte: end }, // ✅ createdAt
              isDeleted: false,
              status: { $ne: 'cancelled' },
            },
          },
          {
            $group: {
              _id: null,
              totalReturns: { $sum: 1 },
              refundAmount: { $sum: '$refundAmount' },
            },
          },
        ],
        as: 'returnInfo',
      },
    },
    {
      $project: {
        _id: 0,
        customerId: '$_id',
        customerName: '$customerInfo.name',
        email: '$customerInfo.email',
        phone: '$customerInfo.phone',
        totalPurchases: { $round: ['$totalPurchases', 2] },
        invoiceCount: 1,
        totalPaid: { $round: ['$totalPaid', 2] },
        totalDue: { $round: ['$totalDue', 2] },
        averageOrderValue: { $round: ['$averageOrderValue', 2] },
        lastPurchaseDate: 1,
        totalReturns: {
          $ifNull: [{ $arrayElemAt: ['$returnInfo.totalReturns', 0] }, 0],
        },
        totalRefunds: {
          $round: [
            {
              $ifNull: [{ $arrayElemAt: ['$returnInfo.refundAmount', 0] }, 0],
            },
            2,
          ],
        },
        netPurchases: {
          $round: [
            {
              $subtract: [
                '$totalPurchases',
                {
                  $ifNull: [
                    { $arrayElemAt: ['$returnInfo.refundAmount', 0] },
                    0,
                  ],
                },
              ],
            },
            2,
          ],
        },
        customerValue: {
          $round: [
            {
              $subtract: [
                '$totalPaid',
                {
                  $ifNull: [
                    { $arrayElemAt: ['$returnInfo.refundAmount', 0] },
                    0,
                  ],
                },
              ],
            },
            2,
          ],
        },
      },
    },
    { $sort: { netPurchases: -1 } },
    { $limit: limitNum },
  ]);

  // ✅ حماية من division by zero
  const totalRevenue = customerStats.reduce(
    (sum, c) => sum + c.netPurchases,
    0
  );

  const averageCustomerValue =
    customerStats.length > 0
      ? (totalRevenue / customerStats.length).toFixed(2)
      : '0.00';

  res.status(200).json({
    status: 'success',
    data: {
      customers: customerStats,
      summary: {
        totalCustomers: customerStats.length,
        totalRevenue: totalRevenue.toFixed(2),
        averageCustomerValue,
      },
    },
  });
});

// ============================================================
// Sales By Category
// ============================================================
exports.salesByCategory = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.body;

  // ✅ Validate dates
  if (!startDate || !endDate) {
    return next(new AppError('startDate and endDate are required', 400));
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return next(new AppError('Invalid date format', 400));
  }

  if (start > end) {
    return next(new AppError('startDate must be before endDate', 400));
  }

  const categoryAnalysis = await Invoice.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
      },
    },
    { $unwind: '$items' },
    // ✅ Lookup Product
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'productInfo',
      },
    },
    { $unwind: '$productInfo' },
    // ✅ Lookup Category - عشان نجيب الاسم
    {
      $lookup: {
        from: 'categories',
        localField: 'productInfo.category',
        foreignField: '_id',
        as: 'categoryInfo',
      },
    },
    { $unwind: { path: '$categoryInfo', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: '$productInfo.category',
        // ✅ نحتفظ باسم الـ category
        categoryName: { $first: '$categoryInfo.name' },
        totalRevenue: { $sum: '$items.lineTotal' },
        totalQuantity: { $sum: '$items.quantity' },
        productCount: { $addToSet: '$items.product' },
        orderCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        categoryId: '$_id',
        // ✅ name بدل ObjectId
        categoryName: { $ifNull: ['$categoryName', 'Uncategorized'] },
        totalRevenue: { $round: ['$totalRevenue', 2] },
        totalQuantity: 1,
        uniqueProducts: { $size: '$productCount' },
        orderCount: 1,
        averageOrderValue: {
          $round: [{ $divide: ['$totalRevenue', '$orderCount'] }, 2],
        },
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  // ✅ حماية من division by zero
  const totalRevenue = categoryAnalysis.reduce(
    (sum, cat) => sum + cat.totalRevenue,
    0
  );

  // ✅ إضافة النسبة المئوية
  const categoriesWithPercentage = categoryAnalysis.map((cat) => ({
    ...cat,
    percentage:
      totalRevenue > 0
        ? ((cat.totalRevenue / totalRevenue) * 100).toFixed(2) + '%'
        : '0%',
  }));

  res.status(200).json({
    status: 'success',
    data: {
      categories: categoriesWithPercentage,
      summary: {
        totalCategories: categoryAnalysis.length,
        totalRevenue: totalRevenue.toFixed(2),
      },
    },
  });
});
