const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    type: String,
    referenceId: mongoose.Schema.Types.ObjectId,
    amount: Number,
    date: { type: Date, default: Date.now },
    details: String,
    status: { type: String, enum: ['debit', 'cradit'], require: true },
});

const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;