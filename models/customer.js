'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');
const softDeletePlugin = require('./softDeletePlugin');

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
      set: v => v === '' ? null : v,
      default: null,
    },
    address: { type: String, default: null },
    phone: { type: String, default: null },
    balance: { type: Number, default: 0 },
    outstandingBalance: { type: Number, default: 0 },
    cash: { type: Number, default: 0 },
    invoice: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' }],
    returns: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Return' }],
    payment: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }],
    transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }],
  },
  { timestamps: true }
);

// Tenant plugin adds `company` field
customerSchema.plugin(tenantPlugin);
// Soft delete — historical invoices/payments remain intact
customerSchema.plugin(softDeletePlugin);

// name unique per company (not globally), but only for non-deleted records
customerSchema.index({ company: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } });
customerSchema.index({ company: 1, phone: 1 });
customerSchema.index({ company: 1, outstandingBalance: -1 });

module.exports = mongoose.model('Customer', customerSchema);
