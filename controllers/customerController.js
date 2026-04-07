const Customer = require('../models/customer');
const Crud = require('./crudFactory');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

// ============================================================
// Basic CRUD
// ============================================================
exports.allCustomer = Crud.getAll(Customer);
exports.createCustomer = Crud.createOne(Customer);
exports.updateCustomer = Crud.updateOne(Customer);
exports.deleteCustomer = Crud.deleteOne(Customer);

exports.oneCustomer = Crud.getOneByField(Customer, 'name', [
  { path: 'invoice', select: 'invoiceNumber totalAmount status' },
  { path: 'returns', select: 'quantity refundAmount date' },
  { path: 'payment', select: 'amount method date' },
  { path: 'transactions', select: 'type amount status date' },
]);

exports.oneCustomerId = Crud.getOneById(Customer);

// ============================================================
// Customer Statement
// ============================================================
exports.getCustomerStatement = catchAsync(async (req, res, next) => {
  // ✅ Validate
  const { name } = req.body;
  if (!name) {
    return next(new AppError('Customer name is required', 400));
  }

  // ✅ populate مع product details
  const customer = await Customer.findOne({ name })
    .populate({
      path: 'transactions',
      populate: {
        path: 'items.product',
        select: 'name productCode',
      },
    })
    .lean();

  if (!customer) {
    return next(new AppError('Customer not found', 404));
  }

  const transactions = customer.transactions || [];

  let totalDebit = 0;
  let totalCredit = 0;

  const transactionDetails = transactions.map((transaction) => {
    if (transaction.status === 'debit') {
      totalDebit += transaction.amount;
    } else if (transaction.status === 'credit') {
      totalCredit += transaction.amount;
    }

    const itemsDetails = (transaction.items || []).map((item) => ({
      product: item.product?.name || 'N/A',
      productCode: item.product?.productCode || 'N/A',
      quantity: item.quantity,
      price: item.price,
    }));

    return {
      id: transaction._id,
      type: transaction.type,
      referenceId: transaction.referenceId,
      amount: transaction.amount,
      details: transaction.details,
      status: transaction.status,
      date: transaction.date,
      items: itemsDetails,
    };
  });

  // ✅ الرصيد = debit - credit (المتبقي على العميل)
  const outstandingBalance = totalDebit - totalCredit;

  res.status(200).json({
    status: 'success',
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address || 'N/A',
    },
    totals: {
      totalDebit,
      totalCredit,
      outstandingBalance, // ✅ اسم أوضح
    },
    transactions: transactionDetails,
  });
});
