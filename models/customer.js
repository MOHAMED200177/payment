// models/customer.js
const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    address: { type: String, required: false },
    phone: { type: String, required: true, unique: true },
    balance: { type: Number, required: true, default: 0 },
    outstandingBalance: { type: Number, default: 0 },
    cash: { type: Number, default: 0 },
    invoice: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: [] }],
    returns: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Return', default: [] }],
    payment: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: [] }],
    transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: [] }],
    date: { type: Date, default: Date.now },
}, { timestamps: true });

customerSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('Customer', customerSchema);
