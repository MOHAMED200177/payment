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
    remaining: { type: Number, required: true },
    status: { type: String, enum: ['Paid', 'Unpaid'] },
    refunds: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    invoiceNumber: { type: String, unique: true, required: true },
    date: { type: Date, default: Date.now },
});

invoiceSchema.pre('save', function (next) {
    this.status = this.total <= this.paid ? 'Paid' : 'Unpaid';
    next();
});

invoiceSchema.pre('save', async function (next) {
    if (!this.isNew) return next(); // إذا كانت الفاتورة ليست جديدة، لا يتم التغيير

    const count = await mongoose.model('Invoice').countDocuments();
    const year = new Date().getFullYear();
    this.invoiceNumber = `INV-${year}-${String(count + 1).padStart(4, '0')}`; // تنسيق الرقم
    next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);
