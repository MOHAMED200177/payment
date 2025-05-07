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
    orderDate: {
        type: Date,
        default: Date.now
    },
    deliveryDate: {
        type: Date
    },
    status: {
        type: String,
        enum: ['draft', 'confirmed', 'processing', 'shipped', 'delivered', 'canceled'],
        default: 'draft'
    },
    items: [{
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        quantity: {
            type: Number,
            required: true
        },
        unitPrice: {
            type: Number,
            required: true
        },
        discount: {
            type: Number,
            default: 0
        },
        tax: {
            type: Number,
            default: 0
        },
        total: {
            type: Number,
            required: true
        }
    }],
    subtotal: {
        type: Number,
        required: true
    },
    taxAmount: {
        type: Number,
        default: 0
    },
    discountAmount: {
        type: Number,
        default: 0
    },
    totalAmount: {
        type: Number,
        required: true
    },
    notes: {
        type: String
    },
    invoiced: {
        type: Boolean,
        default: false
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'partial', 'paid'],
        default: 'pending'
    },
    shippingAddress: {
        street: String,
        city: String,
        state: String,
        country: String,
        postalCode: String
    }
}, {
    timestamps: true
});

// قبل الحفظ، حساب الاجماليات
salesOrderSchema.pre('save', function (next) {
    // حساب الإجمالي لكل عنصر
    this.items.forEach(item => {
        item.total = (item.quantity * item.unitPrice) * (1 - item.discount / 100) * (1 + item.tax / 100);
    });

    // حساب الإجمالي الفرعي (بدون ضرائب وخصومات إضافية)
    this.subtotal = this.items.reduce((sum, item) => {
        return sum + (item.quantity * item.unitPrice);
    }, 0);

    // حساب إجمالي الضرائب
    this.taxAmount = this.items.reduce((sum, item) => {
        return sum + (item.quantity * item.unitPrice * item.tax / 100);
    }, 0);

    // حساب إجمالي الخصومات
    this.discountAmount = this.items.reduce((sum, item) => {
        return sum + (item.quantity * item.unitPrice * item.discount / 100);
    }, 0);

    // حساب الإجمالي النهائي
    this.totalAmount = this.subtotal + this.taxAmount - this.discountAmount;

    next();
});

const SalesOrder = mongoose.model('SalesOrder', salesOrderSchema);

module.exports = SalesOrder;