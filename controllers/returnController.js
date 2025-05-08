const mongoose = require('mongoose');
const Return = require('../models/return');
const Customer = require('../models/customer');
const Stock = require('../models/stock');
const Product = require('../models/product');
const Invoice = require('../models/invoice');
const Transaction = require('../models/transactions');
const Crud = require('./crudFactory');

exports.allReturn = Crud.getAll(Return);
exports.updateReturn = Crud.updateOne(Return);
exports.oneReturn = Crud.getOneById(Return);
exports.deleteReturn = Crud.deleteOne(Return);

exports.addReturn = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { invoiceNumber, productName, name, quantity, reason } = req.body;

        if (quantity <= 0) {
            throw new Error('Return quantity must be greater than zero.');
        }

        const productDoc = await Product.findOne({ name: productName }).session(session);
        if (!productDoc) throw new Error('Product not found.');

        const [customer, invoice, stock] = await Promise.all([
            Customer.findOne({ name }).session(session),
            Invoice.findOne({ invoiceNumber }).session(session),
            Stock.findOne({ product: productDoc._id }).session(session)
        ]);

        if (!customer) throw new Error('Customer not found.');
        if (!invoice) throw new Error('Invoice not found.');
        if (!stock) throw new Error('Product not found in stock.');

        const invoiceItem = invoice.items.find(
            item => item.product.toString() === stock.product.toString()
        );

        if (!invoiceItem) throw new Error('Product not found in invoice.');

        // Get all returns for this invoice and product
        const returns = await Return.find({
            invoice: invoice._id,
            product: productDoc.name
        }).session(session);

        // Sum total returned quantity using reduce
        const alreadyReturnedQty = returns.reduce((total, ret) => total + ret.quantity, 0);
        const remainingQty = invoiceItem.quantity - alreadyReturnedQty;

        if (quantity > remainingQty) {
            throw new Error(`Return quantity exceeds the remaining quantity. Only ${remainingQty} can be returned.`);
        }

        const refundAmount = invoiceItem.unitPrice * quantity;

        // Update stock
        stock.quantity += quantity;

        // Create return record
        const returnDoc = new Return({
            invoice: invoice._id,
            customer: customer._id,
            product: productDoc.name,
            quantity,
            reason,
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
        customer.outstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - refundAmount);
        customer.balance = Math.max(0, (customer.balance || 0) - refundAmount);

        // Save all changes in parallel
        await Promise.all([
            stock.save({ session }),
            returnDoc.save({ session }),
            invoice.save({ session }),
            refundTransaction.save({ session }),
            customer.save({ session }),
        ]);

        await session.commitTransaction();
        res.status(201).json({ message: 'Return added successfully' });

    } catch (error) {
        await session.abortTransaction();
        res.status(500).json({ message: 'Error processing return', error: error.message });
    } finally {
        session.endSession();
    }
};
