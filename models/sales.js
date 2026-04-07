const mongoose = require('mongoose');

const invoiceSaleSchema = new mongoose.Schema(
  {
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const salesOrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: [true, 'Order number is required'],
      unique: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    count: {
      type: Number,
      required: true,
      min: 0,
    },
    invoiceSales: {
      type: [invoiceSaleSchema],
      default: [],
    },
    lastUpdateDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// ✅ Indexes
salesOrderSchema.index({ product: 1 });
salesOrderSchema.index({ customer: 1 });
salesOrderSchema.index({ orderNumber: 1 });

const SalesOrder = mongoose.model('SalesOrder', salesOrderSchema);
module.exports = SalesOrder;
