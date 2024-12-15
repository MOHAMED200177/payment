// models/invoice.js
const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    items: [
        {
            product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Stock', required: true },
            product: { type: String, required: true },
            quantity: { type: Number, required: true },
            price: { type: Number, required: true },
        },
    ],
    returns: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Return' }],
    total: { type: Number, required: true },
    paid: { type: Number, default: 0 },
    status: { type: String, enum: ['Paid', 'Unpaid'] },
    refunds: { type: Number, default: 0 },
    date: { type: Date, default: Date.now },
});

invoiceSchema.pre('save', function (next) {
    this.status = this.total <= this.paid ? 'Paid' : 'Unpaid';
    next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);
