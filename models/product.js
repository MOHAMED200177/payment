const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    productCode: {
        type: String,
        required: [true, 'Product code is required'],
        unique: true,
        trim: true
    },
    name: {
        type: String,
        unique: true,
        required: [true, 'Product name is required'],
        trim: true
    },
    description: {
        type: String
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
    },
    unit: {
        type: String,
        required: [true, 'Unit is required']
    },
    costPrice: {
        type: Number,
        required: [true, 'Cost price is required']
    },
    sellingPrice: {
        type: Number,
        required: [true, 'Selling price is required']
    },
    reorderLevel: {
        type: Number,
        default: 10
    },
    currentStock: {
        type: Number,
        default: 0
    },
    images: [{
        url: String,
        isMain: {
            type: Boolean,
            default: false
        }
    }],
    supplier: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Supplier'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    barcode: {
        type: String
    },
    taxes: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});


productSchema.index({ name: 1, unique: true });

const Product = mongoose.model('Product', productSchema);

module.exports = Product;