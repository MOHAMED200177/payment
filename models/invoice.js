const mongoose = require('mongoose');
const { Schema } = mongoose;

const invoiceItemSchema = new Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: [1, 'Quantity must be at least 1'],
        validate: {
            validator: Number.isInteger,
            message: 'Quantity must be an integer'
        }
    },
    unitPrice: {
        type: Number,
        required: true,
        min: [0, 'Price cannot be negative']
    },
    taxRate: {
        type: Number,
        default: 0,
        min: [0, 'Tax rate cannot be negative']
    },
    lineTotal: {
        type: Number,
        required: true
    }
}, { _id: false });

const invoiceSchema = new Schema({
    invoiceNumber: {
        type: String,
        unique: true,
        required: true
    },
    customer: {
        type: Schema.Types.ObjectId,
        ref: 'Customer',
        required: true
    },
    issueDate: {
        type: Date,
        default: Date.now,
        required: true
    },
    dueDate: {
        type: Date,
        required: true
    },
    items: [invoiceItemSchema],
    subtotal: {
        type: Number,
        required: true,
        min: 0
    },
    taxAmount: {
        type: Number,
        default: 0,
        min: 0
    },
    discountAmount: {
        type: Number,
        default: 0,
        min: 0
    },
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    amountPaid: {
        type: Number,
        default: 0,
        min: 0
    },
    balanceDue: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['draft', 'issued', 'paid', 'partially_paid', 'overdue', 'cancelled', 'refunded'],
        default: 'draft'
    },
    paymentTerms: {
        type: String,
        enum: ['immediate', 'net_7', 'net_15', 'net_30', 'net_60'],
        default: 'net_30'
    },
    notes: String,
    isDeleted: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for formatted invoice number
invoiceSchema.virtual('formattedInvoiceNumber').get(function () {
    return `INV-${this.invoiceNumber.toString().padStart(6, '0')}`;
});

// Pre-save middleware for calculations
invoiceSchema.pre('save', function (next) {
    // Calculate subtotal from items if not provided
    // if (this.isModified('items') || !this.subtotal) {
    //     this.subtotal = this.items.reduce((sum, item) => {
    //         const itemTotal = item.unitPrice * item.quantity;
    //         return sum + itemTotal;
    //     }, 0);
    // }

    // // Calculate total amount
    // this.totalAmount = this.subtotal + this.taxAmount - this.discountAmount;

    // // Calculate balance due
    // this.balanceDue = this.totalAmount - this.amountPaid;

    // Update status
    if (this.balanceDue <= 0) {
        this.status = 'paid';
    } else if (this.amountPaid > 0) {
        this.status = 'partially_paid';
    } else if (new Date() > this.dueDate && this.status !== 'paid') {
        this.status = 'overdue';
    }

    next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);