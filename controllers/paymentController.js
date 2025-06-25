const mongoose = require('mongoose');
const Payment = require('../models/payment');
const Invoice = require('../models/invoice');
const Customer = require('../models/customer');
const Transaction = require('../models/transactions');
const catchAsync = require('../utils/catchAsync');

const Crud = require('./crudFactory');

exports.allPayment = Crud.getAll(Payment);
exports.updatePayment = Crud.updateOne(Payment);
exports.onePayment = Crud.getOneById(Payment);
exports.deletePayment = Crud.deleteOne(Payment);




exports.addPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, amount, invoiceNumber } = req.body;
    if (!name || !amount) {
      throw new AppError('Customer name and amount are required', 400);
    }

    if (amount <= 0) {
      throw new AppError('Payment amount must be positive', 400);
    }

    const customer = await Customer.findOne({ name }).session(session);
    if (!customer) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Customer not found' });
    }

    let invoice = null;
    let remaining = 0;

    if (invoiceNumber) {
      invoice = await Invoice.findOne({ invoiceNumber }).session(session);
      if (!invoice) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: 'Invoice not found' });
      }

      if (invoice.customer.toString() !== customer._id.toString()) {
        throw new AppError('Invoice does not belong to this customer', 400);
      }

      remaining = invoice.balanceDue;
      if (amount > remaining) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          message: `Payment exceeds remaining invoice amount. Remaining: ${remaining}`,
        });
      }
    } else {
      // إذا لم يكن هناك `invoiceId`، التحقق من رصيد العميل
      if (amount > customer.outstandingBalance) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          message: `Payment exceeds outstanding balance. Remaining balance: ${customer.outstandingBalance}`,
        });
      }
    }

    // إنشاء الدفع
    const payment = new Payment({
      customer: customer.id,
      customerName: name,
      amount,
      invoice: invoice ? invoice._id : null,
    });
    await payment.save({ session });

    // إنشاء المعاملة
    const transaction = await Transaction.create(
      [
        {
          type: 'payment',
          referenceId: payment._id,
          amount,
          details: invoice
            ? `Payment of ${amount} for invoice ${invoice.invoiceNumber}`
            : `Payment of ${amount} against outstanding balance`,
          status: 'credit',
        },
      ],
      { session }
    );

    // تحديث العميل
    customer.transactions.push(transaction[0]._id);
    customer.payment.push(payment._id);
    customer.outstandingBalance -= amount;
    customer.balance -= amount;
    await customer.save({ session });

    // إذا كانت الفاتورة موجودة، تحديثها
    if (invoice) {
      invoice.amountPaid = (invoice.amountPaid || 0) + amount;
      invoice.balanceDue -= amount;
      await invoice.save({ session });
    }

    // إنهاء العملية بنجاح
    await session.commitTransaction();
    session.endSession();

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
    // التراجع عن التغييرات
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: error.message });
  }
};

// Update payment

