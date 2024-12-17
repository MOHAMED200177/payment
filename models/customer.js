// models/customer.js
const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    address: { type: String, required: false },
    phone: { type: String, required: true },
    balance: { type: String, required: true, default: 0 },
    outstandingBalance: { type: Number, default: 0 },
    invoice: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' }],
    returns: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Return' }],
    payment: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }],
    transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }],
});

module.exports = mongoose.model('Customer', customerSchema);