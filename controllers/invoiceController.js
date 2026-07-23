'use strict';
/**
 * Invoice Controller — Multi-Tenant version.
 *
 * Key changes from single-tenant version:
 *   1. All DB queries include { company: req.companyId } filter.
 *   2. getNextSequence now receives companyId.
 *   3. New Customer/SalesOrder documents include company field.
 *   4. Cross-tenant access is impossible even with correct ObjectIds.
 */
const mongoose = require('mongoose');

const Crud = require('./crudFactory');
const Payment = require('../models/payment');
const Customer = require('../models/customer');
const Invoice = require('../models/invoice');
const Stock = require('../models/stock');
const Product = require('../models/product');
const SalesOrder = require('../models/sales');
const Transaction = require('../models/transactions');

const invoiceSchema = require('../validations/invoiceValidation');
const getNextSequence = require('../utils/getNextSequence');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { logAudit } = require('../utils/auditLog');

const invoicePopulateOptions = [
  { path: 'customer', select: 'name email phone' },
  { path: 'items.product', select: 'name productCode' },
];

exports.allInvoices = Crud.getAll(Invoice, invoicePopulateOptions);

exports.oneInvoice = catchAsync(async (req, res, next) => {
  const doc = await Invoice.findOne({ _id: req.params.id, ...req.tenantFilter })
    .populate({ path: 'customer', select: 'name email phone address' })
    .populate({ path: 'items.product', select: 'name productCode sellingPrice unit taxes costPrice' });

  if (!doc) return next(new AppError('No document found with that ID', 404));
  res.status(200).json({ status: 'success', data: { data: doc } });
});

exports.oneInvoiceByNum = catchAsync(async (req, res, next) => {
  const { invoiceNumber } = req.body;
  if (!invoiceNumber) return next(new AppError('invoiceNumber is required', 400));

  const doc = await Invoice.findOne({ invoiceNumber, ...req.tenantFilter })
    .populate('items.product customer');

  if (!doc) return next(new AppError(`Invoice not found: ${invoiceNumber}`, 404));
  res.status(200).json({ status: 'success', data: { data: doc } });
});

// ── Helpers ──────────────────────────────────────────────────

const getProductsAndStocks = async (items, companyId, session) => {
  const productNames = items.map((i) => i.product);
  const products = await Product.find({ name: { $in: productNames }, company: companyId }).session(session);

  if (products.length !== productNames.length) {
    const found = products.map((p) => p.name);
    const missing = productNames.filter((n) => !found.includes(n));
    throw new AppError(`Products not found: ${missing.join(', ')}`, 404);
  }

  const productMap = new Map(products.map((p) => [p.name, p]));
  const productIds = products.map((p) => p._id);
  const stocks = await Stock.find({ product: { $in: productIds }, company: companyId })
    .populate('product')
    .session(session);
  const stockMap = new Map(stocks.map((s) => [s.product._id.toString(), s]));

  return { productMap, stockMap };
};

const processInvoiceItems = (items, productMap, stockMap) => {
  const processedItems = [];
  const stockUpdates = [];
  let subtotal = 0;

  for (const item of items) {
    if (item.quantity <= 0 || !Number.isInteger(item.quantity))
      throw new AppError(`Invalid quantity for product: ${item.product}`, 400);

    const product = productMap.get(item.product);
    if (!product) throw new AppError(`Product not found: ${item.product}`, 404);

    const stock = stockMap.get(product._id.toString());
    if (!stock) throw new AppError(`Stock not found for product: ${item.product}`, 404);

    if (stock.quantity < item.quantity)
      throw new AppError(`Insufficient stock for ${product.name}. Available: ${stock.quantity}`, 400);

    const unitPrice = (item.unitPrice !== undefined && item.unitPrice !== null) ? Number(item.unitPrice) : product.sellingPrice;
    if (isNaN(unitPrice) || unitPrice < 0) throw new AppError(`Invalid unit price for product: ${item.product}`, 400);

    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;

    processedItems.push({ product: product._id, quantity: item.quantity, unitPrice, taxRate: product.taxes || 0, lineTotal });
    stockUpdates.push({ updateOne: { filter: { _id: stock._id }, update: { $inc: { quantity: -item.quantity }, $set: { lastStockUpdate: new Date() } } } });
  }

  return { processedItems, stockUpdates, subtotal };
};

