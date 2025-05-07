const factory = require('./crudFactory');
const Category = require('../models/category');

exports.getCategories = factory.getAll(Category);
exports.createCategory = factory.createOne(Category);
exports.getCategory = factory.getOneById(Category, 'subCategories');
exports.updateCategory = factory.updateOne(Category);
exports.deleteCategory = factory.deleteOne(Category);
