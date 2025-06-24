const mongoose = require('mongoose');

const salesOrderSchema = new mongoose.Schema({
    orderNumber: {
        type: String,
        required: [true, 'Order number is required'],
        unique: true
    },
    customer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true
    },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    subtotal: {
        type: Number,
        required: true
    },
    count: {
        type: Number,
        required: true
    }
}, {
    timestamps: true
});
;

const SalesOrder = mongoose.model('SalesOrder', salesOrderSchema);

module.exports = SalesOrder;