const calculateTotals = (subtotal, discount, amount) => {
  let discountAmount = 0;
  if (discount) {
    if (discount < 0 || discount > 100) throw new AppError('Discount must be between 0 and 100.', 400);
    discountAmount = subtotal * (discount / 100);
  }
  const totalAfterDiscount = subtotal - discountAmount;
  if (amount > totalAfterDiscount)
    throw new AppError(`Payment (${amount}) exceeds invoice total (${totalAfterDiscount})`, 400);
  return { discountAmount, totalAfterDiscount, remaining: totalAfterDiscount - amount };
};

const buildTransactions = (invoice, subtotal, discountAmount, discount, amount, companyId) => {
  const txns = [
    { type: 'invoice', referenceId: invoice._id, amount: subtotal, company: companyId,
      details: `Invoice #${invoice.formattedInvoiceNumber} created`,
      items: invoice.items.map((i) => ({ product: i.product, quantity: i.quantity, price: i.unitPrice })),
      status: 'debit' },
  ];
  if (discountAmount > 0)
    txns.push({ type: 'discount', referenceId: invoice._id, amount: discountAmount, company: companyId,
      details: `Discount ${discount}% on invoice #${invoice.formattedInvoiceNumber}`, items: [], status: 'credit' });
  if (amount > 0)
    txns.push({ type: 'payment', referenceId: invoice._id, amount, company: companyId,
      details: `Payment ${amount} for invoice #${invoice.formattedInvoiceNumber}`, items: [], status: 'credit' });
  return txns;
};

// ─── Create Invoice ───────────────────────────────────────────
exports.createInvoice = catchAsync(async (req, res, next) => {
  const { error } = invoiceSchema.validate(req.body, { abortEarly: false });
  if (error) return next(new AppError(error.details.map((d) => d.message).join(', '), 400));

  const { name, email, phone, items, amount = 0, discount } = req.body;
  const companyId = req.companyId;

  if (amount < 0) return next(new AppError('Payment amount cannot be negative', 400));

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let customer = await Customer.findOne({ name, company: companyId }).session(session);
    if (!customer) {
      if (!email || !phone) throw new AppError('Email and phone required for new customers.', 400);
      customer = new Customer({ name, email, phone, company: companyId });
      await customer.save({ session });
    }

    const { productMap, stockMap } = await getProductsAndStocks(items, companyId, session);
    const { processedItems, stockUpdates, subtotal } = processInvoiceItems(items, productMap, stockMap);
    if (stockUpdates.length) await Stock.bulkWrite(stockUpdates, { session });

    const { discountAmount, totalAfterDiscount, remaining } = calculateTotals(subtotal, discount, amount);

    const invoiceNumber = await getNextSequence('invoice', companyId, session);
    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = new Invoice({
      invoiceNumber, customer: customer._id, company: companyId,
      items: processedItems, subtotal, taxAmount: 0, discountAmount,
      totalAmount: totalAfterDiscount, amountPaid: amount, balanceDue: remaining,
      issueDate, dueDate, paymentTerms: 'net_30',
    });
    await invoice.save({ session });

    // Sales orders
    for (const item of processedItems) {
      let so = await SalesOrder.findOne({ product: item.product, company: companyId }).session(session);
      if (so) {
        so.count += item.quantity;
        so.subtotal += item.lineTotal;
        so.invoiceSales.push({ invoice: invoice._id, quantity: item.quantity, subtotal: item.lineTotal });
        so.lastUpdateDate = new Date();
        await so.save({ session });
      } else {
        const orderNumber = await getNextSequence('salesOrder', companyId, session);
        await SalesOrder.create([{
          orderNumber, customer: customer._id, product: item.product, company: companyId,
          count: item.quantity, subtotal: item.lineTotal,
          invoiceSales: [{ invoice: invoice._id, quantity: item.quantity, subtotal: item.lineTotal }],
        }], { session });
      }
    }

    let payment = null;
    if (amount > 0) {
      payment = new Payment({ customer: customer._id, customerName: name, amount, invoice: invoice._id, company: companyId, status: 'Success' });
      await payment.save({ session });
    }

    const txns = buildTransactions(invoice, subtotal, discountAmount, discount, amount, companyId);
    const createdTxns = await Transaction.insertMany(txns, { session });

    customer.transactions.push(...createdTxns.map((t) => t._id));
    customer.invoice.push(invoice._id);
    if (payment) customer.payment.push(payment._id);
    customer.outstandingBalance += remaining;
    customer.balance += remaining;
    await customer.save({ session });

    await session.commitTransaction();

    logAudit({
      req,
      action: 'CREATE',
      module: 'INVOICE',
      entityId: invoice._id,
      entityLabel: invoice.formattedInvoiceNumber,
      newValues: { customer: customer.name, totalAmount: invoice.totalAmount, items: processedItems.length },
    });

    res.status(201).json({
      status: 'success',
      message: 'Invoice created successfully',
      data: { ...invoice.toObject(), customer: { name: customer.name, phone: customer.phone, email: customer.email } },
    });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    console.error('Invoice creation error:', err);
    next(new AppError('Something went wrong during invoice creation', 500));
  } finally {
    session.endSession();
  }
});

