const mongoose = require('mongoose');
const Crud = require('./crudFactory');
const Payment = require('../models/payment');
const Customer = require('../models/customer');
const Invoice = require('../models/invoice');
const Stock = require('../models/stock');
const Transaction = require('../models/transactions');
const invoiceSchema = require('../schemas/invoice.schema');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

// Create new invoice
exports.createInvoice = catchAsync(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Validate input
        const { error, value } = invoiceSchema.validate(req.body);
        if (error) throw new AppError(error.details[0].message, 400);

        const { name, email, phone, items, amount } = value;

        // Find or create customer
        const customer = await Customer.findOneAndUpdate(
            { email },
            { name, email, phone },
            { upsert: true, new: true, session }
        );

        // Update stock and calculate total
        const updatedItems = [];
        let calculatedTotal = 0;

        for (const item of items) {
            const product = await Stock.findOne({ product: item.product }).session(session);
            if (!product) throw new AppError(`Product not found: ${item.product}`, 404);
            if (product.quantity < item.quantity) throw new AppError(`Insufficient stock for ${item.product}`, 400);

            product.quantity -= item.quantity;
            await product.save({ session });

            updatedItems.push({
                product_id: product._id,
                product: product.product,
                quantity: item.quantity,
                price: product.price,
            });

            calculatedTotal += product.price * item.quantity;
        }
        const remaining = calculatedTotal - amount;
        // Create and save invoice
        const invoice = new Invoice({ customer: customer._id, items: updatedItems, total: calculatedTotal, paid: amount, remaining });
        await invoice.save({ session });


        // Create and save payment
        const payment = new Payment({ customer: customer._id, amount, invoice: invoice._id });
        await payment.save({ session });

        const invoiceTransaction = await Transaction.create({
            type: 'invoice',
            referenceId: invoice._id,
            amount: calculatedTotal,
            details: `Invoice created with total ${calculatedTotal} for customer ${customer.name}`,
            status: 'debit',
        });

        
        customer.transactions.push(invoiceTransaction._id);
        customer.invoice.push(invoice._id);
        customer.payment.push(payment._id);
        customer.outstandingBalance += remaining;
        customer.balance += invoiceTotal;
        await customer.save({ session });

        await session.commitTransaction();
        const populatedInvoice = await Invoice.findById(invoice.id).populate('customer', 'name');

        res.status(201).json({
            message: 'Invoice created successfully',
            invoice: populatedInvoice,
        });
    } catch (error) {
        await session.abortTransaction();
        next(error);
    } finally {
        session.endSession();
    }
});