const { required } = require('joi');
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    type: String,
    referenceId: mongoose.Schema.Types.ObjectId,
    amount: Number,
    date: { type: Date, default: Date.now },
    details: String,
    items: [{
        product: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
    }
    ],
    status: { type: String, enum: ['debit', 'credit'], required: true },
    date: { type: Date, default: Date.now },
});

const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;