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



const invoicePopulateOptions = [
  { path: 'customer', select: 'name email phone' },
  { path: 'items.product', select: 'name productCode' },
];


exports.allInvoices = Crud.getAll(Invoice, invoicePopulateOptions);

/** Full invoice detail for ERP UI — customer + line products */
exports.oneInvoice = catchAsync(async (req, res, next) => {
  const doc = await Invoice.findById(req.params.id)
    .populate({ path: 'customer', select: 'name email phone address' })
    .populate({
      path: 'items.product',
      select: 'name productCode sellingPrice unit taxes costPrice',
    });

  if (!doc) {
    return next(new AppError('No document found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { data: doc },
  });
});

exports.oneInvoiceByNum = Crud.getOneByField(Invoice, 'invoiceNumber', {
  path: 'items.product customer',
  select: 'name price productCode email phone',
});


const getProductsAndStocks = async (items, session) => {
  const productNames = items.map((item) => item.product);

  const products = await Product.find({
    name: { $in: productNames },
  }).session(session);

  if (products.length !== productNames.length) {
    const foundNames = products.map((p) => p.name);
    const missing = productNames.filter((n) => !foundNames.includes(n));
    throw new AppError(`Products not found: ${missing.join(', ')}`, 404);
  }

  const productMap = new Map(products.map((p) => [p.name, p]));
  const productIds = products.map((p) => p._id);

  const stocks = await Stock.find({ product: { $in: productIds } })
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
    if (item.quantity <= 0 || !Number.isInteger(item.quantity)) {
      throw new AppError(`Invalid quantity for product: ${item.product}`, 400);
    }

    const product = productMap.get(item.product);
    if (!product) {
      throw new AppError(`Product not found: ${item.product}`, 404);
    }

    const stock = stockMap.get(product._id.toString());
    if (!stock) {
      throw new AppError(`Stock not found for product: ${item.product}`, 404);
    }

    if (stock.quantity < item.quantity) {
      throw new AppError(
        `Insufficient stock for ${product.name}. Available: ${stock.quantity}`,
        400
      );
    }

    const lineTotal = product.sellingPrice * item.quantity;
    subtotal += lineTotal;

    processedItems.push({
      product: product._id,
      quantity: item.quantity,
      unitPrice: product.sellingPrice,
      taxRate: product.taxes || 0,
      lineTotal,
    });

    stockUpdates.push({
      updateOne: {
        filter: { _id: stock._id },
        update: {
          $inc: { quantity: -item.quantity },
          $set: { lastStockUpdate: new Date() },
        },
      },
    });
  }

  return { processedItems, stockUpdates, subtotal };
};

/**
 * حساب الـ discount والـ totals
 */
const calculateTotals = (subtotal, discount, amount) => {
  let discountAmount = 0;

  if (discount) {
    if (discount < 0 || discount > 100) {
      throw new AppError('Discount must be between 0 and 100.', 400);
    }
    discountAmount = subtotal * (discount / 100);
  }

  const totalAfterDiscount = subtotal - discountAmount;

  if (amount > totalAfterDiscount) {
    throw new AppError(
      `Payment amount (${amount}) exceeds total invoice amount (${totalAfterDiscount})`,
      400
    );
  }

  const remaining = totalAfterDiscount - amount;

  return { discountAmount, totalAfterDiscount, remaining };
};

/**
 * بناء الـ transactions array
 */
const buildTransactions = (
  invoice,
  subtotal,
  discountAmount,
  discount,
  amount
) => {
  const transactions = [
    {
      type: 'invoice',
      referenceId: invoice._id,
      amount: subtotal,
      details: `Invoice #${invoice.formattedInvoiceNumber} created with total ${subtotal}`,
      items: invoice.items.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        price: item.unitPrice,
      })),
      status: 'debit',
    },
  ];

  if (discountAmount > 0) {
    transactions.push({
      type: 'discount',
      referenceId: invoice._id,
      amount: discountAmount,
      details: `Discount of ${discount}% applied to invoice #${invoice.formattedInvoiceNumber}`,
      items: [],
      status: 'credit',
    });
  }

  if (amount > 0) {
    transactions.push({
      type: 'payment',
      referenceId: invoice._id,
      amount,
      details: `Payment of ${amount} received for invoice #${invoice.formattedInvoiceNumber}`,
      items: [],
      status: 'credit',
    });
  }

  return transactions;
};

