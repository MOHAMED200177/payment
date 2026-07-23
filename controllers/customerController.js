'use strict';
const Customer = require('../models/customer');
const Crud = require('./crudFactory');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

// Basic CRUD — crudFactory now handles tenant scoping via req.tenantFilter
exports.allCustomer   = Crud.getAll(Customer);
exports.createCustomer = Crud.createOne(Customer);
exports.updateCustomer = Crud.updateOne(Customer);
exports.oneCustomerId  = Crud.getOneById(Customer);

exports.oneCustomer = Crud.getOneByField(Customer, 'name', [
  { path: 'invoice',       select: 'invoiceNumber totalAmount status' },
  { path: 'returns',       select: 'quantity refundAmount date' },
  { path: 'payment',       select: 'amount method date' },
  { path: 'transactions',  select: 'type amount status date' },
]);

// ============================================================
// Customer Statement — tenant-scoped, accounting-accurate ledger
// ============================================================
exports.getCustomerStatement = catchAsync(async (req, res, next) => {
  const Invoice    = require('../models/invoice');
  const Payment    = require('../models/payment');
  const Return     = require('../models/return');

  const { name, startDate, endDate } = req.body;
  if (!name) return next(new AppError('Customer name is required', 400));

  const customer = await Customer.findOne({ name, ...req.tenantFilter }).lean();
  if (!customer) return next(new AppError('Customer not found', 404));

  const companyId = req.companyId;
  const customerId = customer._id;

  // Date range helper
  const buildDateRange = (start, end) => {
    const dr = {};
    if (start) dr.$gte = new Date(start);
    if (end) { const e = new Date(end); e.setHours(23, 59, 59, 999); dr.$lte = e; }
    return Object.keys(dr).length ? dr : null;
  };
  const dr = buildDateRange(startDate, endDate);

  // Fetch all data
  const invoiceMatch = { customer: customerId, company: companyId, isDeleted: { $ne: true } };
  if (dr) invoiceMatch.issueDate = dr;

  const paymentMatch = { customer: customerId, company: companyId };
  if (dr) paymentMatch.date = dr;

  const returnMatch = { customer: customerId, company: companyId, isDeleted: { $ne: true }, status: { $ne: 'cancelled' } };
  if (dr) returnMatch.date = dr;

  const [invoices, payments, returns] = await Promise.all([
    Invoice.find(invoiceMatch)
      .populate({ path: 'items.product', select: 'name productCode unit' })
      .select('invoiceNumber issueDate dueDate totalAmount subtotal discountAmount taxAmount amountPaid balanceDue status items notes')
      .sort('issueDate').lean(),
    Payment.find(paymentMatch)
      .populate({ path: 'invoice', select: 'invoiceNumber' })
      .select('amount method date status invoice notes').sort('date').lean(),
    Return.find(returnMatch)
      .populate({ path: 'product', select: 'name productCode unit' })
      .populate({ path: 'invoice', select: 'invoiceNumber' })
      .select('refundAmount date invoice product quantity reason status').sort('date').lean(),
  ]);

  // Opening balance for date-filtered views
  let openingBalance = 0;
  if (dr && dr.$gte) {
    const beforeStart = { customer: customerId, company: companyId };
    const [pInv, pPay, pRet] = await Promise.all([
      Invoice.find({ ...beforeStart, issueDate: { $lt: dr.$gte }, isDeleted: { $ne: true } }).select('totalAmount').lean(),
      Payment.find({ ...beforeStart, date: { $lt: dr.$gte }, status: { $ne: 'Failed' } }).select('amount').lean(),
      Return.find({ ...beforeStart, date: { $lt: dr.$gte }, isDeleted: { $ne: true }, status: { $ne: 'cancelled' } }).select('refundAmount').lean(),
    ]);
    openingBalance = +(pInv.reduce((s, i) => s + i.totalAmount, 0) - pPay.reduce((s, p) => s + p.amount, 0) - pRet.reduce((s, r) => s + r.refundAmount, 0)).toFixed(2);
  }

  // Build ledger entries
  const entries = [];

  invoices.forEach((inv) => {
    const invRef = `INV-${String(inv.invoiceNumber).padStart(6, '0')}`;
    entries.push({
      date: inv.issueDate,
      type: 'Sales Invoice',
      typeKey: 'invoice',
      reference: invRef,
      referenceId: inv._id,
      description: `Sales Invoice ${invRef}${inv.notes ? ` — ${inv.notes}` : ''}`,
      invoiceNumber: invRef,
      paymentRef: null,
      debit: inv.totalAmount,
      credit: 0,
      status: inv.status,
      subtotal: inv.subtotal,
      discountAmount: inv.discountAmount || 0,
      taxAmount: inv.taxAmount || 0,
      items: (inv.items || []).map((item) => ({
        productName: item.product?.name || 'Unknown',
        productCode: item.product?.productCode || '',
        unit: item.product?.unit || '',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        taxRate: item.taxRate || 0,
      })),
    });
  });

  payments.forEach((pay) => {
    if (pay.status === 'Failed') return;
    const payRef = `PAY-${String(pay._id).slice(-8).toUpperCase()}`;
    const invRef = pay.invoice ? `INV-${String(pay.invoice.invoiceNumber).padStart(6, '0')}` : null;
    entries.push({
      date: pay.date,
      type: 'Payment Received',
      typeKey: 'payment',
      reference: payRef,
      referenceId: pay._id,
      description: `Payment received via ${pay.method || 'Cash'}${invRef ? ` for ${invRef}` : ''}${pay.notes ? ` — ${pay.notes}` : ''}`,
      invoiceNumber: invRef,
      paymentRef: payRef,
      method: pay.method || 'Cash',
      debit: 0,
      credit: pay.amount,
      status: pay.status,
      items: [],
    });
  });

  returns.forEach((ret) => {
    const retRef = `RET-${String(ret._id).slice(-8).toUpperCase()}`;
    const invRef = ret.invoice ? `INV-${String(ret.invoice.invoiceNumber).padStart(6, '0')}` : null;
    const productName = ret.product?.name || 'Unknown';
    entries.push({
      date: ret.date,
      type: 'Sales Return',
      typeKey: 'return',
      reference: retRef,
      referenceId: ret._id,
      description: `Sales return — ${productName} (Qty: ${ret.quantity})${invRef ? ` from ${invRef}` : ''}${ret.reason ? ` — Reason: ${ret.reason}` : ''}`,
      invoiceNumber: invRef,
      paymentRef: null,
      debit: 0,
      credit: ret.refundAmount,
      status: ret.status,
      items: [{
        productName,
        productCode: ret.product?.productCode || '',
        unit: ret.product?.unit || '',
        quantity: ret.quantity,
        unitPrice: ret.quantity > 0 ? +(ret.refundAmount / ret.quantity).toFixed(2) : 0,
        lineTotal: ret.refundAmount,
        taxRate: 0,
      }],
    });
  });

  // Sort: chronological, within same timestamp: invoices → payments → returns
  const typeOrder = { invoice: 1, payment: 2, return: 3 };
  entries.sort((a, b) => {
    const diff = new Date(a.date) - new Date(b.date);
    return diff !== 0 ? diff : (typeOrder[a.typeKey] || 9) - (typeOrder[b.typeKey] || 9);
  });

  // Running balance from opening
  let runningBalance = openingBalance;
  entries.forEach((entry) => {
    runningBalance += entry.debit - entry.credit;
    entry.balance  = +runningBalance.toFixed(2);
    entry.debit    = +entry.debit.toFixed(2);
    entry.credit   = +entry.credit.toFixed(2);
  });

  const totalDebit    = +entries.reduce((s, e) => s + e.debit, 0).toFixed(2);
  const totalCredit   = +entries.reduce((s, e) => s + e.credit, 0).toFixed(2);
  const closingBalance = +(openingBalance + totalDebit - totalCredit).toFixed(2);

  res.status(200).json({
    status: 'success',
    customer: {
      id: customer._id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address || null,
    },
    period: {
      startDate: dr?.$gte || null,
      endDate: dr?.$lte || null,
      generatedAt: new Date(),
    },
    summary: {
      openingBalance,
      totalDebit,
      totalCredit,
      closingBalance,
      outstandingBalance: +(customer.outstandingBalance || 0).toFixed(2),
      totalInvoices: invoices.length,
      totalPayments: payments.filter(p => p.status !== 'Failed').length,
      totalReturns: returns.length,
    },
    entries,
  });
});


