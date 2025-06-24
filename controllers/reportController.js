const mongoose = require('mongoose');
const Invoice = require('../models/invoice');
const Return = require('../models/return');
const Product = require('../models/product');
const Customer = require('../models/customer');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

// تقرير مالي شامل
exports.comprehensiveFinancialReport = catchAsync(async (req, res, next) => {
  const { year, month, startDate, endDate } = req.body;

  let dateFilter = {};

  if (startDate && endDate) {
    dateFilter = {
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };
  } else if (year && month) {
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0);
    dateFilter = {
      createdAt: {
        $gte: startOfMonth,
        $lte: endOfMonth,
      },
    };
  } else if (year) {
    dateFilter = {
      createdAt: {
        $gte: new Date(`${year}-01-01`),
        $lte: new Date(`${year}-12-31`),
      },
    };
  }

  // إحصائيات المبيعات
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

  // إحصائيات المرتجعات
  const returnStats = await Return.aggregate([
    { $match: { date: dateFilter.createdAt } },
    {
      $group: {
        _id: null,
        totalReturns: { $sum: 1 },
        totalRefundAmount: { $sum: '$refundAmount' },
        totalReturnedItems: { $sum: '$quantity' },
      },
    },
  ]);

  // صافي المبيعات
  const netSales =
    (salesStats[0]?.totalRevenue || 0) -
    (returnStats[0]?.totalRefundAmount || 0);

  // التقرير الشهري
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
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  // المرتجعات الشهرية
  const monthlyReturns = await Return.aggregate([
    { $match: { date: dateFilter.createdAt } },
    {
      $group: {
        _id: {
          year: { $year: '$date' },
          month: { $month: '$date' },
        },
        refunds: { $sum: '$refundAmount' },
        returnCount: { $sum: 1 },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      summary: {
        ...salesStats[0],
        ...returnStats[0],
        netSales,
        profitMargin: salesStats[0]
          ? ((netSales / salesStats[0].totalRevenue) * 100).toFixed(2) + '%'
          : '0%',
      },
      monthlyBreakdown,
      monthlyReturns,
    },
  });
});

// تقرير المنتجات الأكثر مبيعاً مع تحليل متقدم
exports.getTopProducts = catchAsync(async (req, res, next) => {
  const { startDate, endDate, limit = 10, sortBy = 'quantity' } = req.body;

  const dateFilter = {
    issueDate: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
  };

  // المنتجات الأكثر مبيعاً
  const topProductsPipeline = [
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
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'productInfo',
      },
    },
    { $unwind: '$productInfo' },
    {
      $lookup: {
        from: 'returns',
        let: { productName: '$productInfo.name' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$product', '$$productName'] },
              date: dateFilter.issueDate,
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
        category: '$productInfo.category',
        totalQuantitySold: 1,
        totalRevenue: 1,
        averagePrice: { $round: ['$averagePrice', 2] },
        orderCount: 1,
        returnedQuantity: {
          $ifNull: [{ $arrayElemAt: ['$returnInfo.totalReturns', 0] }, 0],
        },
        refundAmount: {
          $ifNull: [{ $arrayElemAt: ['$returnInfo.refundAmount', 0] }, 0],
        },
        netQuantitySold: {
          $subtract: [
            '$totalQuantitySold',
            { $ifNull: [{ $arrayElemAt: ['$returnInfo.totalReturns', 0] }, 0] },
          ],
        },
        netRevenue: {
          $subtract: [
            '$totalRevenue',
            { $ifNull: [{ $arrayElemAt: ['$returnInfo.refundAmount', 0] }, 0] },
          ],
        },
        returnRate: {
          $multiply: [
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
            100,
          ],
        },
      },
    },
    {
      $sort:
        sortBy === 'revenue' ? { netRevenue: -1 } : { netQuantitySold: -1 },
    },
    { $limit: Number(limit) },
  ];

  const topProducts = await Invoice.aggregate(topProductsPipeline);

  res.status(200).json({
    status: 'success',
    data: {
      products: topProducts,
      summary: {
        totalProducts: topProducts.length,
        totalRevenue: topProducts.reduce((sum, p) => sum + p.netRevenue, 0),
        totalQuantity: topProducts.reduce(
          (sum, p) => sum + p.netQuantitySold,
          0
        ),
      },
    },
  });
});

// تحليل أداء العملاء
exports.customerAnalysis = catchAsync(async (req, res, next) => {
  const { startDate, endDate, limit = 10 } = req.body;

  const dateFilter = {
    createdAt: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
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
    {
      $lookup: {
        from: 'customers',
        localField: '_id',
        foreignField: '_id',
        as: 'customerInfo',
      },
    },
    { $unwind: '$customerInfo' },
    {
      $lookup: {
        from: 'returns',
        let: { customerId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$customer', '$$customerId'] },
              date: dateFilter.createdAt,
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
          $ifNull: [{ $arrayElemAt: ['$returnInfo.refundAmount', 0] }, 0],
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
    { $limit: Number(limit) },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      customers: customerStats,
      summary: {
        totalCustomers: customerStats.length,
        totalRevenue: customerStats.reduce((sum, c) => sum + c.netPurchases, 0),
        averageCustomerValue: (
          customerStats.reduce((sum, c) => sum + c.netPurchases, 0) /
          customerStats.length
        ).toFixed(2),
      },
    },
  });
});

// تحليل المبيعات حسب الفئات
exports.salesByCategory = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.body;

  const categoryAnalysis = await Invoice.aggregate([
    {
      $match: {
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      },
    },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'productInfo',
      },
    },
    { $unwind: '$productInfo' },
    {
      $group: {
        _id: '$productInfo.category',
        totalRevenue: { $sum: '$items.lineTotal' },
        totalQuantity: { $sum: '$items.quantity' },
        productCount: { $addToSet: '$items.product' },
        orderCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        category: '$_id',
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

  const totalRevenue = categoryAnalysis.reduce(
    (sum, cat) => sum + cat.totalRevenue,
    0
  );

  // إضافة النسبة المئوية لكل فئة
  categoryAnalysis.forEach((cat) => {
    cat.percentage = ((cat.totalRevenue / totalRevenue) * 100).toFixed(2) + '%';
  });

  res.status(200).json({
    status: 'success',
    data: {
      categories: categoryAnalysis,
      summary: {
        totalCategories: categoryAnalysis.length,
        totalRevenue: totalRevenue.toFixed(2),
      },
    },
  });
});
