'use strict';
const mongoose = require('mongoose');

/**
 * Mongoose plugin — adds a required `company` field to any schema.
 *
 * Usage:
 *   customerSchema.plugin(tenantPlugin);
 *
 * This ensures:
 *   1. Every document carries a company reference.
 *   2. The field is indexed for fast per-tenant queries.
 *   3. The field is NOT in `select: false` — it IS returned in queries
 *      so the middleware can verify ownership when needed.
 *
 * The middleware layer (middlewares/tenant.js) automatically:
 *   - Injects { company: req.user.company } into every find/create call.
 *   - This plugin just ensures the field exists on every schema.
 */
function tenantPlugin(schema) {
  // Only add if not already present (safety for double-apply)
  if (schema.path('company')) return;

  schema.add({
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'Company reference is required'],
      index: true,
    },
  });

  // Compound index: company + createdAt for efficient paginated list queries
  schema.index({ company: 1, createdAt: -1 });
}

module.exports = tenantPlugin;
