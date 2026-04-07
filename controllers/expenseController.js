const Expense = require('../models/expense');
const CashTransaction = require('../models/cashTransaction');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const Crud = require('./crudFactory');

// ============================================================
// Basic CRUD
// ============================================================
exports.getAllExpenses = Crud.getAll(Expense);
exports.getOneExpense = Crud.getOneById(Expense);
exports.updateExpense = Crud.updateOne(Expense);

// ============================================================
// Create Expense
// ============================================================
exports.createExpense = catchAsync(async (req, res, next) => {
  const {
    category,
    amount,
    description,
    date,
    paymentMethod,
    isRecurring,
    recurringPeriod,
    notes,
    approvedBy,
  } = req.body;

  // ✅ Validate
  if (!category || !amount || !description) {
    return next(
      new AppError('category, amount, and description are required', 400)
    );
  }

  if (amount <= 0) {
    return next(new AppError('Amount must be positive', 400));
  }

  if (isRecurring && !recurringPeriod) {
    return next(
      new AppError('recurringPeriod is required for recurring expenses', 400)
    );
  }

  // ✅ Create Expense
  const expense = await Expense.create({
    category,
    amount,
    description,
    date: date ? new Date(date) : new Date(),
    paymentMethod: paymentMethod || 'Cash',
    isRecurring: isRecurring || false,
    recurringPeriod: recurringPeriod || null,
    notes: notes || null,
    approvedBy: approvedBy || null,
    status: 'paid',
  });

  // ✅ إضافة للـ Cash Transactions تلقائي
  await CashTransaction.create({
    type: 'expense',
    category: 'other_expense',
    amount,
    description,
    referenceId: expense._id,
    referenceType: 'Expense',
    paymentMethod: paymentMethod || 'Cash',
    date: expense.date,
  });

  res.status(201).json({
    status: 'success',
    message: 'Expense created successfully',
    data: expense,
  });
});

// ============================================================
// Delete Expense (Soft Delete)
// ============================================================
exports.deleteExpense = catchAsync(async (req, res, next) => {
  const expense = await Expense.findById(req.params.id);

  if (!expense) {
    return next(new AppError('Expense not found', 404));
  }

  expense.isDeleted = true;
  expense.status = 'cancelled';
  await expense.save();

  res.status(200).json({
    status: 'success',
    message: 'Expense deleted successfully',
  });
});

// ============================================================
// Get Expense Summary
// ============================================================
exports.getExpenseSummary = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.query;

  const filter = { isDeleted: false, status: 'paid' };

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return next(new AppError('Invalid date format', 400));
    }

    filter.date = { $gte: start, $lte: end };
  }

  // ✅ By Category
  const byCategory = await Expense.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$category',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
        avgAmount: { $avg: '$amount' },
      },
    },
    { $sort: { total: -1 } },
  ]);

  const totalExpenses = byCategory.reduce((sum, c) => sum + c.total, 0);

  // ✅ Monthly breakdown
  const monthlyBreakdown = await Expense.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          year: { $year: '$date' },
          month: { $month: '$date' },
        },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  // ✅ Recurring expenses
  const recurringExpenses = await Expense.find({
    ...filter,
    isRecurring: true,
  }).sort('category');

  res.status(200).json({
    status: 'success',
    data: {
      summary: {
        totalExpenses: totalExpenses.toFixed(2),
        totalCategories: byCategory.length,
      },
      byCategory: byCategory.map((c) => ({
        ...c,
        percentage:
          totalExpenses > 0
            ? ((c.total / totalExpenses) * 100).toFixed(2) + '%'
            : '0%',
      })),
      monthlyBreakdown,
      recurringExpenses,
    },
  });
});
