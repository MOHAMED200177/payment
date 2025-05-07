const mongoose = require('mongoose');
const Return = require('../models/return');
const Customer = require('../models/customer');
const Stock = require('../models/stock');
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
        const { invoiceId, productName, name, quantity, reason } = req.body;

        if (quantity <= 0) {
            throw new Error('Return quantity must be greater than zero.');
        }

        const [customer, invoice, product] = await Promise.all([
            Customer.findOne({ name }).session(session),
            Invoice.findById(invoiceId).session(session),
            Stock.findOne({ product: productName }).session(session),
        ]);

        if (!customer) throw new Error('Customer not found.');
        if (!invoice) throw new Error('Invoice not found.');
        if (!product) throw new Error('Product not found in stock.');

        const invoiceItem = invoice.items.find(
            item => item.product_id.toString() === product._id.toString()
        );

        if (!invoiceItem) throw new Error('Product not found in invoice.');

        const totalReturnedQty = await Return.aggregate([
            { $match: { invoice: invoice._id, product: product._id } },
            { $group: { _id: null, total: { $sum: '$quantity' } } },
        ]);

        const alreadyReturnedQty = totalReturnedQty[0]?.total || 0;
        const remainingQty = invoiceItem.quantity - alreadyReturnedQty;

        if (quantity > remainingQty) {
            throw new Error(`Return quantity exceeds the remaining quantity. Only ${remainingQty} can be returned.`);
        }

        const refundAmount = invoiceItem.price * quantity;

        // Update stock
        product.quantity += quantity;

        // Create return record
        const returnDoc = new Return({
            invoice: invoice._id,
            customer: customer._id,
            product: product._id,
            quantity,
            reason,
        });

        // Update invoice
        invoice.returns.push(returnDoc._id);
        invoice.refunds = (invoice.refunds || 0) + refundAmount;
        invoice.total = Math.max(0, invoice.total - refundAmount);
        invoice.remaining = Math.max(0, invoice.remaining - refundAmount);

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
        customer.returns.push(returnDoc._id);
        customer.outstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - refundAmount);
        customer.balance = Math.max(0, (customer.balance || 0) - refundAmount);

        // Save all changes in parallel
        await Promise.all([
            product.save({ session }),
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
