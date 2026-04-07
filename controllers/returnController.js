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

// ============================================================
// Helper - Update Sales Statistics
// ✅ متطابق مع الـ SalesOrder Model
// ============================================================
const updateSalesStatistics = async (
  productId,
  invoiceId,
  quantity,
  amount,
  session,
  isReturn = true
) => {
  const salesOrder = await SalesOrder.findOne({
    product: productId,
  }).session(session);

  if (!salesOrder) return; // مش error لو مفيش sales order

  if (isReturn) {
    // ✅ تقليل الـ count والـ subtotal
    salesOrder.count = Math.max(0, salesOrder.count - quantity);
    salesOrder.subtotal = Math.max(0, salesOrder.subtotal - amount);

    // ✅ تحديث الـ invoiceSales
    if (Array.isArray(salesOrder.invoiceSales)) {
      const invoiceSaleIndex = salesOrder.invoiceSales.findIndex(
        (is) => is.invoice.toString() === invoiceId.toString()
      );

      if (invoiceSaleIndex > -1) {
        salesOrder.invoiceSales[invoiceSaleIndex].quantity = Math.max(
          0,
          salesOrder.invoiceSales[invoiceSaleIndex].quantity - quantity
        );
        salesOrder.invoiceSales[invoiceSaleIndex].subtotal = Math.max(
          0,
          salesOrder.invoiceSales[invoiceSaleIndex].subtotal - amount
        );
      }
    }
  } else {
    // ✅ زيادة الـ count والـ subtotal عند إلغاء المرتجع
    salesOrder.count += quantity;
    salesOrder.subtotal += amount;

    if (Array.isArray(salesOrder.invoiceSales)) {
      const invoiceSaleIndex = salesOrder.invoiceSales.findIndex(
        (is) => is.invoice.toString() === invoiceId.toString()
      );

      if (invoiceSaleIndex > -1) {
        salesOrder.invoiceSales[invoiceSaleIndex].quantity += quantity;
        salesOrder.invoiceSales[invoiceSaleIndex].subtotal += amount;
      }
    }
  }

  salesOrder.lastUpdateDate = new Date();

  // لو الـ count وصل صفر احذف الـ sales order
  if (salesOrder.count <= 0) {
    await SalesOrder.deleteOne({ _id: salesOrder._id }).session(session);
  } else {
    await salesOrder.save({ session });
  }
};

// ============================================================
// Get All Returns
// ============================================================
exports.allReturn = catchAsync(async (req, res, next) => {
  const returns = await Return.find({ isDeleted: false })
    .populate('customer', 'name email phone')
    .populate('invoice', 'invoiceNumber totalAmount')
    .populate('product', 'name productCode') // ✅ populate product
    .sort('-createdAt');

  res.status(200).json({
    status: 'success',
    results: returns.length,
    data: returns,
  });
});

