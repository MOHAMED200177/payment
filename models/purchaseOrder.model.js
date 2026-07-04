'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');

const purchaseItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: {
      type: Number, required: true, min: 1,
      validate: { validator: Number.isInteger, message: 'Quantity must be an integer' },
    },
    unitCost: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    receivedQuantity: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    items: [purchaseItemSchema],
    subtotal: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    balanceDue: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['draft','ordered','partially_received','received','cancelled'],
      default: 'draft',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid','partially_paid','paid'],
      default: 'unpaid',
    },
    orderDate: { type: Date, default: Date.now },
    expectedDeliveryDate: { type: Date, default: null },
    receivedDate: { type: Date, default: null },
    notes: { type: String, default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

purchaseOrderSchema.plugin(tenantPlugin);

purchaseOrderSchema.index({ company: 1, orderNumber: 1 }, { unique: true });
purchaseOrderSchema.index({ company: 1, supplier: 1 });
purchaseOrderSchema.index({ company: 1, status: 1 });
purchaseOrderSchema.index({ company: 1, isDeleted: 1 });

purchaseOrderSchema.virtual('formattedOrderNumber').get(function () {
  return `PO-${this.orderNumber.toString().padStart(6, '0')}`;
});

purchaseOrderSchema.pre('save', function (next) {
  if (this.balanceDue <= 0 && this.amountPaid > 0) this.paymentStatus = 'paid';
  else if (this.amountPaid > 0) this.paymentStatus = 'partially_paid';
  else this.paymentStatus = 'unpaid';

  const totalOrdered = this.items.reduce((s, i) => s + i.quantity, 0);
  const totalReceived = this.items.reduce((s, i) => s + (i.receivedQuantity || 0), 0);
  if (totalReceived >= totalOrdered && this.status !== 'cancelled') this.status = 'received';
  else if (totalReceived > 0 && this.status !== 'cancelled') this.status = 'partially_received';
  next();
});

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
