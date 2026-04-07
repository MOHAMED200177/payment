const mongoose = require('mongoose');
const { Schema } = mongoose;

const invoiceItemSchema = new Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
      validate: {
        validator: Number.isInteger,
        message: 'Quantity must be an integer',
      },
    },
    unitPrice: {
      type: Number,
      required: true,
      min: [0, 'Price cannot be negative'],
    },
    taxRate: {
      type: Number,
      default: 0,
      min: [0, 'Tax rate cannot be negative'],
    },
    lineTotal: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

const invoiceSchema = new Schema(
  {
    invoiceNumber: {
      type: String,
      unique: true,
      required: true,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    returns: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Return',
        default: [],
      },
    ],
    issueDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    items: [invoiceItemSchema],
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceDue: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: [
        'draft',
        'issued',
        'paid',
        'partially_paid',
        'overdue',
        'cancelled',
        'refunded',
      ],
      default: 'draft',
    },
    refunds: {
      type: Number,
      default: 0,
    },
    paymentTerms: {
      type: String,
      enum: ['immediate', 'net_7', 'net_15', 'net_30', 'net_60'],
      default: 'net_30',
    },
    notes: {
      type: String,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);


invoiceSchema.index({ customer: 1 });
invoiceSchema.index({ status: 1 });
invoiceSchema.index({ createdAt: -1 });


invoiceSchema.virtual('formattedInvoiceNumber').get(function () {
  return `INV-${this.invoiceNumber.toString().padStart(6, '0')}`;
});

invoiceSchema.pre('validate', function (next) {
  if (this.dueDate && this.issueDate && this.dueDate <= this.issueDate) {
    return next(new Error('Due date must be after issue date'));
  }
  next();
});

const PROTECTED_STATUSES = ['cancelled', 'refunded'];

invoiceSchema.pre('save', function (next) {

  if (
    !this.isNew &&
    this.isModified('status') &&
    PROTECTED_STATUSES.includes(this.status)
  ) {
    return next();
  }

  if (this.balanceDue <= 0) {
    this.status = 'paid';
  } else if (this.amountPaid > 0) {
    this.status = 'partially_paid';
  } else if (new Date() > this.dueDate) {
    this.status = 'overdue';
  }

  next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);