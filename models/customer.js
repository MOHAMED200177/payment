// models/customer.js
const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    address: { type: String, required: false },
    phone: { type: String, required: true },
    balance: { type: String, required: true, default: 0 },
});

module.exports = mongoose.model('Customer', customerSchema);