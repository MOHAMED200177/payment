'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');

/**
 * CashTransaction — a ledger of all money moving in or out of the company.
 * Every entry belongs to a specific company (multi-tenant).
 * Created automatically when:
 *   - An Expense is recorded
 *   - An Invoice payment is collected
 *   - A manual cash entry is added
 */
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
      min: [0.01, 'Amount must be positive'],
    },
    description: {
      type: String,
      required: true,
      trim: true,
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
  },
  {
    timestamps: true,
  }
);

// Multi-tenant: every cash transaction belongs to a company
cashTransactionSchema.plugin(tenantPlugin);

// Indexes
cashTransactionSchema.index({ company: 1, type: 1 });
cashTransactionSchema.index({ company: 1, category: 1 });
cashTransactionSchema.index({ company: 1, date: -1 });
cashTransactionSchema.index({ company: 1, referenceId: 1 });

module.exports = mongoose.model('CashTransaction', cashTransactionSchema);
