'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');
const softDeletePlugin = require('./softDeletePlugin');

const paymentSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, enum: ['Cash', 'Credit Card', 'Bank Transfer', 'Other'], default: 'Cash' },
    status: { type: String, enum: ['Success', 'Pending', 'Failed'], default: 'Pending' },
    notes: { type: String, default: null },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

paymentSchema.plugin(tenantPlugin);
paymentSchema.plugin(softDeletePlugin);

paymentSchema.index({ company: 1, customer: 1 });
paymentSchema.index({ company: 1, invoice: 1 });
paymentSchema.index({ company: 1, date: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
