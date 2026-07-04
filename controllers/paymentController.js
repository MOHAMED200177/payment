'use strict';
const mongoose  = require('mongoose');
const Payment     = require('../models/payment');
const Invoice     = require('../models/invoice');
const Customer    = require('../models/customer');
const Transaction = require('../models/transactions');
const AppError    = require('../utils/appError');
const catchAsync  = require('../utils/catchAsync');
const Crud        = require('./crudFactory');
const { logAudit } = require('../utils/auditLog');

const populateOptions = [
  { path: 'customer', select: 'name email phone' },
  { path: 'invoice',  select: 'invoiceNumber totalAmount balanceDue' },
];

exports.allPayment  = Crud.getAll(Payment, populateOptions);
exports.onePayment  = Crud.getOneById(Payment, populateOptions);

// ============================================================
// Add Payment — tenant-scoped
// ============================================================
exports.addPayment = catchAsync(async (req, res, next) => {
  const { name, amount, invoiceNumber, method, notes } = req.body;
  const companyId = req.companyId;

  if (!name || !amount) return next(new AppError('Customer name and amount are required', 400));
  if (amount <= 0) return next(new AppError('Payment amount must be positive', 400));

  const VALID_METHODS = ['Cash', 'Credit Card', 'Bank Transfer', 'Other'];
  if (method && !VALID_METHODS.includes(method)) {
    return next(new AppError(`Invalid payment method. Must be one of: ${VALID_METHODS.join(', ')}`, 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const customer = await Customer.findOne({ name, company: companyId }).session(session);
    if (!customer) throw new AppError('Customer not found', 404);

    let invoice = null;
    if (invoiceNumber) {
      invoice = await Invoice.findOne({ invoiceNumber, company: companyId }).session(session);
      if (!invoice) throw new AppError('Invoice not found', 404);
      if (invoice.customer.toString() !== customer._id.toString()) throw new AppError('Invoice does not belong to this customer', 400);
      if (invoice.balanceDue <= 0) throw new AppError('Invoice is already fully paid', 400);
      if (amount > invoice.balanceDue) throw new AppError(`Payment exceeds invoice balance. Remaining: ${invoice.balanceDue}`, 400);
    } else {
      if (customer.outstandingBalance <= 0) throw new AppError('Customer has no outstanding balance', 400);
      if (amount > customer.outstandingBalance) throw new AppError(`Payment exceeds outstanding balance. Remaining: ${customer.outstandingBalance}`, 400);
    }

    const payment = new Payment({
      customer: customer._id, customerName: name, amount,
      invoice: invoice ? invoice._id : null,
      company: companyId, status: 'Success', method: method || 'Cash',
      ...(notes && { notes }),
    });
    await payment.save({ session });

    const [transaction] = await Transaction.create([{
      type: 'payment', referenceId: payment._id, amount, company: companyId,
      details: invoice
        ? `Payment of ${amount} for invoice #${invoice.invoiceNumber}`
        : `Payment of ${amount} against outstanding balance for ${name}`,
      items: [], status: 'credit',
    }], { session });

    if (invoice) { invoice.amountPaid += amount; invoice.balanceDue -= amount; await invoice.save({ session }); }

    customer.outstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - amount);
    customer.balance = Math.max(0, (customer.balance || 0) - amount);
    customer.payment.push(payment._id);
    customer.transactions.push(transaction._id);
    await customer.save({ session });

    await session.commitTransaction();

    logAudit({
      req,
      action: 'CREATE',
      module: 'PAYMENT',
      entityId: payment._id,
      entityLabel: `Payment ${amount} from ${name}`,
      newValues: { amount, method: method || 'Cash', invoiceNumber: invoiceNumber || null },
    });

    const populated = await Payment.findById(payment._id)
      .populate('customer', 'name email phone')
      .populate('invoice', 'invoiceNumber totalAmount balanceDue');

    res.status(201).json({ status: 'success', message: 'Payment added successfully', data: { payment: populated, updatedBalance: customer.outstandingBalance } });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during payment creation', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Update Payment — tenant-scoped
// ============================================================
exports.updatePayment = catchAsync(async (req, res, next) => {
  const { amount, method, notes } = req.body;
  const { id } = req.params;
  const companyId = req.companyId;

  const VALID_METHODS = ['Cash', 'Credit Card', 'Bank Transfer', 'Other'];
  if (method && !VALID_METHODS.includes(method)) return next(new AppError(`Invalid method. Must be one of: ${VALID_METHODS.join(', ')}`, 400));
  if (amount !== undefined && amount <= 0) return next(new AppError('Payment amount must be positive', 400));

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment  = await Payment.findOne({ _id: id, company: companyId }).session(session);
    if (!payment) throw new AppError('Payment not found', 404);

    const customer = await Customer.findById(payment.customer).session(session);
    if (!customer) throw new AppError('Customer not found', 404);

    const oldAmount = payment.amount;
    const newAmount = amount !== undefined ? amount : oldAmount;
    const diff = newAmount - oldAmount;

    if (amount !== undefined && amount !== oldAmount && payment.invoice) {
      const invoice = await Invoice.findOne({ _id: payment.invoice, company: companyId }).session(session);
      if (invoice) {
        const newBalanceDue = invoice.balanceDue + oldAmount - newAmount;
        if (newBalanceDue < 0) throw new AppError(`Payment too high. Max allowed: ${invoice.balanceDue + oldAmount}`, 400);
        invoice.amountPaid = invoice.amountPaid - oldAmount + newAmount;
        invoice.balanceDue = newBalanceDue;
        await invoice.save({ session });
      }
      customer.outstandingBalance += diff;
      customer.balance += diff;
      payment.amount = newAmount;
    }

    if (method) payment.method = method;
    if (notes !== undefined) payment.notes = notes;

    await payment.save({ session });
    await customer.save({ session });
    await session.commitTransaction();

    logAudit({
      req,
      action: 'UPDATE',
      module: 'PAYMENT',
      entityId: payment._id,
      entityLabel: `Payment update`,
      oldValues: { amount: oldAmount, method: payment.method },
      newValues: { amount: newAmount, method, notes },
    });

    res.status(200).json({ status: 'success', data: { data: payment } });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during payment update', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Delete Payment — tenant-scoped with full reversal
// ============================================================
exports.deletePayment = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const companyId = req.companyId;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment  = await Payment.findOne({ _id: id, company: companyId }).session(session);
    if (!payment) throw new AppError('Payment not found', 404);

    const customer = await Customer.findById(payment.customer).session(session);
    if (!customer) throw new AppError('Customer not found', 404);

    if (payment.invoice) {
      const invoice = await Invoice.findOne({ _id: payment.invoice, company: companyId }).session(session);
      if (invoice) {
        invoice.amountPaid = Math.max(0, invoice.amountPaid - payment.amount);
        invoice.balanceDue += payment.amount;
        await invoice.save({ session });
      }
    }

    customer.outstandingBalance += payment.amount;
    customer.balance += payment.amount;
    customer.payment = (customer.payment || []).filter((p) => p.toString() !== id);

    const relatedTxns = await Transaction.find({ referenceId: payment._id, company: companyId }).session(session);
    const txnIds = relatedTxns.map((t) => t._id.toString());
    customer.transactions = (customer.transactions || []).filter((t) => !txnIds.includes(t.toString()));

    await Transaction.deleteMany({ referenceId: payment._id, company: companyId }, { session });
    await customer.save({ session });
    await Payment.findOneAndDelete({ _id: id, company: companyId }, { session });

    await session.commitTransaction();

    logAudit({
      req,
      action: 'DELETE',
      module: 'PAYMENT',
      entityId: payment._id,
      entityLabel: `Payment deletion`,
      oldValues: { amount: payment.amount, method: payment.method },
    });

    res.status(200).json({ status: 'success', message: 'Payment deleted and balances reversed successfully' });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during payment deletion', 500));
  } finally {
    session.endSession();
  }
});

exports.getCustomerPayments = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const customer = await Customer.findOne({ _id: id, ...req.tenantFilter });
  if (!customer) return next(new AppError('Customer not found', 404));

  const payments = await Payment.find({ customer: id, ...req.tenantFilter })
    .populate('invoice', 'invoiceNumber totalAmount')
    .sort('-date');

  res.status(200).json({ status: 'success', results: payments.length, data: payments });
});
