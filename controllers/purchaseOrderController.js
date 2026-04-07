const mongoose = require('mongoose');
const PurchaseOrder = require('../models/purchaseOrder.model');
const SupplierPayment = require('../models/supplierPayment.model');
const Supplier = require('../models/supplier');
const Product = require('../models/product');
const Stock = require('../models/stock');
const Transaction = require('../models/transactions');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const getNextSequence = require('../utils/getNextSequence');
const Crud = require('./crudFactory');

// ============================================================
// Populate Options
// ============================================================
const populateOptions = [
  { path: 'supplier', select: 'name phone email paymentTerms' },
  { path: 'items.product', select: 'name productCode costPrice' },
];

// ============================================================
// Basic CRUD
// ============================================================
exports.getAllPurchaseOrders = Crud.getAll(PurchaseOrder, populateOptions);
exports.getOnePurchaseOrder = Crud.getOneById(PurchaseOrder, populateOptions);

// ============================================================
// Helpers
// ============================================================

/**
 * جلب المنتجات والـ stocks
 */
const getProductsAndStocks = async (items, session) => {
  const productIds = items.map((item) => item.product);

  const products = await Product.find({
    _id: { $in: productIds },
  }).session(session);

  if (products.length !== productIds.length) {
    const foundIds = products.map((p) => p._id.toString());
    const missing = productIds.filter(
      (id) => !foundIds.includes(id.toString())
    );
    throw new AppError(`Products not found: ${missing.join(', ')}`, 404);
  }

  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  const stocks = await Stock.find({
    product: { $in: productIds },
  }).session(session);

  const stockMap = new Map(stocks.map((s) => [s.product.toString(), s]));

  return { productMap, stockMap };
};

/**
 * حساب الـ totals
 */
const calculateTotals = (subtotal, discount, tax) => {
  let discountAmount = 0;
  let taxAmount = 0;

  if (discount) {
    if (discount < 0 || discount > 100) {
      throw new AppError('Discount must be between 0 and 100', 400);
    }
    discountAmount = subtotal * (discount / 100);
  }

  if (tax) {
    if (tax < 0 || tax > 100) {
      throw new AppError('Tax must be between 0 and 100', 400);
    }
    taxAmount = (subtotal - discountAmount) * (tax / 100);
  }

  const totalAmount = subtotal - discountAmount + taxAmount;

  return { discountAmount, taxAmount, totalAmount };
};

