// ✅ return.model.js المحدث
const mongoose = require('mongoose');

const returnSchema = new mongoose.Schema(
  {
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
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
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    refundAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      default: null,
    },
    // ✅ أضفنا status
    status: {
      type: String,
      enum: ['active', 'cancelled', 'processed'],
      default: 'active',
    },
    // ✅ أضفنا soft delete
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

returnSchema.index({ invoice: 1 });
returnSchema.index({ customer: 1 });
returnSchema.index({ product: 1 });
returnSchema.index({ isDeleted: 1 });

module.exports = mongoose.model('Return', returnSchema);
