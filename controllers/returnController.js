const mongoose = require('mongoose');
const Return = require('../models/return');
const Customer = require('../models/customer');
const Stock = require('../models/stock');
const Product = require('../models/product');
const Invoice = require('../models/invoice');
const Transaction = require('../models/transactions');
const Sale = require('../models/sales');

// Helper function to update sales statistics
const updateSalesStatistics = async (
  productId,
  quantity,
  amount,
  session,
  isReturn = true
) => {
  const sale = await Sale.findOne({ product: productId }).session(session);

  if (!sale) {
    throw new Error('Sale record not found for this product');
  }

  if (isReturn) {
    // تقليل كمية المبيعات والإيرادات عند المرتجع
    sale.quantitySold = Math.max(0, sale.quantitySold - quantity);
    sale.totalRevenue = Math.max(0, sale.totalRevenue - amount);
    sale.returnsCount = (sale.returnsCount || 0) + 1;
    sale.returnedQuantity = (sale.returnedQuantity || 0) + quantity;
    sale.returnedAmount = (sale.returnedAmount || 0) + amount;
  } else {
    // زيادة كمية المبيعات والإيرادات عند إلغاء المرتجع
    sale.quantitySold += quantity;
    sale.totalRevenue += amount;
    sale.returnsCount = Math.max(0, (sale.returnsCount || 0) - 1);
    sale.returnedQuantity = Math.max(
      0,
      (sale.returnedQuantity || 0) - quantity
    );
    sale.returnedAmount = Math.max(0, (sale.returnedAmount || 0) - amount);
  }

  await sale.save({ session });
};

// Get all returns with population
exports.allReturn = async (req, res) => {
  try {
    const returns = await Return.find()
      .populate('customer', 'name email phone')
      .populate('invoice', 'invoiceNumber totalAmount')
      .sort('-createdAt');

    res.status(200).json({
      success: true,
      results: returns.length,
      data: returns,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching returns',
      error: error.message,
    });
  }
};

// Get one return by ID
exports.oneReturn = async (req, res) => {
  try {
    const returnDoc = await Return.findById(req.params.id)
      .populate('customer', 'name email phone')
      .populate('invoice', 'invoiceNumber totalAmount items');

    if (!returnDoc) {
      return res.status(404).json({
        success: false,
        message: 'Return not found',
      });
    }

    res.status(200).json({
      success: true,
      data: returnDoc,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching return',
      error: error.message,
    });
  }
};

