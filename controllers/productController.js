const Product = require('../models/product');
const Supplier = require('../models/supplier');
const Category = require('../models/category');
const factory = require('./crudFactory');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

// ============================================================
// Populate Options
// ============================================================
const populateOptions = [
  { path: 'supplier', select: 'name phone email' },
  { path: 'category', select: 'name description' },
];

// ============================================================
// Create Product
// ============================================================
exports.createProduct = catchAsync(async (req, res, next) => {
  const {
    category,
    supplier,
    name,
    productCode,
    costPrice,
    sellingPrice,
    unit,
    description,
    barcode,
    taxes,
    reorderLevel,
  } = req.body;

  // ✅ Validate required fields
  if (
    !category ||
    !supplier ||
    !name ||
    !productCode ||
    !costPrice ||
    !sellingPrice ||
    !unit
  ) {
    return next(
      new AppError(
        'category, supplier, name, productCode, costPrice, sellingPrice, and unit are required',
        400
      )
    );
  }

  // ✅ Validate prices
  if (costPrice < 0 || sellingPrice < 0) {
    return next(new AppError('Prices cannot be negative', 400));
  }

  if (sellingPrice < costPrice) {
    return next(
      new AppError('Selling price cannot be less than cost price', 400)
    );
  }

  // ✅ Check category exists
  const categoryExists = await Category.findOne({ name: category });
  if (!categoryExists) {
    return next(new AppError('Category not found', 404));
  }

  // ✅ Check supplier exists
  const supplierExists = await Supplier.findOne({ name: supplier });
  if (!supplierExists) {
    return next(new AppError('Supplier not found', 404));
  }

  // ✅ Check duplicate product
  const existingProduct = await Product.findOne({
    $or: [{ name }, { productCode }],
  });

  if (existingProduct) {
    return next(
      new AppError(
        existingProduct.name === name
          ? `Product with name "${name}" already exists`
          : `Product code "${productCode}" already in use`,
        409
      )
    );
  }

  // ✅ Create product
  const newProduct = await Product.create({
    category: categoryExists._id,
    supplier: supplierExists._id,
    name,
    productCode,
    costPrice,
    sellingPrice,
    unit,
    description: description || null,
    barcode: barcode || null,
    taxes: taxes || 0,
    reorderLevel: reorderLevel || 10,
  });

  // ✅ Populate الـ response
  const populatedProduct = await Product.findById(newProduct._id)
    .populate('category', 'name description')
    .populate('supplier', 'name phone email');

  res.status(201).json({
    status: 'success',
    data: populatedProduct,
  });
});

// ============================================================
// CRUD Operations
// ============================================================

// ✅ populate صح
exports.getProduct = factory.getOneById(Product, populateOptions);

exports.getProductByName = factory.getOneByField(
  Product,
  'name',
  populateOptions
);

exports.getAllProducts = factory.getAll(Product, populateOptions);

exports.updateProduct = factory.updateOne(Product);

exports.deleteProduct = factory.deleteOne(Product);
