const mongoose = require('mongoose');
const Prescription = require('../models/prescription');
const Customer = require('../models/customer');
const Product = require('../models/product');
const Stock = require('../models/stock');
const Invoice = require('../models/invoice');
const Payment = require('../models/payment');
const Transaction = require('../models/transactions');
const SalesOrder = require('../models/sales');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const getNextSequence = require('../utils/getNextSequence');
const Crud = require('./crudFactory');

// ============================================================
// Populate Options
// ============================================================
const populateOptions = [
  { path: 'customer', select: 'name phone email' },
  { path: 'items.product', select: 'name productCode sellingPrice' },
  { path: 'invoice', select: 'invoiceNumber totalAmount status' },
];

// ============================================================
// Basic CRUD
// ============================================================
exports.getAllPrescriptions = Crud.getAll(Prescription, populateOptions);
exports.getOnePrescription = Crud.getOneById(Prescription, populateOptions);

// ============================================================
// Create Prescription
// ============================================================
exports.createPrescription = catchAsync(async (req, res, next) => {
  // ✅ Validate قبل فتح Session
  const {
    customerName,
    doctor,
    items,
    diagnosis,
    notes,
    prescriptionDate,
    expiryDate,
    requiresInsurance,
  } = req.body;

  if (
    !customerName ||
    !doctor ||
    !doctor.name ||
    !items ||
    items.length === 0
  ) {
    return next(
      new AppError('customerName, doctor name, and items are required', 400)
    );
  }

  // ✅ Validate dates
  const prescDate = prescriptionDate ? new Date(prescriptionDate) : new Date();
  const expDate = expiryDate
    ? new Date(expiryDate)
    : new Date(prescDate.getTime() + 90 * 24 * 60 * 60 * 1000); // 3 شهور default

  if (isNaN(expDate.getTime())) {
    return next(new AppError('Invalid expiry date format', 400));
  }

  if (expDate < new Date()) {
    return next(new AppError('Expiry date cannot be in the past', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ─────────────────────────────────────
    // Find Customer
    // ─────────────────────────────────────
    const customer = await Customer.findOne({
      name: customerName,
    }).session(session);

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    // ─────────────────────────────────────
    // Validate Items
    // ─────────────────────────────────────
    const processedItems = [];

    for (const item of items) {
      if (
        !item.product ||
        !item.dosage ||
        !item.frequency ||
        !item.duration ||
        !item.quantity
      ) {
        throw new AppError(
          'Each item must have product, dosage, frequency, duration, and quantity',
          400
        );
      }

      if (item.quantity <= 0 || !Number.isInteger(item.quantity)) {
        throw new AppError(
          `Invalid quantity for product: ${item.product}`,
          400
        );
      }

      const product = await Product.findById(item.product).session(session);
      if (!product) {
        throw new AppError(`Product not found: ${item.product}`, 404);
      }

      // ✅ Check stock availability
      const stock = await Stock.findOne({
        product: product._id,
      }).session(session);

      if (!stock || stock.quantity < item.quantity) {
        throw new AppError(
          `Insufficient stock for ${product.name}. Available: ${stock?.quantity || 0}`,
          400
        );
      }

      processedItems.push({
        product: product._id,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        quantity: item.quantity,
        instructions: item.instructions || null,
      });
    }

    // ─────────────────────────────────────
    // Generate Prescription Number
    // ─────────────────────────────────────
    let prescriptionNumber;
    try {
      prescriptionNumber = await getNextSequence('prescription', session);
    } catch (err) {
      throw new AppError('Failed to generate prescription number', 500);
    }

    // ─────────────────────────────────────
    // Create Prescription
    // ─────────────────────────────────────
    const prescription = new Prescription({
      prescriptionNumber,
      customer: customer._id,
      doctor,
      items: processedItems,
      diagnosis: diagnosis || null,
      notes: notes || null,
      prescriptionDate: prescDate,
      expiryDate: expDate,
      requiresInsurance: requiresInsurance || false,
      status: 'pending',
    });

    await prescription.save({ session });
    await session.commitTransaction();

    // ✅ Populate الـ response
    const populatedPrescription = await Prescription.findById(prescription._id)
      .populate('customer', 'name phone email')
      .populate('items.product', 'name productCode sellingPrice');

    res.status(201).json({
      status: 'success',
      message: 'Prescription created successfully',
      data: populatedPrescription,
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Prescription creation error:', error);
    next(
      new AppError('Something went wrong during prescription creation', 500)
    );
  } finally {
    session.endSession();
  }
});

// ============================================================
// Dispense Prescription - صرف الوصفة وإنشاء فاتورة تلقائي
// ============================================================
exports.dispensePrescription = catchAsync(async (req, res, next) => {
  // ✅ Validate قبل فتح Session
  const { amount, discount } = req.body;

  if (amount < 0) {
    return next(new AppError('Amount cannot be negative', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    // ─────────────────────────────────────
    // Find Prescription
    // ─────────────────────────────────────
    const prescription = await Prescription.findById(id)
      .populate('customer')
      .populate('items.product')
      .session(session);

    if (!prescription) {
      throw new AppError('Prescription not found', 404);
    }

    if (prescription.status === 'dispensed') {
      throw new AppError('Prescription already dispensed', 400);
    }

    if (prescription.status === 'expired') {
      throw new AppError('Prescription has expired', 400);
    }

    if (prescription.status === 'cancelled') {
      throw new AppError('Prescription is cancelled', 400);
    }

    // ✅ Check expiry
    if (new Date() > prescription.expiryDate) {
      prescription.status = 'expired';
      await prescription.save({ session });
      throw new AppError('Prescription has expired', 400);
    }

    // ─────────────────────────────────────
    // Process Items & Check Stock
    // ─────────────────────────────────────
    const processedItems = [];
    const stockUpdates = [];
    let subtotal = 0;

    for (const item of prescription.items) {
      const stock = await Stock.findOne({
        product: item.product._id,
      }).session(session);

      if (!stock || stock.quantity < item.quantity) {
        throw new AppError(
          `Insufficient stock for ${item.product.name}. Available: ${stock?.quantity || 0}`,
          400
        );
      }

      const lineTotal = item.product.sellingPrice * item.quantity;
      subtotal += lineTotal;

      processedItems.push({
        product: item.product._id,
        quantity: item.quantity,
        unitPrice: item.product.sellingPrice,
        taxRate: item.product.taxes || 0,
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

    // ✅ Update Stock
    if (stockUpdates.length > 0) {
      await Stock.bulkWrite(stockUpdates, { session });
    }

    // ─────────────────────────────────────
    // Calculate Totals
    // ─────────────────────────────────────
    let discountAmount = 0;
    if (discount) {
      if (discount < 0 || discount > 100) {
        throw new AppError('Discount must be between 0 and 100', 400);
      }
      discountAmount = subtotal * (discount / 100);
    }

    const totalAfterDiscount = subtotal - discountAmount;

    if (amount > totalAfterDiscount) {
      throw new AppError(
        `Payment amount (${amount}) exceeds total (${totalAfterDiscount})`,
        400
      );
    }

    const remaining = totalAfterDiscount - amount;

    // ─────────────────────────────────────
    // Generate Invoice Number
    // ─────────────────────────────────────
    let invoiceNumber;
    try {
      invoiceNumber = await getNextSequence('invoice', session);
    } catch (err) {
      throw new AppError('Failed to generate invoice number', 500);
    }

    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 30);

    // ─────────────────────────────────────
    // Create Invoice
    // ─────────────────────────────────────
    const invoice = new Invoice({
      invoiceNumber,
      customer: prescription.customer._id,
      items: processedItems,
      subtotal,
      taxAmount: 0,
      discountAmount,
      totalAmount: totalAfterDiscount,
      amountPaid: amount || 0,
      balanceDue: remaining,
      issueDate,
      dueDate,
      paymentTerms: 'net_30',
      notes: `Prescription: ${prescription.formattedPrescriptionNumber}`,
    });

    await invoice.save({ session });

    // ─────────────────────────────────────
    // Create Sales Orders
    // ─────────────────────────────────────
    for (const item of processedItems) {
      let salesOrder = await SalesOrder.findOne({
        product: item.product,
      }).session(session);

      if (salesOrder) {
        salesOrder.count += item.quantity;
        salesOrder.subtotal += item.lineTotal;
        if (!Array.isArray(salesOrder.invoiceSales)) {
          salesOrder.invoiceSales = [];
        }
        salesOrder.invoiceSales.push({
          invoice: invoice._id,
          quantity: item.quantity,
          subtotal: item.lineTotal,
        });
        salesOrder.lastUpdateDate = new Date();
        await salesOrder.save({ session });
      } else {
        const orderNumber = await getNextSequence('salesOrder', session);
        salesOrder = new SalesOrder({
          orderNumber,
          customer: prescription.customer._id,
          product: item.product,
          count: item.quantity,
          subtotal: item.lineTotal,
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
    // Create Payment (if amount > 0)
    // ─────────────────────────────────────
    let payment = null;
    if (amount > 0) {
      payment = new Payment({
        customer: prescription.customer._id,
        customerName: prescription.customer.name,
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
    const transactions = [
      {
        type: 'invoice',
        referenceId: invoice._id,
        amount: subtotal,
        details: `Invoice from Prescription ${prescription.formattedPrescriptionNumber}`,
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
        details: `Discount of ${discount}% on prescription ${prescription.formattedPrescriptionNumber}`,
        items: [],
        status: 'credit',
      });
    }

    if (amount > 0) {
      transactions.push({
        type: 'payment',
        referenceId: invoice._id,
        amount,
        details: `Payment for prescription ${prescription.formattedPrescriptionNumber}`,
        items: [],
        status: 'credit',
      });
    }

    const createdTransactions = await Transaction.insertMany(transactions, {
      session,
    });

    // ─────────────────────────────────────
    // Update Customer
    // ─────────────────────────────────────
    const customer = prescription.customer;
    customer.transactions.push(...createdTransactions.map((t) => t._id));
    customer.invoice.push(invoice._id);
    if (payment) customer.payment.push(payment._id);
    customer.outstandingBalance += remaining;
    customer.balance += remaining;
    await customer.save({ session });

    // ─────────────────────────────────────
    // Update Prescription Status
    // ─────────────────────────────────────
    prescription.status = 'dispensed';
    prescription.invoice = invoice._id;
    await prescription.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Prescription dispensed successfully',
      data: {
        prescription,
        invoice: {
          ...invoice.toObject(),
          customer: {
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
          },
        },
      },
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Dispense prescription error:', error);
    next(new AppError('Something went wrong during dispensing', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Cancel Prescription
// ============================================================
exports.cancelPrescription = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { reason } = req.body;

  const prescription = await Prescription.findOne({
    _id: id,
    isDeleted: false,
  });

  if (!prescription) {
    return next(new AppError('Prescription not found', 404));
  }

  if (prescription.status === 'dispensed') {
    return next(new AppError('Cannot cancel a dispensed prescription', 400));
  }

  if (prescription.status === 'cancelled') {
    return next(new AppError('Prescription already cancelled', 400));
  }

  prescription.status = 'cancelled';
  if (reason) prescription.notes = reason;
  await prescription.save();

  res.status(200).json({
    status: 'success',
    message: 'Prescription cancelled successfully',
    data: prescription,
  });
});

// ============================================================
// Get Customer Prescriptions
// ============================================================
exports.getCustomerPrescriptions = catchAsync(async (req, res, next) => {
  const { customerId } = req.params;

  const customer = await Customer.findById(customerId);
  if (!customer) {
    return next(new AppError('Customer not found', 404));
  }

  const prescriptions = await Prescription.find({
    customer: customerId,
    isDeleted: false,
  })
    .populate('items.product', 'name productCode')
    .populate('invoice', 'invoiceNumber totalAmount status')
    .sort('-prescriptionDate');

  res.status(200).json({
    status: 'success',
    results: prescriptions.length,
    data: {
      customer: {
        name: customer.name,
        phone: customer.phone,
      },
      prescriptions,
    },
  });
});

// ============================================================
// Get Expiring Prescriptions
// ============================================================
exports.getExpiringPrescriptions = catchAsync(async (req, res, next) => {
  const { days = 7 } = req.query;

  const daysNum = parseInt(days);
  if (isNaN(daysNum) || daysNum < 1) {
    return next(new AppError('Days must be a positive number', 400));
  }

  const today = new Date();
  const warningDate = new Date();
  warningDate.setDate(today.getDate() + daysNum);

  const expiringPrescriptions = await Prescription.find({
    expiryDate: { $gte: today, $lte: warningDate },
    status: 'pending',
    isDeleted: false,
  })
    .populate('customer', 'name phone')
    .populate('items.product', 'name')
    .sort('expiryDate');

  res.status(200).json({
    status: 'success',
    results: expiringPrescriptions.length,
    data: expiringPrescriptions.map((p) => ({
      prescriptionNumber: p.formattedPrescriptionNumber,
      customer: p.customer,
      doctor: p.doctor.name,
      expiryDate: p.expiryDate,
      daysUntilExpiry: Math.ceil(
        (p.expiryDate - today) / (1000 * 60 * 60 * 24)
      ),
      items: p.items,
    })),
  });
});
