const mongoose = require('mongoose');

const returnSchema = new mongoose.Schema({
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Stock', required: true },
    quantity: { type: Number, required: true, min: 1 },
    reason: { type: String },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Return', returnSchema);
