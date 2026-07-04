'use strict';
const mongoose = require('mongoose');
const Expense = require('../models/expense.model');
const CashTransaction = require('../models/cashTransaction.model');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const Crud = require('./crudFactory');
const { logAudit } = require('../utils/auditLog');

// ============================================================
// Basic CRUD — tenant-scoped via crudFactory
// ============================================================
exports.getAllExpenses = Crud.getAll(Expense);
exports.getOneExpense = Crud.getOneById(Expense);

// ============================================================
// Create Expense — tenant-scoped, atomic transaction
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

  const companyId = req.companyId;

  // Validate
  if (!category || !amount || !description) {
    return next(new AppError('category, amount, and description are required', 400));
  }
  if (amount <= 0) {
    return next(new AppError('Amount must be positive', 400));
  }
  if (isRecurring && !recurringPeriod) {
    return next(new AppError('recurringPeriod is required for recurring expenses', 400));
  }

  // Atomic: create Expense + CashTransaction together
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [expense] = await Expense.create(
      [
        {
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
          company: companyId,
        },
      ],
      { session }
    );

    // Mirror to cash ledger
    await CashTransaction.create(
      [
        {
          type: 'expense',
          category: 'other_expense',
          amount,
          description,
          referenceId: expense._id,
          referenceType: 'Expense',
          paymentMethod: paymentMethod || 'Cash',
          date: expense.date,
          company: companyId,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    // Audit log (non-blocking)
    logAudit({
      req,
      action: 'CREATE',
      module: 'EXPENSE',
      entityId: expense._id,
      entityLabel: description,
      newValues: { category, amount, paymentMethod },
    });

    res.status(201).json({
      status: 'success',
      message: 'Expense created successfully',
      data: expense,
    });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during expense creation', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Update Expense — tenant-scoped
// ============================================================
exports.updateExpense = catchAsync(async (req, res, next) => {
  // Prevent changing company
  delete req.body.company;

  const expense = await Expense.findOneAndUpdate(
    { _id: req.params.id, ...req.tenantFilter, isDeleted: { $ne: true } },
    req.body,
    { new: true, runValidators: true }
  );

  if (!expense) return next(new AppError('Expense not found', 404));

  logAudit({
    req,
    action: 'UPDATE',
    module: 'EXPENSE',
    entityId: expense._id,
    entityLabel: expense.description,
    newValues: req.body,
  });

  res.status(200).json({ status: 'success', data: expense });
});

// ============================================================
// Delete Expense (Soft Delete) — tenant-scoped
// ============================================================
exports.deleteExpense = catchAsync(async (req, res, next) => {
  const expense = await Expense.findOne({
    _id: req.params.id,
    ...req.tenantFilter,
    isDeleted: { $ne: true },
  });

  if (!expense) return next(new AppError('Expense not found', 404));

  expense.isDeleted = true;
  expense.deletedAt = new Date();
  expense.deletedBy = req.user._id;
  expense.status = 'cancelled';
  await expense.save();

  logAudit({
    req,
    action: 'SOFT_DELETE',
    module: 'EXPENSE',
    entityId: expense._id,
    entityLabel: expense.description,
    oldValues: { amount: expense.amount, category: expense.category },
  });

  res.status(200).json({
    status: 'success',
    message: 'Expense deleted successfully',
  });
});

// ============================================================
// Get Expense Summary — tenant-scoped aggregation
// ============================================================
exports.getExpenseSummary = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.query;
  const companyId = req.companyId;

  const filter = {
    company: mongoose.Types.ObjectId.createFromHexString
      ? new mongoose.Types.ObjectId(companyId.toString())
      : companyId,
    isDeleted: { $ne: true },
    status: 'paid',
  };

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return next(new AppError('Invalid date format', 400));
    }
    filter.date = { $gte: start, $lte: end };
  }

  // By Category
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

  // Monthly breakdown
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

  // Recurring expenses
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