// ─── Delete Invoice ──────────────────────────────────────────
exports.deleteInvoice = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const companyId = req.companyId;

  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, company: companyId })
      .populate('customer').populate('items.product').session(session);

    if (!invoice) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Invoice not found', 404));
    }

    if (invoice.customer) {
      const customer = invoice.customer;
      customer.outstandingBalance = (customer.outstandingBalance || 0) - invoice.balanceDue;
      customer.balance = (customer.balance || 0) - invoice.balanceDue;
      customer.invoice = (customer.invoice || []).filter((inv) => inv.toString() !== invoice._id.toString());

      const relatedPayments = await Payment.find({ invoice: invoice._id, company: companyId }).session(session);
      const paymentIds = relatedPayments.map((p) => p._id.toString());
      customer.payment = (customer.payment || []).filter((p) => !paymentIds.includes(p.toString()));

      const relatedTxns = await Transaction.find({ referenceId: invoice._id, company: companyId }).session(session);
      const txnIds = relatedTxns.map((t) => t._id.toString());
      customer.transactions = (customer.transactions || []).filter((t) => !txnIds.includes(t.toString()));
      await customer.save({ session });
    }

    // Revert stock
    const stockReverts = invoice.items
      .filter((i) => i.product?._id)
      .map((i) => ({ updateOne: { filter: { product: i.product._id, company: companyId }, update: { $inc: { quantity: i.quantity }, $set: { lastStockUpdate: new Date() } } } }));
    if (stockReverts.length) await Stock.bulkWrite(stockReverts, { session });

    // Revert sales orders
    for (const item of invoice.items) {
      if (!item.product?._id) continue;
      const so = await SalesOrder.findOne({ product: item.product._id, company: companyId }).session(session);
      if (so?.invoiceSales) {
        const idx = so.invoiceSales.findIndex((is) => is.invoice.toString() === invoice._id.toString());
        if (idx > -1) {
          so.count -= so.invoiceSales[idx].quantity;
          so.subtotal -= so.invoiceSales[idx].subtotal;
          so.invoiceSales.splice(idx, 1);
          if (so.count <= 0) await SalesOrder.deleteOne({ _id: so._id }).session(session);
          else { so.lastUpdateDate = new Date(); await so.save({ session }); }
        }
      }
    }

    await Payment.deleteMany({ invoice: invoice._id, company: companyId }, { session });
    await Transaction.deleteMany({ referenceId: invoice._id, company: companyId }, { session });
    // Soft-delete the invoice to preserve audit history
    await Invoice.findOneAndUpdate(
      { _id: invoice._id, company: companyId },
      { isDeleted: true, deletedAt: new Date(), deletedBy: req.user._id },
      { session }
    );

    await session.commitTransaction();

    logAudit({
      req,
      action: 'DELETE',
      module: 'INVOICE',
      entityId: invoice._id,
      entityLabel: invoice.formattedInvoiceNumber,
      oldValues: { totalAmount: invoice.totalAmount, status: invoice.status },
    });

    res.status(200).json({ status: 'success', message: 'Invoice and all related data deleted successfully' });
  } catch (err) {
    await session.abortTransaction();
    next(new AppError('Something went wrong during invoice deletion.', 500));
  } finally {
    session.endSession();
  }
});

