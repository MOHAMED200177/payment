'use strict';
const Crud = require('./crudFactory');
const Stock = require('../models/stock');
const Product = require('../models/product');
const Transaction = require('../models/transactions');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { logAudit } = require('../utils/auditLog');
const mongoose = require('mongoose');

const populateOptions = [
  { path: 'product', select: 'name productCode sellingPrice reorderLevel' },
];

exports.allStock = Crud.getAll(Stock, populateOptions);
exports.oneStock = Crud.getOneById(Stock, populateOptions);

// ============================================================
// Create Stock — tenant-scoped
// ============================================================
exports.createStock = catchAsync(async (req, res, next) => {
  const { productName, quantity, batchNumber, expiryDate } = req.body;

  if (!productName || quantity === undefined) {
    return next(new AppError('productName and quantity are required', 400));
  }
  if (quantity < 0 || !Number.isInteger(quantity)) {
    return next(new AppError('Quantity must be a non-negative integer', 400));
  }
  if (expiryDate) {
    const expiry = new Date(expiryDate);
    if (isNaN(expiry.getTime())) return next(new AppError('Invalid expiry date format', 400));
    if (expiry < new Date()) return next(new AppError('Expiry date cannot be in the past', 400));
  }

  const product = await Product.findOne({ name: productName, ...req.tenantFilter, isDeleted: { $ne: true } });
  if (!product) return next(new AppError('No product found with that name', 404));

  const existingStock = await Stock.findOne({ product: product._id, ...req.tenantFilter });
  if (existingStock) {
    return next(new AppError(`Stock already exists for "${productName}". Use adjust instead.`, 409));
  }

  const stock = await Stock.create({
    product: product._id,
    quantity,
    batchNumber: batchNumber || null,
    expiryDate: expiryDate || null,
    lastStockUpdate: new Date(),
    company: req.companyId,
  });

  logAudit({ req, action: 'CREATE', module: 'STOCK', entityId: stock._id, entityLabel: productName, newValues: { quantity } });

  const populated = await Stock.findById(stock._id)
    .populate('product', 'name productCode sellingPrice reorderLevel');

  res.status(201).json({ status: 'success', data: populated });
});