// ============================================================
// Get One Return
// ============================================================
exports.oneReturn = catchAsync(async (req, res, next) => {
  const returnDoc = await Return.findOne({
    _id: req.params.id,
    isDeleted: false,
  })
    .populate('customer', 'name email phone')
    .populate('invoice', 'invoiceNumber totalAmount items')
    .populate('product', 'name productCode sellingPrice');

  if (!returnDoc) {
    return next(new AppError('Return not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: returnDoc,
  });
});

// ============================================================
// Add Return
// ============================================================
exports.addReturn = catchAsync(async (req, res, next) => {
  // ✅ Validate قبل فتح Session
  const { invoiceNumber, productName, name, quantity, reason } = req.body;

  if (!invoiceNumber || !productName || !name || !quantity) {
    return next(
      new AppError(
        'invoiceNumber, productName, name, and quantity are required',
        400
      )
    );
  }

  if (quantity <= 0 || !Number.isInteger(quantity)) {
    return next(
      new AppError('Return quantity must be a positive integer', 400)
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ─────────────────────────────────────
    // Find All Related Documents
    // ─────────────────────────────────────
    const productDoc = await Product.findOne({ name: productName }).session(
      session
    );
    if (!productDoc) throw new AppError('Product not found', 404);

    const [customer, invoice, stock] = await Promise.all([
      Customer.findOne({ name }).session(session),
      Invoice.findOne({ invoiceNumber }).session(session),
      Stock.findOne({ product: productDoc._id }).session(session),
    ]);

    if (!customer) throw new AppError('Customer not found', 404);
    if (!invoice) throw new AppError('Invoice not found', 404);
    if (!stock) throw new AppError('Product not found in stock', 404);

    // ✅ التحقق إن الفاتورة تبع العميل
    if (invoice.customer.toString() !== customer._id.toString()) {
      throw new AppError('Invoice does not belong to this customer', 400);
    }

    // ─────────────────────────────────────
    // Find Invoice Item
    // ─────────────────────────────────────
    const invoiceItem = invoice.items.find(
      (item) => item.product.toString() === productDoc._id.toString()
    );

    if (!invoiceItem) {
      throw new AppError('Product not found in invoice', 404);
    }

    // ─────────────────────────────────────
    // Check Return Quantity
    // ─────────────────────────────────────
    const existingReturns = await Return.find({
      invoice: invoice._id,
      product: productDoc._id, // ✅ ObjectId مش String
      isDeleted: false,
      status: { $ne: 'cancelled' },
    }).session(session);

    const alreadyReturnedQty = existingReturns.reduce(
      (total, ret) => total + ret.quantity,
      0
    );

    const remainingQty = invoiceItem.quantity - alreadyReturnedQty;

    if (quantity > remainingQty) {
      throw new AppError(
        `Return quantity exceeds remaining quantity. Only ${remainingQty} can be returned.`,
        400
      );
    }

    const refundAmount = invoiceItem.unitPrice * quantity;

    // ─────────────────────────────────────
    // Create Return Record
    // ✅ product بـ ObjectId مش String
    // ─────────────────────────────────────
    const returnDoc = new Return({
      invoice: invoice._id,
      customer: customer._id,
      product: productDoc._id, // ✅ ObjectId
      quantity,
      reason,
      refundAmount,
      status: 'active',
    });

    // ─────────────────────────────────────
    // Create Refund Transaction
    // ✅ type: 'refund' متطابق مع الـ enum
    // ─────────────────────────────────────
    const refundTransaction = new Transaction({
      type: 'refund', // ✅ مش 'return'
      referenceId: returnDoc._id,
      amount: refundAmount,
      details: `Refund of ${refundAmount} for return of ${quantity} x ${productDoc.name} from invoice #${invoiceNumber}`,
      items: [],
      status: 'credit', // ✅ credit لأنه بيرجع فلوس
    });

    // ─────────────────────────────────────
    // Update Stock
    // ─────────────────────────────────────
    stock.quantity += quantity;
    stock.lastStockUpdate = new Date();

    // ─────────────────────────────────────
    // Update Invoice
    // ─────────────────────────────────────
    if (!invoice.returns) invoice.returns = [];
    invoice.returns.push(returnDoc._id);
    invoice.refunds = (invoice.refunds || 0) + refundAmount;
    invoice.subtotal = Math.max(0, invoice.subtotal - refundAmount);
    invoice.totalAmount = Math.max(0, invoice.totalAmount - refundAmount);
    invoice.balanceDue = Math.max(0, invoice.balanceDue - refundAmount);

    // ─────────────────────────────────────
    // Update Customer
    // ─────────────────────────────────────
    customer.transactions.push(refundTransaction._id);
    if (!customer.returns) customer.returns = [];
    customer.returns.push(returnDoc._id);
    customer.outstandingBalance = Math.max(
      0,
      (customer.outstandingBalance || 0) - refundAmount
    );
    customer.balance = Math.max(0, (customer.balance || 0) - refundAmount);

    // ─────────────────────────────────────
    // Update Sales Statistics
    // ─────────────────────────────────────
    await updateSalesStatistics(
      productDoc._id,
      invoice._id,
      quantity,
      refundAmount,
      session,
      true
    );

    // ─────────────────────────────────────
    // Save All
    // ─────────────────────────────────────
    await Promise.all([
      stock.save({ session }),
      returnDoc.save({ session }),
      invoice.save({ session }),
      refundTransaction.save({ session }),
      customer.save({ session }),
    ]);

    await session.commitTransaction();

    res.status(201).json({
      status: 'success',
      message: 'Return added successfully',
      data: returnDoc,
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Return creation error:', error);
    next(new AppError('Something went wrong during return creation', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Update Return
// ============================================================
exports.updateReturn = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const updates = req.body;

    const existingReturn = await Return.findOne({
      _id: id,
      isDeleted: false,
    }).session(session);

    if (!existingReturn) {
      throw new AppError('Return not found', 404);
    }

    if (existingReturn.status === 'processed') {
      throw new AppError('Cannot update a processed return', 400);
    }

    // ✅ Allowed updates فقط
    const allowedUpdates = ['reason', 'status'];
    const updateFields = {};
    Object.keys(updates).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updateFields[key] = updates[key];
      }
    });

    // ─────────────────────────────────────
    // لو بيغير الـ status لـ cancelled
    // ─────────────────────────────────────
    if (
      updates.status === 'cancelled' &&
      existingReturn.status !== 'cancelled'
    ) {
      const [stock, invoice, customer] = await Promise.all([
        Stock.findOne({ product: existingReturn.product }).session(session),
        Invoice.findById(existingReturn.invoice).session(session),
        Customer.findById(existingReturn.customer).session(session),
      ]);

      if (!stock || !invoice || !customer) {
        throw new AppError('Related records not found', 404);
      }

      // ✅ Reverse stock
      if (stock.quantity < existingReturn.quantity) {
        throw new AppError('Insufficient stock to cancel return', 400);
      }
      stock.quantity -= existingReturn.quantity;
      stock.lastStockUpdate = new Date();

      // ✅ Reverse invoice
      invoice.refunds = Math.max(
        0,
        (invoice.refunds || 0) - existingReturn.refundAmount
      );
      invoice.subtotal += existingReturn.refundAmount;
      invoice.totalAmount += existingReturn.refundAmount;
      invoice.balanceDue += existingReturn.refundAmount;
      invoice.returns = (invoice.returns || []).filter(
        (r) => r.toString() !== id
      );

      // ✅ Adjustment Transaction
      // type: 'return' هو الأقرب للـ enum الموجود
      const adjustmentTransaction = new Transaction({
        type: 'return',
        referenceId: existingReturn._id,
        amount: existingReturn.refundAmount,
        details: `Cancellation of return - restored ${existingReturn.refundAmount} for invoice #${invoice.invoiceNumber}`,
        items: [],
        status: 'debit',
      });

      // ✅ Update customer
      customer.transactions.push(adjustmentTransaction._id);
      customer.returns = (customer.returns || []).filter(
        (r) => r.toString() !== id
      );
      customer.outstandingBalance += existingReturn.refundAmount;
      customer.balance += existingReturn.refundAmount;

      // ✅ Reverse Sales Statistics
      await updateSalesStatistics(
        existingReturn.product,
        existingReturn.invoice,
        existingReturn.quantity,
        existingReturn.refundAmount,
        session,
        false
      );

      await Promise.all([
        stock.save({ session }),
        invoice.save({ session }),
        adjustmentTransaction.save({ session }),
        customer.save({ session }),
      ]);
    }

    // ─────────────────────────────────────
    // Update Return Document
    // ─────────────────────────────────────
    Object.assign(existingReturn, updateFields);
    await existingReturn.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Return updated successfully',
      data: existingReturn,
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Return update error:', error);
    next(new AppError('Something went wrong during return update', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Delete Return (Soft Delete)
// ============================================================
exports.deleteReturn = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    const returnDoc = await Return.findOne({
      _id: id,
      isDeleted: false,
    }).session(session);

    if (!returnDoc) {
      throw new AppError('Return not found', 404);
    }

    if (returnDoc.status === 'processed') {
      throw new AppError('Cannot delete a processed return', 400);
    }

    // ─────────────────────────────────────
    // لو الـ return لسه active - اعكس التأثيرات
    // ─────────────────────────────────────
    if (returnDoc.status === 'active') {
      const [stock, invoice, customer] = await Promise.all([
        Stock.findOne({ product: returnDoc.product }).session(session),
        Invoice.findById(returnDoc.invoice).session(session),
        Customer.findById(returnDoc.customer).session(session),
      ]);

      if (stock) {
        if (stock.quantity < returnDoc.quantity) {
          throw new AppError('Insufficient stock to delete return', 400);
        }
        stock.quantity -= returnDoc.quantity;
        stock.lastStockUpdate = new Date();
        await stock.save({ session });
      }

      if (invoice) {
        invoice.refunds = Math.max(
          0,
          (invoice.refunds || 0) - returnDoc.refundAmount
        );
        invoice.subtotal += returnDoc.refundAmount;
        invoice.totalAmount += returnDoc.refundAmount;
        invoice.balanceDue += returnDoc.refundAmount;
        invoice.returns = (invoice.returns || []).filter(
          (r) => r.toString() !== id
        );
        await invoice.save({ session });
      }

      if (customer) {
        customer.outstandingBalance += returnDoc.refundAmount;
        customer.balance += returnDoc.refundAmount;
        customer.returns = (customer.returns || []).filter(
          (r) => r.toString() !== id
        );
        await customer.save({ session });
      }

      // ✅ Reverse Sales Statistics
      await updateSalesStatistics(
        returnDoc.product,
        returnDoc.invoice,
        returnDoc.quantity,
        returnDoc.refundAmount,
        session,
        false
      );
    }

    // ─────────────────────────────────────
    // Soft Delete
    // ─────────────────────────────────────
    returnDoc.isDeleted = true;
    returnDoc.deletedAt = new Date();
    returnDoc.status = 'cancelled';
    await returnDoc.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Return deleted successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Return deletion error:', error);
    next(new AppError('Something went wrong during return deletion', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Get Returns By Customer
// ============================================================
exports.getReturnsByCustomer = catchAsync(async (req, res, next) => {
  const { customerId } = req.params;

  const customer = await Customer.findById(customerId);
  if (!customer) {
    return next(new AppError('Customer not found', 404));
  }

  const returns = await Return.find({
    customer: customerId,
    isDeleted: false,
  })
    .populate('invoice', 'invoiceNumber totalAmount')
    .populate('product', 'name productCode')
    .sort('-createdAt');

  const summary = {
    totalReturns: returns.length,
    totalRefundAmount: returns.reduce(
      (sum, ret) => sum + (ret.refundAmount || 0),
      0
    ),
    returns,
  };

  res.status(200).json({
    status: 'success',
    data: summary,
  });
});

// ============================================================
// Get Returns By Date Range
// ============================================================
exports.getReturnsByDateRange = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.query;

  const query = { isDeleted: false };

  if (startDate && endDate) {
    // ✅ Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return next(new AppError('Invalid date format', 400));
    }

    if (start > end) {
      return next(new AppError('startDate must be before endDate', 400));
    }

    query.createdAt = {
      $gte: start,
      $lte: end,
    };
  }

  const returns = await Return.find(query)
    .populate('customer', 'name email')
    .populate('invoice', 'invoiceNumber')
    .populate('product', 'name productCode')
    .sort('-createdAt');

  res.status(200).json({
    status: 'success',
    results: returns.length,
    data: returns,
  });
});
