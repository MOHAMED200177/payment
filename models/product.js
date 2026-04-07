const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    productCode: {
      type: String,
      required: [true, 'Product code is required'],
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      unique: true,
      required: [true, 'Product name is required'],
      trim: true,
    },
    description: {
      type: String,
      default: null,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required'],
    },
    unit: {
      type: String,
      required: [true, 'Unit is required'],
    },
    costPrice: {
      type: Number,
      required: [true, 'Cost price is required'],
      min: [0, 'Cost price cannot be negative'],
    },
    sellingPrice: {
      type: Number,
      required: [true, 'Selling price is required'],
      min: [0, 'Selling price cannot be negative'],
    },
    reorderLevel: {
      type: Number,
      default: 10,
      min: 0,
    },
    images: [
      {
        url: String,
        isMain: {
          type: Boolean,
          default: false,
        },
      },
    ],
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: [true, 'Supplier is required'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    barcode: {
      type: String,
      default: null,
    },
    taxes: {
      type: Number,
      default: 0,
      min: [0, 'Tax cannot be negative'],
      max: [100, 'Tax cannot exceed 100'],
    },
  },
  {
    timestamps: true,
  }
);

// ✅ Indexes
productSchema.index({ productCode: 1 });
productSchema.index({ supplier: 1 });
productSchema.index({ category: 1 });
productSchema.index({ isActive: 1 });
productSchema.index({ name: 'text', description: 'text' });

const Product = mongoose.model('Product', productSchema);
module.exports = Product;