// ============================================================
// Adjust Stock — audited, creates a Transaction record
// Replaces direct PATCH /stock/:id which had no audit trail
// ============================================================
exports.adjustStock = catchAsync(async (req, res, next) => {
  const { adjustmentQty, reason, batchNumber, expiryDate } = req.body;
  const companyId = req.companyId;

  if (adjustmentQty === undefined || adjustmentQty === null) {
    return next(new AppError('adjustmentQty is required (positive to add, negative to remove)', 400));
  }
  if (!Number.isInteger(adjustmentQty)) {
    return next(new AppError('adjustmentQty must be an integer', 400));
  }
  if (!reason || !reason.trim()) {
    return next(new AppError('reason is required for stock adjustments', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const stock = await Stock.findOne({ _id: req.params.id, ...req.tenantFilter }).session(session);
    if (!stock) throw new AppError('Stock record not found', 404);

    const newQty = stock.quantity + adjustmentQty;
    if (newQty < 0) {
      throw new AppError(
        `Adjustment would result in negative stock. Current: ${stock.quantity}, Adjustment: ${adjustmentQty}`,
        400
      );
    }

    const oldQty = stock.quantity;
    stock.quantity = newQty;
    stock.lastStockUpdate = new Date();
    if (batchNumber) stock.batchNumber = batchNumber;
    if (expiryDate) stock.expiryDate = new Date(expiryDate);
    await stock.save({ session });

    // Create a transaction record for the adjustment
    await Transaction.create(
      [
        {
          type: 'adjustment',
          referenceId: stock._id,
          referenceModel: 'Stock',
          amount: 0, // Adjustments don't have a monetary amount directly
          details: `Stock adjustment: ${adjustmentQty > 0 ? '+' : ''}${adjustmentQty} units. Reason: ${reason}. Old qty: ${oldQty}, New qty: ${newQty}`,
          items: [],
          status: adjustmentQty > 0 ? 'debit' : 'credit',
          company: companyId,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    logAudit({
      req,
      action: 'UPDATE',
      module: 'STOCK',
      entityId: stock._id,
      entityLabel: `Stock adjustment`,
      oldValues: { quantity: oldQty },
      newValues: { quantity: newQty, adjustmentQty, reason },
    });

    const populated = await Stock.findById(stock._id).populate('product', 'name productCode sellingPrice reorderLevel');
    res.status(200).json({ status: 'success', message: 'Stock adjusted successfully', data: populated });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return next(err);
    next(new AppError('Something went wrong during stock adjustment', 500));
  } finally {
    session.endSession();
  }
});

// ============================================================
// Delete Stock — tenant-scoped
// ============================================================
exports.deleteStock = Crud.deleteOne(Stock);

// ============================================================
// Low Stock — tenant-scoped, aggregation-based
// ============================================================
exports.getLowStock = catchAsync(async (req, res) => {
  const companyId = req.companyId;

  const lowStock = await Stock.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(companyId.toString()) } },
    {
      $lookup: {
        from: 'products',
        localField: 'product',
        foreignField: '_id',
        as: 'productInfo',
      },
    },
    { $unwind: '$productInfo' },
    {
      $match: {
        'productInfo.isDeleted': { $ne: true },
        $expr: { $lte: ['$quantity', '$productInfo.reorderLevel'] },
      },
    },
    {
      $project: {
        _id: 0,
        stockId: '$_id',
        productName: '$productInfo.name',
        productCode: '$productInfo.productCode',
        currentQuantity: '$quantity',
        reorderLevel: '$productInfo.reorderLevel',
        shortage: { $subtract: ['$productInfo.reorderLevel', '$quantity'] },
        lastUpdate: '$lastStockUpdate',
      },
    },
    { $sort: { shortage: -1 } },
  ]);

  res.status(200).json({ status: 'success', results: lowStock.length, data: lowStock });
});

// ============================================================
// Expiring Soon — tenant-scoped
// ============================================================
exports.getExpiringSoon = catchAsync(async (req, res, next) => {
  const { days = 30 } = req.query;
  const daysNum = parseInt(days);
  if (isNaN(daysNum) || daysNum < 1) {
    return next(new AppError('Days must be a positive number', 400));
  }

  const today = new Date();
  const warningDate = new Date();
  warningDate.setDate(today.getDate() + daysNum);

  const items = await Stock.find({
    ...req.tenantFilter,
    expiryDate: { $gte: today, $lte: warningDate },
    quantity: { $gt: 0 },
  }).populate('product', 'name productCode sellingPrice');

  res.status(200).json({
    status: 'success',
    results: items.length,
    data: items.map((s) => ({
      productName: s.product?.name,
      productCode: s.product?.productCode,
      currentQuantity: s.quantity,
      expiryDate: s.expiryDate,
      daysUntilExpiry: Math.ceil((s.expiryDate - today) / (1000 * 60 * 60 * 24)),
    })),
  });
});

// ============================================================
// Expired Stock — tenant-scoped
// ============================================================
exports.getExpiredStock = catchAsync(async (req, res) => {
  const items = await Stock.find({
    ...req.tenantFilter,
    expiryDate: { $lt: new Date() },
    quantity: { $gt: 0 },
  }).populate('product', 'name productCode sellingPrice');

  res.status(200).json({
    status: 'success',
    results: items.length,
    data: items.map((s) => ({
      productName: s.product?.name,
      productCode: s.product?.productCode,
      currentQuantity: s.quantity,
      expiryDate: s.expiryDate,
      expiredDaysAgo: Math.ceil((new Date() - s.expiryDate) / (1000 * 60 * 60 * 24)),
    })),
  });
});
