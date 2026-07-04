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
// Customer Statement — tenant-scoped
// ============================================================
exports.getCustomerStatement = catchAsync(async (req, res, next) => {
  const { name } = req.body;
  if (!name) return next(new AppError('Customer name is required', 400));

  const customer = await Customer.findOne({ name, ...req.tenantFilter })
    .populate({
      path: 'transactions',
      populate: { path: 'items.product', select: 'name productCode' },
    })
    .lean();

  if (!customer) return next(new AppError('Customer not found', 404));

  const transactions = customer.transactions || [];
  let totalDebit = 0;
  let totalCredit = 0;

  const transactionDetails = transactions.map((t) => {
    if (t.status === 'debit')  totalDebit  += t.amount;
    if (t.status === 'credit') totalCredit += t.amount;

    return {
      id: t._id,
      type: t.type,
      referenceId: t.referenceId,
      amount: t.amount,
      details: t.details,
      status: t.status,
      date: t.date,
      items: (t.items || []).map((item) => ({
        product:     item.product?.name || 'N/A',
        productCode: item.product?.productCode || 'N/A',
        quantity:    item.quantity,
        price:       item.price,
      })),
    };
  });

  res.status(200).json({
    status: 'success',
    customer: {
      name:    customer.name,
      email:   customer.email,
      phone:   customer.phone,
      address: customer.address || 'N/A',
    },
    totals: {
      totalDebit,
      totalCredit,
      outstandingBalance: totalDebit - totalCredit,
    },
    transactions: transactionDetails,
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
