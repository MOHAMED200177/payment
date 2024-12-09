const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    customer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true
    },
    invoice: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Invoice',
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: [0, 'Amount must be a positive number']
    },
    method: {
        type: String,
        enum: ['Cash', 'Credit Card', 'Bank Transfer', 'Other'],
        default: 'Cash'
    },
    status: {
        type: String,
        enum: ['Success', 'Pending', 'Failed'],
        default: 'Pending'
    },
    transactionId: {
        type: String,
        unique: true,
        sparse: true // Allows null values for cases without a transaction ID
    },
    date: {
        type: Date,
        default: Date.now
    },
});

module.exports = mongoose.model('Payment', paymentSchema);