// ─── Update Invoice Status ────────────────────────────────────
exports.updateInvoiceStatus = catchAsync(async (req, res, next) => {
  const VALID = ['draft','issued','paid','partially_paid','overdue','cancelled','refunded'];
  const { status, paymentAmount } = req.body;
  if (!status || !VALID.includes(status)) return next(new AppError(`Invalid status. Must be one of: ${VALID.join(', ')}`, 400));

  const session = await mongoose.startSession();
  session.startTransaction();
  const companyId = req.companyId;

  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, company: companyId })
      .populate('customer').session(session);
    if (!invoice) throw new AppError('Invoice not found', 404);
    if (['cancelled','refunded'].includes(invoice.status)) throw new AppError('Cannot modify a cancelled or refunded invoice', 400);

    if (status === 'paid' && paymentAmount) {
      if (paymentAmount <= 0) throw new AppError('Payment amount must be positive', 400);
      if (paymentAmount > invoice.balanceDue) throw new AppError('Payment amount exceeds balance due', 400);

      invoice.amountPaid += paymentAmount;
      invoice.balanceDue -= paymentAmount;

      const payment = new Payment({ customer: invoice.customer._id, customerName: invoice.customer.name, amount: paymentAmount, invoice: invoice._id, company: companyId, status: 'Success' });
      await payment.save({ session });

      const txn = new Transaction({ type: 'payment', referenceId: invoice._id, amount: paymentAmount, company: companyId,
        details: `Payment ${paymentAmount} for invoice #${invoice.formattedInvoiceNumber}`, items: [], status: 'credit' });
      await txn.save({ session });

      const customer = invoice.customer;
      customer.outstandingBalance = (customer.outstandingBalance || 0) - paymentAmount;
      customer.balance = (customer.balance || 0) - paymentAmount;
      customer.payment.push(payment._id);
      customer.transactions.push(txn._id);
      await customer.save({ session });
    } else {
      if (status === 'cancelled') {
        const inv2 = await Invoice.findOne({ _id: req.params.id, company: companyId }).populate('items.product').session(session);
        const reverts = inv2.items.filter((i) => i.product?._id).map((i) => ({
          updateOne: { filter: { product: i.product._id, company: companyId }, update: { $inc: { quantity: i.quantity }, $set: { lastStockUpdate: new Date() } } }
        }));
        if (reverts.length) await Stock.bulkWrite(reverts, { session });
        const customer = invoice.customer;
        if (customer) {
          customer.outstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - invoice.balanceDue);
          customer.balance = Math.max(0, (customer.balance || 0) - invoice.balanceDue);
          await customer.save({ session });
        }
      }
      invoice.status = status;
    }

    await invoice.save({ session });
    await session.commitTransaction();

    logAudit({
      req,
      action: 'STATUS_CHANGE',
      module: 'INVOICE',
      entityId: invoice._id,
      entityLabel: invoice.formattedInvoiceNumber,
      oldValues: { status: invoice.status },
      newValues: { status, paymentAmount },
    });

    res.status(200).json({ status: 'success', message: 'Invoice status updated', data: { invoice } });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during status update', 500));
  } finally {
    session.endSession();
  }
});

