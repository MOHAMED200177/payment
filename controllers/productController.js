const Product = require('../models/product');
const Supplier = require('../models/supplier');
const Category = require('../models/category');
const factory = require('./crudFactory');
const AppError = require('../utils/appError');

exports.createProduct = async (req, res, next) => {
  try {
    const {
      category,
      supplier,
      name,
      productCode,
      costPrice,
      sellingPrice,
      unit,
    } = req.body;

    const categoryExists = await Category.findOne({ name: category });
    if (!categoryExists) {
      return next(new AppError('Category not found', 404));
    }

    const supplierExists = await Supplier.findOne({ name: supplier });
    if (!supplierExists) {
      return next(new AppError('Supplier not found', 404));
    }

    const newProduct = await Product.create({
      category: categoryExists._id,
      supplier: supplierExists._id,
      name,
      productCode,
      costPrice,
      sellingPrice,
      unit,
    });

    res.status(201).json({
      status: 'success',
      data: {
        data: newProduct,
      },
    });
  } catch (error) {
    next(error);
  }
};

const PopulateOptions = [
  { path: 'supplier', select: 'name' },
  { path: 'category', select: 'name' },
];
exports.getProduct = factory.getOneById(Product, ['category', 'supplier']);
exports.getProductByCode = factory.getOneByField(Product, 'name', [
  'category',
  'supplier',
]);
exports.getAllProducts = factory.getAll(Product, PopulateOptions);
exports.updateProduct = factory.updateOne(Product);
exports.deleteProduct = factory.deleteOne(Product);
