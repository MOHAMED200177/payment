'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');
const softDeletePlugin = require('./softDeletePlugin');

const productSchema = new mongoose.Schema(
  {
    productCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    unit: { type: String, required: true },
    costPrice: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    reorderLevel: { type: Number, default: 10, min: 0 },
    images: [{ url: String, isMain: { type: Boolean, default: false } }],
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    isActive: { type: Boolean, default: true }, // operational flag — can be set to false to hide from sales
    barcode: { type: String, default: null },
    taxes: { type: Number, default: 0, min: 0, max: 100 },
  },
  { timestamps: true }
);

productSchema.plugin(tenantPlugin);
// Soft delete separates "archived" products from operationally "inactive" ones.
// isActive = false means hidden from new sales but still producible.
// isDeleted = true means completely removed from listings (but historical invoices still reference it).
productSchema.plugin(softDeletePlugin);

productSchema.index({ company: 1, productCode: 1 }, { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } });
productSchema.index({ company: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } });
productSchema.index({ company: 1, supplier: 1 });
productSchema.index({ company: 1, category: 1 });
productSchema.index({ company: 1, isActive: 1 });

module.exports = mongoose.model('Product', productSchema);
