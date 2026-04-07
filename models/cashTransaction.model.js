const mongoose = require('mongoose');

const cashTransactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['income', 'expense'],
      required: true,
    },
    category: {
      type: String,
      enum: [
        // Income
        'sales',
        'prescription_sales',
        'insurance_claims',
        'other_income',
        // Expense
        'purchase',
        'salary',
        'rent',
        'utilities',
        'maintenance',
        'other_expense',
      ],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0, 'Amount cannot be negative'],
    },
    description: {
      type: String,
      required: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    referenceType: {
      type: String,
      enum: ['Invoice', 'Payment', 'PurchaseOrder', 'Expense', 'Salary', null],
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ['Cash', 'Credit Card', 'Bank Transfer', 'Other'],
      default: 'Cash',
    },
    date: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      default: null,
    },
    createdBy: {
      type: String,
      default: 'System',
    },
  },
  {
    timestamps: true,
  }
);

// ✅ Indexes
cashTransactionSchema.index({ type: 1 });
cashTransactionSchema.index({ category: 1 });
cashTransactionSchema.index({ date: -1 });
cashTransactionSchema.index({ referenceId: 1 });

module.exports = mongoose.model('CashTransaction', cashTransactionSchema);
