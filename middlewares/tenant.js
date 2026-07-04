'use strict';

/**
 * Tenant isolation middleware.
 *
 * How it works:
 *   This middleware runs AFTER `protect`. It injects `req.companyId`
 *   (set by protect from the authenticated user's DB record) into
 *   req.body and req.tenantFilter so controllers don't have to
 *   think about multi-tenancy at all.
 *
 * Controllers use req.tenantFilter as a base filter:
 *
 *   const docs = await Customer.find({ ...req.tenantFilter, name: /ahmed/i });
 *
 * And req.body automatically includes company on create:
 *
 *   const doc = await Customer.create(req.body); // company is already in body
 *
 * This is intentionally a simple, explicit approach rather than
 * Mongoose middleware magic — it keeps business logic readable.
 */
exports.injectTenant = (req, res, next) => {
  if (!req.companyId) {
    // protect must run before this middleware
    return next(new Error('Tenant context missing — protect must run before injectTenant'));
  }

  // Base filter for every find/findOne/countDocuments call
  req.tenantFilter = { company: req.companyId };

  // Inject into body so factory create/update ops include company automatically
  if (req.body && typeof req.body === 'object') {
    req.body.company = req.companyId;
  }

  next();
};

/**
 * Verify document ownership after fetching.
 * Call this when crudFactory.getOneById returns and you need to be sure
 * the document belongs to the requesting company.
 *
 * Usage (inline guard in a controller):
 *   const doc = await Customer.findById(req.params.id);
 *   assertTenant(doc, req.companyId, next);   // throws 404 if mismatch
 *
 * Returns true if OK, calls next(err) and returns false if mismatch.
 */
exports.assertTenant = (doc, companyId, next) => {
  if (!doc) {
    const AppError = require('../utils/appError');
    next(new AppError('No document found with that ID', 404));
    return false;
  }
  if (doc.company?.toString() !== companyId?.toString()) {
    // Return 404 instead of 403 — don't reveal the document exists
    const AppError = require('../utils/appError');
    next(new AppError('No document found with that ID', 404));
    return false;
  }
  return true;
};
