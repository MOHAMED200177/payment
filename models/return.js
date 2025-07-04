const mongoose = require('mongoose');

const returnSchema = new mongoose.Schema({
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    product: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    refundAmount: { type: Number, required: true},
    reason: { type: String },
    date: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Return', returnSchema);
