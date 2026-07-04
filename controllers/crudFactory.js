'use strict';
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const APIFeatures = require('../utils/features');
const { logAudit } = require('../utils/auditLog');

/**
 * Tenant-aware CRUD factory — with Soft Delete and Audit Logging.
 *
 * All operations:
 *   1. Scope to req.companyId (set by protect + injectTenant).
 *   2. Exclude soft-deleted records from reads automatically.
 *   3. Soft-delete instead of hard-delete.
 *   4. Fire audit log on CREATE, UPDATE, SOFT_DELETE.
 */

// Helper to check if a model uses soft delete
const hasSoftDelete = (Model) => !!Model.schema.path('isDeleted');

exports.getAll = (Model, popOptions) =>
  catchAsync(async (req, res, next) => {
    // Merge tenant filter + exclude soft-deleted records
    const baseFilter = { ...req.tenantFilter };
    if (hasSoftDelete(Model)) baseFilter.isDeleted = { $ne: true };

    const countQuery = new APIFeatures(Model.find(baseFilter), req.query).filter();
    const total = await Model.countDocuments(countQuery.query.getFilter());

    const features = new APIFeatures(Model.find(baseFilter), req.query)
      .filter()
      .sort()
      .limitFields()
      .paginate();

    if (popOptions) features.query = features.query.populate(popOptions);

    const docs = await features.query;

    const page = req.query.page * 1 || 1;
    const limit = req.query.limit * 1 || 20;
    const pages = Math.max(1, Math.ceil(total / limit));

    res.status(200).json({
      status: 'success',
      results: docs.length,
      total,
      page,
      limit,
      pages,
      data: { data: docs },
    });
  });

exports.getOneById = (Model, popOptions) =>
  catchAsync(async (req, res, next) => {
    const filter = { _id: req.params.id, ...req.tenantFilter };
    if (hasSoftDelete(Model)) filter.isDeleted = { $ne: true };

    let query = Model.findOne(filter);
    if (popOptions) query = query.populate(popOptions);
    const doc = await query.exec();

    if (!doc) {
      return next(new AppError('No document found with that ID', 404));
    }

    res.status(200).json({ status: 'success', data: { data: doc } });
  });

exports.getOneByField = (Model, fieldName, popOptions) =>
  catchAsync(async (req, res, next) => {
    const value = req.body[fieldName];
    if (!value) {
      return next(new AppError(`Please provide a value for field: ${fieldName}`, 400));
    }

    const filter = { [fieldName]: value, ...req.tenantFilter };
    if (hasSoftDelete(Model)) filter.isDeleted = { $ne: true };

    let query = Model.findOne(filter);
    if (popOptions) query = query.populate(popOptions);
    const doc = await query.exec();

    if (!doc) {
      return next(
        new AppError(`No ${Model.modelName} found with ${fieldName}: ${value}`, 404)
      );
    }

    res.status(200).json({ status: 'success', data: { data: doc } });
  });

exports.createOne = (Model) =>
  catchAsync(async (req, res, next) => {
    // req.body.company is already set by injectTenant middleware
    const doc = await Model.create(req.body);

    // Audit log (non-blocking)
    logAudit({
      req,
      action: 'CREATE',
      module: Model.modelName.toUpperCase(),
      entityId: doc._id,
      entityLabel: doc.name || doc.description || String(doc._id),
      newValues: req.body,
    });

    res.status(201).json({ status: 'success', data: { data: doc } });
  });

exports.updateOne = (Model) =>
  catchAsync(async (req, res, next) => {
    // Prevent company field from being changed via update
    delete req.body.company;

    const filter = { _id: req.params.id, ...req.tenantFilter };
    if (hasSoftDelete(Model)) filter.isDeleted = { $ne: true };

    // Fetch old values for audit log
    const oldDoc = await Model.findOne(filter).lean();
    if (!oldDoc) return next(new AppError('No document found with that ID', 404));

    const doc = await Model.findOneAndUpdate(filter, req.body, {
      new: true,
      runValidators: true,
    });

    if (!doc) {
      return next(new AppError('No document found with that ID', 404));
    }

    // Audit log (non-blocking)
    logAudit({
      req,
      action: 'UPDATE',
      module: Model.modelName.toUpperCase(),
      entityId: doc._id,
      entityLabel: doc.name || doc.description || String(doc._id),
      oldValues: oldDoc,
      newValues: req.body,
    });

    res.status(200).json({ status: 'success', data: { data: doc } });
  });

exports.deleteOne = (Model) =>
  catchAsync(async (req, res, next) => {
    const filter = { _id: req.params.id, ...req.tenantFilter };
    if (hasSoftDelete(Model)) filter.isDeleted = { $ne: true };

    const doc = await Model.findOne(filter);

    if (!doc) {
      return next(new AppError('No document found with that ID', 404));
    }

    if (hasSoftDelete(Model)) {
      // Soft delete — preserve historical data
      doc.isDeleted = true;
      doc.deletedAt = new Date();
      if (req.user) doc.deletedBy = req.user._id;
      await doc.save();

      logAudit({
        req,
        action: 'SOFT_DELETE',
        module: Model.modelName.toUpperCase(),
        entityId: doc._id,
        entityLabel: doc.name || doc.description || String(doc._id),
        oldValues: { isDeleted: false },
        newValues: { isDeleted: true, deletedAt: doc.deletedAt },
      });

      return res.status(200).json({ status: 'success', message: 'Record deleted successfully' });
    }

    // Hard delete only for models without soft-delete (e.g. Counters, Transactions)
    await Model.findOneAndDelete({ _id: req.params.id, ...req.tenantFilter });
    res.status(204).json({ status: 'success', data: null });
  });
