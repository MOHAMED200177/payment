const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    type: String,
    referenceId: mongoose.Schema.Types.ObjectId,
    amount: Number,
    date: { type: Date, default: Date.now },
    details: String,
    status: { type: String, enum: ['debit', 'credit'], require: true },
    date: { type: Date, default: Date.now },
});

const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;