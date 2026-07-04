'use strict';
const Product  = require('../models/product');
const Supplier = require('../models/supplier');
const Category = require('../models/category');
const factory  = require('./crudFactory');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

const populateOptions = [
  { path: 'supplier', select: 'name phone email' },
  { path: 'category', select: 'name description' },
];

exports.getAllProducts    = factory.getAll(Product, populateOptions);
exports.getProduct       = factory.getOneById(Product, populateOptions);
exports.getProductByName = factory.getOneByField(Product, 'name', populateOptions);
exports.updateProduct    = factory.updateOne(Product);

// ============================================================
// Create Product — tenant-scoped validation
// ============================================================
exports.createProduct = catchAsync(async (req, res, next) => {
  const {
    category, supplier, name, productCode,
    costPrice, sellingPrice, unit,
    description, barcode, taxes, reorderLevel,
  } = req.body;

  if (!category || !supplier || !name || !productCode || !costPrice || !sellingPrice || !unit) {
    return next(new AppError('category, supplier, name, productCode, costPrice, sellingPrice, and unit are required', 400));
  }
  if (costPrice < 0 || sellingPrice < 0) return next(new AppError('Prices cannot be negative', 400));
  if (sellingPrice < costPrice) return next(new AppError('Selling price cannot be less than cost price', 400));

  // Validate category & supplier belong to this company
  const [categoryDoc, supplierDoc] = await Promise.all([
    Category.findOne({ _id: category, ...req.tenantFilter }),
    Supplier.findOne({ _id: supplier, ...req.tenantFilter }),
  ]);
  if (!categoryDoc) return next(new AppError('Category not found', 404));
  if (!supplierDoc) return next(new AppError('Supplier not found', 404));

  // Duplicate check within company
  const existing = await Product.findOne({
    $or: [{ name }, { productCode }],
    ...req.tenantFilter,
  });
  if (existing) {
    return next(new AppError(
      existing.name === name
        ? `Product with name "${name}" already exists`
        : `Product code "${productCode}" already in use`,
      409
    ));
  }

  const newProduct = await Product.create({
    category: categoryDoc._id,
    supplier: supplierDoc._id,
    name, productCode, costPrice, sellingPrice, unit,
    description: description || null,
    barcode: barcode || null,
    taxes: taxes || 0,
    reorderLevel: reorderLevel || 10,
    company: req.companyId,   // injectTenant already put this in req.body, but explicit is clearer
  });

  const populated = await Product.findById(newProduct._id)
    .populate('category', 'name description')
    .populate('supplier', 'name phone email');

  res.status(201).json({ status: 'success', data: populated });
});

// ============================================================
// Delete Product (Soft Delete)
// ============================================================
exports.deleteProduct = catchAsync(async (req, res, next) => {
  const Stock = require('../models/stock');
  
  const product = await Product.findOne({ _id: req.params.id, ...req.tenantFilter, isDeleted: { $ne: true } });
  if (!product) return next(new AppError('Product not found', 404));

  const stock = await Stock.findOne({ product: product._id, company: req.companyId });
  if (stock && stock.quantity > 0) {
    return next(new AppError('Cannot delete product because it currently has stock remaining.', 400));
  }

  product.isDeleted = true;
  product.deletedAt = new Date();
  if (req.user) product.deletedBy = req.user._id;
  await product.save();

  const { logAudit } = require('../utils/auditLog');
  logAudit({
    req,
    action: 'SOFT_DELETE',
    module: 'PRODUCT',
    entityId: product._id,
    entityLabel: product.name,
    oldValues: { isDeleted: false },
  });

  res.status(200).json({ status: 'success', message: 'Product deleted successfully' });
});
