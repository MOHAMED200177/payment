'use strict';
const mongoose = require('mongoose');

/**
 * Soft-delete plugin — adds isDeleted, deletedAt, deletedBy fields.
 *
 * Applying this plugin ensures:
 *   1. Records are never permanently deleted (preserves audit history)
 *   2. All three soft-delete fields are consistently present
 *   3. A compound index on (company, isDeleted) for fast filtered queries
 *
 * Usage:
 *   schema.plugin(softDeletePlugin);
 *
 * List queries should filter { isDeleted: { $ne: true } } — crudFactory does this automatically.
 * Hard deletion should only happen on cascade cleanup (e.g. wiping a test company).
 */
function softDeletePlugin(schema) {
  if (schema.path('isDeleted')) return; // Safety: avoid double-apply

  schema.add({
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  });

  schema.index({ company: 1, isDeleted: 1 });
}

module.exports = softDeletePlugin;