// ============================================================
// Delete Customer (Soft Delete)
// ============================================================
exports.deleteCustomer = catchAsync(async (req, res, next) => {
  const Invoice = require('../models/invoice');
  const { logAudit } = require('../utils/auditLog');

  const customer = await Customer.findOne({ _id: req.params.id, ...req.tenantFilter, isDeleted: { $ne: true } });
  if (!customer) return next(new AppError('Customer not found', 404));

  // Prevent deletion if there is an outstanding balance
  if (customer.outstandingBalance > 0) {
    return next(new AppError(`Cannot delete customer. They have an outstanding balance of ${customer.outstandingBalance}.`, 400));
  }

  // Prevent deletion if there are active invoices (issued, partially_paid, overdue)
  const activeInvoices = await Invoice.countDocuments({
    customer: customer._id,
    company: req.companyId,
    status: { $in: ['issued', 'partially_paid', 'overdue'] },
    isDeleted: { $ne: true }
  });

  if (activeInvoices > 0) {
    return next(new AppError(`Cannot delete customer. They have ${activeInvoices} active invoice(s).`, 400));
  }

  customer.isDeleted = true;
  customer.deletedAt = new Date();
  if (req.user) customer.deletedBy = req.user._id;
  await customer.save();

  logAudit({
    req,
    action: 'SOFT_DELETE',
    module: 'CUSTOMER',
    entityId: customer._id,
    entityLabel: customer.name,
    oldValues: { isDeleted: false },
  });

  res.status(200).json({ status: 'success', message: 'Customer deleted successfully' });
});
