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
exports.oneInvoice = Crud.getOneById(Invoice, { path: 'customer', select: 'name' });
exports.deleteInvoice = Crud.deleteOne(Invoice);


// Create new invoice
exports.createInvoice = catchAsync(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { name, email, phone, items, amount, discount } = req.body;

        let customer = await Customer.findOne({ name });

        if (!customer) {
            if (!email || !phone) {
                throw new AppError('Email and phone are required for new customers.', 400);
            }
            customer = new Customer({ name, email, phone });
            await customer.save({ session });
        } else {
            req.body.email = req.body.email || customer.email;
            req.body.phone = req.body.phone || customer.phone;
        }

        const { error, value } = invoiceSchema.validate(req.body, { abortEarly: false });
        if (error) {
            const messages = error.details.map(detail => detail.message).join(', ');
            throw new AppError(messages, 400);
        }


        if (amount < 0) {
            throw new AppError('Payment amount cannot be negative', 400);
        }

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

            discountAmount = calculatedTotal * (discount / 100);
        }


        const totalAfterDiscount = calculatedTotal - discountAmount;

        if (amount > totalAfterDiscount) {
            throw new AppError(`Payment amount (${amount}) exceeds total invoice amount (${totalAfterDiscount})`, 400);
        }

        const remaining = totalAfterDiscount - amount;


        const invoice = new Invoice({

            customer: customer._id,

            items: updatedItems,

            total: totalAfterDiscount,

            paid: amount,

            remaining,

            discount: discountAmount,

        });

        await invoice.save({ session });

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
        ],
            { session }
        );

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


        res.status(201).json({
            message: 'Invoice created successfully',
            invoice: {
                ...invoice.toObject(),
                customer: {
                    name: customer.name,
                    phone: customer.phone,
                    email: customer.email
                },
            },
        });
    } catch (error) {
        await session.abortTransaction();
        if (error instanceof AppError) {
            next(error);
        } else {
            next(new AppError('Something went wrong during invoice creation', 500));
            console.log(error);
        }
    } finally {
        session.endSession();
    }
});