// ─── Update Invoice ────────────────────────────────────────────────────────────
// Allows editing of: notes, discount, amount (additional payment), status.
// Items and customer are immutable once an invoice is issued (stock already deducted).
// To change items/customer: delete the invoice and create a new one.
exports.updateInvoice = catchAsync(async (req, res, next) => {
  const companyId = req.companyId;
  const { notes, discount, amount, status } = req.body;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, company: companyId, isDeleted: { $ne: true } })
      .populate('customer')
      .session(session);

    if (!invoice) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Invoice not found', 404));
    }

    if (['cancelled', 'refunded'].includes(invoice.status)) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Cannot modify a cancelled or refunded invoice', 400));
    }

    // ── Update simple fields ──────────────────────────────────────────
    if (notes !== undefined) invoice.notes = notes;

    // ── Re-calculate discount ─────────────────────────────────────────
    if (discount !== undefined && discount !== null) {
      const newDiscount = parseFloat(discount);
      if (isNaN(newDiscount) || newDiscount < 0 || newDiscount > 100) {
        await session.abortTransaction();
        session.endSession();
        return next(new AppError('Discount must be between 0 and 100', 400));
      }
      const oldDiscountAmount = invoice.discountAmount || 0;
      const newDiscountAmount = invoice.subtotal * (newDiscount / 100);
      const discountDiff = newDiscountAmount - oldDiscountAmount;

      invoice.discountAmount = newDiscountAmount;
      invoice.totalAmount    = invoice.subtotal - newDiscountAmount;
      invoice.balanceDue     = Math.max(0, invoice.balanceDue - discountDiff);

      // Record discount adjustment transaction if discount changed
      if (Math.abs(discountDiff) > 0.001) {
        const txn = new Transaction({
          type: 'discount',
          referenceId: invoice._id,
          amount: Math.abs(discountDiff),
          company: companyId,
          details: `Discount updated to ${newDiscount}% on invoice #${invoice.formattedInvoiceNumber}`,
          items: [],
          status: discountDiff > 0 ? 'credit' : 'debit',
        });
        await txn.save({ session });
        if (invoice.customer) {
          const customer = invoice.customer;
          customer.outstandingBalance = (customer.outstandingBalance || 0) - discountDiff;
          customer.balance            = (customer.balance || 0) - discountDiff;
          customer.transactions.push(txn._id);
          await customer.save({ session });
        }
      }
    }

    // ── Apply additional payment ──────────────────────────────────────
    if (amount !== undefined && amount !== null) {
      const paymentAmount = parseFloat(amount);
      if (!isNaN(paymentAmount) && paymentAmount > 0) {
        if (paymentAmount > invoice.balanceDue) {
          await session.abortTransaction();
          session.endSession();
          return next(new AppError(`Payment (${paymentAmount}) exceeds balance due (${invoice.balanceDue})`, 400));
        }

        invoice.amountPaid += paymentAmount;
        invoice.balanceDue  = Math.max(0, invoice.balanceDue - paymentAmount);

        const payment = new Payment({
          customer:     invoice.customer._id,
          customerName: invoice.customer.name,
          amount:       paymentAmount,
          invoice:      invoice._id,
          company:      companyId,
          status:       'Success',
        });
        await payment.save({ session });

        const txn = new Transaction({
          type:        'payment',
          referenceId: invoice._id,
          amount:      paymentAmount,
          company:     companyId,
          details:     `Payment ${paymentAmount} for invoice #${invoice.formattedInvoiceNumber}`,
          items:       [],
          status:      'credit',
        });
        await txn.save({ session });

        const customer = invoice.customer;
        customer.outstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - paymentAmount);
        customer.balance            = Math.max(0, (customer.balance || 0) - paymentAmount);
        customer.payment.push(payment._id);
        customer.transactions.push(txn._id);
        await customer.save({ session });
      }
    }

    // ── Override status if explicitly requested ────────────────────────
    const VALID_STATUSES = ['draft', 'issued', 'paid', 'partially_paid', 'overdue', 'cancelled', 'refunded'];
    if (status && VALID_STATUSES.includes(status)) {
      invoice.status = status;
    }

    await invoice.save({ session });
    await session.commitTransaction();

    logAudit({
      req,
      action: 'UPDATE',
      module: 'INVOICE',
      entityId: invoice._id,
      entityLabel: invoice.formattedInvoiceNumber,
      newValues: { notes, discount, amount, status },
    });

    const updated = await Invoice.findById(invoice._id)
      .populate({ path: 'customer', select: 'name email phone' })
      .populate({ path: 'items.product', select: 'name productCode' });

    res.status(200).json({ status: 'success', message: 'Invoice updated successfully', data: { data: updated } });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    console.error('Invoice update error:', err);
    next(new AppError('Something went wrong during invoice update', 500));
  } finally {
    session.endSession();
  }
});

