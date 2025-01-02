const mongoose = require('mongoose');
const Payment = require('../models/payment');
const Invoice = require('../models/invoice');
const Customer = require('../models/customer');
const Transaction = require('../models/transactions');
const Crud = require('./crudFactory');

exports.allPayment = Crud.getAll(Payment);
exports.updatePayment = Crud.updateOne(Payment);
exports.onePayment = Crud.getOneById(Payment);
exports.deletePayment = Crud.deleteOne(Payment);

exports.addPayment = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { name, amount, invoiceId } = req.body;

        // Find customer by name
        const customer = await Customer.findOne({ name }).session(session);
        if (!customer) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'Customer not found' });
        }

        // Find invoice by ID
        const invoice = await Invoice.findById(invoiceId).session(session);
        if (!invoice) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const remaining = invoice.total - (invoice.paid || 0);
        if (amount > remaining) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ message: `Payment exceeds remaining invoice amount. Remaining: ${remaining}` });
        }

        // Create payment
        const payment = new Payment({
            customer: customer.id,
            customerName: name,
            amount,
            invoice: invoiceId,
        });
        await payment.save({ session });

        // Create transaction
        const transaction = await Transaction.create([{
            type: 'payment',
            referenceId: invoice._id,
            amount,
            details: `Payment of ${amount} for invoice ${invoice._id}`,
            status: 'credit',
        }], { session });

        // Update customer
        customer.transactions.push(transaction[0]._id);
        customer.payment.push(payment._id);
        customer.balance -= amount;
        await customer.save({ session });

        // Update invoice
        invoice.paid = (invoice.paid || 0) + amount;
        invoice.remaining -= amount;
        await invoice.save({ session });

        // Commit transaction
        await session.commitTransaction();
        session.endSession();

        res.status(201).json({
            message: 'Payment added successfully',
        });
    } catch (error) {
        // Rollback transaction
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ message: error.message });
    }
};
