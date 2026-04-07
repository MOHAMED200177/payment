const mongoose = require('mongoose');
const CashTransaction = require('../models/cashTransaction');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const Crud = require('./crudFactory');

// ============================================================
// Basic CRUD
// ============================================================
exports.getAllTransactions = Crud.getAll(CashTransaction);
exports.getOneTransaction = Crud.getOneById(CashTransaction);

// ============================================================
// Add Cash Transaction
// ============================================================
exports.addTransaction = catchAsync(async (req, res, next) => {
  const { type, category, amount, description, paymentMethod, date, notes } =
    req.body;

  // ✅ Validate
  if (!type || !category || !amount || !description) {
    return next(
      new AppError('type, category, amount, and description are required', 400)
    );
  }

  if (amount <= 0) {
    return next(new AppError('Amount must be positive', 400));
  }

  // ✅ Validate category matches type
  const incomeCategories = [
    'sales',
    'prescription_sales',
    'insurance_claims',
    'other_income',
  ];
  const expenseCategories = [
    'purchase',
    'salary',
    'rent',
    'utilities',
    'maintenance',
    'other_expense',
  ];

  if (type === 'income' && !incomeCategories.includes(category)) {
    return next(
      new AppError(
        `Invalid category for income. Must be one of: ${incomeCategories.join(', ')}`,
        400
      )
    );
  }

  if (type === 'expense' && !expenseCategories.includes(category)) {
    return next(
      new AppError(
        `Invalid category for expense. Must be one of: ${expenseCategories.join(', ')}`,
        400
      )
    );
  }

  const transaction = await CashTransaction.create({
    type,
    category,
    amount,
    description,
    paymentMethod: paymentMethod || 'Cash',
    date: date ? new Date(date) : new Date(),
    notes: notes || null,
  });

  res.status(201).json({
    status: 'success',
    message: 'Transaction added successfully',
    data: transaction,
  });
});

// ============================================================
// Get Cash Summary
// ============================================================
exports.getCashSummary = catchAsync(async (req, res, next) => {
  const { startDate, endDate, period } = req.query;

  // ✅ Build date filter
  let dateFilter = {};

  if (startDate && endDate) {
    dateFilter = {
      date: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };
  } else if (period === 'today') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dateFilter = {
      date: { $gte: today },
    };
  } else if (period === 'week') {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    dateFilter = {
      date: { $gte: weekAgo },
    };
  } else if (period === 'month') {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    dateFilter = {
      date: { $gte: monthStart },
    };
  }

  // ✅ Aggregate
  const summary = await CashTransaction.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  const income = summary.find((s) => s._id === 'income')?.total || 0;
  const expense = summary.find((s) => s._id === 'expense')?.total || 0;
  const netCash = income - expense;

  // ✅ By Category
  const byCategory = await CashTransaction.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: { type: '$type', category: '$category' },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ]);

  // ✅ Daily breakdown
  const dailyBreakdown = await CashTransaction.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          type: '$type',
        },
        total: { $sum: '$amount' },
      },
    },
    { $sort: { '_id.date': 1 } },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      summary: {
        totalIncome: income.toFixed(2),
        totalExpense: expense.toFixed(2),
        netCash: netCash.toFixed(2),
        isProfit: netCash >= 0,
      },
      byCategory,
      dailyBreakdown,
    },
  });
});

// ============================================================
// Daily Settlement - تسوية يومية
// ============================================================
exports.getDailySettlement = catchAsync(async (req, res, next) => {
  const { date } = req.query;

  const targetDate = date ? new Date(date) : new Date();
  targetDate.setHours(0, 0, 0, 0);

  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);

  const dateFilter = {
    date: { $gte: targetDate, $lt: nextDay },
  };

  // ✅ All transactions for the day
  const transactions = await CashTransaction.find(dateFilter).sort('date');

  // ✅ Summary
  const income = transactions
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const expense = transactions
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  // ✅ By payment method
  const byMethod = await CashTransaction.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: { method: '$paymentMethod', type: '$type' },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      date: targetDate.toISOString().split('T')[0],
      summary: {
        totalIncome: income.toFixed(2),
        totalExpense: expense.toFixed(2),
        netCash: (income - expense).toFixed(2),
        totalTransactions: transactions.length,
      },
      byPaymentMethod: byMethod,
      transactions,
    },
  });
});
