'use strict';
const mongoose = require('mongoose');
const Return = require('../models/return');
const Customer = require('../models/customer');
const Stock = require('../models/stock');
const Product = require('../models/product');
const Invoice = require('../models/invoice');
const Transaction = require('../models/transactions');
const SalesOrder = require('../models/sales');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { logAudit } = require('../utils/auditLog');

// ── Helper ────────────────────────────────────────────────────
/**
 * Update sales order statistics when a return is added or cancelled.
 * companyId is passed explicitly instead of hacked onto the session object.
 *
 * @param {ObjectId} productId
 * @param {ObjectId} invoiceId
 * @param {number} quantity
 * @param {number} amount
 * @param {ClientSession} session
 * @param {ObjectId} companyId
 * @param {boolean} isReturn - true = deduct (sales return), false = re-add (cancel return)
 */
const updateSalesStatistics = async (productId, invoiceId, quantity, amount, session, companyId, isReturn = true) => {
  const salesOrder = await SalesOrder.findOne({ product: productId, company: companyId }).session(session);
  if (!salesOrder) return;

  if (isReturn) {
    salesOrder.count = Math.max(0, salesOrder.count - quantity);
    salesOrder.subtotal = Math.max(0, salesOrder.subtotal - amount);
    if (Array.isArray(salesOrder.invoiceSales)) {
      const idx = salesOrder.invoiceSales.findIndex((is) => is.invoice.toString() === invoiceId.toString());
      if (idx > -1) {
        salesOrder.invoiceSales[idx].quantity = Math.max(0, salesOrder.invoiceSales[idx].quantity - quantity);
        salesOrder.invoiceSales[idx].subtotal = Math.max(0, salesOrder.invoiceSales[idx].subtotal - amount);
      }
    }
  } else {
    salesOrder.count += quantity;
    salesOrder.subtotal += amount;
    if (Array.isArray(salesOrder.invoiceSales)) {
      const idx = salesOrder.invoiceSales.findIndex((is) => is.invoice.toString() === invoiceId.toString());
      if (idx > -1) {
        salesOrder.invoiceSales[idx].quantity += quantity;
        salesOrder.invoiceSales[idx].subtotal += amount;
      }
    }
  }

  salesOrder.lastUpdateDate = new Date();
  if (salesOrder.count <= 0) await SalesOrder.deleteOne({ _id: salesOrder._id }).session(session);
  else await salesOrder.save({ session });
};

// ============================================================
// Get All Returns — tenant-scoped
// ============================================================
exports.allReturn = catchAsync(async (req, res) => {
  const returns = await Return.find({ isDeleted: { $ne: true }, ...req.tenantFilter })
    .populate('customer', 'name email phone')
    .populate('invoice', 'invoiceNumber totalAmount')
    .populate('product', 'name productCode')
    .sort('-createdAt');

  res.status(200).json({ status: 'success', results: returns.length, data: returns });
});

exports.oneReturn = catchAsync(async (req, res, next) => {
  const returnDoc = await Return.findOne({ _id: req.params.id, isDeleted: { $ne: true }, ...req.tenantFilter })
    .populate('customer', 'name email phone')
    .populate('invoice', 'invoiceNumber totalAmount items')
    .populate('product', 'name productCode sellingPrice');

  if (!returnDoc) return next(new AppError('Return not found', 404));
  res.status(200).json({ status: 'success', data: returnDoc });
});

