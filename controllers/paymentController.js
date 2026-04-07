const mongoose = require('mongoose');
const Payment = require('../models/payment');
const Invoice = require('../models/invoice');
const Customer = require('../models/customer');
const Transaction = require('../models/transactions');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const Crud = require('./crudFactory');

// ============================================================
// Populate Options
// ============================================================
const paymentPopulateOptions = [
  { path: 'customer', select: 'name email phone' },
  { path: 'invoice', select: 'invoiceNumber totalAmount balanceDue' },
];

// ============================================================
// Basic CRUD
// ============================================================
exports.allPayment = Crud.getAll(Payment, paymentPopulateOptions);
exports.onePayment = Crud.getOneById(Payment, paymentPopulateOptions);

// ============================================================
// Add Payment
// ============================================================
exports.addPayment = catchAsync(async (req, res, next) => {
  // ✅ 1 - Validate قبل فتح Session
  const { name, amount, invoiceNumber } = req.body;

  if (!name || !amount) {
    return next(new AppError('Customer name and amount are required', 400));
  }

  if (amount <= 0) {
    return next(new AppError('Payment amount must be positive', 400));
  }

  // ✅ 2 - افتح الـ Session بعد الـ Validation
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ─────────────────────────────────────
    // Find Customer
    // ─────────────────────────────────────
    const customer = await Customer.findOne({ name }).session(session);
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    // ─────────────────────────────────────
    // Find Invoice (if provided)
    // ─────────────────────────────────────
    let invoice = null;

    if (invoiceNumber) {
      invoice = await Invoice.findOne({ invoiceNumber }).session(session);

      if (!invoice) {
        throw new AppError('Invoice not found', 404);
      }

      // ✅ التحقق إن الفاتورة تبع العميل ده
      if (invoice.customer.toString() !== customer._id.toString()) {
        throw new AppError('Invoice does not belong to this customer', 400);
      }

      // ✅ التحقق من الـ balance
      if (invoice.balanceDue <= 0) {
        throw new AppError('Invoice is already fully paid', 400);
      }

      if (amount > invoice.balanceDue) {
        throw new AppError(
          `Payment exceeds remaining invoice amount. Remaining: ${invoice.balanceDue}`,
          400
        );
      }
    } else {
      // ✅ لو مفيش invoice - تحقق من الـ outstanding balance
      if (customer.outstandingBalance <= 0) {
        throw new AppError('Customer has no outstanding balance', 400);
      }

      if (amount > customer.outstandingBalance) {
        throw new AppError(
          `Payment exceeds outstanding balance. Remaining: ${customer.outstandingBalance}`,
          400
        );
      }
    }

    // ─────────────────────────────────────
    // Create Payment
    // ─────────────────────────────────────
    const payment = new Payment({
      customer: customer._id,
      customerName: name,
      amount,
      invoice: invoice ? invoice._id : null,
      status: 'Success', // ✅ متطابق مع الـ Payment Model
      method: 'Cash', // ✅ default
    });
    await payment.save({ session });

    // ─────────────────────────────────────
    // Create Transaction
    // ─────────────────────────────────────
    const [transaction] = await Transaction.create(
      [
        {
          type: 'payment',
          referenceId: payment._id,
          amount,
          details: invoice
            ? `Payment of ${amount} for invoice #${invoice.invoiceNumber}`
            : `Payment of ${amount} against outstanding balance`,
          items: [],
          status: 'credit',
        },
      ],
      { session }
    );

    // ─────────────────────────────────────
    // Update Customer
    // ─────────────────────────────────────
    customer.transactions.push(transaction._id);
    customer.payment.push(payment._id);
    customer.outstandingBalance -= amount;
    customer.balance -= amount;
    await customer.save({ session });

    // ─────────────────────────────────────
    // Update Invoice (if provided)
    // الـ pre save في الـ Invoice Model هيتكلف بتحديث الـ status
    // ─────────────────────────────────────
    if (invoice) {
      invoice.amountPaid = (invoice.amountPaid || 0) + amount;
      invoice.balanceDue -= amount;
      await invoice.save({ session });
    }

    await session.commitTransaction();

    res.status(201).json({
      status: 'success',
      message: 'Payment added successfully',
      data: {
        payment,
        updatedBalance: customer.outstandingBalance,
        invoiceStatus: invoice ? invoice.status : null,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Payment creation error:', error);
    next(new AppError('Something went wrong during payment creation', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Update Payment
// ============================================================
exports.updatePayment = catchAsync(async (req, res, next) => {
  // ✅ 1 - Validate قبل فتح Session
  const { amount, method, notes } = req.body;

  if (!amount) {
    return next(new AppError('Amount is required', 400));
  }

  if (amount <= 0) {
    return next(new AppError('Payment amount must be positive', 400));
  }

  // ✅ method validation متطابق مع الـ Payment Model
  const VALID_METHODS = ['Cash', 'Credit Card', 'Bank Transfer', 'Other'];
  if (method && !VALID_METHODS.includes(method)) {
    return next(
      new AppError(
        `Invalid payment method. Must be one of: ${VALID_METHODS.join(', ')}`,
        400
      )
    );
  }

  // ✅ 2 - افتح الـ Session بعد الـ Validation
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const paymentId = req.params.id;

    // ─────────────────────────────────────
    // Get Original Payment
    // ─────────────────────────────────────
    const originalPayment = await Payment.findById(paymentId)
      .populate('customer')
      .populate('invoice')
      .session(session);

    if (!originalPayment) {
      throw new AppError('Payment not found', 404);
    }

    // ✅ متطابق مع الـ Payment Model enum
    if (originalPayment.status === 'Failed') {
      throw new AppError('Cannot update failed payment', 400);
    }

    const oldAmount = originalPayment.amount;
    const amountDifference = amount - oldAmount;

    // ─────────────────────────────────────
    // Validate Against Invoice Balance
    // ─────────────────────────────────────
    if (originalPayment.invoice) {
      const invoice = originalPayment.invoice;
      const newInvoiceBalance = invoice.balanceDue - amountDifference;

      if (newInvoiceBalance < 0) {
        throw new AppError(
          `Payment would exceed invoice total. Max allowed: ${invoice.balanceDue + oldAmount}`,
          400
        );
      }
    }

    // ─────────────────────────────────────
    // Validate Against Customer Balance
    // ─────────────────────────────────────
    const customer = originalPayment.customer;
    const newCustomerBalance = customer.outstandingBalance - amountDifference;

    if (newCustomerBalance < 0) {
      throw new AppError(
        `Payment would result in negative customer balance. Max allowed: ${customer.outstandingBalance + oldAmount}`,
        400
      );
    }

    // ─────────────────────────────────────
    // Update Payment
    // ─────────────────────────────────────
    originalPayment.amount = amount;
    if (method) originalPayment.method = method; // ✅ method مش paymentMethod
    if (notes !== undefined) originalPayment.notes = notes;

    await originalPayment.save({ session });

    // ─────────────────────────────────────
    // Update Transaction
    // ─────────────────────────────────────
    await Transaction.updateOne(
      {
        referenceId: paymentId,
        type: 'payment',
      },
      {
        $set: {
          amount,
          details: originalPayment.invoice
            ? `Payment of ${amount} for invoice #${originalPayment.invoice.invoiceNumber} (Updated)`
            : `Payment of ${amount} against outstanding balance (Updated)`,
        },
      },
      { session }
    );

    // ─────────────────────────────────────
    // Update Customer Balance
    // ─────────────────────────────────────
    customer.outstandingBalance -= amountDifference;
    customer.balance -= amountDifference;
    await customer.save({ session });

    // ─────────────────────────────────────
    // Update Invoice (if applicable)
    // الـ pre save في الـ Invoice Model هيتكلف بتحديث الـ status
    // ─────────────────────────────────────
    if (originalPayment.invoice) {
      const invoice = originalPayment.invoice;
      invoice.amountPaid += amountDifference;
      invoice.balanceDue -= amountDifference;
      await invoice.save({ session });
    }

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Payment updated successfully',
      data: {
        payment: originalPayment,
        previousAmount: oldAmount,
        newAmount: amount,
        amountDifference,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Payment update error:', error);
    next(new AppError('Something went wrong during payment update', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Delete Payment
// ============================================================
exports.deletePayment = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const paymentId = req.params.id;

    // ─────────────────────────────────────
    // Get Payment
    // ─────────────────────────────────────
    const payment = await Payment.findById(paymentId)
      .populate('customer')
      .populate('invoice')
      .session(session);

    if (!payment) {
      throw new AppError('Payment not found', 404);
    }

    // ✅ Business Rule - مش تحذف payment بعد 30 يوم
    const paymentAge = (Date.now() - payment.createdAt) / (1000 * 60 * 60 * 24);

    if (paymentAge > 30) {
      throw new AppError('Cannot delete payments older than 30 days', 400);
    }

    const { amount, customer, invoice } = payment;

    // ─────────────────────────────────────
    // Revert Customer Balance
    // ─────────────────────────────────────
    customer.outstandingBalance += amount;
    customer.balance += amount;

    customer.payment = customer.payment.filter(
      (p) => p.toString() !== paymentId
    );

    // ✅ إزالة الـ transaction من العميل
    const transaction = await Transaction.findOne({
      referenceId: paymentId,
      type: 'payment',
    }).session(session);

    if (transaction) {
      customer.transactions = customer.transactions.filter(
        (t) => t.toString() !== transaction._id.toString()
      );
    }

    await customer.save({ session });

    // ─────────────────────────────────────
    // Revert Invoice (if applicable)
    // الـ pre save في الـ Invoice Model هيتكلف بتحديث الـ status
    // ─────────────────────────────────────
    if (invoice) {
      invoice.amountPaid -= amount;
      invoice.balanceDue += amount;
      await invoice.save({ session });
    }

    // ─────────────────────────────────────
    // Delete Transaction & Payment
    // ─────────────────────────────────────
    await Transaction.deleteOne(
      { referenceId: paymentId, type: 'payment' },
      { session }
    );

    await Payment.findByIdAndDelete(paymentId, { session });

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Payment deleted successfully',
      data: {
        deletedAmount: amount,
        updatedCustomerBalance: customer.outstandingBalance,
        updatedInvoiceBalance: invoice ? invoice.balanceDue : null,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Payment deletion error:', error);
    next(new AppError('Something went wrong during payment deletion', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Get Customer Payments
// ============================================================
exports.getCustomerPayments = catchAsync(async (req, res, next) => {
  const { customerId } = req.params;

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // ─────────────────────────────────────
  // Find Customer
  // ─────────────────────────────────────
  const customer = await Customer.findById(customerId);
  if (!customer) {
    return next(new AppError('Customer not found', 404));
  }

  // ─────────────────────────────────────
  // Get Payments & Total
  // ─────────────────────────────────────
  const [payments, total] = await Promise.all([
    Payment.find({ customer: customerId })
      .populate('invoice', 'invoiceNumber totalAmount balanceDue status')
      .sort('-createdAt')
      .skip(skip)
      .limit(limit),

    Payment.countDocuments({ customer: customerId }),
  ]);

  // ─────────────────────────────────────
  // Get Stats
  // ✅ new mongoose.Types.ObjectId بدل mongoose.Types.ObjectId()
  // ─────────────────────────────────────
  const stats = await Payment.aggregate([
    {
      $match: {
        customer: new mongoose.Types.ObjectId(customerId),
      },
    },
    {
      $group: {
        _id: null,
        totalPaid: { $sum: '$amount' },
        paymentCount: { $sum: 1 },
        avgPayment: { $avg: '$amount' },
        lastPaymentDate: { $max: '$createdAt' },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    results: payments.length,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
    customerInfo: {
      name: customer.name,
      outstandingBalance: customer.outstandingBalance,
      statistics: stats[0] || {
        totalPaid: 0,
        paymentCount: 0,
        avgPayment: 0,
        lastPaymentDate: null,
      },
    },
    data: payments,
  });
});
