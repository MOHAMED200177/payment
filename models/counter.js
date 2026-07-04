'use strict';
const mongoose = require('mongoose');

/**
 * Counter is company-scoped.
 * `name` is the sequence name (invoice, salesOrder, purchaseOrder, prescription).
 * The compound unique index ensures each company has its own independent counters.
 */
const counterSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  name: { type: String, required: true },
  value: { type: Number, default: 0 },
});

counterSchema.index({ company: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Counter', counterSchema);
