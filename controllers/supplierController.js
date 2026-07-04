'use strict';
const factory  = require('./crudFactory');
const Supplier = require('../models/supplier');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { logAudit } = require('../utils/auditLog');

exports.getAllSuppliers = factory.getAll(Supplier);
exports.createSupplier = factory.createOne(Supplier);
exports.getSupplier    = factory.getOneById(Supplier);
exports.updateSupplier = factory.updateOne(Supplier);
exports.deleteSupplier = factory.deleteOne(Supplier);

// ============================================================
// Supplier Statement — tenant-scoped
// ============================================================
exports.getSupplierStatement = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;

  // Ensure supplier belongs to this company
  const supplier = await Supplier.findOne({ _id: id, ...req.tenantFilter });
  if (!supplier) return next(new AppError('Supplier not found', 404));

  const PurchaseOrder   = require('../models/purchaseOrder.model');
  const SupplierPayment = require('../models/supplierPayment.model');

  const dateFilter = {};
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end   = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return next(new AppError('Invalid date format', 400));
    }
    dateFilter.createdAt = { $gte: start, $lte: end };
  }

  const [orders, payments] = await Promise.all([
    PurchaseOrder.find({ supplier: id, isDeleted: false, ...req.tenantFilter, ...dateFilter })
      .populate('items.product', 'name productCode')
      .sort('-createdAt').lean(),
    SupplierPayment.find({ supplier: id, ...req.tenantFilter, ...dateFilter })
      .sort('-createdAt').lean(),
  ]);

  const totalPurchases     = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);
  const totalPaid          = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const outstandingBalance = orders.reduce((s, o) => s + (o.balanceDue || 0), 0);

  res.status(200).json({
    status: 'success',
    data: {
      supplier: { name: supplier.name, email: supplier.email, phone: supplier.phone, paymentTerms: supplier.paymentTerms },
      totals: {
        totalPurchases:     totalPurchases.toFixed(2),
        totalPaid:          totalPaid.toFixed(2),
        outstandingBalance: outstandingBalance.toFixed(2),
      },
      orders,
      payments,
    },
  });
});
