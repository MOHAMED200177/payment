const Crud = require('./crudFactory');
const Stock = require('../models/stock');
const Product = require('../models/product');

const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

exports.createStock = catchAsync(async (req, res, next) => {
  const { productName, quantity, batchNumber, expiryDate } = req.body;

  const product = await Product.findOne({ name: productName });

  if (!product) {
    return next(new AppError('No product found with that name', 404));
  }

  const stock = await Stock.create({
    product: product._id,
    quantity,
    batchNumber,
    expiryDate,
  });

  res.status(201).json({
    status: 'success',
    data: {
      stock,
    },
  });
});
const PopulateOptions = [{ path: 'product', select: 'name sellingPrice' }];
exports.allStock = Crud.getAll(Stock, PopulateOptions);
exports.updateStock = Crud.updateOne(Stock);
exports.oneStock = Crud.getOneById(Stock);
exports.deleteStock = Crud.deleteOne(Stock);
