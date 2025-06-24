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
  { path: 'customer', select: 'name email phone' }, // جلب اسم العميل وبريده وهاتفه

  { path: 'items.product', select: 'name productCode' }, // جلب اسم المنتج وكوده
];
// Basic CRUD Operations
exports.allInvoices = Crud.getAll(Invoice, invoicePopulateOptions);
exports.oneInvoice = Crud.getOneById(Invoice, {
  path: 'customer',
  select: 'name email phone',
});

exports.oneInvoiceByNum = Crud.getOneByField(Invoice, 'invoiceNumber', {
  path: 'items.product customer',
  select: 'name price productCode email phone',
});

// Create new invoice
exports.createInvoice = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { name, email, phone, items, amount, discount } = req.body;

    // Validation
    const { error } = invoiceSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const messages = error.details.map((detail) => detail.message).join(', ');
      throw new AppError(messages, 400);
    }

    if (amount < 0) {
      throw new AppError('Payment amount cannot be negative', 400);
    }

    // Handle customer
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

    // Process items and calculate totals
    const processedItems = [];
    const stockUpdates = [];
    let subtotal = 0;

    const productNames = items.map((item) => item.product);
    const products = await Product.find({
      name: { $in: productNames },
    }).session(session);

    if (products.length !== productNames.length) {
      const foundNames = products.map((p) => p.name);
      const missing = productNames.filter((name) => !foundNames.includes(name));
      throw new AppError(`Products not found: ${missing.join(', ')}`, 404);
    }

    const productMap = new Map(products.map((p) => [p.name, p]));
    const productIds = products.map((p) => p._id);
    const stocks = await Stock.find({ product: { $in: productIds } })
      .populate('product')
      .session(session);
    const stockMap = new Map(stocks.map((s) => [s.product._id.toString(), s]));

    for (const item of items) {
      if (item.quantity <= 0 || !Number.isInteger(item.quantity)) {
        throw new AppError(
          `Invalid quantity for product: ${item.product}`,
          400
        );
      }

      const product = productMap.get(item.product);
      if (!product)
        throw new AppError(`Product not found: ${item.product}`, 404);

      const stock = stockMap.get(product._id.toString());
      if (!stock)
        throw new AppError(`Stock not found for product: ${item.product}`, 404);

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

    if (stockUpdates.length > 0) {
      await Stock.bulkWrite(stockUpdates, { session });
    }

    // Calculate discount and totals
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

    // Generate Invoice Number
    let invoiceNumber;
    try {
      invoiceNumber = await getNextSequence('invoice', session);
    } catch (err) {
      throw new AppError('Failed to generate invoice number.', 500);
    }

    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 30);

    // Create invoice
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

    // Create or update sales orders for each item
    for (const item of processedItems) {
      // Check if sales order exists for this product
      let salesOrder = await SalesOrder.findOne({
        product: item.product,
      }).session(session);

      if (salesOrder) {
        // Update existing sales order
        salesOrder.count += item.quantity;
        salesOrder.subtotal += item.lineTotal;
        await salesOrder.save({ session });
      } else {
        // Generate new order number
        let orderNumber;
        try {
          orderNumber = await getNextSequence('salesOrder', session);
        } catch (err) {
          throw new AppError('Failed to generate sales order number.', 500);
        }

        // Create new sales order
        salesOrder = new SalesOrder({
          orderNumber,
          customer: customer._id,
          product: item.product,
          count: item.quantity,
          subtotal: item.lineTotal,
        });
        await salesOrder.save({ session });
      }

      // // Link the sales order to the invoice
      // await Invoice.findByIdAndUpdate(
      //     invoice._id,
      //     {
      //         $addToSet: { salesOrders: salesOrder._id }
      //     },
      //     { session }
      // );
    }

    // Create payment if amount > 0
    let payment = null;
    if (amount > 0) {
      payment = new Payment({
        customer: customer._id,
        customerName: name,
        amount,
        invoice: invoice._id,
      });
      await payment.save({ session });
    }

    // Create transactions
    const transactions = [
      {
        type: 'invoice',
        referenceId: invoice._id,
        amount: subtotal,
        details: `Invoice #${invoice.formattedInvoiceNumber} created with total ${subtotal} for customer ${customer.name}`,
        items: processedItems.map((item) => ({
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

    const createdTransactions = await Transaction.insertMany(transactions, {
      session,
    });

    // Update customer
    if (!customer.transactions) customer.transactions = [];
    if (!customer.invoice) customer.invoice = [];
    if (!customer.payment) customer.payment = [];

    customer.transactions.push(...createdTransactions.map((t) => t._id));
    customer.invoice.push(invoice._id);
    if (payment) customer.payment.push(payment._id);

    if (!customer.outstandingBalance) customer.outstandingBalance = 0;
    if (!customer.balance) customer.balance = 0;

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
    if (error instanceof AppError) {
      next(error);
    } else {
      console.error('Invoice creation error:', error);
      next(new AppError('Something went wrong during invoice creation', 500));
    }
  } finally {
    session.endSession();
  }
});

// Update invoice with all related updates
exports.updateInvoice = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const invoiceId = req.params.id;
    const { name, email, phone, items, amount, discount } = req.body;

    // Get original invoice
    const originalInvoice = await Invoice.findById(invoiceId)
      .populate('customer')
      .populate('items.product')
      .session(session);

    if (!originalInvoice) {
      throw new AppError('Invoice not found', 404);
    }

    // Validation
    const { error } = invoiceSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const messages = error.details.map((detail) => detail.message).join(', ');
      throw new AppError(messages, 400);
    }

    if (amount < 0) {
      throw new AppError('Payment amount cannot be negative', 400);
    }

    // Revert original stock changes
    const originalStockReverts = [];
    for (const item of originalInvoice.items) {
      originalStockReverts.push({
        updateOne: {
          filter: { product: item.product._id },
          update: {
            $inc: { quantity: item.quantity }, // Add back the quantity
            $set: { lastStockUpdate: new Date() },
          },
        },
      });
    }

    if (originalStockReverts.length > 0) {
      await Stock.bulkWrite(originalStockReverts, { session });
    }

    // Handle customer updates
    let customer = originalInvoice.customer;
    let customerUpdated = false;

    if (name && customer.name !== name) {
      // Check if customer with new name exists
      const existingCustomer = await Customer.findOne({ name }).session(
        session
      );
      if (
        existingCustomer &&
        existingCustomer._id.toString() !== customer._id.toString()
      ) {
        customer = existingCustomer;
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

    // Process new items
    const processedItems = [];
    const stockUpdates = [];
    let subtotal = 0;

    const productNames = items.map((item) => item.product);
    const products = await Product.find({
      name: { $in: productNames },
    }).session(session);

    if (products.length !== productNames.length) {
      const foundNames = products.map((p) => p.name);
      const missing = productNames.filter((name) => !foundNames.includes(name));
      throw new AppError(`Products not found: ${missing.join(', ')}`, 404);
    }

    const productMap = new Map(products.map((p) => [p.name, p]));
    const productIds = products.map((p) => p._id);
    const stocks = await Stock.find({ product: { $in: productIds } })
      .populate('product')
      .session(session);
    const stockMap = new Map(stocks.map((s) => [s.product._id.toString(), s]));

    for (const item of items) {
      if (item.quantity <= 0 || !Number.isInteger(item.quantity)) {
        throw new AppError(
          `Invalid quantity for product: ${item.product}`,
          400
        );
      }

      const product = productMap.get(item.product);
      const stock = stockMap.get(product._id.toString());

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

    if (stockUpdates.length > 0) {
      await Stock.bulkWrite(stockUpdates, { session });
    }

    // Calculate new totals
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

    // Update customer balance (remove old balance, add new)
    customer.outstandingBalance -= originalInvoice.balanceDue;
    customer.balance -= originalInvoice.balanceDue;
    customer.outstandingBalance += remaining;
    customer.balance += remaining;

    // Update invoice
    originalInvoice.customer = customer._id;
    originalInvoice.items = processedItems;
    originalInvoice.subtotal = subtotal;
    originalInvoice.discountAmount = discountAmount;
    originalInvoice.totalAmount = totalAfterDiscount;
    originalInvoice.amountPaid = amount;
    originalInvoice.balanceDue = remaining;

    await originalInvoice.save({ session });

    // Delete old transactions and payments
    await Transaction.deleteMany({ referenceId: invoiceId }, { session });
    await Payment.deleteMany({ invoice: invoiceId }, { session });

    // تحديث المبيعات
    const updateSalesOrders = async () => {
      // جلب كل سجلات المبيعات المتأثرة
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

      // تحديث سجلات المبيعات
      for (const productId of allProductIds) {
        let salesOrder = salesOrderMap.get(productId);

        // البحث عن الكميات القديمة والجديدة
        const originalItem = originalInvoice.items.find(
          (item) => item.product._id.toString() === productId
        );
        const newItem = processedItems.find(
          (item) => item.product.toString() === productId
        );

        if (!salesOrder && newItem) {
          // إنشاء سجل مبيعات جديد
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
          // حذف السجل القديم للفاتورة إن وجد
          const invoiceSaleIndex = salesOrder.invoiceSales.findIndex(
            (is) => is.invoice.toString() === originalInvoice._id.toString()
          );

          if (invoiceSaleIndex > -1) {
            const oldInvoiceSale = salesOrder.invoiceSales[invoiceSaleIndex];
            salesOrder.count -= oldInvoiceSale.quantity;
            salesOrder.subtotal -= oldInvoiceSale.subtotal;
            salesOrder.invoiceSales.splice(invoiceSaleIndex, 1);
          }

          // إضافة السجل الجديد للفاتورة إن وجد
          if (newItem) {
            salesOrder.count += newItem.quantity;
            salesOrder.subtotal += newItem.lineTotal;
            salesOrder.invoiceSales.push({
              invoice: originalInvoice._id,
              quantity: newItem.quantity,
              subtotal: newItem.lineTotal,
            });
          }

          // تحديث أو حذف سجل المبيعات
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
    };

    await updateSalesOrders();

    // Create new transactions
    const transactions = [
      {
        type: 'invoice',
        referenceId: originalInvoice._id,
        amount: subtotal,
        details: `Invoice #${originalInvoice.formattedInvoiceNumber} updated with total ${subtotal} for customer ${customer.name}`,
        items: processedItems.map((item) => ({
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
        referenceId: originalInvoice._id,
        amount: discountAmount,
        details: `Discount of ${discount}% applied to invoice #${originalInvoice.formattedInvoiceNumber}`,
        items: [],
        status: 'credit',
      });
    }

    if (amount > 0) {
      transactions.push({
        type: 'payment',
        referenceId: originalInvoice._id,
        amount,
        details: `Payment of ${amount} received for invoice #${originalInvoice.formattedInvoiceNumber}`,
        items: [],
        status: 'credit',
      });
    }

    await Transaction.insertMany(transactions, { session });
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
    if (error instanceof AppError) {
      next(error);
    } else {
      console.error('Invoice update error:', error);
      next(new AppError('Something went wrong during invoice update', 500));
    }
  } finally {
    session.endSession();
  }
});


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

    if (!invoice) {
      // ...
      return next(new AppError('Invoice not found', 404));
    }
    console.log('[2] Invoice found successfully.');

    // ... (منطق تحديث العميل يبقى كما هو)
    if (invoice.customer) {
      // ...
      await invoice.customer.save({ session });
      console.log('[4] Customer updated successfully.');
    } //...

    // ... (منطق إعادة المخزون يبقى كما هو)
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

    console.log('[7] Starting SalesOrder updates...');
    for (const item of invoice.items) {
      if (item.product && item.product._id) {
        const salesOrder = await SalesOrder.findOne({
          product: item.product._id,
        }).session(session);

        // ================== بداية الإصلاح ==================
        // التحقق من وجود أمر البيع وأن حقل invoiceSales هو مصفوفة
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
        // ================== نهاية الإصلاح ==================
      }
    }
    console.log('[8] SalesOrder updates finished.');

    console.log('[9] Deleting related Payments and Transactions...');
    await Payment.deleteMany({ invoice: invoiceId }, { session });
    await Transaction.deleteMany({ referenceId: invoiceId }, { session });
    console.log('[10] Related documents deleted.');

    await Invoice.findByIdAndDelete(invoiceId, { session });
    console.log('[11] Invoice document deleted. Committing transaction.');

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Invoice and all related data deleted successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('TRANSACTION FAILED. Error details:', error);
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

// Additional helper function for invoice status updates
exports.updateInvoiceStatus = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { status, paymentAmount } = req.body;

    const invoice = await Invoice.findById(id)
      .populate('customer')
      .session(session);
    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }

    if (status === 'paid' && paymentAmount) {
      if (paymentAmount > invoice.balanceDue) {
        throw new AppError('Payment amount exceeds balance due', 400);
      }

      // Update invoice
      invoice.amountPaid += paymentAmount;
      invoice.balanceDue -= paymentAmount;

      if (invoice.balanceDue === 0) {
        invoice.status = 'paid';
      }

      // Create payment record
      const payment = new Payment({
        customer: invoice.customer._id,
        customerName: invoice.customer.name,
        amount: paymentAmount,
        invoice: invoice._id,
      });
      await payment.save({ session });

      // Create transaction
      const transaction = new Transaction({
        type: 'payment',
        referenceId: invoice._id,
        amount: paymentAmount,
        details: `Additional payment of ${paymentAmount} for invoice #${invoice.formattedInvoiceNumber}`,
        items: [],
        status: 'credit',
      });
      await transaction.save({ session });

      // Update customer
      const customer = invoice.customer;
      customer.outstandingBalance -= paymentAmount;
      customer.balance -= paymentAmount;
      customer.payment.push(payment._id);
      customer.transactions.push(transaction._id);
      await customer.save({ session });
    } else {
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
    if (error instanceof AppError) {
      next(error);
    } else {
      console.error('Invoice status update error:', error);
      next(new AppError('Something went wrong during status update', 500));
    }
  } finally {
    session.endSession();
  }
});
