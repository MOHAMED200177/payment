const Crud = require('./crudFactory');
const Stock = require('../models/stock');

exports.creatStock = Crud.createOne(Stock);