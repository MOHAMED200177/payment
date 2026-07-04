'use strict';
const factory = require('./crudFactory');
const Category = require('../models/category');

exports.getCategories  = factory.getAll(Category);
exports.createCategory = factory.createOne(Category);
exports.getCategory    = factory.getOneById(Category, [
  { path: 'subCategories', select: 'name description' },
  { path: 'parentCategory', select: 'name' },
]);
exports.updateCategory = factory.updateOne(Category);
exports.deleteCategory = factory.deleteOne(Category);