// ============================================================
// Create Purchase Order
// ============================================================
exports.createPurchaseOrder = catchAsync(async (req, res, next) => {
  // ✅ Validate قبل فتح Session
  const {
    supplierName,
    items,
    discount,
    tax,
    expectedDeliveryDate,
    notes,
    amountPaid,
  } = req.body;

  if (!supplierName || !items || items.length === 0) {
    return next(new AppError('supplierName and items are required', 400));
  }

  if (amountPaid < 0) {
    return next(new AppError('Amount paid cannot be negative', 400));
  }

  // ✅ Validate expectedDeliveryDate
  if (expectedDeliveryDate) {
    const deliveryDate = new Date(expectedDeliveryDate);
    if (isNaN(deliveryDate.getTime())) {
      return next(new AppError('Invalid delivery date format', 400));
    }
    if (deliveryDate < new Date()) {
      return next(
        new AppError('Expected delivery date cannot be in the past', 400)
      );
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ─────────────────────────────────────
    // Find Supplier
    // ─────────────────────────────────────
    const supplier = await Supplier.findOne({
      name: supplierName,
      active: true,
    }).session(session);

    if (!supplier) {
      throw new AppError('Supplier not found or inactive', 404);
    }

    // ─────────────────────────────────────
    // Process Items
    // ─────────────────────────────────────
    const processedItems = [];
    let subtotal = 0;

    for (const item of items) {
      if (!item.product || !item.quantity || !item.unitCost) {
        throw new AppError(
          'Each item must have product, quantity, and unitCost',
          400
        );
      }

      if (item.quantity <= 0 || !Number.isInteger(item.quantity)) {
        throw new AppError(
          `Invalid quantity for product: ${item.product}`,
          400
        );
      }

      if (item.unitCost < 0) {
        throw new AppError(
          `Unit cost cannot be negative for product: ${item.product}`,
          400
        );
      }

      const product = await Product.findById(item.product).session(session);
      if (!product) {
        throw new AppError(`Product not found: ${item.product}`, 404);
      }

      const lineTotal = item.unitCost * item.quantity;
      subtotal += lineTotal;

      processedItems.push({
        product: product._id,
        quantity: item.quantity,
        unitCost: item.unitCost,
        lineTotal,
        receivedQuantity: 0,
      });
    }

    // ─────────────────────────────────────
    // Calculate Totals
    // ─────────────────────────────────────
    const { discountAmount, taxAmount, totalAmount } = calculateTotals(
      subtotal,
      discount,
      tax
    );

    if (amountPaid > totalAmount) {
      throw new AppError(
        `Amount paid (${amountPaid}) exceeds total (${totalAmount})`,
        400
      );
    }

    const balanceDue = totalAmount - (amountPaid || 0);

    // ─────────────────────────────────────
    // Generate Order Number
    // ─────────────────────────────────────
    let orderNumber;
    try {
      orderNumber = await getNextSequence('purchaseOrder', session);
    } catch (err) {
      throw new AppError('Failed to generate order number', 500);
    }

    // ─────────────────────────────────────
    // Create Purchase Order
    // ─────────────────────────────────────
    const purchaseOrder = new PurchaseOrder({
      orderNumber,
      supplier: supplier._id,
      items: processedItems,
      subtotal,
      discountAmount,
      taxAmount,
      totalAmount,
      amountPaid: amountPaid || 0,
      balanceDue,
      status: 'ordered',
      expectedDeliveryDate: expectedDeliveryDate || null,
      notes: notes || null,
    });

    await purchaseOrder.save({ session });

    // ─────────────────────────────────────
    // Create Supplier Payment (if paid)
    // ─────────────────────────────────────
    if (amountPaid > 0) {
      const supplierPayment = new SupplierPayment({
        purchaseOrder: purchaseOrder._id,
        supplier: supplier._id,
        amount: amountPaid,
        status: 'Success',
        method: 'Cash',
      });
      await supplierPayment.save({ session });
    }

    // ─────────────────────────────────────
    // Create Transaction
    // ─────────────────────────────────────
    const transactions = [
      {
        type: 'invoice',
        referenceId: purchaseOrder._id,
        amount: totalAmount,
        details: `Purchase Order #${purchaseOrder.formattedOrderNumber} created - Supplier: ${supplier.name}`,
        items: processedItems.map((item) => ({
          product: item.product,
          quantity: item.quantity,
          price: item.unitCost,
        })),
        status: 'credit', // ✅ المشتريات = credit (مصروف)
      },
    ];

    if (amountPaid > 0) {
      transactions.push({
        type: 'payment',
        referenceId: purchaseOrder._id,
        amount: amountPaid,
        details: `Payment of ${amountPaid} for PO #${purchaseOrder.formattedOrderNumber}`,
        items: [],
        status: 'debit',
      });
    }

    await Transaction.insertMany(transactions, { session });
    await session.commitTransaction();

    // ✅ Populate الـ response
    const populatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('supplier', 'name phone email')
      .populate('items.product', 'name productCode costPrice');

    res.status(201).json({
      status: 'success',
      message: 'Purchase order created successfully',
      data: populatedOrder,
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Purchase order creation error:', error);
    next(
      new AppError('Something went wrong during purchase order creation', 500)
    );
  } finally {
    session.endSession();
  }
});

// ============================================================
// Receive Items - استلام البضاعة وتحديث الـ Stock
// ============================================================
exports.receiveItems = catchAsync(async (req, res, next) => {
  // ✅ Validate قبل فتح Session
  const { items, notes } = req.body;

  if (!items || items.length === 0) {
    return next(new AppError('Items are required', 400));
  }

  for (const item of items) {
    if (!item.product || !item.receivedQuantity) {
      throw new AppError(
        'Each item must have product and receivedQuantity',
        400
      );
    }
    if (
      item.receivedQuantity <= 0 ||
      !Number.isInteger(item.receivedQuantity)
    ) {
      return next(
        new AppError(
          `Invalid received quantity for product: ${item.product}`,
          400
        )
      );
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    // ─────────────────────────────────────
    // Find Purchase Order
    // ─────────────────────────────────────
    const purchaseOrder = await PurchaseOrder.findById(id)
      .populate('items.product')
      .session(session);

    if (!purchaseOrder) {
      throw new AppError('Purchase order not found', 404);
    }

    if (purchaseOrder.status === 'cancelled') {
      throw new AppError('Cannot receive items for a cancelled order', 400);
    }

    if (purchaseOrder.status === 'received') {
      throw new AppError('All items already received', 400);
    }

    // ─────────────────────────────────────
    // Process Each Item
    // ─────────────────────────────────────
    const stockUpdates = [];
    const transactionItems = [];

    for (const receivedItem of items) {
      // ✅ Find matching item in order
      const orderItem = purchaseOrder.items.find(
        (item) =>
          item.product._id.toString() === receivedItem.product.toString()
      );

      if (!orderItem) {
        throw new AppError(
          `Product ${receivedItem.product} not found in this order`,
          404
        );
      }

      // ✅ Check مش بيستلم أكتر من المطلوب
      const remainingToReceive =
        orderItem.quantity - (orderItem.receivedQuantity || 0);

      if (receivedItem.receivedQuantity > remainingToReceive) {
        throw new AppError(
          `Cannot receive ${receivedItem.receivedQuantity} units. Only ${remainingToReceive} remaining for product ${orderItem.product.name}`,
          400
        );
      }

      // ✅ Update received quantity in order
      orderItem.receivedQuantity =
        (orderItem.receivedQuantity || 0) + receivedItem.receivedQuantity;

      // ✅ Update Stock
      const existingStock = await Stock.findOne({
        product: orderItem.product._id,
      }).session(session);

      if (existingStock) {
        // زود الكمية للـ stock الموجود
        stockUpdates.push({
          updateOne: {
            filter: { _id: existingStock._id },
            update: {
              $inc: { quantity: receivedItem.receivedQuantity },
              $set: {
                lastStockUpdate: new Date(),
                // ✅ تحديث الـ batch و expiry لو موجودين
                ...(receivedItem.batchNumber && {
                  batchNumber: receivedItem.batchNumber,
                }),
                ...(receivedItem.expiryDate && {
                  expiryDate: new Date(receivedItem.expiryDate),
                }),
              },
            },
          },
        });
      } else {
        // ✅ إنشاء stock جديد
        const newStock = new Stock({
          product: orderItem.product._id,
          quantity: receivedItem.receivedQuantity,
          batchNumber: receivedItem.batchNumber || null,
          expiryDate: receivedItem.expiryDate || null,
          lastStockUpdate: new Date(),
        });
        await newStock.save({ session });
      }

      // ✅ تحديث الـ costPrice في الـ Product لو اتغير
      if (
        receivedItem.unitCost &&
        receivedItem.unitCost !== orderItem.product.costPrice
      ) {
        await Product.findByIdAndUpdate(
          orderItem.product._id,
          { $set: { costPrice: receivedItem.unitCost } },
          { session }
        );
      }

      transactionItems.push({
        product: orderItem.product._id,
        quantity: receivedItem.receivedQuantity,
        price: orderItem.unitCost,
      });
    }

    // ✅ Bulk update stocks
    if (stockUpdates.length > 0) {
      await Stock.bulkWrite(stockUpdates, { session });
    }

    // ─────────────────────────────────────
    // Update Purchase Order
    // ─────────────────────────────────────
    if (notes) purchaseOrder.notes = notes;
    purchaseOrder.receivedDate = new Date();
    await purchaseOrder.save({ session }); // pre save بيحدث الـ status تلقائي

    // ─────────────────────────────────────
    // Create Transaction
    // ─────────────────────────────────────
    await Transaction.create(
      [
        {
          type: 'invoice',
          referenceId: purchaseOrder._id,
          amount: transactionItems.reduce(
            (sum, item) => sum + item.price * item.quantity,
            0
          ),
          details: `Items received for PO #${purchaseOrder.formattedOrderNumber}`,
          items: transactionItems,
          status: 'debit',
        },
      ],
      { session }
    );

    await session.commitTransaction();

    // ✅ Populate الـ response
    const updatedOrder = await PurchaseOrder.findById(id)
      .populate('supplier', 'name phone email')
      .populate('items.product', 'name productCode costPrice');

    res.status(200).json({
      status: 'success',
      message: 'Items received and stock updated successfully',
      data: updatedOrder,
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Receive items error:', error);
    next(new AppError('Something went wrong during receiving items', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Add Supplier Payment
// ============================================================
exports.addSupplierPayment = catchAsync(async (req, res, next) => {
  // ✅ Validate قبل فتح Session
  const { amount, method, notes } = req.body;

  if (!amount || amount <= 0) {
    return next(new AppError('Valid payment amount is required', 400));
  }

  const VALID_METHODS = ['Cash', 'Credit Card', 'Bank Transfer', 'Other'];
  if (method && !VALID_METHODS.includes(method)) {
    return next(
      new AppError(
        `Invalid method. Must be one of: ${VALID_METHODS.join(', ')}`,
        400
      )
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    // ─────────────────────────────────────
    // Find Purchase Order
    // ─────────────────────────────────────
    const purchaseOrder = await PurchaseOrder.findById(id)
      .populate('supplier')
      .session(session);

    if (!purchaseOrder) {
      throw new AppError('Purchase order not found', 404);
    }

    if (purchaseOrder.status === 'cancelled') {
      throw new AppError('Cannot pay for a cancelled order', 400);
    }

    if (purchaseOrder.paymentStatus === 'paid') {
      throw new AppError('Purchase order is already fully paid', 400);
    }

    // ✅ Check amount لا يتعدى الـ balance
    if (amount > purchaseOrder.balanceDue) {
      throw new AppError(
        `Payment amount (${amount}) exceeds balance due (${purchaseOrder.balanceDue})`,
        400
      );
    }

    // ─────────────────────────────────────
    // Create Supplier Payment
    // ─────────────────────────────────────
    const supplierPayment = new SupplierPayment({
      purchaseOrder: purchaseOrder._id,
      supplier: purchaseOrder.supplier._id,
      amount,
      method: method || 'Cash',
      status: 'Success',
      notes: notes || null,
    });
    await supplierPayment.save({ session });

    // ─────────────────────────────────────
    // Update Purchase Order
    // ─────────────────────────────────────
    purchaseOrder.amountPaid += amount;
    purchaseOrder.balanceDue -= amount;
    await purchaseOrder.save({ session }); // pre save بيحدث الـ paymentStatus

    // ─────────────────────────────────────
    // Create Transaction
    // ─────────────────────────────────────
    await Transaction.create(
      [
        {
          type: 'payment',
          referenceId: purchaseOrder._id,
          amount,
          details: `Payment of ${amount} for PO #${purchaseOrder.formattedOrderNumber} - Supplier: ${purchaseOrder.supplier.name}`,
          items: [],
          status: 'debit',
        },
      ],
      { session }
    );

    await session.commitTransaction();

    res.status(201).json({
      status: 'success',
      message: 'Payment added successfully',
      data: {
        payment: supplierPayment,
        updatedBalance: purchaseOrder.balanceDue,
        paymentStatus: purchaseOrder.paymentStatus,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Supplier payment error:', error);
    next(new AppError('Something went wrong during payment', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Cancel Purchase Order
// ============================================================
exports.cancelPurchaseOrder = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { reason } = req.body;

    const purchaseOrder = await PurchaseOrder.findById(id)
      .populate('items.product')
      .session(session);

    if (!purchaseOrder) {
      throw new AppError('Purchase order not found', 404);
    }

    if (purchaseOrder.status === 'cancelled') {
      throw new AppError('Order is already cancelled', 400);
    }

    if (purchaseOrder.status === 'received') {
      throw new AppError(
        'Cannot cancel a fully received order. Create a return instead.',
        400
      );
    }

    // ─────────────────────────────────────
    // Revert Stock للـ items اللي اتستلمت
    // ─────────────────────────────────────
    const stockReverts = [];

    for (const item of purchaseOrder.items) {
      if (item.receivedQuantity > 0) {
        stockReverts.push({
          updateOne: {
            filter: { product: item.product._id },
            update: {
              $inc: { quantity: -item.receivedQuantity },
              $set: { lastStockUpdate: new Date() },
            },
          },
        });
      }
    }

    if (stockReverts.length > 0) {
      await Stock.bulkWrite(stockReverts, { session });
    }

    // ─────────────────────────────────────
    // Update Purchase Order
    // ─────────────────────────────────────
    purchaseOrder.status = 'cancelled';
    if (reason) purchaseOrder.notes = reason;
    await purchaseOrder.save({ session });

    // ─────────────────────────────────────
    // Create Transaction
    // ─────────────────────────────────────
    await Transaction.create(
      [
        {
          type: 'return',
          referenceId: purchaseOrder._id,
          amount: purchaseOrder.totalAmount,
          details: `PO #${purchaseOrder.formattedOrderNumber} cancelled${reason ? ` - Reason: ${reason}` : ''}`,
          items: [],
          status: 'credit',
        },
      ],
      { session }
    );

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Purchase order cancelled successfully',
      data: purchaseOrder,
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    console.error('Cancel purchase order error:', error);
    next(new AppError('Something went wrong during cancellation', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Get Purchase Order Stats
// ============================================================
exports.getPurchaseStats = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.query;

  const filter = { isDeleted: false };

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return next(new AppError('Invalid date format', 400));
    }

    filter.createdAt = { $gte: start, $lte: end };
  }

  const stats = await PurchaseOrder.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalAmount: { $sum: '$totalAmount' },
        totalPaid: { $sum: '$amountPaid' },
        totalOutstanding: { $sum: '$balanceDue' },
        totalDiscount: { $sum: '$discountAmount' },
        averageOrderValue: { $avg: '$totalAmount' },
      },
    },
  ]);

  // ✅ Stats by status
  const statusStats = await PurchaseOrder.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$totalAmount' },
      },
    },
  ]);

  // ✅ Top Suppliers
  const topSuppliers = await PurchaseOrder.aggregate([
    { $match: { ...filter, status: { $ne: 'cancelled' } } },
    {
      $group: {
        _id: '$supplier',
        totalOrders: { $sum: 1 },
        totalAmount: { $sum: '$totalAmount' },
      },
    },
    {
      $lookup: {
        from: 'suppliers',
        localField: '_id',
        foreignField: '_id',
        as: 'supplierInfo',
      },
    },
    { $unwind: '$supplierInfo' },
    {
      $project: {
        _id: 0,
        supplierName: '$supplierInfo.name',
        totalOrders: 1,
        totalAmount: { $round: ['$totalAmount', 2] },
      },
    },
    { $sort: { totalAmount: -1 } },
    { $limit: 5 },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      summary: {
        totalOrders: stats[0]?.totalOrders || 0,
        totalAmount: (stats[0]?.totalAmount || 0).toFixed(2),
        totalPaid: (stats[0]?.totalPaid || 0).toFixed(2),
        totalOutstanding: (stats[0]?.totalOutstanding || 0).toFixed(2),
        totalDiscount: (stats[0]?.totalDiscount || 0).toFixed(2),
        averageOrderValue: (stats[0]?.averageOrderValue || 0).toFixed(2),
      },
      byStatus: statusStats,
      topSuppliers,
    },
  });
});

// ============================================================
// Delete Purchase Order (Soft Delete)
// ============================================================
exports.deletePurchaseOrder = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    const purchaseOrder = await PurchaseOrder.findById(id).session(session);

    if (!purchaseOrder) {
      throw new AppError('Purchase order not found', 404);
    }

    // ✅ بس ممكن تحذف الـ draft أو cancelled
    if (!['draft', 'cancelled'].includes(purchaseOrder.status)) {
      throw new AppError(
        'Can only delete draft or cancelled orders. Cancel the order first.',
        400
      );
    }

    purchaseOrder.isDeleted = true;
    await purchaseOrder.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Purchase order deleted successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) return next(error);
    next(new AppError('Something went wrong during deletion', 500));
  } finally {
    session.endSession();
  }
});
