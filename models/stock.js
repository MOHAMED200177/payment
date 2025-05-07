// models/stock.js
const mongoose = require('mongoose');

const stockSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    quantity: { type: Number, required: true },
    batchNumber: {
        type: String
    },
    expiryDate: {
        type: Date
    },
    lastStockUpdate: {
        type: Date,
        default: Date.now
    },
    date: { type: Date, default: Date.now },
});

stockSchema.index({ product: 1 });

module.exports = mongoose.model('Stock', stockSchema);
