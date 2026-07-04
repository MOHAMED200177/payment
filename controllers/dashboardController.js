'use strict';
const catchAsync = require('../utils/catchAsync');
const reportService = require('./reportService');
const mongoose = require('mongoose');
const Invoice = require('../models/invoice');
const Stock = require('../models/stock');
const PurchaseOrder = require('../models/purchaseOrder.model');

// ============================================================
// Dashboard Overview — aggregate data for the home screen
// ============================================================
exports.getDashboardSummary = catchAsync(async (req, res, next) => {
  const companyId = req.companyId;
  const companyObjId = new mongoose.Types.ObjectId(companyId.toString());
  
  // Define periods
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  
  // 1. Monthly Financials (Sales & Expenses)
  const monthlyFinancials = await reportService.getFinancialSummary({ 
    companyId, 
    startDate: startOfMonth.toISOString(), 
    endDate: new Date().toISOString() 
  });

  // 2. Low Stock Alerts
  const lowStockCount = await Stock.aggregate([
    { $match: { company: companyObjId } },
    { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'p' } },
    { $unwind: '$p' },
    { $match: { 'p.isDeleted': { $ne: true }, $expr: { $lte: ['$quantity', '$p.reorderLevel'] } } },
    { $count: 'count' }
  ]);

  // 3. Unpaid Invoices (Receivables)
  const unpaidInvoices = await Invoice.aggregate([
    { $match: { company: companyObjId, isDeleted: { $ne: true }, status: { $in: ['issued', 'partially_paid', 'overdue'] }, balanceDue: { $gt: 0 } } },
    { $group: { _id: null, totalDue: { $sum: '$balanceDue' }, count: { $sum: 1 } } }
  ]);

  // 4. Pending Purchases (Payables)
  const pendingPurchases = await PurchaseOrder.aggregate([
    { $match: { company: companyObjId, isDeleted: { $ne: true }, balanceDue: { $gt: 0 } } },
    { $group: { _id: null, totalDue: { $sum: '$balanceDue' }, count: { $sum: 1 } } }
  ]);

  // 5. Today's Sales
  const todaysSales = await reportService.getSalesSummary({
    companyId,
    startDate: today.toISOString(),
    endDate: new Date().toISOString()
  });

  // 6. Recent Invoices
  const recentInvoices = await Invoice.find({ company: companyObjId, isDeleted: { $ne: true } })
    .populate('customer', 'name')
    .sort('-issueDate')
    .limit(5)
    .select('invoiceNumber issueDate totalAmount status balanceDue customer')
    .lean();

  res.status(200).json({
    status: 'success',
    data: {
      monthlyOverview: {
        revenue: monthlyFinancials.summary.totalRevenue,
        expenses: monthlyFinancials.summary.totalExpenses,
        netProfit: monthlyFinancials.summary.netProfit,
        profitMargin: monthlyFinancials.summary.profitMargin
      },
      todaySummary: {
        revenue: todaysSales.totalRevenue || 0,
        orders: todaysSales.totalOrders || 0
      },
      alerts: {
        lowStockItems: lowStockCount[0]?.count || 0,
        receivables: {
          amount: unpaidInvoices[0]?.totalDue || 0,
          count: unpaidInvoices[0]?.count || 0
        },
        payables: {
          amount: pendingPurchases[0]?.totalDue || 0,
          count: pendingPurchases[0]?.count || 0
        }
      },
      recentInvoices: recentInvoices.map(inv => ({
        ...inv,
        customerName: inv.customer?.name || 'Unknown'
      }))
    }
  });
});
