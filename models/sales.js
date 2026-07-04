'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');

const invoiceSaleSchema = new mongoose.Schema(
  {
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    quantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const salesOrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    subtotal: { type: Number, required: true, min: 0 },
    count: { type: Number, required: true, min: 0 },
    invoiceSales: { type: [invoiceSaleSchema], default: [] },
    lastUpdateDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

salesOrderSchema.plugin(tenantPlugin);

salesOrderSchema.index({ company: 1, orderNumber: 1 }, { unique: true });
salesOrderSchema.index({ company: 1, product: 1 });
salesOrderSchema.index({ company: 1, customer: 1 });

module.exports = mongoose.model('SalesOrder', salesOrderSchema);
