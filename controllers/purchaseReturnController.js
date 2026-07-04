'use strict';
const mongoose = require('mongoose');
const PurchaseOrder = require('../models/purchaseOrder.model');
const Supplier = require('../models/supplier');
const Stock = require('../models/stock');
const Product = require('../models/product');
const Transaction = require('../models/transactions');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { logAudit } = require('../utils/auditLog');

// We use the same 'Return' model but will distinguish it by reference,
// OR we can just use SupplierPayment to track the financial refund, 
// and Stock to track the inventory decrement. For simplicity and ERP consistency,
// we will just handle the stock deduction and supplier balance adjustment.

// ============================================================
// Process Purchase Return
// ============================================================
exports.processPurchaseReturn = catchAsync(async (req, res, next) => {
  const { poNumber, productName, quantity, refundAmount = 0, reason } = req.body;
  const companyId = req.companyId;

  if (!poNumber || !productName || quantity <= 0) {
    return next(new AppError('Purchase Order Number, Product Name, and valid Quantity are required', 400));
  }
  if (refundAmount < 0) return next(new AppError('Refund amount cannot be negative', 400));

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Validate PO
    const po = await PurchaseOrder.findOne({ 
      poNumber, 
      company: companyId,
      isDeleted: { $ne: true }
    }).session(session);
    
    if (!po) throw new AppError('Purchase Order not found', 404);

    // 2. Validate Product in PO
    const product = await Product.findOne({ name: productName, company: companyId }).session(session);
    if (!product) throw new AppError('Product not found', 404);

    const poItem = po.items.find((item) => item.product.toString() === product._id.toString());
    if (!poItem) throw new AppError('Product not part of this Purchase Order', 400);

    // 3. Check Stock
    const stock = await Stock.findOne({ product: product._id, company: companyId }).session(session);
    if (!stock || stock.quantity < quantity) {
      throw new AppError(`Insufficient stock to return. Available: ${stock?.quantity || 0}`, 400);
    }

    // 4. Update Stock (deduct returned items)
    stock.quantity -= quantity;
    stock.lastStockUpdate = new Date();
    await stock.save({ session });

    // 5. Update Supplier Balance (refund decreases what we owe them, or gives us credit)
    const supplier = await Supplier.findOne({ _id: po.supplier, company: companyId }).session(session);
    if (!supplier) throw new AppError('Supplier not found', 404);

    // If refundAmount > 0, it means the supplier gave us money back (or reduced our debt).
    // Let's assume it reduces the PO balanceDue and Supplier outstandingBalance.
    if (refundAmount > 0) {
      po.balanceDue = Math.max(0, po.balanceDue - refundAmount);
      // Wait, if we return goods, the total amount of PO decreases
      po.totalAmount = Math.max(0, po.totalAmount - refundAmount);
      
      // Update supplier global balance (we owe them less)
      // Since it's an ERP, we create a credit transaction
      const txn = new Transaction({
        type: 'purchase_return',
        referenceId: po._id,
        amount: refundAmount,
        company: companyId,
        details: `Return ${quantity}x ${productName} for PO #${poNumber}. Reason: ${reason || 'N/A'}`,
        status: 'credit',
        date: new Date(),
        items: [{ product: product._id, quantity, price: refundAmount / quantity }]
      });
      await txn.save({ session });
    }

    await po.save({ session });
    await supplier.save({ session }); // supplier balance logic might be derived, but we save to trigger hooks

    logAudit({
      req,
      action: 'CREATE',
      module: 'PURCHASE_RETURN',
      entityId: po._id,
      entityLabel: po.poNumber,
      newValues: { returnedProduct: product.name, quantity, refundAmount, reason }
    });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: 'success',
      message: 'Purchase return processed successfully',
      data: {
        poNumber: po.poNumber,
        productName: product.name,
        quantityReturned: quantity,
        stockRemaining: stock.quantity,
        refundAmount
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(error);
  }
});
