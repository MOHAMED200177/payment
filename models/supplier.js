const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Supplier name is required'],
      trim: true,
    },
    contactPerson: {
      type: String,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
    },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      postalCode: String,
    },
    taxNumber: {
      type: String,
    },
    paymentTerms: {
      type: String,
    },
    accountNumber: {
      type: String,
    },
    active: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Create index to search suppliers
supplierSchema.index({ name: 'text' });

const Supplier = mongoose.model('Supplier', supplierSchema);

module.exports = Supplier;
