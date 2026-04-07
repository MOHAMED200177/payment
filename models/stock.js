const mongoose = require('mongoose');

const stockSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      unique: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [0, 'Quantity cannot be negative'],
      default: 0,
    },
    batchNumber: {
      type: String,
      default: null,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    lastStockUpdate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// ✅ Indexes
stockSchema.index({ product: 1 }, { unique: true });
stockSchema.index({ expiryDate: 1 });
stockSchema.index({ quantity: 1 });

module.exports = mongoose.model('Stock', stockSchema);
