'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');

const stockSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    batchNumber: { type: String, default: null },
    expiryDate: { type: Date, default: null },
    lastStockUpdate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

stockSchema.plugin(tenantPlugin);

// One stock record per product per company
stockSchema.index({ company: 1, product: 1 }, { unique: true });
stockSchema.index({ company: 1, expiryDate: 1 });
stockSchema.index({ company: 1, quantity: 1 });

module.exports = mongoose.model('Stock', stockSchema);