// ============================================================
// Add Return — tenant-scoped, transactional
// ============================================================
exports.addReturn = catchAsync(async (req, res, next) => {
  const { invoiceNumber, productName, name, quantity, reason } = req.body;
  const companyId = req.companyId;

  if (!invoiceNumber || !productName || !name || !quantity) {
    return next(new AppError('invoiceNumber, productName, name, and quantity are required', 400));
  }
  if (quantity <= 0 || !Number.isInteger(quantity)) {
    return next(new AppError('Return quantity must be a positive integer', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const productDoc = await Product.findOne({ name: productName, company: companyId, isDeleted: { $ne: true } }).session(session);
    if (!productDoc) throw new AppError('Product not found', 404);

    const [customer, invoice, stock] = await Promise.all([
      Customer.findOne({ name, company: companyId, isDeleted: { $ne: true } }).session(session),
      Invoice.findOne({ invoiceNumber, company: companyId, isDeleted: { $ne: true } }).session(session),
      Stock.findOne({ product: productDoc._id, company: companyId }).session(session),
    ]);

    if (!customer) throw new AppError('Customer not found', 404);
    if (!invoice) throw new AppError('Invoice not found', 404);
    if (!stock) throw new AppError('Product not found in stock', 404);
    if (invoice.customer.toString() !== customer._id.toString()) throw new AppError('Invoice does not belong to this customer', 400);
    if (['cancelled', 'refunded'].includes(invoice.status)) throw new AppError('Cannot return items for a cancelled or refunded invoice', 400);

    const invoiceItem = invoice.items.find((i) => i.product.toString() === productDoc._id.toString());
    if (!invoiceItem) throw new AppError('Product not found in invoice', 404);

    const existingReturns = await Return.find({
      invoice: invoice._id,
      product: productDoc._id,
      company: companyId,
      isDeleted: { $ne: true },
      status: { $ne: 'cancelled' },
    }).session(session);

    const alreadyReturned = existingReturns.reduce((t, r) => t + r.quantity, 0);
    const remaining = invoiceItem.quantity - alreadyReturned;
    if (quantity > remaining) throw new AppError(`Only ${remaining} unit(s) can be returned.`, 400);

    const refundAmount = invoiceItem.unitPrice * quantity;

    const [returnDoc] = await Return.create(
      [
        {
          invoice: invoice._id,
          customer: customer._id,
          product: productDoc._id,
          quantity,
          reason,
          refundAmount,
          status: 'active',
          company: companyId,
        },
      ],
      { session }
    );

    const refundTransaction = new Transaction({
      type: 'refund',
      referenceId: returnDoc._id,
      referenceModel: 'Return',
      amount: refundAmount,
      company: companyId,
      details: `Refund of ${refundAmount} for return of ${quantity} x ${productDoc.name} from invoice #${invoiceNumber}`,
      items: [],
      status: 'credit',
    });

    // Update stock
    stock.quantity += quantity;
    stock.lastStockUpdate = new Date();

    // Update invoice
    invoice.returns = invoice.returns || [];
    invoice.returns.push(returnDoc._id);
    invoice.refunds = (invoice.refunds || 0) + refundAmount;
    invoice.subtotal = Math.max(0, invoice.subtotal - refundAmount);
    invoice.totalAmount = Math.max(0, invoice.totalAmount - refundAmount);
    invoice.balanceDue = Math.max(0, invoice.balanceDue - refundAmount);

    // Update customer
    customer.transactions.push(refundTransaction._id);
    customer.returns = customer.returns || [];
    customer.returns.push(returnDoc._id);
    customer.outstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - refundAmount);
    customer.balance = Math.max(0, (customer.balance || 0) - refundAmount);

    // Update sales statistics — pass companyId explicitly (no more session hack)
    await updateSalesStatistics(productDoc._id, invoice._id, quantity, refundAmount, session, companyId, true);

    await Promise.all([
      stock.save({ session }),
      invoice.save({ session }),
      refundTransaction.save({ session }),
      customer.save({ session }),
    ]);

    await session.commitTransaction();

    logAudit({
      req,
      action: 'CREATE',
      module: 'RETURN',
      entityId: returnDoc._id,
      entityLabel: `Return: ${quantity}x ${productDoc.name} from INV-${invoiceNumber}`,
      newValues: { invoiceNumber, productName, quantity, refundAmount },
    });

    res.status(201).json({ status: 'success', message: 'Return added successfully', data: returnDoc });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during return creation', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Update Return — tenant-scoped
// ============================================================
exports.updateReturn = catchAsync(async (req, res, next) => {
  const companyId = req.companyId;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const existingReturn = await Return.findOne({ _id: id, isDeleted: { $ne: true }, company: companyId }).session(session);
    if (!existingReturn) throw new AppError('Return not found', 404);
    if (existingReturn.status === 'processed') throw new AppError('Cannot update a processed return', 400);

    const allowedUpdates = ['reason', 'status'];
    const updateFields = {};
    Object.keys(req.body).forEach((k) => { if (allowedUpdates.includes(k)) updateFields[k] = req.body[k]; });

    if (req.body.status === 'cancelled' && existingReturn.status !== 'cancelled') {
      const [stock, invoice, customer] = await Promise.all([
        Stock.findOne({ product: existingReturn.product, company: companyId }).session(session),
        Invoice.findById(existingReturn.invoice).session(session),
        Customer.findById(existingReturn.customer).session(session),
      ]);
      if (!stock || !invoice || !customer) throw new AppError('Related records not found', 404);
      if (stock.quantity < existingReturn.quantity) throw new AppError('Insufficient stock to cancel return', 400);

      stock.quantity -= existingReturn.quantity;
      stock.lastStockUpdate = new Date();
      invoice.refunds = Math.max(0, (invoice.refunds || 0) - existingReturn.refundAmount);
      invoice.subtotal += existingReturn.refundAmount;
      invoice.totalAmount += existingReturn.refundAmount;
      invoice.balanceDue += existingReturn.refundAmount;
      invoice.returns = (invoice.returns || []).filter((r) => r.toString() !== id);

      const adjustTxn = new Transaction({
        type: 'return',
        referenceId: existingReturn._id,
        referenceModel: 'Return',
        amount: existingReturn.refundAmount,
        company: companyId,
        details: `Cancellation of return - restored ${existingReturn.refundAmount}`,
        items: [],
        status: 'debit',
      });
      customer.transactions.push(adjustTxn._id);
      customer.returns = (customer.returns || []).filter((r) => r.toString() !== id);
      customer.outstandingBalance += existingReturn.refundAmount;
      customer.balance += existingReturn.refundAmount;

      await updateSalesStatistics(existingReturn.product, existingReturn.invoice, existingReturn.quantity, existingReturn.refundAmount, session, companyId, false);
      await Promise.all([stock.save({ session }), invoice.save({ session }), adjustTxn.save({ session }), customer.save({ session })]);
    }

    Object.assign(existingReturn, updateFields);
    await existingReturn.save({ session });
    await session.commitTransaction();

    logAudit({ req, action: 'UPDATE', module: 'RETURN', entityId: existingReturn._id, entityLabel: `Return update`, newValues: updateFields });

    res.status(200).json({ status: 'success', message: 'Return updated successfully', data: existingReturn });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during return update', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Delete Return — tenant-scoped soft delete
// ============================================================
exports.deleteReturn = catchAsync(async (req, res, next) => {
  const companyId = req.companyId;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const returnDoc = await Return.findOne({ _id: id, isDeleted: { $ne: true }, company: companyId }).session(session);
    if (!returnDoc) throw new AppError('Return not found', 404);
    if (returnDoc.status === 'processed') throw new AppError('Cannot delete a processed return', 400);

    if (returnDoc.status === 'active') {
      const [stock, invoice, customer] = await Promise.all([
        Stock.findOne({ product: returnDoc.product, company: companyId }).session(session),
        Invoice.findById(returnDoc.invoice).session(session),
        Customer.findById(returnDoc.customer).session(session),
      ]);
      if (stock) {
        if (stock.quantity < returnDoc.quantity) throw new AppError('Insufficient stock to delete return', 400);
        stock.quantity -= returnDoc.quantity;
        stock.lastStockUpdate = new Date();
        await stock.save({ session });
      }
      if (invoice) {
        invoice.refunds = Math.max(0, (invoice.refunds || 0) - returnDoc.refundAmount);
        invoice.subtotal += returnDoc.refundAmount;
        invoice.totalAmount += returnDoc.refundAmount;
        invoice.balanceDue += returnDoc.refundAmount;
        invoice.returns = (invoice.returns || []).filter((r) => r.toString() !== id);
        await invoice.save({ session });
      }
      if (customer) {
        customer.outstandingBalance += returnDoc.refundAmount;
        customer.balance += returnDoc.refundAmount;
        customer.returns = (customer.returns || []).filter((r) => r.toString() !== id);
        await customer.save({ session });
      }
      await updateSalesStatistics(returnDoc.product, returnDoc.invoice, returnDoc.quantity, returnDoc.refundAmount, session, companyId, false);
    }

    // Soft delete
    returnDoc.isDeleted = true;
    returnDoc.deletedAt = new Date();
    returnDoc.deletedBy = req.user._id;
    returnDoc.status = 'cancelled';
    await returnDoc.save({ session });
    await session.commitTransaction();

    logAudit({ req, action: 'SOFT_DELETE', module: 'RETURN', entityId: returnDoc._id, entityLabel: `Return deleted` });

    res.status(200).json({ status: 'success', message: 'Return deleted successfully' });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during return deletion', 500));
  } finally {
    session.endSession();
  }
});

exports.getReturnsByCustomer = catchAsync(async (req, res, next) => {
  const { customerId } = req.params;
  const customer = await Customer.findOne({ _id: customerId, ...req.tenantFilter, isDeleted: { $ne: true } });
  if (!customer) return next(new AppError('Customer not found', 404));

  const returns = await Return.find({ customer: customerId, isDeleted: { $ne: true }, ...req.tenantFilter })
    .populate('invoice', 'invoiceNumber totalAmount')
    .populate('product', 'name productCode')
    .sort('-createdAt');

  res.status(200).json({ status: 'success', data: { totalReturns: returns.length, totalRefundAmount: returns.reduce((s, r) => s + (r.refundAmount || 0), 0), returns } });
});

exports.getReturnsByDateRange = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.query;
  const query = { isDeleted: { $ne: true }, ...req.tenantFilter };

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return next(new AppError('Invalid date format', 400));
    if (start > end) return next(new AppError('startDate must be before endDate', 400));
    query.createdAt = { $gte: start, $lte: end };
  }

  const returns = await Return.find(query)
    .populate('customer', 'name email')
    .populate('invoice', 'invoiceNumber')
    .populate('product', 'name productCode')
    .sort('-createdAt');

  res.status(200).json({ status: 'success', results: returns.length, data: returns });
});
