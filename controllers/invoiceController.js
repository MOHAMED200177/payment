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


exports.allInvoives = Crud.getAll(Invoice);
exports.updateInvoice = Crud.updateOne(Invoice);
exports.oneInvoice = Crud.getOne(Invoice, { path: 'customer', select: 'name' });
exports.deleteInvoice = Crud.deleteOne(Invoice);


// Create new invoice
exports.createInvoice = catchAsync(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Validate input
        const { error, value } = invoiceSchema.validate(req.body);
        if (error) throw new AppError(error.details[0].message, 400);

        const { name, email, phone, items, amount, discount } = value;

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
        let discountAmount = 0;

        if (discount) {

            discountAmount = calculatedTotal * (discount / 100); // Calculate discount amount

        }


        const totalAfterDiscount = calculatedTotal - discountAmount;

        if (amount > totalAfterDiscount) {
            throw new AppError(`Payment amount (${amount}) exceeds total invoice amount (${totalAfterDiscount})`, 400);
        }

        const remaining = totalAfterDiscount - amount;


        // Create and save invoice

        const invoice = new Invoice({

            customer: customer._id,

            items: updatedItems,

            total: totalAfterDiscount,

            paid: amount,

            remaining,

            discount: discountAmount,

        });

        await invoice.save({ session });


        // Create and save payment
        const payment = new Payment({ customer: customer._id, customerName: name, amount, invoice: invoice._id });
        await payment.save({ session });

        const invoiceTransaction = await Transaction.insertMany([
            {
                type: 'invoice',
                referenceId: invoice._id,
                amount: calculatedTotal,
                details: `Invoice created with total ${calculatedTotal} for customer ${customer.name}`,
                status: 'debit',
            },
            {
                type: 'payment',
                referenceId: invoice._id,
                amount,
                details: `Payment of ${amount} for invoice ${invoice._id}`,
                status: 'credit',
            }
        ]);

        invoiceTransaction.forEach((transaction) => {
            customer.transactions.push(transaction._id);
        });

        customer.invoice.push(invoice._id);
        customer.payment.push(payment._id);
        customer.outstandingBalance += remaining;
        customer.balance += totalAfterDiscount;
        customer.balance -= amount;
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