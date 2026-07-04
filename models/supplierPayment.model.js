'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');

const supplierPaymentSchema = new mongoose.Schema(
  {
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['Cash','Credit Card','Bank Transfer','Other'], default: 'Cash' },
    status: { type: String, enum: ['Success','Pending','Failed'], default: 'Pending' },
    date: { type: Date, default: Date.now },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

supplierPaymentSchema.plugin(tenantPlugin);

supplierPaymentSchema.index({ company: 1, purchaseOrder: 1 });
supplierPaymentSchema.index({ company: 1, supplier: 1 });
supplierPaymentSchema.index({ company: 1, date: -1 });

module.exports = mongoose.model('SupplierPayment', supplierPaymentSchema);