// Add return with sales update
exports.addReturn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { invoiceNumber, productName, name, quantity, reason } = req.body;

    if (quantity <= 0) {
      throw new Error('Return quantity must be greater than zero.');
    }

    const productDoc = await Product.findOne({ name: productName }).session(
      session
    );
    if (!productDoc) throw new Error('Product not found.');

    const [customer, invoice, stock] = await Promise.all([
      Customer.findOne({ name }).session(session),
      Invoice.findOne({ invoiceNumber }).session(session),
      Stock.findOne({ product: productDoc._id }).session(session),
    ]);

    if (!customer) throw new Error('Customer not found.');
    if (!invoice) throw new Error('Invoice not found.');
    if (!stock) throw new Error('Product not found in stock.');

    const invoiceItem = invoice.items.find(
      (item) => item.product.toString() === stock.product.toString()
    );

    if (!invoiceItem) throw new Error('Product not found in invoice.');

    // Get all returns for this invoice and product
    const returns = await Return.find({
      invoice: invoice._id,
      product: productDoc.name,
    }).session(session);

    // Sum total returned quantity using reduce
    const alreadyReturnedQty = returns.reduce(
      (total, ret) => total + ret.quantity,
      0
    );
    const remainingQty = invoiceItem.quantity - alreadyReturnedQty;

    if (quantity > remainingQty) {
      throw new Error(
        `Return quantity exceeds the remaining quantity. Only ${remainingQty} can be returned.`
      );
    }

    const refundAmount = invoiceItem.unitPrice * quantity;

    // Update stock
    stock.quantity += quantity;

    // Create return record
    const returnDoc = new Return({
      invoice: invoice._id,
      customer: customer._id,
      product: productDoc.name,
      productId: productDoc._id,
      quantity,
      reason,
      refundAmount,
    });

    // Update invoice
    if (!invoice.returns) invoice.returns = [];
    invoice.returns.push(returnDoc._id);
    invoice.refunds = (invoice.refunds || 0) + refundAmount;
    invoice.subtotal = Math.max(0, invoice.subtotal - refundAmount);
    invoice.totalAmount = Math.max(0, invoice.totalAmount - refundAmount);
    invoice.balanceDue = Math.max(0, invoice.balanceDue - refundAmount);

    // Create refund transaction
    const refundTransaction = new Transaction({
      type: 'return',
      referenceId: returnDoc._id,
      amount: -refundAmount,
      details: `Refund of ${refundAmount} for return of ${quantity} item(s) from invoice ${invoice._id}`,
      status: 'debit',
    });

    // Update customer
    customer.transactions.push(refundTransaction._id);
    if (!customer.returns) customer.returns = [];
    customer.returns.push(returnDoc._id);
    customer.outstandingBalance = Math.max(
      0,
      (customer.outstandingBalance || 0) - refundAmount
    );
    customer.balance = Math.max(0, (customer.balance || 0) - refundAmount);

    // Update sales statistics
    await updateSalesStatistics(
      productDoc._id,
      quantity,
      refundAmount,
      session,
      true
    );

    // Save all changes in parallel
    await Promise.all([
      stock.save({ session }),
      returnDoc.save({ session }),
      invoice.save({ session }),
      refundTransaction.save({ session }),
      customer.save({ session }),
    ]);

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: 'Return added successfully',
      data: returnDoc,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({
      success: false,
      message: 'Error processing return',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// Update return (with restrictions)
exports.updateReturn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const updates = req.body;

    // Find existing return
    const existingReturn = await Return.findById(id).session(session);
    if (!existingReturn) {
      throw new Error('Return not found');
    }

    // Restrict updates to specific fields only
    const allowedUpdates = ['reason', 'status', 'notes'];
    const updateFields = {};

    Object.keys(updates).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updateFields[key] = updates[key];
      }
    });

    // If status is being changed to cancelled
    if (
      updates.status === 'cancelled' &&
      existingReturn.status !== 'cancelled'
    ) {
      // Reverse the return effects
      const [product, stock, invoice, customer] = await Promise.all([
        Product.findOne({ name: existingReturn.product }).session(session),
        Stock.findOne({ product: existingReturn.productId }).session(session),
        Invoice.findById(existingReturn.invoice).session(session),
        Customer.findById(existingReturn.customer).session(session),
      ]);

      if (!product || !stock || !invoice || !customer) {
        throw new Error('Related records not found');
      }

      // Reverse stock update
      stock.quantity -= existingReturn.quantity;
      if (stock.quantity < 0) {
        throw new Error('Insufficient stock to cancel return');
      }

      // Reverse invoice updates
      invoice.refunds = Math.max(
        0,
        (invoice.refunds || 0) - existingReturn.refundAmount
      );
      invoice.subtotal += existingReturn.refundAmount;
      invoice.totalAmount += existingReturn.refundAmount;
      invoice.balanceDue += existingReturn.refundAmount;

      // Create adjustment transaction
      const adjustmentTransaction = new Transaction({
        type: 'return_cancellation',
        referenceId: existingReturn._id,
        amount: existingReturn.refundAmount,
        details: `Cancellation of return ${existingReturn._id} - restored ${existingReturn.refundAmount}`,
        status: 'credit',
      });

      // Update customer
      customer.transactions.push(adjustmentTransaction._id);
      customer.outstandingBalance += existingReturn.refundAmount;
      customer.balance += existingReturn.refundAmount;

      // Update sales statistics (reverse the return)
      await updateSalesStatistics(
        existingReturn.productId,
        existingReturn.quantity,
        existingReturn.refundAmount,
        session,
        false
      );

      // Save all changes
      await Promise.all([
        stock.save({ session }),
        invoice.save({ session }),
        adjustmentTransaction.save({ session }),
        customer.save({ session }),
      ]);
    }

    // Update the return document
    Object.assign(existingReturn, updateFields);
    await existingReturn.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: 'Return updated successfully',
      data: existingReturn,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({
      success: false,
      message: 'Error updating return',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// Delete return (soft delete recommended)
exports.deleteReturn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    const returnDoc = await Return.findById(id).session(session);
    if (!returnDoc) {
      throw new Error('Return not found');
    }

    // Check if return can be deleted (e.g., not already processed)
    if (returnDoc.status === 'processed') {
      throw new Error('Cannot delete a processed return');
    }

    // If deleting an active return, reverse all its effects
    if (returnDoc.status === 'active') {
      // Similar logic to cancelling a return
      const [product, stock, invoice, customer] = await Promise.all([
        Product.findOne({ name: returnDoc.product }).session(session),
        Stock.findOne({ product: returnDoc.productId }).session(session),
        Invoice.findById(returnDoc.invoice).session(session),
        Customer.findById(returnDoc.customer).session(session),
      ]);

      if (stock) {
        stock.quantity -= returnDoc.quantity;
        await stock.save({ session });
      }

      if (invoice) {
        invoice.refunds = Math.max(
          0,
          (invoice.refunds || 0) - returnDoc.refundAmount
        );
        invoice.subtotal += returnDoc.refundAmount;
        invoice.totalAmount += returnDoc.refundAmount;
        invoice.balanceDue += returnDoc.refundAmount;
        invoice.returns = invoice.returns.filter((r) => r.toString() !== id);
        await invoice.save({ session });
      }

      if (customer) {
        customer.outstandingBalance += returnDoc.refundAmount;
        customer.balance += returnDoc.refundAmount;
        customer.returns = customer.returns.filter((r) => r.toString() !== id);
        await customer.save({ session });
      }

      // Update sales statistics
      if (product) {
        await updateSalesStatistics(
          returnDoc.productId,
          returnDoc.quantity,
          returnDoc.refundAmount,
          session,
          false
        );
      }
    }

    // Soft delete by marking as deleted
    returnDoc.isDeleted = true;
    returnDoc.deletedAt = new Date();
    await returnDoc.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: 'Return deleted successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({
      success: false,
      message: 'Error deleting return',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// Get returns by customer
exports.getReturnsByCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;

    const returns = await Return.find({
      customer: customerId,
      isDeleted: { $ne: true },
    })
      .populate('invoice', 'invoiceNumber totalAmount')
      .sort('-createdAt');

    const summary = {
      totalReturns: returns.length,
      totalRefundAmount: returns.reduce(
        (sum, ret) => sum + (ret.refundAmount || 0),
        0
      ),
      returns,
    };

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching customer returns',
      error: error.message,
    });
  }
};

// Get returns by date range
exports.getReturnsByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const query = {
      isDeleted: { $ne: true },
    };

    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const returns = await Return.find(query)
      .populate('customer', 'name')
      .populate('invoice', 'invoiceNumber')
      .sort('-createdAt');

    res.status(200).json({
      success: true,
      results: returns.length,
      data: returns,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching returns by date',
      error: error.message,
    });
  }
};
