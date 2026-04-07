const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Supplier name is required'],
      unique: true,
      trim: true,
    },
    contactPerson: {
      type: String,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
      default: null,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
    },
    address: {
      street: { type: String, default: null },
      city: { type: String, default: null },
      state: { type: String, default: null },
      country: { type: String, default: null },
      postalCode: { type: String, default: null },
    },
    taxNumber: {
      type: String,
      default: null,
    },
    paymentTerms: {
      type: String,
      enum: ['immediate', 'net_7', 'net_15', 'net_30', 'net_60', null],
      default: null,
    },
    accountNumber: {
      type: String,
      default: null,
    },
    active: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ✅ Indexes
supplierSchema.index({ name: 'text' });
supplierSchema.index({ active: 1 });
supplierSchema.index({ name: 1 }, { unique: true });

const Supplier = mongoose.model('Supplier', supplierSchema);
module.exports = Supplier;
