const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const APIFeatures = require('./../utils/features');

exports.deleteOne = (Model) =>
  catchAsync(async (req, res, next) => {
    const doc = await Model.findByIdAndDelete(req.params.id);

    if (!doc) {
      return next(new AppError('No document found with that ID', 404));
    }

    res.status(204).json({
      status: 'success',
      data: null,
    });
  });

exports.updateOne = (Model) =>
  catchAsync(async (req, res, next) => {
    const doc = await Model.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!doc) {
      return next(new AppError('No document found with that ID', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        data: doc,
      },
    });
  });

exports.createOne = (Model) =>
  catchAsync(async (req, res, next) => {
    const doc = await Model.create(req.body);

    res.status(201).json({
      status: 'success',
      data: {
        data: doc,
      },
    });
  });

exports.getOneById = (Model, popOptions) =>
  catchAsync(async (req, res, next) => {
    let query = Model.findById(req.params.id);
    if (popOptions) query = query.populate(popOptions);
    const doc = await query.exec();

    if (!doc) {
      return next(new AppError('No document found with that ID', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        data: doc,
      },
    });
  });

exports.getOneByField = (Model, fieldName, popOptions) =>
  catchAsync(async (req, res, next) => {
    const value = req.body[fieldName];
    if (!value) {
      return next(
        new AppError(`Please provide a value for field: ${fieldName}`, 400)
      );
    }

    let query = Model.findOne({ [fieldName]: value });
    if (popOptions) query = query.populate(popOptions);

    const doc = await query.exec();

    if (!doc) {
      return next(
        new AppError(
          `No ${Model.modelName} found with ${fieldName}: ${value}`,
          404
        )
      );
    }

    res.status(200).json({
      status: 'success',
      data: {
        data: doc,
      },
    });
  });

exports.getAll = (
  Model,
  popOptions // <-- تعديل هنا: إضافة popOptions
) =>
  catchAsync(async (req, res, next) => {
    // To allow for nested GET reviews on pet (hack)
    let filter = {};
    if (req.params.petId) filter = { pet: req.params.petId };

    const features = new APIFeatures(Model.find(filter), req.query)
      .filter()
      .sort()
      .limitFields()
      .paginate();

    if (popOptions) features.query = features.query.populate(popOptions);

    const doc = await features.query;

    // SEND RESPONSE
    res.status(200).json({
      status: 'success',
      results: doc.length,
      paginate: Math.ceil(doc.length / (req.query.limit || 10)), // تحسين لحساب الصفحات
      data: {
        data: doc,
      },
    });
  });
