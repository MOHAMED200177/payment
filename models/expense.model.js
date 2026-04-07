const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: [
        'salary',
        'rent',
        'utilities',
        'maintenance',
        'medical_supplies',
        'equipment',
        'marketing',
        'insurance',
        'taxes',
        'other',
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
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    paymentMethod: {
      type: String,
      enum: ['Cash', 'Credit Card', 'Bank Transfer', 'Other'],
      default: 'Cash',
    },
    // ✅ هل المصروف متكرر
    isRecurring: {
      type: Boolean,
      default: false,
    },
    recurringPeriod: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'yearly', null],
      default: null,
    },
    // ✅ المرفقات (فواتير / إيصالات)
    attachments: [
      {
        url: String,
        name: String,
      },
    ],
    status: {
      type: String,
      enum: ['pending', 'paid', 'cancelled'],
      default: 'paid',
    },
    approvedBy: {
      type: String,
      default: null,
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
  }
);

// ✅ Indexes
expenseSchema.index({ category: 1 });
expenseSchema.index({ date: -1 });
expenseSchema.index({ status: 1 });
expenseSchema.index({ isDeleted: 1 });

module.exports = mongoose.model('Expense', expenseSchema);
