const Crud = require('./crudFactory');
const Stock = require('../models/stock');
const Product = require('../models/product');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

// ============================================================
// Populate Options
// ============================================================
const populateOptions = [
  { path: 'product', select: 'name productCode sellingPrice reorderLevel' },
];

// ============================================================
// Create Stock
// ============================================================
exports.createStock = catchAsync(async (req, res, next) => {
  const { productName, quantity, batchNumber, expiryDate } = req.body;

  // ✅ Validate required fields
  if (!productName || quantity === undefined) {
    return next(new AppError('productName and quantity are required', 400));
  }

  // ✅ Validate quantity
  if (quantity < 0 || !Number.isInteger(quantity)) {
    return next(new AppError('Quantity must be a non-negative integer', 400));
  }

  // ✅ Validate expiryDate لو موجود
  if (expiryDate) {
    const expiry = new Date(expiryDate);
    if (isNaN(expiry.getTime())) {
      return next(new AppError('Invalid expiry date format', 400));
    }
    if (expiry < new Date()) {
      return next(new AppError('Expiry date cannot be in the past', 400));
    }
  }

  // ✅ Find Product
  const product = await Product.findOne({ name: productName });
  if (!product) {
    return next(new AppError('No product found with that name', 404));
  }

  // ✅ Check للـ duplicate stock
  const existingStock = await Stock.findOne({ product: product._id });
  if (existingStock) {
    return next(
      new AppError(
        `Stock already exists for "${productName}". Use update instead.`,
        409
      )
    );
  }

  // ✅ Create Stock
  const stock = await Stock.create({
    product: product._id,
    quantity,
    batchNumber: batchNumber || null,
    expiryDate: expiryDate || null,
    lastStockUpdate: new Date(),
  });

  // ✅ Populate الـ response
  const populatedStock = await Stock.findById(stock._id).populate(
    'product',
    'name productCode sellingPrice reorderLevel'
  );

  res.status(201).json({
    status: 'success',
    data: populatedStock,
  });
});

// ============================================================
// Get Low Stock Alert
// ✅ مهم جداً للصيدليات
// ============================================================
exports.getLowStock = catchAsync(async (req, res, next) => {
  const stocks = await Stock.find().populate(
    'product',
    'name productCode reorderLevel sellingPrice'
  );

  // ✅ فلتر المنتجات اللي وصلت للـ reorder level
  const lowStockItems = stocks.filter(
    (stock) =>
      stock.product && stock.quantity <= (stock.product.reorderLevel || 10)
  );

  res.status(200).json({
    status: 'success',
    results: lowStockItems.length,
    data: lowStockItems.map((stock) => ({
      productName: stock.product.name,
      productCode: stock.product.productCode,
      currentQuantity: stock.quantity,
      reorderLevel: stock.product.reorderLevel,
      shortage: stock.product.reorderLevel - stock.quantity,
      lastUpdate: stock.lastStockUpdate,
    })),
  });
});

// ============================================================
// Get Expiring Soon Alert
// ✅ مهم جداً للصيدليات
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

  const expiringSoon = await Stock.find({
    expiryDate: {
      $gte: today, // ✅ مش منتهي لسه
      $lte: warningDate, // ✅ بينتهي خلال الـ X أيام
    },
    quantity: { $gt: 0 },
  }).populate('product', 'name productCode sellingPrice');

  res.status(200).json({
    status: 'success',
    results: expiringSoon.length,
    data: expiringSoon.map((stock) => ({
      productName: stock.product?.name,
      productCode: stock.product?.productCode,
      currentQuantity: stock.quantity,
      expiryDate: stock.expiryDate,
      daysUntilExpiry: Math.ceil(
        (stock.expiryDate - today) / (1000 * 60 * 60 * 24)
      ),
    })),
  });
});


exports.getExpiredStock = catchAsync(async (req, res, next) => {
  const expiredStock = await Stock.find({
    expiryDate: { $lt: new Date() },
    quantity: { $gt: 0 },
  }).populate('product', 'name productCode sellingPrice');

  res.status(200).json({
    status: 'success',
    results: expiredStock.length,
    data: expiredStock.map((stock) => ({
      productName: stock.product?.name,
      productCode: stock.product?.productCode,
      currentQuantity: stock.quantity,
      expiryDate: stock.expiryDate,
      expiredDaysAgo: Math.ceil(
        (new Date() - stock.expiryDate) / (1000 * 60 * 60 * 24)
      ),
    })),
  });
});

// ============================================================
// CRUD Operations
// ============================================================
exports.allStock = Crud.getAll(Stock, populateOptions);
exports.updateStock = Crud.updateOne(Stock);
exports.oneStock = Crud.getOneById(Stock, populateOptions);
exports.deleteStock = Crud.deleteOne(Stock);
