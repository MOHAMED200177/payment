'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');
const softDeletePlugin = require('./softDeletePlugin');

const expenseSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ['salary', 'rent', 'utilities', 'maintenance', 'medical_supplies', 'equipment', 'marketing', 'insurance', 'taxes', 'other'],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String, required: true },
    date: { type: Date, required: true, default: Date.now },
    paymentMethod: { type: String, enum: ['Cash', 'Credit Card', 'Bank Transfer', 'Other'], default: 'Cash' },
    isRecurring: { type: Boolean, default: false },
    recurringPeriod: { type: String, enum: ['daily', 'weekly', 'monthly', 'yearly', null], default: null },
    attachments: [{ url: String, name: String }],
    status: { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'paid' },
    notes: { type: String, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

expenseSchema.plugin(tenantPlugin);
// Replace manual isDeleted + use consistent softDeletePlugin
expenseSchema.plugin(softDeletePlugin);

expenseSchema.index({ company: 1, category: 1 });
expenseSchema.index({ company: 1, date: -1 });
expenseSchema.index({ company: 1, isDeleted: 1 });

module.exports = mongoose.model('Expense', expenseSchema);
