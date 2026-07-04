'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');
const softDeletePlugin = require('./softDeletePlugin');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: null },
    parentCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

categorySchema.plugin(tenantPlugin);
categorySchema.plugin(softDeletePlugin);

// unique per company — only among non-deleted
categorySchema.index({ company: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } });
categorySchema.index({ company: 1, parentCategory: 1 });

categorySchema.virtual('subCategories', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parentCategory',
});

module.exports = mongoose.model('Category', categorySchema);
