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

        // Find the customer
        const customer = await Customer.findOne({ name }).session(session);
        if (!customer) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'Customer not found' });
        }

        // Find the invoice
        const invoice = await Invoice.findById(invoiceId).session(session);
        if (!invoice) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        // Find the product in stock
        const product = await Stock.findOne({ product: productName }).session(session);
        if (!product) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'Product not found in stock' });
        }

        // Check invoice item and return quantity
        const invoiceItem = invoice.items.find(item => item.product_id.toString() === product._id.toString());
        if (!invoiceItem || quantity > invoiceItem.quantity) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ message: 'Invalid return quantity' });
        }

        // Calculate refund amount
        const refundAmount = product.price * quantity;

        // Update product stock
        product.quantity += quantity;
        await product.save({ session });

        // Create return record
        const newReturn = new Return({
            invoice: invoice._id,
            customer: customer._id,
            product: product._id,
            quantity,
            reason,
        });
        await newReturn.save({ session });

        // Update invoice
        invoice.returns.push(newReturn._id);
        invoice.refunds = (invoice.refunds || 0) + refundAmount;
        invoice.total -= refundAmount;
        invoice.remaining -= refundAmount;
        await invoice.save({ session });

        // Create refund transaction
        const refundTransaction = new Transaction({
            type: 'return',
            referenceId: newReturn._id,
            amount: -refundAmount,
            details: `Refund of ${refundAmount} for returned quantity of ${quantity} from invoice ${invoice._id}`,
            status: 'debit',
        });
        await refundTransaction.save({ session });

        // Update customer
        customer.transactions.push(refundTransaction._id);
        customer.returns.push(newReturn._id);
        customer.outstandingBalance -= refundAmount;
        customer.balance -= refundAmount;
        await customer.save({ session });

        // Commit transaction
        await session.commitTransaction();
        session.endSession();

        res.status(201).json({
            message: 'Return added successfully',
        });
    } catch (error) {
        // Rollback transaction on error
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ message: 'Error processing return', error });
    }
};
