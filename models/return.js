'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');
const softDeletePlugin = require('./softDeletePlugin');

const returnSchema = new mongoose.Schema(
  {
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    refundAmount: { type: Number, required: true, min: 0 },
    reason: { type: String, default: null },
    status: { type: String, enum: ['active', 'cancelled', 'processed'], default: 'active' },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

returnSchema.plugin(tenantPlugin);
// Replace partial soft-delete fields with consistent plugin (adds isDeleted, deletedAt, deletedBy)
returnSchema.plugin(softDeletePlugin);

returnSchema.index({ company: 1, invoice: 1 });
returnSchema.index({ company: 1, customer: 1 });
returnSchema.index({ company: 1, isDeleted: 1 });

module.exports = mongoose.model('Return', returnSchema);