exports.updatePayment = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { amount, paymentMethod, notes } = req.body;

    const paymentId = req.params.id;

    // Get original payment

    const originalPayment = await Payment.findById(paymentId)

      .populate('customer')

      .populate('invoice')

      .session(session);

    if (!originalPayment) {
      throw new AppError('Payment not found', 404);
    }

    // Check if payment is already processed (optional business rule)

    if (originalPayment.status === 'processed') {
      throw new AppError('Cannot update processed payment', 400);
    }

    const oldAmount = originalPayment.amount;

    const amountDifference = amount - oldAmount;

    // Validate new amount

    if (amount <= 0) {
      throw new AppError('Payment amount must be positive', 400);
    }

    // If payment is for an invoice, check constraints

    if (originalPayment.invoice) {
      const invoice = originalPayment.invoice;

      const newInvoiceBalance = invoice.balanceDue - amountDifference;

      if (newInvoiceBalance < 0) {
        throw new AppError('Payment would exceed invoice total amount', 400);
      }
    }

    // Check customer balance constraints

    const customer = originalPayment.customer;

    const newCustomerBalance = customer.outstandingBalance - amountDifference;

    if (newCustomerBalance < 0) {
      throw new AppError(
        'Payment would result in negative customer balance',
        400
      );
    }

    // Update payment

    originalPayment.amount = amount;

    if (paymentMethod) originalPayment.paymentMethod = paymentMethod;

    if (notes !== undefined) originalPayment.notes = notes;

    originalPayment.updatedAt = new Date();

    await originalPayment.save({ session });

    // Update transaction

    await Transaction.updateOne(
      {
        referenceId: paymentId,

        type: 'payment',
      },

      {
        amount,

        details: originalPayment.invoice
          ? `Payment of ${amount} for invoice #${originalPayment.invoice.invoiceNumber} (Updated)`
          : `Payment of ${amount} against outstanding balance (Updated)`,

        updatedAt: new Date(),
      },

      { session }
    );

    // Update customer balance

    customer.outstandingBalance -= amountDifference;

    customer.balance -= amountDifference;

    await customer.save({ session });

    // Update invoice if applicable

    if (originalPayment.invoice) {
      const invoice = originalPayment.invoice;

      invoice.amountPaid += amountDifference;

      invoice.balanceDue -= amountDifference;

      // Update invoice status

      if (invoice.balanceDue === 0) {
        invoice.status = 'paid';
      } else if (invoice.amountPaid > 0) {
        invoice.status = 'partial';
      } else {
        invoice.status = 'unpaid';
      }

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

    throw error;
  } finally {
    session.endSession();
  }
});

// Delete payment

exports.deletePayment = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const paymentId = req.params.id;

    // Get payment with related data

    const payment = await Payment.findById(paymentId)

      .populate('customer')

      .populate('invoice')

      .session(session);

    if (!payment) {
      throw new AppError('Payment not found', 404);
    }

    // Check if payment can be deleted (business rule)

    const paymentAge = (Date.now() - payment.createdAt) / (1000 * 60 * 60 * 24); // Days

    if (paymentAge > 30) {
      throw new AppError('Cannot delete payments older than 30 days', 400);
    }

    const { amount, customer, invoice } = payment;

    // Revert customer balance

    customer.outstandingBalance += amount;

    customer.balance += amount;

    // Remove payment reference from customer

    customer.payment = customer.payment.filter(
      (p) => p.toString() !== paymentId
    );

    // Remove transaction reference

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

    // Revert invoice if applicable

    if (invoice) {
      invoice.amountPaid -= amount;

      invoice.balanceDue += amount;

      // Update invoice status

      if (invoice.amountPaid === 0) {
        invoice.status = 'unpaid';
      } else {
        invoice.status = 'partial';
      }

      await invoice.save({ session });
    }

    // Delete transaction

    await Transaction.deleteOne(
      {
        referenceId: paymentId,

        type: 'payment',
      },
      { session }
    );

    // Delete payment

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

    throw error;
  } finally {
    session.endSession();
  }
});

// Get payments by customer

exports.getCustomerPayments = catchAsync(async (req, res, next) => {
  const { customerId } = req.params;

  const page = parseInt(req.query.page) || 1;

  const limit = parseInt(req.query.limit) || 10;

  const skip = (page - 1) * limit;

  const customer = await Customer.findById(customerId);

  if (!customer) {
    return next(new AppError('Customer not found', 404));
  }

  const [payments, total] = await Promise.all([
    Payment.find({ customer: customerId })

      .populate('invoice', 'invoiceNumber totalAmount')

      .sort('-createdAt')

      .skip(skip)

      .limit(limit),

    Payment.countDocuments({ customer: customerId }),
  ]);

  const stats = await Payment.aggregate([
    { $match: { customer: mongoose.Types.ObjectId(customerId) } },

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
