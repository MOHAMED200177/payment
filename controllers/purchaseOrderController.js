'use strict';
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
const { logAudit } = require('../utils/auditLog');

const populateOptions = [
  { path: 'supplier', select: 'name phone email paymentTerms' },
  { path: 'items.product', select: 'name productCode costPrice' },
];

exports.getAllPurchaseOrders = Crud.getAll(PurchaseOrder, populateOptions);
exports.getOnePurchaseOrder = Crud.getOneById(PurchaseOrder, populateOptions);

// ── Helpers ──────────────────────────────────────────────────
const calculateTotals = (subtotal, discount, tax) => {
  let discountAmount = 0;
  let taxAmount = 0;
  if (discount) {
    if (discount < 0 || discount > 100)
      throw new AppError('Discount must be between 0 and 100', 400);
    discountAmount = subtotal * (discount / 100);
  }
  if (tax) {
    if (tax < 0 || tax > 100)
      throw new AppError('Tax must be between 0 and 100', 400);
    taxAmount = (subtotal - discountAmount) * (tax / 100);
  }
  return {
    discountAmount,
    taxAmount,
    totalAmount: subtotal - discountAmount + taxAmount,
  };
};

// ============================================================
// Create Purchase Order — tenant-scoped
// ============================================================
exports.createPurchaseOrder = catchAsync(async (req, res, next) => {
  const {
    supplierName,
    items,
    discount,
    tax,
    expectedDeliveryDate,
    notes,
    amountPaid,
  } = req.body;
  const companyId = req.companyId;

  if (!supplierName || !items || !items.length)
    return next(new AppError('supplierName and items are required', 400));
  if (amountPaid < 0)
    return next(new AppError('Amount paid cannot be negative', 400));
  if (expectedDeliveryDate) {
    const d = new Date(expectedDeliveryDate);
    if (isNaN(d.getTime()))
      return next(new AppError('Invalid delivery date format', 400));

    // Compare against the start of today, not the exact current instant.
    // Using `new Date()` directly rejected same-day dates whenever the
    // delivery date's time component (e.g. midnight UTC from a plain
    // YYYY-MM-DD string) fell earlier than "right now" — which is true
    // for almost any request sent after midnight local time.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    if (d < startOfToday)
      return next(
        new AppError('Expected delivery date cannot be in the past', 400)
      );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const supplier = await Supplier.findOne({
      name: supplierName,
      active: true,
      company: companyId,
    }).session(session);
    if (!supplier) throw new AppError('Supplier not found or inactive', 404);

    const processedItems = [];
    let subtotal = 0;

    for (const item of items) {
      if (!item.product || !item.quantity || !item.unitCost)
        throw new AppError(
          'Each item must have product, quantity, and unitCost',
          400
        );
      if (item.quantity <= 0 || !Number.isInteger(item.quantity))
        throw new AppError(
          `Invalid quantity for product: ${item.product}`,
          400
        );
      if (item.unitCost < 0)
        throw new AppError(
          `Unit cost cannot be negative for product: ${item.product}`,
          400
        );

      const product = await Product.findOne({
        _id: item.product,
        company: companyId,
      }).session(session);
      if (!product)
        throw new AppError(`Product not found: ${item.product}`, 404);

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

    const { discountAmount, taxAmount, totalAmount } = calculateTotals(
      subtotal,
      discount,
      tax
    );
    if (amountPaid > totalAmount)
      throw new AppError(
        `Amount paid (${amountPaid}) exceeds total (${totalAmount})`,
        400
      );

    const balanceDue = totalAmount - (amountPaid || 0);
    const orderNumber = await getNextSequence(
      'purchaseOrder',
      companyId,
      session
    );

    const purchaseOrder = new PurchaseOrder({
      orderNumber,
      supplier: supplier._id,
      company: companyId,
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

    if (amountPaid > 0) {
      await SupplierPayment.create(
        [
          {
            purchaseOrder: purchaseOrder._id,
            supplier: supplier._id,
            company: companyId,
            amount: amountPaid,
            status: 'Success',
            method: 'Cash',
          },
        ],
        { session }
      );
    }

    const transactions = [
      {
        type: 'invoice',
        referenceId: purchaseOrder._id,
        amount: totalAmount,
        company: companyId,
        details: `Purchase Order #${purchaseOrder.formattedOrderNumber} created - Supplier: ${supplier.name}`,
        items: processedItems.map((i) => ({
          product: i.product,
          quantity: i.quantity,
          price: i.unitCost,
        })),
        status: 'credit',
      },
    ];
    if (amountPaid > 0) {
      transactions.push({
        type: 'payment',
        referenceId: purchaseOrder._id,
        amount: amountPaid,
        company: companyId,
        details: `Payment of ${amountPaid} for PO #${purchaseOrder.formattedOrderNumber}`,
        items: [],
        status: 'debit',
      });
    }
    await session.commitTransaction();

    logAudit({
      req,
      action: 'CREATE',
      module: 'PURCHASE_ORDER',
      entityId: purchaseOrder._id,
      entityLabel: purchaseOrder.formattedOrderNumber,
      newValues: {
        supplier: supplier.name,
        totalAmount,
        items: processedItems.length,
      },
    });

    const populated = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('supplier', 'name phone email')
      .populate('items.product', 'name productCode costPrice');
    res
      .status(201)
      .json({
        status: 'success',
        message: 'Purchase order created successfully',
        data: populated,
      });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    console.error('Purchase order creation error:', err);
    next(
      new AppError('Something went wrong during purchase order creation', 500)
    );
  } finally {
    session.endSession();
  }
});

// ============================================================
// Receive Items — tenant-scoped
// ============================================================
exports.receiveItems = catchAsync(async (req, res, next) => {
  const { items, notes } = req.body;
  const companyId = req.companyId;

  if (!items || !items.length)
    return next(new AppError('Items are required', 400));
  for (const item of items) {
    if (!item.product || !item.receivedQuantity)
      throw new AppError(
        'Each item must have product and receivedQuantity',
        400
      );
    if (item.receivedQuantity <= 0 || !Number.isInteger(item.receivedQuantity))
      return next(
        new AppError(
          `Invalid received quantity for product: ${item.product}`,
          400
        )
      );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const purchaseOrder = await PurchaseOrder.findOne({
      _id: req.params.id,
      company: companyId,
    })
      .populate('items.product')
      .session(session);
    if (!purchaseOrder) throw new AppError('Purchase order not found', 404);
    if (purchaseOrder.status === 'cancelled')
      throw new AppError('Cannot receive items for a cancelled order', 400);
    if (purchaseOrder.status === 'received')
      throw new AppError('All items already received', 400);

    const stockUpdates = [];
    const transactionItems = [];

    for (const receivedItem of items) {
      const orderItem = purchaseOrder.items.find(
        (i) => i.product._id.toString() === receivedItem.product.toString()
      );
      if (!orderItem)
        throw new AppError(
          `Product ${receivedItem.product} not found in this order`,
          404
        );

      const remaining = orderItem.quantity - (orderItem.receivedQuantity || 0);
      if (receivedItem.receivedQuantity > remaining)
        throw new AppError(
          `Cannot receive ${receivedItem.receivedQuantity} units. Only ${remaining} remaining.`,
          400
        );

      orderItem.receivedQuantity =
        (orderItem.receivedQuantity || 0) + receivedItem.receivedQuantity;

      const existingStock = await Stock.findOne({
        product: orderItem.product._id,
        company: companyId,
      }).session(session);
      if (existingStock) {
        stockUpdates.push({
          updateOne: {
            filter: { _id: existingStock._id },
            update: {
              $inc: { quantity: receivedItem.receivedQuantity },
              $set: {
                lastStockUpdate: new Date(),
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
        await Stock.create(
          [
            {
              product: orderItem.product._id,
              quantity: receivedItem.receivedQuantity,
              company: companyId,
              batchNumber: receivedItem.batchNumber || null,
              expiryDate: receivedItem.expiryDate || null,
              lastStockUpdate: new Date(),
            },
          ],
          { session }
        );
      }

      if (
        receivedItem.unitCost &&
        receivedItem.unitCost !== orderItem.product.costPrice
      ) {
        await Product.findOneAndUpdate(
          { _id: orderItem.product._id, company: companyId },
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

    if (stockUpdates.length) await Stock.bulkWrite(stockUpdates, { session });
    if (notes) purchaseOrder.notes = notes;
    purchaseOrder.receivedDate = new Date();
    await purchaseOrder.save({ session });

    await Transaction.create(
      [
        {
          type: 'invoice',
          referenceId: purchaseOrder._id,
          company: companyId,
          amount: transactionItems.reduce(
            (s, i) => s + i.price * i.quantity,
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

    const updated = await PurchaseOrder.findById(req.params.id)
      .populate('supplier', 'name phone email')
      .populate('items.product', 'name productCode costPrice');
    res
      .status(200)
      .json({
        status: 'success',
        message: 'Items received and stock updated successfully',
        data: updated,
      });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during receiving items', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Add Supplier Payment — tenant-scoped
// ============================================================
exports.addSupplierPayment = catchAsync(async (req, res, next) => {
  const { amount, method, notes } = req.body;
  const companyId = req.companyId;

  if (!amount || amount <= 0)
    return next(new AppError('Valid payment amount is required', 400));
  const VALID = ['Cash', 'Credit Card', 'Bank Transfer', 'Other'];
  if (method && !VALID.includes(method))
    return next(
      new AppError(`Invalid method. Must be one of: ${VALID.join(', ')}`, 400)
    );

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const purchaseOrder = await PurchaseOrder.findOne({
      _id: req.params.id,
      company: companyId,
    })
      .populate('supplier')
      .session(session);
    if (!purchaseOrder) throw new AppError('Purchase order not found', 404);
    if (purchaseOrder.status === 'cancelled')
      throw new AppError('Cannot pay for a cancelled order', 400);
    if (purchaseOrder.paymentStatus === 'paid')
      throw new AppError('Purchase order is already fully paid', 400);
    if (amount > purchaseOrder.balanceDue)
      throw new AppError(
        `Payment (${amount}) exceeds balance due (${purchaseOrder.balanceDue})`,
        400
      );

    const supplierPayment = new SupplierPayment({
      purchaseOrder: purchaseOrder._id,
      supplier: purchaseOrder.supplier._id,
      company: companyId,
      amount,
      method: method || 'Cash',
      status: 'Success',
      notes: notes || null,
    });
    await supplierPayment.save({ session });

    purchaseOrder.amountPaid += amount;
    purchaseOrder.balanceDue -= amount;
    await purchaseOrder.save({ session });

    await Transaction.create(
      [
        {
          type: 'payment',
          referenceId: purchaseOrder._id,
          amount,
          company: companyId,
          details: `Payment of ${amount} for PO #${purchaseOrder.formattedOrderNumber} - Supplier: ${purchaseOrder.supplier.name}`,
          items: [],
          status: 'debit',
        },
      ],
      { session }
    );
    await session.commitTransaction();

    logAudit({
      req,
      action: 'PAYMENT',
      module: 'PURCHASE_ORDER',
      entityId: purchaseOrder._id,
      entityLabel: purchaseOrder.formattedOrderNumber,
      newValues: {
        amount,
        method: method || 'Cash',
        remainingBalance: purchaseOrder.balanceDue,
      },
    });

    res
      .status(201)
      .json({
        status: 'success',
        message: 'Payment added successfully',
        data: {
          payment: supplierPayment,
          updatedBalance: purchaseOrder.balanceDue,
          paymentStatus: purchaseOrder.paymentStatus,
        },
      });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during payment', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Cancel Purchase Order — tenant-scoped
// ============================================================
exports.cancelPurchaseOrder = catchAsync(async (req, res, next) => {
  const companyId = req.companyId;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { reason } = req.body;
    const purchaseOrder = await PurchaseOrder.findOne({
      _id: id,
      company: companyId,
    })
      .populate('items.product')
      .session(session);
    if (!purchaseOrder) throw new AppError('Purchase order not found', 404);
    if (purchaseOrder.status === 'cancelled')
      throw new AppError('Order is already cancelled', 400);
    if (purchaseOrder.status === 'received')
      throw new AppError(
        'Cannot cancel a fully received order. Create a return instead.',
        400
      );

    const stockReverts = purchaseOrder.items
      .filter((i) => i.receivedQuantity > 0)
      .map((i) => ({
        updateOne: {
          filter: { product: i.product._id, company: companyId },
          update: {
            $inc: { quantity: -i.receivedQuantity },
            $set: { lastStockUpdate: new Date() },
          },
        },
      }));
    if (stockReverts.length) await Stock.bulkWrite(stockReverts, { session });

    purchaseOrder.status = 'cancelled';
    if (reason) purchaseOrder.notes = reason;
    await purchaseOrder.save({ session });

    await Transaction.create(
      [
        {
          type: 'return',
          referenceId: purchaseOrder._id,
          amount: purchaseOrder.totalAmount,
          company: companyId,
          details: `PO #${purchaseOrder.formattedOrderNumber} cancelled${reason ? ` - Reason: ${reason}` : ''}`,
          items: [],
          status: 'credit',
        },
      ],
      { session }
    );
    await session.commitTransaction();

    logAudit({
      req,
      action: 'CANCEL',
      module: 'PURCHASE_ORDER',
      entityId: purchaseOrder._id,
      entityLabel: purchaseOrder.formattedOrderNumber,
      newValues: { status: 'cancelled', reason: reason || null },
    });

    res
      .status(200)
      .json({
        status: 'success',
        message: 'Purchase order cancelled successfully',
        data: purchaseOrder,
      });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during cancellation', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Stats — tenant-scoped aggregation
// ============================================================
exports.getPurchaseStats = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.query;
  const companyId = req.companyId;

  const filter = { isDeleted: false, company: companyId };
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()))
      return next(new AppError('Invalid date format', 400));
    filter.createdAt = { $gte: start, $lte: end };
  }

  const [stats, statusStats, topSuppliers] = await Promise.all([
    PurchaseOrder.aggregate([
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
    ]),
    PurchaseOrder.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
        },
      },
    ]),
    PurchaseOrder.aggregate([
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
    ]),
  ]);

  res
    .status(200)
    .json({
      status: 'success',
      data: {
        summary: {
          totalOrders: stats[0]?.totalOrders || 0,
          totalAmount: (stats[0]?.totalAmount || 0).toFixed(2),
          totalPaid: (stats[0]?.totalPaid || 0).toFixed(2),
          totalOutstanding: (stats[0]?.totalOutstanding || 0).toFixed(2),
          averageOrderValue: (stats[0]?.averageOrderValue || 0).toFixed(2),
        },
        byStatus: statusStats,
        topSuppliers,
      },
    });
});

// ============================================================
// Delete (Soft) — tenant-scoped
// ============================================================
exports.deletePurchaseOrder = catchAsync(async (req, res, next) => {
  const companyId = req.companyId;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const purchaseOrder = await PurchaseOrder.findOne({
      _id: id,
      company: companyId,
    }).session(session);
    if (!purchaseOrder) throw new AppError('Purchase order not found', 404);
    if (!['draft', 'cancelled'].includes(purchaseOrder.status))
      throw new AppError('Can only delete draft or cancelled orders.', 400);

    purchaseOrder.isDeleted = true;
    purchaseOrder.deletedAt = new Date();
    purchaseOrder.deletedBy = req.user._id;
    await purchaseOrder.save({ session });
    await session.commitTransaction();

    logAudit({
      req,
      action: 'SOFT_DELETE',
      module: 'PURCHASE_ORDER',
      entityId: purchaseOrder._id,
      entityLabel: purchaseOrder.orderNumber,
      oldValues: { status: purchaseOrder.status },
    });

    res
      .status(200)
      .json({
        status: 'success',
        message: 'Purchase order deleted successfully',
      });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during deletion', 500));
  } finally {
    session.endSession();
  }
});
