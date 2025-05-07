const factory = require('./crudFactory');
const Supplier = require('../models/supplier');

exports.getCategories = factory.getAll(Supplier);
exports.createSupplier = factory.createOne(Supplier);
exports.getSupplier = factory.getOneById(Supplier, 'subCategories');
exports.updateSupplier = factory.updateOne(Supplier);
exports.deleteSupplier = factory.deleteOne(Supplier);
