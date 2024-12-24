const Crud = require('./crudFactory');
const Stock = require('../models/stock');

exports.creatStock = Crud.createOne(Stock);
exports.allStock = Crud.getAll(Stock);
exports.updateStock = Crud.updateOne(Stock);
exports.oneStock = Crud.getOne(Stock);
exports.deleteStock = Crud.deleteOne(Stock);