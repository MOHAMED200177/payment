'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');
const softDeletePlugin = require('./softDeletePlugin');

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: false, trim: true },
    contactPerson: { type: String, required: true },
    email: {
      type: String, trim: true, lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
      default: null,
    },
    phone: { type: String, required: true },
    address: {
      street: { type: String, default: null },
      city: { type: String, default: null },
      state: { type: String, default: null },
      country: { type: String, default: null },
      postalCode: { type: String, default: null },
    },
    taxNumber: { type: String, default: null },
    paymentTerms: {
      type: String,
      enum: ['immediate', 'net_7', 'net_15', 'net_30', 'net_60', null],
      default: null,
    },
    accountNumber: { type: String, default: null },
    active: { type: Boolean, default: true },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

supplierSchema.plugin(tenantPlugin);
supplierSchema.plugin(softDeletePlugin);

// unique per company — only among non-deleted
supplierSchema.index({ company: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } });
supplierSchema.index({ company: 1, active: 1 });

module.exports = mongoose.model('Supplier', supplierSchema);
