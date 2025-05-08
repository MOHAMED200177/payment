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
        const { name, amount, invoiceNumber } = req.body;

        const customer = await Customer.findOne({ name }).session(session);
        if (!customer) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'Customer not found' });
        }

        let invoice = null;
        let remaining = 0;

        if (invoiceNumber) {
            invoice = await Invoice.findOne({ invoiceNumber }).session(session);
            if (!invoice) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: 'Invoice not found' });
            }

            remaining = invoice.balanceDue;
            if (amount > remaining) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ message: `Payment exceeds remaining invoice amount. Remaining: ${remaining}` });
            }
        } else {
            // إذا لم يكن هناك `invoiceId`، التحقق من رصيد العميل
            if (amount > customer.outstandingBalance) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ message: `Payment exceeds outstanding balance. Remaining balance: ${customer.outstandingBalance}` });
            }
        }

        // إنشاء الدفع
        const payment = new Payment({
            customer: customer.id,
            customerName: name,
            amount,
            invoice: invoice ? invoice._id : null,
        });
        await payment.save({ session });

        // إنشاء المعاملة
        const transaction = await Transaction.create([{
            type: 'payment',
            referenceId: payment._id,
            amount,
            details: invoice ? `Payment of ${amount} for invoice ${invoice.invoiceNumber}` : `Payment of ${amount} against outstanding balance`,
            status: 'credit',
        }], { session });

        // تحديث العميل
        customer.transactions.push(transaction[0]._id);
        customer.payment.push(payment._id);
        customer.outstandingBalance -= amount;
        customer.balance -= amount;
        await customer.save({ session });

        // إذا كانت الفاتورة موجودة، تحديثها
        if (invoice) {
            invoice.amountPaid = (invoice.amountPaid || 0) + amount;
            invoice.balanceDue -= amount;
            await invoice.save({ session });
        }

        // إنهاء العملية بنجاح
        await session.commitTransaction();
        session.endSession();

        res.status(201).json({
            message: 'Payment added successfully',
        });
    } catch (error) {
        // التراجع عن التغييرات
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ message: error.message });
    }
};
