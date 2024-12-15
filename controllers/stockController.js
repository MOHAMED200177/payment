const Crud = require('./crudFactory');
const Stock = require('../models/stock');

exports.creatStock = Crud.createOne(Stock);
exports.allStock = Crud.getAll(Stock);