'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');

/**
 * Transaction — ledger entry for every financial event.
 *
 * For invoice/purchase type: items[] is populated with product/quantity/price.
 * For payment/discount/refund/return type: items[] is empty array — product is NOT required.
 */
const transactionItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: false, // Not required — payment/discount/refund transactions have no items
      default: null,
    },
    quantity: { type: Number, required: false, min: 0, default: 0 },
    price: { type: Number, required: false, min: 0, default: 0 },
  },
  { _id: false }
);

const transactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['invoice', 'payment', 'discount', 'return', 'refund', 'adjustment', 'purchase'],
      required: true,
    },
    referenceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    referenceModel: {
      type: String,
      enum: ['Invoice', 'Payment', 'Return', 'PurchaseOrder', 'SupplierPayment', 'Stock'],
      default: null,
    },
    amount: { type: Number, required: true, min: 0 },
    details: { type: String, required: true },
    items: { type: [transactionItemSchema], default: [] },
    status: { type: String, enum: ['debit', 'credit'], required: true },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

transactionSchema.plugin(tenantPlugin);

transactionSchema.index({ company: 1, referenceId: 1 });
transactionSchema.index({ company: 1, type: 1 });
transactionSchema.index({ company: 1, date: -1 });
transactionSchema.index({ company: 1, referenceId: 1, type: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