// ============================================================
// Create Invoice
// ============================================================
exports.createInvoice = catchAsync(async (req, res, next) => {
  // ✅ 1 - Validate قبل فتح Session
  const { error } = invoiceSchema.validate(req.body, { abortEarly: false });
  if (error) {
    const messages = error.details.map((d) => d.message).join(', ');
    return next(new AppError(messages, 400));
  }

  const { name, email, phone, items, amount, discount } = req.body;

  if (amount < 0) {
    return next(new AppError('Payment amount cannot be negative', 400));
  }

  // ✅ 2 - افتح الـ Session بعد الـ Validation
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ─────────────────────────────────────
    // Handle Customer
    // ─────────────────────────────────────
    let customer = await Customer.findOne({ name }).session(session);

    if (!customer) {
      if (!email || !phone) {
        throw new AppError(
          'Email and phone are required for new customers.',
          400
        );
      }
      customer = new Customer({ name, email, phone });
      await customer.save({ session });
    } else {
      let customerUpdated = false;
      if (email && customer.email !== email) {
        customer.email = email;
        customerUpdated = true;
      }
      if (phone && customer.phone !== phone) {
        customer.phone = phone;
        customerUpdated = true;
      }
      if (customerUpdated) {
        await customer.save({ session });
      }
    }

    // ─────────────────────────────────────
    // Process Items & Update Stock
    // ─────────────────────────────────────
    const { productMap, stockMap } = await getProductsAndStocks(items, session);
    const { processedItems, stockUpdates, subtotal } = processInvoiceItems(
      items,
      productMap,
      stockMap
    );

    if (stockUpdates.length > 0) {
      await Stock.bulkWrite(stockUpdates, { session });
    }

    // ─────────────────────────────────────
    // Calculate Totals
    // ─────────────────────────────────────
    const { discountAmount, totalAfterDiscount, remaining } = calculateTotals(
      subtotal,
      discount,
      amount
    );

    // ─────────────────────────────────────
    // Generate Invoice Number
    // ─────────────────────────────────────
    let invoiceNumber;
    try {
      invoiceNumber = await getNextSequence('invoice', session);
    } catch (err) {
      throw new AppError('Failed to generate invoice number.', 500);
    }

    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 30);

    // ─────────────────────────────────────
    // Create Invoice
    // ─────────────────────────────────────
    const invoice = new Invoice({
      invoiceNumber,
      customer: customer._id,
      items: processedItems,
      subtotal,
      taxAmount: 0,
      discountAmount,
      totalAmount: totalAfterDiscount,
      amountPaid: amount,
      balanceDue: remaining,
      issueDate,
      dueDate,
      paymentTerms: 'net_30',
    });

    await invoice.save({ session });

    // ─────────────────────────────────────
    // Create / Update Sales Orders
    // ✅ مع invoiceSales من الأول
    // ─────────────────────────────────────
    for (const item of processedItems) {
      let salesOrder = await SalesOrder.findOne({
        product: item.product,
      }).session(session);

      if (salesOrder) {
        salesOrder.count += item.quantity;
        salesOrder.subtotal += item.lineTotal;
        salesOrder.lastUpdateDate = new Date();

        // ✅ إضافة invoiceSales entry
        if (!Array.isArray(salesOrder.invoiceSales)) {
          salesOrder.invoiceSales = [];
        }
        salesOrder.invoiceSales.push({
          invoice: invoice._id,
          quantity: item.quantity,
          subtotal: item.lineTotal,
        });

        await salesOrder.save({ session });
      } else {
        let orderNumber;
        try {
          orderNumber = await getNextSequence('salesOrder', session);
        } catch (err) {
          throw new AppError('Failed to generate sales order number.', 500);
        }

        salesOrder = new SalesOrder({
          orderNumber,
          customer: customer._id,
          product: item.product,
          count: item.quantity,
          subtotal: item.lineTotal,
          // ✅ invoiceSales من الأول
          invoiceSales: [
            {
              invoice: invoice._id,
              quantity: item.quantity,
              subtotal: item.lineTotal,
            },
          ],
          lastUpdateDate: new Date(),
        });
        await salesOrder.save({ session });
      }
    }

    // ─────────────────────────────────────
    // Create Payment
    // ─────────────────────────────────────
    let payment = null;
    if (amount > 0) {
      payment = new Payment({
        customer: customer._id,
        customerName: name,
        amount,
        invoice: invoice._id,
        status: 'Success',
        method: 'Cash',
      });
      await payment.save({ session });
    }

    // ─────────────────────────────────────
    // Create Transactions
    // ─────────────────────────────────────
    const transactionsData = buildTransactions(
      invoice,
      subtotal,
      discountAmount,
      discount,
      amount
    );

    const createdTransactions = await Transaction.insertMany(transactionsData, {
      session,
    });

    // ─────────────────────────────────────
    // Update Customer
    // ─────────────────────────────────────
    customer.transactions.push(...createdTransactions.map((t) => t._id));
    customer.invoice.push(invoice._id);
    if (payment) customer.payment.push(payment._id);
    customer.outstandingBalance += remaining;
    customer.balance += remaining;

    await customer.save({ session });
    await session.commitTransaction();

    res.status(201).json({
      status: 'success',
      message: 'Invoice created successfully',
      invoice: {
        ...invoice.toObject(),
        customer: {
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
        },
      },
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Invoice creation error:', error);
    next(new AppError('Something went wrong during invoice creation', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Update Invoice
// ============================================================
exports.updateInvoice = catchAsync(async (req, res, next) => {
  // ✅ 1 - Validate قبل فتح Session
  const { error } = invoiceSchema.validate(req.body, { abortEarly: false });
  if (error) {
    const messages = error.details.map((d) => d.message).join(', ');
    return next(new AppError(messages, 400));
  }

  const { name, email, phone, items, amount, discount } = req.body;

  if (amount < 0) {
    return next(new AppError('Payment amount cannot be negative', 400));
  }

  // ✅ 2 - افتح الـ Session بعد الـ Validation
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const invoiceId = req.params.id;

    // ─────────────────────────────────────
    // Get Original Invoice
    // ─────────────────────────────────────
    const originalInvoice = await Invoice.findById(invoiceId)
      .populate('customer')
      .populate('items.product')
      .session(session);

    if (!originalInvoice) {
      throw new AppError('Invoice not found', 404);
    }

    // ─────────────────────────────────────
    // Revert Original Stock
    // ─────────────────────────────────────
    const originalStockReverts = originalInvoice.items.map((item) => ({
      updateOne: {
        filter: { product: item.product._id },
        update: {
          $inc: { quantity: item.quantity },
          $set: { lastStockUpdate: new Date() },
        },
      },
    }));

    if (originalStockReverts.length > 0) {
      await Stock.bulkWrite(originalStockReverts, { session });
    }

    // ─────────────────────────────────────
    // Handle Customer
    // ✅ مع تحديث الـ Customer القديم لو اتغير
    // ─────────────────────────────────────
    let customer = originalInvoice.customer;
    let customerUpdated = false;

    if (name && customer.name !== name) {
      const existingCustomer = await Customer.findOne({ name }).session(
        session
      );

      if (
        existingCustomer &&
        existingCustomer._id.toString() !== customer._id.toString()
      ) {
        // ✅ حدث الـ Customer القديم
        const oldCustomer = customer;
        oldCustomer.invoice = oldCustomer.invoice.filter(
          (inv) => inv.toString() !== invoiceId
        );
        oldCustomer.outstandingBalance =
          (oldCustomer.outstandingBalance || 0) - originalInvoice.balanceDue;
        oldCustomer.balance =
          (oldCustomer.balance || 0) - originalInvoice.balanceDue;
        await oldCustomer.save({ session });

        // ✅ انتقل للـ Customer الجديد
        customer = existingCustomer;
        if (!customer.invoice) customer.invoice = [];
        customer.invoice.push(invoiceId);
      } else {
        customer.name = name;
        customerUpdated = true;
      }
    }

    if (email && customer.email !== email) {
      customer.email = email;
      customerUpdated = true;
    }

    if (phone && customer.phone !== phone) {
      customer.phone = phone;
      customerUpdated = true;
    }

    if (customerUpdated) {
      await customer.save({ session });
    }

    // ─────────────────────────────────────
    // Process New Items & Update Stock
    // ─────────────────────────────────────
    const { productMap, stockMap } = await getProductsAndStocks(items, session);
    const { processedItems, stockUpdates, subtotal } = processInvoiceItems(
      items,
      productMap,
      stockMap
    );

    if (stockUpdates.length > 0) {
      await Stock.bulkWrite(stockUpdates, { session });
    }

    // ─────────────────────────────────────
    // Calculate New Totals
    // ─────────────────────────────────────
    const { discountAmount, totalAfterDiscount, remaining } = calculateTotals(
      subtotal,
      discount,
      amount
    );

    // ─────────────────────────────────────
    // Update Customer Balance
    // ─────────────────────────────────────
    customer.outstandingBalance =
      (customer.outstandingBalance || 0) -
      originalInvoice.balanceDue +
      remaining;
    customer.balance =
      (customer.balance || 0) - originalInvoice.balanceDue + remaining;

    // ─────────────────────────────────────
    // Update Invoice
    // ─────────────────────────────────────
    originalInvoice.customer = customer._id;
    originalInvoice.items = processedItems;
    originalInvoice.subtotal = subtotal;
    originalInvoice.discountAmount = discountAmount;
    originalInvoice.totalAmount = totalAfterDiscount;
    originalInvoice.amountPaid = amount;
    originalInvoice.balanceDue = remaining;

    await originalInvoice.save({ session });

    // ─────────────────────────────────────
    // Delete Old Transactions & Payments
    // ─────────────────────────────────────
    await Transaction.deleteMany({ referenceId: invoiceId }, { session });
    await Payment.deleteMany({ invoice: invoiceId }, { session });

    // ─────────────────────────────────────
    // Update Sales Orders
    // ─────────────────────────────────────
    const allProductIds = new Set([
      ...originalInvoice.items.map((item) => item.product._id.toString()),
      ...processedItems.map((item) => item.product.toString()),
    ]);

    const salesOrders = await SalesOrder.find({
      product: { $in: Array.from(allProductIds) },
    }).session(session);

    const salesOrderMap = new Map(
      salesOrders.map((so) => [so.product.toString(), so])
    );

    for (const productId of allProductIds) {
      let salesOrder = salesOrderMap.get(productId);

      const newItem = processedItems.find(
        (item) => item.product.toString() === productId
      );

      if (!salesOrder && newItem) {
        // ✅ إنشاء سجل جديد
        const orderNumber = await getNextSequence('salesOrder', session);
        salesOrder = new SalesOrder({
          orderNumber,
          customer: customer._id,
          product: productId,
          count: newItem.quantity,
          subtotal: newItem.lineTotal,
          invoiceSales: [
            {
              invoice: originalInvoice._id,
              quantity: newItem.quantity,
              subtotal: newItem.lineTotal,
            },
          ],
          lastUpdateDate: new Date(),
        });
        await salesOrder.save({ session });
        continue;
      }

      if (salesOrder) {
        // ✅ التأكد من وجود invoiceSales كـ array
        if (!Array.isArray(salesOrder.invoiceSales)) {
          salesOrder.invoiceSales = [];
        }

        // حذف السجل القديم
        const invoiceSaleIndex = salesOrder.invoiceSales.findIndex(
          (is) => is.invoice.toString() === originalInvoice._id.toString()
        );

        if (invoiceSaleIndex > -1) {
          const oldInvoiceSale = salesOrder.invoiceSales[invoiceSaleIndex];
          salesOrder.count -= oldInvoiceSale.quantity;
          salesOrder.subtotal -= oldInvoiceSale.subtotal;
          salesOrder.invoiceSales.splice(invoiceSaleIndex, 1);
        }

        // إضافة السجل الجديد
        if (newItem) {
          salesOrder.count += newItem.quantity;
          salesOrder.subtotal += newItem.lineTotal;
          salesOrder.invoiceSales.push({
            invoice: originalInvoice._id,
            quantity: newItem.quantity,
            subtotal: newItem.lineTotal,
          });
        }

        // تحديث أو حذف
        if (salesOrder.count <= 0) {
          await SalesOrder.deleteOne({ _id: salesOrder._id }).session(session);
        } else {
          salesOrder.lastUpdateDate = new Date();
          await salesOrder.save({ session });
        }
      }
    }

    // ─────────────────────────────────────
    // Create New Transactions
    // ─────────────────────────────────────
    const transactionsData = buildTransactions(
      originalInvoice,
      subtotal,
      discountAmount,
      discount,
      amount
    );

    const createdTransactions = await Transaction.insertMany(transactionsData, {
      session,
    });

    // ─────────────────────────────────────
    // Create New Payment & Update Customer
    // ─────────────────────────────────────
    customer.transactions.push(...createdTransactions.map((t) => t._id));

    if (amount > 0) {
      const newPayment = new Payment({
        customer: customer._id,
        customerName: customer.name,
        amount,
        invoice: originalInvoice._id,
        status: 'Success',
        method: 'Cash',
      });
      await newPayment.save({ session });
      customer.payment.push(newPayment._id);
    }

    await customer.save({ session });
    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Invoice updated successfully',
      invoice: {
        ...originalInvoice.toObject(),
        customer: {
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
        },
      },
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Invoice update error:', error);
    next(new AppError('Something went wrong during invoice update', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Delete Invoice
// ============================================================
exports.deleteInvoice = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const invoiceId = req.params.id;
    console.log(`[1] Starting deletion for invoice ID: ${invoiceId}`);

    const invoice = await Invoice.findById(invoiceId)
      .populate('customer')
      .populate('items.product')
      .session(session);

    // ✅ abort قبل next
    if (!invoice) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Invoice not found', 404));
    }
    console.log('[2] Invoice found successfully.');

    // ─────────────────────────────────────
    // Update Customer
    // ✅ مع تحديث الـ balance والـ references
    // ─────────────────────────────────────
    if (invoice.customer) {
      const customer = invoice.customer;

      // ✅ إرجاع الـ balance
      customer.outstandingBalance =
        (customer.outstandingBalance || 0) - invoice.balanceDue;
      customer.balance = (customer.balance || 0) - invoice.balanceDue;

      // ✅ إزالة الفاتورة من سجل العميل
      customer.invoice = (customer.invoice || []).filter(
        (inv) => inv.toString() !== invoice._id.toString()
      );

      // ✅ إزالة الـ Payments المرتبطة
      const relatedPayments = await Payment.find({
        invoice: invoiceId,
      }).session(session);

      const paymentIds = relatedPayments.map((p) => p._id.toString());
      customer.payment = (customer.payment || []).filter(
        (p) => !paymentIds.includes(p.toString())
      );

      // ✅ إزالة الـ Transactions المرتبطة
      const relatedTransactions = await Transaction.find({
        referenceId: invoiceId,
      }).session(session);

      const transactionIds = relatedTransactions.map((t) => t._id.toString());
      customer.transactions = (customer.transactions || []).filter(
        (t) => !transactionIds.includes(t.toString())
      );

      await customer.save({ session });
      console.log('[4] Customer updated successfully.');
    }

    // ─────────────────────────────────────
    // Revert Stock
    // ─────────────────────────────────────
    const stockReverts = [];
    for (const item of invoice.items) {
      if (item.product && item.product._id) {
        stockReverts.push({
          updateOne: {
            filter: { product: item.product._id },
            update: {
              $inc: { quantity: item.quantity },
              $set: { lastStockUpdate: new Date() },
            },
          },
        });
      }
    }

    if (stockReverts.length > 0) {
      await Stock.bulkWrite(stockReverts, { session });
      console.log('[6] Stock reverted successfully.');
    }

    // ─────────────────────────────────────
    // Update Sales Orders
    // ─────────────────────────────────────
    console.log('[7] Starting SalesOrder updates...');

    for (const item of invoice.items) {
      if (item.product && item.product._id) {
        const salesOrder = await SalesOrder.findOne({
          product: item.product._id,
        }).session(session);

        if (salesOrder && Array.isArray(salesOrder.invoiceSales)) {
          const invoiceSaleIndex = salesOrder.invoiceSales.findIndex(
            (is) => is.invoice.toString() === invoice._id.toString()
          );

          if (invoiceSaleIndex > -1) {
            const invoiceSale = salesOrder.invoiceSales[invoiceSaleIndex];
            salesOrder.count -= invoiceSale.quantity;
            salesOrder.subtotal -= invoiceSale.subtotal;
            salesOrder.invoiceSales.splice(invoiceSaleIndex, 1);

            if (salesOrder.count <= 0) {
              await SalesOrder.deleteOne({ _id: salesOrder._id }).session(
                session
              );
            } else {
              salesOrder.lastUpdateDate = new Date();
              await salesOrder.save({ session });
            }
          }
        }
      }
    }
    console.log('[8] SalesOrder updates finished.');

    // ─────────────────────────────────────
    // Delete Payments & Transactions & Invoice
    // ─────────────────────────────────────
    console.log('[9] Deleting related Payments and Transactions...');
    await Payment.deleteMany({ invoice: invoiceId }, { session });
    await Transaction.deleteMany({ referenceId: invoiceId }, { session });
    console.log('[10] Related documents deleted.');

    await Invoice.findByIdAndDelete(invoiceId, { session });
    console.log('[11] Invoice deleted. Committing transaction.');

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Invoice and all related data deleted successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('TRANSACTION FAILED:', error);
    next(
      new AppError(
        'Something went wrong during invoice deletion. The operation was rolled back.',
        500
      )
    );
  } finally {
    session.endSession();
  }
});

// ============================================================
// Update Invoice Status
// ============================================================
exports.updateInvoiceStatus = catchAsync(async (req, res, next) => {
  // ✅ Validate Status قبل فتح Session
  const VALID_STATUSES = [
    'draft',
    'issued',
    'paid',
    'partially_paid',
    'overdue',
    'cancelled',
    'refunded',
  ];

  const { status, paymentAmount } = req.body;

  if (!status) {
    return next(new AppError('Status is required', 400));
  }

  if (!VALID_STATUSES.includes(status)) {
    return next(
      new AppError(
        `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
        400
      )
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    const invoice = await Invoice.findById(id)
      .populate('customer')
      .session(session);

    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }

    if (status === 'paid' && paymentAmount) {
      if (paymentAmount <= 0) {
        throw new AppError('Payment amount must be positive', 400);
      }

      if (paymentAmount > invoice.balanceDue) {
        throw new AppError('Payment amount exceeds balance due', 400);
      }

      // ✅ تحديث الفاتورة
      invoice.amountPaid += paymentAmount;
      invoice.balanceDue -= paymentAmount;
      // الـ pre save هيتكلف بتحديث الـ status تلقائياً

      // ✅ إنشاء Payment
      const payment = new Payment({
        customer: invoice.customer._id,
        customerName: invoice.customer.name,
        amount: paymentAmount,
        invoice: invoice._id,
        status: 'Success',
        method: 'Cash',
      });
      await payment.save({ session });

      // ✅ إنشاء Transaction
      const transaction = new Transaction({
        type: 'payment',
        referenceId: invoice._id,
        amount: paymentAmount,
        details: `Payment of ${paymentAmount} for invoice #${invoice.formattedInvoiceNumber}`,
        items: [],
        status: 'credit',
      });
      await transaction.save({ session });

      // ✅ تحديث العميل
      const customer = invoice.customer;
      customer.outstandingBalance =
        (customer.outstandingBalance || 0) - paymentAmount;
      customer.balance = (customer.balance || 0) - paymentAmount;

      if (!customer.payment) customer.payment = [];
      if (!customer.transactions) customer.transactions = [];

      customer.payment.push(payment._id);
      customer.transactions.push(transaction._id);
      await customer.save({ session });
    } else {
      // ✅ تغيير الـ status مباشرة
      invoice.status = status;
    }

    await invoice.save({ session });
    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Invoice status updated successfully',
      invoice,
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Invoice status update error:', error);
    next(new AppError('Something went wrong during status update', 500));
  } finally {
    session.endSession();
  }
});
