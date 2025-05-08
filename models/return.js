const mongoose = require('mongoose');

const returnSchema = new mongoose.Schema({
    invoice: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, default: [] }],
    customer: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, default: [] }],
    product: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    reason: { type: String },
    date: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Return', returnSchema);
